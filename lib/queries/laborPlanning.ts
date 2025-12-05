import { supabase } from '@/lib/supabase';
import type { LaborPlanAssignment, PlanningJob, PlanningOrder } from '@/components/labor-planning/types';
import { getCategoryColor } from '@/src/lib/laborScheduling';

type PayType = 'hourly' | 'piece';
type TimeUnit = 'hours' | 'minutes' | 'seconds';

interface PlanningJobWithMeta extends PlanningJob {
  orderId: number;
  orderDetailId: number | null;
  productId: number | null;
  productName: string | null;
  bolId: number | null;
  jobId: number | null;
  categoryName: string | null;
  categoryColor: string | null;
  payType: PayType;
  quantity: number;
  durationMinutes: number | null;
  timeUnit: TimeUnit;
  rateId: number | null;
  hourlyRateId: number | null;
  pieceRateId: number | null;
}

export interface PlanningOrderWithMeta extends PlanningOrder {
  orderId: number;
  orderNumber: string;
  statusName: string | null;
  jobs: PlanningJobWithMeta[];
}

export interface StaffAvailability {
  isActive: boolean;
  isCurrent: boolean;
  hasSummaryOnDate: boolean;
  isAvailableOnDate: boolean;
}

export interface StaffRosterEntry {
  id: number;
  name: string;
  role: string | null;
  availability: StaffAvailability;
  capacityHours: number | null;
}

export interface StaffRosterOptions {
  date?: string;
  includeInactive?: boolean;
}

export interface LaborPlanningPayload {
  orders: PlanningOrderWithMeta[];
  staff: StaffRosterEntry[];
  unscheduledJobs: PlanningJobWithMeta[];
  assignments: LaborPlanAssignment[];
}

const CLOSED_STATUS_NAMES = ['completed', 'cancelled', 'closed', 'delivered'];
export async function fetchOpenOrdersWithLabor(): Promise<PlanningOrderWithMeta[]> {
  const closedStatusIds = await loadClosedStatusIds();

  let ordersQuery = supabase
    .from('orders')
    .select(`
      order_id,
      order_number,
      delivery_date,
      order_date,
      status_id,
      order_statuses(status_name),
      customers(name),
      order_details(
        order_detail_id,
        quantity,
        product_id,
        products(
          product_id,
          name,
          billoflabour(
            bol_id,
            job_id,
            time_required,
            time_unit,
            quantity,
            pay_type,
            rate_id,
            hourly_rate_id,
            piece_rate_id,
            jobs(
              job_id,
              name,
              job_categories(
                category_id,
                name
              )
            )
          )
        )
      )
    `)
    .order('delivery_date', { ascending: true });

  if (closedStatusIds.length > 0) {
    ordersQuery = ordersQuery.not('status_id', 'in', `(${closedStatusIds.join(',')})`);
  }

  const { data, error } = await ordersQuery;
  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];

  return rows.map((row: any) => normalizeOrderRow(row)).filter(Boolean) as PlanningOrderWithMeta[];
}

export async function fetchStaffRoster(options: StaffRosterOptions = {}): Promise<StaffRosterEntry[]> {
  const { date, includeInactive = false } = options;

  let staffQuery = supabase
    .from('staff')
    .select('staff_id, first_name, last_name, job_description, is_active, current_staff, weekly_hours')
    .order('last_name', { ascending: true });

  if (!includeInactive) {
    staffQuery = staffQuery.eq('is_active', true);
  }

  const { data: staffRows, error: staffError } = await staffQuery;
  if (staffError) throw staffError;

  const summariesByStaff = await loadSummariesForDate(date);

  return (staffRows || []).map((row: any) => {
    const staffId = Number(row.staff_id);
    const hasSummary = summariesByStaff.has(staffId);
    const isActive = Boolean(row.is_active);
    const isCurrent = row.current_staff ?? true;

    return {
      id: staffId,
      name: [row.first_name, row.last_name].filter(Boolean).join(' ').trim(),
      role: row.job_description ?? null,
      capacityHours: toNumber(row.weekly_hours),
      availability: {
        isActive,
        isCurrent,
        hasSummaryOnDate: hasSummary,
        isAvailableOnDate: isActive && isCurrent,
      },
    };
  });
}

