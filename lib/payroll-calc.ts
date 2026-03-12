import type { OrgSettings } from '@/hooks/use-org-settings';
import { calculateWeeklyPayrollMinutes, standardWeekHoursToMinutes, type WeeklyPayrollSourceRow } from './payroll-hours';

type PayrollSettings = Pick<OrgSettings, 'standardWeekHours' | 'otThresholdMinutes'>;

export interface PayrollStaff {
  staff_id: number;
  first_name: string;
  last_name: string | null;
  job_description: string | null;
  hourly_rate: number;
}

export interface PayrollRow {
  staff_id: number;
  name: string;
  job_description: string | null;
  hourly_rate: number;
  // Raw minutes (before override) — kept for recalculation
  rawRegularMinutes: number;
  rawOtMinutes: number;
  rawDtMinutes: number;
  // Effective values (after override applied)
  regularHours: number;
  otHours: number;
  dtHours: number;
  hourlyTotal: number;
  pieceworkGross: number;
  supportDeduction: number;
  pieceworkNet: number;
  finalPay: number;
  otOverride: boolean; // true = standard hours only (OT zeroed)
  flaggedForReview: boolean; // true = OT >= threshold, needs manager review
  payrollId: number | null; // existing record ID if already calculated
  status: 'pending' | 'approved' | 'paid' | 'new';
}

interface HoursRow extends WeeklyPayrollSourceRow {
  staff_id: number;
}

interface PieceworkRow {
  staff_id: number;
  earned_amount: string | number;
}

interface SupportLink {
  primary_staff_id: number;
  support_staff_id: number;
  cost_share_pct: number;
}

interface ExistingPayroll {
  payroll_id: number;
  staff_id: number;
  status: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function calcHourlyTotal(
  regMinutes: number,
  otMinutes: number,
  dtMinutes: number,
  hourlyRate: number,
  otOverride: boolean,
): { regularHours: number; otHours: number; dtHours: number; hourlyTotal: number } {
  const effectiveOt = otOverride ? 0 : otMinutes;
  const effectiveReg = otOverride ? regMinutes + otMinutes : regMinutes;
  const regHours = effectiveReg / 60;
  const otHours = effectiveOt / 60;
  const dtHours = dtMinutes / 60;

  const hourlyTotal =
    regHours * hourlyRate +
    otHours * hourlyRate * 1.5 +
    dtHours * hourlyRate * 2.0;

  return {
    regularHours: round2(regHours),
    otHours: round2(otHours),
    dtHours: round2(dtHours),
    hourlyTotal: round2(hourlyTotal),
  };
}

export function calculatePayrollRows(
  staff: PayrollStaff[],
  hours: HoursRow[],
  piecework: PieceworkRow[],
  supportLinks: SupportLink[],
  existingPayroll: ExistingPayroll[],
  settings: PayrollSettings,
): PayrollRow[] {
  // Aggregate hours per staff using the weekly payroll rule:
  // first 44h regular, remaining non-double-time hours as OT.
  const hoursByStaff = new Map<number, { reg: number; ot: number; dt: number }>();
  const sourceRowsByStaff = new Map<number, HoursRow[]>();
  for (const h of hours) {
    const rows = sourceRowsByStaff.get(h.staff_id) ?? [];
    rows.push(h);
    sourceRowsByStaff.set(h.staff_id, rows);
  }

  sourceRowsByStaff.forEach((rows, staffId) => {
    const weeklyMinutes = calculateWeeklyPayrollMinutes(rows, standardWeekHoursToMinutes(settings.standardWeekHours));
    hoursByStaff.set(staffId, {
      reg: weeklyMinutes.regularMinutes,
      ot: weeklyMinutes.otMinutes,
      dt: weeklyMinutes.dtMinutes,
    });
  });

  // Aggregate piecework per staff
  const pieceworkByStaff = new Map<number, number>();
  for (const p of piecework) {
    const amt = typeof p.earned_amount === 'string' ? parseFloat(p.earned_amount) : p.earned_amount;
    pieceworkByStaff.set(p.staff_id, (pieceworkByStaff.get(p.staff_id) ?? 0) + amt);
  }

  // Compute support deductions per primary worker
  const staffMap = new Map(staff.map((s) => [s.staff_id, s]));
  const supportDeductions = new Map<number, number>();
  for (const link of supportLinks) {
    const supportHours = hoursByStaff.get(link.support_staff_id);
    const supportStaff = staffMap.get(link.support_staff_id);
    if (!supportHours || !supportStaff) continue;
    const { hourlyTotal: supportHourlyTotal } = calcHourlyTotal(
      supportHours.reg, supportHours.ot, supportHours.dt, supportStaff.hourly_rate, false,
    );
    const deduction = supportHourlyTotal * (link.cost_share_pct / 100);
    supportDeductions.set(
      link.primary_staff_id,
      (supportDeductions.get(link.primary_staff_id) ?? 0) + deduction,
    );
  }

  // Map existing payroll records
  const existingMap = new Map(existingPayroll.map((p) => [p.staff_id, p]));

  return staff.map((s) => {
    const h = hoursByStaff.get(s.staff_id) ?? { reg: 0, ot: 0, dt: 0 };
    const existing = existingMap.get(s.staff_id);
    const pieceworkGross = pieceworkByStaff.get(s.staff_id) ?? 0;
    const deduction = supportDeductions.get(s.staff_id) ?? 0;
    const pieceworkNet = Math.max(0, pieceworkGross - deduction);

    // OT override logic
    const flaggedForReview = h.ot >= settings.otThresholdMinutes;
    const otOverride = !flaggedForReview; // auto-toggle for low OT

    const { regularHours, otHours, dtHours, hourlyTotal } = calcHourlyTotal(
      h.reg, h.ot, h.dt, s.hourly_rate, otOverride,
    );

    const finalPay = Math.max(hourlyTotal, pieceworkNet);

    return {
      staff_id: s.staff_id,
      name: `${s.first_name} ${s.last_name ?? ''}`.trim(),
      job_description: s.job_description,
      hourly_rate: s.hourly_rate,
      rawRegularMinutes: h.reg,
      rawOtMinutes: h.ot,
      rawDtMinutes: h.dt,
      regularHours,
      otHours,
      dtHours,
      hourlyTotal,
      pieceworkGross: round2(pieceworkGross),
      supportDeduction: round2(deduction),
      pieceworkNet: round2(pieceworkNet),
      finalPay: round2(finalPay),
      otOverride,
      flaggedForReview,
      payrollId: existing?.payroll_id ?? null,
      status: existing ? (existing.status as PayrollRow['status']) : 'new',
    };
  });
}

/** Recalculate a single row when OT override is toggled */
export function recalcRowWithOverride(row: PayrollRow, override: boolean): PayrollRow {
  const { regularHours, otHours, dtHours, hourlyTotal } = calcHourlyTotal(
    row.rawRegularMinutes, row.rawOtMinutes, row.rawDtMinutes, row.hourly_rate, override,
  );

  const finalPay = Math.max(hourlyTotal, row.pieceworkNet);

  return {
    ...row,
    otOverride: override,
    regularHours,
    otHours,
    dtHours,
    hourlyTotal,
    finalPay: round2(finalPay),
  };
}
