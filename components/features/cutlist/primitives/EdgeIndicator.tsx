'use client';

import { memo } from 'react';
import { cn } from '@/lib/utils';

export interface EdgeIndicatorProps {
  edges: {
    top: boolean;
    right: boolean;
    bottom: boolean;
    left: boolean;
  };
  onClick?: () => void;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Visual indicator showing which edges of a board have banding applied.
 * Renders as a small rectangle with highlighted sides for active edges.
 *
 * Visual representation:
 * - No edges:    thin border on all sides
 * - Some edges:  thick colored border on active sides, thin on inactive
 * - All edges:   thick colored border on all sides
 */
export const EdgeIndicator = memo(function EdgeIndicator({
  edges,
  onClick,
  size = 'sm',
  className,
}: EdgeIndicatorProps) {
  // Size configurations
  const dimensions = size === 'sm'
    ? { width: 24, height: 18 }
    : { width: 32, height: 24 };

  const { width, height } = dimensions;

  // Stroke widths
  const activeStroke = 2.5;
  const inactiveStroke = 1;

  // Calculate inset for strokes (so they don't get clipped)
  const inset = activeStroke / 2 + 0.5;

  // Rectangle coordinates (inset from edges)
  const x1 = inset;
  const y1 = inset;
  const x2 = width - inset;
  const y2 = height - inset;

  const isClickable = !!onClick;

  // Count active edges for tooltip
  const activeCount = [edges.top, edges.right, edges.bottom, edges.left].filter(Boolean).length;
  const tooltipText = activeCount === 0
    ? 'No edge banding'
    : activeCount === 4
      ? 'All edges banded'
      : `${activeCount} edge${activeCount > 1 ? 's' : ''} banded`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      onClick={onClick}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={isClickable ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      } : undefined}
      aria-label={tooltipText}
      className={cn(
        'flex-shrink-0',
        isClickable && [
          'cursor-pointer',
          'rounded-sm',
          'transition-all duration-150',
          'hover:scale-110',
          'hover:opacity-80',
          'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1',
        ],
        className
      )}
    >
      {/* SVG title for tooltip on hover */}
      <title>{tooltipText}</title>

      {/* Background fill */}
      <rect
        x={x1}
        y={y1}
        width={x2 - x1}
        height={y2 - y1}
        className="fill-muted/30"
        rx={1}
      />

      {/* Top edge */}
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y1}
        strokeWidth={edges.top ? activeStroke : inactiveStroke}
        strokeLinecap="round"
        className={cn(
          'transition-all duration-150',
          edges.top
            ? 'stroke-primary'
            : 'stroke-muted-foreground/40'
        )}
      />

      {/* Right edge */}
      <line
        x1={x2}
        y1={y1}
        x2={x2}
        y2={y2}
        strokeWidth={edges.right ? activeStroke : inactiveStroke}
        strokeLinecap="round"
        className={cn(
          'transition-all duration-150',
          edges.right
            ? 'stroke-primary'
            : 'stroke-muted-foreground/40'
        )}
      />

      {/* Bottom edge */}
      <line
        x1={x2}
        y1={y2}
        x2={x1}
        y2={y2}
        strokeWidth={edges.bottom ? activeStroke : inactiveStroke}
        strokeLinecap="round"
        className={cn(
          'transition-all duration-150',
          edges.bottom
            ? 'stroke-primary'
            : 'stroke-muted-foreground/40'
        )}
      />

      {/* Left edge */}
      <line
        x1={x1}
        y1={y2}
        x2={x1}
        y2={y1}
        strokeWidth={edges.left ? activeStroke : inactiveStroke}
        strokeLinecap="round"
        className={cn(
          'transition-all duration-150',
          edges.left
            ? 'stroke-primary'
            : 'stroke-muted-foreground/40'
        )}
      />
    </svg>
  );
});

export default EdgeIndicator;
