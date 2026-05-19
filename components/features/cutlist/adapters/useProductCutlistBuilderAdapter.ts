'use client';

import { useCallback } from 'react';

import type { CutlistCalculatorData } from '@/components/features/cutlist/CutlistCalculator';
import type { CutlistCostingSnapshot } from '@/lib/cutlist/costingSnapshot';
import type { CompactPart } from '@/components/features/cutlist/primitives/CompactPartsTable';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { effectiveBomItemsToSeedRows, type CutlistCalculatorInitialData } from '@/lib/cutlist/calculatorData';
import { effectiveBomRowsToCompactParts } from '@/lib/cutlist/effectiveBomSeed';
import { loadProductCutlistData } from '@/lib/cutlist/productCutlistLoader';
import {
  flattenGroupsToCompactParts,
  regroupPartsToApiGroups,
} from '@/lib/configurator/cutlistGroupConversion';
import { useDebouncedAsyncCallback } from './shared';

export function useProductCutlistBuilderAdapter(productId: number | null | undefined) {
  const load = useCallback(async (): Promise<CutlistCalculatorInitialData | null> => {
    if (!productId || Number.isNaN(productId)) {
      return null;
    }

    const data = await loadProductCutlistData(productId);

    if (data.source === 'groups') {
      return { parts: flattenGroupsToCompactParts(data.groups as never[]) };
    }

    if (data.source === 'bom') {
      const bomSeedRows = effectiveBomItemsToSeedRows(data.bomItems as unknown as Record<string, unknown>[]);
      const parts = effectiveBomRowsToCompactParts(bomSeedRows);
      return parts.length > 0 ? { parts } : null;
    }

    return null;
  }, [productId]);

  const save = useCallback(async (data: CutlistCalculatorData): Promise<void> => {
    if (!productId || Number.isNaN(productId)) {
      return;
    }

    const groups = regroupPartsToApiGroups(data.parts, data.primaryBoards);
    const res = await authorizedFetch(
      `/api/products/${productId}/cutlist-groups?module=${MODULE_KEYS.CUTLIST_OPTIMIZER}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups }),
      }
    );

    if (!res.ok) {
      throw new Error('Failed to save cutlist');
    }
  }, [productId]);

  const { debounced: debouncedSave, cancelPending: cancelPendingSave } =
    useDebouncedAsyncCallback(save, 2000);

  const saveSnapshot = useCallback(async (
    snapshotData: CutlistCostingSnapshot,
    partsHash: string,
    parts: CompactPart[],
  ): Promise<void> => {
    if (!productId || Number.isNaN(productId)) return;

    // Send the parts array alongside parts_hash so the server can
    // recompute the hash and reject fabricated or stale-tab values.
    const res = await authorizedFetch(
      `/api/products/${productId}/cutlist-costing-snapshot?module=${MODULE_KEYS.CUTLIST_OPTIMIZER}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot_data: snapshotData, parts_hash: partsHash, parts }),
      }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to save costing snapshot: ${res.status} ${text}`);
    }
  }, [productId]);

  const loadSnapshot = useCallback(async (): Promise<CutlistCostingSnapshot | null> => {
    if (!productId || Number.isNaN(productId)) return null;

    const res = await authorizedFetch(
      `/api/products/${productId}/cutlist-costing-snapshot?module=${MODULE_KEYS.CUTLIST_OPTIMIZER}`
    );
    if (!res.ok) return null;

    const json = (await res.json()) as { snapshot: { snapshot_data: CutlistCostingSnapshot } | null };
    return json.snapshot?.snapshot_data ?? null;
  }, [productId]);

  return {
    load,
    save,
    debouncedSave,
    cancelPendingSave,
    saveSnapshot,
    loadSnapshot,
  };
}

export default useProductCutlistBuilderAdapter;