export async function fetchLaborAssignments(options: { date?: string } = {}): Promise<LaborPlanAssignment[]> {
  const { date } = options;

  let assignmentQuery = supabase
    .from('labor_plan_assignments')
    .select(
      'assignment_id, job_instance_id, order_id, order_detail_id, bol_id, job_id, staff_id, assignment_date, start_minutes, end_minutes, status, pay_type, rate_id, hourly_rate_id, piece_rate_id'
    )
    .order('start_minutes', { ascending: true });

  if (date) {
    assignmentQuery = assignmentQuery.eq('assignment_date', date);
  }

  const { data, error } = await assignmentQuery;
  if (error) {
    console.warn('[laborPlanning] Failed to load labor assignments', error);
    return [];
  }

  return (data || []).map((row: any) => normalizeAssignmentRow(row));
}

export async function fetchLaborPlanningPayload(options: { date?: string } = {}): Promise<LaborPlanningPayload> {
  const [orders, staff, assignments] = await Promise.all([
    fetchOpenOrdersWithLabor(),
    fetchStaffRoster({ date: options.date }),
    fetchLaborAssignments({ date: options.date }),
  ]);

  const assignmentsByJob = new Map(assignments.map((assignment) => [assignment.jobKey, assignment]));
  const annotatedOrders = orders.map((order) => ({
    ...order,
    jobs: order.jobs.map((job) => {
      const scheduled = assignmentsByJob.get(job.id);
      return {
        ...job,
        scheduleStatus: scheduled && scheduled.status !== 'unscheduled' ? 'scheduled' : 'unscheduled',
        status: job.status ?? 'ready',
      };
    }),
  }));

  const unscheduledJobs = annotatedOrders
    .flatMap((order) => order.jobs.filter((job) => job.scheduleStatus !== 'scheduled'))
    .map((job) => ({
      ...job,
      scheduleStatus: 'unscheduled',
    }));

  return { orders: annotatedOrders, staff, unscheduledJobs, assignments };
}

async function loadClosedStatusIds(): Promise<number[]> {
  const { data, error } = await supabase.from('order_statuses').select('status_id, status_name');
  if (error) {
    console.warn('[laborPlanning] Failed to load order statuses; returning empty closed list', error);
    return [];
  }

  const closed = (data || []).filter((row: any) =>
    CLOSED_STATUS_NAMES.includes(String(row.status_name ?? '').toLowerCase())
  );

  return closed
    .map((row: any) => Number(row.status_id))
    .filter((id) => Number.isFinite(id));
}

async function loadSummariesForDate(date?: string): Promise<Set<number>> {
  if (!date) return new Set();

  const { data, error } = await supabase
    .from('time_daily_summary')
    .select('staff_id')
    .eq('date_worked', date);

  if (error) {
    console.warn('[laborPlanning] Failed to load time_daily_summary rows', error);
    return new Set();
  }

  return new Set(
    (data || [])
      .map((row: any) => Number(row.staff_id))
      .filter((id) => Number.isFinite(id))
  );
}

function normalizeOrderRow(row: any): PlanningOrderWithMeta | null {
  if (!row) return null;

  const statusRow = extractSingle(row.order_statuses);
  const customer = extractSingle(row.customers);
  const details = Array.isArray(row.order_details) ? row.order_details : [];
  const jobs = details.flatMap((detail: any) => normalizeDetailJobs(row, detail));

  return {
    id: row.order_number ? String(row.order_number) : `SO-${row.order_id}`,
    orderId: Number(row.order_id),
    orderNumber: row.order_number ?? `SO-${row.order_id}`,
    customer: customer?.name ?? 'Unknown customer',
    priority: derivePriority(row.delivery_date ?? row.order_date),
    dueDate: row.delivery_date ?? row.order_date ?? null,
    statusName: statusRow?.status_name ?? null,
    jobs,
  };
}

