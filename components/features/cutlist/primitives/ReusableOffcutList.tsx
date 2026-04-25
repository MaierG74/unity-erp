'use client';

import React from 'react';
import type { OffcutRect } from '@/lib/cutlist/types';
import { cn } from '@/lib/utils';

interface ReusableOffcutListProps {
  offcuts: OffcutRect[];
  className?: string;
  collapseAfter?: number;
}

function formatOffcut(offcut: OffcutRect) {
  const long = Math.max(offcut.w, offcut.h);
  const short = Math.min(offcut.w, offcut.h);
  return `${Math.round(long)} × ${Math.round(short)} mm`;
}

export function ReusableOffcutList({
  offcuts,
  className,
  collapseAfter = 6,
}: ReusableOffcutListProps) {
  const [expanded, setExpanded] = React.useState(false);

  if (offcuts.length === 0) return null;

  const sorted = [...offcuts].sort((a, b) => b.area_mm2 - a.area_mm2);
  const shouldCollapse = sorted.length > collapseAfter && !expanded;
  const visible = shouldCollapse ? sorted.slice(0, Math.max(0, collapseAfter - 1)) : sorted;
  const remaining = sorted.length - visible.length;

  return (
    <div className={cn('space-y-1 text-[11px] text-muted-foreground', className)}>
      <div className="font-medium">Reusable offcuts ({offcuts.length})</div>
      <ul className="space-y-0.5">
        {visible.map((offcut, index) => (
          <li key={`${offcut.x}:${offcut.y}:${offcut.w}:${offcut.h}:${index}`}>
            • {formatOffcut(offcut)}
          </li>
        ))}
        {remaining > 0 && (
          <li>
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => setExpanded(true)}
            >
              +{remaining} more
            </button>
          </li>
        )}
        {expanded && sorted.length > collapseAfter && (
          <li>
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => setExpanded(false)}
            >
              Show fewer
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
