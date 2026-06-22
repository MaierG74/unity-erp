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
  internal_code: string | null;
  description: string | null;
  is_active: boolean | null;
  inventory:
    | { component_id: number; quantity_on_hand: number | null; quantity_reserved: number | null }
    | { component_id: number; quantity_on_hand: number | null; quantity_reserved: number | null }[]
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
      const inventory = Array.isArray(item.inventory) ? item.inventory[0] : item.inventory;
      const componentId = Number(item.component_id || 0);
      if (!componentId) return null;
      return {
        component_id: componentId,
        internal_code: item.internal_code || 'Unknown',
        description: item.description || null,
        available_quantity: computeAvailableQuantity(inventory?.quantity_on_hand, inventory?.quantity_reserved),
        has_inventory_record: Boolean(inventory),
        quantity_reserved: inventory?.quantity_reserved ?? null,
      };
    })
    .filter((item): item is StockSelectableItem => item !== null)
    .sort((a, b) => (a.description || a.internal_code).localeCompare(b.description || b.internal_code));
}
