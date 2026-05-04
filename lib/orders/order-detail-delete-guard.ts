export type OrderDetailDeleteBlockCode =
  | 'ORDER_DETAIL_HAS_ISSUED_JOB_CARDS'
  | 'ORDER_DETAIL_HAS_WORK_POOL'
  | 'ORDER_DETAIL_HAS_COMPONENT_ACTIVITY';

export interface OrderDetailWorkPoolUsageRow {
  pool_id: number;
  source: string | null;
  status: string | null;
  required_qty: number | string | null;
  issued_qty: number | string | null;
  linked_job_card_items?: number | string | null;
  job_name?: string | null;
  product_name?: string | null;
}

export interface OrderDetailDeleteBlock {
  code: OrderDetailDeleteBlockCode;
  message: string;
  work_pool_rows: number;
  issued_qty: number;
  required_qty: number;
  linked_job_card_items: number;
  can_clear_generated_work: boolean;
}

export interface OrderDetailMaterialUsageRow {
  component_id: number;
  component_label: string;
  reserved_qty: number | string | null;
  ordered_qty: number | string | null;
  received_qty: number | string | null;
  issued_qty: number | string | null;
  supplier_order_count: number | string | null;
  stock_issuance_count: number | string | null;
}

function toNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildOrderDetailMaterialBlock(
  rows: OrderDetailMaterialUsageRow[]
): OrderDetailDeleteBlock | null {
  const totals = rows.reduce(
    (acc, row) => {
      acc.reservedQty += toNumber(row.reserved_qty);
      acc.orderedQty += toNumber(row.ordered_qty);
      acc.issuedQty += toNumber(row.issued_qty);
      acc.supplierOrderCount += toNumber(row.supplier_order_count);
      acc.stockIssuanceCount += toNumber(row.stock_issuance_count);
      return acc;
    },
    {
      reservedQty: 0,
      orderedQty: 0,
      issuedQty: 0,
      supplierOrderCount: 0,
      stockIssuanceCount: 0,
    }
  );

  const hasMaterialActivity =
    totals.reservedQty > 0 ||
    totals.orderedQty > 0 ||
    totals.issuedQty > 0 ||
    totals.supplierOrderCount > 0 ||
    totals.stockIssuanceCount > 0;

  if (!hasMaterialActivity) return null;

  return {
    code: 'ORDER_DETAIL_HAS_COMPONENT_ACTIVITY',
    message:
      'This product has component reservations, purchase-order allocations, or issued stock tied to components it uses. Review and adjust those component records before removing the product from the order.',
    work_pool_rows: 0,
    issued_qty: totals.issuedQty,
    required_qty: totals.orderedQty + totals.reservedQty,
    linked_job_card_items: 0,
    can_clear_generated_work: false,
  };
}

export function buildOrderDetailDeleteBlock(
  rows: OrderDetailWorkPoolUsageRow[]
): OrderDetailDeleteBlock | null {
  if (rows.length === 0) return null;

  const totals = rows.reduce(
    (acc, row) => {
      acc.issuedQty += toNumber(row.issued_qty);
      acc.requiredQty += toNumber(row.required_qty);
      acc.linkedJobCardItems += toNumber(row.linked_job_card_items);
      return acc;
    },
    { issuedQty: 0, requiredQty: 0, linkedJobCardItems: 0 }
  );

  if (totals.issuedQty > 0 || totals.linkedJobCardItems > 0) {
    return {
      code: 'ORDER_DETAIL_HAS_ISSUED_JOB_CARDS',
      message:
        'This product has job-card work linked to generated work-pool rows. Cancel or reverse the job cards before removing the product from the order.',
      work_pool_rows: rows.length,
      issued_qty: totals.issuedQty,
      required_qty: totals.requiredQty,
      linked_job_card_items: totals.linkedJobCardItems,
      can_clear_generated_work: false,
    };
  }

  return {
    code: 'ORDER_DETAIL_HAS_WORK_POOL',
    message:
      'This product still has generated work-pool rows. Clear those work-pool rows before removing the product from the order.',
    work_pool_rows: rows.length,
    issued_qty: 0,
    required_qty: totals.requiredQty,
    linked_job_card_items: 0,
    can_clear_generated_work: true,
  };
}
