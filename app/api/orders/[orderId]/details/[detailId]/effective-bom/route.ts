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
    .select('order_detail_id, product_id, bom_snapshot')
    .eq('order_detail_id', detailIdNum)
    .eq('order_id', orderIdNum)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Order detail not found' }, { status: 404 });

  return NextResponse.json({ bom_snapshot: data.bom_snapshot ?? [] });
}
