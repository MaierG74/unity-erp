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

type ConsumeFgRpcRow = {
  product_id?: number | null;
  qty_consumed?: number | string | null;
  consumed_quantity?: number | string | null;
  quantity?: number | string | null;
};

export async function POST(request: NextRequest, context: { params: Promise<RouteParams> }) {
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
    const { data, error } = await supabaseAdmin.rpc('consume_finished_goods', {
      p_order_id: orderId,
    });

    if (error) {
      console.error('[consume-fg] Failed to consume finished goods', error);
      return NextResponse.json(
        { error: 'Failed to consume finished goods' },
        { status: 500 }
      );
    }

    const consumed = ((data ?? []) as ConsumeFgRpcRow[]).map((row) => ({
      product_id: row.product_id,
      consumed_quantity: Number(
        row.qty_consumed ??
          row.consumed_quantity ??
          row.quantity ??
          0
      ),
    }));

    return NextResponse.json({ success: true, consumed });
  } catch (error: unknown) {
    console.error('[consume-fg] Unexpected error', error);
    return NextResponse.json(
      { error: 'Unexpected error while consuming finished goods' },
      { status: 500 }
    );
  }
}
