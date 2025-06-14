'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { PurchaseOrdersList } from '@/components/purchasing/purchase-orders-list';
import { PlusCircle, ArrowLeft, Search, CalendarIcon, X, ExternalLink, FilterX } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableCell, TableHead, TableRow } from '@/components/ui/table';
import { format, isAfter, isBefore, isValid, parseISO } from 'date-fns';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

interface SupplierOrder {
  order_id: number;
  order_quantity: number;
  total_received: number;
  supplier_component?: {
    supplier?: {
      name: string;
    };
  };
}

interface PurchaseOrder {
  purchase_order_id: number;
  q_number?: string;
  created_at: string;
  status: {
    status_id: number;
    status_name: string;
  };
  supplier_orders: SupplierOrder[];
  suppliers: string[];
}

type OrderTab = 'inProgress' | 'completed';

// Fetch purchase orders
async function fetchPurchaseOrders() {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select(`
      purchase_order_id,
      q_number,
      created_at,
      status_id,
      supplier_order_statuses!purchase_orders_status_id_fkey(
        status_id,
        status_name
      ),
      supplier_orders(
        order_id,
        order_quantity,
        total_received,
        supplier_component:suppliercomponents(
          supplier:suppliers(
            name
          )
        )
      )
    `)
    .order('created_at', { ascending: false });

  if (error) throw error;
  
  // Transform the data to match our types
  return (data as any[]).map(order => ({
    ...order,
    status: order.supplier_order_statuses, // Use the correctly joined status
    supplier_orders: order.supplier_orders || [],
    // Get unique supplier names
    suppliers: Array.from(new Set(
      (order.supplier_orders || [])
        .map((so: SupplierOrder) => so.supplier_component?.supplier?.name)
        .filter(Boolean)
    ))
  })) as PurchaseOrder[];
}

function getOrderStatus(order: PurchaseOrder) {
  if (!order.supplier_orders?.length) return order.status?.status_name || 'Unknown';

  const allReceived = order.supplier_orders.every(
    so => so.order_quantity > 0 && so.total_received === so.order_quantity
  );
  
  const someReceived = order.supplier_orders.some(
    so => (so.total_received || 0) > 0 && so.total_received !== so.order_quantity
  );

  if (order.status?.status_name === 'Approved') {
    if (allReceived) return 'Fully Received';
    if (someReceived) return 'Partially Received';
  }

  return order.status?.status_name || 'Unknown';
}

function isOrderInProgress(status: string): boolean {
  const lowerStatus = status.toLowerCase();
  return (
    lowerStatus === 'draft' ||
    lowerStatus === 'pending approval' ||
    lowerStatus === 'approved' ||
    lowerStatus === 'partially received'
  );
}

function isOrderCompleted(status: string): boolean {
  const lowerStatus = status.toLowerCase();
  return lowerStatus === 'fully received' || lowerStatus === 'cancelled';
}

function StatusBadge({ status, className }: { status: string; className?: string }) {
  let variant: 'default' | 'outline' | 'secondary' | 'destructive' | 'success' = 'default';
  
  switch (status.toLowerCase()) {  // Make case-insensitive
    case 'draft':
      variant = 'secondary';  // Gray
      break;
    case 'pending approval':
    case 'approved':
    case 'partially received':
      variant = 'default';    // Primary color (blue)
      break;
    case 'fully received':
      variant = 'success';    // Green
      break;
    case 'cancelled':
      variant = 'destructive'; // Red
      break;
    default:
      variant = 'outline';    // Gray outline
  }
  
  return (
    <Badge 
      variant={variant} 
      className={cn(
        "text-xs font-medium",
        className
      )}
    >
      {status}
    </Badge>
  );
}

