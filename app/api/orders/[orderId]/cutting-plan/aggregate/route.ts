import { NextRequest, NextResponse } from 'next/server';
import { getRouteClient } from '@/lib/supabase-route';
import { computeSourceRevision } from '@/lib/orders/cutting-plan-utils';
import type { MaterialAssignments } from '@/lib/orders/material-assignment-types';
import {
  resolveAggregatedGroups,
  type AggregateDetail,
} from '@/lib/orders/cutting-plan-aggregate';
import type { AggregateResponse } from '@/lib/orders/cutting-plan-types';

type RouteParams = { orderId: string };

export async function GET(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await getRouteClient(request);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { orderId } = await context.params;
  const orderIdNum = Number(orderId);
  if (!Number.isFinite(orderIdNum) || orderIdNum <= 0) {
    return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
  }

  const [detailsRes, orderRes] = await Promise.all([
    auth.supabase
      .from('order_details')
      .select('order_detail_id, product_id, quantity, cutlist_snapshot, products(name)')
      .eq('order_id', orderIdNum),
    auth.supabase
      .from('orders')
      .select('material_assignments')
      .eq('order_id', orderIdNum)
      .maybeSingle(),
  ]);

  const { data: details, error } = detailsRes;
  const assignments = (orderRes.data?.material_assignments as MaterialAssignments | null) ?? null;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (orderRes.error) return NextResponse.json({ error: orderRes.error.message }, { status: 500 });
  if (!details || details.length === 0) {
    return NextResponse.json({ error: 'No order details found' }, { status: 404 });
  }

  const sourceRevision = computeSourceRevision(
    details.map((d) => ({
      order_detail_id: d.order_detail_id,
      quantity: d.quantity ?? 1,
      cutlist_snapshot: d.cutlist_snapshot,
    }))
  );

  const aggregateDetails: AggregateDetail[] = details.map((d) => ({
    order_detail_id: d.order_detail_id,
    quantity: d.quantity,
    cutlist_snapshot: d.cutlist_snapshot ?? null,
    product_name: (d.products as any)?.name ?? '',
  }));

  const { material_groups, total_parts, has_cutlist_items } = resolveAggregatedGroups(
    aggregateDetails,
    assignments,
  );

  const response: AggregateResponse = {
    order_id: orderIdNum,
    source_revision: sourceRevision,
    material_groups,
    total_parts,
    has_cutlist_items,
  };

  return NextResponse.json(response);
}
