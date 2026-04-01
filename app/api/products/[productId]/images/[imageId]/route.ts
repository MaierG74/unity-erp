import { NextRequest, NextResponse } from 'next/server';

import { parsePositiveInt, productExistsInOrg, requireProductsAccess } from '@/lib/api/products-access';
import { supabaseAdmin } from '@/lib/supabase-admin';

type RouteParams = {
  productId?: string;
  imageId?: string;
};

type ImageUpdatePayload = {
  is_primary?: boolean;
  crop_params?: Record<string, unknown> | null;
};

async function imageBelongsToProduct(productId: number, imageId: number): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('product_images')
    .select('image_id')
    .eq('image_id', imageId)
    .eq('product_id', productId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data);
}

export async function PATCH(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  const params = await context.params;
  const productId = parsePositiveInt(params.productId);
  const imageId = parsePositiveInt(params.imageId);
  if (!productId || !imageId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  const payload = (await request.json().catch(() => null)) as ImageUpdatePayload | null;
  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const productExists = await productExistsInOrg(productId, auth.orgId);
    if (!productExists) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const belongs = await imageBelongsToProduct(productId, imageId);
    if (!belongs) {
      return NextResponse.json({ error: 'Image not found for product' }, { status: 404 });
    }

    if (payload.is_primary === true) {
      const { error: clearError } = await supabaseAdmin
        .from('product_images')
        .update({ is_primary: false })
        .eq('product_id', productId);

      if (clearError) {
        console.error('[product-images] failed clearing previous primary image', clearError);
        return NextResponse.json({ error: 'Failed to update image' }, { status: 500 });
      }
    }

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if ('crop_params' in payload) {
      updateData.crop_params =
        payload.crop_params && typeof payload.crop_params === 'object' ? payload.crop_params : null;
    }

    if (typeof payload.is_primary === 'boolean') {
      updateData.is_primary = payload.is_primary;
    }

    const { data, error } = await supabaseAdmin
      .from('product_images')
      .update(updateData)
      .eq('image_id', imageId)
      .eq('product_id', productId)
      .select('image_id, product_id, image_url, is_primary, crop_params')
      .maybeSingle();

    if (error) {
      console.error('[product-images] failed updating image', error);
      return NextResponse.json({ error: 'Failed to update image' }, { status: 500 });
    }

    return NextResponse.json({ image: data });
  } catch (error) {
    console.error('[product-images] unexpected patch error', error);
    return NextResponse.json({ error: 'Unexpected error while updating image' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  const params = await context.params;
  const productId = parsePositiveInt(params.productId);
  const imageId = parsePositiveInt(params.imageId);
  if (!productId || !imageId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  try {
    const productExists = await productExistsInOrg(productId, auth.orgId);
    if (!productExists) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const belongs = await imageBelongsToProduct(productId, imageId);
    if (!belongs) {
      return NextResponse.json({ error: 'Image not found for product' }, { status: 404 });
    }

    const { error } = await supabaseAdmin
      .from('product_images')
      .delete()
      .eq('image_id', imageId)
      .eq('product_id', productId);

    if (error) {
      console.error('[product-images] failed deleting image', error);
      return NextResponse.json({ error: 'Failed to delete image' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[product-images] unexpected delete error', error);
    return NextResponse.json({ error: 'Unexpected error while deleting image' }, { status: 500 });
  }
}
