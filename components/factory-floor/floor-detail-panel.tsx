'use client';

import Link from 'next/link';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatTimeToSAST } from '@/lib/utils/timezone';
import type { FloorStaffJob } from './types';
import { getDisplayProgress, getProgressStatus, statusDotClass, statusBadgeConfig } from './types';
import { ProgressBar } from './progress-bar';
import { ExternalLink, CheckCircle, Pause, Play, ArrowRightLeft } from 'lucide-react';
import type { ShiftInfoWithNow } from '@/hooks/use-shift-info';
import { computeShiftAwareStatus, minutesToTimeString, formatDuration } from '@/lib/shift-utils';

interface FloorDetailPanelProps {
  job: FloorStaffJob | null;
  onClose: () => void;
  onComplete: (job: FloorStaffJob) => void;
  onPause: (job: FloorStaffJob) => void;
  onResume: (assignmentId: number) => void;
  onTransfer: (job: FloorStaffJob) => void;
  isUpdating: boolean;
  shiftInfo?: ShiftInfoWithNow;
}

export function FloorDetailPanel({
  job,
  onClose,
  onComplete,
  onPause,
  onResume,
  onTransfer,
  isUpdating,
  shiftInfo,
}: FloorDetailPanelProps) {
  const open = job !== null;

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) onClose();
  };

  if (!job) return null;

  const displayProgress = getDisplayProgress(job);
  const status = getProgressStatus(job);
  const badge = statusBadgeConfig[status];
  const isPaused = job.is_paused;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="w-[400px] sm:w-[440px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${statusDotClass[job.job_status]}`} />
            {job.staff_name}
            {isPaused && (
              <Badge className="bg-amber-600 hover:bg-amber-600 text-white text-xs ml-auto">
                Paused
              </Badge>
            )}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Job info */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Current Job
            </h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Job</span>
                <span className="font-medium">{job.job_name ?? '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Section</span>
                <span className="font-medium">{job.section_name ?? 'Unassigned'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Product</span>
                <span className="font-medium truncate ml-4">{job.product_name ?? '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Order</span>
                <span className="font-mono font-medium">{job.order_number ?? '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Quantity</span>
                <span className="font-medium">{job.quantity ?? '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <Badge className={isPaused ? 'bg-amber-600 hover:bg-amber-600 text-white' : badge.className}>
                  {isPaused ? `Paused` :
                   job.job_status === 'in_progress' ? 'In Progress' :
                   job.job_status === 'on_hold' ? 'On Hold' : 'Issued'}
                </Badge>
              </div>
            </div>
          </div>

          {/* Time info */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Time
            </h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {job.job_status === 'in_progress' || job.job_status === 'on_hold' ? 'Started' : 'Issued'}
                </span>
                <span className="font-medium">
                  {formatTimeToSAST(job.job_status === 'issued' ? job.issued_at : job.started_at)}
                </span>
              </div>
              {job.unit_minutes != null && job.quantity != null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Unit Duration</span>
                  <span className="font-medium">{formatDuration(job.unit_minutes)} x {job.quantity}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Est. Duration</span>
                <span className="font-medium">{formatDuration(job.estimated_minutes)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Elapsed</span>
                <span className="font-medium">
                  {formatDuration(job.minutes_elapsed)}
                  {job.total_paused_minutes > 0 && (
                    <span className="text-amber-400 ml-1">(paused: {formatDuration(job.total_paused_minutes)})</span>
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* Shift info */}
          {shiftInfo && <ShiftSection job={job} shiftInfo={shiftInfo} />}

          {/* Progress */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  Progress
                </h4>
                <p className="text-[10px] text-muted-foreground/60">Based on estimated time</p>
              </div>
              <Badge className={badge.className}>
                {badge.label}
              </Badge>
            </div>
            <ProgressBar job={job} className="py-1" />
          </div>

          {/* Job Actions */}
          <div className="space-y-2 pt-2 border-t">
            <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Actions
            </h4>
            <div className="grid grid-cols-3 gap-2">
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => onComplete(job)}
                disabled={isUpdating}
              >
                <CheckCircle className="h-3.5 w-3.5 mr-1" />
                Complete
              </Button>
              {isPaused ? (
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => onResume(job.assignment_id)}
                  disabled={isUpdating}
                >
                  <Play className="h-3.5 w-3.5 mr-1" />
                  Resume
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                  onClick={() => onPause(job)}
                  disabled={isUpdating || job.job_status !== 'in_progress'}
                >
                  <Pause className="h-3.5 w-3.5 mr-1" />
                  Pause
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => onTransfer(job)}
                disabled={isUpdating}
              >
                <ArrowRightLeft className="h-3.5 w-3.5 mr-1" />
                Transfer
              </Button>
            </div>
          </div>

          {/* View Order */}
          <div className="space-y-2 pt-2 border-t">
            {job.order_id && (
              <Button variant="outline" size="sm" className="w-full justify-start" asChild>
                <Link href={`/orders/${job.order_id}`} target="_blank">
                  <ExternalLink className="h-3.5 w-3.5 mr-2" />
                  View Order
                </Link>
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ShiftSection({
  job,
  shiftInfo,
}: {
  job: FloorStaffJob;
  shiftInfo: ShiftInfoWithNow;
}) {
  const status = computeShiftAwareStatus(
    job.estimated_minutes,
    job.minutes_elapsed,
    shiftInfo.nowMinutes,
    shiftInfo.normalEndMinutes,
    shiftInfo.effectiveEndMinutes,
    shiftInfo.breaks,
  );

  const statusDisplay: Record<string, { text: string; className: string }> = {
    ok: { text: 'On track', className: 'text-emerald-400' },
    tight: { text: `Tight – finishes ~${minutesToTimeString(status.estimatedFinishMinutes)}`, className: 'text-amber-400' },
    overrun: { text: `~${Math.round(status.overrunMinutes)}min past shift end`, className: 'text-red-400' },
    'overtime-ok': { text: 'Within overtime', className: 'text-blue-400' },
  };

  const display = statusDisplay[status.shiftStatus];

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
        Shift
      </h4>
      <div className="space-y-2 text-sm">
        {shiftInfo.hasOvertime ? (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Normal end</span>
              <span className="font-medium">{minutesToTimeString(shiftInfo.normalEndMinutes)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Overtime until</span>
              <span className="font-medium text-blue-400">{shiftInfo.shiftEndFormatted}</span>
            </div>
          </>
        ) : (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Shift ends</span>
            <span className="font-medium">{shiftInfo.shiftEndFormatted}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Est. finish</span>
          <span className="font-medium">
            {status.remainingWorkMinutes > 0
              ? minutesToTimeString(status.estimatedFinishMinutes)
              : 'Complete'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Status</span>
          <span className={`font-medium ${display.className}`}>{display.text}</span>
        </div>
      </div>
    </div>
  );
}
