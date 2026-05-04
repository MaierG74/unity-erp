import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { buildCutlistSnapshot } from '@/lib/orders/build-cutlist-snapshot';
import { markCuttingPlanStaleForDetail } from '@/lib/orders/cutting-plan-utils';
import { warnOnDerivedSurchargeFieldWrite } from '@/lib/orders/derived-field-warnings';
import { buildOrderDetailDeleteBlock } from '@/lib/orders/order-detail-delete-guard';
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
  context: { params: Promise<{ detailId: string }> }
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
  const detailId = parseInt(detailIdParam, 10);
  if (!detailId || Number.isNaN(detailId)) {
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

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ detailId: string }> }
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
  const detailId = parseInt(detailIdParam, 10);
  if (!detailId || Number.isNaN(detailId)) {
    return NextResponse.json({ error: 'Invalid order detail id' }, { status: 400 });
  }

  try {
    console.log(`[DELETE /order-details/${detailId}] Starting deletion process`);

    const { data: allowedDetail, error: allowedErr } = await routeClient.supabase
      .from('order_details')
      .select('order_detail_id, order_id, product_id')
      .eq('order_detail_id', detailId)
      .maybeSingle();

    if (allowedErr || !allowedDetail) {
      return NextResponse.json({ error: 'Order detail not found' }, { status: 404 });
    }

    console.log(`[DELETE /order-details/${detailId}] Order detail found for order ${allowedDetail.order_id}, product ${allowedDetail.product_id}`);

    const { data: workPoolRows, error: workPoolErr } = await supabaseAdmin
      .from('job_work_pool')
      .select(`
        pool_id,
        source,
        status,
        required_qty
      `)
      .eq('order_detail_id', detailId);

    if (workPoolErr) {
      console.error(`[DELETE /order-details/${detailId}] Failed to preflight work pool usage`, workPoolErr);
      return NextResponse.json(
        { error: `Failed to check production work before deleting product: ${workPoolErr.message}` },
        { status: 500 }
      );
    }

    const poolIds = (workPoolRows ?? []).map((row: any) => Number(row.pool_id)).filter(Boolean);
    const issuedQtyByPoolId = new Map<number, number>();

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
        console.error(`[DELETE /order-details/${detailId}] Failed to preflight issued job-card usage`, issuedErr);
        return NextResponse.json(
          { error: `Failed to check issued job-card work before deleting product: ${issuedErr.message}` },
          { status: 500 }
        );
      }

      for (const item of issuedItems ?? []) {
        const cardStatus = (item as any).job_cards?.status;
        if (cardStatus === 'cancelled' || item.status === 'cancelled') continue;

        const issuedSnapshot = Number(item.issued_quantity_snapshot ?? item.quantity ?? 0);
        const remainderQty = Number(item.remainder_qty ?? 0);
        const issuedQty =
          item.remainder_action === 'return_to_pool' || item.remainder_action === 'follow_up_card'
            ? Math.max(issuedSnapshot - remainderQty, 0)
            : issuedSnapshot;
        const poolId = Number(item.work_pool_id);
        issuedQtyByPoolId.set(poolId, (issuedQtyByPoolId.get(poolId) ?? 0) + issuedQty);
      }
    }

    const deletionBlock = buildOrderDetailDeleteBlock(
      (workPoolRows ?? []).map((row: any) => ({
        pool_id: row.pool_id,
        source: row.source,
        status: row.status,
        required_qty: row.required_qty,
        issued_qty: issuedQtyByPoolId.get(Number(row.pool_id)) ?? 0,
      }))
    );

    if (deletionBlock) {
      return NextResponse.json(
        {
          error: deletionBlock.message,
          code: deletionBlock.code,
          details: deletionBlock,
        },
        { status: 409 }
      );
    }

    // Delete the order detail
    const { error: delErr } = await supabaseAdmin
      .from('order_details')
      .delete()
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
