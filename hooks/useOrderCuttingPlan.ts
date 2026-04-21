'use client';

import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import type {
  AggregateResponse,
  CuttingPlan,
} from '@/lib/orders/cutting-plan-types';

export function useOrderCuttingPlan(orderId: number) {
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);

  const planQuery = useQuery({
    queryKey: ['order-cutting-plan', orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('cutting_plan')
        .eq('order_id', orderId)
        .maybeSingle();
      if (error) throw new Error('Failed to fetch cutting plan');
      return (data?.cutting_plan ?? null) as CuttingPlan | null;
    },
  });

  // Fetch aggregated cutlist data for packing
  const aggregate = useCallback(async (): Promise<AggregateResponse> => {
    const res = await authorizedFetch(
      `/api/orders/${orderId}/cutting-plan/aggregate`
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to aggregate cutlist data');
    }
    return res.json();
  }, [orderId]);

  // Confirm (save) the cutting plan
  const confirm = useCallback(
    async (plan: CuttingPlan) => {
      setIsSaving(true);
      try {
        const res = await authorizedFetch(
          `/api/orders/${orderId}/cutting-plan`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(plan),
          }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (body.code === 'REVISION_MISMATCH') {
            throw new Error(
              'Order has changed since the cutting plan was generated. Please re-generate.'
            );
          }
          throw new Error(body.error || 'Failed to save cutting plan');
        }
        // Invalidate related queries — line-material-cost badges depend on
        // cutting_plan.line_allocations, so they must refetch after a new plan is saved.
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['order-cutting-plan', orderId] }),
          queryClient.invalidateQueries({ queryKey: ['order-components', orderId] }),
          queryClient.invalidateQueries({ queryKey: ['component-suppliers', orderId] }),
          queryClient.invalidateQueries({ queryKey: ['order-line-material-cost', orderId] }),
        ]);
      } finally {
        setIsSaving(false);
      }
    },
    [orderId, queryClient]
  );

  // Clear the cutting plan
  const clear = useCallback(async () => {
    const res = await authorizedFetch(
      `/api/orders/${orderId}/cutting-plan`,
      { method: 'DELETE' }
    );
    if (!res.ok) throw new Error('Failed to clear cutting plan');
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['order-cutting-plan', orderId] }),
      queryClient.invalidateQueries({ queryKey: ['order-line-material-cost', orderId] }),
    ]);
  }, [orderId, queryClient]);

  return {
    plan: planQuery.data ?? null,
    isLoading: planQuery.isLoading,
    isSaving,
    aggregate,
    confirm,
    clear,
    refetch: planQuery.refetch,
  };
}
