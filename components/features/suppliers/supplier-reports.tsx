'use client';

import { useMemo, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { SupplierWithDetails, SupplierPurchaseOrder, SupplierStatistics } from '@/types/suppliers';
import { formatCurrency } from '@/lib/quotes';
import { format, parseISO, isValid, isBefore, isAfter, differenceInDays } from 'date-fns';
import { Calendar, TrendingUp, Package, Clock, CheckCircle, Layers, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface SupplierReportsProps {
  supplier: SupplierWithDetails;
}

// Status badge component
function StatusBadge({ status }: { status: string }) {
  let variant: 'default' | 'destructive' | 'outline' | 'secondary' = 'default';
  
  switch (status.toLowerCase()) {
    case 'draft':
      variant = 'outline';
      break;
    case 'pending approval':
      variant = 'secondary';
      break;
    case 'approved':
      variant = 'default';
      break;
    case 'partially received':
      variant = 'secondary';
      break;
    case 'fully received':
      variant = 'default';
      break;
    case 'cancelled':
      variant = 'destructive';
      break;
  }
  
  return <Badge variant={variant}>{status}</Badge>;
}

export function SupplierReports({ supplier }: SupplierReportsProps) {
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);

  // Fetch purchase orders for this supplier
  const { data: purchaseOrders = [], isLoading } = useQuery({
    queryKey: ['supplier-purchase-orders-reports', supplier.supplier_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select(`
          purchase_order_id,
          q_number,
          order_date,
          created_at,
          notes,
          status:supplier_order_statuses!purchase_orders_status_id_fkey(status_name),
          supplier_orders!inner(
            order_id,
            order_quantity,
            total_received,
            supplier_component:suppliercomponents!inner(
              supplier_component_id,
              supplier_code,
              price,
              lead_time,
              supplier_id,
              component:components(
                component_id,
                internal_code,
                description
              )
            ),
            receipts:supplier_order_receipts(
              receipt_date,
              quantity_received
            )
          )
        `)
        .eq('supplier_orders.suppliercomponents.supplier_id', supplier.supplier_id)
        .order('order_date', { ascending: false });

      if (error) throw error;

      return (data || []) as SupplierPurchaseOrder[];
    },
  });

  // Reset filters function
  const resetFilters = useCallback(() => {
    setStartDate(undefined);
    setEndDate(undefined);
  }, []);

  // Filter orders by date range
  const filteredOrders = useMemo(() => {
    return purchaseOrders.filter(order => {
      if (startDate || endDate) {
        const orderDate = parseISO(order.order_date || order.created_at);
        
        if (startDate && isValid(startDate)) {
          const startDateWithoutTime = new Date(startDate);
          startDateWithoutTime.setHours(0, 0, 0, 0);
          if (isBefore(orderDate, startDateWithoutTime)) return false;
        }

        if (endDate && isValid(endDate)) {
          const endDateWithoutTime = new Date(endDate);
          endDateWithoutTime.setHours(23, 59, 59, 999);
          if (isAfter(orderDate, endDateWithoutTime)) return false;
        }
      }

      return true;
    });
  }, [purchaseOrders, startDate, endDate]);

  // Calculate statistics
  const statistics = useMemo((): SupplierStatistics => {
    const totalOrders = filteredOrders.length;
    
    // Calculate total value
    const totalValue = filteredOrders.reduce((sum, order) => {
      return sum + order.supplier_orders.reduce((lineSum, line) => {
        return lineSum + (line.order_quantity * (line.supplier_component?.price || 0));
      }, 0);
    }, 0);

    // Calculate outstanding orders
    let outstandingOrders = 0;
    let outstandingValue = 0;
    
    filteredOrders.forEach(order => {
      const hasOutstanding = order.supplier_orders.some(line => line.total_received < line.order_quantity);
      if (hasOutstanding) {
        outstandingOrders++;
        order.supplier_orders.forEach(line => {
          const outstandingQty = line.order_quantity - line.total_received;
          if (outstandingQty > 0) {
            outstandingValue += outstandingQty * (line.supplier_component?.price || 0);
          }
        });
      }
    });

    // Calculate average lead time (from order date to first receipt)
    const leadTimes: number[] = [];
    filteredOrders.forEach(order => {
      order.supplier_orders.forEach(line => {
        if (line.receipts && line.receipts.length > 0) {
          const orderDate = parseISO(order.order_date || order.created_at);
          const firstReceiptDate = parseISO(line.receipts[0].receipt_date);
          if (isValid(orderDate) && isValid(firstReceiptDate)) {
            const daysDiff = differenceInDays(firstReceiptDate, orderDate);
            if (daysDiff >= 0) {
              leadTimes.push(daysDiff);
            }
          }
        }
      });
    });
    
    const averageLeadTime = leadTimes.length > 0
      ? Math.round(leadTimes.reduce((sum, days) => sum + days, 0) / leadTimes.length)
      : null;

    // Calculate on-time delivery rate
    let onTimeDeliveries = 0;
    let totalDeliveries = 0;
    
    filteredOrders.forEach(order => {
      order.supplier_orders.forEach(line => {
        if (line.receipts && line.receipts.length > 0 && line.supplier_component?.lead_time) {
          totalDeliveries++;
          const orderDate = parseISO(order.order_date || order.created_at);
          const firstReceiptDate = parseISO(line.receipts[0].receipt_date);
          if (isValid(orderDate) && isValid(firstReceiptDate)) {
            const actualLeadTime = differenceInDays(firstReceiptDate, orderDate);
            const expectedLeadTime = line.supplier_component.lead_time;
            if (actualLeadTime <= expectedLeadTime) {
              onTimeDeliveries++;
            }
          }
        }
      });
    });
    
    const onTimeDeliveryRate = totalDeliveries > 0
      ? Math.round((onTimeDeliveries / totalDeliveries) * 100)
      : null;

    // Count unique components
    const uniqueComponentIds = new Set<number>();
    filteredOrders.forEach(order => {
      order.supplier_orders.forEach(line => {
        if (line.supplier_component?.component?.component_id) {
          uniqueComponentIds.add(line.supplier_component.component.component_id);
        }
      });
    });
    const uniqueComponents = uniqueComponentIds.size;

    // Orders by status
    const ordersByStatus: Record<string, number> = {};
    filteredOrders.forEach(order => {
      const statusName = order.status?.status_name || 'Unknown';
      ordersByStatus[statusName] = (ordersByStatus[statusName] || 0) + 1;
    });

    return {
      totalOrders,
      totalValue,
      outstandingOrders,
      outstandingValue,
      averageLeadTime,
      onTimeDeliveryRate,
      uniqueComponents,
      ordersByStatus,
    };
  }, [filteredOrders]);

  // Get recent orders (last 10)
  const recentOrders = useMemo(() => {
    return filteredOrders.slice(0, 10);
  }, [filteredOrders]);

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex gap-3 p-3 bg-card rounded-xl border shadow-sm">
          <div className="h-9 w-48 bg-muted animate-pulse rounded-lg" />
          <div className="h-9 w-48 bg-muted animate-pulse rounded-lg" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="p-6 bg-card rounded-xl border shadow-sm">
              <div className="h-4 w-24 bg-muted animate-pulse rounded mb-4" />
              <div className="h-8 w-32 bg-muted animate-pulse rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Date Range Filter */}
      <div className="flex flex-col gap-3 p-3 bg-card rounded-xl border shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <span className="text-sm font-medium">Date Range:</span>
          
          {/* From Date */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full md:w-[200px] h-9 justify-start text-left font-normal",
                  !startDate && "text-muted-foreground"
                )}
              >
                <Calendar className="mr-2 h-4 w-4" />
                {startDate ? format(startDate, "MMM d, yyyy") : "From Date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <CalendarComponent
                mode="single"
                selected={startDate}
                onSelect={setStartDate}
                initialFocus
              />
            </PopoverContent>
          </Popover>

          {/* To Date */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full md:w-[200px] h-9 justify-start text-left font-normal",
                  !endDate && "text-muted-foreground"
                )}
              >
                <Calendar className="mr-2 h-4 w-4" />
                {endDate ? format(endDate, "MMM d, yyyy") : "To Date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <CalendarComponent
                mode="single"
                selected={endDate}
                onSelect={setEndDate}
                initialFocus
              />
            </PopoverContent>
          </Popover>

          {(startDate || endDate) && (
            <span className="text-sm text-muted-foreground">
              {startDate || endDate ? '(Filtered)' : '(All Time)'}
            </span>
          )}
        </div>

        {/* Reset Button */}
        {(startDate || endDate) && (
          <Button
            variant="outline"
            onClick={resetFilters}
            className="h-9 w-full md:w-auto"
          >
            Reset
          </Button>
        )}
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Total Orders */}
        <div className="p-6 bg-card rounded-xl border shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Package className="h-5 w-5 text-primary" />
            </div>
            <h3 className="text-sm font-medium text-muted-foreground">Total Orders</h3>
          </div>
          <p className="text-3xl font-bold">{statistics.totalOrders}</p>
        </div>

        {/* Total Order Value */}
        <div className="p-6 bg-card rounded-xl border shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-primary/10 rounded-lg">
              <TrendingUp className="h-5 w-5 text-primary" />
            </div>
            <h3 className="text-sm font-medium text-muted-foreground">Total Order Value</h3>
          </div>
          <p className="text-3xl font-bold">{formatCurrency(statistics.totalValue)}</p>
        </div>

        {/* Outstanding Orders */}
        <div className="p-6 bg-card rounded-xl border shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-orange-500/10 rounded-lg">
              <Clock className="h-5 w-5 text-orange-500" />
            </div>
            <h3 className="text-sm font-medium text-muted-foreground">Outstanding Orders</h3>
          </div>
          <p className="text-3xl font-bold mb-1">{statistics.outstandingOrders}</p>
          <p className="text-sm text-muted-foreground">
            Value: {formatCurrency(statistics.outstandingValue)}
          </p>
        </div>

        {/* Average Lead Time */}
        <div className="p-6 bg-card rounded-xl border shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Clock className="h-5 w-5 text-blue-500" />
            </div>
            <h3 className="text-sm font-medium text-muted-foreground">Average Lead Time</h3>
          </div>
          <p className="text-3xl font-bold">
            {statistics.averageLeadTime !== null ? `${statistics.averageLeadTime} days` : 'N/A'}
          </p>
        </div>

        {/* On-Time Delivery Rate */}
        <div className="p-6 bg-card rounded-xl border shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-green-500/10 rounded-lg">
              <CheckCircle className="h-5 w-5 text-green-500" />
            </div>
            <h3 className="text-sm font-medium text-muted-foreground">On-Time Delivery</h3>
          </div>
          <p className="text-3xl font-bold">
            {statistics.onTimeDeliveryRate !== null ? `${statistics.onTimeDeliveryRate}%` : 'N/A'}
          </p>
        </div>

        {/* Components Variety */}
        <div className="p-6 bg-card rounded-xl border shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-purple-500/10 rounded-lg">
              <Layers className="h-5 w-5 text-purple-500" />
            </div>
            <h3 className="text-sm font-medium text-muted-foreground">Unique Components</h3>
          </div>
          <p className="text-3xl font-bold">{statistics.uniqueComponents}</p>
        </div>
      </div>

      {/* Orders by Status */}
      {Object.keys(statistics.ordersByStatus).length > 0 && (
        <div className="p-6 bg-card rounded-xl border shadow-sm">
          <h3 className="text-lg font-semibold mb-4">Orders by Status</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Object.entries(statistics.ordersByStatus).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <StatusBadge status={status} />
                <span className="text-xl font-bold">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Activity */}
      {recentOrders.length > 0 && (
        <div className="p-6 bg-card rounded-xl border shadow-sm">
          <h3 className="text-lg font-semibold mb-4">Recent Purchase Orders</h3>
          <div className="space-y-3">
            {recentOrders.map((order) => {
              const orderTotal = order.supplier_orders.reduce((sum, line) => {
                return sum + (line.order_quantity * (line.supplier_component?.price || 0));
              }, 0);
              
              return (
                <div
                  key={order.purchase_order_id}
                  className="flex items-center justify-between p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/purchasing/purchase-orders/${order.purchase_order_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline font-medium inline-flex items-center gap-1"
                      >
                        {order.q_number || `PO-${order.purchase_order_id}`}
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                      <StatusBadge status={order.status?.status_name || 'Unknown'} />
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {order.order_date
                        ? format(parseISO(order.order_date), 'MMM d, yyyy')
                        : format(parseISO(order.created_at), 'MMM d, yyyy')}
                      {' • '}
                      {order.supplier_orders.length} item{order.supplier_orders.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{formatCurrency(orderTotal)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty State */}
      {filteredOrders.length === 0 && (
        <div className="p-12 bg-card rounded-xl border shadow-sm text-center">
          <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Purchase Orders Found</h3>
          <p className="text-muted-foreground">
            {purchaseOrders.length === 0
              ? 'This supplier has no purchase orders yet.'
              : 'No purchase orders match the selected date range.'}
          </p>
        </div>
      )}
    </div>
  );
}

