import { NextRequest, NextResponse } from 'next/server';

import { getActiveCategoryRates } from '@/lib/api/job-category-rate';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getRouteClient } from '@/lib/supabase-route';

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRouteClient(req);
    if ('error' in ctx) {
      return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
    }

    const { data, error } = await supabaseAdmin
      .from('job_categories')
      .select('category_id, name, description, parent_category_id')
      .order('name');

    if (error) throw error;

    const categories = data ?? [];
    const activeRates = await getActiveCategoryRates(categories.map((category) => Number(category.category_id)));

    return NextResponse.json({
      categories: categories.map((category) => {
        const activeRate = activeRates.get(Number(category.category_id));
        return {
          category_id: Number(category.category_id),
          name: category.name,
          description: category.description,
          parent_category_id:
            category.parent_category_id == null ? null : Number(category.parent_category_id),
          rate_id: activeRate?.rate_id ?? null,
          hourly_rate: activeRate?.hourly_rate ?? 0,
        };
      }),
    });
  } catch (error) {
    console.error('[job-categories] Failed to load categories:', error);
    return NextResponse.json({ error: 'Failed to load job categories' }, { status: 500 });
  }
}
