'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ClipboardList, PackageCheck, ShoppingBag, Truck } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { SO_STATUS } from '@/types/purchasing';

interface OutstandingPurchaseLine {
  orderId: number;
  purchaseOrderId: number;
  qNumber: string | null;
  supplierName: string;
  componentCode: string;
  componentDescription: string;
  orderedQuantity: number;
  totalReceived: number;
  owingQuantity: number;
}

interface PendingApprovalOrder {
  purchaseOrderId: number;
  createdAt: string | null;
  supplierNames: string[];
  componentLabels: string[];
  lineCount: number;
  totalItems: number;
  totalValue: number;
}

interface PurchasingQueueSummary {
  pendingApprovalCount: number;
  pendingApprovalOrders: PendingApprovalOrder[];
  awaitingReceiptCount: number;
  partialReceiptCount: number;
  activeSupplierCount: number;
  lines: OutstandingPurchaseLine[];
}

interface SupplierQueueSummary {
  supplierName: string;
  purchaseOrderCount: number;
  lineCount: number;
  awaitingCount: number;
  partialCount: number;
}

type PurchasingQueueFilter = 'all' | 'pending' | 'awaiting' | 'partial' | 'suppliers';

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatComponentLabel(component?: {
  internal_code?: string | null;
  description?: string | null;
} | null) {
  const code = component?.internal_code?.trim();
  const description = component?.description?.trim();

  if (code && description) {
    return `${code} - ${description}`;
  }

  return description || code || 'Unknown component';
}

function summarizeComponentLabels(labels: string[]) {
  if (labels.length === 0) return 'Unknown component';
  if (labels.length === 1) return labels[0];
  return `${labels[0]} +${labels.length - 1} more`;
}

