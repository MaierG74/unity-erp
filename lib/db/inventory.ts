import { supabase } from '@/lib/supabase';
import { fetchAllPages } from '@/lib/db/paginate';
import type { StockSelectableItem } from '@/components/features/shared/StockItemSelectionDialog';

export interface InventoryComponentRow {
  component_id: number;
  quantity_on_hand: number | null;
  component:
    | { component_id: number; internal_code: string | null; description: string | null }
    | { component_id: number; internal_code: string | null; description: string | null }[]
    | null;
}

const INVENTORY_COMPONENT_SELECT =
  'component_id, quantity_on_hand, component:components(component_id, internal_code, description)';

/**
 * Fetches every inventory row with its component master for the stock picker.
 *
 * Pages past Supabase's `max-rows` cap (see {@link fetchAllPages}) so the picker
 * never silently drops items once inventory grows beyond a single page. Ordered
 * by `component_id` purely for stable pagination — callers re-sort for display.
 */
export async function fetchAllInventoryComponentRows(): Promise<InventoryComponentRow[]> {
  return fetchAllPages<InventoryComponentRow>(async (from, to) => {
    const { data, error, count } = await supabase
      .from('inventory')
      .select(INVENTORY_COMPONENT_SELECT, from === 0 ? { count: 'exact' } : undefined)
      .order('component_id', { ascending: true })
      .range(from, to);
    if (error) throw error;
    return { rows: (data ?? []) as InventoryComponentRow[], total: count ?? null };
  });
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
        available_quantity: Number(item.quantity_on_hand || 0),
      };
    })
    .filter((item): item is StockSelectableItem => item !== null)
    .sort((a, b) => (a.description || a.internal_code).localeCompare(b.description || b.internal_code));
}
