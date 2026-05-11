'use client';

import { computeLineStatus, type LineStatusKind } from '@/lib/orders/line-status';
import { formatQuantity } from '@/lib/format-utils';
import { cn } from '@/lib/utils';

interface OverviewSectionProps {
  ordered: number;
  reserved: number;
  toBuild: number;
  hasCutlistSnapshot: boolean;
  primaryMaterialId: number | null;
  shortfallCount: number;
}

const STATUS_COLOR: Record<LineStatusKind, string> = {
  ready: 'text-foreground',
  'needs-material': 'text-amber-600 dark:text-amber-400',
  shortfall: 'text-destructive',
};

export function OverviewSection({
  ordered,
  reserved,
  toBuild,
  hasCutlistSnapshot,
  primaryMaterialId,
  shortfallCount,
}: OverviewSectionProps) {
  const status = computeLineStatus({ hasCutlistSnapshot, primaryMaterialId, shortfallCount });

  return (
    <section className="px-5 py-5 border-b border-border/60">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
        Overview
      </h3>

      <div className="grid grid-cols-3 gap-4">
        <Metric label="Ordered" value={formatQuantity(ordered)} />
        <Metric label="Reserved" value={formatQuantity(reserved)} />
        <Metric label="To build" value={formatQuantity(toBuild)} emphasized />
      </div>

      <p className={cn('mt-4 text-sm', STATUS_COLOR[status.kind])}>
        {status.sentence}
      </p>
    </section>
  );
}

function Metric({ label, value, emphasized }: { label: string; value: string; emphasized?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('mt-1 tabular-nums', emphasized ? 'text-2xl font-semibold' : 'text-lg')}>
        {value}
      </p>
    </div>
  );
}
