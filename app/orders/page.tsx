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
import { PlusCircle, Search, Package, Layers, Wrench, PaintBucket } from 'lucide-react';
import { motion } from 'framer-motion';

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

// Add function to determine product sections
function determineProductSections(product: any): string[] {
  const sections: string[] = [];
  
  if (product?.name?.toLowerCase().includes('chair') || 
      product?.description?.toLowerCase().includes('upholstery')) {
    sections.push('chair');
  }
  if (product?.description?.toLowerCase().includes('wood')) {
    sections.push('wood');
  }
  if (product?.description?.toLowerCase().includes('steel')) {
    sections.push('steel');
  }
  if (product?.description?.toLowerCase().includes('powder') || 
      product?.description?.toLowerCase().includes('coating')) {
    sections.push('powdercoating');
  }
  
  return sections;
}

export default function OrdersPage() {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [activeSection, setActiveSection] = useState<string | null>(null);
  
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

  // Function to handle section filter clicks
  const handleSectionFilter = (section: string | null) => {
    setActiveSection(section);
  };

  // Filter orders based on section
  const filteredOrders = orders.filter(order => {
    if (!activeSection) return true;
    
    // Check if any product in the order belongs to the selected section
    return order.details?.some(detail => 
      determineProductSections(detail.product).includes(activeSection)
    );
  });

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-8 w-full max-w-full p-6"
    >
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
        <div className="space-y-1">
          <h1 className="text-4xl font-bold tracking-tight">
            Orders
          </h1>
          <p className="text-muted-foreground">
            Manage and track all your manufacturing orders
          </p>
        </div>
        <Link href="/orders/new">
          <Button className="bg-[#F26B3A] hover:bg-[#E25A29] text-white transition-all duration-200 shadow-lg hover:shadow-xl">
            <PlusCircle className="h-4 w-4 mr-2" />
            New Order
          </Button>
        </Link>
      </div>

      {/* Section Filter Pills */}
      <div className="flex flex-wrap gap-3 mb-6">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2 }}
          className="flex flex-wrap gap-2"
        >
          <Button
            variant={activeSection === null ? "outline" : "outline"}
            size="sm"
            onClick={() => handleSectionFilter(null)}
            className={`rounded-full shadow-sm hover:shadow transition-all duration-200 ${
              activeSection === null ? 'bg-[#F26B3A] text-white hover:bg-[#E25A29]' : ''
            }`}
          >
            All Orders
          </Button>
          <Button
            variant={activeSection === 'chair' ? "outline" : "outline"}
            size="sm"
            onClick={() => handleSectionFilter('chair')}
            className={`rounded-full shadow-sm hover:shadow transition-all duration-200 ${
              activeSection === 'chair' ? 'bg-[#F26B3A] text-white hover:bg-[#E25A29]' : ''
            }`}
          >
            <Package className="h-4 w-4 mr-2" />
            Chairs Section
          </Button>
          <Button
            variant={activeSection === 'wood' ? "outline" : "outline"}
            size="sm"
            onClick={() => handleSectionFilter('wood')}
            className={`rounded-full shadow-sm hover:shadow transition-all duration-200 ${
              activeSection === 'wood' ? 'bg-[#F26B3A] text-white hover:bg-[#E25A29]' : ''
            }`}
          >
            <Layers className="h-4 w-4 mr-2" />
            Wood Section
          </Button>
          <Button
            variant={activeSection === 'steel' ? "outline" : "outline"}
            size="sm"
            onClick={() => handleSectionFilter('steel')}
            className={`rounded-full shadow-sm hover:shadow transition-all duration-200 ${
              activeSection === 'steel' ? 'bg-[#F26B3A] text-white hover:bg-[#E25A29]' : ''
            }`}
          >
            <Wrench className="h-4 w-4 mr-2" />
            Steel Section
          </Button>
          <Button
            variant={activeSection === 'powdercoating' ? "outline" : "outline"}
            size="sm"
            onClick={() => handleSectionFilter('powdercoating')}
            className={`rounded-full shadow-sm hover:shadow transition-all duration-200 ${
              activeSection === 'powdercoating' ? 'bg-[#F26B3A] text-white hover:bg-[#E25A29]' : ''
            }`}
          >
            <PaintBucket className="h-4 w-4 mr-2" />
            Powdercoating Section
          </Button>
        </motion.div>
      </div>

      <div className="space-y-6">
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
          className="p-6 border rounded-xl bg-card/50 backdrop-blur-sm shadow-sm"
        >
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
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
                  className="pl-10 w-full transition-all duration-200 focus:ring-2 focus:ring-[#F26B3A]/20"
                />
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.3 }}
        >
          {isLoading ? (
            <div className="p-12 text-center border rounded-xl bg-card/50 backdrop-blur-sm">
              <div className="animate-pulse space-y-3">
                <div className="h-4 bg-muted rounded w-48 mx-auto"></div>
                <div className="h-3 bg-muted rounded w-32 mx-auto"></div>
              </div>
            </div>
          ) : error ? (
            <div className="p-12 text-center text-destructive border rounded-xl bg-destructive/5">
              <p className="font-medium">Error loading orders</p>
              <p className="text-sm text-muted-foreground mt-1">Please try again later</p>
            </div>
          ) : filteredOrders && filteredOrders.length > 0 ? (
            <div className="overflow-hidden border rounded-xl bg-card/50 backdrop-blur-sm shadow-sm">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="font-semibold">Order #</TableHead>
                      <TableHead className="font-semibold">Customer</TableHead>
                      <TableHead className="font-semibold">Created</TableHead>
                      <TableHead className="font-semibold">Delivery Date</TableHead>
                      <TableHead className="font-semibold">Total Amount</TableHead>
                      <TableHead className="font-semibold">Status</TableHead>
                      <TableHead className="font-semibold"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOrders.map((order) => (
                      <TableRow 
                        key={order.order_id}
                        className="hover:bg-muted/50 transition-colors duration-200"
                      >
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
                            className="text-[#F26B3A] hover:text-[#E25A29] hover:underline text-sm flex items-center transition-colors duration-200"
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
            <div className="p-12 text-center border rounded-xl bg-card/50 backdrop-blur-sm">
              <p className="text-muted-foreground">No orders found</p>
              <p className="text-sm text-muted-foreground mt-1">Create a new order to get started</p>
            </div>
          )}
        </motion.div>
      </div>
    </motion.div>
  );
} 