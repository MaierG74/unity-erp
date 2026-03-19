import { supabase } from '@/lib/supabase';
import type { PayrollRow } from '@/lib/payroll-calc';

type PayrollStatus = PayrollRow['status'];

/** Fetch weekly hours from time_daily_summary for all staff in a date range */
export async function fetchWeeklyHours(startDate: string, endDate: string) {
  const { data, error } = await supabase
    .from('time_daily_summary')
    .select('staff_id, date_worked, regular_minutes, ot_minutes, dt_minutes, first_clock_in, last_clock_out, total_hours_worked')
    .gte('date_worked', startDate)
    .lte('date_worked', endDate);
  if (error) throw error;
  return data ?? [];
}

/** Fetch piecework earnings for all staff in a date range */
export async function fetchWeeklyPiecework(startDate: string, endDate: string) {
  const { data, error } = await supabase
    .from('staff_piecework_earnings')
    .select('staff_id, item_id, job_card_id, order_id, completion_date, job_id, product_id, completed_quantity, piece_rate, piece_rate_override, earned_amount')
    .gte('completion_date', startDate)
    .lte('completion_date', endDate);
  if (error) throw error;
  return data ?? [];
}

/** Fetch active support links */
export async function fetchActiveSupportLinks() {
  const { data, error } = await supabase
    .from('staff_support_links')
    .select('primary_staff_id, support_staff_id, cost_share_pct')
    .is('effective_until', null);
  if (error) throw error;
  return data ?? [];
}

/** Fetch all active staff with hourly_rate */
export async function fetchStaffForPayroll() {
  const { data, error } = await supabase
    .from('staff')
    .select('staff_id, first_name, last_name, hourly_rate, job_description, is_active')
    .eq('is_active', true)
    .order('first_name');
  if (error) throw error;
  return data ?? [];
}

/** Fetch existing payroll records for a week */
export async function fetchPayrollRecords(weekStartDate: string) {
  const { data, error } = await supabase
    .from('staff_weekly_payroll')
    .select('payroll_id, staff_id, status')
    .eq('week_start_date', weekStartDate);
  if (error) throw error;
  return data ?? [];
}

/** Upsert a batch of payroll records */
export async function upsertPayrollRecords(records: {
  staff_id: number;
  week_start_date: string;
  week_end_date: string;
  regular_hours: number;
  overtime_hours: number;
  doubletime_hours: number;
  hourly_wage_total: number;
  piece_work_total: number;
  final_payment: number;
  status: PayrollStatus;
  org_id: string;
}[]) {
  const { error } = await supabase
    .from('staff_weekly_payroll')
    .upsert(records, { onConflict: 'staff_id,week_start_date' });
  if (error) throw error;
}

/** Update status for multiple payroll records */
export async function updatePayrollStatus(payrollIds: number[], status: PayrollStatus, paymentDate?: string) {
  const update: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (paymentDate) update.payment_date = paymentDate;
  const { error } = await supabase
    .from('staff_weekly_payroll')
    .update(update)
    .in('payroll_id', payrollIds);
  if (error) throw error;
}
