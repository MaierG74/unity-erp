'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ClipboardList, PlusCircle, RefreshCw, TrendingUp, ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface OrderStatus {
  status_id: number;
  status_name: string;
}

interface SupplierInfo {
  name: string;
}

interface PurchaseOrderSummary {
  purchase_order_id: number;
  q_number?: string;
  created_at: string;
  status_id: number;
  supplier_order_statuses: OrderStatus;
  suppliers: string[];
  supplier_orders: any[];
}

// Define filter types
type FilterType = 'recent' | 'pending' | 'approved';

export default function PurchasingPage() {
  // Add state for active filter
  const [activeFilter, setActiveFilter] = useState<FilterType>('recent');

  // Helper function to check if an order is fully received
  function isFullyReceived(order: PurchaseOrderSummary): boolean {
    if (!order.supplier_orders?.length) return false;
    
    return order.supplier_orders.every(
      (so: any) => so.order_quantity > 0 && so.total_received === so.order_quantity
    );
  }

  // Fetch recent or filtered purchase orders
  const { data: filteredOrders, isLoading: ordersLoading } = useQuery({
    queryKey: ['purchase-orders', activeFilter],
    queryFn: async () => {
      let query = supabase
        .from('purchase_orders')
        .select(`
          purchase_order_id,
          q_number,
          created_at,
          status_id,
          supplier_order_statuses:supplier_order_statuses!purchase_orders_status_id_fkey(status_id, status_name),
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
      
      // Apply filters based on activeFilter
      if (activeFilter === 'pending') {
        query = query.in('status_id', [5, 6]); // Draft and Pending Approval
        query = query.limit(10); // Show more orders when filtered
      } else if (activeFilter === 'approved') {
        query = query.in('status_id', [7, 8]); // Approved and Partially Received
        query = query.limit(10); // Show more orders when filtered
      } else {
        // Default "recent" filter - just show the most recent 5 orders
        query = query.limit(5);
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      
      // Transform the data to include supplier information
      const transformedOrders = (data as any[]).map(order => {
        // Extract unique supplier names
        const suppliers = Array.from(new Set(
          (order.supplier_orders || [])
            .map((so: any) => so.supplier_component?.supplier?.name)
            .filter(Boolean)
        ));
        
        return {
          ...order,
          suppliers,
          status: order.supplier_order_statuses, // Use the correctly joined status
        };
      }) as PurchaseOrderSummary[];

      // If viewing approved orders, filter out fully received orders
      if (activeFilter === 'approved') {
        return transformedOrders.filter(order => !isFullyReceived(order));
      }
      
      return transformedOrders;
    }
  });

  // Fetch summary metrics
  const { data: allOrderData, isLoading: metricsLoading } = useQuery({
    queryKey: ['all-purchase-orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select(`
          purchase_order_id,
          status_id,
          created_at,
          supplier_orders(
            order_quantity,
            total_received
          )
        `);
      
      if (error) throw error;
      return data;
    }
  });

  // Calculate metrics based on the loaded data
  const metrics = allOrderData ? {
    // Pending orders count - includes "Pending Approval" (6) and "Draft" (5)
    pending: allOrderData.filter(order => [5, 6].includes(order.status_id)).length,
    
    // Approved orders count - includes "Approved" (7) and "Partially Received" (8), 
    // but EXCLUDE fully received orders
    approved: allOrderData.filter(order => {
      // Check if order is in approved or partially received status
      if (![7, 8].includes(order.status_id)) return false;
      
      // Exclude fully received orders
      const isFullyReceived = order.supplier_orders?.length > 0 && 
        order.supplier_orders.every(
          (so: any) => so.order_quantity > 0 && so.total_received === so.order_quantity
        );
      
      return !isFullyReceived;
    }).length,
    
    // Total orders this month
    monthly: allOrderData.filter(order => {
      const orderDate = new Date(order.created_at);
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      return orderDate >= startOfMonth;
    }).length
  } : {
    pending: 0,
    approved: 0,
    monthly: 0
  };

  function getOrderStatus(order: PurchaseOrderSummary) {
    if (!order.supplier_orders?.length) {
      return order.supplier_order_statuses?.status_name || 'Unknown';
    }

    const allReceived = order.supplier_orders.every(
      (so: any) => so.order_quantity > 0 && so.total_received === so.order_quantity
    );
    
    const someReceived = order.supplier_orders.some(
      (so: any) => (so.total_received || 0) > 0 && so.total_received !== so.order_quantity
    );

    if (order.supplier_order_statuses?.status_name === 'Approved') {
      if (allReceived) return 'Fully Received';
      if (someReceived) return 'Partially Received';
    }

    return order.supplier_order_statuses?.status_name || 'Unknown';
  }

  function getStatusColor(statusName: string | undefined) {
    if (!statusName) return 'bg-gray-500';
    const status = statusName.toLowerCase();
    if (status.includes('pending')) return 'bg-yellow-500';
    if (status.includes('approved')) return 'bg-green-500';
    if (status.includes('complete') || status.includes('fully received')) return 'bg-blue-500';
    if (status.includes('partially')) return 'bg-orange-500';
    if (status.includes('cancel')) return 'bg-red-500';
    return 'bg-gray-500';
  }

  // Format Q number to remove any duplicate "Q" prefix
  function formatQNumber(qNumber: string | undefined): string {
    if (!qNumber) return 'Not assigned';
    
    // If the qNumber already starts with 'Q', return as is
    if (qNumber.startsWith('Q')) return qNumber;
    
    // Otherwise add the 'Q' prefix
    return `Q${qNumber}`;
  }

  // Get section title based on active filter
  function getSectionTitle(): string {
    switch (activeFilter) {
      case 'pending':
        return 'Pending Orders';
      case 'approved':
        return 'Approved Orders';
      default:
        return 'Recent Purchase Orders';
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start gap-4 md:flex-row md:justify-between md:items-center">
        <div>
          <h1 className="text-2xl font-bold">Purchasing Dashboard</h1>
          <p className="text-muted-foreground">
            Manage purchase orders and monitor purchasing activity
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/purchasing/purchase-orders/new">
            <Button>
              <PlusCircle className="h-4 w-4 mr-2" />
              New Order
            </Button>
          </Link>
          <Link href="/purchasing/purchase-orders">
            <Button variant="outline">
              <ClipboardList className="h-4 w-4 mr-2" />
              All Orders
            </Button>
          </Link>
        </div>
      </div>
      
      {/* Metrics Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card 
          className={cn(
            "transition-all hover:border-primary hover:shadow-md cursor-pointer",
            activeFilter === 'pending' && "border-primary bg-primary/5"
          )}
          onClick={() => setActiveFilter(activeFilter === 'pending' ? 'recent' : 'pending')}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Orders</CardTitle>
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {metricsLoading ? (
              <div className="h-8 w-20 animate-pulse rounded-md bg-muted" />
            ) : (
              <div className="text-2xl font-bold">{metrics?.pending || 0}</div>
            )}
            <p className="text-xs text-muted-foreground">
              Awaiting approval
            </p>
            <p className="text-xs text-primary mt-2">
              {activeFilter === 'pending' ? 'Click to show all orders' : 'Click to filter'}
            </p>
          </CardContent>
        </Card>
        <Card 
          className={cn(
            "transition-all hover:border-primary hover:shadow-md cursor-pointer",
            activeFilter === 'approved' && "border-primary bg-primary/5"
          )}
          onClick={() => setActiveFilter(activeFilter === 'approved' ? 'recent' : 'approved')}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Approved Orders</CardTitle>
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {metricsLoading ? (
              <div className="h-8 w-20 animate-pulse rounded-md bg-muted" />
            ) : (
              <div className="text-2xl font-bold">{metrics?.approved || 0}</div>
            )}
            <p className="text-xs text-muted-foreground">
              Awaiting delivery
            </p>
            <p className="text-xs text-primary mt-2">
              {activeFilter === 'approved' ? 'Click to show all orders' : 'Click to filter'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">This Month</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {metricsLoading ? (
              <div className="h-8 w-20 animate-pulse rounded-md bg-muted" />
            ) : (
              <div className="text-2xl font-bold">{metrics?.monthly || 0}</div>
            )}
            <p className="text-xs text-muted-foreground">
              Total orders created
            </p>
          </CardContent>
        </Card>
      </div>
      
      {/* Orders Section */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>{getSectionTitle()}</CardTitle>
          {activeFilter !== 'recent' && (
            <Button 
              variant="ghost" 
              size="sm" 
              className="flex items-center gap-1" 
              onClick={() => setActiveFilter('recent')}
            >
              <ArrowLeft className="h-4 w-4" />
              Show Recent
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {ordersLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 w-full animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : filteredOrders?.length ? (
            <div className="divide-y">
              {filteredOrders.map((order) => (
                <Link 
                  href={`/purchasing/purchase-orders/${order.purchase_order_id}`}
                  key={order.purchase_order_id}
                  className="flex items-center justify-between py-3 hover:bg-muted/20 px-2 rounded-md transition-colors"
                >
                  <div className="flex items-center space-x-4">
                    <div>
                      <span className="font-medium block">
                        {formatQNumber(order.q_number) || `Order #${order.purchase_order_id}`}
                      </span>
                      <div className="flex items-center text-xs text-muted-foreground">
                        <span>{format(new Date(order.created_at), 'MMM d, yyyy')}</span>
                        {order.suppliers && order.suppliers.length > 0 && (
                          <>
                            <span className="mx-1">•</span>
                            <span>{order.suppliers.join(', ')}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <Badge 
                    className={`${getStatusColor(getOrderStatus(order))} text-white`}
                  >
                    {getOrderStatus(order)}
                  </Badge>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No {activeFilter !== 'recent' ? activeFilter : 'recent'} orders found
            </div>
          )}
          
          <div className="mt-4 text-center">
            <Link href="/purchasing/purchase-orders">
              <Button variant="outline">
                View All Orders
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}