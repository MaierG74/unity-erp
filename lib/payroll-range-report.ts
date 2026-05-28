import { endOfWeek, format, parseISO, startOfWeek } from 'date-fns';
import {
  calculateWeeklyPayrollMinutes,
  standardWeekHoursToMinutes,
  type WeeklyPayrollSourceRow,
} from './payroll-hours';

export interface PayrollRangeStaff {
  staff_id: number;
  first_name: string;
  last_name: string | null;
  hourly_rate: number | null;
}

export interface PayrollRangeSummary extends WeeklyPayrollSourceRow {
  staff_id: number;
  date_worked: string;
  total_hours_worked?: number | null;
}

export interface PayrollRangeSegment {
  staff_id: number;
  date_worked: string;
  start_time: string;
  end_time: string | null;
  segment_type: 'work' | 'break';
  duration_minutes: number | null;
  break_type?: string | null;
}

export interface PayrollRangeWeek {
  week_start: string;
  week_end: string;
  week_label: string;
  days: PayrollRangeDay[];
  regular_hours: number;
  overtime_hours: number;
  doubletime_hours: number;
  total_hours: number;
  regular_earnings: number;
  overtime_earnings: number;
  doubletime_earnings: number;
  total_earnings: number;
  day_count: number;
}

export interface PayrollRangeDay {
  date_worked: string;
  day_label: string;
  segments: PayrollRangeDaySegment[];
  regular_hours: number;
  overtime_hours: number;
  doubletime_hours: number;
  total_hours: number;
}

export interface PayrollRangeDaySegment {
  start_time: string;
  end_time: string | null;
  segment_type: 'work' | 'break';
  duration_minutes: number | null;
  break_type?: string | null;
}

export interface PayrollRangeReportRow {
  staff_id: number;
  name: string;
  hourly_rate: number;
  regular_hours: number;
  overtime_hours: number;
  doubletime_hours: number;
  total_hours: number;
  regular_earnings: number;
  overtime_earnings: number;
  doubletime_earnings: number;
  total_earnings: number;
  weeks: PayrollRangeWeek[];
}

export interface BuildPayrollRangeReportArgs {
  staff: PayrollRangeStaff[];
  summaries: PayrollRangeSummary[];
  segments?: PayrollRangeSegment[];
  selectedStaffIds: number[];
  weekStartDay: number;
  standardWeekHours: number;
}

function roundHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function normalizeSourceRow(summary: PayrollRangeSummary): WeeklyPayrollSourceRow {
  if (summary.regular_minutes != null || summary.ot_minutes != null) {
    return summary;
  }

  const dtMinutes = summary.dt_minutes ?? 0;
  const totalMinutes = Math.round((summary.total_hours_worked ?? 0) * 60);
  return {
    ...summary,
    regular_minutes: Math.max(totalMinutes - dtMinutes, 0),
    ot_minutes: 0,
    dt_minutes: dtMinutes,
  };
}

function weekKey(dateWorked: string, weekStartDay: number): string {
  return format(
    startOfWeek(parseISO(dateWorked), { weekStartsOn: weekStartDay as 0 | 1 | 2 | 3 | 4 | 5 | 6 }),
    'yyyy-MM-dd',
  );
}