// Format Q number to remove any duplicate "Q" prefix
function formatQNumber(qNumber: string | undefined): string {
  if (!qNumber) return 'Not assigned';
  
  // If the qNumber already starts with 'Q', return as is
  if (qNumber.startsWith('Q')) return qNumber;
  
  // Otherwise add the 'Q' prefix
  return `Q${qNumber}`;
}

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<OrderTab>('inProgress');
  const [qNumberSearch, setQNumberSearch] = useState<string>('');
  const [supplierSearch, setSupplierSearch] = useState<string>('all');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  
  // Fetch all suppliers for the dropdown
  const [uniqueSuppliers, setUniqueSuppliers] = useState<string[]>([]);

  const { data: purchaseOrders } = useQuery({
    queryKey: ['purchaseOrders'],
    queryFn: fetchPurchaseOrders,
  });

  // Extract unique suppliers from orders for the supplier filter dropdown
  useEffect(() => {
    if (purchaseOrders) {
      const allSuppliers = new Set<string>();
      purchaseOrders.forEach(order => {
        order.suppliers.forEach(supplier => {
          if (supplier) allSuppliers.add(supplier);
        });
      });
      setUniqueSuppliers(Array.from(allSuppliers).sort());
    }
  }, [purchaseOrders]);

  // Reset filters function
  const resetFilters = () => {
    setStatusFilter('all');
    setQNumberSearch('');
    setSupplierSearch('all');
    setStartDate(null);
    setEndDate(null);
  };

  // Filter orders based on all filters
  const filteredOrders = purchaseOrders?.filter(order => {
    const orderStatus = getOrderStatus(order);
    
    // First filter by tab
    if (activeTab === 'inProgress' && !isOrderInProgress(orderStatus)) {
      return false;
    }
    if (activeTab === 'completed' && !isOrderCompleted(orderStatus)) {
      return false;
    }
    
    // Then apply status filter if not 'all'
    if (statusFilter !== 'all') {
      switch (statusFilter) {
        case 'draft':
          return orderStatus.toLowerCase() === 'draft';
        case 'pending':
          return orderStatus.toLowerCase() === 'pending approval';
        case 'approved':
          return orderStatus.toLowerCase() === 'approved';
        case 'partial':
          return orderStatus.toLowerCase() === 'partially received';
        case 'complete':
          return orderStatus.toLowerCase() === 'fully received';
        case 'cancelled':
          return orderStatus.toLowerCase() === 'cancelled';
        default:
          return true;
      }
    }
    
    // Filter by Q Number search
    if (qNumberSearch) {
      // If there's a search query but no q_number, exclude this order
      if (!order.q_number) {
        return false;
      }
      
      // Case-insensitive check if q_number includes the search term
      if (!order.q_number.toLowerCase().includes(qNumberSearch.toLowerCase())) {
        return false;
      }
    }
    
    // Filter by supplier
    if (supplierSearch && supplierSearch !== 'all') {
      const hasSupplier = order.suppliers.some(supplier => 
        supplier && supplier.toLowerCase().includes(supplierSearch.toLowerCase())
      );
      if (!hasSupplier) {
        return false;
      }
    }
    
    // Filter by date range
    if (startDate && isValid(startDate)) {
      const orderDate = parseISO(order.created_at);
      // Set time to beginning of day for comparison
      const startDateWithoutTime = new Date(startDate);
      startDateWithoutTime.setHours(0, 0, 0, 0);
      
      if (isBefore(orderDate, startDateWithoutTime)) {
        return false;
      }
    }
    
    if (endDate && isValid(endDate)) {
      const orderDate = parseISO(order.created_at);
      // Set time to end of day for comparison
      const endDateWithoutTime = new Date(endDate);
      endDateWithoutTime.setHours(23, 59, 59, 999);
      
      if (isAfter(orderDate, endDateWithoutTime)) {
        return false;
      }
    }
    
    return true;
  });

  // Get status filter options based on active tab
  const getStatusFilterOptions = () => {
    if (activeTab === 'inProgress') {
      return (
        <>
          <SelectItem value="all">All In-Progress Statuses</SelectItem>
          <SelectItem value="draft">Draft</SelectItem>
          <SelectItem value="pending">Pending Approval</SelectItem>
          <SelectItem value="approved">Approved</SelectItem>
          <SelectItem value="partial">Partially Received</SelectItem>
        </>
      );
    } else {
      return (
        <>
          <SelectItem value="all">All Completed Statuses</SelectItem>
          <SelectItem value="complete">Fully Received</SelectItem>
          <SelectItem value="cancelled">Cancelled</SelectItem>
        </>
      );
    }
  };

  // Reset status filter when changing tabs
  const handleTabChange = (value: string) => {
    setActiveTab(value as OrderTab);
    setStatusFilter('all');
  };

  // Handle row click to navigate to order details
  const handleRowClick = (orderId: number) => {
    router.push(`/purchasing/purchase-orders/${orderId}`);
  };

  // Render filters for both tabs
  const renderFilters = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Status Filter */}
        <div>
          <Label>Status</Label>
          <Select
            value={statusFilter}
            onValueChange={setStatusFilter}
          >
            <SelectTrigger>
              <SelectValue placeholder={`All ${activeTab === 'inProgress' ? 'In-Progress' : 'Completed'} Statuses`} />
            </SelectTrigger>
            <SelectContent>
              {getStatusFilterOptions()}
            </SelectContent>
          </Select>
        </div>
        
        {/* Q Number Search */}
        <div>
          <Label>Q Number</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by Q Number"
              value={qNumberSearch}
              onChange={(e) => setQNumberSearch(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>
        
        {/* Supplier Search/Filter */}
        <div>
          <Label>Supplier</Label>
          <Select
            value={supplierSearch}
            onValueChange={setSupplierSearch}
          >
            <SelectTrigger>
              <SelectValue placeholder="All Suppliers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Suppliers</SelectItem>
              {uniqueSuppliers.map((supplier, index) => (
                <SelectItem key={index} value={supplier}>
                  {supplier}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Date Range Filter */}
        <div>
          <Label>From Date</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="w-full justify-start text-left font-normal"
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {startDate ? format(startDate, 'PPP') : <span>Pick a date</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
              <Calendar
                mode="single"
                selected={startDate}
                onSelect={setStartDate}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>
        
        <div>
          <Label>To Date</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="w-full justify-start text-left font-normal"
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {endDate ? format(endDate, 'PPP') : <span>Pick a date</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
              <Calendar
                mode="single"
                selected={endDate}
                onSelect={setEndDate}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>
      
      {/* Reset Filters Button */}
      {(statusFilter !== 'all' || qNumberSearch || supplierSearch || startDate || endDate) && (
        <div className="flex justify-end">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={resetFilters}
            className="flex items-center gap-1"
          >
            <FilterX className="h-4 w-4" />
            Reset Filters
          </Button>
        </div>
      )}
    </div>
  );

  // Render table with clickable rows for both tabs
  const renderTable = () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Q Number</TableHead>
          <TableHead>Items</TableHead>
          <TableHead>Suppliers</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {filteredOrders?.length ? (
          filteredOrders.map((order) => (
            <TableRow 
              key={order.purchase_order_id}
              onClick={() => handleRowClick(order.purchase_order_id)}
              className="cursor-pointer hover:bg-muted"
            >
              <TableCell>{formatQNumber(order.q_number)}</TableCell>
              <TableCell>{order.supplier_orders?.length || 0} items</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {order.suppliers?.map((supplier, index) => (
                    <Badge key={index} variant="outline" className="text-xs">
                      {supplier}
                    </Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell>{format(new Date(order.created_at), 'MMM d, yyyy')}</TableCell>
              <TableCell>
                <StatusBadge status={getOrderStatus(order)} />
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  asChild
                  onClick={(e) => e.stopPropagation()} // Prevent row click when clicking the button
                >
                  <Link href={`/purchasing/purchase-orders/${order.purchase_order_id}`}>
                    View Details
                    <ExternalLink className="w-4 h-4 ml-2" />
                  </Link>
                </Button>
              </TableCell>
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
              No {activeTab === 'inProgress' ? 'in-progress' : 'completed'} orders found matching the current filters.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/purchasing">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Purchase Orders (Q Numbers)</h1>
      </div>
      
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground">
          Create purchase orders with multiple components that will be assigned Q numbers by the accounts department
        </p>
        <Link href="/purchasing/purchase-orders/new">
          <Button className="flex items-center gap-2">
            <PlusCircle className="h-4 w-4" />
            <span>New Purchase Order</span>
          </Button>
        </Link>
      </div>

      <Tabs defaultValue="inProgress" onValueChange={handleTabChange}>
        <TabsList className="grid w-full grid-cols-2 mb-4">
          <TabsTrigger value="inProgress">In Progress</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
        </TabsList>
        
        <TabsContent value="inProgress" className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              {renderFilters()}
              <div className="mt-6">
                {renderTable()}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="completed" className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              {renderFilters()}
              <div className="mt-6">
                {renderTable()}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
} 