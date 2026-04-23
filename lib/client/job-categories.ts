import { authorizedFetch } from '@/lib/client/auth-fetch';

export type JobCategoryWithRate = {
  category_id: number;
  name: string;
  description: string | null;
  parent_category_id: number | null;
  rate_id: number | null;
  hourly_rate: number;
};

export async function fetchJobCategories(): Promise<JobCategoryWithRate[]> {
  const response = await authorizedFetch('/api/job-categories');
  const json = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(json?.error || 'Failed to load job categories');
  }

  if (!Array.isArray(json?.categories)) return [];

  return json.categories.map((category: any) => ({
    category_id: Number(category.category_id),
    name: String(category.name ?? ''),
    description: category.description ?? null,
    parent_category_id:
      category.parent_category_id == null ? null : Number(category.parent_category_id),
    rate_id: category.rate_id == null ? null : Number(category.rate_id),
    hourly_rate: Number(category.hourly_rate ?? 0),
  }));
}
