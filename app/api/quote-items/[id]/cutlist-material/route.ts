import { NextRequest, NextResponse } from 'next/server';

import { requireModuleAccess } from '@/lib/api/module-access';
import { loadBoardEdgingPairLookup, loadCutlistLineMaterial } from '@/lib/cutlist/material-route-helpers';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { warnOnDerivedSurchargeFieldWrite } from '@/lib/orders/derived-field-warnings';
import type { CutlistPartOverride } from '@/lib/orders/snapshot-types';
import { buildQuoteCutlistSnapshot } from '@/lib/quotes/build-cutlist-snapshot';
import { supabaseAdmin } from '@/lib/supabase-admin';

async function requireQuotesAccess(request: NextRequest) {
  const access = await requireModuleAccess(request, MODULE_KEYS.QUOTING_PROPOSALS, {
    forbiddenMessage: 'Quoting module access is disabled for your organization',
  });

  if ('error' in access) return { error: access.error };

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

  return { orgId: access.orgId };
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireQuotesAccess(request);
  if ('error' in auth) return auth.error;

  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: 'Quote item id is required' }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Request body is required' }, { status: 400 });
  }

  warnOnDerivedSurchargeFieldWrite({
    route: `/api/quote-items/${id}/cutlist-material`,
    payload: body as Record<string, unknown>,
    callerInfo: { quoteItemId: id },
  });

  const { data: quoteItem, error: itemError } = await supabaseAdmin
    .from('quote_items')
    .select('id, quote_id, org_id, product_id, qty, unit_price, bom_snapshot')
    .eq('id', id)
    .eq('org_id', auth.orgId)
    .maybeSingle();

  if (itemError) return NextResponse.json({ error: itemError.message }, { status: 500 });
  if (!quoteItem) return NextResponse.json({ error: 'Quote item not found' }, { status: 404 });
  if (!quoteItem.product_id) {
    return NextResponse.json({ error: 'Quote item is not linked to a product' }, { status: 422 });
  }

  try {
    const partOverrides = Array.isArray(body.cutlist_part_overrides)
      ? (body.cutlist_part_overrides as CutlistPartOverride[])
      : [];
    const [pairLookup, linePrimary, lineBacker, lineEdging] = await Promise.all([
      loadBoardEdgingPairLookup(supabaseAdmin, auth.orgId),
      loadCutlistLineMaterial(supabaseAdmin, body.cutlist_primary_material_id, auth.orgId),
      loadCutlistLineMaterial(supabaseAdmin, body.cutlist_primary_backer_material_id, auth.orgId),
      loadCutlistLineMaterial(supabaseAdmin, body.cutlist_primary_edging_id, auth.orgId),
    ]);

    const { snapshot } = await buildQuoteCutlistSnapshot(Number(quoteItem.product_id), auth.orgId, {
      linePrimary,
      lineBacker,
      lineEdging,
      partOverrides,
      pairLookup,
    });

    const surchargeKind = body.cutlist_surcharge_kind === 'percentage' ? 'percentage' : 'fixed';
    const surchargeValue = Number(body.cutlist_surcharge_value ?? 0);

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('quote_items')
      .update({
        cutlist_material_snapshot: snapshot,
        cutlist_primary_material_id: linePrimary?.component_id ?? null,
        cutlist_primary_backer_material_id: lineBacker?.component_id ?? null,
        cutlist_primary_edging_id: lineEdging?.component_id ?? null,
        cutlist_part_overrides: partOverrides,
        cutlist_surcharge_kind: surchargeKind,
        cutlist_surcharge_value: Number.isFinite(surchargeValue) ? surchargeValue : 0,
        cutlist_surcharge_label: typeof body.cutlist_surcharge_label === 'string' && body.cutlist_surcharge_label.trim()
          ? body.cutlist_surcharge_label.trim()
          : null,
      })
      .eq('id', id)
      .eq('org_id', auth.orgId)
      .select('*')
      .single();

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
    return NextResponse.json({ item: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to update cutlist materials' }, { status: 500 });
  }
}
