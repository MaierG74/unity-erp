'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { FloorStaffJob } from './types';
import { getDisplayProgress, getProgressStatus, statusColors, statusTrackColors } from './types';
import type { ShiftAwareStatus } from '@/lib/shift-utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { formatDuration } from '@/lib/shift-utils';

interface ProgressBarProps {
  job: FloorStaffJob;
  className?: string;
  shiftStatus?: ShiftAwareStatus | null;
}

export function ProgressBar({ job, className, shiftStatus }: ProgressBarProps) {
  const progress = getDisplayProgress(job);
  const status = getProgressStatus(job);
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Calculate shift-end marker position as percentage of the progress bar
  // Only show if the job has estimated time and won't trivially finish
  const shiftMarkerPct = (() => {
    if (!shiftStatus || !job.estimated_minutes || job.estimated_minutes <= 0) return null;
    if (shiftStatus.shiftStatus === 'ok') return null;
    const elapsed = job.minutes_elapsed;
    const total = job.estimated_minutes;
    const minutesLeft = total - elapsed;
    if (minutesLeft <= 0) return null;
    // The bar represents 0..100% of the job.
    // Shift end falls at (elapsed + workableBeforeShiftEnd) / total * 100
    const shiftRemainingWork = Math.max(0, total - elapsed - shiftStatus.overrunMinutes);
    const pct = ((elapsed + shiftRemainingWork) / total) * 100;
    if (pct <= 0 || pct >= 100) return null;
    return Math.min(99, pct);
  })();

  const tooltipText = job.progress_override != null
    ? `Manual override: ${progress}%`
    : `Based on elapsed time: ${formatDuration(job.minutes_elapsed)} of ${formatDuration(job.estimated_minutes)} estimated`;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn('flex items-center gap-2', className)}>
            <div className={cn('h-1.5 flex-1 rounded-full relative', statusTrackColors[status])}>
              <div
                className={cn(
                  'h-full rounded-full transition-all ease-out',
                  animated ? 'duration-1000' : 'duration-0',
                  statusColors[status],
                )}
                style={{ width: animated ? `${Math.min(100, progress)}%` : '0%' }}
              />
              {shiftMarkerPct != null && (
                <div
                  className="absolute top-0 h-full w-px bg-muted-foreground/40"
                  style={{ left: `${shiftMarkerPct}%` }}
                  title="Shift end"
                />
              )}
            </div>
            <span className="text-xs tabular-nums text-muted-foreground w-8 text-right">
              {progress}%
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="text-xs">{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
