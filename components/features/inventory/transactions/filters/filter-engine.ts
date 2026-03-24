import type { EnrichedTransaction } from '@/types/transaction-views';
import type { ComposableFilter, FilterCondition, FilterGroup, FilterOperator } from './filter-types';
import { getFieldDef } from './filter-field-defs';

/** Resolve a dot-path like 'component.category.categoryname' to a value */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function normalizeString(val: unknown): string {
  if (val == null) return '';
  return String(val).toLowerCase();
}

function evaluateText(raw: unknown, op: FilterOperator, condValue: unknown): boolean {
  const str = normalizeString(raw);
  const target = normalizeString(condValue);

  switch (op) {
    case 'equals': return str === target;
    case 'not_equals': return str !== target;
    case 'contains': return str.includes(target);
    case 'not_contains': return !str.includes(target);
    case 'starts_with': return str.startsWith(target);
    case 'is_empty': return str === '';
    case 'is_not_empty': return str !== '';
    default: return true;
  }
}

function evaluateSelect(raw: unknown, op: FilterOperator, condValue: unknown): boolean {
  const str = normalizeString(raw);

  switch (op) {
    case 'is': return str === normalizeString(condValue);
    case 'is_not': return str !== normalizeString(condValue);
    case 'is_any_of': {
      const arr = Array.isArray(condValue) ? condValue : [];
      return arr.some((v) => normalizeString(v) === str);
    }
    case 'is_none_of': {
      const arr = Array.isArray(condValue) ? condValue : [];
      return !arr.some((v) => normalizeString(v) === str);
    }
    case 'is_empty': return str === '';
    case 'is_not_empty': return str !== '';
    default: return true;
  }
}

function evaluateNumeric(raw: unknown, op: FilterOperator, condValue: unknown): boolean {
  if (op === 'is_empty') return raw == null;
  if (op === 'is_not_empty') return raw != null;

  const num = typeof raw === 'number' ? raw : Number(raw);
  const target = typeof condValue === 'number' ? condValue : Number(condValue);

  if (isNaN(num) || isNaN(target)) return true; // can't compare, pass through

  switch (op) {
    case 'eq': return num === target;
    case 'neq': return num !== target;
    case 'gt': return num > target;
    case 'gte': return num >= target;
    case 'lt': return num < target;
    case 'lte': return num <= target;
    default: return true;
  }
}

function evaluateCondition(t: EnrichedTransaction, c: FilterCondition): boolean {
  const fieldDef = getFieldDef(c.field);
  if (!fieldDef) return true; // unknown field, pass through

  const raw = getNestedValue(t as unknown as Record<string, unknown>, fieldDef.path);

  switch (fieldDef.type) {
    case 'text': return evaluateText(raw, c.operator, c.value);
    case 'select': return evaluateSelect(raw, c.operator, c.value);
    case 'numeric': return evaluateNumeric(raw, c.operator, c.value);
  }
}

function evaluateGroup(t: EnrichedTransaction, group: FilterGroup): boolean {
  const conditionResults = group.conditions.map((c) => evaluateCondition(t, c));
  const groupResults = group.groups.map((g) => evaluateGroup(t, g));
  const all = [...conditionResults, ...groupResults];

  if (all.length === 0) return true; // empty group matches everything

  return group.conjunction === 'and'
    ? all.every(Boolean)
    : all.some(Boolean);
}

/** Apply a composable filter tree to an array of transactions */
export function applyComposableFilter(
  transactions: EnrichedTransaction[],
  filter: ComposableFilter
): EnrichedTransaction[] {
  if (!filter.root.conditions.length && !filter.root.groups.length) {
    return transactions;
  }
  return transactions.filter((t) => evaluateGroup(t, filter.root));
}

/** Check if a composable filter has any active conditions */
export function hasActiveConditions(filter: ComposableFilter | undefined): boolean {
  if (!filter) return false;
  return filter.root.conditions.length > 0 || filter.root.groups.length > 0;
}

/** Count total conditions across all groups */
export function countConditions(filter: ComposableFilter | undefined): number {
  if (!filter) return 0;
  function countGroup(g: FilterGroup): number {
    return g.conditions.length + g.groups.reduce((sum, sg) => sum + countGroup(sg), 0);
  }
  return countGroup(filter.root);
}
