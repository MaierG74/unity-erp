'use client';

import { useQuery } from '@tanstack/react-query';
import {
  loadProductCutlistData,
  type ProductCutlistData,
} from '@/lib/cutlist/productCutlistLoader';

export const productCutlistDataKey = (productId: number) =>
  ['product-cutlist-data', productId] as const;

export function useProductCutlistData(productId: number | null | undefined) {
  return useQuery<ProductCutlistData>({
    queryKey: productCutlistDataKey(productId ?? 0),
    queryFn: () => loadProductCutlistData(productId as number),
    enabled: Boolean(productId && Number.isFinite(productId)),
    retry: 1,
  });
}
