import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { z } from 'zod';

const paramSchema = z.object({
  id: z.string().uuid('quote_item_id must be a UUID'),
});

const payloadSchema = z.object({
  optionsHash: z.string().min(1).optional(),
  layout: z.unknown(),
  billingOverrides: z.unknown().optional(),
});

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const parsed = paramSchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid quote item id', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const quoteItemId = parsed.data.id;

  const { data, error } = await supabaseAdmin
    .from('quote_item_cutlists')
    .select('*')
    .eq('quote_item_id', quoteItemId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Failed to load cutlist snapshot', error);
    return NextResponse.json(
      { error: 'Failed to load cutlist snapshot', details: error.message },
      { status: 500 }
    );
  }

  if (!data) {
    return new NextResponse(null, { status: 204 });
  }

  return NextResponse.json({ cutlist: data });
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const parsedParams = paramSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json(
      { error: 'Invalid quote item id', details: parsedParams.error.flatten() },
      { status: 400 }
    );
  }

  const quoteItemId = parsedParams.data.id;

  const body = await request.json();
  const parsedBody = payloadSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsedBody.error.flatten() },
      { status: 400 }
    );
  }

  const { optionsHash, layout, billingOverrides } = parsedBody.data;

  const { data: quoteItem, error: quoteItemError } = await supabaseAdmin
    .from('quote_items')
    .select('id, quote_id')
    .eq('id', quoteItemId)
    .single();

  if (quoteItemError || !quoteItem) {
    return NextResponse.json(
      { error: 'Quote item not found or access denied' },
      { status: 404 }
    );
  }

  const payload = {
    quote_item_id: quoteItemId,
    options_hash: optionsHash ?? null,
    layout_json: layout,
    billing_overrides: billingOverrides ?? null,
  } as const;

  const { data, error } = await supabaseAdmin
    .from('quote_item_cutlists')
    .upsert(payload, { onConflict: 'quote_item_id' })
    .select('*')
    .single();

  if (error) {
    console.error('Failed to save cutlist snapshot', error);
    return NextResponse.json(
      { error: 'Failed to save cutlist snapshot', details: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ cutlist: data });
}
