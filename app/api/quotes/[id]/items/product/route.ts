import { NextRequest, NextResponse } from 'next/server';

import { requireModuleAccess } from '@/lib/api/module-access';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { buildBomSnapshot } from '@/lib/quotes/build-bom-snapshot';
import { supabaseAdmin } from '@/lib/supabase-admin';

async function requireQuotesAccess(request: NextRequest) {
  const access = await requireModuleAccess(request, MODULE_KEYS.QUOTING_PROPOSALS, {
    forbiddenMessage: 'Quoting module access is disabled for your organization',
  });

  if ('error' in access) {
    return { error: access.error };
  }

  if (!access.orgId) {
    return {
      error: NextResponse.json(
        {
          error: 'Organization context is required for quotes access',
          reason: 'missing_org_context',
          module_key: access.moduleKey,
        },
        { status: 403 }
      ),
    };
  }

  return { orgId: access.orgId };
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireQuotesAccess(request);
  if ('error' in auth) return auth.error;

  const { id: quoteId } = await context.params;
  const body = await request.json().catch(() => null);
  const productId = Number(body?.product_id);
  const qty = Number(body?.qty ?? 1);
  const description = typeof body?.description === 'string' ? body.description.trim() : '';
  const selectedOptions =
    body?.selected_options && typeof body.selected_options === 'object'
      ? body.selected_options
      : null;
  const bulletPoints = typeof body?.bullet_points === 'string' && body.bullet_points.trim()
    ? body.bullet_points
    : null;

  if (!quoteId) {
    return NextResponse.json({ error: 'Quote id is required' }, { status: 400 });
  }
  if (!Number.isFinite(productId) || productId <= 0) {
    return NextResponse.json({ error: 'Valid product_id is required' }, { status: 400 });
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    return NextResponse.json({ error: 'Quantity must be greater than zero' }, { status: 400 });
  }

  const { data: quote, error: quoteError } = await supabaseAdmin
    .from('quotes')
    .select('id, org_id')
    .eq('id', quoteId)
    .eq('org_id', auth.orgId)
    .maybeSingle();

  if (quoteError) {
    return NextResponse.json({ error: quoteError.message }, { status: 500 });
  }
  if (!quote) {
    return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
  }

  const { data: product, error: productError } = await supabaseAdmin
    .from('products')
    .select('product_id, name')
    .eq('product_id', productId)
    .eq('org_id', auth.orgId)
    .maybeSingle();

  if (productError) {
    return NextResponse.json({ error: productError.message }, { status: 500 });
  }
  if (!product) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  }

  const bomSnapshot = await buildBomSnapshot(productId, auth.orgId);
  if (bomSnapshot.length === 0) {
    return NextResponse.json(
      { error: 'Selected product has no BOM', code: 'product_has_no_bom' },
      { status: 422 }
    );
  }

  const { data: maxPosResult } = await supabaseAdmin
    .from('quote_items')
    .select('position')
    .eq('quote_id', quoteId)
    .eq('org_id', auth.orgId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextPosition = (maxPosResult?.position ?? -1) + 1;

  const { data: item, error: itemError } = await supabaseAdmin
    .from('quote_items')
    .insert({
      quote_id: quoteId,
      org_id: auth.orgId,
      description: description || product.name,
      qty,
      unit_price: 0,
      total: 0,
      product_id: productId,
      bom_snapshot: bomSnapshot,
      surcharge_total: 0,
      selected_options: selectedOptions,
      bullet_points: bulletPoints,
      item_type: 'priced',
      position: nextPosition,
    })
    .select('*')
    .single();

  if (itemError) {
    return NextResponse.json({ error: itemError.message }, { status: 500 });
  }

  return NextResponse.json({ item }, { status: 201 });
}
