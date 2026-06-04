import { NextRequest, NextResponse } from 'next/server';

import { requireQuoteItemAccess } from '@/lib/api/quotes-access';
import {
  applyQuoteCostingMarkupFromUnitPrice,
  ensureQuoteItemCostingCluster,
  fetchQuoteItemClustersForCosting,
  refreshQuoteItemCostingMaterials,
} from '@/lib/quotes/build-costing-cluster';
import { applyQuoteCostLineSurcharge, isEditableQuoteCostingLine } from '@/lib/quotes/costing-tree';
import { supabaseAdmin } from '@/lib/supabase-admin';

function serializeRouteError(error: any) {
  return {
    error: error?.message ?? 'Failed to initialize quote costing',
    details: error?.details,
    code: error?.code,
    hint: error?.hint,
  };
}

function routeErrorResponse(error: unknown) {
  if (process.env.NODE_ENV === 'production') {
    return { error: 'Failed to initialize quote costing' };
  }
  return serializeRouteError(error);
}

async function loadQuoteItem(id: string, orgId: string) {
  const { data, error } = await supabaseAdmin
    .from('quote_items')
    .select('id, quote_id, org_id, product_id, unit_price, bom_snapshot, cutlist_material_snapshot')
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) throw error;
  return data as { id: string; quote_id: string; org_id: string; product_id: number | null; unit_price: number | string | null; bom_snapshot: unknown; cutlist_material_snapshot?: unknown } | null;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const auth = await requireQuoteItemAccess(request, id);
  if ('error' in auth) return auth.error;

  const clusters = await fetchQuoteItemClustersForCosting(supabaseAdmin, id, auth.orgId);
  return NextResponse.json({ clusters });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const auth = await requireQuoteItemAccess(request, id);
  if ('error' in auth) return auth.error;

  let quoteItemForLog: Awaited<ReturnType<typeof loadQuoteItem>> = null;
  let actionForLog = 'initialize';

  try {
    const body = await request.json().catch(() => null);
    actionForLog = body?.action === 'refresh_materials' ? 'refresh_materials' : 'initialize';

    const quoteItem = await loadQuoteItem(id, auth.orgId);
    quoteItemForLog = quoteItem;
    if (!quoteItem) return NextResponse.json({ error: 'Quote item not found' }, { status: 404 });
    if (!quoteItem.product_id) {
      return NextResponse.json({ error: 'Quote item is not linked to a product' }, { status: 422 });
    }

    if (body?.action === 'refresh_materials') {
      const refreshed = await refreshQuoteItemCostingMaterials({
        supabase: supabaseAdmin,
        quoteItemId: id,
        productId: Number(quoteItem.product_id),
        orgId: auth.orgId,
        bomSnapshot: quoteItem.bom_snapshot,
        cutlistMaterialSnapshot: quoteItem.cutlist_material_snapshot,
      });
      return NextResponse.json({ clusters: refreshed.clusters, refreshed: true });
    }

    const result = await ensureQuoteItemCostingCluster({
      supabase: supabaseAdmin,
      quoteItemId: id,
      productId: Number(quoteItem.product_id),
      orgId: auth.orgId,
      bomSnapshot: quoteItem.bom_snapshot,
      cutlistMaterialSnapshot: quoteItem.cutlist_material_snapshot,
    });

    if (result.created) {
      result.clusters = await applyQuoteCostingMarkupFromUnitPrice({
        supabase: supabaseAdmin,
        clusters: result.clusters,
        unitPrice: Number(quoteItem.unit_price ?? 0),
        orgId: auth.orgId,
      });
    }

    if (result.lineCount === 0) {
      return NextResponse.json(
        { error: 'This product has no BOM, saved cutlist costing, labour, or overhead to snapshot', code: 'product_has_no_costing' },
        { status: 422 }
      );
    }

    return NextResponse.json({ clusters: result.clusters, created: result.created });
  } catch (error) {
    console.error('[quote-item-costing POST] failed', {
      quoteItemId: id,
      productId: quoteItemForLog?.product_id ?? null,
      orgId: auth.orgId,
      action: actionForLog,
      ...(serializeRouteError(error as any)),
    });
    return NextResponse.json(routeErrorResponse(error), { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const auth = await requireQuoteItemAccess(request, id);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const lineId = typeof body?.line_id === 'string' ? body.line_id : null;
  const action = typeof body?.action === 'string' ? body.action : 'unit_cost';

  if (!lineId) {
    return NextResponse.json({ error: 'line_id is required' }, { status: 400 });
  }

  try {
    const clusters = await fetchQuoteItemClustersForCosting(supabaseAdmin, id, auth.orgId);
    const clusterIds = new Set(clusters.map((cluster) => cluster.id));
    if (clusterIds.size === 0) {
      return NextResponse.json({ error: 'Quote item has no costing cluster' }, { status: 404 });
    }

    const { data: line, error: lineError } = await supabaseAdmin
      .from('quote_cluster_lines')
      .select('id, cluster_id, org_id, cutlist_slot, unit_cost, unit_price')
      .eq('id', lineId)
      .eq('org_id', auth.orgId)
      .maybeSingle();

    if (lineError) throw lineError;
    if (!line || !clusterIds.has(String(line.cluster_id))) {
      return NextResponse.json({ error: 'Costing line not found for quote item' }, { status: 404 });
    }

    if (!isEditableQuoteCostingLine({ cutlist_slot: line.cutlist_slot as string | null })) {
      return NextResponse.json({ error: 'Only board and edging quote costs are editable here' }, { status: 422 });
    }

    // This route updates quote_cluster_lines only. It must not update quote_items,
    // because quote_items has surcharge/total triggers that must not fire for quote-only costing edits.
    const baselineUnitCost = line.unit_price == null ? line.unit_cost : line.unit_price;

    let updatePayload: Record<string, unknown>;
    if (action === 'cost_surcharge') {
      if (baselineUnitCost == null || !Number.isFinite(Number(baselineUnitCost))) {
        return NextResponse.json({ error: 'Source unit cost is required before applying a line surcharge' }, { status: 422 });
      }
      const baseline = Math.round(Number(baselineUnitCost) * 100) / 100;
      const kind = body?.cost_surcharge_kind === 'percentage' ? 'percentage' : body?.cost_surcharge_kind === 'fixed' ? 'fixed' : null;
      const value = Number(body?.cost_surcharge_value);
      if (!kind) {
        return NextResponse.json({ error: 'cost_surcharge_kind must be fixed or percentage' }, { status: 400 });
      }
      if (!Number.isFinite(value)) {
        return NextResponse.json({ error: 'cost_surcharge_value must be a number' }, { status: 400 });
      }
      const { resolved, unitCost } = applyQuoteCostLineSurcharge(kind, value, baseline);
      if (unitCost < 0) {
        return NextResponse.json({ error: 'Line surcharge cannot reduce quote cost below zero' }, { status: 400 });
      }
      updatePayload = {
        unit_cost: unitCost,
        unit_price: baseline,
        cost_surcharge_kind: kind,
        cost_surcharge_value: Math.round(value * 100) / 100,
        cost_surcharge_label: typeof body?.cost_surcharge_label === 'string' && body.cost_surcharge_label.trim()
          ? body.cost_surcharge_label.trim()
          : null,
        cost_surcharge_resolved: resolved,
      };
    } else if (action === 'clear_cost_surcharge') {
      if (baselineUnitCost == null || !Number.isFinite(Number(baselineUnitCost))) {
        return NextResponse.json({ error: 'Source unit cost is required before clearing a line surcharge' }, { status: 422 });
      }
      const baseline = Math.round(Number(baselineUnitCost) * 100) / 100;
      updatePayload = {
        unit_cost: baseline,
        unit_price: baseline,
        cost_surcharge_kind: null,
        cost_surcharge_value: null,
        cost_surcharge_label: null,
        cost_surcharge_resolved: null,
      };
    } else {
      const nextUnitCost = Number(body?.unit_cost);
      if (!Number.isFinite(nextUnitCost) || nextUnitCost < 0) {
        return NextResponse.json({ error: 'unit_cost must be a non-negative number' }, { status: 400 });
      }
      const roundedCost = Math.round(nextUnitCost * 100) / 100;
      const baseline = baselineUnitCost == null || !Number.isFinite(Number(baselineUnitCost))
        ? roundedCost
        : Math.round(Number(baselineUnitCost) * 100) / 100;
      updatePayload = {
        unit_cost: roundedCost,
        unit_price: baseline,
        cost_surcharge_kind: null,
        cost_surcharge_value: null,
        cost_surcharge_label: null,
        cost_surcharge_resolved: null,
      };
    }

    const { error: updateError } = await supabaseAdmin
      .from('quote_cluster_lines')
      .update(updatePayload)
      .eq('id', lineId)
      .eq('org_id', auth.orgId);

    if (updateError) throw updateError;

    const updatedClusters = await fetchQuoteItemClustersForCosting(supabaseAdmin, id, auth.orgId);
    return NextResponse.json({ clusters: updatedClusters });
  } catch (error) {
    console.error('[quote-item-costing PATCH] failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update quote costing line' },
      { status: 500 }
    );
  }
}
