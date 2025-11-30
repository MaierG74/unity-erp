import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  try {
    // Initialize Supabase client
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

    // Check if product code already exists
    const { data: existingProduct, error: checkError } = await supabaseAdmin
      .from('products')
      .select('product_id')
      .eq('internal_code', internal_code)
      .single();

    if (existingProduct) {
      return NextResponse.json(
        { error: 'Product code already exists' },
        { status: 409 }
      );
    }

    // Create the product
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .insert({
        internal_code,
        name,
        description
      })
      .select()
      .single();

    if (productError) {
      console.error('Error creating product:', productError);
      return NextResponse.json(
        { error: 'Failed to create product' },
        { status: 500 }
      );
    }

    // Add category assignments if provided
    if (categories.length > 0) {
      const categoryAssignments = categories.map((catId: number) => ({
        product_id: product.product_id,
        product_cat_id: catId
      }));

      const { error: categoryError } = await supabaseAdmin
        .from('product_category_assignments')
        .insert(categoryAssignments);

      if (categoryError) {
        console.error('Error adding categories:', categoryError);
        // Don't fail the whole operation for category errors
      }
    }

    // Add images if provided
    if (images.length > 0) {
      const imageRecords = images.map((image: any) => ({
        product_id: product.product_id,
        image_url: image.url,
        is_primary: image.is_primary || false,
        display_order: image.display_order || 0,
        alt_text: image.alt_text || null
      }));

      const { error: imageError } = await supabaseAdmin
        .from('product_images')
        .insert(imageRecords);

      if (imageError) {
        console.error('Error adding images:', imageError);
        // Don't fail the whole operation for image errors
      }
    }

    return NextResponse.json({
      success: true,
      product,
      message: 'Product created successfully'
    });

  } catch (error) {
    console.error('Unhandled error in product creation:', error);
    return NextResponse.json(
      { error: 'Server error', details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: products, error } = await supabaseAdmin
      .from('products')
      .select(`
        product_id,
        internal_code,
        name,
        description
      `)
      .order('name');

    if (error) {
      console.error('Error fetching products:', error);
      return NextResponse.json(
        { error: 'Failed to fetch products' },
        { status: 500 }
      );
    }

    return NextResponse.json({ products: products || [] });
  } catch (error) {
    console.error('Unhandled error in products fetch:', error);
    return NextResponse.json(
      { error: 'Server error', details: String(error) },
      { status: 500 }
    );
  }
}
