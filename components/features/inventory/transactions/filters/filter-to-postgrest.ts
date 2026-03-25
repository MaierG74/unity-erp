/**
 * Translates a ComposableFilter tree into PostgREST filter expressions
 * for server-side evaluation against the inventory_transactions_enriched view.
 */
import type { PostgrestFilterBuilder } from '@supabase/postgrest-js';
import type { ComposableFilter, FilterCondition, FilterGroup } from './filter-types';
import { getFieldDef } from './filter-field-defs';

// --- Convert a single condition to a PostgREST filter expression string ---

function escapeFilterValue(val: string): string {
  // PostgREST filter values: commas and parens are special in or()/and() syntax.
  // Wrap in double quotes if the value contains special chars.
  if (/[,().]/.test(val)) return `"${val}"`;
  return val;
}

function conditionToExpression(cond: FilterCondition): string | null {
  const fieldDef = getFieldDef(cond.field);
  if (!fieldDef?.viewColumn) return null;

  const col = fieldDef.viewColumn;
  const val = cond.value;

  switch (cond.operator) {
    // --- Text operators ---
    case 'equals':
    case 'is':
      return `${col}.eq.${escapeFilterValue(String(val ?? ''))}`;
    case 'not_equals':
    case 'is_not':
      return `${col}.neq.${escapeFilterValue(String(val ?? ''))}`;
    case 'contains':
      return `${col}.ilike.%${escapeFilterValue(String(val ?? ''))}%`;
    case 'not_contains':
      return `${col}.not.ilike.%${escapeFilterValue(String(val ?? ''))}%`;
    case 'starts_with':
      return `${col}.ilike.${escapeFilterValue(String(val ?? ''))}%`;

    // --- Select multi-value operators ---
    case 'is_any_of': {
      const arr = Array.isArray(val) ? val : [];
      if (arr.length === 0) return null;
      return `${col}.in.(${arr.map((v) => escapeFilterValue(String(v))).join(',')})`;
    }
    case 'is_none_of': {
      const arr = Array.isArray(val) ? val : [];
      if (arr.length === 0) return null;
      return `${col}.not.in.(${arr.map((v) => escapeFilterValue(String(v))).join(',')})`;
    }

    // --- Numeric operators ---
    case 'eq':
      return `${col}.eq.${val}`;
    case 'neq':
      return `${col}.neq.${val}`;
    case 'gt':
      return `${col}.gt.${val}`;
    case 'gte':
      return `${col}.gte.${val}`;
    case 'lt':
      return `${col}.lt.${val}`;
    case 'lte':
      return `${col}.lte.${val}`;

    // --- Empty/not-empty (all types) ---
    case 'is_empty':
      return `${col}.is.null`;
    case 'is_not_empty':
      return `${col}.not.is.null`;

    default:
      return null;
  }
}

// --- Convert a FilterGroup tree to a PostgREST expression string ---

function groupToExpression(group: FilterGroup): string | null {
  const parts: string[] = [];

  for (const cond of group.conditions) {
    const expr = conditionToExpression(cond);
    if (expr) parts.push(expr);
  }

  for (const subGroup of group.groups) {
    const expr = groupToExpression(subGroup);
    if (expr) parts.push(expr);
  }

  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];

  const joined = parts.join(',');
  return group.conjunction === 'or' ? `or(${joined})` : `and(${joined})`;
}

// --- Public API: apply a ComposableFilter to a Supabase query builder ---

/**
 * Apply composable filter conditions to a Supabase PostgREST query.
 *
 * Strategy:
 * - Root AND group: chain individual .filter() calls + .or() for nested OR sub-groups
 * - Root OR group: single .or() call with the full expression
 */
