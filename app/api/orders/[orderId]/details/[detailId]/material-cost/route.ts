import { NextRequest, NextResponse } from 'next/server';
import { getRouteClient } from '@/lib/supabase-route';
import { computePaddedLineCost } from '@/lib/orders/padded-line-cost';
import { pickLineMaterialCost } from '@/lib/orders/line-material-cost';
import {
  fetchProductCutlistCostingSnapshot,
  resolveCutlistCostingSnapshot,
} from '@/lib/orders/cutlist-costing-freeze';
import type { CuttingPlan } from '@/lib/orders/cutting-plan-types';

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
      .select('order_detail_id, order_id, product_id, quantity, bom_snapshot, cutlist_costing_snapshot')
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

  // Product "Save to Costing" is a template for future order lines. Existing
  // lines own their frozen costing basis; live product lookup is legacy fallback.
  let liveProductSnapshot: unknown = null;
  if (!detail.cutlist_costing_snapshot && detail.product_id != null) {
    try {
      liveProductSnapshot = await fetchProductCutlistCostingSnapshot(auth.supabase, detail.product_id);
    } catch (snapErr) {
      return NextResponse.json({ error: snapErr instanceof Error ? snapErr.message : String(snapErr) }, { status: 500 });
    }
  }
  const { snapshot } = resolveCutlistCostingSnapshot(
    detail.cutlist_costing_snapshot,
    liveProductSnapshot,
  );

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
