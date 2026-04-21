import { NextRequest, NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/api/module-access';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { computeSourceRevision } from '@/lib/orders/cutting-plan-utils';
import type { CuttingPlan } from '@/lib/orders/cutting-plan-types';
import { allocateLinesByArea, type LineAllocationInput } from '@/lib/orders/line-allocation';

type RouteParams = { orderId: string };

function parseOrderId(orderId: string): number | null {
  const parsed = Number.parseInt(orderId, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function PUT(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const access = await requireModuleAccess(request, MODULE_KEYS.ORDERS_FULFILLMENT);
  if ('error' in access) return access.error;
  if (!access.orgId) {
    return NextResponse.json({ error: 'Organization context required' }, { status: 403 });
  }

  const { orderId: orderIdParam } = await context.params;
  const orderId = parseOrderId(orderIdParam);
  if (!orderId) return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });

  let body: CuttingPlan;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.source_revision || !Array.isArray(body.material_groups)) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  // total_nested_cost and line_allocations are server-computed; client values are ignored.

  // Verify source revision — reject if order details changed since aggregation
  const { data: details, error: detailsError } = await supabaseAdmin
    .from('order_details')
    .select('order_detail_id, quantity, cutlist_snapshot')
    .eq('order_id', orderId);

  if (detailsError) {
    return NextResponse.json({ error: 'Failed to verify order state' }, { status: 500 });
  }

  const currentRevision = computeSourceRevision(
    (details ?? []).map((d) => ({
      order_detail_id: d.order_detail_id,
      quantity: d.quantity ?? 1,
      cutlist_snapshot: d.cutlist_snapshot,
    }))
  );

  if (currentRevision !== body.source_revision) {
    return NextResponse.json(
      {
        error: 'Order has changed since cutting plan was generated. Please re-aggregate.',
        code: 'REVISION_MISMATCH',
        current_revision: currentRevision,
      },
      { status: 409 }
    );
  }

  // Collect every component_id referenced by the incoming plan.
  const componentIds = new Set<number>();
  for (const g of body.material_groups) {
    if (g.primary_material_id != null) componentIds.add(g.primary_material_id);
    if (g.backer_material_id != null) componentIds.add(g.backer_material_id);
    for (const e of g.edging_by_material ?? []) {
      if (e.component_id != null) componentIds.add(e.component_id);
    }
  }

  // Fetch authoritative prices. The `components` table doesn't carry price
  // columns — prices live on `suppliercomponents.price`. For each component we
  // pick the cheapest price within this org (matches `build-bom-snapshot.ts`).
  // The same per-unit `price` is used for both sheets (per-sheet) and edging
  // (per-meter); which side it represents is determined by how the component
  // is used in the material group (sheets_required vs edging length in mm).
  const priceByComponentId = new Map<number, number>();
  if (componentIds.size > 0) {
    const { data: scRows, error: scErr } = await supabaseAdmin
      .from('suppliercomponents')
      .select('component_id, price')
      .in('component_id', Array.from(componentIds))
      .eq('org_id', access.orgId);
    if (scErr) {
      return NextResponse.json({ error: 'Failed to load component prices' }, { status: 500 });
    }
    for (const row of scRows ?? []) {
      if (row.component_id == null || row.price == null) continue;
      const price = Number(row.price);
      if (!Number.isFinite(price)) continue;
      const existing = priceByComponentId.get(row.component_id);
      if (existing == null || price < existing) {
        priceByComponentId.set(row.component_id, price);
      }
    }
  }

  // Warn (don't fail) when components we were asked to price don't exist in
  // suppliercomponents for this org. The reduce below falls back to 0, which
  // silently under-reports nested cost — logging lets ops grep for it.
  const missingPrices: number[] = [];
  for (const id of componentIds) {
    if (!priceByComponentId.has(id)) missingPrices.push(id);
  }
  if (missingPrices.length > 0) {
    console.warn(
      `[cutting-plan:PUT] order ${orderId}: missing suppliercomponents.price for component_ids`,
      missingPrices,
    );
  }

  // Defensive coercion — corrupt inputs (NaN/Infinity) must not poison total_nested_cost,
  // which would persist as `null` in JSONB and silently break the UI. Matches the
  // Number.isFinite pattern used in padded-line-cost.ts and line-allocation.ts.
  const safeNum = (x: unknown): number =>
    Number.isFinite(x as number) ? Math.max(0, x as number) : 0;

  // Server-authoritative total_nested_cost: recomputed from prices, not from body.
  const total_nested_cost_raw = body.material_groups.reduce((sum, g) => {
    const primary = g.primary_material_id != null
      ? safeNum(g.sheets_required) * (priceByComponentId.get(g.primary_material_id) ?? 0)
      : 0;
    const backer = g.backer_material_id != null
      ? safeNum(g.backer_sheets_required) * (priceByComponentId.get(g.backer_material_id) ?? 0)
      : 0;
    const edging = (g.edging_by_material ?? []).reduce((s, e) =>
      s + (safeNum(e.length_mm) / 1000) * (priceByComponentId.get(e.component_id) ?? 0),
    0);
    return sum + primary + backer + edging;
  }, 0);
  const total_nested_cost = Math.round(total_nested_cost_raw * 100) / 100;

  // Per-line area from cutlist_snapshot → area-based allocation of nested cost.
  const lineAreaInputs: LineAllocationInput[] = (details ?? []).map((d) => {
    const lineQty = d.quantity ?? 1;
    const groups: Array<{ parts: Array<{ length_mm: number; width_mm: number; quantity: number }> }> =
      Array.isArray(d.cutlist_snapshot) ? d.cutlist_snapshot : [];
    let area_mm2 = 0;
    for (const g of groups) {
      for (const p of g.parts ?? []) {
        area_mm2 += (p.length_mm ?? 0) * (p.width_mm ?? 0) * (p.quantity ?? 0) * lineQty;
      }
    }
    return { order_detail_id: d.order_detail_id, area_mm2 };
  });

  const line_allocations = allocateLinesByArea(lineAreaInputs, total_nested_cost);

  // Pre-strip server-computed fields from the body so the structural shape
  // encodes "client can't set these" — safer than relying on spread order.
  const {
    total_nested_cost: _ignoredClientTotal,
    line_allocations: _ignoredClientAllocations,
    stale: _ignoredClientStale,
    ...clientPlan
  } = body;
  void _ignoredClientTotal;
  void _ignoredClientAllocations;
  void _ignoredClientStale;

  const planToSave: CuttingPlan = {
    ...clientPlan,
    stale: false,
    total_nested_cost,
    line_allocations,
  };

  const { error: updateError } = await supabaseAdmin
    .from('orders')
    .update({ cutting_plan: planToSave })
    .eq('order_id', orderId)
    .eq('org_id', access.orgId);

  if (updateError) {
    return NextResponse.json({ error: 'Failed to save cutting plan' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const access = await requireModuleAccess(request, MODULE_KEYS.ORDERS_FULFILLMENT);
  if ('error' in access) return access.error;
  if (!access.orgId) {
    return NextResponse.json({ error: 'Organization context required' }, { status: 403 });
  }

  const { orderId: orderIdParam } = await context.params;
  const orderId = parseOrderId(orderIdParam);
  if (!orderId) return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('orders')
    .update({ cutting_plan: null })
    .eq('order_id', orderId)
    .eq('org_id', access.orgId);

  if (error) {
    return NextResponse.json({ error: 'Failed to clear cutting plan' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
