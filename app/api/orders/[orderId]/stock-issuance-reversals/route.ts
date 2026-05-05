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
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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
    console.error('[stock-issuance-reversals] Failed to validate order', orderError);
    return NextResponse.json({ error: 'Failed to validate order' }, { status: 500 });
  }

  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  const { data: issuances, error: issuanceError } = await supabaseAdmin
    .from('stock_issuances')
    .select('issuance_id')
    .eq('order_id', orderId);

  if (issuanceError) {
    console.error('[stock-issuance-reversals] Failed to load issuances', issuanceError);
    return NextResponse.json({ error: 'Failed to load stock issuances' }, { status: 500 });
  }

  const issuanceIds = (issuances ?? [])
    .map((issuance) => issuance.issuance_id)
    .filter((id): id is number => typeof id === 'number' && Number.isFinite(id));

  if (issuanceIds.length === 0) {
    return NextResponse.json({ reversals: [] });
  }

  const { data: reversals, error: reversalError } = await supabaseAdmin
    .from('stock_issuance_reversals')
    .select('issuance_id, quantity_reversed')
    .in('issuance_id', issuanceIds);

  if (reversalError) {
    console.error('[stock-issuance-reversals] Failed to load reversals', reversalError);
    return NextResponse.json({ error: 'Failed to load stock issuance reversals' }, { status: 500 });
  }

  return NextResponse.json({
    reversals: (reversals ?? []).map((reversal) => ({
      issuance_id: reversal.issuance_id,
      quantity_reversed: Number(reversal.quantity_reversed ?? 0),
    })),
  });
}
