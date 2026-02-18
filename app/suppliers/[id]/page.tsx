'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupplier, updateSupplier, deleteSupplier } from '@/lib/api/suppliers';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/quotes';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Package, DollarSign, Clock, Layers, AlertCircle, Trash2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { Suspense, lazy, useMemo, useState, useEffect, useCallback } from 'react';
import { OpenOrdersModal } from '@/components/features/suppliers/open-orders-modal';
import type { SupplierPurchaseOrder } from '@/types/suppliers';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// Lazy load tab components
const SupplierForm = lazy(() => import('@/components/features/suppliers/supplier-form').then(m => ({ default: m.SupplierForm })));
const SupplierEmails = lazy(() => import('@/components/features/suppliers/supplier-emails').then(m => ({ default: m.SupplierEmails })));
const SupplierComponents = lazy(() => import('@/components/features/suppliers/supplier-components').then(m => ({ default: m.SupplierComponents })));
const SupplierPricelists = lazy(() => import('@/components/features/suppliers/supplier-pricelists').then(m => ({ default: m.SupplierPricelists })));
const SupplierOrders = lazy(() => import('@/components/features/suppliers/supplier-orders').then(m => ({ default: m.SupplierOrders })));
const SupplierReports = lazy(() => import('@/components/features/suppliers/supplier-reports').then(m => ({ default: m.SupplierReports })));

// Loading skeleton for tabs
const TabSkeleton = () => (
  <div className="space-y-4">
    <div className="border rounded-lg p-6 bg-card">
      <div className="space-y-4">
        <div className="h-4 bg-muted animate-pulse rounded w-1/4" />
        <div className="h-10 bg-muted animate-pulse rounded" />
        <div className="h-4 bg-muted animate-pulse rounded w-1/3" />
        <div className="h-10 bg-muted animate-pulse rounded" />
      </div>
    </div>
  </div>
);

// Metric card component
interface MetricCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  subtitle?: string;
  subtitleClassName?: string;
  detail?: string;
  detailClassName?: string;
  onCardClick?: () => void;
  cardActionLabel?: string;
  onIconClick?: () => void;
  iconActionLabel?: string;
  isLoading?: boolean;
}

