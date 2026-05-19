import { NextRequest, NextResponse } from 'next/server';

import { requireQuoteItemAccess } from '@/lib/api/quotes-access';
import {
  ensureQuoteItemCostingCluster,
  fetchQuoteItemClustersForCosting,
} from '@/lib/quotes/build-costing-cluster';
import { isEditableQuoteCostingLine } from '@/lib/quotes/costing-tree';
import { supabaseAdmin } from '@/lib/supabase-admin';

async function loadQuoteItem(id: string, orgId: string) {
  const { data, error } = await supabaseAdmin
    .from('quote_items')
    .select('id, quote_id, org_id, product_id, bom_snapshot')
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) throw error;
  return data as { id: string; quote_id: string; org_id: string; product_id: number | null; bom_snapshot: unknown } | null;
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

  try {
    const quoteItem = await loadQuoteItem(id, auth.orgId);
    if (!quoteItem) return NextResponse.json({ error: 'Quote item not found' }, { status: 404 });
    if (!quoteItem.product_id) {
      return NextResponse.json({ error: 'Quote item is not linked to a product' }, { status: 422 });
    }

    const result = await ensureQuoteItemCostingCluster({
      supabase: supabaseAdmin,
      quoteItemId: id,
      productId: Number(quoteItem.product_id),
      orgId: auth.orgId,
      bomSnapshot: quoteItem.bom_snapshot,
    });

    if (result.lineCount === 0) {
      return NextResponse.json(
        { error: 'This product has no BOM, saved cutlist costing, labour, or overhead to snapshot', code: 'product_has_no_costing' },
        { status: 422 }
      );
    }

    return NextResponse.json({ clusters: result.clusters, created: result.created });
  } catch (error) {
    console.error('[quote-item-costing POST] failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to initialize quote costing' },
      { status: 500 }
    );
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
  const nextUnitCost = Number(body?.unit_cost);

  if (!lineId) {
    return NextResponse.json({ error: 'line_id is required' }, { status: 400 });
  }
  if (!Number.isFinite(nextUnitCost) || nextUnitCost < 0) {
    return NextResponse.json({ error: 'unit_cost must be a non-negative number' }, { status: 400 });
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
    const { error: updateError } = await supabaseAdmin
      .from('quote_cluster_lines')
      .update({
        unit_cost: Math.round(nextUnitCost * 100) / 100,
        unit_price: baselineUnitCost,
      })
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
