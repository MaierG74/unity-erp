'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { productCutlistDataKey } from '@/hooks/useProductCutlistData';
import { productCutlistSnapshotKey } from '@/hooks/useProductCutlistSnapshot';
import { productPricingKey } from '@/hooks/useProductPricing';

function invalidateProductQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  productId: number
) {
  queryClient.invalidateQueries({ queryKey: ['product', productId] });
  queryClient.invalidateQueries({ queryKey: productPricingKey(productId) });
  queryClient.invalidateQueries({ queryKey: productCutlistDataKey(productId) });
  queryClient.invalidateQueries({ queryKey: productCutlistSnapshotKey(productId) });
  queryClient.invalidateQueries({ queryKey: ['cutlist-costing-snapshot', productId] });
  queryClient.invalidateQueries({ queryKey: ['cutlist-groups-costing', productId] });
  queryClient.invalidateQueries({ queryKey: ['product-piecework-labor', productId] });
  queryClient.invalidateQueries({ queryKey: ['costing-bom', productId] });
  queryClient.invalidateQueries({ queryKey: ['effective-bom', productId] });
  queryClient.invalidateQueries({ queryKey: ['cutlist-effective-bom', productId] });
  queryClient.invalidateQueries({ queryKey: ['costing-bol', productId] });
  queryClient.invalidateQueries({ queryKey: ['effective-bol', productId] });
  queryClient.invalidateQueries({ queryKey: ['product-overhead', productId] });
  queryClient.invalidateQueries({ queryKey: ['productBOM', productId] });
  queryClient.invalidateQueries({ queryKey: ['productBOL', productId] });
  queryClient.invalidateQueries({ queryKey: ['product-reports', productId] });
}

export function useProductRealtime(productId: number | null | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!productId || !Number.isFinite(productId)) return;

    const filter = `product_id=eq.${productId}`;
    const invalidate = () => invalidateProductQueries(queryClient, productId);

    const channel = supabase
      .channel(`product-${productId}-sync`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'products', filter },
        invalidate,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'product_prices', filter },
        invalidate,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'billofmaterials', filter },
        invalidate,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'billoflabour', filter },
        invalidate,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'product_overhead_costs', filter },
        invalidate,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'product_cutlist_groups', filter },
        invalidate,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'product_cutlist_costing_snapshots', filter },
        invalidate,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [productId, queryClient]);
}
