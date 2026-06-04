import type { StockSelectableItem } from '@/components/features/shared/StockItemSelectionDialog';

/**
 * Raw inventory row shape returned by {@link fetchAllInventoryComponentRows}
 * (in `inventory.ts`) before it is mapped to the picker's selectable item.
 *
 * Kept here — alongside the pure mapping logic and free of any value imports —
 * so the load-bearing availability arithmetic can be unit-tested without
 * dragging in the Supabase client or the picker React component.
 */
export interface InventoryComponentRow {
  component_id: number;
  quantity_on_hand: number | null;
  quantity_reserved: number | null;
  component:
    | { component_id: number; internal_code: string | null; description: string | null }
    | { component_id: number; internal_code: string | null; description: string | null }[]
    | null;
}

/**
 * Pickable availability for one inventory row: on-hand minus the hard picking
 * hold (`inventory.quantity_reserved`). Null/undefined reserved counts as 0.
 *
 * Deliberately NOT floored at 0 — a negative result means more is held than is
 * on hand, and the picker must surface that over-issue rather than hide it.
 */
export function computeAvailableQuantity(
  onHand: number | null | undefined,
  reserved: number | null | undefined,
): number {
  return Number(onHand || 0) - Number(reserved || 0);
}

/**
 * Maps raw inventory rows to the picker's {@link StockSelectableItem} shape:
 * unwraps the (possibly array) component embed, drops rows without a component
 * id, and sorts by display name. Shared by every consumer of the stock picker.
 */
export function toStockSelectableItems(rows: InventoryComponentRow[]): StockSelectableItem[] {
  return rows
    .map((item): StockSelectableItem | null => {
      const component = Array.isArray(item.component) ? item.component[0] : item.component;
      const componentId = Number(item.component_id || component?.component_id || 0);
      if (!componentId) return null;
      return {
        component_id: componentId,
        internal_code: component?.internal_code || 'Unknown',
        description: component?.description || null,
        available_quantity: computeAvailableQuantity(item.quantity_on_hand, item.quantity_reserved),
        quantity_reserved: item.quantity_reserved,
      };
    })
    .filter((item): item is StockSelectableItem => item !== null)
    .sort((a, b) => (a.description || a.internal_code).localeCompare(b.description || b.internal_code));
}
