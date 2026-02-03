/**
 * Cutlist Persistence Adapters
 *
 * These adapters implement the CutlistPersistenceAdapter interface from CutlistWorkspace
 * to support different storage backends:
 *
 * - useLocalStorageAdapter: For standalone /cutlist page, persists to browser localStorage
 * - useQuoteCutlistAdapter: For quote modal, persists to quote_item_cutlists table via API
 * - useProductCutlistAdapter: For product BOM, persists to product_cutlist_groups table via API
 *
 * @example
 * ```tsx
 * // Standalone page with localStorage
 * const adapter = useLocalStorageAdapter({ storageKey: 'my-cutlist' });
 *
 * // Quote modal with API persistence
 * const adapter = useQuoteCutlistAdapter(quoteItemId);
 *
 * // Product BOM with API persistence
 * const adapter = useProductCutlistAdapter(productId);
 *
 * <CutlistWorkspace persistenceAdapter={adapter} />
 * ```
 */

export { useLocalStorageAdapter } from './useLocalStorageAdapter';
export type { UseLocalStorageAdapterOptions } from './useLocalStorageAdapter';

export { useQuoteCutlistAdapter } from './useQuoteCutlistAdapter';
export type { UseQuoteCutlistAdapterOptions } from './useQuoteCutlistAdapter';

export { useProductCutlistAdapter } from './useProductCutlistAdapter';
export type { UseProductCutlistAdapterOptions } from './useProductCutlistAdapter';

export { useQuoteCutlistAdapterV2 } from './useQuoteCutlistAdapterV2';
export type { QuoteCutlistLayoutV2 } from './useQuoteCutlistAdapterV2';
