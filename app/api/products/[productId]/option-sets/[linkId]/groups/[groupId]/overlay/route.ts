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
  if (typeof payload.is_required === 'boolean') {
    updates.is_required = payload.is_required;
  }
  if (typeof payload.hide === 'boolean') {
    updates.hide = payload.hide;
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

    const groupBelongs = await optionSetGroupBelongsToSet(link.optionSetId, groupId);
    if (!groupBelongs) {
      return NextResponse.json({ error: 'Option set group not found for link' }, { status: 404 });
    }

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('product_option_group_overlays')
      .select('overlay_id')
      .eq('link_id', linkId)
      .eq('option_set_group_id', groupId)
      .maybeSingle();

    if (fetchError) {
      console.error('[group-overlay] failed fetching existing overlay', fetchError);
      return NextResponse.json({ error: 'Failed to load existing overlay' }, { status: 500 });
    }

    if (existing) {
      const { error: updateError } = await supabaseAdmin
        .from('product_option_group_overlays')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('overlay_id', existing.overlay_id);

      if (updateError) {
        console.error('[group-overlay] failed updating overlay', updateError);
        return NextResponse.json({ error: 'Failed to update group overlay' }, { status: 400 });
      }
    } else {
      const { error: insertError } = await supabaseAdmin
        .from('product_option_group_overlays')
        .insert({
          link_id: linkId,
          option_set_group_id: groupId,
          ...updates,
        });

      if (insertError) {
        console.error('[group-overlay] failed creating overlay', insertError);
        return NextResponse.json({ error: 'Failed to create group overlay' }, { status: 400 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[group-overlay] unexpected error', error);
    return NextResponse.json({ error: 'Unexpected error while saving group overlay' }, { status: 500 });
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
      return NextResponse.json({ error: 'Option set group not found for link' }, { status: 404 });
    }

    const { error } = await supabaseAdmin
      .from('product_option_group_overlays')
      .delete()
      .eq('link_id', linkId)
      .eq('option_set_group_id', groupId);

    if (error) {
      console.error('[group-overlay] failed clearing overlay', error);
      return NextResponse.json({ error: 'Failed to clear group overlay' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[group-overlay] unexpected delete error', error);
    return NextResponse.json({ error: 'Unexpected error while clearing group overlay' }, { status: 500 });
  }
}
