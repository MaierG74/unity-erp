export type OrderDetailDeleteBlockCode =
  | 'ORDER_DETAIL_HAS_ISSUED_JOB_CARDS'
  | 'ORDER_DETAIL_HAS_WORK_POOL';

export interface OrderDetailWorkPoolUsageRow {
  pool_id: number;
  source: string | null;
  status: string | null;
  required_qty: number | string | null;
  issued_qty: number | string | null;
  job_name?: string | null;
  product_name?: string | null;
}

export interface OrderDetailDeleteBlock {
  code: OrderDetailDeleteBlockCode;
  message: string;
  work_pool_rows: number;
  issued_qty: number;
  required_qty: number;
}

function toNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildOrderDetailDeleteBlock(
  rows: OrderDetailWorkPoolUsageRow[]
): OrderDetailDeleteBlock | null {
  if (rows.length === 0) return null;

  const totals = rows.reduce(
    (acc, row) => {
      acc.issuedQty += toNumber(row.issued_qty);
      acc.requiredQty += toNumber(row.required_qty);
      return acc;
    },
    { issuedQty: 0, requiredQty: 0 }
  );

  if (totals.issuedQty > 0) {
    return {
      code: 'ORDER_DETAIL_HAS_ISSUED_JOB_CARDS',
      message:
        'This product has issued job-card work. Cancel or reverse the issued job cards before removing the product from the order.',
      work_pool_rows: rows.length,
      issued_qty: totals.issuedQty,
      required_qty: totals.requiredQty,
    };
  }

  return {
    code: 'ORDER_DETAIL_HAS_WORK_POOL',
    message:
      'This product still has generated work-pool rows. Clear those work-pool rows before removing the product from the order.',
    work_pool_rows: rows.length,
    issued_qty: 0,
    required_qty: totals.requiredQty,
  };
}
