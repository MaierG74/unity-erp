import { NextRequest, NextResponse } from 'next/server';
import {
  optionSetGroupBelongsToSet,
  optionSetLinkForProduct,
  parsePositiveInt,
  productExistsInOrg,
  requireProductsAccess,
} from '@/lib/api/products-access';
import { supabaseAdmin } from '@/lib/supabase-admin';

type RouteParams = {
  productId?: string;
  linkId?: string;
  groupId?: string;
};

export async function PATCH(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  const params = await context.params;
  const productId = parsePositiveInt(params.productId);
  const linkId = parsePositiveInt(params.linkId);
  const groupId = parsePositiveInt(params.groupId);
  if (!productId || !linkId || !groupId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const aliasLabel = typeof body.alias_label === 'string' ? body.alias_label.trim() : body.alias_label === null ? null : undefined;
  const isRequired = typeof body.is_required === 'boolean' ? body.is_required : undefined;
  const hide = typeof body.hide === 'boolean' ? body.hide : undefined;
  const displayOrder = typeof body.display_order === 'number' && Number.isFinite(body.display_order) ? body.display_order : undefined;

  if (aliasLabel === undefined && isRequired === undefined && hide === undefined && displayOrder === undefined) {
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

    const groupBelongs = await optionSetGroupBelongsToSet(link.optionSetId, groupId);
    if (!groupBelongs) {
      return NextResponse.json({ error: 'Option group not part of option set' }, { status: 404 });
    }

    const payload: Record<string, unknown> = {
      link_id: linkId,
      option_set_group_id: groupId,
      updated_at: new Date().toISOString(),
    };

    if (aliasLabel !== undefined) {
      payload.alias_label = aliasLabel && aliasLabel.length ? aliasLabel : null;
    }
    if (isRequired !== undefined) {
      payload.is_required = isRequired;
    }
    if (hide !== undefined) {
      payload.hide = hide;
    }
    if (displayOrder !== undefined) {
      payload.display_order = displayOrder;
    }

    const shouldDelete =
      (aliasLabel === null || aliasLabel === '' || aliasLabel === undefined) &&
      isRequired === undefined &&
      hide === undefined &&
      displayOrder === undefined;

    if (shouldDelete) {
      const { error: deleteError } = await supabaseAdmin
        .from('product_option_group_overlays')
        .delete()
        .eq('link_id', linkId)
        .eq('option_set_group_id', groupId);

      if (deleteError) {
        console.error('[group-overlays] failed clearing overlay', deleteError);
        return NextResponse.json({ error: 'Failed to clear group overlay' }, { status: 400 });
      }

      return NextResponse.json({ success: true });
    }

    const { error } = await supabaseAdmin
      .from('product_option_group_overlays')
      .upsert(payload, { onConflict: 'link_id,option_set_group_id' });

    if (error) {
      console.error('[group-overlays] failed upserting overlay', error);
      return NextResponse.json({ error: 'Failed to update group overlay' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[group-overlays] unexpected error', error);
    return NextResponse.json({ error: 'Unexpected error while updating group overlay' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  const params = await context.params;
  const productId = parsePositiveInt(params.productId);
  const linkId = parsePositiveInt(params.linkId);
  const groupId = parsePositiveInt(params.groupId);
  if (!productId || !linkId || !groupId) {
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

    const groupBelongs = await optionSetGroupBelongsToSet(link.optionSetId, groupId);
    if (!groupBelongs) {
      return NextResponse.json({ error: 'Option group not part of option set' }, { status: 404 });
    }

    const { error } = await supabaseAdmin
      .from('product_option_group_overlays')
      .delete()
      .eq('link_id', linkId)
      .eq('option_set_group_id', groupId);

    if (error) {
      console.error('[group-overlays] failed deleting overlay', error);
      return NextResponse.json({ error: 'Failed to delete group overlay' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[group-overlays] unexpected delete error', error);
    return NextResponse.json({ error: 'Unexpected error while deleting group overlay' }, { status: 500 });
  }
}
