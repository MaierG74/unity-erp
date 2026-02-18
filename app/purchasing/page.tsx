'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  ClipboardList,
  PlusCircle,
  Truck,
  Clock,
  PackageCheck,
  Download,
  CheckCircle2,
  Filter,
  Paperclip,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// --- Types ---

type FilterType = 'all' | 'pending' | 'approved' | 'partialReceived';

interface AwaitingReceiptItem {
  order_id: number;
  order_quantity: number;
  total_received: number;
  purchase_order_id: number;
  q_number: string | null;
  component_code: string;
  component_description: string;
  supplier_name: string;
  owing: number;
}

// --- Constants ---

const ITEMS_PER_PAGE = 10;

// --- Component ---

export default function PurchasingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filterParam = searchParams.get('filter');
  const validFilters: FilterType[] = ['pending', 'approved', 'partialReceived'];
  const initialFilter: FilterType = validFilters.includes(filterParam as FilterType)
    ? (filterParam as FilterType)
    : 'all';
  const [activeFilter, setActiveFilter] = useState<FilterType>(initialFilter);
  const [supplierFilter, setSupplierFilter] = useState<string | null>(null);
  const [supplierPopoverOpen, setSupplierPopoverOpen] = useState(false);
  const [visibleItems, setVisibleItems] = useState(ITEMS_PER_PAGE);

  // --- Metrics query ---
  const { data: metrics, isLoading: metricsLoading } = useQuery({
    queryKey: ['purchasing-dashboard', 'metrics'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select(`
          purchase_order_id,
          status_id,
          supplier_order_statuses!purchase_orders_status_id_fkey(status_name),
          supplier_orders(order_quantity, total_received)
        `);

      if (error) throw error;

      let pending = 0;
      let approved = 0;
      let partialReceived = 0;

      for (const order of data || []) {
        const statusName = (order.supplier_order_statuses as any)?.status_name;
        if (!statusName) continue;

        if (statusName === 'Draft' || statusName === 'Pending Approval') {
          pending++;
          continue;
        }

        if (statusName === 'Approved' || statusName === 'Partially Received') {
          const orders = order.supplier_orders || [];
          const isFullyReceived =
            orders.length > 0 &&
            orders.every(
              (so: any) => so.order_quantity > 0 && so.total_received === so.order_quantity
            );

          if (isFullyReceived) continue;

          const hasAnyReceived = orders.some(
            (so: any) => (so.total_received || 0) > 0
          );

          if (hasAnyReceived) {
            partialReceived++;
          }
          approved++;
        }
      }

      return { pending, approved, partialReceived };
    },
    staleTime: 30_000,
  });

  // --- Awaiting receipt items query ---
  const { data: awaitingItems, isLoading: awaitingLoading } = useQuery({
    queryKey: ['purchasing-dashboard', 'awaiting-receipt'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('supplier_orders')
        .select(`
          order_id,
          order_quantity,
          total_received,
          purchase_order_id,
          purchase_orders!inner(
            purchase_order_id,
            q_number,
            status_id
          ),
          supplier_component:suppliercomponents!inner(
            component:components!inner(
              internal_code,
              description
            ),
            supplier:suppliers!inner(
              name
            )
          )
        `)
        .in('purchase_orders.status_id', [7, 8])
        .order('purchase_order_id', { ascending: false })
        .limit(50);

      if (error) throw error;

      // Transform and filter to only items with outstanding quantities
      const items: AwaitingReceiptItem[] = [];
      for (const row of data || []) {
        const owing = (row.order_quantity || 0) - (row.total_received || 0);
        if (owing <= 0) continue;

        items.push({
          order_id: row.order_id,
          order_quantity: row.order_quantity,
          total_received: row.total_received || 0,
          purchase_order_id: (row.purchase_orders as any)?.purchase_order_id,
          q_number: (row.purchase_orders as any)?.q_number,
          component_code: (row.supplier_component as any)?.component?.internal_code || '',
          component_description: (row.supplier_component as any)?.component?.description || '',
          supplier_name: (row.supplier_component as any)?.supplier?.name || '',
          owing,
        });
      }

      return items;
    },
    staleTime: 30_000,
  });

  // --- Pending approval POs query (shown when pending filter is active) ---
  const { data: pendingOrders, isLoading: pendingLoading } = useQuery({
    queryKey: ['purchasing-dashboard', 'pending-approval'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select(`
          purchase_order_id,
          created_at,
          notes,
          status_id,
          supplier_orders(
            order_id,
            order_quantity,
            supplier_component:suppliercomponents(
              price,
              supplier:suppliers(name)
            )
          )
        `)
        .in('status_id', [5, 6])
        .order('created_at', { ascending: false });

      if (error) throw error;

      return (data || []).map((po: any) => {
        const suppliers = new Set<string>();
        let totalValue = 0;
        let totalItems = 0;
        for (const so of po.supplier_orders || []) {
          const sc = Array.isArray(so.supplier_component) ? so.supplier_component[0] : so.supplier_component;
          const sup = Array.isArray(sc?.supplier) ? sc.supplier[0] : sc?.supplier;
          if (sup?.name) suppliers.add(sup.name);
          totalValue += (sc?.price || 0) * (so.order_quantity || 0);
          totalItems += so.order_quantity || 0;
        }
        return {
          purchase_order_id: po.purchase_order_id,
          created_at: po.created_at,
          status_id: po.status_id,
          supplier_names: Array.from(suppliers),
          total_value: totalValue,
          total_items: totalItems,
          line_count: (po.supplier_orders || []).length,
        };
      });
    },
    staleTime: 30_000,
    enabled: activeFilter === 'pending',
  });

  // --- Filtered items based on active card ---

  const filteredAwaitingItems = (() => {
    if (!awaitingItems) return [];

    let items = awaitingItems;

    // Card filter
    switch (activeFilter) {
      case 'pending':
        return [];
      case 'approved':
        items = items.filter((item) => item.total_received === 0);
        break;
      case 'partialReceived':
        items = items.filter((item) => item.total_received > 0);
        break;
    }

    // Supplier filter (AND logic)
    if (supplierFilter) {
      items = items.filter((item) => item.supplier_name === supplierFilter);
    }

    return items;
  })();

  const hasAnyFilter = activeFilter !== 'all' || supplierFilter !== null;

  // Unique suppliers with item counts (for the filter dropdown)
  const supplierCounts = (() => {
    if (!awaitingItems) return [];
    const counts = new Map<string, number>();
    for (const item of awaitingItems) {
      counts.set(item.supplier_name, (counts.get(item.supplier_name) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
  })();

  // --- Helpers ---

  function formatQNumber(qNumber: string | null | undefined): string {
    if (!qNumber) return 'N/A';
    return qNumber.startsWith('Q') ? qNumber : `Q${qNumber}`;
  }

  function handleReceive(item: AwaitingReceiptItem) {
    router.push(
      `/purchasing/purchase-orders/${item.purchase_order_id}?receive=${item.order_id}`
    );
  }

  function toggleFilter(filter: FilterType) {
    setActiveFilter((prev) => (prev === filter ? 'all' : filter));
  }

  function toggleSupplierFilter(name: string) {
    setSupplierFilter((prev) => (prev === name ? null : name));
    setVisibleItems(ITEMS_PER_PAGE);
  }

  function clearAllFilters() {
    setActiveFilter('all');
    setSupplierFilter(null);
  }

  // --- Metric card config ---

  const cards: {
    key: FilterType;
    label: string;
    subtitle: string;
    icon: typeof Truck;
    value: number;
    borderColor: string;
    iconColor: string;
    activeBg: string;
  }[] = [
    {
      key: 'pending',
      label: 'Pending Approval',
      subtitle: 'Awaiting review',
      icon: Clock,
      value: metrics?.pending ?? 0,
      borderColor: 'border-l-muted-foreground',
      iconColor: 'text-muted-foreground',
      activeBg: 'bg-muted/40',
    },
    {
      key: 'approved',
      label: 'Awaiting Delivery',
      subtitle: 'Approved, not yet complete',
      icon: Truck,
      value: metrics?.approved ?? 0,
      borderColor: 'border-l-primary',
      iconColor: 'text-primary',
      activeBg: 'bg-primary/10',
    },
    {
      key: 'partialReceived',
      label: 'Partially Received',
      subtitle: 'Outstanding items remaining',
      icon: PackageCheck,
      value: metrics?.partialReceived ?? 0,
      borderColor: 'border-l-warning',
      iconColor: 'text-warning',
      activeBg: 'bg-warning/10',
    },
  ];

  // --- Render ---

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col items-start gap-4 md:flex-row md:justify-between md:items-center">
        <div>
          <h1 className="text-2xl font-bold">Purchasing</h1>
          <p className="text-muted-foreground">
            Manage purchase orders and monitor purchasing activity
          </p>
        </div>
        <Link href="/purchasing/purchase-orders/new">
          <Button>
            <PlusCircle className="h-4 w-4 mr-2" />
            New Order
          </Button>
        </Link>
      </div>

      {/* Quick Actions Bar */}
      <div className="flex gap-3 items-center">
        <Button
          variant="outline"
          className="text-warning border-warning hover:bg-warning/10"
          onClick={() => {
            const widget = document.getElementById('awaiting-receipt');
            widget?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        >
          <Download className="h-4 w-4 mr-2" />
          Receive Stock
        </Button>
        <Button variant="outline" asChild>
          <Link href="/purchasing/quick-upload">
            <Paperclip className="h-4 w-4 mr-2" />
            Upload Delivery Note
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/purchasing/purchase-orders">
            <ClipboardList className="h-4 w-4 mr-2" />
            All Orders
          </Link>
        </Button>
      </div>

      {/* Metric Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {cards.map((card) => {
          const Icon = card.icon;
          const isActive = activeFilter === card.key;

          return (
            <Card
              key={card.key}
              className={cn(
                'border-l-4 transition-all duration-200 cursor-pointer hover:shadow-md',
                card.borderColor,
                isActive && `ring-2 ring-primary/50 ${card.activeBg} shadow-md`
              )}
              onClick={() => toggleFilter(card.key)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleFilter(card.key);
                }
              }}
              aria-label={`${card.value} ${card.label.toLowerCase()}`}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{card.label}</CardTitle>
                <Icon className={cn('h-4 w-4', card.iconColor)} />
              </CardHeader>
              <CardContent>
                {metricsLoading ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <div className="text-2xl font-bold">{card.value}</div>
                )}
                <p className="text-xs text-muted-foreground mt-1">{card.subtitle}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Awaiting Receipt Widget */}
      <Card id="awaiting-receipt">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>{activeFilter === 'pending' ? 'Pending Approval' : 'Awaiting Receipt'}</CardTitle>
            {!awaitingLoading && (activeFilter === 'pending' ? pendingOrders : awaitingItems) && (
              <p className="text-sm text-muted-foreground mt-1">
                {activeFilter === 'pending' ? (
                  <>
                    {pendingOrders?.length || 0} order{(pendingOrders?.length || 0) !== 1 ? 's' : ''} awaiting review
                    {' '}
                    <button
                      className="text-primary hover:underline"
                      onClick={clearAllFilters}
                    >
                      (clear filter)
                    </button>
                  </>
                ) : hasAnyFilter ? (
                  <>
                    {filteredAwaitingItems.length} of {awaitingItems.length} item{awaitingItems.length !== 1 ? 's' : ''}
                    {supplierFilter && (
                      <span className="text-foreground font-medium"> &mdash; {supplierFilter}</span>
                    )}
                    {' '}
                    <button
                      className="text-primary hover:underline"
                      onClick={clearAllFilters}
                    >
                      (clear filter{activeFilter !== 'all' && supplierFilter ? 's' : ''})
                    </button>
                  </>
                ) : (
                  <>
                    {awaitingItems.length} item{awaitingItems.length !== 1 ? 's' : ''} across open orders
                  </>
                )}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {supplierCounts.length > 0 && (
              <Popover open={supplierPopoverOpen} onOpenChange={setSupplierPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      supplierFilter && 'ring-2 ring-primary/30 bg-primary/5'
                    )}
                  >
                    <Filter className="h-3.5 w-3.5 mr-1.5" />
                    {supplierFilter || 'Supplier'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-56 p-1 max-h-[300px] overflow-y-auto">
                  {supplierFilter && (
                    <button
                      className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
                      onClick={() => {
                        setSupplierFilter(null);
                        setSupplierPopoverOpen(false);
                      }}
                    >
                      All Suppliers
                      <span className="text-xs">{awaitingItems?.length}</span>
                    </button>
                  )}
                  {supplierCounts.map((s) => (
                    <button
                      key={s.name}
                      className={cn(
                        'flex w-full items-center justify-between rounded-sm px-3 py-2 text-sm hover:bg-muted transition-colors',
                        supplierFilter === s.name && 'bg-primary/10 text-primary font-medium'
                      )}
                      onClick={() => {
                        setSupplierFilter(supplierFilter === s.name ? null : s.name);
                        setVisibleItems(ITEMS_PER_PAGE);
                        setSupplierPopoverOpen(false);
                      }}
                    >
                      <span className="truncate">{s.name}</span>
                      <span className="text-xs text-muted-foreground ml-2">{s.count}</span>
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link href="/purchasing/purchase-orders">View All Orders</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {activeFilter === 'pending' ? (
            pendingLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : !pendingOrders?.length ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <CheckCircle2 className="h-12 w-12 text-green-500 mb-3" />
                <p className="text-lg font-medium">No pending orders</p>
                <p className="text-sm text-muted-foreground mt-1">
                  All orders have been reviewed.
                </p>
                <Button variant="outline" className="mt-4" onClick={clearAllFilters}>
                  Clear Filter
                </Button>
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>PO #</TableHead>
                      <TableHead>Supplier(s)</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Items</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead className="text-right w-[120px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingOrders.map((po) => (
                      <TableRow key={po.purchase_order_id} className="group hover:bg-muted/50">
                        <TableCell>
                          <Link
                            href={`/purchasing/purchase-orders/${po.purchase_order_id}`}
                            className="text-primary hover:underline font-medium"
                          >
                            PO #{po.purchase_order_id}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {po.supplier_names.map((name) => (
                              <Badge key={name} variant="outline">{name}</Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(po.created_at).toLocaleDateString('en-ZA', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </TableCell>
                        <TableCell className="text-right">{po.line_count}</TableCell>
                        <TableCell className="text-right font-medium">
                          R{po.total_value.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            asChild
                          >
                            <Link href={`/purchasing/purchase-orders/${po.purchase_order_id}`}>
                              Review
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )
          ) : awaitingLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !filteredAwaitingItems.length ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-500 mb-3" />
              {hasAnyFilter && awaitingItems && awaitingItems.length > 0 ? (
                <>
                  <p className="text-lg font-medium">No matching items</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    No items match this filter.
                  </p>
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={clearAllFilters}
                  >
                    Clear Filter{activeFilter !== 'all' && supplierFilter ? 's' : ''}
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-lg font-medium">All caught up!</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    No items are currently awaiting receipt.
                  </p>
                  <Button variant="outline" className="mt-4" asChild>
                    <Link href="/purchasing/purchase-orders">View All Orders</Link>
                  </Button>
                </>
              )}
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Component</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>PO</TableHead>
                      <TableHead className="text-right">Ordered</TableHead>
                      <TableHead className="text-right">Owing</TableHead>
                      <TableHead className="text-right w-[120px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAwaitingItems.slice(0, visibleItems).map((item) => (
                      <TableRow key={item.order_id} className="group hover:bg-muted/50">
                        <TableCell>
                          <div className="font-medium">{item.component_code}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                            {item.component_description}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              'cursor-pointer transition-all hover:shadow-sm hover:scale-105',
                              supplierFilter === item.supplier_name &&
                                'ring-2 ring-primary/30 bg-primary/5'
                            )}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSupplierFilter(item.supplier_name);
                            }}
                            role="button"
                            aria-label={`Filter by ${item.supplier_name}`}
                          >
                            {item.supplier_name}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/purchasing/purchase-orders/${item.purchase_order_id}`}
                            className="text-primary hover:underline text-sm"
                          >
                            {formatQNumber(item.q_number)}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right">{item.order_quantity}</TableCell>
                        <TableCell className="text-right">
                          <span className="text-destructive font-semibold">{item.owing}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              onClick={() => handleReceive(item)}
                            >
                              <Download className="h-3.5 w-3.5 mr-1" />
                              Receive
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden space-y-3">
                {filteredAwaitingItems.slice(0, visibleItems).map((item) => (
                  <div
                    key={item.order_id}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm">{item.component_code}</div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        <button
                          className={cn(
                            'hover:text-primary transition-colors',
                            supplierFilter === item.supplier_name && 'text-primary font-medium'
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSupplierFilter(item.supplier_name);
                          }}
                        >
                          {item.supplier_name}
                        </button>
                        <span>|</span>
                        <Link
                          href={`/purchasing/purchase-orders/${item.purchase_order_id}`}
                          className="text-primary hover:underline"
                        >
                          {formatQNumber(item.q_number)}
                        </Link>
                        <span>|</span>
                        <span>
                          Owing: <span className="text-destructive font-semibold">{item.owing}</span>
                        </span>
                      </div>
                    </div>
                    <Button size="sm" onClick={() => handleReceive(item)} className="ml-2">
                      <Download className="h-3.5 w-3.5 mr-1" />
                      Receive
                    </Button>
                  </div>
                ))}
              </div>

              {/* Load More */}
              {filteredAwaitingItems.length > visibleItems && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <p className="text-sm text-muted-foreground">
                    Showing {Math.min(visibleItems, filteredAwaitingItems.length)} of{' '}
                    {filteredAwaitingItems.length} item{filteredAwaitingItems.length !== 1 ? 's' : ''}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setVisibleItems((prev) => prev + ITEMS_PER_PAGE)}
                  >
                    Load More
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
