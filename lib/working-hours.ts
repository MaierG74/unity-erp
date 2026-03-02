import type { ScheduleBreak } from '@/types/work-schedule';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DaySchedule {
  dayGroup: string;
  startMinutes: number;
  endMinutes: number;
  breaks: ScheduleBreak[];
  isActive: boolean;
}

export interface PauseEvent {
  pausedAt: Date;
  resumedAt: Date | null;
}

export interface ShiftOverride {
  overrideDate: string; // YYYY-MM-DD
  extendedEndMinutes: number;
}

export interface WorkingMinutesResult {
  totalMinutes: number;
  workingDays: number;
  pauseMinutes: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_GROUP_MAP: Record<number, string> = {
  0: 'sat-sun', // Sunday
  1: 'mon-thu',
  2: 'mon-thu',
  3: 'mon-thu',
  4: 'mon-thu',
  5: 'fri',
  6: 'sat-sun', // Saturday
};

/** Return the overlap in minutes between two ranges [a0,a1) and [b0,b1). */
function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/** Format a Date as YYYY-MM-DD in local time. */
function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Minutes since midnight for a Date in local time. */
function minuteOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** Get start-of-day (midnight local) for a Date. */
function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Calculate net working minutes between two timestamps, accounting for:
 * - Day-of-week schedules with breaks
 * - Inactive days (weekends)
 * - Shift overrides (extended end times)
 * - Pause events (with possible null resumedAt meaning "still paused")
 */
export function calculateWorkingMinutes(
  start: Date,
  end: Date,
  schedules: DaySchedule[],
  pauses: PauseEvent[],
  overrides: ShiftOverride[],
): WorkingMinutesResult {
  if (end <= start) {
    return { totalMinutes: 0, workingDays: 0, pauseMinutes: 0 };
  }

  // Build a lookup: dayGroup -> schedule
  const scheduleMap = new Map<string, DaySchedule>();
  for (const s of schedules) {
    scheduleMap.set(s.dayGroup, s);
  }

  // Build override lookup: dateString -> extendedEndMinutes
  const overrideMap = new Map<string, number>();
  for (const o of overrides) {
    overrideMap.set(o.overrideDate, o.extendedEndMinutes);
  }

  let totalMinutes = 0;
  let totalPauseMinutes = 0;
  let workingDays = 0;

  // Iterate each calendar day from start to end
  const current = startOfDay(start);
  const lastDay = startOfDay(end);

  while (current <= lastDay) {
    const dayOfWeek = current.getDay();
    const dayGroup = DAY_GROUP_MAP[dayOfWeek];
    const schedule = scheduleMap.get(dayGroup);

    if (!schedule || !schedule.isActive) {
      current.setDate(current.getDate() + 1);
      continue;
    }

    const dateStr = toDateString(current);

    // Determine shift window for this day
    let shiftStart = schedule.startMinutes;
    let shiftEnd = schedule.endMinutes;

    // Apply override if present
    const overrideEnd = overrideMap.get(dateStr);
    if (overrideEnd !== undefined) {
      shiftEnd = overrideEnd;
    }

    // Determine effective work window for this day
    // First day: clamp to actual start time
    // Last day: clamp to actual end time
    // Middle days: full shift
    const isFirstDay = toDateString(start) === dateStr;
    const isLastDay = toDateString(end) === dateStr;

    let windowStart = shiftStart;
    let windowEnd = shiftEnd;

    if (isFirstDay) {
      windowStart = Math.max(shiftStart, minuteOfDay(start));
    }
    if (isLastDay) {
      windowEnd = Math.min(shiftEnd, minuteOfDay(end));
    }

    // No work if window is empty
    if (windowStart >= windowEnd) {
      current.setDate(current.getDate() + 1);
      continue;
    }

    // Gross working minutes in window
    let dayMinutes = windowEnd - windowStart;

    // Subtract breaks overlapping the work window
    let breakMinutes = 0;
    for (const brk of schedule.breaks) {
      breakMinutes += overlap(windowStart, windowEnd, brk.startMinutes, brk.endMinutes);
    }
    dayMinutes -= breakMinutes;

    // Calculate pause deductions for this day
    let dayPauseMinutes = 0;
    for (const pause of pauses) {
      const pauseEnd = pause.resumedAt ?? end;
      // Convert pause times to minute-of-day for this calendar day
      const pauseStartDay = startOfDay(pause.pausedAt);
      const pauseEndDay = startOfDay(pauseEnd);

      // Determine pause range in minutes-of-day for this calendar day
      let pauseStartMin: number;
      let pauseEndMin: number;

      if (pauseStartDay.getTime() === current.getTime()) {
        pauseStartMin = minuteOfDay(pause.pausedAt);
      } else if (pauseStartDay < current) {
        pauseStartMin = 0; // pause started before this day
      } else {
        continue; // pause starts after this day
      }

      if (pauseEndDay.getTime() === current.getTime()) {
        pauseEndMin = minuteOfDay(pauseEnd);
      } else if (pauseEndDay > current) {
        pauseEndMin = 24 * 60; // pause extends past this day
      } else {
        continue; // pause ended before this day
      }

      // Overlap of pause with the work window (excluding breaks)
      // First get overlap with the work window
      const pauseWorkOverlap = overlap(windowStart, windowEnd, pauseStartMin, pauseEndMin);

      // Subtract the part of the pause that overlaps with breaks (already deducted)
      let pauseBreakOverlap = 0;
      for (const brk of schedule.breaks) {
        // Intersection of pause, work window, and break
        const tripleStart = Math.max(windowStart, pauseStartMin, brk.startMinutes);
        const tripleEnd = Math.min(windowEnd, pauseEndMin, brk.endMinutes);
        if (tripleEnd > tripleStart) {
          pauseBreakOverlap += tripleEnd - tripleStart;
        }
      }

      dayPauseMinutes += pauseWorkOverlap - pauseBreakOverlap;
    }

    dayMinutes -= dayPauseMinutes;
    dayMinutes = Math.max(0, dayMinutes);

    if (dayMinutes > 0 || (windowEnd > windowStart && dayMinutes === 0 && dayPauseMinutes > 0)) {
      // Count as a working day if there was any work window (even if fully paused)
      if (windowEnd - windowStart - breakMinutes > 0) {
        workingDays++;
      }
    }

    totalMinutes += dayMinutes;
    totalPauseMinutes += dayPauseMinutes;

    current.setDate(current.getDate() + 1);
  }

  return {
    totalMinutes,
    workingDays,
    pauseMinutes: totalPauseMinutes,
  };
}
