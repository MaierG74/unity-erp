import { NextRequest, NextResponse } from 'next/server';

import { requireModuleAccess } from '@/lib/api/module-access';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { buildBomSnapshot } from '@/lib/quotes/build-bom-snapshot';
import { supabaseAdmin } from '@/lib/supabase-admin';

type SupabaseLikeClient = typeof supabaseAdmin;

export async function resolveDefaultProductSellingPrice(
  client: SupabaseLikeClient,
  productId: number,
  orgId: string
): Promise<number> {
  const { data: defaultList, error: defaultListError } = await client
    .from('product_price_lists')
    .select('id')
    .eq('org_id', orgId)
    .eq('is_default', true)
    .maybeSingle();

  if (defaultListError || !defaultList?.id) {
    return 0;
  }

  const { data: price, error: priceError } = await client
    .from('product_prices')
    .select('selling_price')
    .eq('org_id', orgId)
    .eq('product_id', productId)
    .eq('price_list_id', defaultList.id)
    .maybeSingle();

  if (priceError) {
    return 0;
  }

  const sellingPrice = Number(price?.selling_price ?? 0);
  return Number.isFinite(sellingPrice) && sellingPrice > 0
    ? Math.round(sellingPrice * 100) / 100
    : 0;
}

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

async function requireQuoteAndProduct(quoteId: string, productId: number, orgId: string) {
  const { data: quote, error: quoteError } = await supabaseAdmin
    .from('quotes')
    .select('id, org_id')
    .eq('id', quoteId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (quoteError) {
    return { error: NextResponse.json({ error: quoteError.message }, { status: 500 }) };
  }
  if (!quote) {
    return { error: NextResponse.json({ error: 'Quote not found' }, { status: 404 }) };
  }

  const { data: product, error: productError } = await supabaseAdmin
    .from('products')
    .select('product_id, name')
    .eq('product_id', productId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (productError) {
    return { error: NextResponse.json({ error: productError.message }, { status: 500 }) };
  }
  if (!product) {
    return { error: NextResponse.json({ error: 'Product not found' }, { status: 404 }) };
  }

  return { quote, product };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireQuotesAccess(request);
  if ('error' in auth) return auth.error;

  const { id: quoteId } = await context.params;
  const productId = Number(request.nextUrl.searchParams.get('product_id'));

  if (!quoteId) {
    return NextResponse.json({ error: 'Quote id is required' }, { status: 400 });
  }
  if (!Number.isFinite(productId) || productId <= 0) {
    return NextResponse.json({ error: 'Valid product_id is required' }, { status: 400 });
  }

  const result = await requireQuoteAndProduct(quoteId, productId, auth.orgId);
  if ('error' in result) return result.error;

  const unitPrice = await resolveDefaultProductSellingPrice(supabaseAdmin, productId, auth.orgId);
  return NextResponse.json({ unit_price: unitPrice });
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

  const result = await requireQuoteAndProduct(quoteId, productId, auth.orgId);
  if ('error' in result) return result.error;

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
  const unitPrice = await resolveDefaultProductSellingPrice(supabaseAdmin, productId, auth.orgId);

  const { data: item, error: itemError } = await supabaseAdmin
    .from('quote_items')
    .insert({
      quote_id: quoteId,
      org_id: auth.orgId,
      description: description || result.product.name,
      qty,
      unit_price: unitPrice,
      total: Math.round(qty * unitPrice * 100) / 100,
      product_id: productId,
      bom_snapshot: bomSnapshot,
      surcharge_total: 0,
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
