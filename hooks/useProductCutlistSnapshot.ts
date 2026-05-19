'use client';

import { useQuery } from '@tanstack/react-query';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import { MODULE_KEYS } from '@/lib/modules/keys';
import type { CutlistCostingSnapshot } from '@/lib/cutlist/costingSnapshot';

export const productCutlistSnapshotKey = (productId: number) =>
  ['product-cutlist-snapshot', productId] as const;

export function useProductCutlistSnapshot(productId: number | null | undefined) {
  return useQuery<CutlistCostingSnapshot | null>({
    queryKey: productCutlistSnapshotKey(productId ?? 0),
    queryFn: async () => {
      const res = await authorizedFetch(
        `/api/products/${productId}/cutlist-costing-snapshot?module=${MODULE_KEYS.CUTLIST_OPTIMIZER}`
      );
      if (!res.ok) return null;
      const json = (await res.json()) as {
        snapshot: { snapshot_data: CutlistCostingSnapshot } | null;
      };
      return json.snapshot?.snapshot_data ?? null;
    },
    enabled: Boolean(productId && Number.isFinite(productId)),
    staleTime: 0,
    refetchOnMount: 'always',
    retry: 1,
  });
}
