import { NextRequest, NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/api/module-access';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { computeSourceRevision } from '@/lib/orders/cutting-plan-utils';
import type { CuttingPlan } from '@/lib/orders/cutting-plan-types';

type RouteParams = { orderId: string };

function parseOrderId(orderId: string): number | null {
  const parsed = Number.parseInt(orderId, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function PUT(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const access = await requireModuleAccess(request, MODULE_KEYS.ORDERS_FULFILLMENT);
  if ('error' in access) return access.error;
  if (!access.orgId) {
    return NextResponse.json({ error: 'Organization context required' }, { status: 403 });
  }

  const { orderId: orderIdParam } = await context.params;
  const orderId = parseOrderId(orderIdParam);
  if (!orderId) return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });

  let body: CuttingPlan;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.source_revision || !Array.isArray(body.material_groups)) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Verify source revision — reject if order details changed since aggregation
  const { data: details, error: detailsError } = await supabaseAdmin
    .from('order_details')
    .select('order_detail_id, quantity, cutlist_snapshot')
    .eq('order_id', orderId);

  if (detailsError) {
    return NextResponse.json({ error: 'Failed to verify order state' }, { status: 500 });
  }

  const currentRevision = computeSourceRevision(
    (details ?? []).map((d) => ({
      order_detail_id: d.order_detail_id,
      quantity: d.quantity ?? 1,
      cutlist_snapshot: d.cutlist_snapshot,
    }))
  );

  if (currentRevision !== body.source_revision) {
    return NextResponse.json(
      {
        error: 'Order has changed since cutting plan was generated. Please re-aggregate.',
        code: 'REVISION_MISMATCH',
        current_revision: currentRevision,
      },
      { status: 409 }
    );
  }

  // Persist with stale = false
  const planToSave: CuttingPlan = { ...body, stale: false };

  const { error: updateError } = await supabaseAdmin
    .from('orders')
    .update({ cutting_plan: planToSave })
    .eq('order_id', orderId)
    .eq('org_id', access.orgId);

  if (updateError) {
    return NextResponse.json({ error: 'Failed to save cutting plan' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const access = await requireModuleAccess(request, MODULE_KEYS.ORDERS_FULFILLMENT);
  if ('error' in access) return access.error;
  if (!access.orgId) {
    return NextResponse.json({ error: 'Organization context required' }, { status: 403 });
  }

  const { orderId: orderIdParam } = await context.params;
  const orderId = parseOrderId(orderIdParam);
  if (!orderId) return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('orders')
    .update({ cutting_plan: null })
    .eq('order_id', orderId)
    .eq('org_id', access.orgId);

  if (error) {
    return NextResponse.json({ error: 'Failed to clear cutting plan' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
