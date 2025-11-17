import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type RouteParams = {
  productId?: string;
  linkId?: string;
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

async function ensureLinkBelongsToProduct(client: any, productId: number, linkId: number) {
  const { data, error } = await client
    .from('product_option_set_links')
    .select('product_id')
    .eq('link_id', linkId)
    .single();

  const record = data as any;

  if (error || !record || Number(record.product_id) !== productId) {
    throw new Error('Not found');
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const params = await context.params;
  const productId = parseId(params.productId);
  const linkId = parseId(params.linkId);
  if (!productId || !linkId) {
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
  if (typeof payload.display_order === 'number' && Number.isFinite(payload.display_order)) {
    updates.display_order = payload.display_order;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields provided to update' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    await ensureLinkBelongsToProduct(supabase, productId, linkId);

    const { error } = await supabase
      .from('product_option_set_links')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('link_id', linkId);

    if (error) {
      console.error('[product-option-sets] failed updating link', error);
      return NextResponse.json({ error: 'Failed to update option set link' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.message === 'Not found') {
      return NextResponse.json({ error: 'Option set link not found for product' }, { status: 404 });
    }
    console.error('[product-option-sets] unexpected update error', error);
    return NextResponse.json({ error: 'Unexpected error while updating option set link' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<RouteParams> }) {
  const params = await context.params;
  const productId = parseId(params.productId);
  const linkId = parseId(params.linkId);
  if (!productId || !linkId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    await ensureLinkBelongsToProduct(supabase, productId, linkId);

    const { error } = await supabase
      .from('product_option_set_links')
      .delete()
      .eq('link_id', linkId);

    if (error) {
      console.error('[product-option-sets] failed detaching set', error);
      return NextResponse.json({ error: 'Failed to detach option set from product' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.message === 'Not found') {
      return NextResponse.json({ error: 'Option set link not found for product' }, { status: 404 });
    }
    console.error('[product-option-sets] unexpected delete error', error);
    return NextResponse.json({ error: 'Unexpected error while detaching option set' }, { status: 500 });
  }
}
