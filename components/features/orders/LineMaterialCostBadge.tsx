'use client';

import { formatCurrency } from '@/lib/format-utils';
import type { LineMaterialCost } from '@/lib/orders/line-material-cost';
import { cn } from '@/lib/utils';

type Props = {
  cost: LineMaterialCost | null;
  loading?: boolean;
  className?: string;
};

export function LineMaterialCostBadge({ cost, loading, className }: Props) {
  if (loading) {
    return <span className={cn('text-xs text-muted-foreground', className)}>…</span>;
  }
  if (!cost) {
    return <span className={cn('text-xs text-muted-foreground', className)}>—</span>;
  }

  const basisLabel =
    cost.basis === 'nested_real' ? 'nested' :
    cost.stale ? 'stale' : 'padded';

  const basisColor =
    cost.basis === 'nested_real' ? 'bg-emerald-500/15 text-emerald-400' :
    cost.stale ? 'bg-amber-500/15 text-amber-400' :
    'bg-muted text-muted-foreground';

  const title =
    cost.basis === 'nested_real'
      ? `Cross-product nested cost — saved vs ${formatCurrency(cost.cutlist_portion + cost.non_cutlist_portion)} padded.`
      : cost.stale
      ? 'Cutting plan is stale — regenerate for current nested cost.'
      : 'Padded cost — cutting plan not yet generated.';

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm', className)} title={title}>
      <span>{formatCurrency(cost.amount)}</span>
      <span className={cn('rounded-sm px-1.5 py-0.5 text-[10px] uppercase tracking-wide', basisColor)}>
        {basisLabel}
      </span>
    </span>
  );
}
