export const INVENTORY_LEDGER_HARDENED_FROM = '2026-04-09';

export type InventoryCostSource = 'wac' | 'list_price' | 'none';

export type InventorySnapshotRow = {
  component_id: number;
  internal_code: string;
  description: string | null;
  category_name: string | null;
  location: string | null;
  reorder_level: number | null;
  current_quantity: number;
  future_transaction_delta: number;
  snapshot_quantity: number;
  unit_cost: number | null;
  cost_source: InventoryCostSource;
  estimated_unit_cost_current: number | null;
  estimated_value_current_cost: number | null;
};

export type InventorySnapshotResponse = {
  as_of_date: string;
  exclusive_after: string;
  best_effort: boolean;
  best_effort_reason: string | null;
  hardening_reference_date: string;
  includes_estimated_values: boolean;
  estimated_value_basis: 'weighted_average_cost_with_list_price_fallback' | 'none';
  estimated_value_disclaimer: string | null;
  summary: {
    total_components: number;
    stocked_components: number;
    total_quantity: number;
    estimated_total_value_current_cost: number | null;
  };
  rows: InventorySnapshotRow[];
};

type RelationRecordValue<T> = T | T[] | null | undefined;

type InventoryCostRelation = RelationRecordValue<{
  average_cost?: number | string | null;
}>;

type SupplierComponentCostRow = {
  price?: number | string | null;
};

export function getRelationRecord<T>(value: RelationRecordValue<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function toFiniteNumberOrNull(value: number | string | null | undefined) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function minListPrice(suppliercomponents: SupplierComponentCostRow[] | null | undefined) {
  const prices = (suppliercomponents ?? [])
    .map((entry) => toFiniteNumberOrNull(entry.price))
    .filter((price): price is number => price != null && price > 0);

  if (prices.length === 0) return null;
  return Math.min(...prices);
}

export function getInventorySnapshotUnitCost(input: {
  inventory: InventoryCostRelation;
  suppliercomponents?: SupplierComponentCostRow[] | null;
}): { value: number | null; source: InventoryCostSource } {
  const inventory = getRelationRecord(input.inventory);
  const wac = toFiniteNumberOrNull(inventory?.average_cost);
  if (wac != null && wac > 0) {
    return { value: wac, source: 'wac' };
  }

  const list = minListPrice(input.suppliercomponents);
  if (list != null) {
    return { value: list, source: 'list_price' };
  }

  return { value: null, source: 'none' };
}

export function computeNewAverageCost(
  oldQuantity: number,
  oldAverageCost: number | null,
  receivedQuantity: number,
  receivedCost: number | null
) {
  if (receivedCost == null || receivedCost <= 0 || receivedQuantity <= 0) {
    return oldAverageCost;
  }

  const safeOldQuantity = Math.max(oldQuantity, 0);
  if (safeOldQuantity <= 0 || oldAverageCost == null) {
    return receivedCost;
  }

  return (
    safeOldQuantity * oldAverageCost + receivedQuantity * receivedCost
  ) / (safeOldQuantity + receivedQuantity);
}

function csvEscape(value: string | number | null | undefined) {
  if (value == null) return '';
  const stringValue = String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

export function buildInventorySnapshotCsv(
  snapshot: InventorySnapshotResponse,
  options: { includeZeroBalances?: boolean; includeEstimatedValues?: boolean } = {}
) {
  const includeZeroBalances = options.includeZeroBalances ?? false;
  const includeEstimatedValues =
    options.includeEstimatedValues ?? snapshot.includes_estimated_values;
  const rows = includeZeroBalances
    ? snapshot.rows
    : snapshot.rows.filter((row) => row.snapshot_quantity !== 0);

  const header = [
    'As Of Date',
    'Code',
    'Description',
    'Category',
    'Location',
    'Reorder Level',
    'Snapshot Quantity',
    'Current Quantity',
    'Future Transaction Delta',
  ];

  if (includeEstimatedValues) {
    header.push('unit_cost', 'cost_source', 'Estimated Value (Current Cost)');
  }

  const csvRows = rows.map((row) => {
    const columns: Array<string | number | null | undefined> = [
      snapshot.as_of_date,
      row.internal_code,
      row.description,
      row.category_name,
      row.location,
      row.reorder_level,
      row.snapshot_quantity,
      row.current_quantity,
      row.future_transaction_delta,
    ];

    if (includeEstimatedValues) {
      columns.push(row.unit_cost, row.cost_source, row.estimated_value_current_cost);
    }

    return columns;
  });

  return [header, ...csvRows]
    .map((columns) => columns.map((value) => csvEscape(value)).join(','))
    .join('\n');
}
