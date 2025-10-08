import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const MAX_LIMIT = 200;



export async function GET(request: Request) {
  const url = new URL(request.url);
  const componentIdParam = url.searchParams.get('componentId');
  const idsParam = url.searchParams.get('ids');
  const limitParam = url.searchParams.get('limit');

  if (!componentIdParam && !idsParam) {
    return NextResponse.json({ error: 'componentId or ids parameter required' }, { status: 400 });
  }

  let limit: number | undefined;
  if (limitParam) {
    const parsed = Number(limitParam);
    if (!Number.isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_LIMIT);
    }
  }

  const supabase = supabaseAdmin;
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase admin client is not available' }, { status: 503 });
  }
  let query = supabase
    .from('suppliercomponents')
    .select(
      `
        supplier_component_id,
        component_id,
        supplier_id,
        supplier_code,
        price,
        lead_time,
        min_order_quantity,
        suppliers ( name )
      `
    )
    .order('price', { ascending: true });

  if (idsParam) {
    const ids = idsParam
      .split(',')
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isInteger(id) && id > 0);

    if (ids.length === 0) {
      return NextResponse.json({ supplier_components: [] });
    }

    query = query.in('supplier_component_id', ids);
  }

  if (componentIdParam) {
    const componentId = Number(componentIdParam);
    if (Number.isNaN(componentId) || componentId <= 0) {
      return NextResponse.json({ error: 'Invalid componentId parameter' }, { status: 400 });
    }
    query = query.eq('component_id', componentId);
  }

  if (limit != null) {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[supplier-components] fetch error', error);
    return NextResponse.json({ error: 'Failed to load supplier components' }, { status: 500 });
  }

  console.log('[supplier-components] Raw data from Supabase:', JSON.stringify(data, null, 2));

  const normalized = (data ?? []).map((item: any) => ({
    supplier_component_id: Number(item.supplier_component_id),
    component_id: Number(item.component_id),
    supplier_id: item.supplier_id ? Number(item.supplier_id) : null,
    supplier_code: item.supplier_code ?? null,
    price: item.price != null ? Number(item.price) : null,
    lead_time: item.lead_time != null ? Number(item.lead_time) : null,
    min_order_quantity: item.min_order_quantity != null ? Number(item.min_order_quantity) : null,
    supplier_name: item.suppliers?.name ?? null,
  }));

  console.log('[supplier-components] Normalized response:', JSON.stringify(normalized, null, 2));

  return NextResponse.json({ supplier_components: normalized });
}
