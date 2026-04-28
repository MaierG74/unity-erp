'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ClipboardList,
  ShoppingBag,
  SquareCheckBig,
  Truck,
} from 'lucide-react';

import {
  isLowStockItem,
  isOpenPurchaseOrder,
} from '@/app/dashboard/dashboard-logic';
import { supabase } from '@/lib/supabase';
import { fetchTodoList } from '@/lib/client/todos';
import { SO_STATUS } from '@/types/purchasing';

interface KPIData {
  openPOs: number;
  awaitingReceipt: number;
  lowStockCount: number;
  overdueTasks: number;
  activeSuppliers: number;
}

const KPI_QUERY_KEY = ['dashboard', 'kpi-summary'] as const;
const KPI_STALE_TIME = 60_000;

async function fetchKPIData(): Promise<KPIData> {
  const [poResult, outstandingResult, lowStockResult, todoResult] =
    await Promise.all([
      supabase
        .from('purchase_orders')
        .select(`
          purchase_order_id,
          status_id,
          supplier_orders(
            order_id,
            order_quantity,
            total_received,
            closed_quantity
          )
        `),
      supabase
        .from('supplier_orders')
        .select(
          `
          order_id,
          order_quantity,
          total_received,
          closed_quantity,
          purchase_orders!inner(status_id),
          supplier_component:suppliercomponents!inner(
            supplier:suppliers!inner(name)
          )
        `
        )
        .in('purchase_orders.status_id', [
          SO_STATUS.APPROVED,
          SO_STATUS.PARTIALLY_RECEIVED,
        ]),
      supabase
        .from('inventory')
        .select('inventory_id, quantity_on_hand, reorder_level')
        .gt('reorder_level', 0),
      fetchTodoList({ scope: 'assigned', includeCompleted: false, limit: 100 }),
    ]);

  if (poResult.error) throw poResult.error;
  if (outstandingResult.error) throw outstandingResult.error;
  if (lowStockResult.error) throw lowStockResult.error;

  const outstandingLines = (outstandingResult.data ?? []).filter(
    (row: any) =>
      Number(row.order_quantity || 0) - Number(row.total_received || 0) - Number(row.closed_quantity || 0) > 0
  );

  const awaitingReceipt = outstandingLines.filter(
    (row: any) => Number(row.total_received || 0) <= 0
  ).length;

  const activeSuppliers = new Set(
    outstandingLines.map(
      (row: any) => (row.supplier_component as any)?.supplier?.name
    ).filter(Boolean)
  ).size;

  const lowStockItems = (lowStockResult.data ?? []).filter(
    (item: any) => isLowStockItem(item)
  );

  const now = new Date();
  const overdueTodos = (todoResult?.todos ?? []).filter((todo) => {
    if (!todo.dueAt) return false;
    if (todo.status === 'done' || todo.status === 'archived') return false;
    return new Date(todo.dueAt) < now;
  });

  return {
    openPOs: (poResult.data ?? []).filter((order: any) =>
      isOpenPurchaseOrder(order)
    ).length,
    awaitingReceipt,
    lowStockCount: lowStockItems.length,
    overdueTasks: overdueTodos.length,
    activeSuppliers,
  };
}

export function DashboardKPICards() {
  const { data, isLoading } = useQuery({
    queryKey: KPI_QUERY_KEY,
    queryFn: fetchKPIData,
    staleTime: KPI_STALE_TIME,
  });

  const kpis = [
    {
      label: 'Outstanding POs',
      value: data?.openPOs ?? 0,
      icon: ClipboardList,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
      borderColor: 'border-l-primary/60',
    },
    {
      label: 'Items Awaiting Delivery',
      value: data?.awaitingReceipt ?? 0,
      icon: Truck,
      color: 'text-info',
      bgColor: 'bg-info/10',
      borderColor: 'border-l-info/60',
    },
    {
      label: 'Low Stock Items',
      value: data?.lowStockCount ?? 0,
      icon: AlertTriangle,
      color: data?.lowStockCount ? 'text-warning' : 'text-muted-foreground',
      bgColor: data?.lowStockCount ? 'bg-warning/10' : 'bg-muted/10',
      borderColor: data?.lowStockCount
        ? 'border-l-warning/60'
        : 'border-l-muted/60',
    },
    {
      label: 'Overdue Tasks',
      value: data?.overdueTasks ?? 0,
      icon: SquareCheckBig,
      color: data?.overdueTasks ? 'text-destructive' : 'text-success',
      bgColor: data?.overdueTasks ? 'bg-destructive/10' : 'bg-success/10',
      borderColor: data?.overdueTasks
        ? 'border-l-destructive/60'
        : 'border-l-success/60',
    },
    {
      label: 'Active Suppliers',
      value: data?.activeSuppliers ?? 0,
      icon: ShoppingBag,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
      borderColor: 'border-l-primary/60',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {kpis.map((kpi, index) => (
        <div
          key={kpi.label}
          className={`group relative overflow-hidden rounded-xl border border-l-[3px] ${kpi.borderColor} bg-card p-4 transition-all duration-200 hover:shadow-lg hover:shadow-primary/5`}
          style={{ animationDelay: `${index * 60}ms` }}
        >
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                {kpi.label}
              </p>
              <p className="text-2xl font-bold tabular-nums tracking-tight">
                {isLoading ? (
                  <span className="inline-block h-7 w-10 animate-pulse rounded bg-muted" />
                ) : (
                  kpi.value
                )}
              </p>
            </div>
            <div className={`rounded-lg p-2 ${kpi.bgColor}`}>
              <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
            </div>
          </div>
          {/* Subtle glow on hover */}
          <div className="pointer-events-none absolute inset-0 rounded-xl opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-linear-to-br from-primary/[0.03] to-transparent" />
        </div>
      ))}
    </div>
  );
}

/** Hook to expose KPI summary data for the greeting banner.
 *  Shares the same queryKey + queryFn as DashboardKPICards so TanStack Query
 *  deduplicates — only one network request fires regardless of call order. */
export function useDashboardKPISummary() {
  return useQuery({
    queryKey: KPI_QUERY_KEY,
    queryFn: fetchKPIData,
    staleTime: KPI_STALE_TIME,
  });
}
