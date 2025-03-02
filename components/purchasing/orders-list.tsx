'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { SupplierOrderWithDetails } from '@/types/purchasing';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useState } from 'react';

// Fetch supplier orders with details
async function fetchSupplierOrders(statusFilter?: string): Promise<SupplierOrderWithDetails[]> {
  let query = supabase
    .from('supplier_orders')
    .select(`
      *,
      status:supplier_order_statuses(status_id, status_name),
      supplierComponent:suppliercomponents(
        *,
        component:components(component_id, internal_code, description),
        supplier:suppliers(supplier_id, name)
      )
    `)
    .order('order_date', { ascending: false });

  // Apply status filter if provided
  if (statusFilter && statusFilter !== 'all') {
    // Join with status table to filter by status name
    query = query.eq('status.status_name', statusFilter);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching supplier orders:', error);
    throw new Error('Failed to fetch supplier orders');
  }

  return data as SupplierOrderWithDetails[];
}

// Status badge component
function StatusBadge({ status }: { status: string }) {
  let variant: 'default' | 'destructive' | 'outline' | 'secondary' | null = null;
  
  switch (status.toLowerCase()) {
    case 'open':
      variant = 'secondary';
      break;
    case 'in progress':
      variant = 'default';
      break;
    case 'completed':
      variant = 'outline';
      break;
    case 'cancelled':
      variant = 'destructive';
      break;
    default:
      variant = 'secondary';
  }
  
  return <Badge variant={variant}>{status}</Badge>;
}

export function PurchasingOrdersList() {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  
  const { data: orders, isLoading, error } = useQuery({
    queryKey: ['supplierOrders', statusFilter],
    queryFn: () => fetchSupplierOrders(statusFilter),
  });

  // Filter options
  const statusOptions = [
    { value: 'all', label: 'All Statuses' },
    { value: 'Open', label: 'Open' },
    { value: 'In Progress', label: 'In Progress' },
    { value: 'Completed', label: 'Completed' },
    { value: 'Cancelled', label: 'Cancelled' },
  ];

  return (
    <div className="space-y-4">
      <div className="p-4 border-b">
        <div className="flex items-center gap-4">
          <label htmlFor="status-filter" className="text-sm font-medium">
            Filter by Status:
          </label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:w-[200px]"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="p-8 text-center">Loading supplier orders...</div>
      ) : error ? (
        <div className="p-8 text-center text-destructive">
          Error loading orders. Please try again.
        </div>
      ) : orders && orders.length > 0 ? (
        <div className="relative overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order ID</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Component</TableHead>
                <TableHead>Order Qty</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Order Date</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.order_id}>
                  <TableCell className="font-medium">#{order.order_id}</TableCell>
                  <TableCell>{order.supplierComponent.supplier.name}</TableCell>
                  <TableCell>
                    {order.supplierComponent.component.internal_code}
                    <div className="text-xs text-muted-foreground mt-1">
                      {order.supplierComponent.component.description}
                    </div>
                  </TableCell>
                  <TableCell>{order.order_quantity}</TableCell>
                  <TableCell>{order.total_received}</TableCell>
                  <TableCell>
                    <StatusBadge status={order.status.status_name} />
                  </TableCell>
                  <TableCell>
                    {format(new Date(order.order_date), 'MMM d, yyyy')}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/purchasing/${order.order_id}`}
                      className="text-primary hover:underline text-sm flex items-center"
                    >
                      View Details
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="p-8 text-center">
          No supplier orders found. Create a new order to get started.
        </div>
      )}
    </div>
  );
} 