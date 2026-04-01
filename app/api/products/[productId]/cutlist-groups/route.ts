import { NextRequest, NextResponse } from 'next/server';

import { requireProductsAccess } from '@/lib/api/products-access';
import { supabaseAdmin } from '@/lib/supabase-admin';

interface CutlistPart {
  id: string;
  name: string;
  length_mm: number;
  width_mm: number;
  quantity: number;
  grain: 'length' | 'width' | 'any';
  band_edges: {
    top: boolean;
    right: boolean;
    bottom: boolean;
    left: boolean;
  };
  material_label?: string;
  lamination_type?: 'same-board' | 'counter-balance' | 'veneer';
}

interface CutlistGroup {
  id?: number;
  name: string;
  board_type: string;
  primary_material_id?: string | null;
  primary_material_name?: string | null;
  backer_material_id?: string | null;
  backer_material_name?: string | null;
  parts: CutlistPart[];
  sort_order?: number;
}

function parseProductId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

async function ensureProductExists(productId: number, orgId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('products')
    .select('product_id')
    .eq('product_id', productId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data);
}

/**
 * GET /api/products/[productId]/cutlist-groups
 * Fetch all cutlist groups for a product
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  try {
    const { productId } = await params;
    const productIdNum = parseProductId(productId);

    if (!productIdNum) {
      return NextResponse.json({ error: 'Invalid product ID' }, { status: 400 });
    }

    const exists = await ensureProductExists(productIdNum, auth.orgId);
    if (!exists) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const { data, error } = await supabaseAdmin
      .from('product_cutlist_groups')
      .select('*')
      .eq('product_id', productIdNum)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('Error fetching cutlist groups:', error);
      return NextResponse.json({ error: 'Failed to fetch cutlist groups' }, { status: 500 });
    }

    return NextResponse.json({ groups: data ?? [] });
  } catch (error) {
    console.error('Error in GET cutlist-groups:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
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
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  try {
    const { productId } = await params;
    const productIdNum = parseProductId(productId);

    if (!productIdNum) {
      return NextResponse.json({ error: 'Invalid product ID' }, { status: 400 });
    }

    let body: { groups?: CutlistGroup[] };
    try {
      body = (await request.json()) as { groups?: CutlistGroup[] };
    } catch (_err) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { groups } = body;

    if (!Array.isArray(groups)) {
      return NextResponse.json({ error: 'Groups must be an array' }, { status: 400 });
    }

    const exists = await ensureProductExists(productIdNum, auth.orgId);
    if (!exists) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const { error: deleteError } = await supabaseAdmin
      .from('product_cutlist_groups')
      .delete()
      .eq('product_id', productIdNum);

    if (deleteError) {
      console.error('Error deleting existing groups:', deleteError);
      return NextResponse.json({ error: 'Failed to update cutlist groups' }, { status: 500 });
    }

    if (groups.length > 0) {
      const groupsToInsert = groups.map((group, index) => ({
        product_id: productIdNum,
        name: group.name || 'Unnamed Group',
        board_type: group.board_type || '16mm',
        primary_material_id: group.primary_material_id ? Number.parseInt(group.primary_material_id, 10) : null,
        primary_material_name: group.primary_material_name || null,
        backer_material_id: group.backer_material_id ? Number.parseInt(group.backer_material_id, 10) : null,
        backer_material_name: group.backer_material_name || null,
        parts: group.parts || [],
        sort_order: typeof group.sort_order === 'number' ? group.sort_order : index,
      }));

      const { data: insertedGroups, error: insertError } = await supabaseAdmin
        .from('product_cutlist_groups')
        .insert(groupsToInsert)
        .select();

      if (insertError) {
        console.error('Error inserting groups:', insertError);
        return NextResponse.json({ error: 'Failed to save cutlist groups' }, { status: 500 });
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
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
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
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  try {
    const { productId } = await params;
    const productIdNum = parseProductId(productId);

    if (!productIdNum) {
      return NextResponse.json({ error: 'Invalid product ID' }, { status: 400 });
    }

    const exists = await ensureProductExists(productIdNum, auth.orgId);
    if (!exists) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const { error } = await supabaseAdmin
      .from('product_cutlist_groups')
      .delete()
      .eq('product_id', productIdNum);

    if (error) {
      console.error('Error deleting cutlist groups:', error);
      return NextResponse.json({ error: 'Failed to delete cutlist groups' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Cutlist groups deleted',
    });
  } catch (error) {
    console.error('Error in DELETE cutlist-groups:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
