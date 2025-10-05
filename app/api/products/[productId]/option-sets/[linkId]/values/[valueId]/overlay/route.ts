import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

interface RouteParams {
  params: {
    productId?: string;
    linkId?: string;
    valueId?: string;
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

async function ensureValueBelongs(client: ReturnType<typeof createClient>, optionSetId: number, valueId: number) {
  const { data, error } = await client
    .from('option_set_values')
    .select('option_set_groups(option_set_id)')
    .eq('option_set_value_id', valueId)
    .single();

  const group = data?.option_set_groups;
  if (error || !group || Number(group.option_set_id) !== optionSetId) {
    throw new Error('value_not_found');
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const productId = parseId(params.productId);
  const linkId = parseId(params.linkId);
  const valueId = parseId(params.valueId);
  if (!productId || !linkId || !valueId) {
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
  if (typeof payload.is_default === 'boolean') {
    updates.is_default = payload.is_default;
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
    await ensureValueBelongs(client, optionSetId, valueId);

    const { data: existing, error: fetchError } = await client
      .from('product_option_value_overlays')
      .select('overlay_id')
      .eq('link_id', linkId)
      .eq('option_set_value_id', valueId)
      .maybeSingle();

    if (fetchError) {
      console.error('[value-overlay] failed fetching existing overlay', fetchError);
      return NextResponse.json({ error: 'Failed to load existing overlay' }, { status: 500 });
    }

    if (existing) {
      const { error: updateError } = await client
        .from('product_option_value_overlays')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('overlay_id', existing.overlay_id);

      if (updateError) {
        console.error('[value-overlay] failed updating overlay', updateError);
        return NextResponse.json({ error: 'Failed to update value overlay' }, { status: 400 });
      }
    } else {
      const { error: insertError } = await client
        .from('product_option_value_overlays')
        .insert({
          link_id: linkId,
          option_set_value_id: valueId,
          ...updates,
        });

      if (insertError) {
        console.error('[value-overlay] failed creating overlay', insertError);
        return NextResponse.json({ error: 'Failed to create value overlay' }, { status: 400 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.message === 'link_not_found') {
      return NextResponse.json({ error: 'Option set link not found for product' }, { status: 404 });
    }
    if (error?.message === 'value_not_found') {
      return NextResponse.json({ error: 'Option set value not found for link' }, { status: 404 });
    }
    console.error('[value-overlay] unexpected error', error);
    return NextResponse.json({ error: 'Unexpected error while saving value overlay' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const productId = parseId(params.productId);
  const linkId = parseId(params.linkId);
  const valueId = parseId(params.valueId);
  if (!productId || !linkId || !valueId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  try {
    const { client, optionSetId } = await resolveLink({ productId, linkId });
    await ensureValueBelongs(client, optionSetId, valueId);

    const { error } = await client
      .from('product_option_value_overlays')
      .delete()
      .eq('link_id', linkId)
      .eq('option_set_value_id', valueId);

    if (error) {
      console.error('[value-overlay] failed clearing overlay', error);
      return NextResponse.json({ error: 'Failed to clear value overlay' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.message === 'link_not_found') {
      return NextResponse.json({ error: 'Option set link not found for product' }, { status: 404 });
    }
    if (error?.message === 'value_not_found') {
      return NextResponse.json({ error: 'Option set value not found for link' }, { status: 404 });
    }
    console.error('[value-overlay] unexpected delete error', error);
    return NextResponse.json({ error: 'Unexpected error while clearing value overlay' }, { status: 500 });
  }
}
