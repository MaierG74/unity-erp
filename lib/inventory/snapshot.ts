export const INVENTORY_LEDGER_HARDENED_FROM = '2026-04-09';

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
  estimated_value_basis: 'current_lowest_supplier_price' | 'none';
  estimated_value_disclaimer: string | null;
  summary: {
    total_components: number;
    stocked_components: number;
    total_quantity: number;
    estimated_total_value_current_cost: number | null;
  };
  rows: InventorySnapshotRow[];
};

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
    header.push('Estimated Unit Cost (Current)', 'Estimated Value (Current Cost)');
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
      columns.push(row.estimated_unit_cost_current, row.estimated_value_current_cost);
    }

    return columns;
  });

  return [header, ...csvRows]
    .map((columns) => columns.map((value) => csvEscape(value)).join(','))
    .join('\n');
}
