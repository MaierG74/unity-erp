import { supabase } from '@/lib/supabase';
import { fetchAllPages } from '@/lib/db/paginate';
import type { StockSelectableItem } from '@/components/features/shared/StockItemSelectionDialog';

export interface InventoryComponentRow {
  component_id: number;
  internal_code: string | null;
  description: string | null;
  is_active: boolean | null;
  inventory:
    | { component_id: number; quantity_on_hand: number | null }
    | { component_id: number; quantity_on_hand: number | null }[]
    | null;
}

const INVENTORY_COMPONENT_SELECT =
  'component_id, internal_code, description, is_active, inventory(component_id, quantity_on_hand)';

export const STOCK_PICKER_QUERY_KEY = ['inventory', 'stock-picker-items'] as const;

/**
 * Fetches every active component with optional inventory availability for the
 * stock picker.
 *
 * Pages past Supabase's `max-rows` cap (see {@link fetchAllPages}) so the picker
 * never silently drops items once the component catalog grows beyond a single
 * page. Ordered by `component_id` purely for stable pagination; callers re-sort
 * for display.
 */
export async function fetchAllInventoryComponentRows(): Promise<InventoryComponentRow[]> {
  return fetchAllPages<InventoryComponentRow>(async (from, to) => {
    const { data, error, count } = await supabase
      .from('components')
      .select(INVENTORY_COMPONENT_SELECT, from === 0 ? { count: 'exact' } : undefined)
      .or('is_active.is.null,is_active.eq.true')
      .order('component_id', { ascending: true })
      .range(from, to);
    if (error) throw error;
    return { rows: (data ?? []) as InventoryComponentRow[], total: count ?? null };
  });
}

/**
 * Maps raw inventory rows to the picker's {@link StockSelectableItem} shape:
 * unwraps the optional inventory embed, drops rows without a component id, and
 * sorts by display name. Shared by every consumer of the stock picker.
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
        available_quantity: Number(inventory?.quantity_on_hand || 0),
        has_inventory_record: Boolean(inventory),
      };
    })
    .filter((item): item is StockSelectableItem => item !== null)
    .sort((a, b) => (a.description || a.internal_code).localeCompare(b.description || b.internal_code));
}
