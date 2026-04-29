import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { markCuttingPlanStaleForDetail } from '@/lib/orders/cutting-plan-utils';
import { getRouteClient } from '@/lib/supabase-route';
import {
  buildSwapEventPayload,
  findChangedSwapEntries,
  getSwapSourceComponentId,
  hasDownstreamEvidence,
  probeDownstreamSwapState,
} from '@/lib/orders/downstream-swap-exceptions';
import type { BomSnapshotEntry } from '@/lib/orders/snapshot-types';

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
    const { quantity, unit_price, bom_snapshot, surcharge_total } = body;

    console.log(`[PATCH /order-details/${detailId}] Updating order detail with:`, { quantity, unit_price });

    // Build the update object with only provided fields
    const updateData: Record<string, any> = {};
    if (quantity !== undefined) updateData.quantity = quantity;
    if (unit_price !== undefined) updateData.unit_price = unit_price;
    if (bom_snapshot !== undefined) updateData.bom_snapshot = bom_snapshot;
    if (surcharge_total !== undefined) updateData.surcharge_total = surcharge_total;

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
    if (surcharge_total !== undefined && isNaN(surcharge_total)) {
      return NextResponse.json({ error: 'Surcharge total must be a number' }, { status: 400 });
    }
    if (bom_snapshot !== undefined && !Array.isArray(bom_snapshot) && bom_snapshot !== null) {
      return NextResponse.json({ error: 'BOM snapshot must be an array or null' }, { status: 400 });
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
      .select('order_detail_id')
      .eq('order_detail_id', detailId)
      .maybeSingle();

    if (allowedErr || !allowedDetail) {
      return NextResponse.json({ error: 'Order detail not found' }, { status: 404 });
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
  _request: NextRequest,
  context: { params: Promise<{ detailId: string }> }
) {
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

    // First, verify the order detail exists
    const { data: detailExists, error: checkErr } = await supabaseAdmin
      .from('order_details')
      .select('order_detail_id, order_id, product_id')
      .eq('order_detail_id', detailId)
      .single();

    if (checkErr || !detailExists) {
      console.error(`[DELETE /order-details/${detailId}] Order detail not found`, checkErr);
      return NextResponse.json({ error: 'Order detail not found' }, { status: 404 });
    }

    console.log(`[DELETE /order-details/${detailId}] Order detail found for order ${detailExists.order_id}, product ${detailExists.product_id}`);

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
    await markCuttingPlanStaleForDetail(detailExists.order_id, supabaseAdmin);

    console.log(`[DELETE /order-details/${detailId}] Successfully deleted order detail`);
    return NextResponse.json({ success: true, order_id: detailExists.order_id });
  } catch (e: any) {
    console.error('[DELETE /order-details] unexpected error', e);
    return NextResponse.json({ error: `Unexpected error: ${e.message || String(e)}` }, { status: 500 });
  }
}
