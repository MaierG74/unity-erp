import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type RouteParams = {
  productId?: string;
  linkId?: string;
  valueId?: string;
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

async function ensureLink(client: any, productId: number, linkId: number) {
  const { data, error } = await client
    .from('product_option_set_links')
    .select('product_id, option_set_id')
    .eq('link_id', linkId)
    .maybeSingle();

  const record = data as any;

  if (error || !record || Number(record.product_id) !== productId) {
    throw new Error('LinkNotFound');
  }

  return Number(record.option_set_id);
}

async function ensureValue(optionSetId: number, valueId: number, client: any) {
  const { data, error } = await client
    .from('option_set_values')
    .select('option_set_groups(option_set_id, option_set_group_id)')
    .eq('option_set_value_id', valueId)
    .maybeSingle();

  const record = data as any;

  if (error || !record) {
    throw new Error('ValueNotFound');
  }

  const group = record.option_set_groups;
  if (!group || Number(group.option_set_id) !== optionSetId) {
    throw new Error('ValueNotFound');
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const params = await context.params;
  const productId = parseId(params.productId);
  const linkId = parseId(params.linkId);
  const valueId = parseId(params.valueId);
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

  const supabase = getSupabaseAdmin();

  try {
    const optionSetId = await ensureLink(supabase, productId, linkId);
    await ensureValue(optionSetId, valueId, supabase);

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
      const { error: deleteError } = await supabase
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

    const { error } = await supabase
      .from('product_option_value_overlays')
      .upsert(payload, { onConflict: 'link_id,option_set_value_id' });

    if (error) {
      console.error('[value-overlays] failed upserting overlay', error);
      return NextResponse.json({ error: 'Failed to update value overlay' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.message === 'LinkNotFound') {
      return NextResponse.json({ error: 'Option set link not found for product' }, { status: 404 });
    }
    if (error?.message === 'ValueNotFound') {
      return NextResponse.json({ error: 'Option value not part of option set' }, { status: 404 });
    }
    console.error('[value-overlays] unexpected error', error);
    return NextResponse.json({ error: 'Unexpected error while updating value overlay' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<RouteParams> }) {
  const params = await context.params;
  const productId = parseId(params.productId);
  const linkId = parseId(params.linkId);
  const valueId = parseId(params.valueId);
  if (!productId || !linkId || !valueId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    const optionSetId = await ensureLink(supabase, productId, linkId);
    await ensureValue(optionSetId, valueId, supabase);

    const { error } = await supabase
      .from('product_option_value_overlays')
      .delete()
      .eq('link_id', linkId)
      .eq('option_set_value_id', valueId);

    if (error) {
      console.error('[value-overlays] failed deleting overlay', error);
      return NextResponse.json({ error: 'Failed to delete value overlay' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.message === 'LinkNotFound') {
      return NextResponse.json({ error: 'Option set link not found for product' }, { status: 404 });
    }
    if (error?.message === 'ValueNotFound') {
      return NextResponse.json({ error: 'Option value not part of option set' }, { status: 404 });
    }
    console.error('[value-overlays] unexpected delete error', error);
    return NextResponse.json({ error: 'Unexpected error while deleting value overlay' }, { status: 500 });
  }
}
