'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { isLowStockItem } from '@/app/dashboard/dashboard-logic';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { InventoryItem } from '@/types/inventory';

type LowStockQuantityFields = Pick<
  InventoryItem,
  'quantity_on_hand' | 'reorder_level'
>;

type DashboardLowStockItem = Omit<InventoryItem, 'component'> & {
  component: InventoryItem['component'] | null;
};

type DashboardRenderableLowStockItem = DashboardLowStockItem & {
  component: NonNullable<DashboardLowStockItem['component']>;
};

function getSuggestedOrderQuantity(item: LowStockQuantityFields) {
  const reorderLevel = Number(item.reorder_level || 0);
  const quantityOnHand = Number(item.quantity_on_hand || 0);
  if (reorderLevel <= 0) return 1;
  return Math.max(reorderLevel - quantityOnHand, 1);
}

function getSeverity(onHand: number, reorderLevel: number) {
  if (reorderLevel <= 0) return 'warning';
  return onHand / reorderLevel <= 0.5 ? 'critical' : 'warning';
}

function hasLinkedComponent(
  item: DashboardLowStockItem
): item is DashboardRenderableLowStockItem {
  return Boolean(item.component?.component_id);
}

export function LowStockAlerts() {
  const {
    data: lowStockItems = [],
    isLoading,
    isError,
  } = useQuery<DashboardRenderableLowStockItem[]>({
    queryKey: ['dashboard', 'low-stock-alerts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory')
        .select(`
          *,
          component:components(component_id, internal_code, description, image_url, category:component_categories(categoryname), unit:unitsofmeasure(unit_name))
        `)
        .gt('reorder_level', 0)
        .order('quantity_on_hand', { ascending: true })
        .limit(50);

      if (error) throw error;

      return ((data ?? []) as DashboardLowStockItem[])
        .filter(isLowStockItem)
        .filter(hasLinkedComponent)
        .slice(0, 5);
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b p-4">
          <div className="h-5 w-28 animate-pulse rounded bg-muted" />
          <div className="h-4 w-16 animate-pulse rounded bg-muted" />
        </div>
        <div className="space-y-3 p-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-muted/50" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">Low Stock Alerts</h3>
        </div>
        <div className="p-4 text-sm text-destructive">
          Failed to load low stock alerts.
        </div>
      </div>
    );
  }

  if (lowStockItems.length === 0) return null;

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Low Stock Alerts</h3>
        <Link
          href="/inventory?tab=reports"
          className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          View All <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="divide-y">
        {lowStockItems.map((item) => {
          const onHand = Number(item.quantity_on_hand || 0);
          const reorder = Number(item.reorder_level || 0);
          const severity = getSeverity(onHand, reorder);
          const fillPercent = reorder > 0 ? Math.min((onHand / reorder) * 100, 100) : 0;
          const componentLabel = item.component.description
            ? `${item.component.internal_code} - ${item.component.description}`
            : item.component.internal_code;

          return (
            <div
              key={item.inventory_id}
              className={`flex items-center gap-3 px-4 py-3 ${
                severity === 'critical'
                  ? 'border-l-2 border-l-destructive'
                  : severity === 'warning'
                    ? 'border-l-2 border-l-warning'
                    : ''
              }`}
            >
              <div
                className={`shrink-0 rounded-lg p-1.5 ${
                  severity === 'critical'
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-warning/10 text-warning'
                }`}
              >
                <AlertTriangle className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <Link
                  href={`/inventory/components/${item.component.component_id}`}
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {componentLabel}
                </Link>
                <div className="mt-1.5 flex items-center gap-2">
                  {/* Progress bar */}
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full transition-all ${
                        severity === 'critical' ? 'bg-destructive' : 'bg-warning'
                      }`}
                      style={{ width: `${fillPercent}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    <span className={severity === 'critical' ? 'font-semibold text-destructive' : 'font-semibold text-warning'}>
                      {onHand}
                    </span>
                    {' / '}
                    {reorder} {item.component.unit?.unit_name ?? ''}
                  </span>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 shrink-0 rounded-full px-3 text-xs font-medium text-primary hover:bg-primary/10 hover:text-primary"
                asChild
              >
                <Link
                  href={`/purchasing/purchase-orders/new?componentId=${item.component.component_id}&suggestedQuantity=${getSuggestedOrderQuantity(item)}&source=dashboard-low-stock`}
                >
                  Order
                </Link>
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
