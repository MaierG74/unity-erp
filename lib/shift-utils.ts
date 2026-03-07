import type { ScheduleBreak } from '@/types/work-schedule';
import { stretchForBreaks } from '@/src/lib/laborScheduling';

export type ShiftStatus = 'ok' | 'tight' | 'overrun' | 'overtime-ok';

export interface ShiftAwareStatus {
  remainingWorkMinutes: number;
  willFinishInShift: boolean;
  estimatedFinishMinutes: number; // minutes from midnight
  overrunMinutes: number;         // 0 if finishes in time
  shiftStatus: ShiftStatus;
}

/** Threshold in minutes — jobs finishing within this window of shift end are "tight" */
const TIGHT_THRESHOLD = 30;

/**
 * Compute shift-aware status for a job.
 *
 * @param estimatedMinutes  total estimated work time for the job
 * @param minutesElapsed    how many minutes have been worked so far
 * @param nowMinutes        current time as minutes from midnight
 * @param shiftEndMinutes   normal shift end (minutes from midnight)
 * @param effectiveEndMinutes  actual end accounting for overtime
 * @param breaks            remaining breaks in the shift
 */
export function computeShiftAwareStatus(
  estimatedMinutes: number | null,
  minutesElapsed: number,
  nowMinutes: number,
  shiftEndMinutes: number,
  effectiveEndMinutes: number,
  breaks: ScheduleBreak[],
): ShiftAwareStatus {
  const estimated = estimatedMinutes ?? 0;
  const remaining = Math.max(0, estimated - minutesElapsed);

  if (remaining === 0 || estimated === 0) {
    return {
      remainingWorkMinutes: 0,
      willFinishInShift: true,
      estimatedFinishMinutes: nowMinutes,
      overrunMinutes: 0,
      shiftStatus: 'ok',
    };
  }

  // Project finish time accounting for remaining breaks
  const breakWindows = breaks.filter((b) => b.endMinutes > nowMinutes);
  const stretched = stretchForBreaks(nowMinutes, remaining, breakWindows);
  const estimatedFinish = stretched.wallEnd;

  // Check against shift boundaries
  const overrunNormal = Math.max(0, estimatedFinish - shiftEndMinutes);
  const overrunEffective = Math.max(0, estimatedFinish - effectiveEndMinutes);
  const willFinishInShift = estimatedFinish <= effectiveEndMinutes;

  let shiftStatus: ShiftStatus;
  if (overrunNormal <= 0) {
    // Finishes before normal shift end
    const margin = shiftEndMinutes - estimatedFinish;
    shiftStatus = margin < TIGHT_THRESHOLD ? 'tight' : 'ok';
  } else if (overrunEffective <= 0) {
    // Overruns normal but within overtime
    shiftStatus = 'overtime-ok';
  } else {
    shiftStatus = 'overrun';
  }

  return {
    remainingWorkMinutes: remaining,
    willFinishInShift,
    estimatedFinishMinutes: estimatedFinish,
    overrunMinutes: overrunEffective,
    shiftStatus,
  };
}

/** Convert minutes from midnight to a formatted time string like "5:00 PM" */
export function minutesToTimeString(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
  return `${h12}:${m.toString().padStart(2, '0')} ${period}`;
}

/** Get current time as minutes from midnight */
export function currentMinutesFromMidnight(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

/** Format a duration in minutes to a human-readable string like "2h 15m" */
export function formatDuration(minutes: number | null): string {
  if (minutes == null || minutes <= 0) return '-';
  if (minutes < 1) return `${Math.round(minutes * 60)}s`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
