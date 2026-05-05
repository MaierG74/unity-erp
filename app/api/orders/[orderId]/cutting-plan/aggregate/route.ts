import { NextRequest, NextResponse } from 'next/server';
import { getRouteClient } from '@/lib/supabase-route';
import { computeSourceRevision } from '@/lib/orders/cutting-plan-utils';
import type { MaterialAssignments } from '@/lib/orders/material-assignment-types';
import {
  resolveAggregatedGroups,
  type AggregateDetail,
  type BackerLookupEntry,
} from '@/lib/orders/cutting-plan-aggregate';
import type { AggregateResponse, BackerThicknessInvalidEntry } from '@/lib/orders/cutting-plan-types';
import { parseThicknessFromDescription } from '@/lib/cutlist/boardCalculator';

type RouteParams = { orderId: string };

const BACKER_CATEGORY_IDS = [75, 3];
const BACKER_CATEGORY_SET = new Set(BACKER_CATEGORY_IDS);

function collectBackerIds(details: AggregateDetail[], assignments: MaterialAssignments | null): number[] {
  const ids = new Set<number>();
  if (
    assignments?.backer_default != null &&
    typeof assignments.backer_default === 'object' &&
    typeof (assignments.backer_default as { component_id?: unknown }).component_id === 'number'
  ) {
    ids.add(assignments.backer_default.component_id);
  }

  for (const detail of details) {
    const groups = Array.isArray(detail.cutlist_material_snapshot) ? detail.cutlist_material_snapshot : [];
    for (const group of groups) {
      if (!group.board_type?.endsWith('-backer')) continue;
      if (typeof group.effective_backer_id === 'number') ids.add(group.effective_backer_id);
      if (typeof group.backer_material_id === 'number') ids.add(group.backer_material_id);
    }
  }

  return Array.from(ids);
}

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
      .select('order_detail_id, product_id, quantity, cutlist_material_snapshot, cutlist_primary_material_id, cutlist_primary_backer_material_id, cutlist_primary_edging_id, cutlist_part_overrides, products(name)')
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
      cutlist_material_snapshot: d.cutlist_material_snapshot,
    })),
    assignments,
  );

  const aggregateDetails: AggregateDetail[] = details.map((d) => ({
    order_detail_id: d.order_detail_id,
    quantity: d.quantity,
    cutlist_material_snapshot: d.cutlist_material_snapshot ?? null,
    product_name: (d.products as any)?.name ?? '',
  }));

  const referencedBackerIds = collectBackerIds(aggregateDetails, assignments);
  const backerLookup = new Map<number, BackerLookupEntry>();
  if (referencedBackerIds.length > 0) {
    const { data: components, error: componentsError } = await auth.supabase
      .from('components')
      .select('component_id, description, category_id')
      .in('component_id', referencedBackerIds);

    if (componentsError) return NextResponse.json({ error: componentsError.message }, { status: 500 });

    const returnedIds = new Set((components ?? []).map((component) => component.component_id));
    const missing = referencedBackerIds.filter((id) => !returnedIds.has(id));
    if (missing.length > 0) {
      return NextResponse.json(
        { ok: false, error: 'BACKER_COMPONENT_NOT_FOUND', missing_component_ids: missing },
        { status: 400 },
      );
    }

    const invalid: BackerThicknessInvalidEntry[] = [];
    for (const component of components ?? []) {
      const parsed = parseThicknessFromDescription(component.description ?? '');
      const componentId = component.component_id;
      if (!BACKER_CATEGORY_SET.has(component.category_id)) {
        invalid.push({ component_id: componentId, parsed_value: parsed, reason: 'wrong_category' as const });
        continue;
      }
      if (parsed == null) {
        invalid.push({ component_id: componentId, parsed_value: null, reason: 'null' as const });
        continue;
      }
      if (parsed < 0.5 || parsed > 50) {
        invalid.push({ component_id: componentId, parsed_value: parsed, reason: 'out_of_range' as const });
        continue;
      }
      backerLookup.set(componentId, {
        thickness_mm: parsed,
        category_id: component.category_id,
        component_name: component.description ?? null,
      });
    }

    if (invalid.length > 0) {
      return NextResponse.json(
        { ok: false, error: 'BACKER_THICKNESS_INVALID', invalid },
        { status: 400 },
      );
    }
  }

  const aggregateResult = resolveAggregatedGroups(
    aggregateDetails,
    assignments,
    backerLookup,
  );
  if (!aggregateResult.ok) {
    return NextResponse.json(aggregateResult, { status: 400 });
  }

  const { material_groups, total_parts, has_cutlist_items } = aggregateResult;

  const response: AggregateResponse = {
    order_id: orderIdNum,
    source_revision: sourceRevision,
    material_groups,
    total_parts,
    has_cutlist_items,
  };

  return NextResponse.json(response);
}
