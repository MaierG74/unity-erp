import { supabaseAdmin } from '@/lib/supabase-admin';

export type ActiveCategoryRate = {
  rate_id: number;
  hourly_rate: number;
};

function defaultToday(): string {
  return new Date().toISOString().split('T')[0];
}

export async function getActiveCategoryRate(
  categoryId: number,
  today: string = defaultToday(),
): Promise<ActiveCategoryRate | null> {
  const { data, error } = await supabaseAdmin
    .from('job_category_rates')
    .select('rate_id, hourly_rate')
    .eq('category_id', categoryId)
    .lte('effective_date', today)
    .or(`end_date.is.null,end_date.gte.${today}`)
    .order('effective_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? { rate_id: Number(data.rate_id), hourly_rate: Number(data.hourly_rate) } : null;
}

export async function getActiveCategoryRates(
  categoryIds: number[],
  today: string = defaultToday(),
): Promise<Map<number, ActiveCategoryRate>> {
  const uniqueIds = Array.from(
    new Set(categoryIds.filter((id) => Number.isInteger(id) && id > 0)),
  );

  const activeRates = new Map<number, ActiveCategoryRate>();
  if (uniqueIds.length === 0) return activeRates;

  const { data, error } = await supabaseAdmin
    .from('job_category_rates')
    .select('rate_id, category_id, hourly_rate, effective_date')
    .in('category_id', uniqueIds)
    .lte('effective_date', today)
    .or(`end_date.is.null,end_date.gte.${today}`)
    .order('category_id', { ascending: true })
    .order('effective_date', { ascending: false });

  if (error) throw error;

  for (const row of data ?? []) {
    const categoryId = Number(row.category_id);
    if (!activeRates.has(categoryId)) {
      activeRates.set(categoryId, {
        rate_id: Number(row.rate_id),
        hourly_rate: Number(row.hourly_rate),
      });
    }
  }

  return activeRates;
}
