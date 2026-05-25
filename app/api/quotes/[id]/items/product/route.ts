import { NextRequest, NextResponse } from 'next/server';

import { requireModuleAccess } from '@/lib/api/module-access';
import { loadBoardEdgingPairLookup } from '@/lib/cutlist/material-route-helpers';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { buildBomSnapshot } from '@/lib/quotes/build-bom-snapshot';
import { buildQuoteCutlistSnapshot } from '@/lib/quotes/build-cutlist-snapshot';
import { applyQuoteCostingMarkupPercent, calculateQuoteCostingUnitSubtotal, ensureQuoteItemCostingCluster } from '@/lib/quotes/build-costing-cluster';
import { calculateMarkupPercentFromProductPricing } from '@/lib/quotes/markup';
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
  const pairLookup = await loadBoardEdgingPairLookup(supabaseAdmin, auth.orgId);
  const { snapshot: cutlistMaterialSnapshot } = await buildQuoteCutlistSnapshot(productId, auth.orgId, { pairLookup });
  const hasCutlistGroups = Array.isArray(cutlistMaterialSnapshot) && cutlistMaterialSnapshot.length > 0;
  if (bomSnapshot.length === 0 && !hasCutlistGroups) {
    return NextResponse.json(
      { error: 'Selected product has no BOM or cutlist groups', code: 'product_has_no_bom' },
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

  const { data: price } = await supabaseAdmin
    .from('product_prices')
    .select('selling_price, markup_type, markup_value, product_price_lists!inner(is_default)')
    .eq('product_id', productId)
    .eq('org_id', auth.orgId)
    .eq('product_price_lists.is_default', true)
    .maybeSingle();

  const unitPrice = Math.round(Number(price?.selling_price ?? 0) * 100) / 100;

  const { data: item, error: itemError } = await supabaseAdmin
    .from('quote_items')
    .insert({
      quote_id: quoteId,
      org_id: auth.orgId,
      description: description || product.name,
      qty,
      unit_price: unitPrice,
      total: Math.round(qty * unitPrice * 100) / 100,
      product_id: productId,
      bom_snapshot: bomSnapshot,
      cutlist_material_snapshot: hasCutlistGroups ? cutlistMaterialSnapshot : null,
      cutlist_part_overrides: [],
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

  let itemWithCosting = item;
  try {
    const costing = await ensureQuoteItemCostingCluster({
      supabase: supabaseAdmin,
      quoteItemId: item.id,
      productId,
      orgId: auth.orgId,
      bomSnapshot,
      cutlistMaterialSnapshot: hasCutlistGroups ? cutlistMaterialSnapshot : null,
    });
    const clusters = costing.created
      ? await applyQuoteCostingMarkupPercent({
        supabase: supabaseAdmin,
        clusters: costing.clusters,
        markupPercent: calculateMarkupPercentFromProductPricing(
          {
            markup_type: price?.markup_type === 'percentage' || price?.markup_type === 'fixed' ? price.markup_type : null,
            markup_value: price?.markup_value ?? 0,
          },
          calculateQuoteCostingUnitSubtotal(costing.clusters),
          unitPrice
        ),
        orgId: auth.orgId,
      })
      : costing.clusters;
    itemWithCosting = {
      ...item,
      quote_item_clusters: clusters,
    };
  } catch (costingError) {
    console.warn('[quotes/items/product] product costing snapshot was not created', costingError);
  }

  return NextResponse.json({ item: itemWithCosting }, { status: 201 });
}
