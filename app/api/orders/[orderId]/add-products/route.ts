import { NextRequest, NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/api/module-access';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { buildBomSnapshot } from '@/lib/orders/build-bom-snapshot';
import { buildCutlistSnapshot } from '@/lib/orders/build-cutlist-snapshot';

type Substitution = {
  bom_id: number;
  component_id: number;
  supplier_component_id?: number | null;
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
      cutlist_snapshot: unknown;
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

      if (normalizedProductId) {
        try {
          // Build cutlist snapshot first (we need groupMap for BOM snapshot)
          // Derive materialOverrides from substitutions + BOM is_cutlist_item flags
          const materialOverrides = new Map<number, { component_id: number; name: string }>();

          if (substitutions.length > 0) {
            // Load BOM to identify cutlist items that were substituted
            const { data: bomRows } = await supabaseAdmin
              .from('billofmaterials')
              .select('bom_id, component_id, is_cutlist_item')
              .eq('product_id', normalizedProductId);

            for (const bomRow of bomRows ?? []) {
              if (!bomRow.is_cutlist_item) continue;
              const sub = substitutions.find(s => s.bom_id === bomRow.bom_id);
              if (sub && sub.component_id !== bomRow.component_id) {
                // Load the substitute component name
                const { data: comp } = await supabaseAdmin
                  .from('components')
                  .select('component_id, internal_code, description')
                  .eq('component_id', sub.component_id)
                  .eq('org_id', auth.orgId)
                  .maybeSingle();

                if (comp) {
                  materialOverrides.set(bomRow.component_id!, {
                    component_id: sub.component_id,
                    name: comp.description || comp.internal_code || String(sub.component_id),
                  });
                }
              }
            }
          }

          const { snapshot: cutlistSnap, groupMap } = await buildCutlistSnapshot(
            normalizedProductId,
            auth.orgId,
            materialOverrides
          );
          cutlistSnapshot = cutlistSnap;

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
        cutlist_snapshot: cutlistSnapshot,
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

    // Calculate total increase
    const totalIncrease = insertRows.reduce(
      (sum, detail) => sum + detail.unit_price * detail.quantity,
      0
    );

    // Get current total
    const { data: orderData, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('total_amount')
      .eq('order_id', orderId)
      .eq('org_id', auth.orgId)
      .maybeSingle();

    if (orderError) {
      console.error('[API] Error fetching order total:', orderError);
    }

    const currentTotal = orderData?.total_amount || 0;
    const newTotal = parseFloat(currentTotal) + totalIncrease;

    // Update order total
    const { error: updateError } = await supabaseAdmin
      .from('orders')
      .update({ total_amount: newTotal })
      .eq('order_id', orderId)
      .eq('org_id', auth.orgId);

    if (updateError) {
      console.error('[API] Error updating order total:', updateError);
    }

    return NextResponse.json({
      success: true,
      insertedDetails: insertedDetails || [],
      totalAmount: newTotal
    });
  } catch (error) {
    console.error('[API] Unhandled error:', error);
    return NextResponse.json(
      { error: 'Server error', details: String(error) },
      { status: 500 }
    );
  }
}
