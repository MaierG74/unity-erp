'use client';

import { useMemo, useState, useCallback, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { SupplierWithDetails, SupplierPurchaseOrder } from '@/types/suppliers';
import { formatCurrency } from '@/lib/quotes';
import { format, parseISO, isValid, isBefore, isAfter } from 'date-fns';
import { Calendar, Search, X, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface SupplierOrdersProps {
  supplier: SupplierWithDetails;
}

type DateType = 'order' | 'receipt' | 'created';

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

export function SupplierOrders({ supplier }: SupplierOrdersProps) {
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [dateType, setDateType] = useState<DateType>('order');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [qNumberSearch, setQNumberSearch] = useState<string>('');
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  // Fetch purchase orders for this supplier
  const { data: purchaseOrders = [], isLoading } = useQuery({
    queryKey: ['supplier-purchase-orders', supplier.supplier_id],
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
    setDateType('order');
    setStatusFilter('all');
    setQNumberSearch('');
  }, []);

  // Get date for filtering based on date type
  const getFilterDate = useCallback((order: SupplierPurchaseOrder): Date | null => {
    try {
      if (dateType === 'order') {
        return parseISO(order.order_date || order.created_at);
      } else if (dateType === 'created') {
        return parseISO(order.created_at);
      } else if (dateType === 'receipt') {
        // Get the latest receipt date from all line items
        const receiptDates = order.supplier_orders
          .flatMap(so => so.receipts || [])
          .map(r => parseISO(r.receipt_date))
          .filter(d => isValid(d));
        
        if (receiptDates.length === 0) return null;
        return new Date(Math.max(...receiptDates.map(d => d.getTime())));
      }
    } catch {
      return null;
    }
    return null;
  }, [dateType]);

  // Filter orders
  const filteredOrders = useMemo(() => {
    return purchaseOrders.filter(order => {
      // Status filter
      if (statusFilter !== 'all') {
        const statusName = order.status?.status_name?.toLowerCase() || '';
        if (statusFilter === 'draft' && statusName !== 'draft') return false;
        if (statusFilter === 'pending' && statusName !== 'pending approval') return false;
        if (statusFilter === 'approved' && statusName !== 'approved') return false;
        if (statusFilter === 'partial' && statusName !== 'partially received') return false;
        if (statusFilter === 'complete' && statusName !== 'fully received') return false;
        if (statusFilter === 'cancelled' && statusName !== 'cancelled') return false;
      }

      // Q number search
      if (qNumberSearch.trim()) {
        const searchTerm = qNumberSearch.trim().toLowerCase();
        const qNumber = (order.q_number || '').toLowerCase();
        if (!qNumber.includes(searchTerm)) return false;
      }

      // Date filtering
      const filterDate = getFilterDate(order);
      if (!filterDate) {
        // If we're filtering by receipt date and there are no receipts, exclude it
        if (dateType === 'receipt' && (startDate || endDate)) return false;
      } else {
        if (startDate && isValid(startDate)) {
          const startDateWithoutTime = new Date(startDate);
          startDateWithoutTime.setHours(0, 0, 0, 0);
          if (isBefore(filterDate, startDateWithoutTime)) return false;
        }

        if (endDate && isValid(endDate)) {
          const endDateWithoutTime = new Date(endDate);
          endDateWithoutTime.setHours(23, 59, 59, 999);
          if (isAfter(filterDate, endDateWithoutTime)) return false;
        }
      }

      return true;
    });
  }, [purchaseOrders, statusFilter, qNumberSearch, startDate, endDate, getFilterDate, dateType]);

  // Calculate totals for each order
  const calculateOrderTotal = useCallback((order: SupplierPurchaseOrder) => {
    return order.supplier_orders.reduce((total, line) => {
      return total + (line.order_quantity * (line.supplier_component?.price || 0));
    }, 0);
  }, []);

  // Toggle row expansion
  const toggleRow = useCallback((orderId: number) => {
    setExpandedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(orderId)) {
        newSet.delete(orderId);
      } else {
        newSet.add(orderId);
      }
      return newSet;
    });
  }, []);

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col gap-3 p-3 bg-card rounded-xl border shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="h-9 w-full md:w-96 bg-muted animate-pulse rounded-lg" />
          <div className="h-9 w-32 bg-muted animate-pulse rounded-lg md:shrink-0" />
        </div>
        <div className="rounded-xl border bg-card shadow-sm">
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 animate-pulse">
                <div className="h-4 w-24 bg-muted rounded" />
                <div className="h-4 w-48 bg-muted rounded" />
                <div className="h-4 w-32 bg-muted rounded" />
                <div className="ml-auto h-4 w-20 bg-muted rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar with filters */}
      <div className="flex flex-col gap-3 p-3 bg-card rounded-xl border shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:flex-wrap">
            {/* Date Type Selector */}
            <Select value={dateType} onValueChange={(value) => setDateType(value as DateType)}>
              <SelectTrigger className="w-full md:w-[180px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="order">Order Date</SelectItem>
                <SelectItem value="receipt">Receipt Date</SelectItem>
                <SelectItem value="created">Created Date</SelectItem>
              </SelectContent>
            </Select>

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

            {/* Status Filter */}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-[180px] h-9">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="pending">Pending Approval</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="partial">Partially Received</SelectItem>
                <SelectItem value="complete">Fully Received</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>

            {/* Q Number Search */}
            <div className="relative w-full md:w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={qNumberSearch}
                onChange={(e) => setQNumberSearch(e.target.value)}
                placeholder="Search Q number"
                className="w-full h-9 pl-9 pr-10 rounded-lg border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {qNumberSearch && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQNumberSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted"
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>

          {/* Reset Button */}
          <Button
            variant="outline"
            onClick={resetFilters}
            className="h-9 w-full md:w-auto"
          >
            Reset Filters
          </Button>
        </div>
      </div>

      {/* Orders Table */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr className="border-b">
                <th className="text-left p-4 font-medium w-12"></th>
                <th className="text-left p-4 font-medium">Q Number</th>
                <th className="text-left p-4 font-medium">Order Date</th>
                <th className="text-left p-4 font-medium">Status</th>
                <th className="text-right p-4 font-medium">Total Value</th>
                <th className="text-center p-4 font-medium">Items</th>
                <th className="text-center p-4 font-medium">Progress</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    {purchaseOrders.length === 0
                      ? 'No purchase orders found for this supplier.'
                      : 'No purchase orders match the current filters.'}
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => {
                  const isExpanded = expandedRows.has(order.purchase_order_id);
                  const totalValue = calculateOrderTotal(order);
                  const totalOrdered = order.supplier_orders.reduce((sum, line) => sum + line.order_quantity, 0);
                  const totalReceived = order.supplier_orders.reduce((sum, line) => sum + line.total_received, 0);
                  
                  return (
                    <Fragment key={order.purchase_order_id}>
                      <tr className="border-b hover:bg-muted/50">
                        <td className="p-4">
                          <button
                            onClick={() => toggleRow(order.purchase_order_id)}
                            className="text-muted-foreground hover:text-foreground"
                            aria-label={isExpanded ? "Collapse" : "Expand"}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                        </td>
                        <td className="p-4">
                          <Link
                            href={`/purchasing/purchase-orders/${order.purchase_order_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline font-medium"
                          >
                            {order.q_number || `PO-${order.purchase_order_id}`}
                          </Link>
                        </td>
                        <td className="p-4">
                          {order.order_date
                            ? format(parseISO(order.order_date), 'MMM d, yyyy')
                            : format(parseISO(order.created_at), 'MMM d, yyyy')}
                        </td>
                        <td className="p-4">
                          <StatusBadge status={order.status?.status_name || 'Unknown'} />
                        </td>
                        <td className="p-4 text-right font-medium">
                          {formatCurrency(totalValue)}
                        </td>
                        <td className="p-4 text-center">
                          {order.supplier_orders.length}
                        </td>
                        <td className="p-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <span className="text-sm">
                              {totalReceived} / {totalOrdered}
                            </span>
                            {totalOrdered > 0 && (
                              <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-primary"
                                  style={{ width: `${(totalReceived / totalOrdered) * 100}%` }}
                                />
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={7} className="p-0">
                            <div className="bg-muted/20 p-4">
                              <table className="w-full">
                                <thead>
                                  <tr className="text-sm text-muted-foreground">
                                    <th className="text-left pb-2 font-medium">Component</th>
                                    <th className="text-left pb-2 font-medium">Supplier Code</th>
                                    <th className="text-right pb-2 font-medium">Unit Price</th>
                                    <th className="text-right pb-2 font-medium">Ordered</th>
                                    <th className="text-right pb-2 font-medium">Received</th>
                                    <th className="text-right pb-2 font-medium">Line Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {order.supplier_orders.map((line) => (
                                    <tr key={line.order_id} className="text-sm">
                                      <td className="py-2">
                                        <div>
                                          <div className="font-medium">
                                            {line.supplier_component?.component?.internal_code}
                                          </div>
                                          <div className="text-xs text-muted-foreground">
                                            {line.supplier_component?.component?.description}
                                          </div>
                                        </div>
                                      </td>
                                      <td className="py-2">{line.supplier_component?.supplier_code}</td>
                                      <td className="py-2 text-right">
                                        {formatCurrency(line.supplier_component?.price || 0)}
                                      </td>
                                      <td className="py-2 text-right">{line.order_quantity}</td>
                                      <td className="py-2 text-right">{line.total_received}</td>
                                      <td className="py-2 text-right font-medium">
                                        {formatCurrency(line.order_quantity * (line.supplier_component?.price || 0))}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary */}
      {filteredOrders.length > 0 && (
        <div className="flex justify-end gap-6 text-sm text-muted-foreground p-4 bg-card rounded-xl border">
          <div>
            Total Orders: <span className="font-medium text-foreground">{filteredOrders.length}</span>
          </div>
          <div>
            Total Value:{' '}
            <span className="font-medium text-foreground">
              {formatCurrency(
                filteredOrders.reduce((sum, order) => sum + calculateOrderTotal(order), 0)
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
