'use client';

import { useCallback } from 'react';

import type { CutlistCalculatorData } from '@/components/features/cutlist/CutlistCalculator';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { effectiveBomItemsToSeedRows, type CutlistCalculatorInitialData } from '@/lib/cutlist/calculatorData';
import { effectiveBomRowsToCompactParts } from '@/lib/cutlist/effectiveBomSeed';
import {
  flattenGroupsToCompactParts,
  regroupPartsToApiGroups,
} from '@/lib/configurator/cutlistGroupConversion';
import { useDebouncedAsyncCallback } from './shared';

interface ProductCutlistGroupsResponse {
  groups?: unknown[];
}

interface EffectiveBomResponse {
  items?: Record<string, unknown>[];
}

export function useProductCutlistBuilderAdapter(productId: number | null | undefined) {
  const load = useCallback(async (): Promise<CutlistCalculatorInitialData | null> => {
    if (!productId || Number.isNaN(productId)) {
      return null;
    }

    const groupsRes = await authorizedFetch(
      `/api/products/${productId}/cutlist-groups?module=${MODULE_KEYS.CUTLIST_OPTIMIZER}`
    );
    if (!groupsRes.ok) {
      throw new Error('Failed to load product cutlist groups');
    }

    const groupsJson = (await groupsRes.json()) as ProductCutlistGroupsResponse;
    const groups = Array.isArray(groupsJson?.groups) ? groupsJson.groups : [];

    if (groups.length > 0) {
      return { parts: flattenGroupsToCompactParts(groups as never[]) };
    }

    const bomRes = await authorizedFetch(`/api/products/${productId}/effective-bom`);
    if (!bomRes.ok) {
      throw new Error('Failed to load effective BOM');
    }

    const bomJson = (await bomRes.json()) as EffectiveBomResponse;
    const items = Array.isArray(bomJson?.items) ? bomJson.items : [];
    const bomSeedRows = effectiveBomItemsToSeedRows(items);
    const parts = effectiveBomRowsToCompactParts(bomSeedRows);

    return parts.length > 0 ? { parts } : null;
  }, [productId]);

  const save = useCallback(async (data: CutlistCalculatorData): Promise<void> => {
    if (!productId || Number.isNaN(productId)) {
      return;
    }

    const groups = regroupPartsToApiGroups(data.parts);
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

  return {
    load,
    save,
    debouncedSave,
    cancelPendingSave,
  };
}

export default useProductCutlistBuilderAdapter;
