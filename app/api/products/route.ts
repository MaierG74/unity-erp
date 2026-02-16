import { NextRequest, NextResponse } from 'next/server';

import { requireModuleAccess } from '@/lib/api/module-access';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { supabaseAdmin } from '@/lib/supabase-admin';

type ProductImageInput = {
  url?: string;
  is_primary?: boolean;
  display_order?: number;
  alt_text?: string | null;
};

type ProductPayload = {
  internal_code?: string;
  name?: string;
  description?: string | null;
  categories?: number[];
  images?: ProductImageInput[];
};

type ProductsAccess = {
  orgId: string;
};

function normalizeCategories(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function normalizeImages(input: unknown): ProductImageInput[] {
  if (!Array.isArray(input)) return [];
  return input.filter((item) => item && typeof item === 'object') as ProductImageInput[];
}

async function requireProductsAccess(request: NextRequest): Promise<{ error: NextResponse } | ProductsAccess> {
  const access = await requireModuleAccess(request, MODULE_KEYS.PRODUCTS_BOM, {
    forbiddenMessage: 'Products module access is disabled for your organization',
  });
  if ('error' in access) return { error: access.error };

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

export async function POST(request: NextRequest) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  try {
    let body: ProductPayload;
    try {
      body = (await request.json()) as ProductPayload;
    } catch (_err) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const internalCode = (body.internal_code ?? '').trim();
    const name = (body.name ?? '').trim();
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const categories = normalizeCategories(body.categories);
    const images = normalizeImages(body.images);

    if (!internalCode || !name) {
      return NextResponse.json({ error: 'Product code and name are required' }, { status: 400 });
    }

    const { data: existingProduct, error: checkError } = await supabaseAdmin
      .from('products')
      .select('product_id')
      .eq('internal_code', internalCode)
      .eq('org_id', auth.orgId)
      .maybeSingle();

    if (checkError) {
      console.error('Error checking product code:', checkError);
      return NextResponse.json({ error: 'Failed to validate product code' }, { status: 500 });
    }

    if (existingProduct) {
      return NextResponse.json(
        { error: 'Product code already exists for this organization' },
        { status: 409 }
      );
    }

    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .insert({
        internal_code: internalCode,
        name,
        description: description || null,
        org_id: auth.orgId,
      })
      .select('product_id, internal_code, name, description')
      .single();

    if (productError || !product) {
      console.error('Error creating product:', productError);
      return NextResponse.json({ error: 'Failed to create product' }, { status: 500 });
    }

    if (categories.length > 0) {
      const categoryAssignments = categories.map((catId) => ({
        product_id: product.product_id,
        product_cat_id: catId,
      }));

      const { error: categoryError } = await supabaseAdmin
        .from('product_category_assignments')
        .insert(categoryAssignments);

      if (categoryError) {
        console.error('Error adding categories:', categoryError);
      }
    }

    if (images.length > 0) {
      const imageRecords = images
        .filter((image) => typeof image.url === 'string' && image.url.trim().length > 0)
        .map((image) => ({
          product_id: product.product_id,
          image_url: image.url!.trim(),
          is_primary: Boolean(image.is_primary),
          display_order: Number.isFinite(Number(image.display_order)) ? Number(image.display_order) : 0,
          alt_text: typeof image.alt_text === 'string' ? image.alt_text.trim() || null : null,
        }));

      if (imageRecords.length > 0) {
        const { error: imageError } = await supabaseAdmin.from('product_images').insert(imageRecords);
        if (imageError) {
          console.error('Error adding images:', imageError);
        }
      }
    }

    return NextResponse.json(
      {
        success: true,
        product,
        message: 'Product created successfully',
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Unhandled error in product creation:', error);
    return NextResponse.json({ error: 'Server error', details: String(error) }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  try {
    const { data: products, error } = await supabaseAdmin
      .from('products')
      .select('product_id, internal_code, name, description')
      .eq('org_id', auth.orgId)
      .order('name');

    if (error) {
      console.error('Error fetching products:', error);
      return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 });
    }

    return NextResponse.json({ products: products ?? [] });
  } catch (error) {
    console.error('Unhandled error in products fetch:', error);
    return NextResponse.json({ error: 'Server error', details: String(error) }, { status: 500 });
  }
}