function MetricCard({
  title,
  value,
  icon,
  subtitle,
  subtitleClassName,
  detail,
  detailClassName,
  onCardClick,
  cardActionLabel,
  onIconClick,
  iconActionLabel,
  isLoading,
}: MetricCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <div className="h-4 w-20 bg-muted animate-pulse rounded" />
              <div className="h-7 w-24 bg-muted animate-pulse rounded" />
            </div>
            <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          {onCardClick ? (
            <button
              type="button"
              onClick={onCardClick}
              aria-label={cardActionLabel || `${title} details`}
              className="flex-1 text-left"
            >
              <p className="text-sm text-muted-foreground">{title}</p>
              <p className="text-2xl font-bold">{value}</p>
              {subtitle && <p className={`text-xs ${subtitleClassName || 'text-muted-foreground'}`}>{subtitle}</p>}
              {detail && <p className={`text-xs ${detailClassName || 'text-muted-foreground'}`}>{detail}</p>}
            </button>
          ) : (
            <div>
              <p className="text-sm text-muted-foreground">{title}</p>
              <p className="text-2xl font-bold">{value}</p>
              {subtitle && <p className={`text-xs ${subtitleClassName || 'text-muted-foreground'}`}>{subtitle}</p>}
              {detail && <p className={`text-xs ${detailClassName || 'text-muted-foreground'}`}>{detail}</p>}
            </div>
          )}
          {onIconClick ? (
            <button
              type="button"
              onClick={onIconClick}
              aria-label={iconActionLabel || `${title} details`}
              className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary transition-colors hover:bg-primary/20"
            >
              {icon}
            </button>
          ) : (
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              {icon}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type SupplierMetricRange = '30d' | '90d' | 'ytd' | '12m';

const METRIC_RANGE_OPTIONS: Array<{ key: SupplierMetricRange; label: string; description: string }> = [
  { key: '30d', label: '30D', description: 'Last 30 days' },
  { key: '90d', label: '90D', description: 'Last 90 days' },
  { key: 'ytd', label: 'YTD', description: 'Year to date' },
  { key: '12m', label: '12M', description: 'Last 12 months' },
];

function getOrderDate(order: SupplierPurchaseOrder): Date | null {
  const raw = order.order_date || order.created_at;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getOrderSpend(order: SupplierPurchaseOrder): number {
  return order.supplier_orders.reduce((lineSum, line) => {
    return lineSum + (line.order_quantity * (line.supplier_component?.price || 0));
  }, 0);
}

function getMetricWindow(range: SupplierMetricRange, now: Date) {
  const end = new Date(now);
  let start = new Date(end);
  let previousStart = new Date(end);
  let previousEnd = new Date(end);
  let label = '';

  switch (range) {
    case '30d': {
      label = 'Last 30 days';
      start.setDate(start.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      const durationMs = end.getTime() - start.getTime();
      previousEnd = new Date(start.getTime() - 1);
      previousStart = new Date(previousEnd.getTime() - durationMs);
      break;
    }
    case '90d': {
      label = 'Last 90 days';
      start.setDate(start.getDate() - 89);
      start.setHours(0, 0, 0, 0);
      const durationMs = end.getTime() - start.getTime();
      previousEnd = new Date(start.getTime() - 1);
      previousStart = new Date(previousEnd.getTime() - durationMs);
      break;
    }
    case 'ytd': {
      label = 'Year to date';
      start = new Date(end.getFullYear(), 0, 1);
      const durationMs = end.getTime() - start.getTime();
      previousStart = new Date(end.getFullYear() - 1, 0, 1);
      previousEnd = new Date(previousStart.getTime() + durationMs);
      break;
    }
    case '12m':
    default: {
      label = 'Last 12 months';
      start = new Date(end.getFullYear(), end.getMonth() - 11, 1);
      const durationMs = end.getTime() - start.getTime();
      previousEnd = new Date(start.getTime() - 1);
      previousStart = new Date(previousEnd.getTime() - durationMs);
      break;
    }
  }

  return { start, end, previousStart, previousEnd, label };
}

function formatPeriodDelta(current: number, previous: number) {
  if (previous === 0 && current === 0) {
    return { text: 'No change vs previous period', tone: 'neutral' as const };
  }

  if (previous === 0) {
    return { text: 'New activity vs previous period', tone: 'positive' as const };
  }

  const percent = ((current - previous) / previous) * 100;
  if (Math.abs(percent) < 0.5) {
    return { text: 'Flat vs previous period', tone: 'neutral' as const };
  }

  return {
    text: `${percent > 0 ? '+' : ''}${percent.toFixed(1)}% vs previous period`,
    tone: percent > 0 ? ('positive' as const) : ('negative' as const),
  };
}

function getToneClassName(tone: 'positive' | 'negative' | 'neutral') {
  if (tone === 'positive') return 'text-emerald-600';
  if (tone === 'negative') return 'text-rose-600';
  return 'text-muted-foreground';
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getMonthBucket(date: Date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}`;
}

export default function SupplierDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const supplierId = Number(params.id);
  const tabParam = searchParams?.get('tab');
  const allowedTabs = new Set(['details', 'components', 'pricelists', 'orders', 'reports']);
  const activeTab = allowedTabs.has(tabParam || '') ? (tabParam as string) : 'details';
  const [selectedRange, setSelectedRange] = useState<SupplierMetricRange>('12m');
  const [openOrdersModalOpen, setOpenOrdersModalOpen] = useState(false);
  const [spendDialogOpen, setSpendDialogOpen] = useState(false);
  const [selectedSpendBucket, setSelectedSpendBucket] = useState<string>('');

  const { data: supplier, isLoading, error } = useQuery({
    queryKey: ['supplier', supplierId],
    queryFn: () => getSupplier(supplierId),
  });

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const updateMutation = useMutation({
    mutationFn: (data: Parameters<typeof updateSupplier>[1]) =>
      updateSupplier(supplierId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier', supplierId] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteSupplier(supplierId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      router.push('/suppliers');
    },
    onError: (error: Error) => {
      setDeleteDialogOpen(false);
      toast({ title: 'Cannot delete supplier', description: error.message, variant: 'destructive' });
    },
  });

  // Fetch purchase orders for metrics
  const { data: purchaseOrders = [], isLoading: isLoadingOrders } = useQuery({
    queryKey: ['supplier-purchase-orders-metrics', supplierId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select(`
          purchase_order_id,
          order_date,
          created_at,
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
            supplier_order_customer_orders(
              order:orders(
                order_id,
                order_number,
                customer:customers(name)
              )
            ),
            receipts:supplier_order_receipts(
              receipt_date,
              quantity_received
            )
          )
        `)
        .eq('supplier_orders.suppliercomponents.supplier_id', supplierId)
        .order('order_date', { ascending: false });

      if (error) throw error;
      return (data || []) as SupplierPurchaseOrder[];
    },
    enabled: !!supplierId,
  });

  // Fetch component count for metrics
  const { data: componentCount = 0, isLoading: isLoadingComponents } = useQuery({
    queryKey: ['supplier-component-count', supplierId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('suppliercomponents')
        .select('*', { count: 'exact', head: true })
        .eq('supplier_id', supplierId);

      if (error) throw error;
      return count || 0;
    },
    enabled: !!supplierId,
  });

  // Calculate metrics
  const metrics = useMemo(() => {
    const now = new Date();
    const { start, end, previousStart, previousEnd, label } = getMetricWindow(selectedRange, now);

    const ordersWithDates = purchaseOrders
      .map((order) => ({ order, orderDate: getOrderDate(order) }))
      .filter((item): item is { order: SupplierPurchaseOrder; orderDate: Date } => item.orderDate !== null);

    const currentPeriodOrders = ordersWithDates
      .filter(({ orderDate }) => orderDate >= start && orderDate <= end)
      .map(({ order }) => order);
    const previousPeriodOrders = ordersWithDates
      .filter(({ orderDate }) => orderDate >= previousStart && orderDate <= previousEnd)
      .map(({ order }) => order);

    const totalOrders = currentPeriodOrders.length;
    const previousTotalOrders = previousPeriodOrders.length;

    const totalSpend = currentPeriodOrders.reduce((sum, order) => sum + getOrderSpend(order), 0);
    const previousTotalSpend = previousPeriodOrders.reduce((sum, order) => sum + getOrderSpend(order), 0);
    const ordersDelta = formatPeriodDelta(totalOrders, previousTotalOrders);
    const spendDelta = formatPeriodDelta(totalSpend, previousTotalSpend);

    // Calculate outstanding orders (orders with items not fully received)
    let outstandingOrders = 0;
    let outstandingValue = 0;
    let overdueLines = 0;
    let dueSoonLines = 0;
    let futureLines = 0;

    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);

    purchaseOrders.forEach(order => {
      const statusName = order.status?.status_name?.toLowerCase() || '';
      const orderDate = getOrderDate(order);
      // Only count as outstanding if not fully received or cancelled
      if (statusName !== 'fully received' && statusName !== 'cancelled') {
        const hasOutstanding = order.supplier_orders.some(line => line.total_received < line.order_quantity);
        if (hasOutstanding) {
          outstandingOrders++;
          order.supplier_orders.forEach(line => {
            const outstandingQty = line.order_quantity - line.total_received;
            if (outstandingQty > 0) {
              outstandingValue += outstandingQty * (line.supplier_component?.price || 0);

              const leadTime = line.supplier_component?.lead_time || 0;
              if (orderDate) {
                const dueDate = new Date(orderDate);
                dueDate.setDate(dueDate.getDate() + leadTime);
                dueDate.setHours(0, 0, 0, 0);

                if (dueDate < today) {
                  overdueLines++;
                } else if (dueDate <= nextWeek) {
                  dueSoonLines++;
                } else {
                  futureLines++;
                }
              } else {
                futureLines++;
              }
            }
          });
        }
      }
    });

    // Get last order date
    const lastOrderDate = ordersWithDates.reduce<Date | null>((latest, current) => {
      if (!latest || current.orderDate > latest) return current.orderDate;
      return latest;
    }, null);
    const daysSinceLastOrder = lastOrderDate
      ? Math.max(0, Math.floor((now.getTime() - lastOrderDate.getTime()) / (1000 * 60 * 60 * 24)))
      : null;

    // Last 12 months monthly trend for spend chart
    const chartStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const monthlySpendData = Array.from({ length: 12 }).map((_, monthOffset) => {
      const monthDate = new Date(chartStart.getFullYear(), chartStart.getMonth() + monthOffset, 1);
      return {
        bucket: `${monthDate.getFullYear()}-${monthDate.getMonth() + 1}`,
        month: monthDate.toLocaleDateString('en-ZA', { month: 'short' }),
        label: monthDate.toLocaleDateString('en-ZA', { month: 'short', year: '2-digit' }),
        spend: 0,
        orders: 0,
      };
    });

    ordersWithDates.forEach(({ order, orderDate }) => {
      const monthIndex =
        (orderDate.getFullYear() - chartStart.getFullYear()) * 12 +
        (orderDate.getMonth() - chartStart.getMonth());

      if (monthIndex >= 0 && monthIndex < monthlySpendData.length) {
        monthlySpendData[monthIndex].spend += getOrderSpend(order);
        monthlySpendData[monthIndex].orders += 1;
      }
    });

    const ordersByMonth = new Map<string, SupplierPurchaseOrder[]>();
    ordersWithDates.forEach(({ order, orderDate }) => {
      const bucket = getMonthBucket(orderDate);
      const existing = ordersByMonth.get(bucket);
      if (existing) {
        existing.push(order);
      } else {
        ordersByMonth.set(bucket, [order]);
      }
    });

    const totalSpendInChart = monthlySpendData.reduce((sum, month) => sum + month.spend, 0);
    const averageMonthlySpend = totalSpendInChart / monthlySpendData.length;
    const peakMonth = monthlySpendData.reduce<(typeof monthlySpendData)[number] | null>((max, month) => {
      if (!max || month.spend > max.spend) return month;
      return max;
    }, null);

    return {
      totalOrders,
      totalSpend,
      ordersDelta,
      spendDelta,
      outstandingOrders,
      outstandingValue,
      outstandingSplit: {
        overdue: overdueLines,
        dueSoon: dueSoonLines,
        future: futureLines,
      },
      lastOrderDate,
      daysSinceLastOrder,
      rangeLabel: label,
      monthlySpendData,
      ordersByMonth,
      totalSpendInChart,
      averageMonthlySpend,
      peakMonth,
    };
  }, [purchaseOrders, selectedRange]);

  const defaultSpendBucket = useMemo(() => {
    const latestWithSpend = [...metrics.monthlySpendData].reverse().find((month) => month.spend > 0);
    return latestWithSpend?.bucket || metrics.monthlySpendData[metrics.monthlySpendData.length - 1]?.bucket || '';
  }, [metrics.monthlySpendData]);

  useEffect(() => {
    if (!selectedSpendBucket) {
      setSelectedSpendBucket(defaultSpendBucket);
      return;
    }

    const exists = metrics.monthlySpendData.some((month) => month.bucket === selectedSpendBucket);
    if (!exists) {
      setSelectedSpendBucket(defaultSpendBucket);
    }
  }, [defaultSpendBucket, selectedSpendBucket, metrics.monthlySpendData]);

  const selectedMonthSummary = useMemo(() => {
    const month = metrics.monthlySpendData.find((item) => item.bucket === selectedSpendBucket);
    return month || null;
  }, [metrics.monthlySpendData, selectedSpendBucket]);

  const monthDrilldown = useMemo(() => {
    const monthOrders = metrics.ordersByMonth.get(selectedSpendBucket) || [];

    const componentsMap = new Map<string, { code: string; description: string; spend: number; qty: number }>();
    const customerOrdersMap = new Map<string, { id: string; label: string; spend: number; lines: number }>();

    monthOrders.forEach((order) => {
      order.supplier_orders.forEach((line) => {
        const lineSpend = line.order_quantity * (line.supplier_component?.price || 0);
        const componentCode = line.supplier_component?.component?.internal_code || line.supplier_component?.supplier_code || 'Unknown';
        const componentDescription = line.supplier_component?.component?.description || '';

        const existingComponent = componentsMap.get(componentCode);
        if (existingComponent) {
          existingComponent.spend += lineSpend;
          existingComponent.qty += line.order_quantity;
        } else {
          componentsMap.set(componentCode, {
            code: componentCode,
            description: componentDescription,
            spend: lineSpend,
            qty: line.order_quantity,
          });
        }

        const linkedOrders = (line.supplier_order_customer_orders || [])
          .map((link) => link.order)
          .filter((orderLink): orderLink is { order_id: number; order_number: string | null; customer: { name: string } | null } => Boolean(orderLink));

        if (linkedOrders.length > 0) {
          const allocatedSpend = lineSpend / linkedOrders.length;
          linkedOrders.forEach((linkedOrder) => {
            const key = String(linkedOrder.order_id);
            const label = linkedOrder.customer?.name
              ? `${linkedOrder.order_number || `Order ${linkedOrder.order_id}`} (${linkedOrder.customer.name})`
              : (linkedOrder.order_number || `Order ${linkedOrder.order_id}`);
            const existingOrder = customerOrdersMap.get(key);
            if (existingOrder) {
              existingOrder.spend += allocatedSpend;
              existingOrder.lines += 1;
            } else {
              customerOrdersMap.set(key, { id: key, label, spend: allocatedSpend, lines: 1 });
            }
          });
        } else {
          const unlinkedKey = 'unlinked';
          const existingOrder = customerOrdersMap.get(unlinkedKey);
          if (existingOrder) {
            existingOrder.spend += lineSpend;
            existingOrder.lines += 1;
          } else {
            customerOrdersMap.set(unlinkedKey, { id: unlinkedKey, label: 'Unlinked to customer order', spend: lineSpend, lines: 1 });
          }
        }
      });
    });

    const topComponents = Array.from(componentsMap.values())
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 5);
    const topCustomerOrders = Array.from(customerOrdersMap.values())
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 5);

    return { topComponents, topCustomerOrders };
  }, [metrics.ordersByMonth, selectedSpendBucket]);

  const isLoadingMetrics = isLoadingOrders || isLoadingComponents;

  const pushTabWithParams = useCallback((tabValue: string, updates: Record<string, string | null>) => {
    const nextParams = new URLSearchParams(searchParams?.toString() || '');
    nextParams.set('tab', tabValue);

    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === '') {
        nextParams.delete(key);
      } else {
        nextParams.set(key, value);
      }
    });

    router.push(`/suppliers/${supplierId}?${nextParams.toString()}`);
  }, [router, searchParams, supplierId]);

  const openOrdersWithRange = useCallback((range: SupplierMetricRange) => {
    const { start, end } = getMetricWindow(range, new Date());
    pushTabWithParams('orders', {
      ordersStatus: 'all',
      ordersDateType: 'order',
      ordersStart: toIsoDate(start),
      ordersEnd: toIsoDate(end),
      ordersQ: null,
    });
  }, [pushTabWithParams]);

  const openOutstandingOrders = useCallback(() => {
    pushTabWithParams('orders', {
      ordersStatus: 'open',
      ordersDateType: 'order',
      ordersStart: null,
      ordersEnd: null,
      ordersQ: null,
    });
  }, [pushTabWithParams]);

  const openLastOrderInOrdersTab = useCallback(() => {
    if (!metrics.lastOrderDate) {
      pushTabWithParams('orders', {
        ordersStatus: 'all',
        ordersDateType: 'order',
        ordersStart: null,
        ordersEnd: null,
        ordersQ: null,
      });
      return;
    }

    const day = toIsoDate(metrics.lastOrderDate);
    pushTabWithParams('orders', {
      ordersStatus: 'all',
      ordersDateType: 'order',
      ordersStart: day,
      ordersEnd: day,
      ordersQ: null,
    });
  }, [metrics.lastOrderDate, pushTabWithParams]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <div className="h-10 w-32 bg-muted animate-pulse rounded" />
        </div>
        <div>
          <div className="h-9 w-64 bg-muted animate-pulse rounded mb-2" />
        </div>
        {/* Metrics skeleton */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <MetricCard key={i} title="" value="" icon={null} isLoading={true} />
          ))}
        </div>
        <div className="space-y-4">
          <div className="flex gap-2">
            <div className="h-10 w-24 bg-muted animate-pulse rounded" />
            <div className="h-10 w-24 bg-muted animate-pulse rounded" />
            <div className="h-10 w-32 bg-muted animate-pulse rounded" />
            <div className="h-10 w-32 bg-muted animate-pulse rounded" />
          </div>
          <TabSkeleton />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Suppliers
          </Button>
        </div>
        <div className="border border-destructive/50 rounded-lg p-6 bg-destructive/10">
          <h2 className="text-lg font-semibold text-destructive mb-2">Error loading supplier</h2>
          <p className="text-sm text-muted-foreground">{error.message}</p>
        </div>
      </div>
    );
  }

  if (!supplier) {
    return (
      <div className="space-y-6">
        <div>
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Suppliers
          </Button>
        </div>
        <div className="border rounded-lg p-6 bg-card">
          <h2 className="text-lg font-semibold mb-2">Supplier not found</h2>
          <p className="text-sm text-muted-foreground">The supplier you're looking for doesn't exist or has been deleted.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Suppliers
        </Button>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">{supplier.name}</h1>
          {!supplier.is_active && (
            <Badge variant="secondary" className="text-xs">Inactive</Badge>
          )}
          <div className="flex items-center gap-2 ml-4">
            <Switch
              checked={supplier.is_active}
              onCheckedChange={(checked) => {
                updateMutation.mutate({ is_active: checked });
              }}
              disabled={updateMutation.isPending}
            />
            <span className="text-sm text-muted-foreground">
              {supplier.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setDeleteDialogOpen(true)}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete Supplier
        </Button>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium">Metrics period</p>
          <p className="text-xs text-muted-foreground">
            Total orders and spend are currently showing {metrics.rangeLabel.toLowerCase()}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {METRIC_RANGE_OPTIONS.map((option) => (
            <Button
              key={option.key}
              type="button"
              size="sm"
              variant={selectedRange === option.key ? 'default' : 'outline'}
              onClick={() => setSelectedRange(option.key)}
              aria-label={option.description}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <MetricCard
          title="Total Orders"
          value={metrics.totalOrders.toString()}
          icon={<Package className="h-5 w-5" />}
          subtitle={metrics.ordersDelta.text}
          subtitleClassName={getToneClassName(metrics.ordersDelta.tone)}
          onCardClick={() => openOrdersWithRange(selectedRange)}
          cardActionLabel="Open orders for selected period"
          isLoading={isLoadingMetrics}
        />
        <MetricCard
          title="Total Spend"
          value={formatCurrency(metrics.totalSpend)}
          icon={<DollarSign className="h-5 w-5" />}
          subtitle={metrics.spendDelta.text}
          subtitleClassName={getToneClassName(metrics.spendDelta.tone)}
          onCardClick={() => openOrdersWithRange(selectedRange)}
          cardActionLabel="Open orders for selected spend period"
          onIconClick={() => setSpendDialogOpen(true)}
          iconActionLabel="Open spend trend chart"
          isLoading={isLoadingMetrics}
        />
        <MetricCard
          title="Outstanding"
          value={metrics.outstandingOrders.toString()}
          icon={<AlertCircle className="h-5 w-5" />}
          subtitle={metrics.outstandingValue > 0 ? `${formatCurrency(metrics.outstandingValue)} open value` : 'No open value'}
          detail={`${metrics.outstandingSplit.overdue} overdue • ${metrics.outstandingSplit.dueSoon} due 7d • ${metrics.outstandingSplit.future} later`}
          detailClassName={metrics.outstandingSplit.overdue > 0 ? 'text-rose-600' : 'text-muted-foreground'}
          onCardClick={openOutstandingOrders}
          cardActionLabel="Open outstanding orders in Orders tab"
          onIconClick={() => setOpenOrdersModalOpen(true)}
          iconActionLabel="Open outstanding orders details"
          isLoading={isLoadingMetrics}
        />
        <MetricCard
          title="Components"
          value={componentCount.toString()}
          icon={<Layers className="h-5 w-5" />}
          onCardClick={() => pushTabWithParams('components', {})}
          cardActionLabel="Open components tab"
          isLoading={isLoadingMetrics}
        />
        <MetricCard
          title="Last Order"
          value={metrics.lastOrderDate
            ? metrics.lastOrderDate.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
            : 'Never'}
          icon={<Clock className="h-5 w-5" />}
          subtitle={metrics.daysSinceLastOrder !== null ? `${metrics.daysSinceLastOrder} day${metrics.daysSinceLastOrder === 1 ? '' : 's'} ago` : undefined}
          onCardClick={openLastOrderInOrdersTab}
          cardActionLabel="Open the last order in Orders tab"
          isLoading={isLoadingMetrics}
        />
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          pushTabWithParams(value, {});
        }}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="components">Components</TabsTrigger>
          <TabsTrigger value="pricelists">Price Lists</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="space-y-4">
          <Suspense fallback={<TabSkeleton />}>
            <div className="border rounded-lg p-6 bg-card">
              <SupplierForm
                supplier={supplier}
                onSubmit={async (data) => {
                  const { emails, ...supplierData } = data;
                  await updateMutation.mutateAsync(supplierData);
                }}
              />
            </div>
            <div className="border rounded-lg p-6 bg-card">
              <h2 className="text-lg font-semibold mb-4">Emails</h2>
              <SupplierEmails supplier={supplier} />
            </div>
          </Suspense>
        </TabsContent>

        <TabsContent value="components" className="space-y-4">
          <Suspense fallback={<TabSkeleton />}>
            <SupplierComponents supplier={supplier} />
          </Suspense>
        </TabsContent>

        <TabsContent value="pricelists" className="space-y-4">
          <Suspense fallback={<TabSkeleton />}>
            <SupplierPricelists supplier={supplier} />
          </Suspense>
        </TabsContent>

        <TabsContent value="orders" className="space-y-4">
          <Suspense fallback={<TabSkeleton />}>
            <SupplierOrders supplier={supplier} />
          </Suspense>
        </TabsContent>

        <TabsContent value="reports" className="space-y-4">
          <Suspense fallback={<TabSkeleton />}>
            <SupplierReports supplier={supplier} />
          </Suspense>
        </TabsContent>
      </Tabs>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Supplier</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{supplier.name}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                deleteMutation.mutate();
              }}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <OpenOrdersModal
        supplierId={supplierId}
        supplierName={supplier.name}
        open={openOrdersModalOpen}
        onClose={() => setOpenOrdersModalOpen(false)}
        showOnlyOutstanding
      />

      <Dialog open={spendDialogOpen} onOpenChange={setSpendDialogOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Spend Trend</DialogTitle>
            <DialogDescription>
              Monthly spend and order count over the last 12 months for {supplier.name}.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">12M Spend</p>
              <p className="text-lg font-semibold">{formatCurrency(metrics.totalSpendInChart)}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Avg / Month</p>
              <p className="text-lg font-semibold">{formatCurrency(metrics.averageMonthlySpend)}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Peak Month</p>
              <p className="text-lg font-semibold">
                {metrics.peakMonth ? `${metrics.peakMonth.label} (${formatCurrency(metrics.peakMonth.spend)})` : 'No spend'}
              </p>
            </div>
          </div>

          <div className="h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={metrics.monthlySpendData}
                onClick={(state) => {
                  const clickedBucket = state?.activePayload?.[0]?.payload?.bucket as string | undefined;
                  if (clickedBucket) {
                    setSelectedSpendBucket(clickedBucket);
                  }
                }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} className="text-muted-foreground" />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(value) => `R${Math.round(Number(value) / 1000)}k`}
                  className="text-muted-foreground"
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 12 }}
                  allowDecimals={false}
                  className="text-muted-foreground"
                />
                <Tooltip
                  formatter={(value: number | string, name: string) => {
                    if (name === 'spend') return [formatCurrency(Number(value)), 'Spend'];
                    return [Number(value), 'Orders'];
                  }}
                  labelFormatter={(label, payload) => {
                    const monthLabel = payload?.[0]?.payload?.label as string | undefined;
                    return monthLabel || String(label);
                  }}
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                />
                <Bar
                  yAxisId="left"
                  dataKey="spend"
                  name="spend"
                  fill="hsl(var(--primary))"
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="orders"
                  name="orders"
                  stroke="hsl(var(--chart-3, 20 90% 50%))"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Click a month on the chart to view its spend breakdown.
            </p>
            <p className="text-sm font-medium">
              {selectedMonthSummary ? `Selected month: ${selectedMonthSummary.label}` : 'Selected month'}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium mb-2">Top Components (Selected Month)</p>
              {monthDrilldown.topComponents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No component spend for this month.</p>
              ) : (
                <div className="space-y-1.5">
                  {monthDrilldown.topComponents.map((component) => (
                    <div key={component.code} className="flex items-start justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{component.code}</p>
                        {component.description && (
                          <p className="text-xs text-muted-foreground truncate">{component.description}</p>
                        )}
                      </div>
                      <p className="font-medium whitespace-nowrap">{formatCurrency(component.spend)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium mb-2">Top Customer Orders (Selected Month)</p>
              {monthDrilldown.topCustomerOrders.length === 0 ? (
                <p className="text-sm text-muted-foreground">No linked customer orders for this month.</p>
              ) : (
                <div className="space-y-1.5">
                  {monthDrilldown.topCustomerOrders.map((customerOrder) => (
                    <div key={customerOrder.id} className="flex items-start justify-between gap-3 text-sm">
                      <p className="font-medium min-w-0 truncate">{customerOrder.label}</p>
                      <p className="font-medium whitespace-nowrap">{formatCurrency(customerOrder.spend)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