export function DashboardPurchasingWidget() {
  const [activeFilter, setActiveFilter] = useState<PurchasingQueueFilter>('all');

  const { data, isLoading, error } = useQuery<PurchasingQueueSummary>({
    queryKey: ['dashboard', 'purchasing-queue'],
    queryFn: async () => {
      const [{ data: outstandingRows, error: outstandingError }, pendingResult] =
        await Promise.all([
          supabase
            .from('supplier_orders')
            .select(
              `
              order_id,
              order_quantity,
              total_received,
              closed_quantity,
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
            `
            )
            .in('purchase_orders.status_id', [
              SO_STATUS.APPROVED,
              SO_STATUS.PARTIALLY_RECEIVED,
            ])
            .order('purchase_order_id', { ascending: false }),
          supabase
            .from('purchase_orders')
            .select(`
              purchase_order_id,
              created_at,
              supplier_orders(
                order_id,
                order_quantity,
                supplier_component:suppliercomponents(
                  price,
                  supplier:suppliers(name),
                  component:components(
                    internal_code,
                    description
                  )
                )
              )
            `)
            .in('status_id', [SO_STATUS.DRAFT, SO_STATUS.PENDING_APPROVAL])
            .order('created_at', { ascending: false }),
        ]);

      if (outstandingError) throw outstandingError;
      if (pendingResult.error) throw pendingResult.error;

      const pendingApprovalOrders: PendingApprovalOrder[] = (pendingResult.data ?? []).map(
        (po: any) => {
          const suppliers = new Set<string>();
          const componentLabels: string[] = [];
          let totalValue = 0;
          let totalItems = 0;

          for (const so of po.supplier_orders || []) {
            const supplierComponent = Array.isArray(so.supplier_component)
              ? so.supplier_component[0]
              : so.supplier_component;
            const supplier = Array.isArray(supplierComponent?.supplier)
              ? supplierComponent.supplier[0]
              : supplierComponent?.supplier;

            if (supplier?.name) suppliers.add(supplier.name);
            totalValue += Number(supplierComponent?.price || 0) * Number(so.order_quantity || 0);
            totalItems += Number(so.order_quantity || 0);
            componentLabels.push(
              formatComponentLabel(
                Array.isArray(supplierComponent?.component)
                  ? supplierComponent.component[0]
                  : supplierComponent?.component
              )
            );
          }

          return {
            purchaseOrderId: Number(po.purchase_order_id),
            createdAt: po.created_at ?? null,
            supplierNames: Array.from(suppliers),
            componentLabels,
            lineCount: (po.supplier_orders || []).length,
            totalItems,
            totalValue,
          };
        }
      );

      const lines: OutstandingPurchaseLine[] = (outstandingRows ?? [])
        .map((row: any) => {
          const owingQuantity =
            Number(row.order_quantity || 0) - Number(row.total_received || 0) - Number(row.closed_quantity || 0);

          return {
            orderId: Number(row.order_id),
            purchaseOrderId: Number((row.purchase_orders as any)?.purchase_order_id),
            qNumber: ((row.purchase_orders as any)?.q_number as string | null) ?? null,
            supplierName:
              (row.supplier_component as any)?.supplier?.name ?? 'Unknown supplier',
            componentCode:
              (row.supplier_component as any)?.component?.internal_code ?? 'Unknown',
            componentDescription:
              (row.supplier_component as any)?.component?.description ?? '',
            orderedQuantity: Number(row.order_quantity || 0),
            totalReceived: Number(row.total_received || 0),
            owingQuantity,
          };
        })
        .filter((line) => line.owingQuantity > 0);

      return {
        pendingApprovalCount: pendingApprovalOrders.length,
        pendingApprovalOrders,
        awaitingReceiptCount: lines.filter((line) => line.totalReceived <= 0).length,
        partialReceiptCount: lines.filter((line) => line.totalReceived > 0).length,
        activeSupplierCount: new Set(lines.map((line) => line.supplierName)).size,
        lines,
      };
    },
  });

  const awaitingLines = useMemo(
    () => (data?.lines ?? []).filter((line) => line.totalReceived <= 0),
    [data?.lines]
  );

  const partialLines = useMemo(
    () => (data?.lines ?? []).filter((line) => line.totalReceived > 0),
    [data?.lines]
  );

  const supplierSummaries = useMemo(() => {
    const grouped = new Map<string, SupplierQueueSummary>();

    for (const line of data?.lines ?? []) {
      const current = grouped.get(line.supplierName) ?? {
        supplierName: line.supplierName,
        purchaseOrderCount: 0,
        lineCount: 0,
        awaitingCount: 0,
        partialCount: 0,
      };

      current.lineCount += 1;
      if (line.totalReceived <= 0) {
        current.awaitingCount += 1;
      } else {
        current.partialCount += 1;
      }

      grouped.set(line.supplierName, current);
    }

    for (const summary of grouped.values()) {
      summary.purchaseOrderCount = new Set(
        (data?.lines ?? [])
          .filter((line) => line.supplierName === summary.supplierName)
          .map((line) => line.purchaseOrderId)
      ).size;
    }

    return Array.from(grouped.values()).sort((a, b) => {
      if (b.lineCount !== a.lineCount) return b.lineCount - a.lineCount;
      return a.supplierName.localeCompare(b.supplierName);
    });
  }, [data?.lines]);

  const summaryStats = [
    {
      icon: ClipboardList,
      label: 'Pending',
      value: data?.pendingApprovalCount ?? 0,
      color: 'text-warning',
      filter: 'pending' as const,
      helper: 'Show pending purchase orders in this widget',
    },
    {
      icon: Truck,
      label: 'Awaiting',
      value: data?.awaitingReceiptCount ?? 0,
      color: 'text-info',
      filter: 'awaiting' as const,
      helper: 'Show supplier lines awaiting their first delivery',
    },
    {
      icon: PackageCheck,
      label: 'Partial',
      value: data?.partialReceiptCount ?? 0,
      color: 'text-primary',
      filter: 'partial' as const,
      helper: 'Show partially received supplier lines',
    },
    {
      icon: ShoppingBag,
      label: 'Suppliers',
      value: data?.activeSupplierCount ?? 0,
      color: 'text-muted-foreground',
      filter: 'suppliers' as const,
      helper: 'Group the queue by supplier',
    },
  ];

  const visibleLines =
    activeFilter === 'awaiting'
      ? awaitingLines
      : activeFilter === 'partial'
        ? partialLines
        : data?.lines ?? [];

  const viewAllHref =
    activeFilter === 'pending'
      ? '/purchasing?filter=pending'
      : activeFilter === 'awaiting'
        ? '/purchasing?filter=approved'
        : activeFilter === 'partial'
          ? '/purchasing?filter=partialReceived'
          : activeFilter === 'suppliers'
            ? '/purchasing?focus=suppliers'
            : '/purchasing';

  const contentTitle =
    activeFilter === 'pending'
      ? 'Pending Approval'
      : activeFilter === 'awaiting'
        ? 'Awaiting Delivery'
        : activeFilter === 'partial'
          ? 'Partially Received'
          : activeFilter === 'suppliers'
            ? 'Supplier Breakdown'
            : 'Current Queue';

  const contentCount =
    activeFilter === 'pending'
      ? data?.pendingApprovalOrders.length ?? 0
      : activeFilter === 'suppliers'
        ? supplierSummaries.length
        : visibleLines.length;

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Purchasing Queue</h3>
        <Link
          href={viewAllHref}
          className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          View All <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="flex gap-1 border-b px-4 py-2.5">
        {summaryStats.map((stat) => {
          const content = (
            <>
              <stat.icon className={`h-3 w-3 ${stat.color}`} />
              <span className="font-semibold tabular-nums">
                {isLoading ? '–' : stat.value}
              </span>
              <span className="text-muted-foreground">{stat.label}</span>
            </>
          );

          return (
            <button
              key={stat.label}
              type="button"
              title={stat.helper}
              aria-pressed={activeFilter === stat.filter}
              onClick={() =>
                setActiveFilter((prev) => (prev === stat.filter ? 'all' : stat.filter))
              }
              className={cn(
                'flex items-center gap-1.5 rounded-full bg-muted/50 px-2.5 py-1 text-xs transition-colors hover:bg-muted',
                activeFilter === stat.filter && 'bg-primary/10 ring-1 ring-primary/30'
              )}
            >
              {content}
            </button>
          );
        })}
      </div>

      <div className="divide-y">
        {error ? (
          <div className="p-4 text-sm text-destructive">
            Failed to load the purchasing queue.
          </div>
        ) : isLoading ? (
          <>
            {[0, 1, 2].map((i) => (
              <div key={i} className="px-4 py-3">
                <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                <div className="mt-2 h-3 w-56 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </>
        ) : (
          <>
            <div className="flex items-center justify-between px-4 py-2 text-xs text-muted-foreground">
              <span>
                {contentTitle}
                {' · '}
                {contentCount} item{contentCount === 1 ? '' : 's'}
              </span>
              {activeFilter !== 'all' ? (
                <button
                  type="button"
                  onClick={() => setActiveFilter('all')}
                  className="font-medium text-primary hover:underline"
                >
                  Clear
                </button>
              ) : null}
            </div>
            {activeFilter === 'pending' ? (
              data?.pendingApprovalOrders.length ? (
                data.pendingApprovalOrders.slice(0, 5).map((order, i) => (
                  <div
                    key={order.purchaseOrderId}
                    className={`flex items-center justify-between gap-3 px-4 py-2.5 ${
                      i % 2 === 1 ? 'bg-muted/20' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {summarizeComponentLabels(order.componentLabels)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        PO #{order.purchaseOrderId}
                        {' · '}
                        {order.supplierNames.join(', ') || 'Unknown supplier'}
                        {' · '}
                        {order.lineCount} line{order.lineCount === 1 ? '' : 's'}
                        {' · '}
                        {formatCurrency(order.totalValue)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-xs">
                      <Link
                        href={`/purchasing/purchase-orders/${order.purchaseOrderId}`}
                        className="rounded-full bg-warning/10 px-2.5 py-1 font-medium text-warning hover:bg-warning/20"
                      >
                        Review
                      </Link>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-4 text-sm text-muted-foreground">
                  No purchase orders are currently pending approval.
                </div>
              )
            ) : activeFilter === 'suppliers' ? (
              supplierSummaries.length ? (
                supplierSummaries.slice(0, 5).map((supplier, i) => (
                  <div
                    key={supplier.supplierName}
                    className={`flex items-center justify-between gap-3 px-4 py-2.5 ${
                      i % 2 === 1 ? 'bg-muted/20' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {supplier.supplierName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {supplier.lineCount} line{supplier.lineCount === 1 ? '' : 's'}
                        {' · '}
                        {supplier.awaitingCount} awaiting
                        {' · '}
                        {supplier.partialCount} partial
                        {' · '}
                        {supplier.purchaseOrderCount} PO{supplier.purchaseOrderCount === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-xs">
                      <Link
                        href={`/purchasing?supplier=${encodeURIComponent(supplier.supplierName)}`}
                        className="rounded-full bg-muted px-2.5 py-1 font-medium text-muted-foreground hover:text-foreground"
                      >
                        View Queue
                      </Link>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-4 text-sm text-muted-foreground">
                  No suppliers currently have outstanding purchasing work.
                </div>
              )
            ) : visibleLines.length ? (
              visibleLines.slice(0, 5).map((line, i) => (
                <div
                  key={`${activeFilter}-${line.purchaseOrderId}-${line.orderId}`}
                  className={`flex items-center justify-between gap-3 px-4 py-2.5 ${
                    i % 2 === 1 ? 'bg-muted/20' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {line.componentCode}
                      {line.componentDescription ? ` - ${line.componentDescription}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {line.supplierName} · Owing {line.owingQuantity} of {line.orderedQuantity}
                      {line.qNumber ? ` · ${line.qNumber}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs">
                    <Link
                      href={`/purchasing/purchase-orders/${line.purchaseOrderId}?receive=${line.orderId}`}
                      className="rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary hover:bg-primary/20"
                    >
                      Receive
                    </Link>
                    <Link
                      href={`/purchasing/purchase-orders/${line.purchaseOrderId}`}
                      className="rounded-full bg-muted px-2.5 py-1 font-medium text-muted-foreground hover:text-foreground"
                    >
                      View PO
                    </Link>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-4 text-sm text-muted-foreground">
                No queue items match this filter.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
