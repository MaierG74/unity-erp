# Server-Side Filtering for Transactions Explorer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the composable filter engine, text search, and legacy toolbar filters from client-side JS to server-side PostgREST queries, eliminating the 5,000-row ceiling that will become a problem at ~6 months of data growth.

**Architecture:** Create a flat database view (`inventory_transactions_enriched`) that pre-joins all related tables into top-level columns. Build a translator that converts the existing `FilterGroup` tree into PostgREST filter strings (`or()`/`and()` syntax). Query the view instead of the base table, applying all filters server-side. Map flat rows back to the nested `EnrichedTransaction` shape so no downstream UI code changes.

**Tech Stack:** PostgreSQL view with `security_invoker = true`, Supabase JS v2 `.or()` / `.eq()` / `.ilike()` filter methods, existing `ComposableFilter` type system.

**Branch:** `codex/local-transactions-explorer` (continue existing work)

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `supabase/migrations/YYYYMMDD_transactions_enriched_view.sql` | Flat view joining all related tables |
| Create | `components/features/inventory/transactions/filters/filter-to-postgrest.ts` | Translates `FilterGroup` → PostgREST filter strings |
| Create | `components/features/inventory/transactions/filters/map-enriched-row.ts` | Maps flat view rows → nested `EnrichedTransaction` |
| Modify | `hooks/use-transactions-query.ts` | Switch to view, apply server-side filters, raise cap |
| Modify | `components/features/inventory/transactions/TransactionsExplorer.tsx` | Remove client-side filter pipeline, pass filters to hook |
| Modify | `components/features/inventory/transactions/filters/filter-field-defs.ts` | Add view column mapping per field |
| Modify | `components/features/inventory/transactions/filters/filter-types.ts` | Add optional `viewColumn` to `FilterFieldDef` |
| No change | `components/features/inventory/transactions/filters/filter-engine.ts` | Keep as fallback; no modifications needed |

---

## Task 1: Create the Flat Database View

**Files:**
- Create: `supabase/migrations/YYYYMMDD_transactions_enriched_view.sql`

This view flattens `inventory_transactions` + 5 joined tables into top-level columns. Uses `security_invoker = true` so RLS on `inventory_transactions` (org_id-scoped) is respected for the calling role.

- [ ] **Step 1: Write the migration SQL**

```sql
-- Flat view for server-side filtering in Transactions Explorer.
-- security_invoker = true ensures RLS on inventory_transactions applies.

CREATE OR REPLACE VIEW public.inventory_transactions_enriched
WITH (security_invoker = true) AS
SELECT
  it.transaction_id,
  it.component_id,
  it.quantity,
  it.transaction_date,
  it.order_id,
  it.purchase_order_id,
  it.user_id,
  it.reason,
  it.org_id,
  it.transaction_type_id,
  -- Component
  c.internal_code  AS component_code,
  c.description    AS component_description,
  c.cat_id         AS category_id,
  -- Category
  cc.categoryname  AS category_name,
  -- Transaction type
  tt.type_name     AS transaction_type_name,
  -- Purchase order
  po.q_number      AS po_number,
  po.supplier_id,
  -- Supplier
  s.name           AS supplier_name,
  -- Order
  o.order_number
FROM public.inventory_transactions it
LEFT JOIN public.components        c  ON c.component_id        = it.component_id
LEFT JOIN public.component_categories cc ON cc.cat_id           = c.cat_id
LEFT JOIN public.transaction_types tt ON tt.transaction_type_id = it.transaction_type_id
LEFT JOIN public.purchase_orders   po ON po.purchase_order_id   = it.purchase_order_id
LEFT JOIN public.suppliers         s  ON s.supplier_id          = po.supplier_id
LEFT JOIN public.orders            o  ON o.order_id             = it.order_id;

-- Grant access to authenticated role (PostgREST)
GRANT SELECT ON public.inventory_transactions_enriched TO authenticated;
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Run: `mcp__supabase__apply_migration` with the SQL above.

- [ ] **Step 3: Verify the view works**

Run via `mcp__supabase__execute_sql`:
```sql
SELECT count(*) FROM inventory_transactions_enriched;
```
Expected: returns a count matching `SELECT count(*) FROM inventory_transactions`.

Then verify flat columns:
```sql
SELECT transaction_id, component_code, component_description, category_name,
       supplier_name, transaction_type_name, po_number, order_number, quantity, reason
