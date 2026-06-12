import type { SupabaseClient } from '@supabase/supabase-js';

import { getActiveCategoryRate } from '@/lib/api/job-category-rate';

export type CostingBolRow = {
  bol_id?: number | null;
  product_id: number;
  job_id: number;
  time_required?: number | null;
  time_unit?: 'hours' | 'minutes' | 'seconds' | null;
  quantity?: number | null;
  pay_type?: 'hourly' | 'piece' | null;
  rate_id?: number | null;
  piece_rate_id?: number | null;
  hourly_rate_id?: number | null;
};

export type CostingJobMeta = {
  job_id: number;
  name: string | null;
  category_id: number | null;
  category_name: string | null;
};

export function costingNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function roundCostingQty(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function costingHours(value: number, unit: 'hours' | 'minutes' | 'seconds' | null | undefined): number {
  if (unit === 'minutes') return value / 60;
  if (unit === 'seconds') return value / 3600;
  return value;
}

export async function loadCostingJobMeta(
  supabase: SupabaseClient<any, any, any>,
  jobIds: number[]
): Promise<Map<number, CostingJobMeta>> {
  const uniqueIds = Array.from(new Set(jobIds.filter((id) => Number.isFinite(id) && id > 0)));
  const map = new Map<number, CostingJobMeta>();
  if (uniqueIds.length === 0) return map;

  const { data, error } = await supabase
    .from('jobs')
    .select('job_id, name, category_id, job_categories(name)')
    .in('job_id', uniqueIds);
  if (error) throw error;

  for (const row of (data ?? []) as any[]) {
    map.set(Number(row.job_id), {
      job_id: Number(row.job_id),
      name: row.name ?? null,
      category_id: costingNumber(row.category_id),
      category_name: row.job_categories?.name ?? null,
    });
  }
  return map;
}

export async function resolveCostingPieceRate(
  supabase: SupabaseClient<any, any, any>,
  args: {
    jobId: number;
    productId: number;
    pieceRateId?: number | null;
    today: string;
  }
): Promise<number | null> {
  if (args.pieceRateId) {
    const { data, error } = await supabase
      .from('piece_work_rates')
      .select('rate')
      .eq('rate_id', args.pieceRateId)
      .maybeSingle();
    if (error) throw error;
    if (data) return costingNumber((data as any).rate);
  }

  const { data, error } = await supabase
    .from('piece_work_rates')
    .select('rate, product_id, effective_date, end_date')
    .eq('job_id', args.jobId)
    .lte('effective_date', args.today)
    .or(`end_date.is.null,end_date.gte.${args.today}`)
    .order('effective_date', { ascending: false });
  if (error) throw error;

  const chosen = ((data ?? []) as any[]).find((row) => Number(row.product_id) === args.productId)
    ?? ((data ?? []) as any[]).find((row) => row.product_id == null)
    ?? null;
  return chosen ? costingNumber(chosen.rate) : null;
}

export async function resolveCostingHourlyRate(
  supabase: SupabaseClient<any, any, any>,
  row: Pick<CostingBolRow, 'hourly_rate_id' | 'rate_id'>,
  job: CostingJobMeta | undefined,
  today: string
): Promise<number | null> {
  if (row.hourly_rate_id) {
    const { data, error } = await supabase
      .from('job_hourly_rates')
      .select('hourly_rate')
      .eq('rate_id', row.hourly_rate_id)
      .maybeSingle();
    if (error) throw error;
    if (data) return costingNumber((data as any).hourly_rate);
  }

  if (row.rate_id) {
    const { data, error } = await supabase
      .from('job_category_rates')
      .select('hourly_rate')
      .eq('rate_id', row.rate_id)
      .maybeSingle();
    if (error) throw error;
    if (data) return costingNumber((data as any).hourly_rate);
  }

  if (job?.category_id) {
    const activeRate = await getActiveCategoryRate(job.category_id, today);
    return activeRate?.hourly_rate ?? null;
  }

  return null;
}

export async function loadChildLabourBasis(
  supabase: SupabaseClient<any, any, any>,
  childIds: number[],
  orgId: string
): Promise<Map<number, number>> {
  const uniqueIds = Array.from(new Set(childIds.filter((id) => Number.isFinite(id) && id > 0)));
  const byProduct = new Map<number, number>();
  for (const id of uniqueIds) byProduct.set(id, 0);
  if (uniqueIds.length === 0) return byProduct;

  const { data, error } = await supabase
    .from('billoflabour')
    .select('product_id, job_id, time_required, time_unit, quantity, pay_type, rate_id, piece_rate_id, hourly_rate_id')
    .in('product_id', uniqueIds)
    .eq('org_id', orgId);
  if (error) throw error;

  const rows = ((data ?? []) as any[]).map((raw) => ({
    product_id: Number(raw.product_id),
    job_id: Number(raw.job_id),
    time_required: raw.time_required == null ? null : costingNumber(raw.time_required),
    time_unit: raw.time_unit ?? 'hours',
    quantity: raw.quantity == null ? 1 : costingNumber(raw.quantity) ?? 1,
    pay_type: raw.pay_type === 'piece' ? 'piece' : 'hourly',
    rate_id: raw.rate_id == null ? null : Number(raw.rate_id),
    piece_rate_id: raw.piece_rate_id == null ? null : Number(raw.piece_rate_id),
    hourly_rate_id: raw.hourly_rate_id == null ? null : Number(raw.hourly_rate_id),
  })) as CostingBolRow[];

  const jobs = await loadCostingJobMeta(supabase, rows.map((row) => row.job_id));
  const today = new Date().toISOString().split('T')[0];

  for (const row of rows) {
    const quantity = costingNumber(row.quantity) ?? 1;
    const lineCost = row.pay_type === 'piece'
      ? roundCostingQty(quantity) * (costingNumber(await resolveCostingPieceRate(supabase, {
          jobId: row.job_id,
          productId: row.product_id,
          pieceRateId: row.piece_rate_id,
          today,
        })) ?? 0)
      : roundCostingQty(quantity * costingHours(costingNumber(row.time_required) ?? 0, row.time_unit)) *
        (costingNumber(await resolveCostingHourlyRate(supabase, row, jobs.get(row.job_id), today)) ?? 0);

    byProduct.set(row.product_id, (byProduct.get(row.product_id) ?? 0) + lineCost);
  }

  return byProduct;
}
