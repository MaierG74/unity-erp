'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { PurchaseOrder } from '@/types/purchasing';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

// Status badge component
const StatusBadge = ({ status }: { status: string }) => {
  switch (status.toLowerCase()) {
    case 'draft':
      return <Badge variant="outline" className="bg-slate-100 text-slate-700">Draft</Badge>;
    case 'pending approval':
      return <Badge className="bg-amber-100 text-amber-700 border-amber-200">Pending Approval</Badge>;
    case 'open':
      return <Badge className="bg-blue-100 text-blue-700 border-blue-200">Open</Badge>;
    case 'partially delivered':
      return <Badge className="bg-blue-500 text-white">Partially Delivered</Badge>;
    case 'completed':
      return <Badge className="bg-green-500 text-white">Completed</Badge>;
    case 'cancelled':
      return <Badge variant="destructive">Cancelled</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
};

async function fetchPurchaseOrders() {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select(`
      *,
      status:supplier_order_statuses(status_name),
      supplier_orders(
        order_id,
        order_quantity,
        total_received,
        supplier_component:suppliercomponents(
          supplier:suppliers(name),
          component:components(internal_code, description)
        )
      )
    `)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching purchase orders:', error);
    throw new Error('Failed to fetch purchase orders');
  }

  return data as PurchaseOrder[];
}

export function PurchaseOrdersList() {
  const [statusFilter, setStatusFilter] = useState<string>('All Statuses');

  const { data: purchaseOrders, isLoading, error } = useQuery({
    queryKey: ['purchaseOrders'],
    queryFn: fetchPurchaseOrders,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center items-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center">
        <p className="text-destructive">Failed to load purchase orders</p>
        <p className="text-sm text-muted-foreground mt-2">Please try again later</p>
      </div>
    );
  }

  const filteredOrders = statusFilter === 'All Statuses'
    ? purchaseOrders
    : purchaseOrders?.filter(order => order.status.status_name === statusFilter);

  return (
    <div>
      <div className="p-4 border-b">
        <div className="flex items-center gap-2">
          <span className="text-sm">Filter by Status:</span>
          <select
            className="h-8 rounded-md border border-input bg-background px-3 py-1 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option>All Statuses</option>
            <option>Draft</option>
            <option>Pending Approval</option>
            <option>Open</option>
            <option>Partially Delivered</option>
            <option>Completed</option>
            <option>Cancelled</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="px-4 py-3 text-left font-medium text-sm">Q Number</th>
              <th className="px-4 py-3 text-left font-medium text-sm">Items</th>
              <th className="px-4 py-3 text-left font-medium text-sm">Created</th>
              <th className="px-4 py-3 text-left font-medium text-sm">Status</th>
              <th className="px-4 py-3 text-right font-medium text-sm">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredOrders?.length ? (
              filteredOrders.map((order) => (
                <tr key={order.purchase_order_id} className="border-b hover:bg-muted/50">
                  <td className="px-4 py-3 text-sm">
                    {order.q_number || <span className="text-muted-foreground italic">Not assigned</span>}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {order.supplier_orders?.length ?? 0} item{(order.supplier_orders?.length ?? 0) !== 1 ? 's' : ''}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {format(new Date(order.created_at), 'MMM d, yyyy')}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <StatusBadge status={order.status.status_name} />
                  </td>
                  <td className="px-4 py-3 text-sm text-right">
                    <Link href={`/purchasing/purchase-orders/${order.purchase_order_id}`}>
                      <Button variant="ghost" size="sm" className="h-8 px-2">
                        View Details
                        <ExternalLink className="ml-1 h-3 w-3" />
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  {statusFilter === 'All Statuses'
                    ? 'No purchase orders found'
                    : `No ${statusFilter.toLowerCase()} purchase orders found`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
} 