function normalizeDetailJobs(order: any, detail: any): PlanningJobWithMeta[] {
  const product = extractSingle(detail?.products);
  const bolRows = Array.isArray(product?.billoflabour) ? product.billoflabour : [];
  const orderQty = toNumber(detail?.quantity) ?? 1;
  const productId = product?.product_id ?? detail?.product_id ?? null;
  const productName = product?.name ?? null;

  return bolRows.map((bol: any) => {
    const job = extractSingle(bol.jobs);
    const category = extractSingle(job?.job_categories);
    const jobQuantity = (toNumber(bol.quantity) ?? 1) * orderQty;
    const timeUnit = String(bol.time_unit ?? 'hours').toLowerCase() as TimeUnit;
    const baseMinutes = convertToMinutes(bol.time_required, timeUnit);
    const totalMinutes = baseMinutes != null ? baseMinutes * jobQuantity : null;

    const categoryName = category?.name ?? null;
    const categoryColor = getCategoryColor(category?.category_id ?? categoryName);
    const payType = String(bol.pay_type ?? 'hourly').toLowerCase() as PayType;

    return {
      id: buildJobId(order.order_id, detail.order_detail_id, bol.bol_id, bol.job_id),
      name: job?.name ?? `Job ${bol.job_id ?? ''}`.trim(),
      status: 'ready',
      durationHours: totalMinutes != null ? Number((totalMinutes / 60).toFixed(2)) : 0,
      durationMinutes: totalMinutes,
      owner: categoryName ?? productName ?? 'Unassigned',
      start: undefined,
      end: undefined,
      orderId: Number(order.order_id),
      orderDetailId: detail?.order_detail_id ?? null,
      productId: productId ? Number(productId) : null,
      productName,
      bolId: bol?.bol_id ?? null,
      jobId: bol?.job_id ?? null,
      categoryName,
      categoryColor,
      payType,
      quantity: jobQuantity,
      timeUnit,
      rateId: bol?.rate_id ?? null,
      hourlyRateId: bol?.hourly_rate_id ?? null,
      pieceRateId: bol?.piece_rate_id ?? null,
      scheduleStatus: 'unscheduled',
    };
  });
}

function normalizeAssignmentRow(row: any): LaborPlanAssignment {
  const startMinutes = toNumber(row?.start_minutes);
  const endMinutes = toNumber(row?.end_minutes);
  const payType = (row?.pay_type ?? 'hourly').toLowerCase() as PayType;
  const status =
    String(row?.status ?? 'scheduled').toLowerCase() === 'unscheduled' ? 'unscheduled' : 'scheduled';

  const jobKey = row?.job_instance_id
    ? String(row.job_instance_id)
    : buildJobId(row?.order_id ?? 'unknown', row?.order_detail_id, row?.bol_id, row?.job_id);

  return {
    assignmentId: row?.assignment_id ? String(row.assignment_id) : jobKey,
    jobKey,
    orderId: toNumber(row?.order_id),
    orderDetailId: toNumber(row?.order_detail_id),
    bolId: toNumber(row?.bol_id),
    jobId: toNumber(row?.job_id),
    staffId: toNumber(row?.staff_id),
    assignmentDate: row?.assignment_date ?? null,
    startMinutes: startMinutes ?? null,
    endMinutes: endMinutes ?? null,
    status,
    payType: payType === 'piece' ? 'piece' : 'hourly',
    rateId: toNumber(row?.rate_id),
    hourlyRateId: toNumber(row?.hourly_rate_id),
    pieceRateId: toNumber(row?.piece_rate_id),
  };
}

function extractSingle<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return (value[0] ?? null) as T | null;
  return (value as T) ?? null;
}

function convertToMinutes(time: unknown, unit?: string | null): number | null {
  if (time == null) return null;
  const numeric = Number(time);
  if (!Number.isFinite(numeric)) return null;

  const normalizedUnit = (unit ?? 'hours').toLowerCase() as TimeUnit;
  if (normalizedUnit === 'minutes') return numeric;
  if (normalizedUnit === 'seconds') return numeric / 60;
  return numeric * 60;
}

function toNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function derivePriority(dueDate?: string | null): PlanningOrder['priority'] {
  if (!dueDate) return 'medium';
  const target = new Date(dueDate);
  if (Number.isNaN(target.getTime())) return 'medium';

  const now = new Date();
  const daysDiff = Math.floor((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysDiff <= 2) return 'high';
  if (daysDiff <= 7) return 'medium';
  return 'low';
}

function buildJobId(
  orderId: number | string,
  orderDetailId: number | string | null | undefined,
  bolId: number | string | null | undefined,
  jobId: number | string | null | undefined
): string {
  const pieces = [
    `order-${orderId}`,
    orderDetailId != null ? `detail-${orderDetailId}` : null,
    bolId != null ? `bol-${bolId}` : null,
    jobId != null ? `job-${jobId}` : null,
  ].filter(Boolean);

  return pieces.join(':');
}
