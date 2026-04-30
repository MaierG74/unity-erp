import { NextRequest, NextResponse } from 'next/server';
import { getRouteClient } from '@/lib/supabase-route';

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

  const { data, error } = await auth.supabase
    .from('order_details')
    .select('order_detail_id, cutlist_material_snapshot')
    .eq('order_detail_id', detailIdNum)
    .eq('order_id', orderIdNum)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ cutlist_material_snapshot: data.cutlist_material_snapshot });
}

export async function PATCH(request: NextRequest, context: { params: Promise<RouteParams> }) {
  void request;
  void context;
  return NextResponse.json(
    { error: 'Raw cutlist snapshot PATCH is disabled; update line-level cutlist material fields instead.' },
    { status: 410 },
  );
}
