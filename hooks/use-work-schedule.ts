'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { ScheduleBreak, WorkScheduleForDate, WorkScheduleRow } from '@/types/work-schedule';

/** Maps a date's day-of-week (0=Sun … 6=Sat) to the schedule day_group key. */
export function getDayGroup(date: Date): string {
  const dow = date.getDay();
  if (dow >= 1 && dow <= 4) return 'mon-thu';
  if (dow === 5) return 'fri';
  return 'sat-sun';
}

/** Hardcoded fallbacks matching legacy behaviour (7 AM – 7 PM, no breaks). */
const FALLBACK_SCHEDULES: Record<string, WorkScheduleForDate> = {
  'mon-thu': {
    startMinutes: 420,
    endMinutes: 1140,
    breaks: [],
    dayGroup: 'mon-thu',
  },
  fri: {
    startMinutes: 420,
    endMinutes: 1140,
    breaks: [],
    dayGroup: 'fri',
  },
  'sat-sun': {
    startMinutes: 420,
    endMinutes: 1140,
    breaks: [],
    dayGroup: 'sat-sun',
  },
};

async function fetchWorkSchedules(): Promise<WorkScheduleRow[]> {
  const { data, error } = await supabase
    .from('work_schedules')
    .select('*')
    .eq('is_active', true)
    .order('display_order');

  if (error) {
    console.warn('[useWorkSchedule] Failed to fetch work schedules', error);
    return [];
  }

  return (data ?? []) as WorkScheduleRow[];
}

/**
 * Returns the active work schedule for the given date string (YYYY-MM-DD).
 * Pass an empty string when the schedule is not needed — the query will be
 * skipped and fallback defaults returned.
 * Falls back to hardcoded defaults (7 AM – 7 PM, no breaks) when no DB rows exist.
 */
export function useWorkSchedule(selectedDate: string): WorkScheduleForDate {
  const enabled = selectedDate.length > 0;

  const dayGroup = useMemo(
    () => (enabled ? getDayGroup(new Date(selectedDate + 'T00:00:00')) : 'mon-thu'),
    [selectedDate, enabled],
  );

  const { data: schedules } = useQuery({
    queryKey: ['work-schedules', 'active'],
    queryFn: fetchWorkSchedules,
    staleTime: 5 * 60 * 1000, // 5 min – schedules change rarely
    enabled,
  });

  return useMemo(() => {
    const match = schedules?.find((s) => s.day_group === dayGroup);
    if (!match) return FALLBACK_SCHEDULES[dayGroup] ?? FALLBACK_SCHEDULES['mon-thu'];

    return {
      startMinutes: match.start_minutes,
      endMinutes: match.end_minutes,
      breaks: (match.breaks ?? []) as ScheduleBreak[],
      dayGroup: match.day_group,
    };
  }, [schedules, dayGroup]);
}
