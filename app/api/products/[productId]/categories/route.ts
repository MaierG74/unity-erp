import { NextRequest, NextResponse } from 'next/server';

import { parsePositiveInt, productExistsInOrg, requireProductsAccess } from '@/lib/api/products-access';
import { supabaseAdmin } from '@/lib/supabase-admin';

type RouteParams = {
  productId?: string;
};

type CategoryPayload = {
  category_ids?: number[];
};

function normalizeCategoryIds(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const ids = new Set<number>();
  for (const value of input) {
    const parsed = parsePositiveInt(value as number | string | null | undefined);
    if (parsed) ids.add(parsed);
  }
  return Array.from(ids);
}

export async function POST(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  const params = await context.params;
  const productId = parsePositiveInt(params.productId);
  if (!productId) {
    return NextResponse.json({ error: 'Invalid product ID' }, { status: 400 });
  }

  const payload = (await request.json().catch(() => null)) as CategoryPayload | null;
  const categoryIds = normalizeCategoryIds(payload?.category_ids);
  if (categoryIds.length === 0) {
    return NextResponse.json({ error: 'category_ids is required' }, { status: 400 });
  }

  try {
    const productExists = await productExistsInOrg(productId, auth.orgId);
    if (!productExists) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const assignments = categoryIds.map((categoryId) => ({
      product_id: productId,
      product_cat_id: categoryId,
    }));

    const { error } = await supabaseAdmin
      .from('product_category_assignments')
      .insert(assignments);

    if (error) {
      console.error('[product-categories] failed inserting assignments', error);
      return NextResponse.json({ error: 'Failed to add categories' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[product-categories] unexpected insert error', error);
    return NextResponse.json({ error: 'Unexpected error while adding categories' }, { status: 500 });
  }
}
