import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/common/auth-provider';
import type { ComponentStockSummary } from '@/types/transaction-views';

export function useComponentStockSummary(componentIds: number[]) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['component-stock-summary', componentIds],
    queryFn: async (): Promise<Map<number, ComponentStockSummary>> => {
      if (componentIds.length === 0) return new Map();

      // Fetch current stock
      const { data: inventoryData, error: invError } = await supabase
        .from('inventory')
        .select('component_id, quantity_on_hand')
        .in('component_id', componentIds);
      if (invError) throw invError;

      // Fetch reservations
      const { data: reservationData, error: resError } = await supabase
        .from('component_reservations')
        .select('component_id, qty_reserved')
        .in('component_id', componentIds);
      if (resError) throw resError;

      // Fetch on-order from open supplier orders
      const { data: supplierOrders, error: soError } = await supabase
        .from('supplier_orders')
        .select(`
          order_quantity,
          total_received,
          suppliercomponents!inner (
            component_id
          ),
          status:supplier_order_statuses!inner (
            status_name
          )
        `)
        .in('status.status_name', [
          'Open',
          'In Progress',
          'Approved',
          'Partially Received',
          'Pending Approval',
        ]);
      if (soError) throw soError;

      // Build on-order map
      const onOrderMap = new Map<number, number>();
      if (supplierOrders) {
        supplierOrders.forEach((so: any) => {
          const cid = so.suppliercomponents?.component_id;
          if (cid && componentIds.includes(cid)) {
            const pending = Math.max(0, (so.order_quantity || 0) - (so.total_received || 0));
            if (pending > 0) {
              onOrderMap.set(cid, (onOrderMap.get(cid) || 0) + pending);
            }
          }
        });
      }

      // Build reservations map
      const reservedMap = new Map<number, number>();
      if (reservationData) {
        reservationData.forEach((r: any) => {
          reservedMap.set(
            r.component_id,
            (reservedMap.get(r.component_id) || 0) + (r.qty_reserved || 0)
          );
        });
      }

      // Build result map
      const result = new Map<number, ComponentStockSummary>();
      componentIds.forEach((cid) => {
        const inv = inventoryData?.find((i) => i.component_id === cid);
        result.set(cid, {
          component_id: cid,
          quantityOnHand: inv?.quantity_on_hand ?? 0,
          reserved: reservedMap.get(cid) ?? 0,
          onOrder: onOrderMap.get(cid) ?? 0,
        });
      });

      return result;
    },
    enabled: !!user && componentIds.length > 0,
    staleTime: 30_000,
  });
}