function buildWeekBreakdown(
  weekStart: string,
  rows: PayrollRangeSummary[],
  segments: PayrollRangeSegment[],
  weekStartDay: number,
  standardWeekHours: number,
  hourlyRate: number,
): PayrollRangeWeek {
  const weeklyMinutes = calculateWeeklyPayrollMinutes(
    rows.map(normalizeSourceRow),
    standardWeekHoursToMinutes(standardWeekHours),
  );
  const regularHours = roundHours(weeklyMinutes.regularMinutes);
  const overtimeHours = roundHours(weeklyMinutes.otMinutes);
  const doubletimeHours = roundHours(weeklyMinutes.dtMinutes);
  const totalHours = roundHours(weeklyMinutes.totalMinutes);
  const weekEnd = format(
    endOfWeek(parseISO(weekStart), { weekStartsOn: weekStartDay as 0 | 1 | 2 | 3 | 4 | 5 | 6 }),
    'yyyy-MM-dd',
  );
  const regularEarnings = roundMoney(regularHours * hourlyRate);
  const overtimeEarnings = roundMoney(overtimeHours * hourlyRate * 1.5);
  const doubletimeEarnings = roundMoney(doubletimeHours * hourlyRate * 2);
  const days = rows
    .map((row) => ({
      ...normalizeSourceRow(row),
      staff_id: row.staff_id,
      date_worked: row.date_worked,
    }))
    .sort((a, b) => a.date_worked.localeCompare(b.date_worked))
    .map((row) => {
      const regularMinutes = row.regular_minutes ?? 0;
      const overtimeMinutes = row.ot_minutes ?? 0;
      const doubletimeMinutes = row.dt_minutes ?? 0;
      const totalMinutes = regularMinutes + overtimeMinutes + doubletimeMinutes;

      return {
        date_worked: row.date_worked,
        day_label: format(parseISO(row.date_worked), 'EEE d MMM'),
        segments: segments
          .filter((segment) => segment.date_worked === row.date_worked && segment.staff_id === row.staff_id)
          .sort((a, b) => a.start_time.localeCompare(b.start_time))
          .map((segment) => ({
            start_time: segment.start_time,
            end_time: segment.end_time,
            segment_type: segment.segment_type,
            duration_minutes: segment.duration_minutes,
            break_type: segment.break_type,
          })),
        regular_hours: roundHours(regularMinutes),
        overtime_hours: roundHours(overtimeMinutes),
        doubletime_hours: roundHours(doubletimeMinutes),
        total_hours: roundHours(totalMinutes),
      };
    });

  return {
    week_start: weekStart,
    week_end: weekEnd,
    week_label: `${format(parseISO(weekStart), 'd MMM')} - ${format(parseISO(weekEnd), 'd MMM')}`,
    days,
    regular_hours: regularHours,
    overtime_hours: overtimeHours,
    doubletime_hours: doubletimeHours,
    total_hours: totalHours,
    regular_earnings: regularEarnings,
    overtime_earnings: overtimeEarnings,
    doubletime_earnings: doubletimeEarnings,
    total_earnings: roundMoney(regularEarnings + overtimeEarnings + doubletimeEarnings),
    day_count: rows.length,
  };
}

export function buildPayrollRangeReport({
  staff,
  summaries,
  segments = [],
  selectedStaffIds,
  weekStartDay,
  standardWeekHours,
}: BuildPayrollRangeReportArgs): PayrollRangeReportRow[] {
  const selected = new Set(selectedStaffIds);

  return staff
    .filter((person) => selected.has(person.staff_id))
    .sort((a, b) => a.first_name.localeCompare(b.first_name) || (a.last_name ?? '').localeCompare(b.last_name ?? ''))
    .map((person) => {
      const staffSummaries = summaries.filter((summary) => summary.staff_id === person.staff_id);
      const weeksByStart = new Map<string, PayrollRangeSummary[]>();

      for (const summary of staffSummaries) {
        const key = weekKey(summary.date_worked, weekStartDay);
        const rows = weeksByStart.get(key) ?? [];
        rows.push(summary);
        weeksByStart.set(key, rows);
      }

      const hourlyRate = person.hourly_rate ?? 0;
      const weeks = Array.from(weeksByStart.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([start, rows]) => buildWeekBreakdown(start, rows, segments, weekStartDay, standardWeekHours, hourlyRate));

      const totals = weeks.reduce(
        (acc, week) => {
          acc.regular_hours += week.regular_hours;
          acc.overtime_hours += week.overtime_hours;
          acc.doubletime_hours += week.doubletime_hours;
          acc.total_hours += week.total_hours;
          acc.regular_earnings += week.regular_earnings;
          acc.overtime_earnings += week.overtime_earnings;
          acc.doubletime_earnings += week.doubletime_earnings;
          acc.total_earnings += week.total_earnings;
          return acc;
        },
        {
          regular_hours: 0,
          overtime_hours: 0,
          doubletime_hours: 0,
          total_hours: 0,
          regular_earnings: 0,
          overtime_earnings: 0,
          doubletime_earnings: 0,
          total_earnings: 0,
        },
      );

      return {
        staff_id: person.staff_id,
        name: `${person.first_name} ${person.last_name ?? ''}`.trim() || `${person.staff_id}`,
        hourly_rate: hourlyRate,
        regular_hours: roundHours(totals.regular_hours * 60),
        overtime_hours: roundHours(totals.overtime_hours * 60),
        doubletime_hours: roundHours(totals.doubletime_hours * 60),
        total_hours: roundHours(totals.total_hours * 60),
        regular_earnings: roundMoney(totals.regular_earnings),
        overtime_earnings: roundMoney(totals.overtime_earnings),
        doubletime_earnings: roundMoney(totals.doubletime_earnings),
        total_earnings: roundMoney(totals.total_earnings),
        weeks,
      };
    });
}
