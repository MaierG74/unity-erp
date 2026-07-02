import { NextRequest, NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/supabase-admin';
import { getRouteClient } from '@/lib/supabase-route';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const ctx = await getRouteClient(request);
    if ('error' in ctx) {
      return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
    }

    const { data: attachment, error: fetchError } = await ctx.supabase
      .from('purchase_order_attachments')
      .select('id, file_url, storage_bucket, storage_path')
      .eq('id', id)
      .single();

    if (fetchError || !attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    if (!attachment.storage_bucket || !attachment.storage_path) {
      return NextResponse.json({ url: attachment.file_url });
    }

    const { data, error } = await supabaseAdmin.storage
      .from(attachment.storage_bucket)
      .createSignedUrl(attachment.storage_path, 300);

    if (error || !data?.signedUrl) {
      console.error('Error signing PO attachment URL:', error);
      return NextResponse.json(
        { error: 'Failed to generate attachment URL' },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: data.signedUrl });
  } catch (error) {
    console.error('Error getting PO attachment URL:', error);
    return NextResponse.json(
      { error: 'Failed to get attachment URL' },
      { status: 500 }
    );
  }
}
