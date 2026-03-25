import type { FilterFieldDef, FilterFieldType, TextOperator, SelectOperator, NumericOperator, FilterOperator } from './filter-types';

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

export const TEXT_OPERATORS: { value: TextOperator; label: string }[] = [
  { value: 'equals', label: 'is exactly' },
  { value: 'not_equals', label: 'is not' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
];

export const SELECT_OPERATORS: { value: SelectOperator; label: string }[] = [
  { value: 'is', label: 'is' },
  { value: 'is_not', label: 'is not' },
  { value: 'is_any_of', label: 'is any of' },
  { value: 'is_none_of', label: 'is none of' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
];

export const NUMERIC_OPERATORS: { value: NumericOperator; label: string }[] = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '≠' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
];

export function getOperatorsForType(type: FilterFieldType): { value: FilterOperator; label: string }[] {
  switch (type) {
    case 'text': return TEXT_OPERATORS;
    case 'select': return SELECT_OPERATORS;
    case 'numeric': return NUMERIC_OPERATORS;
  }
}

export function getDefaultOperator(type: FilterFieldType): FilterOperator {
  switch (type) {
    case 'text': return 'contains';
    case 'select': return 'is';
    case 'numeric': return 'eq';
  }
}

export function getFieldDef(key: string): FilterFieldDef | undefined {
  return TRANSACTION_FILTER_FIELDS.find((f) => f.key === key);
}

/** Whether this operator needs a value input (is_empty/is_not_empty don't) */
export function operatorNeedsValue(op: FilterOperator): boolean {
  return op !== 'is_empty' && op !== 'is_not_empty';
}

/** Whether this operator supports multi-value (array) */
export function operatorIsMulti(op: FilterOperator): boolean {
  return op === 'is_any_of' || op === 'is_none_of';
}

/** Human-readable label for an operator */
export function getOperatorLabel(op: FilterOperator): string {
  for (const list of [TEXT_OPERATORS, SELECT_OPERATORS, NUMERIC_OPERATORS]) {
    const found = list.find((o) => o.value === op);
    if (found) return found.label;
  }
  return op;
}
