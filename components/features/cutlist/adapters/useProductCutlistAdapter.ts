'use client';

import { useCallback, useMemo } from 'react';
import type { CutlistPersistenceAdapter, CutlistSnapshot } from '../CutlistWorkspace';
import type {
  CutlistGroup,
  CutlistPart,
  BoardType,
  GrainOrientation,
} from '@/lib/cutlist/types';

/**
 * Options for the product cutlist persistence adapter.
 */
export interface UseProductCutlistAdapterOptions {
  /** Whether to log errors to console (default: true) */
  logErrors?: boolean;
}

/**
 * Database group format returned by the product cutlist API.
 */
interface DatabaseCutlistGroup {
  id: number;
  product_id: number;
  name: string;
  board_type: '16mm' | '32mm-both' | '32mm-backer';
  primary_material_id: number | null;
  primary_material_name: string | null;
  backer_material_id: number | null;
  backer_material_name: string | null;
  parts: CutlistPart[];
  sort_order: number;
}

/**
 * API group format for saving.
 */
interface ApiCutlistGroup {
  name: string;
  board_type: BoardType;
  primary_material_id: string | null;
  primary_material_name: string | null;
  backer_material_id: string | null;
  backer_material_name: string | null;
  parts: CutlistPart[];
  sort_order: number;
}

interface ProductCutlistResponse {
  groups?: DatabaseCutlistGroup[];
}

// Special group name for storing ungrouped parts
const UNGROUPED_GROUP_NAME = '__ungrouped__';

/**
 * Convert database group format to CutlistGroup format.
 */
function dbGroupToCutlistGroup(dbGroup: DatabaseCutlistGroup): CutlistGroup {
  return {
    id: `db-${dbGroup.id}`,
    name: dbGroup.name,
    boardType: dbGroup.board_type,
    primaryMaterialId: dbGroup.primary_material_id?.toString(),
    primaryMaterialName: dbGroup.primary_material_name || undefined,
    backerMaterialId: dbGroup.backer_material_id?.toString(),
    backerMaterialName: dbGroup.backer_material_name || undefined,
    parts: dbGroup.parts || [],
  };
}

/**
 * Convert CutlistGroup format to API format.
 */
function cutlistGroupToApiGroup(group: CutlistGroup, index: number): ApiCutlistGroup {
  return {
    name: group.name,
    board_type: group.boardType,
    primary_material_id: group.primaryMaterialId || null,
    primary_material_name: group.primaryMaterialName || null,
    backer_material_id: group.backerMaterialId || null,
    backer_material_name: group.backerMaterialName || null,
    parts: group.parts,
    sort_order: index,
  };
}

/**
 * Hook that returns a CutlistPersistenceAdapter for product cutlist groups.
 *
 * Uses the /api/products/[productId]/cutlist-groups endpoint for persistence.
 * Suitable for the product BOM context where cutlist groups are stored per product.
 *
 * Note: This adapter uses grouped mode, storing both groups and ungrouped parts.
 * The ungrouped parts are stored as a special group with name '__ungrouped__'.
 *
 * @param productId - The product ID to persist cutlist groups for
 * @param options - Optional configuration
 *
 * @example
 * ```tsx
 * const adapter = useProductCutlistAdapter('123');
 * <CutlistWorkspace
 *   mode="grouped"
 *   persistenceAdapter={adapter}
 * />
 * ```
 */
export function useProductCutlistAdapter(
  productId: string | number | null | undefined,
  options: UseProductCutlistAdapterOptions = {}
): CutlistPersistenceAdapter {
  const { logErrors = true } = options;

  // Normalize productId to string
  const productIdStr = productId != null ? String(productId) : null;

  const load = useCallback(async (): Promise<CutlistSnapshot | null> => {
    if (!productIdStr) {
      return null;
    }

    try {
      const res = await fetch(`/api/products/${productIdStr}/cutlist-groups`, {
        cache: 'no-store',
      });

      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || `Failed to load cutlist groups (${res.status})`);
      }

      const json = (await res.json()) as ProductCutlistResponse;
      const dbGroups = json?.groups;

      if (!dbGroups || dbGroups.length === 0) {
        return null;
      }

      // Separate ungrouped parts (stored as special group) from regular groups
      const ungroupedGroup = dbGroups.find((g) => g.name === UNGROUPED_GROUP_NAME);
      const regularGroups = dbGroups.filter((g) => g.name !== UNGROUPED_GROUP_NAME);

      // Convert database groups to CutlistGroup format
      const groups: CutlistGroup[] = regularGroups.map(dbGroupToCutlistGroup);

      // Extract ungrouped parts
      const ungroupedParts: CutlistPart[] = ungroupedGroup?.parts || [];

      // Build snapshot with grouped mode defaults
      const snapshot: CutlistSnapshot = {
        parts: [], // Manual mode parts not used in grouped mode
        groups,
        ungroupedParts,
        stock: [{ id: 'S1', length_mm: 2750, width_mm: 1830, qty: 10, kerf_mm: 4 }],
        materials: [], // Materials are set per-group in product mode
        costing: {
          primarySheetDescription: 'MELAMINE SHEET',
          primaryPricePerSheet: '',
          backerSheetDescription: 'BACKER BOARD',
          backerPricePerSheet: '',
          bandingDesc16: 'EDGE BANDING 16mm (m)',
          bandingPrice16: '',
          bandingDesc32: 'EDGE BANDING 32mm (m)',
          bandingPrice32: '',
        },
        components: {
          primary: null,
          backer: null,
          band16: null,
          band32: null,
        },
        options: {
          kerf: 4,
          allowRotation: true,
          singleSheetOnly: false,
        },
        inputMode: 'grouped', // Product cutlist uses grouped mode
      };

      return snapshot;
    } catch (err) {
      if (logErrors) {
        console.warn(`[useProductCutlistAdapter] Failed to load cutlist for product "${productIdStr}"`, err);
      }
      return null;
    }
  }, [productIdStr, logErrors]);

  const save = useCallback(async (snapshot: CutlistSnapshot): Promise<void> => {
    if (!productIdStr) {
      return;
    }

    try {
      // Build groups array including ungrouped parts as a special group
      const allGroups: ApiCutlistGroup[] = snapshot.groups.map(cutlistGroupToApiGroup);

      // Add ungrouped parts as a special group if there are any
      if (snapshot.ungroupedParts.length > 0) {
        allGroups.push({
          name: UNGROUPED_GROUP_NAME,
          board_type: '16mm',
          primary_material_id: null,
          primary_material_name: null,
          backer_material_id: null,
          backer_material_name: null,
          parts: snapshot.ungroupedParts,
          sort_order: 9999, // Put at end
        });
      }

      const res = await fetch(`/api/products/${productIdStr}/cutlist-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups: allGroups }),
      });

      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || `Failed to save cutlist groups (${res.status})`);
      }
    } catch (err) {
      if (logErrors) {
        console.warn(`[useProductCutlistAdapter] Failed to save cutlist for product "${productIdStr}"`, err);
      }
      // Don't throw - save errors shouldn't break the UI
    }
  }, [productIdStr, logErrors]);

  const adapter = useMemo(
    (): CutlistPersistenceAdapter => ({
      load,
      save,
    }),
    [load, save]
  );

  return adapter;
}

export default useProductCutlistAdapter;
