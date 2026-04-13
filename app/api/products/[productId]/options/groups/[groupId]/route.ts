import { NextRequest, NextResponse } from 'next/server';
import {
  parsePositiveInt,
  productExistsInOrg,
  productOptionGroupBelongsToProduct,
  requireProductsAccess,
} from '@/lib/api/products-access';
import { supabaseAdmin } from '@/lib/supabase-admin';

type RouteParams = {
  productId?: string;
  groupId?: string;
};

export async function PATCH(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  const params = await context.params;
  const productId = parsePositiveInt(params.productId);
  const groupId = parsePositiveInt(params.groupId);
  if (!productId || !groupId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const updates: Record<string, any> = { updated_at: new Date().toISOString() };

  if (typeof payload.code === 'string') {
    updates.code = payload.code.trim();
    if (!updates.code) {
      return NextResponse.json({ error: 'Option group code cannot be empty' }, { status: 400 });
    }
  }
  if (typeof payload.label === 'string') {
    updates.label = payload.label.trim();
    if (!updates.label) {
      return NextResponse.json({ error: 'Option group label cannot be empty' }, { status: 400 });
    }
  }
  if (typeof payload.is_required === 'boolean') {
    updates.is_required = payload.is_required;
  }
  if (typeof payload.display_order === 'number' && Number.isFinite(payload.display_order)) {
    updates.display_order = payload.display_order;
  }

  if (Object.keys(updates).length <= 1) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  try {
    const exists = await productExistsInOrg(productId, auth.orgId);
    if (!exists) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const groupBelongs = await productOptionGroupBelongsToProduct(productId, groupId);
    if (!groupBelongs) {
      return NextResponse.json({ error: 'Option group not found for product' }, { status: 404 });
    }

    const { data, error } = await supabaseAdmin
      .from('product_option_groups')
      .update(updates)
      .eq('product_id', productId)
      .eq('option_group_id', groupId)
      .select('*')
      .single();

    if (error) {
      console.error('[options] failed updating group', error);
      const message = error.code === '23505'
        ? 'An option group with this code already exists for the product'
        : 'Failed to update option group';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({
      group: {
        option_group_id: Number(data.option_group_id),
        product_id: Number(data.product_id),
        code: data.code,
        label: data.label,
        display_order: Number(data.display_order ?? 0),
        is_required: Boolean(data.is_required),
      },
    });
  } catch (error) {
    console.error('[options] unexpected update error', error);
    return NextResponse.json({ error: 'Unexpected error while updating option group' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await requireProductsAccess(_request);
  if ('error' in auth) return auth.error;

  const params = await context.params;
  const productId = parsePositiveInt(params.productId);
  const groupId = parsePositiveInt(params.groupId);
  if (!productId || !groupId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  try {
    const exists = await productExistsInOrg(productId, auth.orgId);
    if (!exists) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const groupBelongs = await productOptionGroupBelongsToProduct(productId, groupId);
    if (!groupBelongs) {
      return NextResponse.json({ error: 'Option group not found for product' }, { status: 404 });
    }

    const { error } = await supabaseAdmin
      .from('product_option_groups')
      .delete()
      .eq('product_id', productId)
      .eq('option_group_id', groupId);

    if (error) {
      console.error('[options] failed deleting group', error);
      return NextResponse.json({ error: 'Failed to delete option group' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[options] unexpected delete error', error);
    return NextResponse.json({ error: 'Unexpected error while deleting option group' }, { status: 500 });
  }
}
