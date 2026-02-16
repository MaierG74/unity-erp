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
      .eq('order_id', orderId)
      .eq('org_id', auth.orgId);

    if (delErr) {
      console.error('[release-fg] Fallback delete also failed', delErr);
      return NextResponse.json(
        { error: 'Failed to release finished goods' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, released: count ?? 0 });
  } catch (error: unknown) {
    console.error('[release-fg] Unexpected error', error);
    return NextResponse.json(
      { error: 'Unexpected error while releasing finished goods' },
      { status: 500 }
    );
  }
}
