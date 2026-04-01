import { NextRequest, NextResponse } from 'next/server';
import {
  optionSetLinkForProduct,
  parsePositiveInt,
  productExistsInOrg,
  requireProductsAccess,
} from '@/lib/api/products-access';
import { supabaseAdmin } from '@/lib/supabase-admin';

type RouteParams = {
  productId?: string;
  linkId?: string;
};

export async function PATCH(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  const params = await context.params;
  const productId = parsePositiveInt(params.productId);
  const linkId = parsePositiveInt(params.linkId);
  if (!productId || !linkId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof payload.alias_label === 'string') {
    updates.alias_label = payload.alias_label.trim() || null;
  } else if (payload.alias_label === null) {
    updates.alias_label = null;
  }
  if (typeof payload.display_order === 'number' && Number.isFinite(payload.display_order)) {
    updates.display_order = payload.display_order;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields provided to update' }, { status: 400 });
  }

  try {
    const exists = await productExistsInOrg(productId, auth.orgId);
    if (!exists) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const link = await optionSetLinkForProduct(productId, linkId);
    if (!link) {
      return NextResponse.json({ error: 'Option set link not found for product' }, { status: 404 });
    }

    const { error } = await supabaseAdmin
      .from('product_option_set_links')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('link_id', linkId);

    if (error) {
      console.error('[product-option-sets] failed updating link', error);
      return NextResponse.json({ error: 'Failed to update option set link' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[product-option-sets] unexpected update error', error);
    return NextResponse.json({ error: 'Unexpected error while updating option set link' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  const params = await context.params;
  const productId = parsePositiveInt(params.productId);
  const linkId = parsePositiveInt(params.linkId);
  if (!productId || !linkId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  try {
    const exists = await productExistsInOrg(productId, auth.orgId);
    if (!exists) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const link = await optionSetLinkForProduct(productId, linkId);
    if (!link) {
      return NextResponse.json({ error: 'Option set link not found for product' }, { status: 404 });
    }

    const { error } = await supabaseAdmin
      .from('product_option_set_links')
      .delete()
      .eq('link_id', linkId);

    if (error) {
      console.error('[product-option-sets] failed detaching set', error);
      return NextResponse.json({ error: 'Failed to detach option set from product' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[product-option-sets] unexpected delete error', error);
    return NextResponse.json({ error: 'Unexpected error while detaching option set' }, { status: 500 });
  }
}
