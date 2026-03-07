'use client';

import { cn } from '@/lib/utils';
import type { FloorStaffJob } from './types';
import { statusDotClass } from './types';
import { ProgressBar } from './progress-bar';
import type { ShiftInfoWithNow } from '@/hooks/use-shift-info';
import type { ShiftAwareStatus } from '@/lib/shift-utils';
import { computeShiftAwareStatus } from '@/lib/shift-utils';

interface StaffJobCardProps {
  job: FloorStaffJob;
  onClick: () => void;
  shiftInfo?: ShiftInfoWithNow;
  precomputedShiftStatus?: ShiftAwareStatus | null;
}

function shiftBorderColor(status: ShiftAwareStatus | null): string {
  if (!status) return 'border-l-transparent';
  switch (status.shiftStatus) {
    case 'overrun': return 'border-l-red-500';
    case 'tight': return 'border-l-amber-500';
    case 'overtime-ok': return 'border-l-blue-500';
    default: return 'border-l-transparent';
  }
}

export function StaffJobCard({ job, onClick, shiftInfo, precomputedShiftStatus }: StaffJobCardProps) {
  const shiftStatus = precomputedShiftStatus !== undefined
    ? precomputedShiftStatus
    : shiftInfo
      ? computeShiftAwareStatus(
          job.estimated_minutes,
          job.minutes_elapsed,
          shiftInfo.nowMinutes,
          shiftInfo.normalEndMinutes,
          shiftInfo.effectiveEndMinutes,
          shiftInfo.breaks,
        )
      : null;

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-md border border-border/50 bg-card/50',
        'border-l-[3px] transition-colors hover:bg-muted/50 cursor-pointer',
        'px-2 py-1.5 space-y-0.5',
        shiftBorderColor(shiftStatus),
      )}
    >
      {/* Row 1: Staff name */}
      <div className="flex items-center gap-1.5">
        <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', statusDotClass[job.job_status])} />
        <span className="text-xs font-medium truncate">{job.staff_name}</span>
      </div>

      {/* Row 2: Order + job */}
      <p className="text-[11px] text-muted-foreground truncate pl-3">
        {job.order_number && job.order_id ? (
          <a
            href={`/orders/${job.order_id}?tab=documents`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="font-mono text-blue-400 hover:text-blue-300 hover:underline"
          >
            {job.order_number}
          </a>
        ) : job.order_number ? (
          <span className="font-mono">{job.order_number}</span>
        ) : null}
        {job.order_number && job.job_name && ' · '}
        {job.job_name}
        {job.quantity != null && <span className="text-muted-foreground/60"> ×{job.quantity}</span>}
      </p>

      {/* Row 3: Product name */}
      {job.product_name && (
        <p className="text-[11px] text-muted-foreground/70 truncate pl-3">
          {job.product_name}
        </p>
      )}

      {/* Row 4: Progress bar */}
      <div className="pl-3">
        <ProgressBar job={job} shiftStatus={shiftStatus} />
      </div>
    </button>
  );
}
