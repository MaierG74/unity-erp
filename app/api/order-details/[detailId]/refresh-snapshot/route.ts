import { NextRequest, NextResponse } from 'next/server';

import { loadBoardEdgingPairLookup, loadCutlistLineMaterial } from '@/lib/cutlist/material-route-helpers';
import { buildBomSnapshot } from '@/lib/orders/build-bom-snapshot';
import { buildCutlistSnapshot } from '@/lib/orders/build-cutlist-snapshot';
import { fetchProductCutlistCostingSnapshot } from '@/lib/orders/cutlist-costing-freeze';
import { markCuttingPlanStaleForDetail } from '@/lib/orders/cutting-plan-utils';
import { calculateBomSnapshotSurchargeTotal } from '@/lib/orders/snapshot-utils';
import type { CutlistPartOverride } from '@/lib/orders/snapshot-types';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getRouteClient } from '@/lib/supabase-route';

type RouteParams = {
  detailId?: string;
};

type SnapshotSummary = {
  bom_entries: number;
  cutlist_groups: number;
  cutlist_pieces: number;
};

function parseDetailId(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function summarizeSnapshots(bomSnapshot: unknown, cutlistSnapshot: unknown): SnapshotSummary {
  const cutlistGroups = Array.isArray(cutlistSnapshot) ? cutlistSnapshot : [];
  return {
    bom_entries: Array.isArray(bomSnapshot) ? bomSnapshot.length : 0,
    cutlist_groups: cutlistGroups.length,
    cutlist_pieces: cutlistGroups.reduce((sum, group: any) => {
      const parts = Array.isArray(group?.parts) ? group.parts : [];
      return sum + parts.reduce((partSum: number, part: any) => {
        const qty = Number(part?.quantity ?? part?.qty ?? 1);
        return partSum + (Number.isFinite(qty) ? qty : 1);
      }, 0);
    }, 0),
  };
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<RouteParams> }
) {
  const routeClient = await getRouteClient(request);
  if ('error' in routeClient) {
    return NextResponse.json({ error: routeClient.error }, { status: routeClient.status ?? 401 });
  }

  const { detailId: detailIdParam } = await context.params;
  const detailId = parseDetailId(detailIdParam);
  if (!detailId) {
    return NextResponse.json({ error: 'Invalid order detail id' }, { status: 400 });
  }

  try {
    const { data: detail, error: detailError } = await routeClient.supabase
      .from('order_details')
      .select(`
        order_detail_id,
        order_id,
        org_id,
        product_id,
        bom_snapshot,
        cutlist_material_snapshot,
        cutlist_primary_material_id,
        cutlist_primary_backer_material_id,
        cutlist_primary_edging_id,
        cutlist_part_overrides
      `)
      .eq('order_detail_id', detailId)
      .maybeSingle();

    if (detailError) return NextResponse.json({ error: detailError.message }, { status: 500 });
    if (!detail) return NextResponse.json({ error: 'Order detail not found' }, { status: 404 });
    if (!detail.product_id) {
      return NextResponse.json({ error: 'Order detail is not linked to a product' }, { status: 404 });
    }

    const productId = Number(detail.product_id);
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .select('product_id')
      .eq('product_id', productId)
      .eq('org_id', detail.org_id)
      .maybeSingle();

    if (productError) return NextResponse.json({ error: productError.message }, { status: 500 });
    if (!product) {
      return NextResponse.json(
        { error: 'Referenced product no longer exists', code: 'product_missing' },
        { status: 422 }
      );
    }

    const partOverrides = Array.isArray(detail.cutlist_part_overrides)
      ? (detail.cutlist_part_overrides as CutlistPartOverride[])
      : [];
    const [pairLookup, linePrimary, lineBacker, lineEdging] = await Promise.all([
      loadBoardEdgingPairLookup(supabaseAdmin, detail.org_id),
      loadCutlistLineMaterial(supabaseAdmin, detail.cutlist_primary_material_id, detail.org_id),
      loadCutlistLineMaterial(supabaseAdmin, detail.cutlist_primary_backer_material_id, detail.org_id),
      loadCutlistLineMaterial(supabaseAdmin, detail.cutlist_primary_edging_id, detail.org_id),
    ]);

    const { snapshot: cutlistMaterialSnapshot, groupMap } = await buildCutlistSnapshot(productId, detail.org_id, {
      linePrimary,
      lineBacker,
      lineEdging,
      partOverrides,
      pairLookup,
    });
    const bomSnapshot = await buildBomSnapshot(productId, detail.org_id, [], groupMap);
    const cutlistCostingSnapshot = await fetchProductCutlistCostingSnapshot(supabaseAdmin, productId);
    const before = summarizeSnapshots(detail.bom_snapshot, detail.cutlist_material_snapshot);
    const after = summarizeSnapshots(bomSnapshot, cutlistMaterialSnapshot);

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('order_details')
      .update({
        bom_snapshot: bomSnapshot.length > 0 ? bomSnapshot : null,
        cutlist_material_snapshot: cutlistMaterialSnapshot,
        cutlist_costing_snapshot: cutlistCostingSnapshot,
        surcharge_total: calculateBomSnapshotSurchargeTotal(bomSnapshot),
        snapshot_refreshed_at: new Date().toISOString(),
        snapshot_refreshed_by: routeClient.user.id,
      })
      .eq('order_detail_id', detailId)
      .eq('org_id', detail.org_id)
      .select('*')
      .single();

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    await markCuttingPlanStaleForDetail(Number(detail.order_id), supabaseAdmin);

    return NextResponse.json({
      item: updated,
      summary: { before, after },
    });
  } catch (error: any) {
    console.error('[order detail refresh-snapshot] failed', error);
    return NextResponse.json({ error: error?.message || 'Failed to refresh order line snapshot' }, { status: 500 });
  }
}
