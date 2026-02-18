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
              estimated_minutes,
              time_unit,
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
    // Use .or() so orders with NULL status_id are also included (NOT IN excludes NULLs in SQL)
    ordersQuery = ordersQuery.or(
      `status_id.not.in.(${closedStatusIds.join(',')}),status_id.is.null`
    );
  }

  const { data, error } = await ordersQuery;
  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];

  // Also fetch job_card_items linked to orders (manually added jobs)
  const jobCardItemsByOrder = await loadJobCardItemsByOrder();

  return rows
    .map((row: any) => normalizeOrderRow(row, jobCardItemsByOrder))
    .filter(Boolean) as PlanningOrderWithMeta[];
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

  // Try with time tracking columns first, fall back to basic query if columns don't exist
  const fullSelect = 'assignment_id, job_instance_id, order_id, order_detail_id, bol_id, job_id, staff_id, assignment_date, start_minutes, end_minutes, status, pay_type, rate_id, hourly_rate_id, piece_rate_id, job_status, issued_at, started_at, completed_at';
  const basicSelect = 'assignment_id, job_instance_id, order_id, order_detail_id, bol_id, job_id, staff_id, assignment_date, start_minutes, end_minutes, status, pay_type, rate_id, hourly_rate_id, piece_rate_id';

  let assignmentQuery = supabase
    .from('labor_plan_assignments')
    .select(fullSelect)
    .order('start_minutes', { ascending: true });

  if (date) {
    assignmentQuery = assignmentQuery.eq('assignment_date', date);
  }

  let { data, error } = await assignmentQuery;

  // If query failed (likely due to missing columns), try without time tracking columns
  if (error) {
    console.warn('[laborPlanning] Full query failed, trying without time tracking columns:', error.message);
    let fallbackQuery = supabase
      .from('labor_plan_assignments')
      .select(basicSelect)
      .order('start_minutes', { ascending: true });

    if (date) {
      fallbackQuery = fallbackQuery.eq('assignment_date', date);
    }

    const fallbackResult = await fallbackQuery;
    if (fallbackResult.error) {
      console.warn('[laborPlanning] Failed to load labor assignments', fallbackResult.error);
      return [];
    }
    data = fallbackResult.data;
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

function normalizeOrderRow(
  row: any,
  jobCardItemsByOrder?: Map<number, JobCardItemRow[]>,
): PlanningOrderWithMeta | null {
  if (!row) return null;

  const orderId = Number(row.order_id);
  const statusRow = extractSingle(row.order_statuses);
  const customer = extractSingle(row.customers);
  const details = Array.isArray(row.order_details) ? row.order_details : [];
  const bolJobs = details.flatMap((detail: any) => normalizeDetailJobs(row, detail));

  // Merge in job_card_items that were manually added (not from BOL)
  const cardItems = jobCardItemsByOrder?.get(orderId) ?? [];
  const manualJobs = cardItems
    .filter((item) => {
      // Skip items that duplicate a BOL job (same job_id + product_id)
      return !bolJobs.some(
        (bj) => bj.jobId === item.job_id && bj.productId === item.product_id,
      );
    })
    .map((item) => normalizeJobCardItem(orderId, item));

  const jobs = [...bolJobs, ...manualJobs];

  return {
    id: row.order_number ? String(row.order_number) : `SO-${orderId}`,
    orderId,
    orderNumber: row.order_number ?? `SO-${orderId}`,
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
    // durationMinutes stores per-unit value for calculateDurationMinutes (which multiplies by quantity)
    const perUnitMinutes = baseMinutes;

    const categoryName = category?.name ?? null;
    const categoryColor = getCategoryColor(category?.category_id ?? categoryName);
    const payType = String(bol.pay_type ?? 'hourly').toLowerCase() as PayType;

    return {
      id: buildJobId(order.order_id, detail.order_detail_id, bol.bol_id, bol.job_id),
      name: job?.name ?? `Job ${bol.job_id ?? ''}`.trim(),
      status: 'ready',
      durationHours: totalMinutes != null ? Number((totalMinutes / 60).toFixed(2)) : 0,
      durationMinutes: perUnitMinutes,
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

  // Parse job_status as a valid JobStatus or null
  const rawJobStatus = row?.job_status;
  const validJobStatuses = ['scheduled', 'issued', 'in_progress', 'completed', 'on_hold'];
  const jobStatus = rawJobStatus && validJobStatuses.includes(rawJobStatus) ? rawJobStatus : null;

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
    jobStatus,
    issuedAt: row?.issued_at ?? null,
    startedAt: row?.started_at ?? null,
    completedAt: row?.completed_at ?? null,
  };
}

interface JobCardItemRow {
  item_id: number;
  job_card_id: number;
  product_id: number | null;
  job_id: number | null;
  quantity: number;
  piece_rate: number | null;
  status: string;
  order_id: number;
  job_name: string | null;
  job_category_id: number | null;
  job_category_name: string | null;
  product_name: string | null;
  estimated_minutes: number | null;
  job_time_unit: string | null;
}

async function loadJobCardItemsByOrder(): Promise<Map<number, JobCardItemRow[]>> {
  // Step 1: Get all non-cancelled job cards linked to orders
  const { data: cards, error: cardsErr } = await supabase
    .from('job_cards')
    .select('job_card_id, order_id, status')
    .not('order_id', 'is', null)
    .neq('status', 'cancelled');

  if (cardsErr) {
    console.warn('[laborPlanning] Failed to load job cards for planning', cardsErr);
    return new Map();
  }

  if (!cards || cards.length === 0) return new Map();

  const cardIds = cards.map((c) => c.job_card_id);
  const cardOrderMap = new Map(cards.map((c) => [c.job_card_id, Number(c.order_id)]));

  // Step 2: Fetch non-completed items for those cards
  const { data, error } = await supabase
    .from('job_card_items')
    .select(`
      item_id,
      job_card_id,
      product_id,
      job_id,
      quantity,
      piece_rate,
      status,
      jobs:job_id(job_id, name, estimated_minutes, time_unit, job_categories:category_id(category_id, name)),
      products:product_id(product_id, name)
    `)
    .in('job_card_id', cardIds)
    .neq('status', 'completed');

  if (error) {
    console.warn('[laborPlanning] Failed to load job card items', error);
    return new Map();
  }

  const result = new Map<number, JobCardItemRow[]>();

  for (const row of data || []) {
    const orderId = cardOrderMap.get(row.job_card_id);
    if (!orderId) continue;

    const job = extractSingle(row.jobs as any);
    const product = extractSingle(row.products as any);
    const category = extractSingle(job?.job_categories);

    const item: JobCardItemRow = {
      item_id: row.item_id,
      job_card_id: row.job_card_id,
      product_id: row.product_id,
      job_id: row.job_id,
      quantity: row.quantity,
      piece_rate: row.piece_rate ? Number(row.piece_rate) : null,
      status: row.status,
      order_id: orderId,
      job_name: job?.name ?? null,
      job_category_id: category?.category_id ?? null,
      job_category_name: category?.name ?? null,
      product_name: product?.name ?? null,
      estimated_minutes: job?.estimated_minutes ? Number(job.estimated_minutes) : null,
      job_time_unit: job?.time_unit ?? null,
    };

    if (!result.has(orderId)) result.set(orderId, []);
    result.get(orderId)!.push(item);
  }

  return result;
}

function normalizeJobCardItem(orderId: number, item: JobCardItemRow): PlanningJobWithMeta {
  const categoryName = item.job_category_name ?? null;
  const categoryColor = getCategoryColor(item.job_category_id ?? categoryName);

  // Estimate duration from job's estimated_minutes if available
  const estimatedMinutesPerUnit = item.estimated_minutes ?? null;
  const totalMinutes = estimatedMinutesPerUnit != null ? estimatedMinutesPerUnit * item.quantity : null;
  // durationMinutes stores per-unit value for calculateDurationMinutes (which multiplies by quantity)
  const perUnitMinutes = estimatedMinutesPerUnit;

  const payType: PayType = item.piece_rate != null ? 'piece' : 'hourly';

  return {
    id: `order-${orderId}:jci-${item.item_id}`,
    name: item.job_name ?? `Job Card Item ${item.item_id}`,
    status: 'ready',
    durationHours: totalMinutes != null ? Number((totalMinutes / 60).toFixed(2)) : 0,
    durationMinutes: perUnitMinutes,
    owner: categoryName ?? item.product_name ?? 'Unassigned',
    start: undefined,
    end: undefined,
    orderId,
    orderDetailId: null,
    productId: item.product_id ? Number(item.product_id) : null,
    productName: item.product_name,
    bolId: null,
    jobId: item.job_id,
    categoryName,
    categoryColor,
    payType,
    quantity: item.quantity,
    timeUnit: (item.job_time_unit as TimeUnit) ?? 'hours',
    rateId: null,
    hourlyRateId: null,
    pieceRateId: null,
    scheduleStatus: 'unscheduled',
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
