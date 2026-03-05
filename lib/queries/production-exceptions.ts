import { supabase } from '@/lib/supabase';

export interface ExceptionJob {
  assignment_id: number;
  job_name: string;
  staff_name: string;
  order_number: string | null;
  section_name: string | null;
  job_status: string;
  auto_progress: number;
  progress_override: number | null;
  minutes_elapsed: number;
  estimated_minutes: number;
  started_at: string | null;
  assignment_date: string | null;
}

export interface PoolException {
  exception_id: number;
  order_id: number;
  work_pool_id: number;
  exception_type: 'over_issued_override' | 'over_issued_after_reconcile';
  status: 'open' | 'acknowledged' | 'resolved';
  required_qty_snapshot: number;
  issued_qty_snapshot: number;
  variance_qty: number;
  trigger_source: string;
  triggered_at: string;
  acknowledged_at: string | null;
  resolution_type: string | null;
  resolution_notes: string | null;
  resolved_at: string | null;
  // Joined fields
  order_number: string | null;
  job_name: string | null;
  product_name: string | null;
}

export interface ProductionExceptions {
  overdue: ExceptionJob[];
  paused: ExceptionJob[];
  behind: ExceptionJob[];
  poolExceptions: PoolException[];
}

export async function fetchProductionExceptions(): Promise<ProductionExceptions> {
  // Run floor query, paused-assignments query, and pool exceptions query in parallel
  const [floorResult, pausedRaw, poolExResult] = await Promise.all([
    supabase.from('factory_floor_status').select(
      'assignment_id, job_name, staff_name, order_number, section_name, job_status, auto_progress, progress_override, minutes_elapsed, estimated_minutes, started_at, assignment_date',
    ),
    supabase
      .from('labor_plan_assignments')
      .select('assignment_id, job_id, staff_id, order_id, job_status, assignment_date, started_at')
      .eq('job_status', 'on_hold'),
    supabase
      .from('job_work_pool_exceptions')
      .select(`
        exception_id, order_id, work_pool_id, exception_type, status,
        required_qty_snapshot, issued_qty_snapshot, variance_qty,
        trigger_source, triggered_at, acknowledged_at,
        resolution_type, resolution_notes, resolved_at,
        orders:order_id(order_number),
        job_work_pool:work_pool_id(
          jobs:job_id(name),
          products:product_id(name)
        )
      `)
      .in('status', ['open', 'acknowledged'])
      .order('triggered_at', { ascending: false }),
  ]);

  if (floorResult.error) throw floorResult.error;
  if (pausedRaw.error) throw pausedRaw.error;
  // Pool exceptions are non-critical — log but don't throw
  if (poolExResult.error) {
    console.error('[production-exceptions] Failed to load pool exceptions', poolExResult.error);
  }

  const floorJobs: ExceptionJob[] = floorResult.data ?? [];

  // Resolve names for paused jobs via parallel lookups (no FK constraints on this table)
  const pausedData = pausedRaw.data ?? [];
  let paused: ExceptionJob[] = [];

  if (pausedData.length > 0) {
    const jobIds = [...new Set(pausedData.map((r) => r.job_id).filter(Boolean))];
    const staffIds = [...new Set(pausedData.map((r) => r.staff_id).filter(Boolean))];
    const orderIds = [...new Set(pausedData.map((r) => r.order_id).filter(Boolean))];

    const [jobsRes, staffRes, ordersRes] = await Promise.all([
      jobIds.length > 0
        ? supabase.from('jobs').select('job_id, name').in('job_id', jobIds as number[])
        : Promise.resolve({ data: [] as { job_id: number; name: string }[] }),
      staffIds.length > 0
        ? supabase.from('staff').select('staff_id, first_name, last_name').in('staff_id', staffIds as number[])
        : Promise.resolve({ data: [] as { staff_id: number; first_name: string; last_name: string }[] }),
      orderIds.length > 0
        ? supabase.from('orders').select('order_id, order_number').in('order_id', orderIds as number[])
        : Promise.resolve({ data: [] as { order_id: number; order_number: string }[] }),
    ]);

    const jobMap = new Map((jobsRes.data ?? []).map((j) => [j.job_id, j.name]));
    const staffMap = new Map(
      (staffRes.data ?? []).map((s) => [s.staff_id, `${s.first_name} ${s.last_name}`]),
    );
    const orderMap = new Map((ordersRes.data ?? []).map((o) => [o.order_id, o.order_number]));

    paused = pausedData.map((row) => ({
      assignment_id: row.assignment_id,
      job_name: jobMap.get(row.job_id!) ?? 'Unknown',
      staff_name: staffMap.get(row.staff_id!) ?? 'Unassigned',
      order_number: orderMap.get(row.order_id!) ?? null,
      section_name: null,
      job_status: row.job_status,
      auto_progress: 0,
      progress_override: null,
      minutes_elapsed: 0,
      estimated_minutes: 0,
      started_at: row.started_at,
      assignment_date: row.assignment_date,
    }));
  }

  // Overdue: auto_progress >= 100 means elapsed time exceeds estimate
  const overdue = floorJobs.filter((j) => j.auto_progress >= 100);

  // Behind schedule: past halfway on time but manual progress is notably lower
  const behind = floorJobs.filter((j) => {
    if (j.auto_progress >= 100) return false; // already in overdue
    const realProgress = j.progress_override ?? 0;
    return j.auto_progress > 50 && realProgress < j.auto_progress - 30;
  });

  // Map pool exceptions with joined names
  const poolExceptions: PoolException[] = (poolExResult.data ?? []).map((row: any) => {
    const order = row.orders as { order_number: string } | null;
    const pool = row.job_work_pool as { jobs: { name: string } | null; products: { name: string } | null } | null;
    return {
      exception_id: row.exception_id,
      order_id: row.order_id,
      work_pool_id: row.work_pool_id,
      exception_type: row.exception_type,
      status: row.status,
      required_qty_snapshot: row.required_qty_snapshot,
      issued_qty_snapshot: row.issued_qty_snapshot,
      variance_qty: row.variance_qty,
      trigger_source: row.trigger_source,
      triggered_at: row.triggered_at,
      acknowledged_at: row.acknowledged_at,
      resolution_type: row.resolution_type,
      resolution_notes: row.resolution_notes,
      resolved_at: row.resolved_at,
      order_number: order?.order_number ?? null,
      job_name: pool?.jobs?.name ?? null,
      product_name: pool?.products?.name ?? null,
    };
  });

  return { overdue, paused, behind, poolExceptions };
}
