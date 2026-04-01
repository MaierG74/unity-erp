import { NextRequest, NextResponse } from 'next/server';

import { parsePositiveInt, productExistsInOrg, requireProductsAccess } from '@/lib/api/products-access';
import { supabaseAdmin } from '@/lib/supabase-admin';

type RouteParams = {
  productId?: string;
};

type ImagePayload = {
  image_url?: string;
  is_primary?: boolean;
  crop_params?: Record<string, unknown> | null;
};

export async function POST(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  const params = await context.params;
  const productId = parsePositiveInt(params.productId);
  if (!productId) {
    return NextResponse.json({ error: 'Invalid product ID' }, { status: 400 });
  }

  const payload = (await request.json().catch(() => null)) as ImagePayload | null;
  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const imageUrl = typeof payload.image_url === 'string' ? payload.image_url.trim() : '';
  if (!imageUrl) {
    return NextResponse.json({ error: 'image_url is required' }, { status: 400 });
  }

  try {
    const productExists = await productExistsInOrg(productId, auth.orgId);
    if (!productExists) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    if (payload.is_primary) {
      const { error: clearError } = await supabaseAdmin
        .from('product_images')
        .update({ is_primary: false })
        .eq('product_id', productId);

      if (clearError) {
        console.error('[product-images] failed clearing previous primary image', clearError);
        return NextResponse.json({ error: 'Failed to save image' }, { status: 500 });
      }
    }

    const insertPayload = {
      product_id: productId,
      image_url: imageUrl,
      is_primary: Boolean(payload.is_primary),
      crop_params:
        payload.crop_params && typeof payload.crop_params === 'object' ? payload.crop_params : null,
    };

    const insertResult = await supabaseAdmin
      .from('product_images')
      .insert(insertPayload)
      .select('image_id, product_id, image_url, is_primary, crop_params')
      .single();

    if (insertResult.error && /crop_params/i.test(insertResult.error.message || '')) {
      const fallbackInsert = await supabaseAdmin
        .from('product_images')
        .insert({
          product_id: productId,
          image_url: imageUrl,
          is_primary: Boolean(payload.is_primary),
        })
        .select('image_id, product_id, image_url, is_primary')
        .single();

      if (fallbackInsert.error) {
        console.error('[product-images] failed inserting fallback image row', fallbackInsert.error);
        return NextResponse.json({ error: 'Failed to save image' }, { status: 500 });
      }

      return NextResponse.json({ image: fallbackInsert.data });
    }

    if (insertResult.error) {
      console.error('[product-images] failed inserting image row', insertResult.error);
      return NextResponse.json({ error: 'Failed to save image' }, { status: 500 });
    }

    return NextResponse.json({ image: insertResult.data });
  } catch (error) {
    console.error('[product-images] unexpected insert error', error);
    return NextResponse.json({ error: 'Unexpected error while saving image' }, { status: 500 });
  }
}
