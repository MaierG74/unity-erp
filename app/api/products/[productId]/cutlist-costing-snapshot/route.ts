import { NextRequest, NextResponse } from 'next/server';
import { requireProductsAccess } from '@/lib/api/products-access';
import { supabaseAdmin } from '@/lib/supabase-admin';

function parseProductId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * GET /api/products/[productId]/cutlist-costing-snapshot
 * Returns the costing snapshot for a product, or { snapshot: null }.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  const { productId } = await params;
  const productIdNum = parseProductId(productId);
  if (!productIdNum) {
    return NextResponse.json({ error: 'Invalid product ID' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('product_cutlist_costing_snapshots')
    .select('*')
    .eq('product_id', productIdNum)
    .eq('org_id', auth.orgId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching costing snapshot:', error);
    return NextResponse.json({ error: 'Failed to fetch snapshot' }, { status: 500 });
  }

  return NextResponse.json({ snapshot: data ?? null });
}

/**
 * PUT /api/products/[productId]/cutlist-costing-snapshot
 * Upserts the costing snapshot for a product.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  const { productId } = await params;
  const productIdNum = parseProductId(productId);
  if (!productIdNum) {
    return NextResponse.json({ error: 'Invalid product ID' }, { status: 400 });
  }

  let body: { snapshot_data?: unknown; parts_hash?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.snapshot_data || typeof body.parts_hash !== 'string') {
    return NextResponse.json({ error: 'snapshot_data and parts_hash are required' }, { status: 400 });
  }

  // Verify product exists and belongs to org
  const { data: product } = await supabaseAdmin
    .from('products')
    .select('product_id')
    .eq('product_id', productIdNum)
    .eq('org_id', auth.orgId)
    .maybeSingle();

  if (!product) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from('product_cutlist_costing_snapshots')
    .upsert(
      {
        product_id: productIdNum,
        org_id: auth.orgId,
        snapshot_data: body.snapshot_data,
        parts_hash: body.parts_hash,
        calculated_at: new Date().toISOString(),
      },
      { onConflict: 'product_id,org_id' }
    )
    .select()
    .single();

  if (error) {
    console.error('Error upserting costing snapshot:', error);
    return NextResponse.json({ error: 'Failed to save snapshot' }, { status: 500 });
  }

  return NextResponse.json({ success: true, snapshot: data });
}
