import { supabase } from '@/lib/supabase';
import { fetchAllPages } from '@/lib/db/paginate';
import type { InventoryComponentRow } from '@/lib/db/inventory-mapping';

// Re-exported so consumers keep importing the row type + pure mapping helpers
// from `@/lib/db/inventory`. The implementations live in `inventory-mapping.ts`
// (value-import-free) so the availability arithmetic stays unit-testable.
export type { InventoryComponentRow } from '@/lib/db/inventory-mapping';
export { computeAvailableQuantity, toStockSelectableItems } from '@/lib/db/inventory-mapping';

const INVENTORY_COMPONENT_SELECT =
  'component_id, internal_code, description, is_active, inventory(component_id, quantity_on_hand, quantity_reserved)';

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
