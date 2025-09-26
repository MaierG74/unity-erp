import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type RouteParams = {
  params: {
    orderId: string;
  };
};

function parseOrderId(orderId: string | undefined): number | null {
  if (!orderId) return null;
  const parsed = Number.parseInt(orderId, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  const orderId = parseOrderId(params?.orderId);
  if (!orderId) {
    return NextResponse.json({ error: 'Invalid order id' }, { status: 400 });
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    // Primary path: use the RPC
    const { data, error } = await supabaseAdmin.rpc('release_finished_goods', {
      p_order_id: orderId,
    });

    if (!error) {
      return NextResponse.json({ success: true, released: data ?? null });
    }

    // Fallback: directly delete rows (in case RPC is missing or signature drifted)
    console.warn('[release-fg] RPC failed; falling back to direct delete', error);
    const { count, error: delErr } = await supabaseAdmin
      .from('product_reservations')
      .delete({ count: 'exact' })
      .eq('order_id', orderId);

    if (delErr) {
      console.error('[release-fg] Fallback delete also failed', delErr);
      return NextResponse.json(
        { error: 'Failed to release finished goods' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, released: count ?? 0 });
  } catch (error) {
    console.error('[release-fg] Unexpected error', error);
    return NextResponse.json(
      { error: 'Unexpected error while releasing finished goods' },
      { status: 500 }
    );
  }
}
