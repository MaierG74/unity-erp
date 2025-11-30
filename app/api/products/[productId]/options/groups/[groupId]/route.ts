import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type RouteParams = {
  productId?: string;
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

export async function PATCH(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const params = await context.params;
  const productId = parseId(params.productId);
  const groupId = parseId(params.groupId);
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

  const supabase = getSupabaseAdmin();

  try {
    const { data, error } = await supabase
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
  const params = await context.params;
  const productId = parseId(params.productId);
  const groupId = parseId(params.groupId);
  if (!productId || !groupId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    const { error } = await supabase
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
