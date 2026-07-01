// Shared order-status display adapter (round-2 MAJOR #4).
// status_id=1 is "Ready For Delivery" for customer orders; for internal orders the same state
// means "ready to receive into stock". Every user-facing status display must route through this
// helper rather than reading order_statuses.status_name directly.

export type OrderTypeValue = 'customer' | 'internal';

export interface OrderStatusLabelInput {
  order_type?: OrderTypeValue | null;
  status_id?: number | null;
  status_name?: string | null;
}

export function getOrderStatusLabel(order: OrderStatusLabelInput): string {
  if (order?.status_id === 1) {
    return order?.order_type === 'internal' ? 'Ready to receive into stock' : 'Ready For Delivery';
  }
  return order?.status_name ?? '';
}
