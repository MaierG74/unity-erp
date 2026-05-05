import { NextRequest, NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/api/module-access';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { computeSourceRevision, round2, safeNonNegativeFinite } from '@/lib/orders/cutting-plan-utils';
import type { CuttingPlan } from '@/lib/orders/cutting-plan-types';
import { allocateLinesByArea, type LineAllocationInput } from '@/lib/orders/line-allocation';
import type { MaterialAssignments } from '@/lib/orders/material-assignment-types';
import {
  buildCuttingPlanWorkPoolCandidates,
  reconcileCuttingPlanWorkPool,
  type ExistingCuttingPlanPoolRow,
} from '@/lib/piecework/cuttingPlanWorkPool';

type RouteParams = { orderId: string };

function parseOrderId(orderId: string): number | null {
  const parsed = Number.parseInt(orderId, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function syncCuttingPlanWorkPool(orderId: number, orgId: string, plan: CuttingPlan) {
  const { data: activities, error: activitiesError } = await supabaseAdmin
    .from('piecework_activities')
    .select('id, code, label, default_rate, target_role_id')
    .eq('org_id', orgId)
    .eq('is_active', true);

  if (activitiesError) throw activitiesError;

  const candidates = buildCuttingPlanWorkPoolCandidates(orderId, plan, activities ?? []);
  if (candidates.length === 0) return;

  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from('job_work_pool_status')
    .select('pool_id, piecework_activity_id, material_color_label, expected_count, required_qty, issued_qty, status')
    .eq('org_id', orgId)
    .eq('order_id', orderId)
    .eq('source', 'cutting_plan')
    .eq('cutting_plan_run_id', orderId);

  if (existingError) throw existingError;

  const reconcilePlan = reconcileCuttingPlanWorkPool(
    candidates,
    (existingRows ?? []) as ExistingCuttingPlanPoolRow[],
  );

  // The unique index that protects against duplicate cut/edge rows for the same
  // (order, plan, activity, material) is partial (source='cutting_plan' and
  // status='active'); PostgREST's onConflict argument can't carry that predicate,
  // so a plain INSERT is used and 23505 is treated as a benign concurrent-finalize
  // collision (both calls would have produced the same row).
  for (const candidate of reconcilePlan.inserts) {
    const { error } = await supabaseAdmin
      .from('job_work_pool')
      .insert({ ...candidate, org_id: orgId });
    if (error && error.code !== '23505') throw error;
  }

  for (const update of reconcilePlan.updates) {
    const { error } = await supabaseAdmin
      .from('job_work_pool')
      .update({
        expected_count: update.expected_count,
        required_qty: update.required_qty,
        material_color_label: update.material_color_label,
        piece_rate: update.piece_rate,
      })
      .eq('pool_id', update.pool_id)
      .eq('org_id', orgId)
      .eq('source', 'cutting_plan');
    if (error) throw error;
  }

  for (const retire of reconcilePlan.retires) {
    const { data: retiredRows, error: retireError } = await supabaseAdmin
      .from('job_work_pool')
      .update({ status: 'cancelled' })
      .eq('pool_id', retire.pool_id)
      .eq('org_id', orgId)
      .eq('source', 'cutting_plan')
      .eq('status', 'active')
      .eq('issued_qty', 0)
      .select('pool_id');
    if (retireError) throw retireError;
    if ((retiredRows ?? []).length > 0) continue;

    const { data: currentRows, error: currentError } = await supabaseAdmin
      .from('job_work_pool_status')
      .select('pool_id, material_color_label, expected_count, required_qty, issued_qty, status')
      .eq('pool_id', retire.pool_id)
      .eq('org_id', orgId)
      .limit(1);
    if (currentError) throw currentError;
    const current = currentRows?.[0];
    if (!current || current.status === 'cancelled') continue;

    if ((current.issued_qty ?? 0) > 0) {
      const { error } = await supabaseAdmin.rpc('upsert_job_work_pool_exception', {
        p_org_id: orgId,
        p_order_id: orderId,
        p_work_pool_id: retire.pool_id,
        p_exception_type: 'cutting_plan_issued_count_changed',
        p_status: 'open',
        p_required_qty_snapshot: 0,
        p_issued_qty_snapshot: current.issued_qty ?? retire.issued_qty,
        p_variance_qty: 0 - (current.issued_qty ?? retire.issued_qty),
        p_trigger_source: 'cutting_plan_finalize',
        p_trigger_context: {
          legacy_label_orphan: true,
          previous_label: retire.material_color_label,
          expected_count: 0,
          previous_required_qty: retire.required_qty,
        },
      });
      if (error) throw error;
    }
  }

  for (const exception of reconcilePlan.exceptions) {
    const { error } = await supabaseAdmin.rpc('upsert_job_work_pool_exception', {
      p_org_id: orgId,
      p_order_id: orderId,
      p_work_pool_id: exception.pool_id,
      p_exception_type: 'cutting_plan_issued_count_changed',
      p_status: 'open',
      p_required_qty_snapshot: exception.required_qty_snapshot,
      p_issued_qty_snapshot: exception.issued_qty_snapshot,
      p_variance_qty: exception.variance_qty,
      p_trigger_source: 'cutting_plan_finalize',
      p_trigger_context: {
        material_color_label: exception.material_color_label,
        expected_count: exception.expected_count,
        previous_required_qty: exception.previous_required_qty,
        ...(exception.legacy_label_orphan ? {
          legacy_label_orphan: true,
          previous_label: exception.previous_label ?? exception.material_color_label,
        } : {}),
      },
    });
    if (error) throw error;
  }
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
  if (body.version !== 2) {
    return NextResponse.json(
      { error: 'Legacy cutting plan version rejected. Regenerate the cutting plan.', code: 'LEGACY_CUTTING_PLAN_VERSION' },
      { status: 400 },
    );
  }

  // Reject legacy mm-denominated edging overrides. The cutting-plan-aware
  // RPCs read `quantity` without honoring `unit`, so a stray unit='mm' on
  // cutlist_edging would be a 1000x blow-up on purchasing demand.
  if (Array.isArray(body.component_overrides)) {
    const offender = body.component_overrides.find(
      (o) => o?.source === 'cutlist_edging' && o?.unit === 'mm',
    );
    if (offender) {
      return NextResponse.json(
        {
          error: 'Legacy mm-denominated edging override rejected. Regenerate the cutting plan.',
          code: 'LEGACY_MM_EDGING_OVERRIDE',
        },
        { status: 400 },
      );
    }
  }
  // total_nested_cost and line_allocations are server-computed; client values are ignored.

  // Verify source revision — reject if order details OR material_assignments changed.
  // Both reads are org-scoped because supabaseAdmin bypasses RLS — without the org_id
  // filter a caller from another org could obtain a revision hash for an order that
  // doesn't belong to them via the 409 path.
  const [{ data: details, error: detailsError }, { data: orderRow, error: orderRowError }] = await Promise.all([
    supabaseAdmin
      .from('order_details')
      .select('order_detail_id, quantity, cutlist_material_snapshot, cutlist_primary_material_id, cutlist_primary_backer_material_id, cutlist_primary_edging_id, cutlist_part_overrides')
      .eq('order_id', orderId)
      .eq('org_id', access.orgId),
    supabaseAdmin
      .from('orders')
      .select('material_assignments')
      .eq('order_id', orderId)
      .eq('org_id', access.orgId)
      .maybeSingle(),
  ]);

  if (detailsError || orderRowError) {
    return NextResponse.json({ error: 'Failed to verify order state' }, { status: 500 });
  }

  // Bail before computing any hash if the order doesn't belong to this org
  // (or doesn't exist) — otherwise a 409 would leak the current revision.
  if (!orderRow) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  const currentAssignments = (orderRow.material_assignments as MaterialAssignments | null) ?? null;

  const currentRevision = computeSourceRevision(
    (details ?? []).map((d) => ({
      order_detail_id: d.order_detail_id,
      quantity: d.quantity ?? 1,
      cutlist_material_snapshot: d.cutlist_material_snapshot,
    })),
    currentAssignments,
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
    componentIds.add(g.material_id);
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

  // Server-authoritative total_nested_cost: recomputed from prices, not from body.
  // Defensive coercion ensures NaN/Infinity can't persist as null in JSONB.
  const total_nested_cost_raw = body.material_groups.reduce((sum, g) => {
    const material = safeNonNegativeFinite(g.sheets_required) * (priceByComponentId.get(g.material_id) ?? 0);
    const edging = (g.edging_by_material ?? []).reduce((s, e) =>
      s + (safeNonNegativeFinite(e.length_mm) / 1000) * (priceByComponentId.get(e.component_id) ?? 0),
    0);
    return sum + material + edging;
  }, 0);
  const total_nested_cost = round2(total_nested_cost_raw);

  // Per-line area from cutlist_material_snapshot → area-based allocation of nested cost.
  const lineAreaInputs: LineAllocationInput[] = (details ?? []).map((d) => {
    const lineQty = d.quantity ?? 1;
    const groups: Array<{ parts: Array<{ length_mm: number; width_mm: number; quantity: number }> }> =
      Array.isArray(d.cutlist_material_snapshot) ? d.cutlist_material_snapshot : [];
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

  // .select('order_id') forces PostgREST to return affected rows so we can
  // detect zero-row updates (e.g. if RLS or org_id filter excluded the row
  // after our earlier existence check).
  const { data: updated, error: updateError } = await supabaseAdmin
    .from('orders')
    .update({ cutting_plan: planToSave })
    .eq('order_id', orderId)
    .eq('org_id', access.orgId)
    .select('order_id');

  if (updateError) {
    return NextResponse.json({ error: 'Failed to save cutting plan' }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  try {
    await syncCuttingPlanWorkPool(orderId, access.orgId, planToSave);
  } catch (error) {
    console.error('[cutting-plan:PUT] failed to sync cutting-plan work pool', error);
    return NextResponse.json({ error: 'Failed to sync cutting plan work pool' }, { status: 500 });
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

  const { data: updated, error } = await supabaseAdmin
    .from('orders')
    .update({ cutting_plan: null })
    .eq('order_id', orderId)
    .eq('org_id', access.orgId)
    .select('order_id');

  if (error) {
    return NextResponse.json({ error: 'Failed to clear cutting plan' }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
