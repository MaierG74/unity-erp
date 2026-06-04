'use client';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { MaterialChipState } from '@/lib/orders/material-chip-data';

const CHIP_BASE = 'inline-flex items-center gap-1 h-5 rounded-sm border px-1.5 text-[11px] leading-none whitespace-nowrap';

function truncate(label: string, max = 28): string {
  if (label.length <= max) return label;
  return `${label.slice(0, max - 1)}...`;
}

export function MaterialChip({ state }: { state: MaterialChipState }) {
  if (state.kind === 'hidden') return null;

  if (state.kind === 'not-configured') {
    return (
      <span className={cn(CHIP_BASE, 'border-border/60 bg-transparent text-muted-foreground/70')}>
        Not configured
      </span>
    );
  }

  const overrideSuffix = state.overrideCount > 0
    ? `+${state.overrideCount} override${state.overrideCount === 1 ? '' : 's'}`
    : null;

  if (state.kind === 'single') {
    const label = state.primaries[0];
    return (
      <TooltipProvider delayDuration={250}>
        <span className="inline-flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={cn(CHIP_BASE, 'border-border/70 bg-muted/30 text-foreground')}>
                {truncate(label)}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" align="start" className="text-xs">
              {label}
            </TooltipContent>
          </Tooltip>
          {overrideSuffix && (
            <span className="text-[11px] leading-none text-muted-foreground">{overrideSuffix}</span>
          )}
        </span>
      </TooltipProvider>
    );
  }

  const visible = state.primaries.slice(0, 2);
  const extra = state.primaries.length - visible.length;
  const fullList = state.primaries.join(', ');
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1.5">
            {visible.map((label) => (
              <span key={label} className={cn(CHIP_BASE, 'border-border/70 bg-muted/30 text-foreground')}>
                {truncate(label, 18)}
              </span>
            ))}
            {extra > 0 && (
              <span className="text-[11px] leading-none text-muted-foreground">+{extra} more</span>
            )}
            {overrideSuffix && (
              <span className="text-[11px] leading-none text-muted-foreground">{overrideSuffix}</span>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" align="start" className="text-xs">
          {fullList}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
