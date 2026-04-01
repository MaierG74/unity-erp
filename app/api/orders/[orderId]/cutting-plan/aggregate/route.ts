import { NextRequest, NextResponse } from 'next/server';
import { getRouteClient } from '@/lib/supabase-route';
import { computeSourceRevision } from '@/lib/orders/cutting-plan-utils';
import type {
  AggregatedPart,
  AggregatedPartGroup,
  AggregateResponse,
} from '@/lib/orders/cutting-plan-types';

type RouteParams = { orderId: string };

type SnapshotPart = {
  id: string;
  name: string;
  grain: string;
  quantity: number;
  width_mm: number;
  length_mm: number;
  band_edges: Record<string, boolean>;
  lamination_type: string;
  lamination_config?: unknown;
  material_thickness?: number;
  edging_material_id?: string;
  material_label?: string;
};

type SnapshotGroup = {
  source_group_id: number;
  name: string;
  board_type: string;
  primary_material_id: number | null;
  primary_material_name: string | null;
  backer_material_id: number | null;
  backer_material_name: string | null;
  parts: SnapshotPart[];
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

  // Three-part grouping key: board_type + primary_material_id + backer_material_id
  const groupMap = new Map<string, AggregatedPartGroup>();
  let totalParts = 0;
  let hasCutlistItems = false;

  for (const detail of details) {
    const groups: SnapshotGroup[] = detail.cutlist_snapshot ?? [];
    if (groups.length === 0) continue;
    hasCutlistItems = true;

    const lineQty = detail.quantity ?? 1;
    const productName = (detail.products as any)?.name ?? '';

    for (const group of groups) {
      const key = `${group.board_type}|${group.primary_material_id ?? 'none'}|${group.backer_material_id ?? 'none'}`;

      if (!groupMap.has(key)) {
        groupMap.set(key, {
          board_type: group.board_type,
          primary_material_id: group.primary_material_id,
          primary_material_name: group.primary_material_name,
          backer_material_id: group.backer_material_id,
          backer_material_name: group.backer_material_name,
          parts: [],
        });
      }

      const target = groupMap.get(key)!;
      for (const part of group.parts) {
        const aggregatedPart: AggregatedPart = {
          id: `${detail.order_detail_id}-${part.id}`,
          original_id: part.id,
          order_detail_id: detail.order_detail_id,
          product_name: productName,
          name: part.name,
          grain: part.grain,
          quantity: part.quantity * lineQty,
          width_mm: part.width_mm,
          length_mm: part.length_mm,
          band_edges: part.band_edges,
          lamination_type: part.lamination_type,
          lamination_config: part.lamination_config,
          material_thickness: part.material_thickness,
          edging_material_id: part.edging_material_id,
          material_label: part.material_label,
        };
        target.parts.push(aggregatedPart);
        totalParts++;
      }
    }
  }

  const response: AggregateResponse = {
    order_id: orderIdNum,
    source_revision: sourceRevision,
    material_groups: Array.from(groupMap.values()),
    total_parts: totalParts,
    has_cutlist_items: hasCutlistItems,
  };

  return NextResponse.json(response);
}
