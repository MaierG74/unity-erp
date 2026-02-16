import { NextRequest, NextResponse } from 'next/server';

import { requireModuleAccess } from '@/lib/api/module-access';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { supabaseAdmin } from '@/lib/supabase-admin';

type ProductPayload = {
  internal_code?: string;
  name?: string;
  description?: string | null;
  categories?: number[];
};

type CategoryAssignmentRow = {
  product_cat_id: number;
  product_categories: {
    product_cat_id: number;
    categoryname: string;
  } | null;
};

function parseProductId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function normalizeCategories(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const unique = new Set<number>();
  for (const value of input) {
    const n = Number(value);
    if (Number.isInteger(n) && n > 0) unique.add(n);
  }
  return Array.from(unique);
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

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ productId: string }> }
) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  try {
    const { productId: productIdParam } = await context.params;
    const productId = parseProductId(productIdParam);
    if (!productId) {
      return NextResponse.json({ error: 'Invalid product ID' }, { status: 400 });
    }

    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .select('product_id, internal_code, name, description')
      .eq('product_id', productId)
      .eq('org_id', auth.orgId)
      .maybeSingle();

    if (productError) {
      console.error('Error fetching product:', productError);
      return NextResponse.json({ error: 'Failed to fetch product' }, { status: 500 });
    }

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const { data: categories, error: categoryError } = await supabaseAdmin
      .from('product_category_assignments')
      .select('product_cat_id, product_categories!inner(product_cat_id, categoryname)')
      .eq('product_id', productId);

    if (categoryError) {
      console.error('Error fetching product categories:', categoryError);
      return NextResponse.json({ error: 'Failed to fetch product categories' }, { status: 500 });
    }

    const { data: images, error: imageError } = await supabaseAdmin
      .from('product_images')
      .select('*')
      .eq('product_id', productId)
      .order('display_order', { ascending: true });

    if (imageError) {
      console.error('Error fetching product images:', imageError);
      return NextResponse.json({ error: 'Failed to fetch product images' }, { status: 500 });
    }

    const categoryList = (categories ?? []).map((row) => {
      const assignment = row as unknown as CategoryAssignmentRow;
      return {
        product_cat_id: assignment.product_cat_id,
        categoryname: assignment.product_categories?.categoryname ?? '',
      };
    });

    return NextResponse.json({
      product: {
        ...product,
        categories: categoryList,
        images: images ?? [],
      },
    });
  } catch (error) {
    console.error('Unhandled error in product fetch:', error);
    return NextResponse.json({ error: 'Server error', details: String(error) }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ productId: string }> }
) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  try {
    const { productId: productIdParam } = await context.params;
    const productId = parseProductId(productIdParam);
    if (!productId) {
      return NextResponse.json({ error: 'Invalid product ID' }, { status: 400 });
    }

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

    if (!internalCode || !name) {
      return NextResponse.json({ error: 'Product code and name are required' }, { status: 400 });
    }

    const { data: existingProduct, error: checkError } = await supabaseAdmin
      .from('products')
      .select('product_id')
      .eq('internal_code', internalCode)
      .eq('org_id', auth.orgId)
      .neq('product_id', productId)
      .maybeSingle();

    if (checkError) {
      console.error('Error validating product code uniqueness:', checkError);
      return NextResponse.json({ error: 'Failed to validate product code' }, { status: 500 });
    }

    if (existingProduct) {
      return NextResponse.json({ error: 'Product code already exists for another product' }, { status: 409 });
    }

    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .update({
        internal_code: internalCode,
        name,
        description: description || null,
      })
      .eq('product_id', productId)
      .eq('org_id', auth.orgId)
      .select('product_id, internal_code, name, description')
      .maybeSingle();

    if (productError) {
      console.error('Error updating product:', productError);
      return NextResponse.json({ error: 'Failed to update product' }, { status: 500 });
    }

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const { error: categoryDeleteError } = await supabaseAdmin
      .from('product_category_assignments')
      .delete()
      .eq('product_id', productId);

    if (categoryDeleteError) {
      console.error('Error clearing product categories:', categoryDeleteError);
      return NextResponse.json({ error: 'Failed to update product categories' }, { status: 500 });
    }

    if (categories.length > 0) {
      const categoryAssignments = categories.map((catId) => ({
        product_id: productId,
        product_cat_id: catId,
      }));

      const { error: categoryInsertError } = await supabaseAdmin
        .from('product_category_assignments')
        .insert(categoryAssignments);

      if (categoryInsertError) {
        console.error('Error setting product categories:', categoryInsertError);
        return NextResponse.json({ error: 'Failed to update product categories' }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      product,
      message: 'Product updated successfully',
    });
  } catch (error) {
    console.error('Unhandled error in product update:', error);
    return NextResponse.json({ error: 'Server error', details: String(error) }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ productId: string }> }
) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  try {
    const { productId: productIdParam } = await context.params;
    const productId = parseProductId(productIdParam);
    if (!productId) {
      return NextResponse.json({ error: 'Invalid product ID' }, { status: 400 });
    }

    const { data: orderCheck, error: orderError } = await supabaseAdmin
      .from('order_details')
      .select('order_detail_id')
      .eq('product_id', productId)
      .eq('org_id', auth.orgId)
      .limit(1);

    if (orderError) {
      console.error('Error checking order references:', orderError);
      return NextResponse.json({ error: 'Error checking product references' }, { status: 500 });
    }

    if (orderCheck && orderCheck.length > 0) {
      return NextResponse.json(
        { error: 'Cannot delete product that is referenced by orders' },
        { status: 409 }
      );
    }

    const { data: deletedProduct, error: deleteError } = await supabaseAdmin
      .from('products')
      .delete()
      .eq('product_id', productId)
      .eq('org_id', auth.orgId)
      .select('product_id')
      .maybeSingle();

    if (deleteError) {
      console.error('Error deleting product:', deleteError);
      return NextResponse.json({ error: 'Failed to delete product' }, { status: 500 });
    }

    if (!deletedProduct) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: 'Product deleted successfully',
    });
  } catch (error) {
    console.error('Unhandled error in product deletion:', error);
    return NextResponse.json({ error: 'Server error', details: String(error) }, { status: 500 });
  }
}
