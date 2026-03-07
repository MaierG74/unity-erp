/**
 * Cutlist Persistence Adapters
 *
 * These adapters provide persistence bridges for the canonical CutlistCalculator flow.
 *
 * Active adapter:
 * - useQuoteCutlistAdapterV2: For quote cutlist pages, persists the CutlistCalculator
 *   layout format to quote_item_cutlists via the quote cutlist API.
 * - useProductCutlistBuilderAdapter: For product cutlist pages, loads/saves
 *   CutlistCalculator parts via product_cutlist_groups and effective BOM seeding.
 *
 * @example
 * ```tsx
 * const adapter = useQuoteCutlistAdapterV2(quoteItemId);
 * const productAdapter = useProductCutlistBuilderAdapter(productId);
 * ```
 */

export { useQuoteCutlistAdapterV2 } from './useQuoteCutlistAdapterV2';
export type { QuoteCutlistLayoutV2 } from './useQuoteCutlistAdapterV2';

export { useProductCutlistBuilderAdapter } from './useProductCutlistBuilderAdapter';
