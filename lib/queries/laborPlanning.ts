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
  /** True if work pool queries failed — pool orders may show stale BOL data */
  workPoolError?: boolean;
  /** Order IDs where pool required_qty differs from current BOL demand */
  stalePoolOrderIds?: Set<number>;
}

const CLOSED_STATUS_NAMES = ['completed', 'cancelled', 'closed', 'delivered'];
interface OpenOrdersResult {
  orders: PlanningOrderWithMeta[];
  jobCardData: JobCardData;
  workPoolData: WorkPoolData;
  stalePoolOrderIds: Set<number>;
}

export async function fetchOpenOrdersWithLabor(): Promise<OpenOrdersResult> {
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

  // Load job card items and work pool in parallel
  const [jobCardData, workPoolData] = await Promise.all([
    loadJobCardItemsByOrder(),
    loadWorkPoolByOrder(),
  ]);

  const orders = rows
    .map((row: any) => normalizeOrderRow(row, jobCardData, workPoolData))
    .filter(Boolean) as PlanningOrderWithMeta[];

  // Compute stale pool detection using already-fetched order detail data
  const stalePoolOrderIds = computeStalePoolOrders(rows, workPoolData);

  return { orders, jobCardData, workPoolData, stalePoolOrderIds };
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
  const [openOrdersResult, staff, assignments] = await Promise.all([
    fetchOpenOrdersWithLabor(),
    fetchStaffRoster({ date: options.date }),
    fetchLaborAssignments({ date: options.date }),
  ]);
  const { orders, jobCardData, workPoolData, stalePoolOrderIds } = openOrdersResult;

  const assignmentsByJob = new Map(assignments.map((assignment) => [assignment.jobKey, assignment]));
  const annotatedOrders: PlanningOrderWithMeta[] = orders.map((order) => ({
    ...order,
    jobs: order.jobs.map((job) => {
      const scheduled = assignmentsByJob.get(job.id);
      return {
        ...job,
        scheduleStatus: scheduled && scheduled.status !== 'unscheduled' ? 'scheduled' : 'unscheduled',
        jobStatus: scheduled?.jobStatus ?? null,
        status: job.status ?? 'ready',
      };
    }),
  }));

  // Enrich assignments whose jobs aren't in the open-orders list (e.g. completed/closed orders)
  // But exclude orphans for orders where all job cards are cancelled — those jobs were intentionally removed
  const orderJobKeys = new Set(annotatedOrders.flatMap((o) => o.jobs.map((j) => j.id)));
  const orphanedAssignments = assignments.filter((a) => {
    if (orderJobKeys.has(a.jobKey)) return false; // not orphaned
    // If this order has a work pool, pool-based filtering already handled visibility — skip orphans
    if (a.orderId && workPoolData.ordersWithPool.has(a.orderId)) return false;
    // If this order has job cards but no active items, all cards are cancelled/completed — skip
    if (a.orderId && jobCardData.ordersWithCards.has(a.orderId) && !(jobCardData.itemsByOrder.get(a.orderId)?.length)) {
      return false;
    }
    return true;
  });
  if (orphanedAssignments.length > 0) {
    const orphanOrderIds = [...new Set(orphanedAssignments.map((a) => a.orderId).filter(Boolean))] as number[];
    const orphanJobIds = [...new Set(orphanedAssignments.map((a) => a.jobId).filter(Boolean))] as number[];
    const orphanDetailIds = [...new Set(orphanedAssignments.map((a) => a.orderDetailId).filter(Boolean))] as number[];

    const [orderRows, jobRows, detailRows] = await Promise.all([
      orphanOrderIds.length > 0
        ? supabase.from('orders').select('order_id, order_number, customers(name)').in('order_id', orphanOrderIds).then((r) => r.data ?? [])
        : Promise.resolve([] as any[]),
      orphanJobIds.length > 0
        ? supabase.from('jobs').select('job_id, name, job_categories(name)').in('job_id', orphanJobIds).then((r) => r.data ?? [])
        : Promise.resolve([] as any[]),
      orphanDetailIds.length > 0
        ? supabase.from('order_details').select('order_detail_id, quantity, product_id, products(name)').in('order_detail_id', orphanDetailIds).then((r) => r.data ?? [])
        : Promise.resolve([] as any[]),
    ]);

    const orderMap = new Map<number, any>(orderRows.map((o: any) => [o.order_id, o]));
    const jobMap = new Map<number, any>(jobRows.map((j: any) => [j.job_id, j]));
    const detailMap = new Map<number, any>(detailRows.map((d: any) => [d.order_detail_id, d]));

    // Synthesize PlanningOrder entries for orphaned assignments so buildStaffLanes can find them
    const orphanOrderGroups = new Map<number, typeof orphanedAssignments>();
    for (const a of orphanedAssignments) {
      if (!a.orderId) continue;
      const group = orphanOrderGroups.get(a.orderId) ?? [];
      group.push(a);
      orphanOrderGroups.set(a.orderId, group);
    }

    // Build a lookup from orderId → existing annotated order so orphans can merge
    const existingOrderByOrderId = new Map<number, PlanningOrderWithMeta>();
    for (const ao of annotatedOrders) {
      if (ao.orderId != null) existingOrderByOrderId.set(ao.orderId, ao);
    }

    for (const [orderId, groupAssignments] of orphanOrderGroups) {
      const orderRow = orderMap.get(orderId);
      const syntheticJobs: PlanningJobWithMeta[] = groupAssignments.map((a) => {
        const jobRow = a.jobId ? jobMap.get(a.jobId) : null;
        const detailRow = a.orderDetailId ? detailMap.get(a.orderDetailId) : null;
        const categoryName = jobRow?.job_categories?.name ?? null;
        return {
          id: a.jobKey,
          name: jobRow?.name ?? 'Job',
          status: 'ready' as const,
          durationHours: 0,
          orderId,
          orderDetailId: a.orderDetailId,
          productId: detailRow?.product_id ?? null,
          productName: detailRow?.products?.name ?? null,
          bolId: a.bolId,
          jobId: a.jobId,
          categoryName,
          categoryColor: getCategoryColor(categoryName),
          payType: a.payType,
          quantity: detailRow?.quantity ?? 0,
          durationMinutes: null,
          timeUnit: 'hours' as const,
          rateId: a.rateId,
          hourlyRateId: a.hourlyRateId,
          pieceRateId: a.pieceRateId,
          scheduleStatus: 'scheduled' as const,
          jobStatus: a.jobStatus ?? null,
        };
      });

      // If the order already exists in annotatedOrders, merge orphan jobs into it
      const existingOrder = existingOrderByOrderId.get(orderId);
      if (existingOrder) {
        const existingJobIds = new Set(existingOrder.jobs.map((j) => j.id));
        for (const sj of syntheticJobs) {
          if (!existingJobIds.has(sj.id)) {
            existingOrder.jobs.push(sj);
          }
        }
      } else {
        annotatedOrders.push({
          id: `order-${orderId}`,
          customer: (orderRow?.customers as any)?.name ?? 'Unknown',
          priority: 'medium',
          dueDate: null,
          orderId,
          orderNumber: orderRow?.order_number ?? String(orderId),
          statusName: null,
          jobs: syntheticJobs,
        });
      }
    }
  }

  const unscheduledJobs: PlanningJobWithMeta[] = annotatedOrders
    .flatMap((order) => order.jobs.filter((job) => job.scheduleStatus !== 'scheduled'))
    .map((job) => ({
      ...job,
      scheduleStatus: 'unscheduled' as const,
    }));

  return {
    orders: annotatedOrders,
    staff,
    unscheduledJobs,
    assignments,
    workPoolError: workPoolData.hasError,
    stalePoolOrderIds,
  };
}

