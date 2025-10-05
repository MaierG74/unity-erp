import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

interface RouteParams {
  params: {
    productId?: string;
    linkId?: string;
    groupId?: string;
  };
}

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

async function ensureLink(client: ReturnType<typeof createClient>, productId: number, linkId: number) {
  const { data, error } = await client
    .from('product_option_set_links')
    .select('product_id, option_set_id')
    .eq('link_id', linkId)
    .maybeSingle();

  if (error || !data || Number(data.product_id) !== productId) {
    throw new Error('LinkNotFound');
  }

  return Number(data.option_set_id);
}

async function ensureGroup(optionSetId: number, groupId: number, client: ReturnType<typeof createClient>) {
  const { data, error } = await client
    .from('option_set_groups')
    .select('option_set_id')
    .eq('option_set_group_id', groupId)
    .maybeSingle();

  if (error || !data || Number(data.option_set_id) !== optionSetId) {
    throw new Error('GroupNotFound');
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const productId = parseId(params.productId);
  const linkId = parseId(params.linkId);
  const groupId = parseId(params.groupId);
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

  const supabase = getSupabaseAdmin();

  try {
    const optionSetId = await ensureLink(supabase, productId, linkId);
    await ensureGroup(optionSetId, groupId, supabase);

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
      const { error: deleteError } = await supabase
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

    const { error } = await supabase
      .from('product_option_group_overlays')
      .upsert(payload, { onConflict: 'link_id,option_set_group_id' });

    if (error) {
      console.error('[group-overlays] failed upserting overlay', error);
      return NextResponse.json({ error: 'Failed to update group overlay' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.message === 'LinkNotFound') {
      return NextResponse.json({ error: 'Option set link not found for product' }, { status: 404 });
    }
    if (error?.message === 'GroupNotFound') {
      return NextResponse.json({ error: 'Option group not part of option set' }, { status: 404 });
    }
    console.error('[group-overlays] unexpected error', error);
    return NextResponse.json({ error: 'Unexpected error while updating group overlay' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const productId = parseId(params.productId);
  const linkId = parseId(params.linkId);
  const groupId = parseId(params.groupId);
  if (!productId || !linkId || !groupId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    const optionSetId = await ensureLink(supabase, productId, linkId);
    await ensureGroup(optionSetId, groupId, supabase);

    const { error } = await supabase
      .from('product_option_group_overlays')
      .delete()
      .eq('link_id', linkId)
      .eq('option_set_group_id', groupId);

    if (error) {
      console.error('[group-overlays] failed deleting overlay', error);
      return NextResponse.json({ error: 'Failed to delete group overlay' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.message === 'LinkNotFound') {
      return NextResponse.json({ error: 'Option set link not found for product' }, { status: 404 });
    }
    if (error?.message === 'GroupNotFound') {
      return NextResponse.json({ error: 'Option group not part of option set' }, { status: 404 });
    }
    console.error('[group-overlays] unexpected delete error', error);
    return NextResponse.json({ error: 'Unexpected error while deleting group overlay' }, { status: 500 });
  }
}
