import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
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

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const orderId = parseOrderId(params?.orderId);
  if (!orderId) {
    return NextResponse.json({ error: 'Invalid order id' }, { status: 400 });
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    const { data: reservationRows, error: reservationError } = await supabaseAdmin
      .from('product_reservations')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false });

    if (reservationError) {
      console.error('[fg-reservations] Failed to load reservations', reservationError);
      return NextResponse.json(
        { error: 'Failed to load finished-good reservations' },
        { status: 500 }
      );
    }

    const reservations = (reservationRows ?? []).map((row: any) => ({
      order_id: row?.order_id ?? orderId,
      product_id: row?.product_id,
      reserved_quantity: Number(
        row?.reserved_quantity ??
        row?.qty_reserved ??
        row?.quantity_reserved ??
        row?.quantity ??
        0
      ),
      available_quantity: row?.available_quantity ?? null,
      updated_at: row?.created_at ?? null,
    }));

    const productIds = Array.from(
      new Set(reservations.map(res => res.product_id).filter((id): id is number => typeof id === 'number'))
    );

    let productMap: Record<number, { name: string; internal_code: string | null }> = {};
    if (productIds.length > 0) {
      const { data: productRows, error: productError } = await supabaseAdmin
        .from('products')
        .select('product_id, name, internal_code')
        .in('product_id', productIds);

      if (productError) {
        console.warn('[fg-reservations] Failed to load product info', productError);
      } else if (productRows) {
        productMap = productRows.reduce((acc: typeof productMap, product: any) => {
          if (product?.product_id) {
            acc[product.product_id] = {
              name: product?.name ?? '',
              internal_code: product?.internal_code ?? null,
            };
          }
          return acc;
        }, {} as typeof productMap);
      }
    }

    const enriched = reservations.map(reservation => ({
      ...reservation,
      product_name: productMap[reservation.product_id]?.name ?? null,
      product_internal_code: productMap[reservation.product_id]?.internal_code ?? null,
    }));

    return NextResponse.json(
      { reservations: enriched },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('[fg-reservations] Unexpected error', error);
    return NextResponse.json(
      { error: 'Unexpected error while loading finished-good reservations' },
      { status: 500 }
    );
  }
}
