import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getRouteClient } from '@/lib/supabase-route';
import {
  getSwapSourceComponentId,
  hasDownstreamEvidence,
  probeDownstreamSwapState,
} from '@/lib/orders/downstream-swap-exceptions';
import type { BomSnapshotEntry } from '@/lib/orders/snapshot-types';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ orderId: string }> }
) {
  const routeClient = await getRouteClient(request);
  if ('error' in routeClient) {
    return NextResponse.json({ error: routeClient.error }, { status: routeClient.status ?? 401 });
  }

  const { orderId: orderIdParam } = await context.params;
  const orderId = Number.parseInt(orderIdParam, 10);
  if (!orderId || Number.isNaN(orderId)) {
    return NextResponse.json({ error: 'Invalid order id' }, { status: 400 });
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: allowedOrder, error: allowedErr } = await routeClient.supabase
    .from('orders')
    .select('order_id')
    .eq('order_id', orderId)
    .maybeSingle();

  if (allowedErr || !allowedOrder) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  const { data: details, error } = await supabaseAdmin
    .from('order_details')
    .select('order_detail_id, bom_snapshot')
    .eq('order_id', orderId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const entries = (details ?? []).flatMap((detail: any) => {
    if (!Array.isArray(detail.bom_snapshot)) return [];
    return (detail.bom_snapshot as BomSnapshotEntry[]).map((entry) => ({
      order_detail_id: detail.order_detail_id,
      source_bom_id: Number(entry.source_bom_id),
      source_component_id: getSwapSourceComponentId(entry),
    }));
  }).filter((entry) => entry.source_component_id);

  const uniqueSourceComponentIds = [...new Set(entries.map((entry) => entry.source_component_id as number))];
  const evidenceByComponentId = new Map<number, Awaited<ReturnType<typeof probeDownstreamSwapState>>>();

  for (const sourceComponentId of uniqueSourceComponentIds) {
    evidenceByComponentId.set(
      sourceComponentId,
      await probeDownstreamSwapState({
        supabase: supabaseAdmin,
        orderId,
        sourceComponentId,
      })
    );
  }

  return NextResponse.json({
    entries: entries.map((entry) => {
      const evidence = evidenceByComponentId.get(entry.source_component_id as number);
      return {
        order_detail_id: entry.order_detail_id,
        source_bom_id: entry.source_bom_id,
        has_downstream_activity: evidence ? hasDownstreamEvidence(evidence) : false,
        evidence,
      };
    }),
  });
}
