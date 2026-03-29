import { NextRequest, NextResponse } from 'next/server';
import {
  parsePositiveInt,
  productExistsInOrg,
  productOptionValueBelongsToProduct,
  requireProductsAccess,
} from '@/lib/api/products-access';
import { supabaseAdmin } from '@/lib/supabase-admin';

type RouteParams = {
  productId?: string;
  groupId?: string;
  valueId?: string;
};

export async function PATCH(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  const params = await context.params;
  const productId = parsePositiveInt(params.productId);
  const groupId = parsePositiveInt(params.groupId);
  const valueId = parsePositiveInt(params.valueId);
  if (!productId || !groupId || !valueId) {
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
      return NextResponse.json({ error: 'Option value code cannot be empty' }, { status: 400 });
    }
  }
  if (typeof payload.label === 'string') {
    updates.label = payload.label.trim();
    if (!updates.label) {
      return NextResponse.json({ error: 'Option value label cannot be empty' }, { status: 400 });
    }
  }
  if (typeof payload.display_order === 'number' && Number.isFinite(payload.display_order)) {
    updates.display_order = payload.display_order;
  }
  if (payload.attributes !== undefined) {
    if (payload.attributes === null || typeof payload.attributes === 'object') {
      updates.attributes = payload.attributes;
    } else {
      return NextResponse.json({ error: 'Attributes must be an object or null' }, { status: 400 });
    }
  }
  let setDefault: boolean | null = null;
  if (typeof payload.is_default === 'boolean') {
    updates.is_default = payload.is_default;
    setDefault = payload.is_default;
  }

  if (Object.keys(updates).length <= 1) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  try {
    const exists = await productExistsInOrg(productId, auth.orgId);
    if (!exists) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const valueBelongs = await productOptionValueBelongsToProduct(productId, groupId, valueId);
    if (!valueBelongs) {
      return NextResponse.json({ error: 'Option value not found for product' }, { status: 404 });
    }

    const { data, error } = await supabaseAdmin
      .from('product_option_values')
      .update(updates)
      .eq('option_group_id', groupId)
      .eq('option_value_id', valueId)
      .select('*')
      .single();

    if (error) {
      console.error('[option-values] failed updating value', error);
      const message = error.code === '23505'
        ? 'An option value with this code already exists in the group'
        : 'Failed to update option value';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (setDefault === true) {
      await supabaseAdmin
        .from('product_option_values')
        .update({ is_default: false })
        .eq('option_group_id', groupId)
        .neq('option_value_id', valueId);
    } else if (setDefault === false) {
      // ensure at least one default remains by checking count
      const { data: defaults } = await supabaseAdmin
        .from('product_option_values')
        .select('option_value_id')
        .eq('option_group_id', groupId)
        .eq('is_default', true);
      if (!defaults || defaults.length === 0) {
        // revert change: set current value back to true to avoid group without default
        await supabaseAdmin
          .from('product_option_values')
          .update({ is_default: true })
          .eq('option_value_id', valueId);
        return NextResponse.json({ error: 'Each option group requires at least one default value' }, { status: 400 });
      }
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
    });
  } catch (error) {
    console.error('[option-values] unexpected update error', error);
    return NextResponse.json({ error: 'Unexpected error while updating option value' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await requireProductsAccess(_request);
  if ('error' in auth) return auth.error;

  const params = await context.params;
  const productId = parsePositiveInt(params.productId);
  const groupId = parsePositiveInt(params.groupId);
  const valueId = parsePositiveInt(params.valueId);
  if (!productId || !groupId || !valueId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  try {
    const exists = await productExistsInOrg(productId, auth.orgId);
    if (!exists) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const valueBelongs = await productOptionValueBelongsToProduct(productId, groupId, valueId);
    if (!valueBelongs) {
      return NextResponse.json({ error: 'Option value not found for product' }, { status: 404 });
    }

    const { data: valueRow } = await supabaseAdmin
      .from('product_option_values')
      .select('is_default')
      .eq('option_group_id', groupId)
      .eq('option_value_id', valueId)
      .single();

    const { error } = await supabaseAdmin
      .from('product_option_values')
      .delete()
      .eq('option_group_id', groupId)
      .eq('option_value_id', valueId);

    if (error) {
      console.error('[option-values] failed deleting value', error);
      return NextResponse.json({ error: 'Failed to delete option value' }, { status: 400 });
    }

    if (valueRow?.is_default) {
      const { data: remaining } = await supabaseAdmin
        .from('product_option_values')
        .select('option_value_id')
        .eq('option_group_id', groupId)
        .limit(1);

      if (remaining && remaining.length > 0) {
        await supabaseAdmin
          .from('product_option_values')
          .update({ is_default: true })
          .eq('option_value_id', remaining[0].option_value_id);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[option-values] unexpected delete error', error);
    return NextResponse.json({ error: 'Unexpected error while deleting option value' }, { status: 500 });
  }
}
