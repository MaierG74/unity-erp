import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireProductsAccess } from '@/lib/api/products-access';

type RouteParams = { categoryId: string };

export async function GET(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  const { categoryId: catParam } = await context.params;
  const url = new URL(request.url);
  const search = url.searchParams.get('search')?.trim() ?? '';
  const showAll = catParam === 'all';
  const categoryId = showAll ? null : Number(catParam);

  if (!showAll && (!Number.isFinite(categoryId) || categoryId! <= 0)) {
    return NextResponse.json({ error: 'Invalid category ID' }, { status: 400 });
  }

  try {
    let query = supabaseAdmin
      .from('components')
      .select(`
        component_id,
        internal_code,
        description,
        category_id,
        component_categories ( cat_id, categoryname ),
        suppliercomponents (
          supplier_component_id,
          price,
          suppliers ( supplier_id, name )
        )
      `)
      .eq('org_id', auth.orgId)
      .order('internal_code', { ascending: true })
      .limit(50);

    if (!showAll && categoryId) {
      query = query.eq('category_id', categoryId);
    }

    const { data, error } = await query;
    if (error) throw error;

    const searchLower = search.toLowerCase();

    const results = (data ?? []).map((c: any) => {
      const suppliers = c.suppliercomponents ?? [];
      const cheapest = suppliers.length > 0
        ? suppliers.reduce((min: any, s: any) => (s.price < min.price ? s : min), suppliers[0])
        : null;
      const allSupplierNames = suppliers
        .map((s: any) => s.suppliers?.name ?? '')
        .filter(Boolean)
        .join(', ');

      return {
        component_id: c.component_id,
        internal_code: c.internal_code,
        description: c.description,
        category_id: c.category_id,
        category_name: c.component_categories?.categoryname ?? null,
        cheapest_price: cheapest?.price ?? null,
        cheapest_supplier_component_id: cheapest?.supplier_component_id ?? null,
        cheapest_supplier_name: cheapest?.suppliers?.name ?? null,
        all_supplier_names: allSupplierNames,
      };
    }).filter((c: any) => {
      // Client-side filtering across code, description, AND supplier names
      if (searchLower.length < 2) return true;
      return (
        (c.internal_code ?? '').toLowerCase().includes(searchLower) ||
        (c.description ?? '').toLowerCase().includes(searchLower) ||
        (c.all_supplier_names ?? '').toLowerCase().includes(searchLower)
      );
    });

    return NextResponse.json({ components: results });
  } catch (err: any) {
    console.error('[components/by-category] error', err);
    return NextResponse.json({ error: 'Failed to load components' }, { status: 500 });
  }
}
