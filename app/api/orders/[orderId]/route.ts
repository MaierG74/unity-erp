import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function extractStoragePathFromPublicUrl(url: string): { bucket: string; path: string } | null {
  try {
    const marker = '/object/public/';
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    const after = url.substring(idx + marker.length);
    const [bucket, ...rest] = after.split('/');
    return { bucket, path: rest.join('/') };
  } catch {
    return null;
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { orderId: string } }
) {
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const orderId = parseInt(params.orderId, 10);
  if (!orderId || Number.isNaN(orderId)) {
    return NextResponse.json({ error: 'Invalid order id' }, { status: 400 });
  }

  try {
    // Fetch attachments to remove from storage
    const { data: attachments, error: attErr } = await supabaseAdmin
      .from('order_attachments')
      .select('file_url')
      .eq('order_id', orderId);
    if (attErr) {
      console.warn('[DELETE /orders] failed to list attachments', attErr);
    }

    // Attempt to remove storage objects derived from public URLs
    if (attachments && attachments.length > 0) {
      for (const att of attachments) {
        const info = att?.file_url ? extractStoragePathFromPublicUrl(att.file_url) : null;
        if (info && info.bucket && info.path) {
          try {
            await supabaseAdmin.storage.from(info.bucket).remove([info.path]);
          } catch (e) {
            console.warn('[DELETE /orders] storage remove failed for', info.path, e);
          }
        }
      }
    }

    // Delete attachment rows
    await supabaseAdmin.from('order_attachments').delete().eq('order_id', orderId);

    // Delete supplier junction links
    await supabaseAdmin
      .from('supplier_order_customer_orders')
      .delete()
      .eq('order_id', orderId);

    // Delete order details
    await supabaseAdmin.from('order_details').delete().eq('order_id', orderId);

    // Finally, delete the order header
    const { error: delErr } = await supabaseAdmin
      .from('orders')
      .delete()
      .eq('order_id', orderId);
    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error('[DELETE /orders] unexpected error', e);
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}


