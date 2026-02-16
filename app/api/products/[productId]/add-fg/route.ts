import { NextRequest, NextResponse } from 'next/server';

import { requireModuleAccess } from '@/lib/api/module-access';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { supabaseAdmin } from '@/lib/supabase-admin';

type RouteParams = { productId: string };

type AddFgPayload = {
  quantity?: number | string;
  location?: string | null;
};

type AddFgResponse = {
  success: true;
  product_id: number;
  location: string | null;
  quantity_added: number;
  new_on_hand: number;
  auto_consume: {
    applied: unknown[];
    warning?: string;
  };
};

function parseProductId(id: string | undefined): number | null {
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseLocation(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function requireProductsAccess(request: NextRequest) {
  const access = await requireModuleAccess(request, MODULE_KEYS.PRODUCTS_BOM, {
    forbiddenMessage: 'Products module access is disabled for your organization',
  });
  if ('error' in access) {
    return { error: access.error };
  }

  if (!access.orgId) {
    return {
      error: NextResponse.json(
        {
          error: 'Organization context is required for products access',
          reason: 'missing_org_context',
          module_key: access.moduleKey,
        },
        { status: 403 }
      ),
    };
  }

  return { orgId: access.orgId };
}

export async function POST(req: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await requireProductsAccess(req);
  if ('error' in auth) return auth.error;

  const { productId: productIdParam } = await context.params;
  const productId = parseProductId(productIdParam);
  if (!productId) {
    return NextResponse.json({ error: 'Invalid product ID' }, { status: 400 });
  }

  let body: AddFgPayload;
  try {
    body = (await req.json()) as AddFgPayload;
  } catch (_err) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const quantity = Number(body.quantity);
  const location = parseLocation(body.location);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return NextResponse.json({ error: 'Quantity must be a positive number' }, { status: 400 });
  }

  try {
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .select('product_id')
      .eq('product_id', productId)
      .eq('org_id', auth.orgId)
      .maybeSingle();

    if (productError) {
      console.error('[add-fg] Product lookup failed:', productError);
      return NextResponse.json({ error: 'Failed to validate product' }, { status: 500 });
    }

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    let autoConsume = false;
    try {
      const { data: settingsRow } = await supabaseAdmin
        .from('quote_company_settings')
        .select('fg_auto_consume_on_add')
        .eq('setting_id', 1)
        .single();
      autoConsume = Boolean(settingsRow?.fg_auto_consume_on_add);
    } catch (_err) {
      autoConsume = false;
    }

    let query = supabaseAdmin
      .from('product_inventory')
      .select('product_inventory_id, quantity_on_hand, location')
      .eq('product_id', productId)
      .eq('org_id', auth.orgId);

    if (location === null) {
      query = query.is('location', null);
    } else {
      query = query.eq('location', location);
    }

    const { data: inventoryRows, error: inventoryError } = await query.limit(1);
    if (inventoryError) throw inventoryError;

    const resultPayload: AddFgResponse = {
      success: true,
      product_id: productId,
      location,
      quantity_added: quantity,
      new_on_hand: 0,
      auto_consume: { applied: [] },
    };

    if (inventoryRows && inventoryRows.length > 0) {
      const row = inventoryRows[0];
      const currentOnHand = Number(row?.quantity_on_hand ?? 0);
      const newOnHand = currentOnHand + quantity;

      const { data: updated, error: updateError } = await supabaseAdmin
        .from('product_inventory')
        .update({ quantity_on_hand: newOnHand })
        .eq('product_inventory_id', row.product_inventory_id)
        .eq('org_id', auth.orgId)
        .select('product_inventory_id, product_id, quantity_on_hand, location')
        .single();
      if (updateError) throw updateError;

      resultPayload.new_on_hand = Number(updated?.quantity_on_hand ?? newOnHand);
    } else {
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('product_inventory')
        .insert({ product_id: productId, org_id: auth.orgId, quantity_on_hand: quantity, location })
        .select('product_inventory_id, product_id, quantity_on_hand, location')
        .single();
      if (insertError) throw insertError;

      resultPayload.new_on_hand = Number(inserted?.quantity_on_hand ?? quantity);
    }

    if (autoConsume) {
      const { data: applied, error: autoConsumeError } = await supabaseAdmin.rpc('auto_consume_on_add', {
        p_product_id: productId,
        p_quantity: quantity,
      });

      if (autoConsumeError) {
        resultPayload.auto_consume = { applied: [], warning: autoConsumeError.message };
      } else {
        resultPayload.auto_consume = { applied: applied || [] };
      }
    }

    return NextResponse.json(resultPayload);
  } catch (error) {
    console.error('[add-fg]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unexpected error while adding finished goods' },
      { status: 500 }
    );
  }
}
