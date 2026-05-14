import { NextRequest, NextResponse } from 'next/server';

import { requireModuleAccess } from '@/lib/api/module-access';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { supabaseAdmin } from '@/lib/supabase-admin';

type RouteParams = {
  orderId: string;
  componentId: string;
};

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
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

type ReserveSingleRpcRow = {
  component_id?: number | null;
  qty_reserved?: number | string | null;
  qty_available?: number | string | null;
  qty_required?: number | string | null;
};

export async function POST(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await requireOrdersAccess(request);
  if ('error' in auth) return auth.error;

  const { orderId: orderIdParam, componentId: componentIdParam } = await context.params;
  const orderId = parsePositiveInt(orderIdParam);
  if (!orderId) {
    return NextResponse.json({ error: 'Invalid order id' }, { status: 400 });
  }
  const componentId = parsePositiveInt(componentIdParam);
  if (!componentId) {
    return NextResponse.json({ error: 'Invalid component id' }, { status: 400 });
  }

  // Order ownership: caller must belong to the org that owns this order.
  // Mirrors the pattern in /api/orders/[orderId]/reserve-components/route.ts.
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
    const { data, error } = await supabaseAdmin.rpc('reserve_order_component_single', {
      p_order_id: orderId,
      p_component_id: componentId,
      p_org_id: auth.orgId,
    });

    if (error) {
      console.error('[reserve-component] Failed to reserve component', error);
      return NextResponse.json(
        { error: 'Failed to reserve component' },
        { status: 500 }
      );
    }

    const rows = (data ?? []) as ReserveSingleRpcRow[];
    const row = rows[0] ?? {};

    const reservation = {
      component_id: row.component_id ?? componentId,
      qty_reserved: Number(row.qty_reserved ?? 0),
      qty_available: Number(row.qty_available ?? 0),
      qty_required: Number(row.qty_required ?? 0),
    };

    return NextResponse.json({ success: true, reservation });
  } catch (error: unknown) {
    console.error('[reserve-component] Unexpected error', error);
    return NextResponse.json(
      { error: 'Unexpected error while reserving component' },
      { status: 500 }
    );
  }
}
