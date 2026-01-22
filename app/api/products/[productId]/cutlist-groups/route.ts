import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Create Supabase client with service role for API routes
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface CutlistPart {
  id: string;
  name: string;
  length_mm: number;
  width_mm: number;
  quantity: number;
  grain: 'length' | 'width' | 'none';
  band_edges: {
    top: boolean;
    right: boolean;
    bottom: boolean;
    left: boolean;
  };
  material_label?: string;
}

interface CutlistGroup {
  id?: number; // Database ID (optional for new groups)
  name: string;
  board_type: '16mm' | '32mm-both' | '32mm-backer';
  primary_material_id?: string;
  primary_material_name?: string;
  backer_material_id?: string;
  backer_material_name?: string;
  parts: CutlistPart[];
  sort_order?: number;
}

/**
 * GET /api/products/[productId]/cutlist-groups
 * Fetch all cutlist groups for a product
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const { productId } = await params;
    const productIdNum = parseInt(productId, 10);

    if (isNaN(productIdNum)) {
      return NextResponse.json(
        { error: 'Invalid product ID' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('product_cutlist_groups')
      .select('*')
      .eq('product_id', productIdNum)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('Error fetching cutlist groups:', error);
      return NextResponse.json(
        { error: 'Failed to fetch cutlist groups' },
        { status: 500 }
      );
    }

    return NextResponse.json({ groups: data || [] });
  } catch (error) {
    console.error('Error in GET cutlist-groups:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/products/[productId]/cutlist-groups
 * Save cutlist groups for a product (replaces all existing groups)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const { productId } = await params;
    const productIdNum = parseInt(productId, 10);

    if (isNaN(productIdNum)) {
      return NextResponse.json(
        { error: 'Invalid product ID' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { groups } = body as { groups: CutlistGroup[] };

    if (!Array.isArray(groups)) {
      return NextResponse.json(
        { error: 'Groups must be an array' },
        { status: 400 }
      );
    }

    // Verify product exists
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('product_id')
      .eq('product_id', productIdNum)
      .single();

    if (productError || !product) {
      return NextResponse.json(
        { error: 'Product not found' },
        { status: 404 }
      );
    }

    // Delete existing groups for this product
    const { error: deleteError } = await supabase
      .from('product_cutlist_groups')
      .delete()
      .eq('product_id', productIdNum);

    if (deleteError) {
      console.error('Error deleting existing groups:', deleteError);
      return NextResponse.json(
        { error: 'Failed to update cutlist groups' },
        { status: 500 }
      );
    }

    // Insert new groups if any
    if (groups.length > 0) {
      const groupsToInsert = groups.map((group, index) => ({
        product_id: productIdNum,
        name: group.name || 'Unnamed Group',
        board_type: group.board_type || '16mm',
        primary_material_id: group.primary_material_id ? parseInt(group.primary_material_id, 10) : null,
        primary_material_name: group.primary_material_name || null,
        backer_material_id: group.backer_material_id ? parseInt(group.backer_material_id, 10) : null,
        backer_material_name: group.backer_material_name || null,
        parts: group.parts || [],
        sort_order: index,
      }));

      const { data: insertedGroups, error: insertError } = await supabase
        .from('product_cutlist_groups')
        .insert(groupsToInsert)
        .select();

      if (insertError) {
        console.error('Error inserting groups:', insertError);
        return NextResponse.json(
          { error: 'Failed to save cutlist groups' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        groups: insertedGroups,
        message: `Saved ${insertedGroups.length} cutlist group(s)`,
      });
    }

    return NextResponse.json({
      success: true,
      groups: [],
      message: 'Cutlist groups cleared',
    });
  } catch (error) {
    console.error('Error in POST cutlist-groups:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/products/[productId]/cutlist-groups
 * Delete all cutlist groups for a product
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const { productId } = await params;
    const productIdNum = parseInt(productId, 10);

    if (isNaN(productIdNum)) {
      return NextResponse.json(
        { error: 'Invalid product ID' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('product_cutlist_groups')
      .delete()
      .eq('product_id', productIdNum);

    if (error) {
      console.error('Error deleting cutlist groups:', error);
      return NextResponse.json(
        { error: 'Failed to delete cutlist groups' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Cutlist groups deleted',
    });
  } catch (error) {
    console.error('Error in DELETE cutlist-groups:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
