'use client';

import { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, startOfWeek, addDays } from 'date-fns';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchWeekSummary, type DaySummary } from '@/lib/queries/laborPlanning';

const WEEK_STRIP_STORAGE_KEY = 'labor-planning-week-strip';
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;

function getStoredCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(WEEK_STRIP_STORAGE_KEY) === 'collapsed';
}

interface WeekStripProps {
  selectedDate: string;
  onDateSelect: (date: string) => void;
  /** Total available capacity in minutes across all active staff for the shift. */
  staffCapacityMinutes: number;
}

export function WeekStrip({ selectedDate, onDateSelect, staffCapacityMinutes }: WeekStripProps) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(getStoredCollapsed());
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(WEEK_STRIP_STORAGE_KEY, next ? 'collapsed' : 'expanded');
      return next;
    });
  };

  const monday = useMemo(
    () => startOfWeek(new Date(selectedDate + 'T00:00:00'), { weekStartsOn: 1 }),
    [selectedDate],
  );

  const weekDates = useMemo(
    () => Array.from({ length: 5 }, (_, i) => format(addDays(monday, i), 'yyyy-MM-dd')),
    [monday],
  );

  const mondayKey = format(monday, 'yyyy-MM-dd');

  const { data: summaries } = useQuery({
    queryKey: ['labor-planning-week-summary', mondayKey],
    queryFn: () => fetchWeekSummary(weekDates),
    staleTime: 5 * 60 * 1000,
  });

  const today = format(new Date(), 'yyyy-MM-dd');

  const summaryMap = useMemo(() => {
    const map = new Map<string, DaySummary>();
    if (summaries) {
      for (const s of summaries) map.set(s.date, s);
    }
    return map;
  }, [summaries]);

  return (
    <div className="rounded-lg border bg-card">
      <button
        onClick={toggleCollapsed}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        Week overview
        <span className="ml-auto text-[10px] font-normal">
          {format(monday, 'MMM d')} – {format(addDays(monday, 4), 'MMM d')}
        </span>
      </button>

      {!collapsed && (
        <div className="grid grid-cols-5 gap-1 px-3 pb-2">
          {weekDates.map((date, i) => {
            const summary = summaryMap.get(date);
            const isSelected = date === selectedDate;
            const isToday = date === today;
            const utilPct = staffCapacityMinutes > 0 && summary
              ? Math.min((summary.totalAssignedMinutes / staffCapacityMinutes) * 100, 100)
              : 0;

            return (
              <button
                key={date}
                onClick={() => onDateSelect(date)}
                className={cn(
                  'relative flex flex-col items-center gap-0.5 rounded-md px-2 py-1.5 text-center transition-all',
                  'hover:bg-muted/60',
                  isSelected && 'ring-1 ring-primary bg-primary/5',
                  !isSelected && 'bg-muted/20',
                )}
              >
                <div className="flex items-center gap-1">
                  <span className={cn(
                    'text-[10px] font-semibold',
                    isSelected ? 'text-primary' : 'text-muted-foreground',
                  )}>
                    {DAY_LABELS[i]}
                  </span>
                  {isToday && (
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                  )}
                </div>
                <span className={cn(
                  'text-[10px]',
                  isSelected ? 'text-foreground font-medium' : 'text-muted-foreground',
                )}>
                  {format(new Date(date + 'T00:00:00'), 'MMM d')}
                </span>

                {/* Utilization bar */}
                <div className="mt-0.5 h-1.5 w-full rounded-full bg-muted/50 overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      utilPct >= 90 ? 'bg-red-500' : utilPct >= 60 ? 'bg-amber-500' : 'bg-emerald-500',
                    )}
                    style={{ width: `${utilPct}%` }}
                  />
                </div>

                {/* Job count */}
                {summary && summary.assignmentCount > 0 && (
                  <span className={cn(
                    'text-[9px]',
                    isSelected ? 'text-foreground/70' : 'text-muted-foreground/70',
                  )}>
                    {summary.assignmentCount} job{summary.assignmentCount !== 1 ? 's' : ''}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
