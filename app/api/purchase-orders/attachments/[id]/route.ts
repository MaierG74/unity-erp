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

    // Delete the DB row first: FK references (e.g. purchase_order_invoices
    // invoice/pop attachment ids) block the delete here, BEFORE the object is
    // gone. Only then remove the storage object; a failed removal leaves
    // harmless orphaned bytes rather than metadata pointing at nothing.
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

    if (attachment.storage_bucket && attachment.storage_path) {
      const { error: storageError } = await supabaseAdmin.storage
        .from(attachment.storage_bucket)
        .remove([attachment.storage_path]);

      if (storageError) {
        // Row is gone; the object is orphaned garbage in a private bucket.
        console.error('Orphaned PO attachment object (row deleted, object removal failed):', storageError);
      }
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
