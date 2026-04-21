'use client';

import { formatCurrency } from '@/lib/format-utils';
import type { LineMaterialCost } from '@/lib/orders/line-material-cost';
import { cn } from '@/lib/utils';

type Props = {
  cost: LineMaterialCost | null;
  loading?: boolean;
  className?: string;
};

type Variant = 'nested' | 'stale' | 'padded';

const VARIANTS: Record<Variant, { label: string; color: string }> = {
  nested: { label: 'nested', color: 'bg-emerald-500/15 text-emerald-400' },
  stale: { label: 'stale', color: 'bg-amber-500/15 text-amber-400' },
  padded: { label: 'padded', color: 'bg-muted text-muted-foreground' },
};

function pickVariant(cost: LineMaterialCost): Variant {
  if (cost.basis === 'nested_real') return 'nested';
  if (cost.stale) return 'stale';
  return 'padded';
}

function pickTitle(cost: LineMaterialCost): string {
  if (cost.basis === 'nested_real') {
    return `Cross-product nested cost — saved vs ${formatCurrency(cost.cutlist_portion + cost.non_cutlist_portion)} padded.`;
  }
  if (cost.stale) return 'Cutting plan is stale — regenerate for current nested cost.';
  return 'Padded cost — cutting plan not yet generated.';
}

export function LineMaterialCostBadge({ cost, loading, className }: Props) {
  if (loading) {
    return <span className={cn('text-xs text-muted-foreground', className)}>…</span>;
  }
  if (!cost) {
    return <span className={cn('text-xs text-muted-foreground', className)}>—</span>;
  }

  const variant = VARIANTS[pickVariant(cost)];

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm', className)} title={pickTitle(cost)}>
      <span>{formatCurrency(cost.amount)}</span>
      <span className={cn('rounded-sm px-1.5 py-0.5 text-[10px] uppercase tracking-wide', variant.color)}>
        {variant.label}
      </span>
    </span>
  );
}
