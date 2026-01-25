'use client';

import { memo, useCallback } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// =============================================================================
// Types
// =============================================================================

export interface EdgeBandingEdges {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

export interface EdgeBandingOption {
  id: string;
  name: string;
  thickness_mm: number;
}

export interface EdgeBandingPopoverProps {
  /** Length in mm (displayed on top/bottom edges) */
  length: number;
  /** Width in mm (displayed on left/right edges) */
  width: number;
  /** Current edge banding state */
  edges: EdgeBandingEdges;
  /** Callback when edges change */
  onEdgesChange: (edges: EdgeBandingEdges) => void;
  /** Optional edging material options for override dropdown */
  edgingOptions?: EdgeBandingOption[];
  /** Currently selected edging material ID */
  selectedEdgingId?: string;
  /** Callback when edging material changes */
  onEdgingChange?: (edgingId: string) => void;
  /** The element that triggers the popover */
  trigger: React.ReactNode;
  /** Optional className for the popover content */
  className?: string;
  /** Whether the popover is open (controlled) */
  open?: boolean;
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void;
}

// =============================================================================
// Edge Button Component
// =============================================================================

interface EdgeButtonProps {
  position: 'top' | 'right' | 'bottom' | 'left';
  active: boolean;
  dimension: number;
  onClick: () => void;
}

const EdgeButton = memo(function EdgeButton({
  position,
  active,
  dimension,
  onClick,
}: EdgeButtonProps) {
  const isHorizontal = position === 'top' || position === 'bottom';
  const label = position.charAt(0).toUpperCase();

  const baseClasses = cn(
    'absolute flex items-center justify-center',
    'cursor-pointer select-none',
    'transition-all duration-150',
    'rounded-sm',
    'text-xs font-medium',
    active
      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
      : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground border border-dashed border-muted-foreground/30',
  );

  const positionClasses = {
    top: 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 px-3 py-1',
    bottom: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 px-3 py-1',
    left: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 px-1 py-3',
    right: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2 px-1 py-3',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(baseClasses, positionClasses[position])}
      title={`${position.charAt(0).toUpperCase() + position.slice(1)} edge: ${active ? 'Has banding' : 'No banding'} (${dimension}mm)`}
    >
      <span className="flex items-center gap-1">
        {isHorizontal ? (
          <>
            <span className="text-[10px] opacity-70">{dimension}</span>
            <span>{label}</span>
          </>
        ) : (
          <span className="flex flex-col items-center gap-0.5">
            <span className="text-[10px] opacity-70">{dimension}</span>
            <span>{label}</span>
          </span>
        )}
      </span>
    </button>
  );
});

// =============================================================================
// Main Component
// =============================================================================

/**
 * EdgeBandingPopover - Visual edge banding toggle interface
 *
 * Displays a rectangular representation of a part with clickable edges
 * to toggle edge banding on each side. Optionally shows a material
 * override dropdown.
 */
export const EdgeBandingPopover = memo(function EdgeBandingPopover({
  length,
  width,
  edges,
  onEdgesChange,
  edgingOptions,
  selectedEdgingId,
  onEdgingChange,
  trigger,
  className,
  open,
  onOpenChange,
}: EdgeBandingPopoverProps) {
  const toggleEdge = useCallback(
    (edge: keyof EdgeBandingEdges) => {
      onEdgesChange({
        ...edges,
        [edge]: !edges[edge],
      });
    },
    [edges, onEdgesChange]
  );

  const activeCount = Object.values(edges).filter(Boolean).length;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        className={cn('w-80 p-0', className)}
        align="start"
        sideOffset={8}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">Edge Banding</span>
            <span className="text-xs text-muted-foreground">
              ({activeCount}/4 active)
            </span>
          </div>
          {onOpenChange && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Visual Rectangle */}
        <div className="px-4 py-6">
          <div className="relative mx-auto" style={{ width: 180, height: 120 }}>
            {/* The rectangle representing the part */}
            <div
              className={cn(
                'absolute inset-0',
                'border-2 border-border rounded-md',
                'bg-card',
              )}
            >
              {/* Center dimension label */}
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs text-muted-foreground">
                  {length} x {width}
                </span>
              </div>
            </div>

            {/* Edge buttons */}
            <EdgeButton
              position="top"
              active={edges.top}
              dimension={length}
              onClick={() => toggleEdge('top')}
            />
            <EdgeButton
              position="right"
              active={edges.right}
              dimension={width}
              onClick={() => toggleEdge('right')}
            />
            <EdgeButton
              position="bottom"
              active={edges.bottom}
              dimension={length}
              onClick={() => toggleEdge('bottom')}
            />
            <EdgeButton
              position="left"
              active={edges.left}
              dimension={width}
              onClick={() => toggleEdge('left')}
            />
          </div>
        </div>

        {/* Helper text */}
        <div className="px-4 pb-3">
          <p className="text-xs text-muted-foreground text-center">
            Click edges to toggle banding
          </p>
        </div>

        {/* Optional edging material override */}
        {edgingOptions && edgingOptions.length > 0 && onEdgingChange && (
          <div className="border-t px-4 py-3">
            <label className="text-xs text-muted-foreground block mb-2">
              Edging Material
            </label>
            <Select
              value={selectedEdgingId}
              onValueChange={onEdgingChange}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Default edging" />
              </SelectTrigger>
              <SelectContent>
                {edgingOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id} className="text-xs">
                    {option.name} ({option.thickness_mm}mm)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
});

export default EdgeBandingPopover;
