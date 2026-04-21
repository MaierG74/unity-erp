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

  // 1. Fetch the order detail + its product id and bom snapshot (scoped to order_id for auth)
  const { data: detail, error: detailErr } = await auth.supabase
    .from('order_details')
    .select('order_detail_id, order_id, product_id, quantity, bom_snapshot')
    .eq('order_detail_id', detailIdNum)
    .eq('order_id', orderIdNum)
    .maybeSingle();

  if (detailErr) return NextResponse.json({ error: detailErr.message }, { status: 500 });
  if (!detail) return NextResponse.json({ error: 'Order detail not found' }, { status: 404 });

  // 2. Fetch the order's cutting_plan (may be null)
  const { data: order, error: orderErr } = await auth.supabase
    .from('orders')
    .select('cutting_plan')
    .eq('order_id', orderIdNum)
    .maybeSingle();

  if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 });
  const cutting_plan: CuttingPlan | null = (order?.cutting_plan as CuttingPlan) ?? null;

  // 3. Fetch the product's cutlist snapshot (may be null for non-cutlist products)
  let snapshot: CutlistCostingSnapshot | null = null;
  if (detail.product_id != null) {
    const { data: snap } = await auth.supabase
      .from('product_cutlist_costing_snapshots')
      .select('snapshot_data')
      .eq('product_id', detail.product_id)
      .maybeSingle();
    if (snap?.snapshot_data) {
      snapshot = snap.snapshot_data as CutlistCostingSnapshot;
    }
  }

  // 4. Compute padded baseline
  const padded = computePaddedLineCost({
    quantity: detail.quantity ?? 1,
    snapshot,
    bom_snapshot: Array.isArray(detail.bom_snapshot) ? detail.bom_snapshot : [],
  });

  // 5. Branch on cutting plan
  const result = pickLineMaterialCost({
    order_detail_id: detailIdNum,
    cutting_plan,
    padded,
  });

  return NextResponse.json(result);
}
