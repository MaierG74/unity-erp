import { NextRequest, NextResponse } from 'next/server';

import { requireModuleAccess } from '@/lib/api/module-access';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { supabaseAdmin } from '@/lib/supabase-admin';

type RouteParams = {
  orderId: string;
};

function parseOrderId(orderId: string | undefined): number | null {
  if (!orderId) return null;
  const parsed = Number.parseInt(orderId, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

async function requireOrdersAccess(request: NextRequest) {
  const access = await requireModuleAccess(request, MODULE_KEYS.ORDERS_FULFILLMENT, {
    forbiddenMessage: 'Orders module access is disabled for your organization',
  });
  if ('error' in access) {
    return { error: access.error };
  }

  if (!access.orgId) {
    return {
      error: NextResponse.json(
        {
          error: 'Organization context is required for orders access',
          reason: 'missing_org_context',
          module_key: access.moduleKey,
        },
        { status: 403 }
      ),
    };
  }

  return { orgId: access.orgId };
}

type ReservationRow = {
  order_id?: number | null;
  product_id?: number | null;
  reserved_quantity?: number | string | null;
  qty_reserved?: number | string | null;
  quantity_reserved?: number | string | null;
  quantity?: number | string | null;
  available_quantity?: number | string | null;
  created_at?: string | null;
};

type ProductRow = {
  product_id?: number | null;
  name?: string | null;
  internal_code?: string | null;
};

export async function GET(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await requireOrdersAccess(request);
  if ('error' in auth) return auth.error;

  const { orderId: orderIdParam } = await context.params;
  const orderId = parseOrderId(orderIdParam);
  if (!orderId) {
    return NextResponse.json({ error: 'Invalid order id' }, { status: 400 });
  }

  const { data: order, error: orderError } = await supabaseAdmin
    .from('orders')
    .select('order_id')
    .eq('order_id', orderId)
    .eq('org_id', auth.orgId)
    .maybeSingle();
  if (orderError) {
    return NextResponse.json({ error: 'Failed to validate order' }, { status: 500 });
  }
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  try {
    const { data: reservationRows, error: reservationError } = await supabaseAdmin
      .from('product_reservations')
      .select('*')
      .eq('order_id', orderId)
      .eq('org_id', auth.orgId)
      .order('created_at', { ascending: false });

    if (reservationError) {
      console.error('[fg-reservations] Failed to load reservations', reservationError);
      return NextResponse.json(
        { error: 'Failed to load finished-good reservations' },
        { status: 500 }
      );
    }

    const reservations = ((reservationRows ?? []) as ReservationRow[]).map((row) => ({
      order_id: row.order_id ?? orderId,
      product_id: row.product_id ?? null,
      reserved_quantity: Number(
        row.reserved_quantity ??
        row.qty_reserved ??
        row.quantity_reserved ??
        row.quantity ??
        0
      ),
      available_quantity: row.available_quantity ?? null,
      updated_at: row.created_at ?? null,
    }));

    const productIds = Array.from(
      new Set(reservations.map(res => res.product_id).filter((id): id is number => typeof id === 'number'))
    );

    let productMap: Record<number, { name: string; internal_code: string | null }> = {};
    if (productIds.length > 0) {
      const { data: productRows, error: productError } = await supabaseAdmin
        .from('products')
        .select('product_id, name, internal_code')
        .in('product_id', productIds)
        .eq('org_id', auth.orgId);

      if (productError) {
        console.warn('[fg-reservations] Failed to load product info', productError);
      } else if (productRows) {
        productMap = (productRows as ProductRow[]).reduce((acc: typeof productMap, product) => {
          if (typeof product.product_id === 'number') {
            acc[product.product_id] = {
              name: product.name ?? '',
              internal_code: product.internal_code ?? null,
            };
          }
          return acc;
        }, {} as typeof productMap);
      }
    }

    const enriched = reservations.map((reservation) => {
      const productInfo =
        typeof reservation.product_id === 'number'
          ? productMap[reservation.product_id]
          : undefined;
      return {
        ...reservation,
        product_name: productInfo?.name ?? null,
        product_internal_code: productInfo?.internal_code ?? null,
      };
    });

    return NextResponse.json({ reservations: enriched });
  } catch (error: unknown) {
    console.error('[fg-reservations] Unexpected error', error);
    return NextResponse.json(
      { error: 'Unexpected error while loading finished-good reservations' },
      { status: 500 }
    );
  }
}
