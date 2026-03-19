export const DEFAULT_STANDARD_WEEK_HOURS = 44;
export const DEFAULT_STANDARD_WEEK_MINUTES = DEFAULT_STANDARD_WEEK_HOURS * 60;

export interface WeeklyPayrollSourceRow {
  date_worked?: string;
  regular_minutes?: number | null;
  ot_minutes?: number | null;
  dt_minutes?: number | null;
}

export interface WeeklyPayrollMinutes {
  regularMinutes: number;
  otMinutes: number;
  dtMinutes: number;
  totalMinutes: number;
}

export interface WeeklyPayrollAllocatedRow {
  payroll_regular_minutes: number;
  payroll_ot_minutes: number;
  payroll_dt_minutes: number;
  total_minutes: number;
}

export function standardWeekHoursToMinutes(standardWeekHours: number): number {
  return Math.round(standardWeekHours * 60);
}

export function getWorkedMinutes(row: WeeklyPayrollSourceRow): number {
  return (row.regular_minutes ?? 0) + (row.ot_minutes ?? 0) + (row.dt_minutes ?? 0);
}

export function calculateWeeklyPayrollMinutes(
  rows: WeeklyPayrollSourceRow[],
  weeklyStandardMinutes: number = DEFAULT_STANDARD_WEEK_MINUTES,
): WeeklyPayrollMinutes {
  const dtMinutes = rows.reduce((sum, row) => sum + (row.dt_minutes ?? 0), 0);
  const nonDoubleTimeMinutes = rows.reduce(
    (sum, row) => sum + (row.regular_minutes ?? 0) + (row.ot_minutes ?? 0),
    0,
  );

  return {
    regularMinutes: Math.min(nonDoubleTimeMinutes, weeklyStandardMinutes),
    otMinutes: Math.max(nonDoubleTimeMinutes - weeklyStandardMinutes, 0),
    dtMinutes,
    totalMinutes: nonDoubleTimeMinutes + dtMinutes,
  };
}

export function allocateWeeklyPayrollByDay<T extends WeeklyPayrollSourceRow>(
  rows: T[],
  weeklyStandardMinutes: number = DEFAULT_STANDARD_WEEK_MINUTES,
): Array<T & WeeklyPayrollAllocatedRow> {
  let remainingRegularMinutes = weeklyStandardMinutes;

  return [...rows]
    .sort((a, b) => (a.date_worked ?? '').localeCompare(b.date_worked ?? ''))
    .map((row) => {
      const nonDoubleTimeMinutes = (row.regular_minutes ?? 0) + (row.ot_minutes ?? 0);
      const payrollRegularMinutes = Math.min(nonDoubleTimeMinutes, Math.max(remainingRegularMinutes, 0));
      const payrollOtMinutes = Math.max(nonDoubleTimeMinutes - payrollRegularMinutes, 0);
      const payrollDtMinutes = row.dt_minutes ?? 0;

      remainingRegularMinutes = Math.max(remainingRegularMinutes - payrollRegularMinutes, 0);

      return {
        ...row,
        payroll_regular_minutes: payrollRegularMinutes,
        payroll_ot_minutes: payrollOtMinutes,
        payroll_dt_minutes: payrollDtMinutes,
        total_minutes: nonDoubleTimeMinutes + payrollDtMinutes,
      };
    });
}
