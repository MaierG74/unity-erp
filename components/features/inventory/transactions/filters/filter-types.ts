// --- Field type determines which operators and value inputs are available ---
export type FilterFieldType = 'text' | 'select' | 'numeric';

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

// --- Operators by field type ---
export type TextOperator = 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'starts_with' | 'is_empty' | 'is_not_empty';
export type SelectOperator = 'is' | 'is_not' | 'is_any_of' | 'is_none_of' | 'is_empty' | 'is_not_empty';
export type NumericOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'is_empty' | 'is_not_empty';
export type FilterOperator = TextOperator | SelectOperator | NumericOperator;

// --- A single filter condition row ---
export type FilterCondition = {
  id: string;
  field: string;
  operator: FilterOperator;
  value: string | string[] | number | null;
};

// --- A group of conditions joined by a single conjunction ---
export type FilterGroup = {
  id: string;
  conjunction: 'and' | 'or';
  conditions: FilterCondition[];
  groups: FilterGroup[];
};

// --- Top-level composable filter stored in ViewConfig ---
export type ComposableFilter = {
  version: 2;
  root: FilterGroup;
};
