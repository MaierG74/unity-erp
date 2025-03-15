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
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { PlusCircle, Search } from 'lucide-react';

// Fetch orders with status and customer information
async function fetchOrders(statusFilter?: string, searchQuery?: string): Promise<Order[]> {
  try {
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
      // Use a join condition instead of direct equality on nested object
      const { data: statusData } = await supabase
        .from('order_statuses')
        .select('status_id')
        .eq('status_name', statusFilter)
        .single();
      
      if (statusData?.status_id) {
        query = query.eq('status_id', statusData.status_id);
      }
    }

    // Apply search filter if provided
    if (searchQuery) {
      // First, get customers that match the search query
      const { data: customers } = await supabase
        .from('customers')
        .select('id')
        .ilike('name', `%${searchQuery}%`);

      // Get customer IDs for the filter
      const customerIds = customers?.map(c => c.id) || [];

      // Get order numbers that match the search query
      const { data: orderNumbers } = await supabase
        .from('orders')
        .select('order_id')
        .or(`order_number.ilike.%${searchQuery}%, order_id.eq.${!isNaN(parseInt(searchQuery)) ? parseInt(searchQuery) : 0}`);

      // Get order IDs for the filter
      const orderIds = orderNumbers?.map(o => o.order_id) || [];

      // Apply the combined filter if we have any matches
      if (customerIds.length > 0 || orderIds.length > 0) {
        query = query.or(
          `${customerIds.length > 0 ? `customer_id.in.(${customerIds.join(',')})` : ''},` +
          `${orderIds.length > 0 ? `order_id.in.(${orderIds.join(',')})` : ''}`
        );
      } else if (searchQuery.trim() !== '') {
        // If no matches but search query provided, return no results
        return [];
      }
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching orders:', error);
      throw new Error('Failed to fetch orders');
    }

    // Transform the data to ensure proper structure
    return (data || []).map(order => ({
      ...order,
      // Ensure status is properly structured
      status: order.status && order.status.length > 0 
        ? { 
            status_id: order.status[0]?.status_id || 0,
            status_name: order.status[0]?.status_name || 'Unknown'
          }
        : { status_id: 0, status_name: 'Unknown' },
      // Ensure total_amount is a number
      total_amount: order.total_amount ? Number(order.total_amount) : null
    }));
  } catch (error) {
    console.error('Error in fetchOrders:', error);
    return [];
  }
}

// Fetch all order statuses
async function fetchOrderStatuses(): Promise<OrderStatus[]> {
  try {
    const { data, error } = await supabase
      .from('order_statuses')
      .select('*');

    if (error) {
      console.error('Error fetching order statuses:', error);
      throw new Error('Failed to fetch order statuses');
    }

    return data || [];
  } catch (error) {
    console.error('Error in fetchOrderStatuses:', error);
    return [];
  }
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
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  
  // Handle search input change with debounce
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    
    // Debounce search to avoid excessive API calls
    clearTimeout((window as any).searchTimeout);
    (window as any).searchTimeout = setTimeout(() => {
      setDebouncedSearch(e.target.value);
    }, 500);
  };
  
  // Fetch order statuses for filter dropdown
  const { data: statuses = [] } = useQuery({
    queryKey: ['orderStatuses'],
    queryFn: fetchOrderStatuses,
  });

  // Fetch orders with optional filter
  const { data: orders = [], isLoading, error } = useQuery({
    queryKey: ['orders', statusFilter, debouncedSearch],
    queryFn: () => fetchOrders(statusFilter, debouncedSearch),
  });

  return (
    <div className="space-y-6 w-full max-w-full">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Orders</h1>
        <Link href="/orders/new">
          <Button>
            <PlusCircle className="h-4 w-4 mr-2" />
            New Order
          </Button>
        </Link>
      </div>

      <div className="space-y-4">
        <div className="p-4 border rounded-md bg-card">
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <Label htmlFor="status-filter" className="text-sm font-medium">
                Filter by Status:
              </Label>
              <Select
                value={statusFilter}
                onValueChange={(value) => setStatusFilter(value)}
              >
                <SelectTrigger id="status-filter" className="w-full sm:w-[200px]">
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
            
            <div className="flex-1 md:ml-auto">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search orders by number or customer name"
                  value={searchQuery}
                  onChange={handleSearchChange}
                  className="pl-10 w-full"
                />
              </div>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="p-8 text-center border rounded-md">Loading orders...</div>
        ) : error ? (
          <div className="p-8 text-center text-destructive border rounded-md">
            Error loading orders. Please try again.
          </div>
        ) : orders && orders.length > 0 ? (
          <div className="overflow-hidden border rounded-md">
            <div className="overflow-x-auto">
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
                        {order.created_at ? format(new Date(order.created_at), 'MMM d, yyyy') : 'N/A'}
                      </TableCell>
                      <TableCell>
                        {order.delivery_date 
                          ? format(new Date(order.delivery_date), 'MMM d, yyyy')
                          : 'Not set'}
                      </TableCell>
                      <TableCell>
                        {order.total_amount !== null && order.total_amount !== undefined
                          ? `$${Number(order.total_amount).toFixed(2)}`
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
          </div>
        ) : (
          <div className="p-8 text-center border rounded-md">
            No orders found. Create a new order to get started.
          </div>
        )}
      </div>
    </div>
  );
} 