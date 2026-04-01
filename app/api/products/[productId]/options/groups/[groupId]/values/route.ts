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

export async function POST(request: NextRequest, context: { params: Promise<RouteParams> }) {
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

  const code = typeof payload.code === 'string' ? payload.code.trim() : '';
  const label = typeof payload.label === 'string' ? payload.label.trim() : '';
  const isDefault = Boolean(payload.is_default);
  const displayOrder = typeof payload.display_order === 'number' && Number.isFinite(payload.display_order)
    ? payload.display_order
    : null;
  const attributes = typeof payload.attributes === 'object' && payload.attributes !== null
    ? payload.attributes
    : null;

  if (!code) {
    return NextResponse.json({ error: 'Option value code is required' }, { status: 400 });
  }
  if (!label) {
    return NextResponse.json({ error: 'Option value label is required' }, { status: 400 });
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

    let resolvedDisplayOrder = displayOrder;
    if (resolvedDisplayOrder === null) {
      const { data: rows, error: orderError } = await supabaseAdmin
        .from('product_option_values')
        .select('display_order')
        .eq('option_group_id', groupId)
        .order('display_order', { ascending: false })
        .limit(1);
      if (orderError) {
        console.warn('[option-values] failed fetching display order', orderError);
      }
      const currentMax = rows && rows.length > 0 ? Number(rows[0].display_order ?? 0) : -1;
      resolvedDisplayOrder = currentMax + 1;
    }

    const { data, error } = await supabaseAdmin
      .from('product_option_values')
      .insert({
        option_group_id: groupId,
        code,
        label,
        is_default: isDefault,
        display_order: resolvedDisplayOrder ?? 0,
        attributes,
      })
      .select('*')
      .single();

    if (error) {
      console.error('[option-values] failed creating value', error);
      const message = error.code === '23505'
        ? 'An option value with this code already exists in the group'
        : 'Failed to create option value';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (isDefault) {
      await supabaseAdmin
        .from('product_option_values')
        .update({ is_default: false })
        .eq('option_group_id', groupId)
        .neq('option_value_id', data.option_value_id);
    }

    return NextResponse.json({
      value: {
        option_value_id: Number(data.option_value_id),
        option_group_id: Number(data.option_group_id),
        code: data.code,
        label: data.label,
        is_default: Boolean(data.is_default),
        display_order: Number(data.display_order ?? 0),
        attributes: data.attributes ?? null,
      },
    }, { status: 201 });
  } catch (error) {
    console.error('[option-values] unexpected create error', error);
    return NextResponse.json({ error: 'Unexpected error while creating option value' }, { status: 500 });
  }
}
