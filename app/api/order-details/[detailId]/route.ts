import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { buildCutlistSnapshot } from '@/lib/orders/build-cutlist-snapshot';
import { markCuttingPlanStaleForDetail } from '@/lib/orders/cutting-plan-utils';
import { warnOnDerivedSurchargeFieldWrite } from '@/lib/orders/derived-field-warnings';
import {
  buildOrderDetailDeleteBlock,
  buildOrderDetailMaterialBlock,
  type OrderDetailMaterialUsageRow,
  type OrderDetailWorkPoolUsageRow,
} from '@/lib/orders/order-detail-delete-guard';
import { getRouteClient } from '@/lib/supabase-route';
import {
  buildSwapEventPayload,
  findChangedSwapEntries,
  getSwapSourceComponentId,
  hasDownstreamEvidence,
  probeDownstreamSwapState,
} from '@/lib/orders/downstream-swap-exceptions';
import {
  boardEdgingPairKey,
  type BoardEdgingPairLookup,
  type BomSnapshotEntry,
  type CutlistLineMaterial,
  type CutlistPartOverride,
} from '@/lib/orders/snapshot-types';

type OrderDetailDeleteRouteContext = { params: Promise<{ detailId: string }> };

function parseDetailId(detailIdParam: string): number | null {
  const detailId = parseInt(detailIdParam, 10);
  return !detailId || Number.isNaN(detailId) ? null : detailId;
}

async function loadOrderDetailWorkPoolUsage(
  supabaseAdmin: SupabaseClient<any, any, any>,
  detailId: number,
  orgId: string
): Promise<{ rows?: OrderDetailWorkPoolUsageRow[]; error?: string }> {
  const { data: workPoolRows, error: workPoolErr } = await supabaseAdmin
    .from('job_work_pool')
    .select(`
      pool_id,
      source,
      status,
      required_qty,
      jobs:job_id(name),
      products:product_id(name)
    `)
    .eq('org_id', orgId)
    .eq('order_detail_id', detailId);

  if (workPoolErr) {
    return { error: `Failed to check production work before deleting product: ${workPoolErr.message}` };
  }

  const poolIds = (workPoolRows ?? []).map((row: any) => Number(row.pool_id)).filter(Boolean);
  const issuedQtyByPoolId = new Map<number, number>();
  const linkedItemsByPoolId = new Map<number, number>();

  if (poolIds.length > 0) {
    const { data: issuedItems, error: issuedErr } = await supabaseAdmin
      .from('job_card_items')
      .select(`
        work_pool_id,
        quantity,
        issued_quantity_snapshot,
        remainder_qty,
        remainder_action,
        status,
        job_cards!job_card_items_job_card_id_fkey(status)
      `)
      .in('work_pool_id', poolIds);

    if (issuedErr) {
      return { error: `Failed to check issued job-card work before deleting product: ${issuedErr.message}` };
    }

    for (const item of issuedItems ?? []) {
      const poolId = Number(item.work_pool_id);
      linkedItemsByPoolId.set(poolId, (linkedItemsByPoolId.get(poolId) ?? 0) + 1);

      const cardStatus = (item as any).job_cards?.status;
      if (cardStatus === 'cancelled' || item.status === 'cancelled') continue;

      const issuedSnapshot = Number(item.issued_quantity_snapshot ?? item.quantity ?? 0);
      const remainderQty = Number(item.remainder_qty ?? 0);
      const issuedQty =
        item.remainder_action === 'return_to_pool' || item.remainder_action === 'follow_up_card'
          ? Math.max(issuedSnapshot - remainderQty, 0)
          : issuedSnapshot;

      issuedQtyByPoolId.set(poolId, (issuedQtyByPoolId.get(poolId) ?? 0) + issuedQty);
    }
  }

  return {
    rows: (workPoolRows ?? []).map((row: any) => ({
      pool_id: row.pool_id,
      source: row.source,
      status: row.status,
      required_qty: row.required_qty,
      issued_qty: issuedQtyByPoolId.get(Number(row.pool_id)) ?? 0,
      linked_job_card_items: linkedItemsByPoolId.get(Number(row.pool_id)) ?? 0,
      job_name: row.jobs?.name ?? null,
      product_name: row.products?.name ?? null,
    })),
  };
}

