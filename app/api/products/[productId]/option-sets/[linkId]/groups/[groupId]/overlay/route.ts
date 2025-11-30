import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type RouteParams = {
  productId?: string;
  linkId?: string;
  groupId?: string;
};

function parseId(value?: string): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && !Number.isNaN(parsed) ? parsed : null;
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase environment variables are not configured');
  }
  return createClient(url, key);
}

async function resolveLink(context: { productId: number; linkId: number }) {
  const client = getSupabaseAdmin();
  const { data, error } = await client
    .from('product_option_set_links')
    .select('product_id, option_set_id')
    .eq('link_id', context.linkId)
    .single();

  if (error || !data || Number(data.product_id) !== context.productId) {
    throw new Error('link_not_found');
  }

  return { client, optionSetId: Number(data.option_set_id) };
}

async function ensureGroupBelongs(client: any, optionSetId: number, groupId: number) {
  const { data, error } = await client
    .from('option_set_groups')
    .select('option_set_id')
    .eq('option_set_group_id', groupId)
    .single();

  const record = data as any;

  if (error || !record || Number(record.option_set_id) !== optionSetId) {
    throw new Error('group_not_found');
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const params = await context.params;
  const productId = parseId(params.productId);
  const linkId = parseId(params.linkId);
  const groupId = parseId(params.groupId);
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
    const { client, optionSetId } = await resolveLink({ productId, linkId });
    await ensureGroupBelongs(client, optionSetId, groupId);

    const { data: existing, error: fetchError } = await client
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
      const { error: updateError } = await client
        .from('product_option_group_overlays')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('overlay_id', existing.overlay_id);

      if (updateError) {
        console.error('[group-overlay] failed updating overlay', updateError);
        return NextResponse.json({ error: 'Failed to update group overlay' }, { status: 400 });
      }
    } else {
      const { error: insertError } = await client
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
  } catch (error: any) {
    if (error?.message === 'link_not_found') {
      return NextResponse.json({ error: 'Option set link not found for product' }, { status: 404 });
    }
    if (error?.message === 'group_not_found') {
      return NextResponse.json({ error: 'Option set group not found for link' }, { status: 404 });
    }
    console.error('[group-overlay] unexpected error', error);
    return NextResponse.json({ error: 'Unexpected error while saving group overlay' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<RouteParams> }) {
  const params = await context.params;
  const productId = parseId(params.productId);
  const linkId = parseId(params.linkId);
  const groupId = parseId(params.groupId);
  if (!productId || !linkId || !groupId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  try {
    const { client, optionSetId } = await resolveLink({ productId, linkId });
    await ensureGroupBelongs(client, optionSetId, groupId);

    const { error } = await client
      .from('product_option_group_overlays')
      .delete()
      .eq('link_id', linkId)
      .eq('option_set_group_id', groupId);

    if (error) {
      console.error('[group-overlay] failed clearing overlay', error);
      return NextResponse.json({ error: 'Failed to clear group overlay' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.message === 'link_not_found') {
      return NextResponse.json({ error: 'Option set link not found for product' }, { status: 404 });
    }
    if (error?.message === 'group_not_found') {
      return NextResponse.json({ error: 'Option set group not found for link' }, { status: 404 });
    }
    console.error('[group-overlay] unexpected delete error', error);
    return NextResponse.json({ error: 'Unexpected error while clearing group overlay' }, { status: 500 });
  }
}
