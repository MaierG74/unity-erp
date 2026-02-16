import { NextRequest, NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/api/module-access';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { supabaseAdmin } from '@/lib/supabase-admin';

type OrderProductInput = {
  product_id?: number | string;
  quantity?: number | string;
  unit_price?: number | string;
};

function parseOrderId(raw: string): number | null {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeOrderProducts(products: unknown[], orderId: number, orgId: string) {
  return products.map((detail) => {
    const line = (detail ?? {}) as OrderProductInput;
    const productId = Number(line.product_id);
    const quantity = Number(line.quantity);
    const unitPrice = Number(line.unit_price);
    return {
      order_id: orderId,
      org_id: orgId,
      product_id: Number.isFinite(productId) ? productId : null,
      quantity: Number.isFinite(quantity) ? quantity : 0,
      unit_price: Number.isFinite(unitPrice) ? unitPrice : 0,
    };
  });
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

    console.log('[API] Adding products to order:', { orderId, products });

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

    const normalizedProducts = normalizeOrderProducts(products, orderId, auth.orgId);

    // Insert products into order_details
    const { data: insertedDetails, error: insertError } = await supabaseAdmin
      .from('order_details')
      .insert(normalizedProducts)
      .select();

    if (insertError) {
      console.error('[API] Error inserting products:', insertError);
      return NextResponse.json(
        { error: 'Failed to add products to order', details: insertError },
        { status: 500 }
      );
    }

    // Calculate total increase
    const totalIncrease = normalizedProducts.reduce(
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
      // Continue anyway since products were added
    }

    const currentTotal = orderData?.total_amount || 0;
    const newTotal = parseFloat(currentTotal) + totalIncrease;

    // Update order total
    const { data: updateData, error: updateError } = await supabaseAdmin
      .from('orders')
      .update({ total_amount: newTotal })
      .eq('order_id', orderId)
      .eq('org_id', auth.orgId)
      .select();

    if (updateError) {
      console.error('[API] Error updating order total:', updateError);
      // Continue anyway since products were added
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
