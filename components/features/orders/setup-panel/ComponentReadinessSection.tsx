'use client';

import Link from 'next/link';
import { Replace } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatQuantity } from '@/lib/format-utils';
import type { BomSnapshotEntry } from '@/lib/orders/snapshot-types';

interface ComponentReadinessSectionProps {
  detail: any;
  bomComponents: any[];
  computeComponentMetrics: (component: any, productId: number) => any;
  showGlobalContext: boolean;
  onSwapBomEntry: (entry: BomSnapshotEntry) => void;
}

function ComponentDescription({ description }: { description: string | null | undefined }) {
  const text = description?.trim();
  if (!text) return null;
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="block truncate text-xs text-muted-foreground">{text}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm text-xs leading-relaxed" side="top" align="start">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function ComponentReadinessSection({
  detail,
  bomComponents,
  computeComponentMetrics,
  showGlobalContext,
  onSwapBomEntry,
}: ComponentReadinessSectionProps) {
  const snapshotEntries: BomSnapshotEntry[] = Array.isArray(detail?.bom_snapshot)
    ? (detail.bom_snapshot as BomSnapshotEntry[])
    : [];

  const findSnapshotEntry = (component: any) => {
    const componentId = Number(component.component_id);
    return snapshotEntries.find((entry) =>
      Number(entry.effective_component_id) === componentId ||
      Number(entry.component_id) === componentId ||
      Number(entry.default_component_id) === componentId
    ) ?? null;
  };

  if (!bomComponents || bomComponents.length === 0) {
    return (
      <section className="px-5 py-5 border-b border-border/60">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Component readiness
        </h3>
        <p className="text-sm text-muted-foreground">No component requirements.</p>
      </section>
    );
  }

  return (
    <section className="px-5 py-5 border-b border-border/60">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        Component readiness
      </h3>

      <div className="divide-y divide-border/40">
        {bomComponents.map((component: any) => {
          const metrics = computeComponentMetrics(component, detail.product_id);
          const globalShortfall = Number(component.global_real_shortfall ?? 0);
          const snapshotEntry = findSnapshotEntry(component);
          const isShort = metrics.real > 0;

          return (
            <div
              key={component.component_id}
              className={cn(
                'px-1 py-2.5 text-sm',
                isShort && '-mx-1 px-2 bg-destructive/5'
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <div className="min-w-0">
                  {component.component_id ? (
                    <Link
                      href={`/inventory/components/${component.component_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium hover:underline"
                    >
                      {component.internal_code || 'Unknown'}
                    </Link>
                  ) : (
                    <span className="font-medium">{component.internal_code || 'Unknown'}</span>
                  )}
                  <ComponentDescription description={component.description} />
                </div>
                {snapshotEntry && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 w-7 px-0"
                    onClick={() => onSwapBomEntry(snapshotEntry)}
                    title="Swap component"
                    data-row-action
                  >
                    <Replace className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1 text-xs tabular-nums">
                <Metric label="Required" value={formatQuantity(metrics.required)} />
                <Metric label="Available" value={formatQuantity(metrics.available ?? metrics.inStock)} />
                <Metric
                  label="Shortfall"
                  value={formatQuantity(metrics.real)}
                  className={metrics.real > 0 ? 'text-destructive font-medium' : 'text-muted-foreground'}
                />
                <Metric label="In stock" value={formatQuantity(metrics.inStock)} />
                <Metric label="Reserved" value={formatQuantity(metrics.reservedThisOrder ?? 0)} />
                <Metric label="On order" value={formatQuantity(metrics.onOrder)} />
              </div>

              {showGlobalContext && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Global shortfall:{' '}
                  <span className={cn('tabular-nums', globalShortfall > 0 ? 'text-destructive font-medium' : '')}>
                    {formatQuantity(globalShortfall)}
                  </span>
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Metric({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={className}>{value}</span>
    </div>
  );
}
