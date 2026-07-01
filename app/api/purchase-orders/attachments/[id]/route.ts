import { NextRequest, NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/supabase-admin';
import { getRouteClient } from '@/lib/supabase-route';

export async function DELETE(
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
      .select('id, storage_bucket, storage_path')
      .eq('id', id)
      .single();

    if (fetchError || !attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    if (attachment.storage_bucket && attachment.storage_path) {
      const { error: storageError } = await supabaseAdmin.storage
        .from(attachment.storage_bucket)
        .remove([attachment.storage_path]);

      if (storageError) {
        console.error('Error deleting PO attachment object:', storageError);
        return NextResponse.json(
          { error: 'Failed to delete attachment file' },
          { status: 500 }
        );
      }
    }

    const { error: deleteError } = await ctx.supabase
      .from('purchase_order_attachments')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('Error deleting PO attachment row:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete attachment' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting PO attachment:', error);
    return NextResponse.json(
      { error: 'Failed to delete attachment' },
      { status: 500 }
    );
  }
}
