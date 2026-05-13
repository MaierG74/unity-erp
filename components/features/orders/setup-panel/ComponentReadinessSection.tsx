'use client';

import React from 'react';
import { ChevronRight, Loader2, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ReadinessRow } from '@/components/features/orders/setup-panel/ReadinessRow';
import { canReserveMore } from '@/lib/orders/reservation-predicate';
import type { BomSnapshotEntry } from '@/lib/orders/snapshot-types';

interface ComponentReadinessSectionProps {
  detail: any;
  bomComponents: any[];
  computeComponentMetrics: (component: any, productId: number) => any;
  showGlobalContext: boolean;
  onSwapBomEntry: (entry: BomSnapshotEntry) => void;
  onOrderComponent: (componentId: number) => void;
  onReserveAll: () => void | Promise<void>;
  reservePending: boolean;
  isOpen: boolean;
  onToggle: () => void;
}

export function ComponentReadinessSection({
  detail,
  bomComponents,
  computeComponentMetrics,
  showGlobalContext: _showGlobalContext,
  onSwapBomEntry,
  onOrderComponent,
  onReserveAll,
  reservePending,
  isOpen,
  onToggle,
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

  const enriched = bomComponents.map((component: any) => {
    const metrics = computeComponentMetrics(component, detail.product_id);
    return { component, metrics };
  });

  const shortCount = enriched.filter(({ metrics }) => metrics.real > 0).length;
  const reserveAllVisible = enriched.some(({ metrics }) =>
    canReserveMore(
      Number(metrics.required ?? 0),
      Number(metrics.available ?? metrics.inStock ?? 0),
      Number(metrics.reservedThisOrder ?? 0)
    )
  );

  const pill = shortCount > 0
    ? <Badge variant="destructive" className="h-5 text-[10px]">{shortCount} short</Badge>
    : <Badge variant="outline" className="h-5 text-[10px] border-emerald-500/40 text-emerald-500">All ready</Badge>;

  return (
    <section className="border-b border-border/60">
      <header className="flex items-center justify-between gap-2 px-5 py-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2 flex-1 text-left"
          aria-expanded={isOpen}
          aria-controls="setup-panel-readiness-body"
        >
          <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground/60 transition-transform', isOpen && 'rotate-90')} />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Component readiness</h3>
          {pill}
        </button>
        {reserveAllVisible && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/[0.06]"
            onClick={(event) => { event.stopPropagation(); onReserveAll(); }}
            disabled={reservePending}
            data-row-action
          >
            {reservePending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Reserve all
          </Button>
        )}
      </header>

      {isOpen && (
        <div id="setup-panel-readiness-body" className="px-5 pb-5">
          {bomComponents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No component requirements.</p>
          ) : (
            <div className="space-y-px">
              <div className="grid grid-cols-[90px_1fr_32px_38px_50px_32px_22px_22px] items-center gap-x-1.5 px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                <span>Code</span>
                <span>Description</span>
                <span className="text-right">Req</span>
                <span className="text-right">Res</span>
                <span className="text-right">Avail</span>
                <span className="text-right">Short</span>
                <span aria-hidden />
                <span aria-hidden />
              </div>

              {enriched.map(({ component, metrics }) => {
                const componentId = component.component_id ? Number(component.component_id) : null;
                const snapshotEntry = findSnapshotEntry(component);
                return (
                  <ReadinessRow
                    key={componentId ?? component.internal_code}
                    componentId={componentId}
                    internalCode={component.internal_code ?? 'Unknown'}
                    description={component.description ?? null}
                    required={Number(metrics.required ?? 0)}
                    reservedThisOrder={Number(metrics.reservedThisOrder ?? 0)}
                    available={Number(metrics.available ?? metrics.inStock ?? 0)}
                    shortfall={Number(metrics.real ?? 0)}
                    canSwap={!!snapshotEntry}
                    onSwap={() => snapshotEntry && onSwapBomEntry(snapshotEntry)}
                    onOrder={() => componentId && onOrderComponent(componentId)}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
