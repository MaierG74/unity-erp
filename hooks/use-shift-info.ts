'use client';

import { useMemo, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useWorkSchedule } from '@/hooks/use-work-schedule';
import type { ScheduleBreak } from '@/types/work-schedule';
import { currentMinutesFromMidnight, minutesToTimeString } from '@/lib/shift-utils';

export interface ShiftInfo {
  startMinutes: number;
  normalEndMinutes: number;
  effectiveEndMinutes: number;
  hasOvertime: boolean;
  overtimeMinutes: number;
  overtimeReason: string | null;
  breaks: ScheduleBreak[];
  minutesUntilShiftEnd: number;
  shiftEndFormatted: string;
  shiftStartFormatted: string;
  isLoading: boolean;
}

/** Full shift info including live `nowMinutes` — returned by `useShiftInfo()`. */
export type ShiftInfoWithNow = ShiftInfo & { nowMinutes: number };

interface ShiftOverrideRow {
  override_id: number;
  override_date: string;
  extended_end_minutes: number;
  reason: string | null;
}

const OVERRIDE_QUERY_KEY = ['shift-overrides'];

async function fetchTodayOverride(dateStr: string): Promise<ShiftOverrideRow | null> {
  const { data, error } = await supabase
    .from('shift_overrides')
    .select('*')
    .eq('override_date', dateStr)
    .maybeSingle();

  if (error) {
    console.warn('[useShiftInfo] Failed to fetch shift override', error);
    return null;
  }
  return data as ShiftOverrideRow | null;
}

export function useShiftInfo(todayStr: string) {
  const queryClient = useQueryClient();
  const schedule = useWorkSchedule(todayStr);

  const { data: override, isLoading } = useQuery({
    queryKey: [...OVERRIDE_QUERY_KEY, todayStr],
    queryFn: () => fetchTodayOverride(todayStr),
    staleTime: 60_000,
    enabled: todayStr.length > 0,
  });

  // Recalculate "minutes until shift end" every 30s
  const [nowMinutes, setNowMinutes] = useState(currentMinutesFromMidnight);
  useEffect(() => {
    const interval = setInterval(() => setNowMinutes(currentMinutesFromMidnight()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const shiftInfo: ShiftInfo = useMemo(() => {
    const normalEnd = schedule.endMinutes;
    const effectiveEnd = override?.extended_end_minutes ?? normalEnd;
    const hasOvertime = effectiveEnd > normalEnd;

    return {
      startMinutes: schedule.startMinutes,
      normalEndMinutes: normalEnd,
      effectiveEndMinutes: effectiveEnd,
      hasOvertime,
      overtimeMinutes: hasOvertime ? effectiveEnd - normalEnd : 0,
      overtimeReason: override?.reason ?? null,
      breaks: schedule.breaks,
      minutesUntilShiftEnd: Math.max(0, effectiveEnd - nowMinutes),
      shiftEndFormatted: minutesToTimeString(effectiveEnd),
      shiftStartFormatted: minutesToTimeString(schedule.startMinutes),
      isLoading,
    };
  }, [schedule, override, nowMinutes, isLoading]);

  // Mutations for setting/clearing overtime
  const setOvertimeMutation = useMutation({
    mutationFn: async ({ endMinutes, reason }: { endMinutes: number; reason?: string }) => {
      const { error } = await supabase
        .from('shift_overrides')
        .upsert(
          {
            override_date: todayStr,
            extended_end_minutes: endMinutes,
            reason: reason || null,
          },
          { onConflict: 'org_id,override_date' },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OVERRIDE_QUERY_KEY });
    },
  });

  const clearOvertimeMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('shift_overrides')
        .delete()
        .eq('override_date', todayStr);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OVERRIDE_QUERY_KEY });
    },
  });

  return {
    ...shiftInfo,
    nowMinutes,
    setOvertime: setOvertimeMutation.mutate,
    clearOvertime: clearOvertimeMutation.mutate,
    isMutating: setOvertimeMutation.isPending || clearOvertimeMutation.isPending,
  };
}
