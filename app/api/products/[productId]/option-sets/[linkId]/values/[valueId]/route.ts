import { NextRequest, NextResponse } from 'next/server';
import {
  optionSetLinkForProduct,
  optionSetValueBelongsToSet,
  parsePositiveInt,
  productExistsInOrg,
  requireProductsAccess,
} from '@/lib/api/products-access';
import { supabaseAdmin } from '@/lib/supabase-admin';

type RouteParams = {
  productId?: string;
  linkId?: string;
  valueId?: string;
};

export async function PATCH(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  const params = await context.params;
  const productId = parsePositiveInt(params.productId);
  const linkId = parsePositiveInt(params.linkId);
  const valueId = parsePositiveInt(params.valueId);
  if (!productId || !linkId || !valueId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const aliasLabel = typeof body.alias_label === 'string' ? body.alias_label.trim() : body.alias_label === null ? null : undefined;
  const isDefault = typeof body.is_default === 'boolean' ? body.is_default : undefined;
  const hide = typeof body.hide === 'boolean' ? body.hide : undefined;
  const displayOrder = typeof body.display_order === 'number' && Number.isFinite(body.display_order) ? body.display_order : undefined;

  if (aliasLabel === undefined && isDefault === undefined && hide === undefined && displayOrder === undefined) {
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

    const valueBelongs = await optionSetValueBelongsToSet(link.optionSetId, valueId);
    if (!valueBelongs) {
      return NextResponse.json({ error: 'Option value not part of option set' }, { status: 404 });
    }

    const payload: Record<string, unknown> = {
      link_id: linkId,
      option_set_value_id: valueId,
      updated_at: new Date().toISOString(),
    };

    if (aliasLabel !== undefined) {
      payload.alias_label = aliasLabel && aliasLabel.length ? aliasLabel : null;
    }
    if (isDefault !== undefined) {
      payload.is_default = isDefault;
    }
    if (hide !== undefined) {
      payload.hide = hide;
    }
    if (displayOrder !== undefined) {
      payload.display_order = displayOrder;
    }

    const shouldDelete =
      (aliasLabel === null || aliasLabel === '' || aliasLabel === undefined) &&
      isDefault === undefined &&
      hide === undefined &&
      displayOrder === undefined;

    if (shouldDelete) {
      const { error: deleteError } = await supabaseAdmin
        .from('product_option_value_overlays')
        .delete()
        .eq('link_id', linkId)
        .eq('option_set_value_id', valueId);

      if (deleteError) {
        console.error('[value-overlays] failed clearing overlay', deleteError);
        return NextResponse.json({ error: 'Failed to clear value overlay' }, { status: 400 });
      }

      return NextResponse.json({ success: true });
    }

    const { error } = await supabaseAdmin
      .from('product_option_value_overlays')
      .upsert(payload, { onConflict: 'link_id,option_set_value_id' });

    if (error) {
      console.error('[value-overlays] failed upserting overlay', error);
      return NextResponse.json({ error: 'Failed to update value overlay' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[value-overlays] unexpected error', error);
    return NextResponse.json({ error: 'Unexpected error while updating value overlay' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  const params = await context.params;
  const productId = parsePositiveInt(params.productId);
  const linkId = parsePositiveInt(params.linkId);
  const valueId = parsePositiveInt(params.valueId);
  if (!productId || !linkId || !valueId) {
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

    const valueBelongs = await optionSetValueBelongsToSet(link.optionSetId, valueId);
    if (!valueBelongs) {
      return NextResponse.json({ error: 'Option value not part of option set' }, { status: 404 });
    }

    const { error } = await supabaseAdmin
      .from('product_option_value_overlays')
      .delete()
      .eq('link_id', linkId)
      .eq('option_set_value_id', valueId);

    if (error) {
      console.error('[value-overlays] failed deleting overlay', error);
      return NextResponse.json({ error: 'Failed to delete value overlay' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[value-overlays] unexpected delete error', error);
    return NextResponse.json({ error: 'Unexpected error while deleting value overlay' }, { status: 500 });
  }
}