FROM inventory_transactions_enriched
LIMIT 5;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/
git commit -m "feat: add inventory_transactions_enriched view for server-side filtering"
```

---

## Task 2: Add View Column Mapping to Field Definitions

**Files:**
- Modify: `components/features/inventory/transactions/filters/filter-field-defs.ts`

Add a `viewColumn` property to `FilterFieldDef` and populate it for each field. This maps composable filter field keys to flat view column names.

- [ ] **Step 1: Update the FilterFieldDef type**

In `filter-types.ts`, add `viewColumn` to `FilterFieldDef`:

```typescript
export type FilterFieldDef = {
  key: string;
  label: string;
  type: FilterFieldType;
  /** Dot-path accessor into EnrichedTransaction (client-side) */
  path: string;
  /** Column name in inventory_transactions_enriched view (server-side) */
  viewColumn?: string;
  /** For 'select' fields: query key to reuse existing React Query cache */
  optionsQueryKey?: string;
};
```

- [ ] **Step 2: Add viewColumn to each field definition**

In `filter-field-defs.ts`, update `TRANSACTION_FILTER_FIELDS`:

```typescript
export const TRANSACTION_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'component_code', label: 'Component', type: 'select', path: 'component.internal_code', viewColumn: 'component_code', optionsQueryKey: 'components' },
  { key: 'description', label: 'Description', type: 'text', path: 'component.description', viewColumn: 'component_description' },
  { key: 'category', label: 'Category', type: 'select', path: 'component.category.categoryname', viewColumn: 'category_name', optionsQueryKey: 'categories' },
  { key: 'supplier', label: 'Supplier', type: 'select', path: 'purchase_order.supplier.name', viewColumn: 'supplier_name', optionsQueryKey: 'suppliers' },
  { key: 'transaction_type', label: 'Type', type: 'select', path: 'transaction_type.type_name', viewColumn: 'transaction_type_name', optionsQueryKey: 'transaction-types' },
  { key: 'quantity', label: 'Quantity', type: 'numeric', path: 'quantity', viewColumn: 'quantity' },
  { key: 'order_number', label: 'Order Ref', type: 'text', path: 'order.order_number', viewColumn: 'order_number' },
  { key: 'po_number', label: 'PO Number', type: 'text', path: 'purchase_order.q_number', viewColumn: 'po_number' },
  { key: 'reason', label: 'Reason', type: 'text', path: 'reason', viewColumn: 'reason' },
];
```

- [ ] **Step 3: Commit**

```bash
git add components/features/inventory/transactions/filters/
git commit -m "feat: add viewColumn mapping to filter field definitions"
```

---

## Task 3: Build the PostgREST Filter Translator

**Files:**
- Create: `components/features/inventory/transactions/filters/filter-to-postgrest.ts`

Converts a `ComposableFilter` tree into PostgREST filter expressions that can be applied to a Supabase query builder. Handles AND/OR conjunctions, nested groups, all text/select/numeric operators.

- [ ] **Step 1: Create the translator module**

```typescript
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
 * - Root AND group → chain individual .filter() calls + .or() for nested OR sub-groups
 * - Root OR group → single .or() call with the full expression
 */
