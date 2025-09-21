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
    const { data, error } = await supabaseAdmin.rpc('reserve_finished_goods', {
      p_order_id: orderId,
    });

    if (error) {
      console.error('[reserve-fg] Failed to reserve finished goods', error);
      return NextResponse.json(
        { error: 'Failed to reserve finished goods' },
        { status: 500 }
      );
    }

    const reservations = (data ?? []).map((row: any) => ({
      product_id: row?.product_id,
      reserved_quantity: Number(
        row?.reserved_quantity ??
          row?.qty_reserved ??
          row?.quantity_reserved ??
          row?.quantity ??
          0
      ),
    }));

    return NextResponse.json(
      { success: true, reservations },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('[reserve-fg] Unexpected error', error);
    return NextResponse.json(
      { error: 'Unexpected error while reserving finished goods' },
      { status: 500 }
    );
  }
}
