'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { Order, OrderStatus } from '@/types/orders';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { PlusCircle } from 'lucide-react';

// Fetch orders with status and customer information
async function fetchOrders(statusFilter?: string): Promise<Order[]> {
  let query = supabase
    .from('orders')
    .select(`
      *,
      status:order_statuses(status_id, status_name),
      customer:customers(*)
    `)
    .order('created_at', { ascending: false });

  // Apply status filter if provided
  if (statusFilter && statusFilter !== 'all') {
    query = query.eq('status.status_name', statusFilter);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching orders:', error);
    throw new Error('Failed to fetch orders');
  }

  return data as Order[];
}

// Fetch all order statuses
async function fetchOrderStatuses(): Promise<OrderStatus[]> {
  const { data, error } = await supabase
    .from('order_statuses')
    .select('*');

  if (error) {
    console.error('Error fetching order statuses:', error);
    throw new Error('Failed to fetch order statuses');
  }

  return data as OrderStatus[];
}

// Status Badge component
function StatusBadge({ status }: { status: string }) {
  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'new':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'in progress':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'completed':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'cancelled':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(status)}`}>
      {status}
    </span>
  );
}

export default function OrdersPage() {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  
  // Fetch order statuses for filter dropdown
  const { data: statuses } = useQuery({
    queryKey: ['orderStatuses'],
    queryFn: fetchOrderStatuses,
  });

  // Fetch orders with optional filter
  const { data: orders, isLoading, error } = useQuery({
    queryKey: ['orders', statusFilter],
    queryFn: () => fetchOrders(statusFilter),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Orders</h1>
        <Link href="/orders/new">
          <Button>
            <PlusCircle className="h-4 w-4 mr-2" />
            New Order
          </Button>
        </Link>
      </div>

      <div className="space-y-4">
        <div className="p-4 border-b">
          <div className="flex items-center gap-4">
            <Label htmlFor="status-filter" className="text-sm font-medium">
              Filter by Status:
            </Label>
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value)}
            >
              <SelectTrigger id="status-filter" className="w-[200px]">
                <SelectValue placeholder="Select a status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {statuses?.map((status) => (
                  <SelectItem key={status.status_id} value={status.status_name}>
                    {status.status_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
          <div className="p-8 text-center">Loading orders...</div>
        ) : error ? (
          <div className="p-8 text-center text-destructive">
            Error loading orders. Please try again.
          </div>
        ) : orders && orders.length > 0 ? (
          <div className="relative overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Delivery Date</TableHead>
                  <TableHead>Total Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.order_id}>
                    <TableCell className="font-medium">
                      {order.order_number || `#${order.order_id}`}
                    </TableCell>
                    <TableCell>{order.customer?.name || 'N/A'}</TableCell>
                    <TableCell>
                      {format(new Date(order.created_at), 'MMM d, yyyy')}
                    </TableCell>
                    <TableCell>
                      {order.delivery_date 
                        ? format(new Date(order.delivery_date), 'MMM d, yyyy')
                        : 'Not set'}
                    </TableCell>
                    <TableCell>
                      {order.total_amount
                        ? `$${order.total_amount.toFixed(2)}`
                        : 'N/A'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={order.status?.status_name || 'Unknown'} />
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/orders/${order.order_id}`}
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
            No orders found. Create a new order to get started.
          </div>
        )}
      </div>
    </div>
  );
} 