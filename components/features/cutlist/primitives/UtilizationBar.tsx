import type { UtilizationBreakdown } from '@/lib/cutlist/effectiveUtilization';
import { cn } from '@/lib/utils';

interface UtilizationBarProps {
  breakdown: UtilizationBreakdown;
  className?: string;
  title?: string;
}

export function UtilizationBar({ breakdown, className, title }: UtilizationBarProps) {
  const legendColumns = breakdown.hasReusable ? 'grid-cols-3' : 'grid-cols-2';
  const segments = [
    {
      key: 'parts',
      label: 'Parts',
      className: 'bg-blue-500',
      width: breakdown.displayPartsPct,
      rawPct: breakdown.mechanicalPctRaw,
    },
    {
      key: 'reuse',
      label: 'Reuse',
      className: 'bg-emerald-500',
      width: breakdown.displayReusablePct,
      rawPct: breakdown.totalArea_mm2 > 0
        ? (breakdown.reusableArea_mm2 / breakdown.totalArea_mm2) * 100
        : 0,
    },
    {
      key: 'scrap',
      label: 'Scrap',
      className: 'bg-slate-400 dark:bg-slate-600',
      width: breakdown.displayScrapPct,
      rawPct: breakdown.totalArea_mm2 > 0
        ? (breakdown.scrapArea_mm2 / breakdown.totalArea_mm2) * 100
        : 0,
    },
  ];
  const visibleLegend = breakdown.hasReusable
    ? segments
    : segments.filter((segment) => segment.key !== 'reuse');

  return (
    <div className={cn('space-y-1.5', className)}>
      {title && (
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
      )}
      <div className="flex h-[18px] w-full overflow-hidden rounded-sm border bg-muted">
        {segments.map((segment) => (
          segment.width > 0 ? (
            <div
              key={segment.key}
              className={segment.className}
              style={{ width: `${segment.width}%` }}
            />
          ) : null
        ))}
      </div>
      <div className={cn('grid gap-2 text-[11px] text-muted-foreground', legendColumns)}>
        {visibleLegend.map((segment) => (
          <div key={segment.key} className="flex items-center gap-1.5 min-w-0">
            <span className={cn('h-2 w-2 shrink-0 rounded-full', segment.className)} />
            <span className="truncate">{segment.label}</span>
            <span className="ml-auto font-mono text-foreground/80">
              {segment.rawPct.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