export function applyServerFilters<T>(
  query: PostgrestFilterBuilder<any, any, T>,
  filter: ComposableFilter | undefined
): PostgrestFilterBuilder<any, any, T> {
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
  query: PostgrestFilterBuilder<any, any, T>,
  cond: FilterCondition
): PostgrestFilterBuilder<any, any, T> {
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
  query: PostgrestFilterBuilder<any, any, T>,
  group: FilterGroup
): PostgrestFilterBuilder<any, any, T> {
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty` (check for errors in the new file only).

- [ ] **Step 3: Commit**

```bash
git add components/features/inventory/transactions/filters/filter-to-postgrest.ts
git commit -m "feat: PostgREST filter translator for composable filters"
```

---

## Task 4: Build the Flat-Row-to-Nested Mapper

**Files:**
- Create: `components/features/inventory/transactions/filters/map-enriched-row.ts`

Maps a flat row from the `inventory_transactions_enriched` view back to the nested `EnrichedTransaction` shape that all downstream UI code expects.

- [ ] **Step 1: Create the mapper**

```typescript
import type { EnrichedTransaction } from '@/types/transaction-views';

/** Shape of a row from the inventory_transactions_enriched view */
export type FlatTransactionRow = {
  transaction_id: number;
  component_id: number;
  quantity: number;
  transaction_date: string;
  order_id: number | null;
  purchase_order_id: number | null;
  user_id: string | null;
  reason: string | null;
  org_id: string;
  transaction_type_id: number | null;
  component_code: string | null;
  component_description: string | null;
  category_id: number | null;
  category_name: string | null;
  transaction_type_name: string | null;
  po_number: string | null;
  supplier_id: number | null;
  supplier_name: string | null;
  order_number: string | null;
};

/** Convert a flat view row into the nested EnrichedTransaction shape */
export function mapFlatToEnriched(row: FlatTransactionRow): EnrichedTransaction {
  return {
    transaction_id: row.transaction_id,
    component_id: row.component_id,
    quantity: row.quantity,
    transaction_date: row.transaction_date,
    order_id: row.order_id,
    purchase_order_id: row.purchase_order_id,
    user_id: row.user_id,
    reason: row.reason,
    component: {
      component_id: row.component_id,
      internal_code: row.component_code ?? '',
      description: row.component_description ?? null,
      category: row.category_id != null
        ? { cat_id: row.category_id, categoryname: row.category_name ?? '' }
        : null,
    },
    transaction_type: row.transaction_type_id != null
      ? { transaction_type_id: row.transaction_type_id, type_name: row.transaction_type_name ?? '' }
      : null,
    purchase_order: row.purchase_order_id != null
      ? {
          purchase_order_id: row.purchase_order_id,
          q_number: row.po_number ?? '',
          supplier: row.supplier_id != null
            ? { supplier_id: row.supplier_id, name: row.supplier_name ?? '' }
            : null,
        }
      : null,
    order: row.order_id != null
      ? { order_id: row.order_id, order_number: row.order_number ?? '' }
      : null,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add components/features/inventory/transactions/filters/map-enriched-row.ts
git commit -m "feat: flat view row → EnrichedTransaction mapper"
```

---

## Task 5: Rewrite the Query Hook for Server-Side Filtering

**Files:**
- Modify: `hooks/use-transactions-query.ts`

This is the core change. Switch from querying `inventory_transactions` with nested `select` to querying `inventory_transactions_enriched` with flat columns. Apply all filters server-side: composable filter, toolbar legacy filters (supplier, category), and text search.

- [ ] **Step 1: Rewrite `use-transactions-query.ts`**

Key changes:
1. Query `inventory_transactions_enriched` instead of `inventory_transactions` with nested joins
2. Select flat columns (no nested `select` syntax)
3. Apply composable filter via `applyServerFilters()`
4. Apply text search via `buildSearchFilter()` → `.or()`
5. Apply toolbar legacy filters (supplierId → `supplier_id`, categoryId → `category_id`) as `.eq()` on the view
6. Map results via `mapFlatToEnriched()`
7. Raise MAX_ROWS to 10,000 (supports ~12 months at 800 txns/month with no filters)

```typescript
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/common/auth-provider';
import type { EnrichedTransaction } from '@/types/transaction-views';
import type { ComposableFilter } from '@/components/features/inventory/transactions/filters/filter-types';
import { applyServerFilters, buildSearchFilters } from '@/components/features/inventory/transactions/filters/filter-to-postgrest';
import { mapFlatToEnriched, type FlatTransactionRow } from '@/components/features/inventory/transactions/filters/map-enriched-row';
import { startOfWeek, subDays, startOfMonth, startOfYear, endOfDay } from 'date-fns';

function getPresetDateRange(preset: string | null): { from: Date; to: Date } {
  const now = new Date();
  const to = endOfDay(now);
  switch (preset) {
    case 'thisWeek':
      return { from: startOfWeek(now, { weekStartsOn: 1 }), to };
    case 'thisMonth':
      return { from: startOfMonth(now), to };
    case 'last30':
      return { from: subDays(now, 30), to };
    case 'thisQuarter': {
      const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
      return { from: new Date(now.getFullYear(), quarterMonth, 1), to };
    }
    case 'ytd':
      return { from: startOfYear(now), to };
    default:
      return { from: subDays(now, 30), to };
  }
}

type UseTransactionsQueryParams = {
  dateFrom?: string | null;
  dateTo?: string | null;
  datePreset?: string | null;
  productId?: string;
  transactionTypeId?: string;
  supplierId?: string;
  categoryId?: string;
  componentIds?: string[];
  search?: string;
  composableFilter?: ComposableFilter;
};

export function useTransactionsQuery(params: UseTransactionsQueryParams) {
  const { user } = useAuth();

  const dateRange = useMemo(() => {
    if (params.dateFrom && params.dateTo) {
      return { from: new Date(params.dateFrom), to: new Date(params.dateTo) };
    }
    return getPresetDateRange(params.datePreset ?? 'last30');
  }, [params.dateFrom, params.dateTo, params.datePreset]);

  // BOM component lookup (unchanged)
  const bomQuery = useQuery({
    queryKey: ['bom-components', params.productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('billofmaterials')
        .select('component_id')
        .eq('product_id', Number(params.productId));
      if (error) throw error;
      return data.map((d) => d.component_id);
    },
    enabled: !!user && !!params.productId && params.productId !== 'all',
  });

  const bomComponentIds = bomQuery.data;

  const transactionsQuery = useQuery({
    queryKey: [
      'inventory',
      'transactions',
      'explorer',
      {
        dateFrom: dateRange.from.toISOString(),
        dateTo: dateRange.to.toISOString(),
        productId: params.productId,
        transactionTypeId: params.transactionTypeId,
        supplierId: params.supplierId,
        categoryId: params.categoryId,
        componentIds: params.componentIds,
        bomComponentIds,
        search: params.search,
        composableFilter: params.composableFilter,
      },
    ],
    queryFn: async () => {
      // Flat column select from the enriched view
      const selectStr = [
        'transaction_id', 'component_id', 'quantity', 'transaction_date',
        'order_id', 'purchase_order_id', 'user_id', 'reason', 'org_id',
        'transaction_type_id', 'component_code', 'component_description',
        'category_id', 'category_name', 'transaction_type_name',
        'po_number', 'supplier_id', 'supplier_name', 'order_number',
      ].join(',');

      function buildQuery() {
        let q = supabase
          .from('inventory_transactions_enriched')
          .select(selectStr)
          .gte('transaction_date', dateRange.from.toISOString())
          .lte('transaction_date', dateRange.to.toISOString())
          .order('transaction_date', { ascending: false });

        // --- Server-side toolbar filters ---
        if (params.transactionTypeId && params.transactionTypeId !== 'all') {
          q = q.eq('transaction_type_id', Number(params.transactionTypeId));
        }
        if (params.supplierId && params.supplierId !== 'all') {
          q = q.eq('supplier_id', Number(params.supplierId));
        }
        if (params.categoryId && params.categoryId !== 'all') {
          q = q.eq('category_id', Number(params.categoryId));
        }
        if (params.componentIds && params.componentIds.length > 0) {
          q = q.in('component_id', params.componentIds.map(Number));
        } else if (bomComponentIds && bomComponentIds.length > 0) {
          q = q.in('component_id', bomComponentIds);
        }

        // --- Server-side composable filter ---
        q = applyServerFilters(q, params.composableFilter);

        // --- Server-side text search (AND of ORs: each word must match at least one column) ---
        if (params.search?.trim()) {
          const searchFilters = buildSearchFilters(params.search);
          for (const orFilter of searchFilters) {
            q = q.or(orFilter);
          }
        }

        return q;
      }

      // Paginate in 1000-row chunks (PostgREST max_rows)
      const PAGE_SIZE = 1000;
      const MAX_ROWS = 10_000;
      let allData: FlatTransactionRow[] = [];

      for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
        const { data, error } = await buildQuery().range(offset, offset + PAGE_SIZE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allData = allData.concat(data as unknown as FlatTransactionRow[]);
        if (data.length < PAGE_SIZE) break;
      }

      // Map flat rows → nested EnrichedTransaction
      return allData.map(mapFlatToEnriched);
    },
    enabled:
      !!user &&
      (params.productId === 'all' ||
        !params.productId ||
        bomQuery.isSuccess ||
        bomQuery.data !== undefined),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  return {
    ...transactionsQuery,
    dateRange,
    isLoadingBom: bomQuery.isLoading && !!params.productId && params.productId !== 'all',
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty`

- [ ] **Step 3: Commit**

```bash
git add hooks/use-transactions-query.ts
git commit -m "feat: query enriched view with server-side filters"
```

---

## Task 6: Update TransactionsExplorer to Pass Filters to Hook

**Files:**
- Modify: `components/features/inventory/transactions/TransactionsExplorer.tsx`

Remove the client-side composable filter and search pipelines. Pass both to the query hook instead so they're applied server-side.

- [ ] **Step 1: Update TransactionsExplorer.tsx**

Changes:
1. Pass `composableFilter` and `search` to `useTransactionsQuery()` params
2. Remove the `useMemo` that applies `applyComposableFilter()` and text search client-side
3. Use `data` directly as `transactions` (already filtered server-side)
4. Update the cap warning threshold from 5,000 to 10,000

```typescript
// In TransactionsExplorer:

// BEFORE: hook call without composable filter / search
const { data: rawTransactions = [], ... } = useTransactionsQuery({ ... });

// AFTER: pass composable filter + search to the hook
const { data: transactions = [], isLoading, error, dateRange } = useTransactionsQuery({
  dateFrom: config.dateRange.from,
  dateTo: config.dateRange.to,
  datePreset: config.dateRange.preset,
  productId: config.filters.productId,
  transactionTypeId: config.filters.transactionTypeId,
  supplierId: config.filters.supplierId,
  categoryId: config.filters.categoryId,
  componentIds: config.filters.componentIds,
  search: config.filters.search,
  composableFilter: config.filters.composableFilter,
});

// REMOVE: the entire client-side filtering useMemo block
// (the one that calls applyComposableFilter + text search)

// UPDATE: cap warning threshold
{transactions.length >= 10000 && (
  <p className="text-sm text-amber-500 text-center">
    Results capped at 10,000 rows. Narrow your date range or add filters for complete results.
  </p>
)}
```

- [ ] **Step 2: Remove unused imports**

Remove imports for `applyComposableFilter` and `hasActiveConditions` from the file (they're no longer used here). Keep `filter-engine.ts` in the repo as a fallback/reference — other code may use it.

- [ ] **Step 3: Verify TypeScript compiles and lint passes**

```bash
npx tsc --noEmit --pretty && npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add components/features/inventory/transactions/TransactionsExplorer.tsx
git commit -m "feat: move composable filter + search to server-side"
```

---

## Task 7: Verify in Browser

**Files:** None (verification only)

- [ ] **Step 1: Start the dev server if not running**

```bash
npm run dev -- --port 3001 --webpack
```

- [ ] **Step 2: Navigate to Transactions Explorer**

Use Chrome MCP to navigate to `http://localhost:3001/inventory/transactions` (or wherever the explorer lives). Log in with the test account if needed (testai / ClaudeTest2026!).

- [ ] **Step 3: Test basic loading**

Verify transactions load with the default "Last 30 Days" preset. Check that grouped views (By Component, By Supplier) still work and show stock quantities.

- [ ] **Step 4: Test composable filter — single AND condition**

Add a filter: Component is [pick one]. Verify:
- Results are filtered correctly
- Network tab shows the filter is in the PostgREST query URL (not client-side)

- [ ] **Step 5: Test composable filter — OR condition**

Add an OR group: Quantity > 10 OR Quantity < -10. Verify results include only rows matching either condition.

- [ ] **Step 6: Test text search**

Type a component name in the search box. Verify results are filtered and no client-side filtering is happening.

- [ ] **Step 7: Test legacy toolbar filters**

Use the Supplier dropdown and Category dropdown. Verify they filter correctly (these were previously client-side).

- [ ] **Step 8: Test date range — YTD**

Switch to "Year to Date" preset. Verify it loads more data than before (no longer capped at 5,000). If the org has < 10,000 total transactions, no cap warning should appear.

- [ ] **Step 9: Take a screenshot as proof**

Use Chrome MCP to screenshot the working explorer with active filters.

---

## Task 8: Run Lint + Type Check + Security Advisors

- [ ] **Step 1: Lint**

```bash
npm run lint
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit --pretty
```

- [ ] **Step 3: Run Supabase security advisors**

Use `mcp__supabase__get_advisors` to check for any RLS or security issues with the new view.

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address lint/type/security findings"
```

---

## Notes

- **Client-side filter engine preserved**: `filter-engine.ts` is NOT deleted. It remains as the canonical reference for how filter evaluation works, and may be used by other features (saved views, print preview, etc.).
- **Multi-word search**: `buildSearchFilters` returns one OR-filter-string per word. Each `.or()` call requires the word to match at least one column; chaining multiple `.or()` calls ANDs them. This preserves the original multi-word behavior ("blue board" matches a row where one column has "blue" and another has "board").
- **`security_invoker = true`**: Critical for the view to respect org-scoped RLS on `inventory_transactions`. Without it, the view runs as `postgres` and bypasses RLS.
- **BOM component lookup**: Unchanged — still a separate query that resolves product → BOM component IDs before the main transaction query.