type ComponentRequirementRow = {
  component_id: number;
  quantity_required: number;
  component_label: string | null;
};

function toFiniteNumber(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function relationObject<T extends Record<string, any>>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function buildComponentLabel(component: {
  internal_code?: string | null;
  description?: string | null;
} | null | undefined): string | null {
  if (!component) return null;
  const code = component.internal_code?.trim();
  const description = component.description?.trim();
  if (code && description) return `${code} ${description}`;
  return code || description || null;
}

function componentRowsFromBomSnapshot(snapshot: unknown): ComponentRequirementRow[] {
  if (!Array.isArray(snapshot) || snapshot.length === 0) return [];

  return snapshot.flatMap((entry: BomSnapshotEntry | Record<string, any>) => {
    if ((entry as any).is_removed === true) return [];

    const componentId = Number((entry as any).effective_component_id ?? (entry as any).component_id);
    const quantityRequired = Number(
      (entry as any).effective_quantity_required ?? (entry as any).quantity_required ?? 0
    );

    if (!Number.isFinite(componentId) || componentId <= 0) return [];
    if (!Number.isFinite(quantityRequired) || quantityRequired <= 0) return [];

    const code = (entry as any).effective_component_code ?? (entry as any).component_code ?? null;
    const description = (entry as any).component_description ?? null;

    return [
      {
        component_id: componentId,
        quantity_required: quantityRequired,
        component_label: buildComponentLabel({ internal_code: code, description }),
      },
    ];
  });
}

function mergeComponentRequirements(rows: ComponentRequirementRow[]): ComponentRequirementRow[] {
  const byComponentId = new Map<number, ComponentRequirementRow>();

  for (const row of rows) {
    const existing = byComponentId.get(row.component_id);
    if (!existing) {
      byComponentId.set(row.component_id, { ...row });
      continue;
    }

    existing.quantity_required += row.quantity_required;
    existing.component_label = existing.component_label ?? row.component_label;
  }

  return Array.from(byComponentId.values());
}

async function loadOrderDetailComponentRequirements(
  supabaseAdmin: SupabaseClient<any, any, any>,
  detailId: number,
  orderId: number,
  orgId: string
): Promise<{ rows?: ComponentRequirementRow[]; error?: string }> {
  const { data: detail, error: detailErr } = await supabaseAdmin
    .from('order_details')
    .select('order_detail_id, order_id, product_id, bom_snapshot, org_id')
    .eq('order_detail_id', detailId)
    .eq('order_id', orderId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (detailErr) {
    return { error: `Failed to check product components before deleting product: ${detailErr.message}` };
  }

  if (!detail) {
    return { error: 'Order detail not found' };
  }

  const snapshotRows = componentRowsFromBomSnapshot((detail as any).bom_snapshot);
  if (snapshotRows.length > 0) {
    return { rows: mergeComponentRequirements(snapshotRows) };
  }

  const { data: bomRows, error: bomErr } = await supabaseAdmin
    .from('billofmaterials')
    .select(`
      component_id,
      quantity_required,
      component:components(
        component_id,
        internal_code,
        description
      )
    `)
    .eq('product_id', (detail as any).product_id);

  if (bomErr) {
    return { error: `Failed to check product BOM before deleting product: ${bomErr.message}` };
  }

  return {
    rows: mergeComponentRequirements(
      (bomRows ?? []).flatMap((row: any) => {
        const componentId = Number(row.component_id);
        const quantityRequired = Number(row.quantity_required ?? 0);
        if (!Number.isFinite(componentId) || componentId <= 0) return [];
        if (!Number.isFinite(quantityRequired) || quantityRequired <= 0) return [];

        return [
          {
            component_id: componentId,
            quantity_required: quantityRequired,
            component_label: buildComponentLabel(relationObject(row.component)),
          },
        ];
      })
    ),
  };
}

async function loadOrderDetailMaterialUsage(
  supabaseAdmin: SupabaseClient<any, any, any>,
  detailId: number,
  orderId: number,
  orgId: string
): Promise<{ rows?: OrderDetailMaterialUsageRow[]; error?: string }> {
  const requirements = await loadOrderDetailComponentRequirements(supabaseAdmin, detailId, orderId, orgId);
  if (requirements.error) return { error: requirements.error };

  const componentRequirements = requirements.rows ?? [];
  const componentIds = componentRequirements.map((row) => row.component_id);
  if (componentIds.length === 0) return { rows: [] };

  const usageByComponentId = new Map<number, OrderDetailMaterialUsageRow>();
  const ensureUsageRow = (componentId: number): OrderDetailMaterialUsageRow => {
    const existing = usageByComponentId.get(componentId);
    if (existing) return existing;

    const requirement = componentRequirements.find((row) => row.component_id === componentId);
    const row: OrderDetailMaterialUsageRow = {
      component_id: componentId,
      component_label: requirement?.component_label ?? `Component ${componentId}`,
      reserved_qty: 0,
      ordered_qty: 0,
      received_qty: 0,
      issued_qty: 0,
      supplier_order_count: 0,
      stock_issuance_count: 0,
    };
    usageByComponentId.set(componentId, row);
    return row;
  };

  componentIds.forEach(ensureUsageRow);

  const [
    componentResult,
    reservationResult,
    supplierAllocationResult,
    stockIssuanceResult,
  ] = await Promise.all([
    supabaseAdmin
      .from('components')
      .select('component_id, internal_code, description')
      .eq('org_id', orgId)
      .in('component_id', componentIds),
    supabaseAdmin
      .from('component_reservations')
      .select('component_id, qty_reserved')
      .eq('org_id', orgId)
      .eq('order_id', orderId)
      .in('component_id', componentIds),
    supabaseAdmin
      .from('supplier_order_customer_orders')
      .select(`
        id,
        supplier_order_id,
        component_id,
        quantity_for_order,
        received_quantity,
        supplier_order:supplier_orders(
          order_id,
          total_received,
          status:supplier_order_statuses(status_name)
        )
      `)
      .eq('org_id', orgId)
      .eq('order_id', orderId)
      .in('component_id', componentIds),
    supabaseAdmin
      .from('stock_issuances')
      .select('component_id, quantity_issued')
      .eq('order_id', orderId)
      .in('component_id', componentIds),
  ]);

  if (componentResult.error) {
    return { error: `Failed to load component labels before deleting product: ${componentResult.error.message}` };
  }
  if (reservationResult.error) {
    return { error: `Failed to check component reservations before deleting product: ${reservationResult.error.message}` };
  }
  if (supplierAllocationResult.error) {
    return { error: `Failed to check component purchase orders before deleting product: ${supplierAllocationResult.error.message}` };
  }
  if (stockIssuanceResult.error) {
    return { error: `Failed to check issued component stock before deleting product: ${stockIssuanceResult.error.message}` };
  }

  for (const component of (componentResult.data ?? []) as any[]) {
    const row = ensureUsageRow(Number(component.component_id));
    row.component_label = buildComponentLabel(component) ?? row.component_label;
  }

  for (const reservation of (reservationResult.data ?? []) as any[]) {
    const row = ensureUsageRow(Number(reservation.component_id));
    row.reserved_qty = toFiniteNumber(row.reserved_qty) + toFiniteNumber(reservation.qty_reserved);
  }

  for (const allocation of (supplierAllocationResult.data ?? []) as any[]) {
    const quantityForOrder = toFiniteNumber(allocation.quantity_for_order);
    const receivedQuantity = toFiniteNumber(allocation.received_quantity);
    const supplierOrder = relationObject(allocation.supplier_order);
    const status = relationObject(supplierOrder?.status);
    const statusName = String(status?.status_name ?? '').trim().toLowerCase();

    if (statusName === 'cancelled') continue;
    if (quantityForOrder <= 0 && receivedQuantity <= 0) continue;

    const row = ensureUsageRow(Number(allocation.component_id));
    row.ordered_qty = toFiniteNumber(row.ordered_qty) + quantityForOrder;
    row.received_qty = toFiniteNumber(row.received_qty) + receivedQuantity;
    row.supplier_order_count = toFiniteNumber(row.supplier_order_count) + 1;
  }

  for (const issuance of (stockIssuanceResult.data ?? []) as any[]) {
    const issuedQty = toFiniteNumber(issuance.quantity_issued);
    if (issuedQty <= 0) continue;

    const row = ensureUsageRow(Number(issuance.component_id));
    row.issued_qty = toFiniteNumber(row.issued_qty) + issuedQty;
    row.stock_issuance_count = toFiniteNumber(row.stock_issuance_count) + 1;
  }

  return {
    rows: Array.from(usageByComponentId.values())
      .filter((row) =>
        toFiniteNumber(row.reserved_qty) > 0 ||
        toFiniteNumber(row.ordered_qty) > 0 ||
        toFiniteNumber(row.received_qty) > 0 ||
        toFiniteNumber(row.issued_qty) > 0 ||
        toFiniteNumber(row.supplier_order_count) > 0 ||
        toFiniteNumber(row.stock_issuance_count) > 0
      )
      .sort((a, b) => a.component_label.localeCompare(b.component_label)),
  };
}

async function loadCutlistLineMaterial(
  supabaseAdmin: SupabaseClient<any, any, any>,
  componentId: unknown,
  orgId: string
): Promise<CutlistLineMaterial> {
  const id = Number(componentId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const { data, error } = await supabaseAdmin
    .from('components')
    .select('component_id, internal_code, description')
    .eq('org_id', orgId)
    .eq('component_id', id)
    .maybeSingle();

  if (error) throw error;
  const component = data as any;
  if (!component) return null;

  return {
    component_id: component.component_id,
    component_name: component.description ?? component.internal_code ?? null,
  };
}

async function loadBoardEdgingPairLookup(
  supabaseAdmin: SupabaseClient<any, any, any>,
  orgId: string
): Promise<BoardEdgingPairLookup> {
  const { data, error } = await supabaseAdmin
    .from('board_edging_pairs')
    .select('board_component_id, thickness_mm, edging_component_id')
    .eq('org_id', orgId);

  if (error) throw error;
  const rows = data ?? [];
  const edgingIds = Array.from(new Set(rows.map((row: any) => Number(row.edging_component_id)).filter(Boolean)));
  const names = new Map<number, string | null>();

  if (edgingIds.length > 0) {
    const { data: components, error: componentError } = await supabaseAdmin
      .from('components')
      .select('component_id, internal_code, description')
      .eq('org_id', orgId)
      .in('component_id', edgingIds);
    if (componentError) throw componentError;
    for (const component of (components ?? []) as any[]) {
      names.set(component.component_id, component.description ?? component.internal_code ?? null);
    }
  }

  return new Map(
    (rows as any[]).map((row: any) => [
      boardEdgingPairKey(Number(row.board_component_id), Number(row.thickness_mm)),
      {
        component_id: Number(row.edging_component_id),
        component_name: names.get(Number(row.edging_component_id)) ?? null,
      },
    ])
  );
}

export async function PATCH(
  request: NextRequest,
  context: OrderDetailDeleteRouteContext
) {
  const routeClient = await getRouteClient(request);
  if ('error' in routeClient) {
    return NextResponse.json({ error: routeClient.error }, { status: routeClient.status ?? 401 });
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { detailId: detailIdParam } = await context.params;
  const detailId = parseDetailId(detailIdParam);
  if (!detailId) {
    return NextResponse.json({ error: 'Invalid order detail id' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const {
      quantity,
      unit_price,
      bom_snapshot,
      cutlist_material_snapshot,
      cutlist_primary_material_id,
      cutlist_primary_backer_material_id,
      cutlist_primary_edging_id,
      cutlist_part_overrides,
      cutlist_surcharge_kind,
      cutlist_surcharge_value,
      cutlist_surcharge_label,
      cutlist_surcharge_resolved,
      surcharge_total,
    } = body;

    console.log(`[PATCH /order-details/${detailId}] Updating order detail with:`, { quantity, unit_price });
    warnOnDerivedSurchargeFieldWrite({
      route: `/api/order-details/${detailId}`,
      payload: body,
      callerInfo: {
        userId: routeClient.user.id,
      },
    });

    // Build the update object with only provided fields
    const updateData: Record<string, any> = {};
    if (quantity !== undefined) updateData.quantity = quantity;
    if (unit_price !== undefined) updateData.unit_price = unit_price;
    if (bom_snapshot !== undefined) updateData.bom_snapshot = bom_snapshot;
    if (cutlist_material_snapshot !== undefined) updateData.cutlist_material_snapshot = cutlist_material_snapshot;
    if (cutlist_primary_material_id !== undefined) updateData.cutlist_primary_material_id = cutlist_primary_material_id;
    if (cutlist_primary_backer_material_id !== undefined) updateData.cutlist_primary_backer_material_id = cutlist_primary_backer_material_id;
    if (cutlist_primary_edging_id !== undefined) updateData.cutlist_primary_edging_id = cutlist_primary_edging_id;
    if (cutlist_part_overrides !== undefined) updateData.cutlist_part_overrides = cutlist_part_overrides;
    if (cutlist_surcharge_kind !== undefined) updateData.cutlist_surcharge_kind = cutlist_surcharge_kind;
    if (cutlist_surcharge_value !== undefined) {
      updateData.cutlist_surcharge_value = cutlist_surcharge_value === '' ? null : cutlist_surcharge_value;
    }
    if (cutlist_surcharge_label !== undefined) updateData.cutlist_surcharge_label = cutlist_surcharge_label;
    if (cutlist_surcharge_resolved !== undefined) {
      updateData.cutlist_surcharge_resolved = cutlist_surcharge_resolved === '' ? null : cutlist_surcharge_resolved;
    }
    if (surcharge_total !== undefined) updateData.surcharge_total = surcharge_total === '' ? null : surcharge_total;

    // Validate that at least one field is being updated
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    // Validate numeric values
    if (quantity !== undefined && (isNaN(quantity) || quantity < 0)) {
      return NextResponse.json({ error: 'Quantity must be a non-negative number' }, { status: 400 });
    }
    if (unit_price !== undefined && (isNaN(unit_price) || unit_price < 0)) {
      return NextResponse.json({ error: 'Unit price must be a non-negative number' }, { status: 400 });
    }
    if (surcharge_total !== undefined && surcharge_total !== '' && isNaN(surcharge_total)) {
      return NextResponse.json({ error: 'Surcharge total must be a number' }, { status: 400 });
    }
    if (bom_snapshot !== undefined && !Array.isArray(bom_snapshot) && bom_snapshot !== null) {
      return NextResponse.json({ error: 'BOM snapshot must be an array or null' }, { status: 400 });
    }
    if (cutlist_material_snapshot !== undefined && !Array.isArray(cutlist_material_snapshot) && cutlist_material_snapshot !== null) {
      return NextResponse.json({ error: 'Cutlist material snapshot must be an array or null' }, { status: 400 });
    }
    if (cutlist_part_overrides !== undefined && !Array.isArray(cutlist_part_overrides)) {
      return NextResponse.json({ error: 'Cutlist part overrides must be an array' }, { status: 400 });
    }
    if (
      cutlist_surcharge_kind !== undefined &&
      cutlist_surcharge_kind !== 'fixed' &&
      cutlist_surcharge_kind !== 'percentage'
    ) {
      return NextResponse.json({ error: 'Cutlist surcharge kind must be fixed or percentage' }, { status: 400 });
    }
    if (cutlist_surcharge_value !== undefined && cutlist_surcharge_value !== '' && isNaN(cutlist_surcharge_value)) {
      return NextResponse.json({ error: 'Cutlist surcharge value must be a number' }, { status: 400 });
    }
    if (cutlist_surcharge_resolved !== undefined && cutlist_surcharge_resolved !== '' && isNaN(cutlist_surcharge_resolved)) {
      return NextResponse.json({ error: 'Cutlist surcharge resolved must be a number' }, { status: 400 });
    }

    // Verify the order detail exists
    const { data: detailExists, error: checkErr } = await supabaseAdmin
      .from('order_details')
      .select('order_detail_id, order_id, bom_snapshot')
      .eq('order_detail_id', detailId)
      .single();

    if (checkErr || !detailExists) {
      console.error(`[PATCH /order-details/${detailId}] Order detail not found`, checkErr);
      return NextResponse.json({ error: 'Order detail not found' }, { status: 404 });
    }

    const { data: allowedDetail, error: allowedErr } = await routeClient.supabase
      .from('order_details')
      .select('order_detail_id, product_id, org_id')
      .eq('order_detail_id', detailId)
      .maybeSingle();

    if (allowedErr || !allowedDetail) {
      return NextResponse.json({ error: 'Order detail not found' }, { status: 404 });
    }

    const cutlistIntentProvided =
      cutlist_primary_material_id !== undefined ||
      cutlist_primary_backer_material_id !== undefined ||
      cutlist_primary_edging_id !== undefined ||
      cutlist_part_overrides !== undefined;

    if (cutlistIntentProvided && cutlist_material_snapshot === undefined) {
      const partOverrides = Array.isArray(cutlist_part_overrides)
        ? (cutlist_part_overrides as CutlistPartOverride[])
        : [];
      const pairLookup = await loadBoardEdgingPairLookup(supabaseAdmin, allowedDetail.org_id);
      const linePrimary = await loadCutlistLineMaterial(supabaseAdmin, cutlist_primary_material_id, allowedDetail.org_id);
      const lineBacker = await loadCutlistLineMaterial(supabaseAdmin, cutlist_primary_backer_material_id, allowedDetail.org_id);
      const lineEdging = await loadCutlistLineMaterial(supabaseAdmin, cutlist_primary_edging_id, allowedDetail.org_id);
      const { snapshot } = await buildCutlistSnapshot(Number(allowedDetail.product_id), allowedDetail.org_id, {
        linePrimary,
        lineBacker,
        lineEdging,
        partOverrides,
        pairLookup,
      });
      updateData.cutlist_material_snapshot = snapshot;
    }

    // Update the order detail
    const { data: updatedDetail, error: updateErr } = await supabaseAdmin
      .from('order_details')
      .update(updateData)
      .eq('order_detail_id', detailId)
      .select()
      .single();

    if (updateErr) {
      console.error(`[PATCH /order-details/${detailId}] Failed to update order detail`, updateErr);
      return NextResponse.json({ error: `Failed to update order detail: ${updateErr.message}` }, { status: 500 });
    }

    const swapExceptions: number[] = [];
    if (bom_snapshot !== undefined && Array.isArray(bom_snapshot)) {
      const changedEntries = findChangedSwapEntries(
        (detailExists.bom_snapshot as BomSnapshotEntry[] | null) ?? null,
        bom_snapshot as BomSnapshotEntry[]
      );

      for (const { before, after } of changedEntries) {
        const sourceComponentId = getSwapSourceComponentId(before);
        if (!sourceComponentId) continue;

        const downstreamEvidence = await probeDownstreamSwapState({
          supabase: supabaseAdmin,
          orderId: detailExists.order_id,
          sourceComponentId,
        });

        if (!hasDownstreamEvidence(downstreamEvidence)) continue;

        const { data: exceptionId, error: exceptionErr } = await supabaseAdmin.rpc('upsert_bom_swap_exception', {
          p_order_detail_id: detailId,
          p_source_bom_id: Number(after.source_bom_id),
          p_swap_event: buildSwapEventPayload(before, after),
          p_downstream_evidence: downstreamEvidence,
          p_user: routeClient.user.id,
        });

        if (exceptionErr) {
          console.error(`[PATCH /order-details/${detailId}] Failed to upsert BOM swap exception`, exceptionErr);
          return NextResponse.json(
            { error: `Product updated, but failed to create swap exception: ${exceptionErr.message}` },
            { status: 500 }
          );
        }

        if (exceptionId) {
          swapExceptions.push(Number(exceptionId));
        }
      }
    }

    // Mark cutting plan stale if order details changed
    if (detailExists.order_id) {
      await markCuttingPlanStaleForDetail(detailExists.order_id, supabaseAdmin);
    }

    console.log(`[PATCH /order-details/${detailId}] Successfully updated order detail`);
    return NextResponse.json({ success: true, detail: updatedDetail, swap_exception_ids: swapExceptions });
  } catch (e: any) {
    console.error('[PATCH /order-details] unexpected error', e);
    return NextResponse.json({ error: `Unexpected error: ${e.message || String(e)}` }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  context: OrderDetailDeleteRouteContext
) {
  const routeClient = await getRouteClient(request);
  if ('error' in routeClient) {
    return NextResponse.json({ error: routeClient.error }, { status: routeClient.status ?? 401 });
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { detailId: detailIdParam } = await context.params;
  const detailId = parseDetailId(detailIdParam);
  if (!detailId) {
    return NextResponse.json({ error: 'Invalid order detail id' }, { status: 400 });
  }

  const { data: allowedDetail, error: allowedErr } = await routeClient.supabase
    .from('order_details')
    .select('order_detail_id, order_id, product_id, org_id')
    .eq('order_detail_id', detailId)
    .maybeSingle();

  if (allowedErr || !allowedDetail) {
    return NextResponse.json({ error: 'Order detail not found' }, { status: 404 });
  }

  const usage = await loadOrderDetailWorkPoolUsage(supabaseAdmin, detailId, allowedDetail.org_id);
  if (usage.error) {
    return NextResponse.json({ error: usage.error }, { status: 500 });
  }

  const materialUsage = await loadOrderDetailMaterialUsage(
    supabaseAdmin,
    detailId,
    allowedDetail.order_id,
    allowedDetail.org_id
  );
  if (materialUsage.error) {
    return NextResponse.json({ error: materialUsage.error }, { status: 500 });
  }

  const workPoolRows = usage.rows ?? [];
  const deletionBlock = buildOrderDetailDeleteBlock(workPoolRows);
  const materialRows = materialUsage.rows ?? [];
  const materialBlock = buildOrderDetailMaterialBlock(materialRows);

  return NextResponse.json({
    order_detail_id: allowedDetail.order_detail_id,
    order_id: allowedDetail.order_id,
    product_id: allowedDetail.product_id,
    production_work: {
      block: deletionBlock,
      work_pool_rows: workPoolRows,
    },
    material_work: {
      block: materialBlock,
      component_rows: materialRows,
    },
  });
}

export async function DELETE(
  request: NextRequest,
  context: OrderDetailDeleteRouteContext
) {
  const routeClient = await getRouteClient(request);
  if ('error' in routeClient) {
    return NextResponse.json({ error: routeClient.error }, { status: routeClient.status ?? 401 });
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { detailId: detailIdParam } = await context.params;
  const detailId = parseDetailId(detailIdParam);
  if (!detailId) {
    return NextResponse.json({ error: 'Invalid order detail id' }, { status: 400 });
  }

  try {
    const clearGeneratedWork = request.nextUrl.searchParams.get('clear_generated_work') === 'true';
    console.log(`[DELETE /order-details/${detailId}] Starting deletion process`);

    const { data: allowedDetail, error: allowedErr } = await routeClient.supabase
      .from('order_details')
      .select('order_detail_id, order_id, product_id, org_id')
      .eq('order_detail_id', detailId)
      .maybeSingle();

    if (allowedErr || !allowedDetail) {
      return NextResponse.json({ error: 'Order detail not found' }, { status: 404 });
    }

    console.log(`[DELETE /order-details/${detailId}] Order detail found for order ${allowedDetail.order_id}, product ${allowedDetail.product_id}`);

    const usage = await loadOrderDetailWorkPoolUsage(supabaseAdmin, detailId, allowedDetail.org_id);
    if (usage.error) {
      console.error(`[DELETE /order-details/${detailId}] Failed to preflight production work`, usage.error);
      return NextResponse.json({ error: usage.error }, { status: 500 });
    }

    const materialUsage = await loadOrderDetailMaterialUsage(
      supabaseAdmin,
      detailId,
      allowedDetail.order_id,
      allowedDetail.org_id
    );
    if (materialUsage.error) {
      console.error(`[DELETE /order-details/${detailId}] Failed to preflight component activity`, materialUsage.error);
      return NextResponse.json({ error: materialUsage.error }, { status: 500 });
    }

    const workPoolRows = usage.rows ?? [];
    const deletionBlock = buildOrderDetailDeleteBlock(workPoolRows);
    const materialRows = materialUsage.rows ?? [];
    const materialBlock = buildOrderDetailMaterialBlock(materialRows);

    if (materialBlock) {
      return NextResponse.json(
        {
          error: materialBlock.message,
          code: materialBlock.code,
          details: materialBlock,
          material_rows: materialRows,
          production_work: deletionBlock,
          work_pool_rows: workPoolRows,
        },
        { status: 409 }
      );
    }

    if (deletionBlock) {
      if (!clearGeneratedWork || !deletionBlock.can_clear_generated_work) {
        return NextResponse.json(
          {
            error: deletionBlock.message,
            code: deletionBlock.code,
            details: deletionBlock,
            work_pool_rows: workPoolRows,
          },
          { status: 409 }
        );
      }

      const poolIds = workPoolRows.map((row) => Number(row.pool_id)).filter(Boolean);
      const { error: clearErr } = await supabaseAdmin
        .from('job_work_pool')
        .delete()
        .eq('org_id', allowedDetail.org_id)
        .in('pool_id', poolIds);

      if (clearErr) {
        console.error(`[DELETE /order-details/${detailId}] Failed to clear generated work`, clearErr);
        return NextResponse.json(
          { error: `Failed to clear generated work before removing product: ${clearErr.message}` },
          { status: clearErr.code === '23503' ? 409 : 500 }
        );
      }
    }

    const { error: swapExceptionDeleteErr } = await supabaseAdmin
      .from('bom_swap_exceptions')
      .delete()
      .eq('org_id', allowedDetail.org_id)
      .eq('order_detail_id', detailId);

    if (swapExceptionDeleteErr) {
      console.error(`[DELETE /order-details/${detailId}] Failed to clear BOM swap exceptions`, swapExceptionDeleteErr);
      return NextResponse.json(
        { error: `Failed to clear BOM swap exceptions before removing product: ${swapExceptionDeleteErr.message}` },
        { status: 500 }
      );
    }

    // Delete the order detail
    const { error: delErr } = await supabaseAdmin
      .from('order_details')
      .delete()
      .eq('org_id', allowedDetail.org_id)
      .eq('order_detail_id', detailId);

    if (delErr) {
      console.error(`[DELETE /order-details/${detailId}] Failed to delete order detail`, delErr);
      return NextResponse.json({ error: `Failed to delete order detail: ${delErr.message}` }, { status: 500 });
    }

    // Mark cutting plan stale since a product was removed
    await markCuttingPlanStaleForDetail(allowedDetail.order_id, supabaseAdmin);

    console.log(`[DELETE /order-details/${detailId}] Successfully deleted order detail`);
    return NextResponse.json({ success: true, order_id: allowedDetail.order_id });
  } catch (e: any) {
    console.error('[DELETE /order-details] unexpected error', e);
    return NextResponse.json({ error: `Unexpected error: ${e.message || String(e)}` }, { status: 500 });
  }
}