/* ------------------------------------------------------------------ */
/*  Cross-date duplicate check                                         */
/* ------------------------------------------------------------------ */

/**
 * Find the date a job is currently scheduled on.
 * Optionally exclude a specific date (for the duplicate-drop guard).
 * Returns the date string if found, or null if unscheduled.
 */
export async function findScheduledDate(
  jobInstanceId: string,
  excludeDate?: string,
): Promise<string | null> {
  let query = supabase
    .from('labor_plan_assignments')
    .select('assignment_date')
    .eq('job_instance_id', jobInstanceId)
    .eq('status', 'scheduled')
    .limit(1);

  if (excludeDate) {
    query = query.neq('assignment_date', excludeDate);
  }

  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  return data.assignment_date;
}

/* ------------------------------------------------------------------ */
/*  Week summary (lightweight, for the condensed week strip)           */
/* ------------------------------------------------------------------ */

export interface DaySummary {
  date: string;
  totalAssignedMinutes: number;
  assignmentCount: number;
  staffCount: number;
}

export async function fetchWeekSummary(dates: string[]): Promise<DaySummary[]> {
  const { data, error } = await supabase
    .from('labor_plan_assignments')
    .select('assignment_date, start_minutes, end_minutes, staff_id, status')
    .in('assignment_date', dates)
    .neq('status', 'unscheduled');

  if (error) {
    console.warn('[laborPlanning] Failed to fetch week summary', error);
    return dates.map((d) => ({ date: d, totalAssignedMinutes: 0, assignmentCount: 0, staffCount: 0 }));
  }

  const byDate = new Map<string, { minutes: number; count: number; staffIds: Set<number> }>();
  for (const d of dates) {
    byDate.set(d, { minutes: 0, count: 0, staffIds: new Set() });
  }
  for (const row of data ?? []) {
    const bucket = byDate.get(row.assignment_date);
    if (!bucket) continue;
    bucket.minutes += Math.max((row.end_minutes ?? 0) - (row.start_minutes ?? 0), 0);
    bucket.count += 1;
    if (row.staff_id) bucket.staffIds.add(row.staff_id);
  }

  return dates.map((d) => {
    const b = byDate.get(d)!;
    return { date: d, totalAssignedMinutes: b.minutes, assignmentCount: b.count, staffCount: b.staffIds.size };
  });
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
  jobCardData?: JobCardData,
  workPoolData?: WorkPoolData,
): PlanningOrderWithMeta | null {
  if (!row) return null;

  const orderId = Number(row.order_id);
  const statusRow = extractSingle(row.order_statuses);
  const customer = extractSingle(row.customers);

  // Check if this order has work pool rows (new model)
  const poolRows = workPoolData?.poolByOrder.get(orderId) ?? [];
  const hasPool = poolRows.length > 0;

  let jobs: PlanningJobWithMeta[];

  if (hasPool) {
    // New model: pool demand (remaining > 0) + issued-but-active card items
    const poolDemandJobs = poolRows
      .filter((p) => p.remaining_qty > 0)
      .map((p) => normalizePoolRow(orderId, p));

    // Include issued card items linked to pool rows so they can be scheduled
    const cardItems = jobCardData?.itemsByOrder.get(orderId) ?? [];
    const issuedPoolJobs = cardItems
      .filter((ci) => ci.work_pool_id != null)
      .map((ci) => normalizeIssuedPoolCardItem(orderId, ci));

    jobs = [...poolDemandJobs, ...issuedPoolJobs];
  } else {
    // Legacy fallback: no pool, use raw BOL + job card items
    const details = Array.isArray(row.order_details) ? row.order_details : [];
    const allBolJobs = details.flatMap((detail: any) => normalizeDetailJobs(row, detail));

    // Active (non-cancelled, non-completed) job card items for this order
    const cardItems = jobCardData?.itemsByOrder.get(orderId) ?? [];
    const hasAnyCards = jobCardData?.ordersWithCards.has(orderId) ?? false;

    // If job cards have ever been generated for this order, only show BOL jobs that have
    // an active card item — cancelled/completed cards should remove jobs from the scheduler.
    // If no cards exist yet, show all BOL jobs so they can be scheduled pre-generation.
    const bolJobs = hasAnyCards
      ? allBolJobs.filter((bj) =>
          cardItems.some((ci) => ci.job_id === bj.jobId && ci.product_id === bj.productId),
        )
      : allBolJobs;

    // Merge in job_card_items that were manually added (not from BOL)
    const manualJobs = cardItems
      .filter((item) => {
        // Skip items that duplicate a BOL job (same job_id + product_id)
        return !allBolJobs.some(
          (bj) => bj.jobId === item.job_id && bj.productId === item.product_id,
        );
      })
      .map((item) => normalizeJobCardItem(orderId, item));

    jobs = [...bolJobs, ...manualJobs];
  }

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
    // Fall back to job's estimated_minutes/time_unit when the BOL doesn't have time_required set
    const effectiveTimeRequired = bol.time_required ?? job?.estimated_minutes ?? null;
    const effectiveTimeUnit = (bol.time_required != null ? bol.time_unit : job?.time_unit) ?? 'hours';
    const timeUnit = String(effectiveTimeUnit).toLowerCase() as TimeUnit;
    const baseMinutes = convertToMinutes(effectiveTimeRequired, timeUnit);
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

/* ------------------------------------------------------------------ */
/*  Work Pool demand source                                            */
/* ------------------------------------------------------------------ */

interface SchedulerPoolRow {
  pool_id: number;
  order_id: number;
  product_id: number | null;
  job_id: number | null;
  bol_id: number | null;
  order_detail_id: number | null;
  required_qty: number;
  issued_qty: number;
  remaining_qty: number;
  pay_type: string;
  piece_rate: number | null;
  piece_rate_id: number | null;
  hourly_rate_id: number | null;
  time_per_unit: number | null;
  source: string;
  job_name: string | null;
  product_name: string | null;
  category_id: number | null;
  category_name: string | null;
}

interface WorkPoolData {
  poolByOrder: Map<number, SchedulerPoolRow[]>;
  /** Order IDs that have at least one active pool row */
  ordersWithPool: Set<number>;
  /** True if the pool query failed — prevents silent BOL fallback */
  hasError?: boolean;
}

async function loadWorkPoolByOrder(): Promise<WorkPoolData> {
  // Query base table (not view) because PostgREST FK joins on views are unreliable
  const { data: poolRows, error: poolErr } = await supabase
    .from('job_work_pool')
    .select(`
      pool_id, order_id, product_id, job_id, bol_id, order_detail_id,
      required_qty, pay_type, piece_rate, piece_rate_id, hourly_rate_id,
      time_per_unit, source, status,
      jobs:job_id(job_id, name, estimated_minutes, time_unit, job_categories:category_id(category_id, name)),
      products:product_id(product_id, name)
    `)
    .eq('status', 'active');

  if (poolErr) {
    console.error('[laborPlanning] Failed to load work pool', poolErr);
    return { poolByOrder: new Map(), ordersWithPool: new Set(), hasError: true };
  }

  const rows = poolRows ?? [];
  if (rows.length === 0) return { poolByOrder: new Map(), ordersWithPool: new Set() };

  // Compute issuance from job_card_items (same pattern as JobCardsTab)
  const poolIds = rows.map((r: any) => r.pool_id);
  const { data: issuanceData, error: issuanceErr } = await supabase
    .from('job_card_items')
    .select('work_pool_id, quantity, status, job_cards!inner(status)')
    .in('work_pool_id', poolIds);

  if (issuanceErr) {
    console.error('[laborPlanning] Failed to load pool issuance data', issuanceErr);
    return { poolByOrder: new Map(), ordersWithPool: new Set(), hasError: true };
  }

  // Aggregate issued qty per pool_id (exclude cancelled cards/items)
  const issuedByPool = new Map<number, number>();
  for (const item of issuanceData ?? []) {
    const cardStatus = (item as any).job_cards?.status;
    if (cardStatus === 'cancelled' || item.status === 'cancelled') continue;
    const poolId = item.work_pool_id as number;
    issuedByPool.set(poolId, (issuedByPool.get(poolId) ?? 0) + (item.quantity ?? 0));
  }

  const poolByOrder = new Map<number, SchedulerPoolRow[]>();
  const ordersWithPool = new Set<number>();

  for (const row of rows as any[]) {
    const job = extractSingle(row.jobs);
    const product = extractSingle(row.products);
    const category = extractSingle(job?.job_categories);
    const issuedQty = issuedByPool.get(row.pool_id) ?? 0;

    const mapped: SchedulerPoolRow = {
      pool_id: row.pool_id,
      order_id: row.order_id,
      product_id: row.product_id,
      job_id: row.job_id,
      bol_id: row.bol_id,
      order_detail_id: row.order_detail_id,
      required_qty: row.required_qty,
      issued_qty: issuedQty,
      remaining_qty: row.required_qty - issuedQty,
      pay_type: row.pay_type,
      piece_rate: row.piece_rate ? Number(row.piece_rate) : null,
      piece_rate_id: row.piece_rate_id,
      hourly_rate_id: row.hourly_rate_id,
      time_per_unit: row.time_per_unit ? Number(row.time_per_unit) : null,
      source: row.source,
      job_name: job?.name ?? null,
      product_name: product?.name ?? null,
      category_id: category?.category_id ?? null,
      category_name: category?.name ?? null,
    };

    ordersWithPool.add(row.order_id);
    if (!poolByOrder.has(row.order_id)) poolByOrder.set(row.order_id, []);
    poolByOrder.get(row.order_id)!.push(mapped);
  }

  return { poolByOrder, ordersWithPool };
}

/**
 * Compare pool required_qty against current BOL-derived demand using
 * already-fetched order data (no extra queries).
 */
function computeStalePoolOrders(orderRows: any[], workPoolData: WorkPoolData): Set<number> {
  const stale = new Set<number>();
  if (workPoolData.hasError) return stale;

  for (const [orderId, poolRows] of workPoolData.poolByOrder) {
    // Only check BOL-sourced rows
    const bolPoolRows = poolRows.filter((p) => p.source === 'bol' && p.bol_id != null);
    if (bolPoolRows.length === 0) continue;

    // Find the matching order row to get current BOL quantities
    const orderRow = orderRows.find((r: any) => r.order_id === orderId);
    if (!orderRow) continue;

    // Build bol_id → current total qty from order data
    const currentQtyByBol = new Map<number, number>();
    const details = Array.isArray(orderRow.order_details) ? orderRow.order_details : [];
    for (const detail of details) {
      const product = detail.products as any;
      const bols = Array.isArray(product?.billoflabour) ? product.billoflabour : [];
      for (const bol of bols) {
        currentQtyByBol.set(bol.bol_id, (detail.quantity || 1) * (bol.quantity || 1));
      }
    }

    for (const poolRow of bolPoolRows) {
      const currentReq = currentQtyByBol.get(poolRow.bol_id!) ?? 0;
      if (currentReq !== poolRow.required_qty) {
        stale.add(orderId);
        break;
      }
    }
  }

  return stale;
}

function normalizePoolRow(orderId: number, pool: SchedulerPoolRow): PlanningJobWithMeta {
  const categoryName = pool.category_name ?? null;
  const categoryColor = getCategoryColor(pool.category_id ?? categoryName);
  const payType = (pool.pay_type ?? 'hourly').toLowerCase() as PayType;

  // time_per_unit is stored in minutes
  const perUnitMinutes = pool.time_per_unit != null ? Number(pool.time_per_unit) : null;
  const totalMinutes = perUnitMinutes != null ? perUnitMinutes * pool.remaining_qty : null;

  // Use pool_id-based key so scheduler can distinguish pool demand from issued cards
  const jobKey = pool.bol_id != null
    ? buildJobId(orderId, pool.order_detail_id, pool.bol_id, pool.job_id)
    : `order-${orderId}:pool-${pool.pool_id}`;

  return {
    id: jobKey,
    name: pool.job_name ?? `Pool #${pool.pool_id}`,
    status: 'ready',
    durationHours: totalMinutes != null ? Number((totalMinutes / 60).toFixed(2)) : 0,
    durationMinutes: perUnitMinutes,
    owner: categoryName ?? pool.product_name ?? 'Unassigned',
    start: undefined,
    end: undefined,
    orderId,
    orderDetailId: pool.order_detail_id,
    productId: pool.product_id ? Number(pool.product_id) : null,
    productName: pool.product_name,
    bolId: pool.bol_id,
    jobId: pool.job_id,
    categoryName,
    categoryColor,
    payType,
    quantity: pool.remaining_qty,
    timeUnit: 'minutes' as TimeUnit,
    rateId: null,
    hourlyRateId: pool.hourly_rate_id,
    pieceRateId: pool.piece_rate_id,
    scheduleStatus: 'unscheduled',
    poolId: pool.pool_id,
    remainingQty: pool.remaining_qty,
    timePerUnit: perUnitMinutes,
  };
}

/* ------------------------------------------------------------------ */
/*  Job card items for scheduler                                       */
/* ------------------------------------------------------------------ */

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
  work_pool_id: number | null;
}

