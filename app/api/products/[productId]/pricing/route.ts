import { NextRequest, NextResponse } from 'next/server';

import {
  parsePositiveInt,
  productExistsInOrg,
  requireProductsAccess,
} from '@/lib/api/products-access';
import { supabaseAdmin } from '@/lib/supabase-admin';

type MarkupType = 'percentage' | 'fixed';

type ProductPriceRow = {
  id: string;
  product_id: number;
  price_list_id: string;
  markup_type: MarkupType;
  markup_value: number | string;
  selling_price: number | string;
};

function normalizePrice(row: ProductPriceRow | null) {
  if (!row) return null;

  return {
    id: row.id,
    product_id: row.product_id,
    price_list_id: row.price_list_id,
    markup_type: row.markup_type,
    markup_value: Number(row.markup_value),
    selling_price: Number(row.selling_price),
  };
}

async function defaultPriceListId(orgId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('product_price_lists')
    .select('id')
    .eq('org_id', orgId)
    .eq('is_default', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data?.id as string | undefined) ?? null;
}

async function assertProductInOrg(productId: number, orgId: string) {
  const exists = await productExistsInOrg(productId, orgId);
  if (!exists) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  }
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  try {
    const { productId } = await params;
    const productIdNum = parsePositiveInt(productId);
    if (!productIdNum) {
      return NextResponse.json({ error: 'Invalid product ID' }, { status: 400 });
    }

    const productError = await assertProductInOrg(productIdNum, auth.orgId);
    if (productError) return productError;

    const priceListId = await defaultPriceListId(auth.orgId);
    if (!priceListId) {
      return NextResponse.json({ price: null, price_list_id: null });
    }

    const { data, error } = await supabaseAdmin
      .from('product_prices')
      .select('id, product_id, price_list_id, markup_type, markup_value, selling_price')
      .eq('product_id', productIdNum)
      .eq('price_list_id', priceListId)
      .eq('org_id', auth.orgId)
      .maybeSingle();

    if (error) {
      console.error('[product-pricing] failed loading price', error);
      return NextResponse.json({ error: 'Failed to load product pricing' }, { status: 500 });
    }

    return NextResponse.json({
      price: normalizePrice((data as ProductPriceRow | null) ?? null),
      price_list_id: priceListId,
    });
  } catch (error) {
    console.error('[product-pricing] unexpected load error', error);
    return NextResponse.json({ error: 'Unexpected error while loading product pricing' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  try {
    const { productId } = await params;
    const productIdNum = parsePositiveInt(productId);
    if (!productIdNum) {
      return NextResponse.json({ error: 'Invalid product ID' }, { status: 400 });
    }

    const productError = await assertProductInOrg(productIdNum, auth.orgId);
    if (productError) return productError;

    let body: { markupType?: unknown; markupValue?: unknown; sellingPrice?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const markupType = body.markupType;
    const markupValue = Number(body.markupValue);
    const sellingPrice = Number(body.sellingPrice);

    if (markupType !== 'percentage' && markupType !== 'fixed') {
      return NextResponse.json({ error: 'Invalid markup type' }, { status: 400 });
    }

    if (!Number.isFinite(markupValue) || markupValue < 0) {
      return NextResponse.json({ error: 'Invalid markup value' }, { status: 400 });
    }

    if (!Number.isFinite(sellingPrice) || sellingPrice < 0) {
      return NextResponse.json({ error: 'Invalid selling price' }, { status: 400 });
    }

    const priceListId = await defaultPriceListId(auth.orgId);
    if (!priceListId) {
      return NextResponse.json({ error: 'Default price list not found' }, { status: 409 });
    }

    const { data, error } = await supabaseAdmin
      .from('product_prices')
      .upsert(
        {
          org_id: auth.orgId,
          product_id: productIdNum,
          price_list_id: priceListId,
          markup_type: markupType,
          markup_value: markupValue,
          selling_price: sellingPrice,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'product_id,price_list_id' }
      )
      .select('id, product_id, price_list_id, markup_type, markup_value, selling_price')
      .single();

    if (error) {
      console.error('[product-pricing] failed saving price', error);
      return NextResponse.json({ error: 'Failed to save product pricing' }, { status: 500 });
    }

    return NextResponse.json({ price: normalizePrice(data as ProductPriceRow) });
  } catch (error) {
    console.error('[product-pricing] unexpected save error', error);
    return NextResponse.json({ error: 'Unexpected error while saving product pricing' }, { status: 500 });
  }
}
