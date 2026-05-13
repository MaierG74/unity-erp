'use client';

import React from 'react';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { OverviewSection } from '@/components/features/orders/setup-panel/OverviewSection';
import { CutlistMaterialsSection } from '@/components/features/orders/setup-panel/CutlistMaterialsSection';
import { ComponentReadinessSection } from '@/components/features/orders/setup-panel/ComponentReadinessSection';
import { NextActionsSection } from '@/components/features/orders/setup-panel/NextActionsSection';
import { computeLineStatus, type LineStatusKind } from '@/lib/orders/line-status';
import {
  COLLAPSE_SECTION_IDS,
  loadCollapseState,
  saveCollapseState,
  type CollapseSectionId,
  type CollapseState,
} from '@/lib/orders/panel-collapse';
import type { BomSnapshotEntry } from '@/lib/orders/snapshot-types';
import { cn } from '@/lib/utils';

export interface OrderLineSetupPanelProps {
  detail: any;
  coverage: { ordered: number; reserved: number; remain: number; factor: number };
  bomComponents: any[];
  computeComponentMetrics: (component: any, productId: number) => any;
  showGlobalContext: boolean;
  applying: boolean;
  reservePending: boolean;
  onClose: () => void;
  onApplyCutlistMaterial: (value: any) => void | Promise<void>;
  onSwapBomEntry: (entry: BomSnapshotEntry) => void;
  onOrderComponent: (componentId: number) => void;
  onReserveOrderComponents: () => void | Promise<void>;
  onGenerateCuttingPlan: () => void;
  onIssueStock: () => void;
  onCreateJobCards: () => void;
  asSheet?: boolean;
  open?: boolean;
}

const STATUS_COLOR: Record<LineStatusKind, string> = {
  ready: 'text-emerald-500',
  'needs-material': 'text-amber-500',
  shortfall: 'text-destructive',
};

export function OrderLineSetupPanel(props: OrderLineSetupPanelProps) {
  const body = <PanelBody {...props} />;
  if (props.asSheet) {
    return (
      <Sheet open={props.open ?? false} onOpenChange={(next) => { if (!next) props.onClose(); }}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 overflow-y-auto">
          {body}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <aside
      aria-label="Order line setup"
      className={cn(
        'sticky top-4 self-start w-[440px] shrink-0',
        'rounded-md border border-border/60 bg-card overflow-hidden',
        'max-h-[calc(100vh-2rem)] overflow-y-auto'
      )}
    >
      {body}
    </aside>
  );
}

function PanelBody({
  detail,
  coverage,
  bomComponents,
  computeComponentMetrics,
  applying,
  reservePending,
  onClose,
  onApplyCutlistMaterial,
  onSwapBomEntry,
  onOrderComponent,
  onReserveOrderComponents,
  onGenerateCuttingPlan,
  onIssueStock,
  onCreateJobCards,
}: OrderLineSetupPanelProps) {
  const productName = detail?.product?.name ?? 'Order line';
  const qty = Number(detail?.quantity ?? 0);

  const shortfallCount = bomComponents.filter((component) => {
    const metrics = computeComponentMetrics(component, detail.product_id);
    return metrics.real > 0.0001;
  }).length;
  const hasCutlistSnapshot = Array.isArray(detail?.cutlist_material_snapshot) && detail.cutlist_material_snapshot.length > 0;
  const status = computeLineStatus({
    hasCutlistSnapshot,
    primaryMaterialId: detail?.cutlist_primary_material_id ?? null,
    shortfallCount,
  });

  const [collapseState, setCollapseState] = React.useState<Record<CollapseSectionId, CollapseState>>(() => ({
    overview: 'closed',
    'cutlist-materials': 'closed',
    readiness: 'closed',
    'next-actions': 'closed',
  }));

  React.useEffect(() => {
    const next = {} as Record<CollapseSectionId, CollapseState>;
    for (const id of COLLAPSE_SECTION_IDS) next[id] = loadCollapseState(id);
    setCollapseState(next);
  }, []);

  const toggle = React.useCallback((id: CollapseSectionId) => {
    setCollapseState((prev) => {
      const next: CollapseState = prev[id] === 'open' ? 'closed' : 'open';
      saveCollapseState(id, next);
      return { ...prev, [id]: next };
    });
  }, []);

  return (
    <>
      <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border/60">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Order line setup</p>
          <h2 className="mt-0.5 text-base font-semibold truncate" title={productName}>{productName}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            qty {qty} · <span className={STATUS_COLOR[status.kind]}>{status.sentence}</span>
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 -mr-1" onClick={onClose} aria-label="Close setup panel">
          <X className="h-4 w-4" />
        </Button>
      </header>

      <OverviewSection
        ordered={coverage.ordered}
        reserved={coverage.reserved}
        toBuild={coverage.remain}
        isOpen={collapseState.overview === 'open'}
        onToggle={() => toggle('overview')}
      />

      <CutlistMaterialsSection
        detail={detail}
        applying={applying}
        onApply={onApplyCutlistMaterial}
        isOpen={collapseState['cutlist-materials'] === 'open'}
        onToggle={() => toggle('cutlist-materials')}
      />

      <ComponentReadinessSection
        detail={detail}
        bomComponents={bomComponents}
        computeComponentMetrics={computeComponentMetrics}
        showGlobalContext={false}
        onSwapBomEntry={onSwapBomEntry}
        onOrderComponent={onOrderComponent}
        onReserveAll={onReserveOrderComponents}
        reservePending={reservePending}
        isOpen={collapseState.readiness === 'open'}
        onToggle={() => toggle('readiness')}
      />

      <NextActionsSection
        reservePending={reservePending}
        onReserveOrderComponents={onReserveOrderComponents}
        onGenerateCuttingPlan={onGenerateCuttingPlan}
        onIssueStock={onIssueStock}
        onCreateJobCards={onCreateJobCards}
        isOpen={collapseState['next-actions'] === 'open'}
        onToggle={() => toggle('next-actions')}
      />
    </>
  );
}
