import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authorizedFetch } from '@/lib/client/auth-fetch';

export type ReserveOrderComponentResult = {
  component_id: number;
  qty_reserved: number;
  qty_available: number;
  qty_required: number;
};

export function useReserveOrderComponent(orderId: number) {
  const queryClient = useQueryClient();

  return useMutation<ReserveOrderComponentResult, Error, number>({
    mutationFn: async (componentId: number) => {
      const response = await authorizedFetch(
        `/api/orders/${orderId}/reserve-component/${componentId}`,
        { method: 'POST' }
      );
      if (!response.ok) {
        let message = 'Failed to reserve component';
        try {
          const body = await response.json();
          if (body?.error) message = body.error;
        } catch {
          // fallthrough - keep default message
        }
        throw new Error(message);
      }
      const body = await response.json();
      return body.reservation as ReserveOrderComponentResult;
    },
    onSuccess: (_data, _componentId) => {
      // Invalidate the per-order query keys that source the panel's
      // readiness data so RES / AVAIL / SHORT refresh.
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      queryClient.invalidateQueries({ queryKey: ['orderComponentRequirements', orderId] });
    },
  });
}
