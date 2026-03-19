import { SO_STATUS } from '@/types/purchasing';

type NumericLike = number | string | null | undefined;

type LowStockLike = {
  quantity_on_hand?: NumericLike;
  reorder_level?: NumericLike;
};

type SupplierOrderLineLike = {
  order_quantity?: NumericLike;
  total_received?: NumericLike;
};

type PurchaseOrderLike = {
  status_id?: NumericLike;
  supplier_orders?: SupplierOrderLineLike[] | null;
};

const CLOSED_PURCHASE_ORDER_STATUSES = new Set<number>([
  SO_STATUS.CANCELLED,
  SO_STATUS.COMPLETED,
  SO_STATUS.FULLY_RECEIVED,
]);

function toNumberValue(value: NumericLike) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isLowStockItem(item: LowStockLike) {
  const reorderLevel = toNumberValue(item.reorder_level);
  return reorderLevel > 0 && toNumberValue(item.quantity_on_hand) <= reorderLevel;
}

export function hasOutstandingQuantity(line: SupplierOrderLineLike) {
  return toNumberValue(line.order_quantity) - toNumberValue(line.total_received) > 0;
}

export function isOpenPurchaseOrder(order: PurchaseOrderLike) {
  const statusId = toNumberValue(order.status_id);
  if (CLOSED_PURCHASE_ORDER_STATUSES.has(statusId)) {
    return false;
  }

  const supplierOrders = Array.isArray(order.supplier_orders)
    ? order.supplier_orders
    : [];

  if (supplierOrders.length === 0) {
    return true;
  }

  return supplierOrders.some(hasOutstandingQuantity);
}
