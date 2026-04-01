import { NextRequest, NextResponse } from 'next/server';
import { getRouteClient } from '@/lib/supabase-route';

type RouteParams = { orderId: string };

type CutlistSnapshotPart = {
  id: string;
  name: string;
  grain: string;
  quantity: number;
  width_mm: number;
  length_mm: number;
  band_edges: Record<string, boolean>;
  lamination_type: string;
  material_label?: string;
};

type CutlistSnapshotGroup = {
  source_group_id: number;
  name: string;
  board_type: string;
  primary_material_id: number | null;
  primary_material_name: string | null;
  backer_material_id: number | null;
  backer_material_name: string | null;
  parts: CutlistSnapshotPart[];
};

type AggregatedPart = CutlistSnapshotPart & {
  product_name: string;
  order_detail_id: number;
};

type MaterialGroup = {
  board_type: string;
  material_id: number | null;
  material_name: string | null;
  parts: AggregatedPart[];
};

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

  const { data: details, error } = await auth.supabase
    .from('order_details')
    .select('order_detail_id, product_id, quantity, cutlist_snapshot, products(name)')
    .eq('order_id', orderIdNum);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const groupMap = new Map<string, MaterialGroup>();

  for (const detail of details ?? []) {
    const groups: CutlistSnapshotGroup[] = detail.cutlist_snapshot ?? [];
    const lineQty = detail.quantity ?? 1;
    const productName = (detail.products as any)?.name ?? '';

    for (const group of groups) {
      const key = `${group.board_type}|${group.primary_material_id ?? 'none'}`;

      if (!groupMap.has(key)) {
        groupMap.set(key, {
          board_type: group.board_type,
          material_id: group.primary_material_id,
          material_name: group.primary_material_name,
          parts: [],
        });
      }

      const target = groupMap.get(key)!;
      for (const part of group.parts) {
        target.parts.push({
          ...part,
          quantity: part.quantity * lineQty,
          product_name: productName,
          order_detail_id: detail.order_detail_id,
        });
      }
    }
  }

  return NextResponse.json({
    order_id: orderIdNum,
    material_groups: Array.from(groupMap.values()),
    total_parts: Array.from(groupMap.values()).reduce((sum, g) => sum + g.parts.length, 0),
  });
}