export function applyServerFilters<T>(
  query: PostgrestFilterBuilder<any, any, any, T>,
  filter: ComposableFilter | undefined
): PostgrestFilterBuilder<any, any, any, T> {
  if (!filter) return query;

  const root = filter.root;
  if (root.conditions.length === 0 && root.groups.length === 0) return query;

  if (root.conjunction === 'and') {
    // AND at root: chain individual conditions directly on the query builder
    for (const cond of root.conditions) {
      query = applyConditionDirect(query, cond);
    }
    // Nested groups: generate expression strings
    for (const subGroup of root.groups) {
      const expr = groupToExpression(subGroup);
      if (!expr) continue;
      if (subGroup.conjunction === 'or') {
        // .or() already wraps in or(), so strip the outer or()
        const inner = expr.startsWith('or(') ? expr.slice(3, -1) : expr;
        query = query.or(inner) as typeof query;
      } else {
        // AND sub-group: flatten — apply each condition directly
        query = applyGroupDirect(query, subGroup);
      }
    }
  } else {
    // Root is OR: build full expression, apply via .or()
    const expr = groupToExpression(root);
    if (expr) {
      const inner = expr.startsWith('or(') ? expr.slice(3, -1) : expr;
      query = query.or(inner) as typeof query;
    }
  }

  return query;
}

/** Apply a single condition directly to the query builder (for AND chains) */
function applyConditionDirect<T>(
  query: PostgrestFilterBuilder<any, any, any, T>,
  cond: FilterCondition
): PostgrestFilterBuilder<any, any, any, T> {
  const fieldDef = getFieldDef(cond.field);
  if (!fieldDef?.viewColumn) return query;

  const col = fieldDef.viewColumn;
  const val = cond.value;

  switch (cond.operator) {
    case 'equals':
    case 'is':
      return query.eq(col, String(val ?? '')) as typeof query;
    case 'not_equals':
    case 'is_not':
      return query.neq(col, String(val ?? '')) as typeof query;
    case 'contains':
      return query.ilike(col, `%${val ?? ''}%`) as typeof query;
    case 'not_contains':
      return query.not(col, 'ilike', `%${val ?? ''}%`) as typeof query;
    case 'starts_with':
      return query.ilike(col, `${val ?? ''}%`) as typeof query;
    case 'is_any_of': {
      const arr = Array.isArray(val) ? val : [];
      return arr.length > 0 ? query.in(col, arr.map(String)) as typeof query : query;
    }
    case 'is_none_of': {
      const arr = Array.isArray(val) ? val : [];
      return arr.length > 0 ? query.not(col, 'in', `(${arr.map(String).join(',')})`) as typeof query : query;
    }
    case 'eq':
      return query.eq(col, Number(val)) as typeof query;
    case 'neq':
      return query.neq(col, Number(val)) as typeof query;
    case 'gt':
      return query.gt(col, Number(val)) as typeof query;
    case 'gte':
      return query.gte(col, Number(val)) as typeof query;
    case 'lt':
      return query.lt(col, Number(val)) as typeof query;
    case 'lte':
      return query.lte(col, Number(val)) as typeof query;
    case 'is_empty':
      return query.is(col, null) as typeof query;
    case 'is_not_empty':
      return query.not(col, 'is', null) as typeof query;
    default:
      return query;
  }
}

/** Recursively apply AND group conditions directly to query builder */
function applyGroupDirect<T>(
  query: PostgrestFilterBuilder<any, any, any, T>,
  group: FilterGroup
): PostgrestFilterBuilder<any, any, any, T> {
  for (const cond of group.conditions) {
    query = applyConditionDirect(query, cond);
  }
  for (const subGroup of group.groups) {
    if (subGroup.conjunction === 'or') {
      const expr = groupToExpression(subGroup);
      if (expr) {
        const inner = expr.startsWith('or(') ? expr.slice(3, -1) : expr;
        query = query.or(inner) as typeof query;
      }
    } else {
      query = applyGroupDirect(query, subGroup);
    }
  }
  return query;
}

/**
 * Build PostgREST filter expressions for text search across multiple view columns.
 * Returns an array of OR filter strings — one per search word.
 * Each word must match at least one column (AND of ORs), preserving multi-word search behavior.
 * Returns empty array if searchTerm is empty.
 */
export function buildSearchFilters(searchTerm: string): string[] {
  const terms = searchTerm.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const searchColumns = [
    'component_code',
    'component_description',
    'category_name',
    'supplier_name',
    'transaction_type_name',
    'po_number',
    'order_number',
    'reason',
  ];

  // Each word becomes an OR across all columns; words are ANDed by chaining .or() calls
  return terms.map((term) =>
    searchColumns.map((col) => `${col}.ilike.%${term}%`).join(',')
  );
}
