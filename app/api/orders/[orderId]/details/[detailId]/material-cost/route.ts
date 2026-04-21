import { NextRequest, NextResponse } from 'next/server';
import { getRouteClient } from '@/lib/supabase-route';
import { computePaddedLineCost } from '@/lib/orders/padded-line-cost';
import { pickLineMaterialCost } from '@/lib/orders/line-material-cost';
import type { CuttingPlan } from '@/lib/orders/cutting-plan-types';
import type { CutlistCostingSnapshot } from '@/lib/cutlist/costingSnapshot';

type RouteParams = { orderId: string; detailId: string };

export async function GET(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await getRouteClient(request);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { orderId, detailId } = await context.params;
  const orderIdNum = Number(orderId);
  const detailIdNum = Number(detailId);
  if (!Number.isFinite(orderIdNum) || orderIdNum <= 0 || !Number.isFinite(detailIdNum) || detailIdNum <= 0) {
    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
  }

  // Phase 1: detail + order in parallel (both only need the URL params).
  const [detailRes, orderRes] = await Promise.all([
    auth.supabase
      .from('order_details')
      .select('order_detail_id, order_id, product_id, quantity, bom_snapshot')
      .eq('order_detail_id', detailIdNum)
      .eq('order_id', orderIdNum)
      .maybeSingle(),
    auth.supabase
      .from('orders')
      .select('cutting_plan')
      .eq('order_id', orderIdNum)
      .maybeSingle(),
  ]);

  if (detailRes.error) return NextResponse.json({ error: detailRes.error.message }, { status: 500 });
  if (!detailRes.data) return NextResponse.json({ error: 'Order detail not found' }, { status: 404 });
  if (orderRes.error) return NextResponse.json({ error: orderRes.error.message }, { status: 500 });

  const detail = detailRes.data;
  // `order` may be null if RLS hides the parent row even though the detail is visible
  // (policies can diverge between tables). Gracefully degrade to no-plan.
  const cutting_plan: CuttingPlan | null = (orderRes.data?.cutting_plan as CuttingPlan) ?? null;

  // Phase 2: snapshot depends on product_id. A real PostgREST error must bail with 500 —
  // silently falling through to a padded result would produce materially incorrect costs.
  let snapshot: CutlistCostingSnapshot | null = null;
  if (detail.product_id != null) {
    const { data: snap, error: snapErr } = await auth.supabase
      .from('product_cutlist_costing_snapshots')
      .select('snapshot_data')
      .eq('product_id', detail.product_id)
      .maybeSingle();
    if (snapErr) return NextResponse.json({ error: snapErr.message }, { status: 500 });
    if (snap?.snapshot_data) {
      snapshot = snap.snapshot_data as CutlistCostingSnapshot;
    }
  }

  const padded = computePaddedLineCost({
    quantity: detail.quantity ?? 1,
    snapshot,
    bom_snapshot: Array.isArray(detail.bom_snapshot) ? detail.bom_snapshot : [],
  });

  const result = pickLineMaterialCost({
    order_detail_id: detailIdNum,
    cutting_plan,
    padded,
  });

  return NextResponse.json(result);
}
