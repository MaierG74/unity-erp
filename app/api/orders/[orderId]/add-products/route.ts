import { NextRequest, NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/api/module-access';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { buildBomSnapshot } from '@/lib/orders/build-bom-snapshot';
import { buildCutlistSnapshot } from '@/lib/orders/build-cutlist-snapshot';
import { fetchProductCutlistCostingSnapshot } from '@/lib/orders/cutlist-costing-freeze';
import { markCuttingPlanStale } from '@/lib/orders/cutting-plan-utils';
import { calculateBomSnapshotSurchargeTotal } from '@/lib/orders/snapshot-utils';

type Substitution = {
  bom_id: number;
  component_id?: number | null;
  supplier_component_id?: number | null;
  swap_kind?: 'default' | 'alternative' | 'removed';
  is_removed?: boolean;
  surcharge_amount?: number | string | null;
  surcharge_label?: string | null;
  note?: string;
};

type OrderProductInput = {
  product_id?: number | string;
  quantity?: number | string;
  unit_price?: number | string;
  substitutions?: Substitution[];
};

function parseOrderId(raw: string): number | null {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
}

async function requireOrdersAccess(request: NextRequest) {
  const access = await requireModuleAccess(request, MODULE_KEYS.ORDERS_FULFILLMENT, {
    forbiddenMessage: 'Orders module access is disabled for your organization',
  });
  if ('error' in access) {
    return { error: access.error };
  }

  if (!access.orgId) {
    return {
      error: NextResponse.json(
        {
          error: 'Organization context is required for orders access',
          reason: 'missing_org_context',
          module_key: access.moduleKey,
        },
        { status: 403 }
      ),
    };
  }

  return { orgId: access.orgId };
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ orderId: string }> }
) {
  const auth = await requireOrdersAccess(request);
  if ('error' in auth) return auth.error;

  try {
    const { orderId: orderIdParam } = await context.params;
    const orderId = parseOrderId(orderIdParam);
    const body = (await request.json()) as { products?: unknown[] };
    const { products } = body;

    console.log('[API] Adding products to order:', { orderId, productCount: Array.isArray(products) ? products.length : 0 });

    if (!orderId || !Array.isArray(products) || products.length === 0) {
      return NextResponse.json(
        { error: 'Invalid request parameters' },
        { status: 400 }
      );
    }

    // Verify order exists
    const { data: orderExists, error: orderCheckError } = await supabaseAdmin
      .from('orders')
      .select('order_id')
      .eq('order_id', orderId)
      .eq('org_id', auth.orgId)
      .maybeSingle();

    if (orderCheckError) {
      return NextResponse.json(
        { error: `Failed to validate order ${orderId}` },
        { status: 500 }
      );
    }

    if (!orderExists) {
      return NextResponse.json(
        { error: `Order with ID ${orderId} does not exist` },
        { status: 404 }
      );
    }

    // Build order_details rows with snapshots
    const insertRows: {
      order_id: number;
      org_id: string;
      product_id: number | null;
      quantity: number;
      unit_price: number;
      bom_snapshot: unknown;
      cutlist_material_snapshot: unknown;
      cutlist_costing_snapshot: unknown;
      cutlist_primary_material_id: number | null;
      cutlist_primary_backer_material_id: number | null;
      cutlist_primary_edging_id: number | null;
      cutlist_part_overrides: unknown[];
      surcharge_total: number;
    }[] = [];

    for (const detail of products) {
      const line = (detail ?? {}) as OrderProductInput;
      const productId = Number(line.product_id);
      const quantity = Number(line.quantity);
      const unitPrice = Number(line.unit_price);
      const substitutions: Substitution[] = Array.isArray(line.substitutions)
        ? line.substitutions
        : [];

      const normalizedProductId = Number.isFinite(productId) ? productId : null;
      const normalizedQuantity = Number.isFinite(quantity) ? quantity : 0;
      const normalizedUnitPrice = Number.isFinite(unitPrice) ? unitPrice : 0;

      let bomSnapshot: unknown = null;
      let cutlistSnapshot: unknown = null;
      let cutlistCostingSnapshot: unknown = null;

      if (normalizedProductId) {
        try {
          const { snapshot: cutlistSnap, groupMap } = await buildCutlistSnapshot(normalizedProductId, auth.orgId);
          cutlistSnapshot = cutlistSnap;
          cutlistCostingSnapshot = await fetchProductCutlistCostingSnapshot(supabaseAdmin, normalizedProductId);

          const bomSnap = await buildBomSnapshot(
            normalizedProductId,
            auth.orgId,
            substitutions,
            groupMap
          );
          bomSnapshot = bomSnap.length > 0 ? bomSnap : null;
        } catch (snapshotErr) {
          console.error(`[API] Error building snapshots for product ${normalizedProductId}:`, snapshotErr);
          // Continue without snapshots rather than failing the entire request
        }
      }

      insertRows.push({
        order_id: orderId,
        org_id: auth.orgId,
        product_id: normalizedProductId,
        quantity: normalizedQuantity,
        unit_price: normalizedUnitPrice,
        bom_snapshot: bomSnapshot,
        cutlist_material_snapshot: cutlistSnapshot,
        // Product "Save to Costing" is only a template. Freeze the costing basis
        // onto the order line so later product edits affect future lines only.
        cutlist_costing_snapshot: cutlistCostingSnapshot,
        cutlist_primary_material_id: null,
        cutlist_primary_backer_material_id: null,
        cutlist_primary_edging_id: null,
        cutlist_part_overrides: [],
        surcharge_total: calculateBomSnapshotSurchargeTotal(bomSnapshot),
      });
    }

    // Insert products into order_details
    const { data: insertedDetails, error: insertError } = await supabaseAdmin
      .from('order_details')
      .insert(insertRows as any)
      .select();

    if (insertError) {
      console.error('[API] Error inserting products:', insertError);
      return NextResponse.json(
        { error: 'Failed to add products to order', details: insertError },
        { status: 500 }
      );
    }

    // Mark cutting plan stale since products were added
    await markCuttingPlanStale(orderId, supabaseAdmin);

    return NextResponse.json({
      success: true,
      insertedDetails: insertedDetails || [],
    });
  } catch (error) {
    console.error('[API] Unhandled error:', error);
    return NextResponse.json(
      { error: 'Server error', details: String(error) },
      { status: 500 }
    );
  }
}
