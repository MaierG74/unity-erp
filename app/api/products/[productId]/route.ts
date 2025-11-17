import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ productId: string }> }
) {
  try {
    const { productId: productIdParam } = await context.params;
    const productId = parseInt(productIdParam, 10);
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Fetch product with all related data
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .select(`
        product_id,
        internal_code,
        name,
        description
      `)
      .eq('product_id', productId)
      .single();

    if (productError) {
      console.error('Error fetching product:', productError);
      return NextResponse.json(
        { error: 'Product not found' },
        { status: 404 }
      );
    }

    // Fetch categories
    const { data: categories, error: catError } = await supabaseAdmin
      .from('product_category_assignments')
      .select(`
        product_cat_id,
        product_categories!inner(product_cat_id, categoryname)
      `)
      .eq('product_id', productId);

    // Fetch images
    const { data: images, error: imgError } = await supabaseAdmin
      .from('product_images')
      .select('*')
      .eq('product_id', productId)
      .order('display_order', { ascending: true });

    const productWithRelations = {
      ...product,
      categories: categories ? categories.map(c => ({
        product_cat_id: c.product_cat_id,
        categoryname: (c as any).product_categories?.categoryname
      })) : [],
      images: images || []
    };

    return NextResponse.json({ product: productWithRelations });
  } catch (error) {
    console.error('Unhandled error in product fetch:', error);
    return NextResponse.json(
      { error: 'Server error', details: String(error) },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ productId: string }> }
) {
  try {
    const { productId: productIdParam } = await context.params;
    const productId = parseInt(productIdParam, 10);
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const body = await request.json();
    const { internal_code, name, description, categories = [], images = [] } = body;

    // Validate required fields
    if (!internal_code || !name) {
      return NextResponse.json(
        { error: 'Product code and name are required' },
        { status: 400 }
      );
    }

    // Check if another product with the same code already exists
    const { data: existingProduct, error: checkError } = await supabaseAdmin
      .from('products')
      .select('product_id')
      .eq('internal_code', internal_code)
      .neq('product_id', productId)
      .single();

    if (existingProduct) {
      return NextResponse.json(
        { error: 'Product code already exists for another product' },
        { status: 409 }
      );
    }

    // Update the product
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .update({
        internal_code,
        name,
        description
      })
      .eq('product_id', productId)
      .select()
      .single();

    if (productError) {
      console.error('Error updating product:', productError);
      return NextResponse.json(
        { error: 'Failed to update product' },
        { status: 500 }
      );
    }

    // Update category assignments
    if (categories.length >= 0) { // Allow empty array to clear categories
      // Remove existing categories
      await supabaseAdmin
        .from('product_category_assignments')
        .delete()
        .eq('product_id', productId);

      // Add new categories if any
      if (categories.length > 0) {
        const categoryAssignments = categories.map((catId: number) => ({
          product_id: productId,
          product_cat_id: catId
        }));

        const { error: categoryError } = await supabaseAdmin
          .from('product_category_assignments')
          .insert(categoryAssignments);

        if (categoryError) {
          console.error('Error updating categories:', categoryError);
        }
      }
    }

    return NextResponse.json({
      success: true,
      product,
      message: 'Product updated successfully'
    });

  } catch (error) {
    console.error('Unhandled error in product update:', error);
    return NextResponse.json(
      { error: 'Server error', details: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ productId: string }> }
) {
  try {
    const { productId: productIdParam } = await context.params;
    const productId = parseInt(productIdParam, 10);
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Check if product exists and is not referenced by orders
    const { data: orderCheck, error: orderError } = await supabaseAdmin
      .from('order_details')
      .select('order_detail_id')
      .eq('product_id', productId)
      .limit(1);

    if (orderError) {
      console.error('Error checking order references:', orderError);
      return NextResponse.json(
        { error: 'Error checking product references' },
        { status: 500 }
      );
    }

    if (orderCheck && orderCheck.length > 0) {
      return NextResponse.json(
        { error: 'Cannot delete product that is referenced by orders' },
        { status: 409 }
      );
    }

    // Delete the product (cascading will handle related records)
    const { error: deleteError } = await supabaseAdmin
      .from('products')
      .delete()
      .eq('product_id', productId);

    if (deleteError) {
      console.error('Error deleting product:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete product' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Product deleted successfully'
    });

  } catch (error) {
    console.error('Unhandled error in product deletion:', error);
    return NextResponse.json(
      { error: 'Server error', details: String(error) },
      { status: 500 }
    );
  }
}