interface JobCardData {
  itemsByOrder: Map<number, JobCardItemRow[]>;
  /** Order IDs that have at least one job card (any status, including cancelled) */
  ordersWithCards: Set<number>;
}

async function loadJobCardItemsByOrder(): Promise<JobCardData> {
  // Step 1: Get ALL job cards linked to orders (any status) to know which orders have cards
  const { data: allCards, error: allCardsErr } = await supabase
    .from('job_cards')
    .select('job_card_id, order_id, status')
    .not('order_id', 'is', null);

  if (allCardsErr) {
    console.warn('[laborPlanning] Failed to load job cards for planning', allCardsErr);
    return { itemsByOrder: new Map(), ordersWithCards: new Set() };
  }

  const ordersWithCards = new Set<number>((allCards ?? []).map((c) => Number(c.order_id)));

  // Step 2: Filter to non-cancelled cards for fetching active items
  const cards = (allCards ?? []).filter((c) => c.status !== 'cancelled');

  if (cards.length === 0) return { itemsByOrder: new Map(), ordersWithCards };

  const cardIds = cards.map((c) => c.job_card_id);
  const cardOrderMap = new Map(cards.map((c) => [c.job_card_id, Number(c.order_id)]));

  // Step 3: Fetch active items for non-cancelled cards
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
      work_pool_id,
      jobs:job_id(job_id, name, estimated_minutes, time_unit, job_categories:category_id(category_id, name)),
      products:product_id(product_id, name)
    `)
    .in('job_card_id', cardIds)
    .not('status', 'in', '("completed","cancelled")');

  if (error) {
    console.warn('[laborPlanning] Failed to load job card items', error);
    return { itemsByOrder: new Map(), ordersWithCards };
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
      work_pool_id: (row as any).work_pool_id ?? null,
    };

    if (!result.has(orderId)) result.set(orderId, []);
    result.get(orderId)!.push(item);
  }

  return { itemsByOrder: result, ordersWithCards };
}

/** Converts an issued pool-linked card item into a PlanningJobWithMeta.
 *  Uses `pool-X:card-Y` key format matching what IssueAndScheduleDialog creates. */
function normalizeIssuedPoolCardItem(orderId: number, item: JobCardItemRow): PlanningJobWithMeta {
  const categoryName = item.job_category_name ?? null;
  const categoryColor = getCategoryColor(item.job_category_id ?? categoryName);
  const rawEstimatedTime = item.estimated_minutes ?? null;
  const estimatedMinutesPerUnit = rawEstimatedTime != null
    ? convertToMinutes(rawEstimatedTime, item.job_time_unit)
    : null;
  const totalMinutes = estimatedMinutesPerUnit != null ? estimatedMinutesPerUnit * item.quantity : null;
  const payType: PayType = item.piece_rate != null ? 'piece' : 'hourly';

  return {
    id: `pool-${item.work_pool_id}:card-${item.job_card_id}`,
    name: item.job_name ?? `Job Card Item ${item.item_id}`,
    status: 'ready',
    durationHours: totalMinutes != null ? Number((totalMinutes / 60).toFixed(2)) : 0,
    durationMinutes: estimatedMinutesPerUnit,
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

function normalizeJobCardItem(orderId: number, item: JobCardItemRow): PlanningJobWithMeta {
  const categoryName = item.job_category_name ?? null;
  const categoryColor = getCategoryColor(item.job_category_id ?? categoryName);

  // Estimate duration from job's estimated_minutes, converting from job_time_unit to minutes
  const rawEstimatedTime = item.estimated_minutes ?? null;
  const estimatedMinutesPerUnit = rawEstimatedTime != null
    ? convertToMinutes(rawEstimatedTime, item.job_time_unit)
    : null;
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
