import { NextRequest, NextResponse } from 'next/server';

import { requireModuleAccess } from '@/lib/api/module-access';
import { loadBoardEdgingPairLookup, loadCutlistLineMaterial } from '@/lib/cutlist/material-route-helpers';
import { MODULE_KEYS } from '@/lib/modules/keys';
import {
  calculateBomSnapshotLineSurchargeTotal,
  countDroppedBomSnapshotSubstitutions,
  substitutionsFromBomSnapshot,
} from '@/lib/orders/snapshot-utils';
import type { CutlistPartOverride } from '@/lib/orders/snapshot-types';
import { buildBomSnapshot } from '@/lib/quotes/build-bom-snapshot';
import { buildQuoteCutlistSnapshot } from '@/lib/quotes/build-cutlist-snapshot';
import { rebuildQuoteItemCostingCluster } from '@/lib/quotes/build-costing-cluster';
import { supabaseAdmin } from '@/lib/supabase-admin';

type RouteParams = {
  id?: string;
  itemId?: string;
};

type SnapshotSummary = {
  bom_entries: number;
  cutlist_groups: number;
  cutlist_pieces: number;
};

async function requireQuotesRefreshAccess(request: NextRequest) {
  const access = await requireModuleAccess(request, MODULE_KEYS.QUOTING_PROPOSALS, {
    forbiddenMessage: 'Quoting module access is disabled for your organization',
  });
  if ('error' in access) {
    return { error: access.error };
  }

  if (!access.orgId) {
    return {
      error: NextResponse.json(
        {
          error: 'Organization context is required for quotes access',
          reason: 'missing_org_context',
          module_key: access.moduleKey,
        },
        { status: 403 }
      ),
    };
  }

  return { orgId: access.orgId, userId: access.ctx.user.id };
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
  const auth = await requireQuotesRefreshAccess(request);
  if ('error' in auth) return auth.error;

  const { id: quoteId, itemId } = await context.params;
  if (!quoteId || !itemId) {
    return NextResponse.json({ error: 'Quote id and item id are required' }, { status: 400 });
  }

  try {
    const { data: quoteItem, error: itemError } = await supabaseAdmin
      .from('quote_items')
      .select(`
        id,
        quote_id,
        org_id,
        product_id,
        qty,
        unit_price,
        bom_snapshot,
        cutlist_material_snapshot,
        cutlist_primary_material_id,
        cutlist_primary_backer_material_id,
        cutlist_primary_edging_id,
        cutlist_part_overrides
      `)
      .eq('id', itemId)
      .eq('quote_id', quoteId)
      .eq('org_id', auth.orgId)
      .maybeSingle();

    if (itemError) return NextResponse.json({ error: itemError.message }, { status: 500 });
    if (!quoteItem) return NextResponse.json({ error: 'Quote item not found' }, { status: 404 });
    if (!quoteItem.product_id) {
      return NextResponse.json({ error: 'Quote item is not linked to a product' }, { status: 404 });
    }

    const productId = Number(quoteItem.product_id);
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .select('product_id')
      .eq('product_id', productId)
      .eq('org_id', auth.orgId)
      .maybeSingle();

    if (productError) return NextResponse.json({ error: productError.message }, { status: 500 });
    if (!product) {
      return NextResponse.json(
        { error: 'Referenced product no longer exists', code: 'product_missing' },
        { status: 422 }
      );
    }

    const partOverrides = Array.isArray(quoteItem.cutlist_part_overrides)
      ? (quoteItem.cutlist_part_overrides as CutlistPartOverride[])
      : [];
    const [pairLookup, linePrimary, lineBacker, lineEdging] = await Promise.all([
      loadBoardEdgingPairLookup(supabaseAdmin, auth.orgId),
      loadCutlistLineMaterial(supabaseAdmin, quoteItem.cutlist_primary_material_id, auth.orgId),
      loadCutlistLineMaterial(supabaseAdmin, quoteItem.cutlist_primary_backer_material_id, auth.orgId),
      loadCutlistLineMaterial(supabaseAdmin, quoteItem.cutlist_primary_edging_id, auth.orgId),
    ]);

    const { snapshot: cutlistMaterialSnapshot, groupMap } = await buildQuoteCutlistSnapshot(productId, auth.orgId, {
      linePrimary,
      lineBacker,
      lineEdging,
      partOverrides,
      pairLookup,
    });
    const substitutions = substitutionsFromBomSnapshot(quoteItem.bom_snapshot);
    const bomSnapshot = await buildBomSnapshot(productId, auth.orgId, substitutions, groupMap);
    const droppedSwaps = countDroppedBomSnapshotSubstitutions(substitutions, bomSnapshot);
    const surchargeTotal = calculateBomSnapshotLineSurchargeTotal(bomSnapshot, Number(quoteItem.qty ?? 0));
    const before = summarizeSnapshots(quoteItem.bom_snapshot, quoteItem.cutlist_material_snapshot);
    const after = summarizeSnapshots(bomSnapshot, cutlistMaterialSnapshot);

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('quote_items')
      .update({
        bom_snapshot: bomSnapshot,
        cutlist_material_snapshot: cutlistMaterialSnapshot,
        surcharge_total: surchargeTotal,
        snapshot_refreshed_at: new Date().toISOString(),
        snapshot_refreshed_by: auth.userId,
      })
      .eq('id', itemId)
      .eq('quote_id', quoteId)
      .eq('org_id', auth.orgId)
      .select('*')
      .single();

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    const costing = await rebuildQuoteItemCostingCluster({
      supabase: supabaseAdmin,
      quoteItemId: itemId,
      productId,
      orgId: auth.orgId,
      bomSnapshot,
      cutlistMaterialSnapshot,
      unitPrice: Number(quoteItem.unit_price ?? 0),
    });

    return NextResponse.json({
      item: { ...updated, quote_item_clusters: costing.clusters },
      summary: { before, after, dropped_swaps: droppedSwaps },
    });
  } catch (error: any) {
    console.error('[quote refresh-snapshot] failed', error);
    return NextResponse.json({ error: error?.message || 'Failed to refresh quote line snapshot' }, { status: 500 });
  }
}
