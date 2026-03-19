/**
 * Shared procurement quantity helpers.
 *
 * Used by both the inline expand panel (app/orders/page.tsx)
 * and the full Procurement tab (components/features/orders/ProcurementTab.tsx).
 */

/** Minimum fields required by the quantity helpers. */
export interface ProcurementQuantities {
  order_quantity: number;
  total_received: number;
  quantity_for_order: number;
  received_quantity: number | null;
}

/**
 * Effective quantity for this order's allocation.
 * When a PO line is split across multiple orders, `quantity_for_order` holds
 * the portion allocated to *this* customer order, which may be less than the
 * full PO line `order_quantity`.
 */
export function effectiveQty(line: ProcurementQuantities): number {
  return line.quantity_for_order > 0 ? line.quantity_for_order : line.order_quantity;
}

/**
 * Effective received:
 * - If allocation tracking is available, use it directly.
 * - Otherwise, fall back to capped PO-line received quantity.
 */
export function effectiveReceived(line: ProcurementQuantities): number {
  if (line.received_quantity !== null) {
    return line.received_quantity;
  }
  const qty = effectiveQty(line);
  return Math.min(line.total_received, qty);
}
