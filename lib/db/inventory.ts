import { supabase } from '@/lib/supabase';
import { fetchAllPages } from '@/lib/db/paginate';
import type { InventoryComponentRow } from '@/lib/db/inventory-mapping';

// Re-exported so consumers keep importing the row type + pure mapping helpers
// from `@/lib/db/inventory`. The implementations live in `inventory-mapping.ts`
// (value-import-free) so the availability arithmetic stays unit-testable.
export type { InventoryComponentRow } from '@/lib/db/inventory-mapping';
export { computeAvailableQuantity, toStockSelectableItems } from '@/lib/db/inventory-mapping';

const INVENTORY_COMPONENT_SELECT =
  'component_id, quantity_on_hand, quantity_reserved, component:components(component_id, internal_code, description)';

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
