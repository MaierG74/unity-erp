'use client';

import { cn } from '@/lib/utils';
import type { SectionWithStaff, FloorStaffJob } from './types';
import { getEffectiveMinutesElapsed } from './types';
import { StaffJobCard } from './staff-job-card';
import type { ShiftInfoWithNow } from '@/hooks/use-shift-info';
import { computeShiftAwareStatus } from '@/lib/shift-utils';
import type { ShiftAwareStatus } from '@/lib/shift-utils';

/** Threshold: sections with this many or more staff auto-expand to full width. */
const AUTO_EXPAND_THRESHOLD = 4;

interface SectionZoneProps {
  data: SectionWithStaff;
  onStaffClick: (job: FloorStaffJob) => void;
  shiftInfo?: ShiftInfoWithNow;
}

/**
 * Compute the effective grid column span for a section.
 * - Empty sections always span 1 (collapsed).
 * - Sections with >= AUTO_EXPAND_THRESHOLD staff expand to 2, unless grid_span caps it.
 * - Otherwise use the configured grid_span.
 */
export function effectiveSpan(staffCount: number, configuredSpan: number): number {
  if (staffCount === 0) return 1;
  if (staffCount >= AUTO_EXPAND_THRESHOLD) return Math.max(configuredSpan, 2);
  return configuredSpan;
}

export function SectionZone({ data, onStaffClick, shiftInfo }: SectionZoneProps) {
  const { section, staffJobs } = data;
  const activeCount = staffJobs.length;
  const span = effectiveSpan(activeCount, section.grid_span);

  // Compute shift status for each job once — reused by both header count and cards
  const shiftStatuses: Map<number, ShiftAwareStatus> = new Map();
  let overrunCount = 0;
  if (shiftInfo) {
    for (const j of staffJobs) {
      const s = computeShiftAwareStatus(
        j.estimated_minutes,
        getEffectiveMinutesElapsed(j),
        shiftInfo.nowMinutes,
        shiftInfo.normalEndMinutes,
        shiftInfo.effectiveEndMinutes,
        shiftInfo.breaks,
      );
      shiftStatuses.set(j.assignment_id, s);
      if (s.shiftStatus === 'overrun') overrunCount++;
    }
  }

  // Empty section — collapsed to a thin header bar
  if (activeCount === 0) {
    return (
      <div
        className="rounded-lg border border-border bg-muted/20 flex items-center justify-between px-3 py-1.5"
        style={{ gridColumn: `span ${span}` }}
      >
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-sm flex-shrink-0"
            style={{ backgroundColor: section.color }}
          />
          <h3 className="font-semibold text-xs tracking-wide uppercase text-muted-foreground/60">
            {section.name}
          </h3>
        </div>
        <span className="text-[10px] text-muted-foreground/50">0 staff</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-muted/40 shadow-sm',
        'flex flex-col',
      )}
      style={{ gridColumn: `span ${span}` }}
    >
      {/* Section header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <span
            className="h-3 w-3 rounded-sm flex-shrink-0"
            style={{ backgroundColor: section.color }}
          />
          <h3 className="font-semibold text-sm tracking-wide uppercase">
            {section.name}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {overrunCount > 0 && (
            <span className="text-xs text-red-400 tabular-nums">
              {overrunCount} overrun
            </span>
          )}
          <span className="text-xs text-muted-foreground tabular-nums">
            {activeCount} staff
          </span>
        </div>
      </div>

      {/* Staff cards */}
      <div className="flex-1 p-2">
        <div
          className="grid gap-1.5"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))',
          }}
        >
          {staffJobs.map((job) => (
            <StaffJobCard
              key={job.assignment_id}
              job={job}
              onClick={() => onStaffClick(job)}
              shiftInfo={shiftInfo}
              precomputedShiftStatus={shiftStatuses.get(job.assignment_id) ?? null}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
