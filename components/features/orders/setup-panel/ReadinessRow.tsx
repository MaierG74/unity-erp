'use client';

import React from 'react';
import Link from 'next/link';
import { Replace, ShoppingCart } from 'lucide-react';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatQuantity } from '@/lib/format-utils';

export interface ReadinessRowProps {
  componentId: number | null;
  internalCode: string;
  description: string | null;
  required: number;
  reservedThisOrder: number;
  available: number;
  shortfall: number;
  canSwap: boolean;
  showOrderAction?: boolean;
  onSwap: () => void;
  onOrder: () => void;
}

const ROW_GRID = 'grid grid-cols-[90px_1fr_32px_38px_50px_32px_22px_22px] items-center gap-x-1.5';

export function ReadinessRow({
  componentId,
  internalCode,
  description,
  required,
  reservedThisOrder,
  available,
  shortfall,
  canSwap,
  showOrderAction = true,
  onSwap,
  onOrder,
}: ReadinessRowProps) {
  const isShort = shortfall > 0;

  return (
    <TooltipProvider delayDuration={250}>
      <div
        className={cn(
          ROW_GRID,
          'px-2 py-2 -mx-2 text-xs rounded-sm',
          'odd:bg-transparent even:bg-black/[0.03]',
          isShort && 'bg-destructive/[0.05] even:bg-destructive/[0.05]'
        )}
      >
        <div className="font-medium text-foreground truncate" title={internalCode}>
          {componentId ? (
            <Link
              href={`/inventory/components/${componentId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
              data-row-action
            >
              {internalCode}
            </Link>
          ) : (
            internalCode
          )}
        </div>

        {description ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="truncate text-muted-foreground">{description}</span>
            </TooltipTrigger>
            <TooltipContent side="top" align="start" className="max-w-sm text-xs leading-relaxed">
              {description}
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-muted-foreground/40">-</span>
        )}

        <span className="text-right tabular-nums text-muted-foreground">{formatQuantity(required)}</span>
        <span className={cn('text-right tabular-nums', reservedThisOrder > 0 ? 'text-foreground font-medium' : 'text-muted-foreground')}>
          {formatQuantity(reservedThisOrder)}
        </span>
        <span className="text-right tabular-nums text-muted-foreground">{formatQuantity(available)}</span>
        <span className={cn('text-right tabular-nums', isShort ? 'text-destructive font-medium' : 'text-muted-foreground')}>
          {formatQuantity(shortfall)}
        </span>

        {canSwap ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onSwap}
                className="w-[22px] h-[22px] rounded-sm text-muted-foreground/70 hover:bg-muted/40 hover:text-foreground"
                aria-label="Swap component"
                data-row-action
              >
                <Replace className="h-3.5 w-3.5 mx-auto" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" align="end" className="text-xs">Swap component</TooltipContent>
          </Tooltip>
        ) : (
          <span aria-hidden />
        )}

        {showOrderAction ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onOrder}
                disabled={!isShort}
                className={cn(
                  'w-[22px] h-[22px] rounded-sm',
                  isShort
                    ? 'text-amber-500/90 hover:bg-amber-500/[0.10] hover:text-amber-500'
                    : 'text-muted-foreground/30 cursor-not-allowed'
                )}
                aria-label="Order component"
                data-row-action
              >
                <ShoppingCart className="h-3.5 w-3.5 mx-auto" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" align="end" className="text-xs">
              {isShort ? `Order ${formatQuantity(shortfall)} more` : 'No shortfall - nothing to order'}
            </TooltipContent>
          </Tooltip>
        ) : (
          <span aria-hidden />
        )}
      </div>
    </TooltipProvider>
  );
}
