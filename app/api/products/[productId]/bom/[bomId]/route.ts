import { NextRequest, NextResponse } from 'next/server';

import {
  bomBelongsToProduct,
  parsePositiveInt,
  productExistsInOrg,
  requireProductsAccess,
  validateOrgScopedComponentRefs,
} from '@/lib/api/products-access';
import { supabaseAdmin } from '@/lib/supabase-admin';

type RouteParams = {
  productId?: string;
  bomId?: string;
};

type BomUpdatePayload = {
  component_id?: number | null;
  quantity_required?: number;
  supplier_component_id?: number | null;
  is_substitutable?: boolean | null;
  is_cutlist_item?: boolean | null;
  cutlist_category?: string | null;
  cutlist_dimensions?: Record<string, unknown> | null;
};

function extractBackerComponentId(cutlistDimensions: Record<string, unknown> | null): number | null {
  if (!cutlistDimensions || typeof cutlistDimensions !== 'object') return null;
  const laminate = (cutlistDimensions as { laminate?: unknown }).laminate;
  if (!laminate || typeof laminate !== 'object') return null;
  return parsePositiveInt(
    (laminate as { backer_component_id?: number | string | null }).backer_component_id ?? null
  );
}

export async function PATCH(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  const params = await context.params;
  const productId = parsePositiveInt(params.productId);
  const bomId = parsePositiveInt(params.bomId);
  if (!productId || !bomId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  const payload = (await request.json().catch(() => null)) as BomUpdatePayload | null;
  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const productExists = await productExistsInOrg(productId, auth.orgId);
    if (!productExists) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const belongs = await bomBelongsToProduct(productId, bomId);
    if (!belongs) {
      return NextResponse.json({ error: 'BOM row not found for product' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};

    if ('component_id' in payload) {
      const componentId =
        payload.component_id === null || payload.component_id === undefined
          ? null
          : parsePositiveInt(payload.component_id);
      const refError = await validateOrgScopedComponentRefs(auth.orgId, [{ componentId }]);
      if (refError) {
        return NextResponse.json({ error: refError }, { status: 400 });
      }
      updateData.component_id = componentId;
    }

    if ('supplier_component_id' in payload) {
      const supplierComponentId =
        payload.supplier_component_id === null || payload.supplier_component_id === undefined
          ? null
          : parsePositiveInt(payload.supplier_component_id);
      const refError = await validateOrgScopedComponentRefs(auth.orgId, [{ supplierComponentId }]);
      if (refError) {
        return NextResponse.json({ error: refError }, { status: 400 });
      }
      updateData.supplier_component_id = supplierComponentId;
    }

    if ('quantity_required' in payload) {
      const quantityRequired = Number(payload.quantity_required ?? 0);
      if (!Number.isFinite(quantityRequired) || quantityRequired <= 0) {
        return NextResponse.json({ error: 'quantity_required must be greater than 0' }, { status: 400 });
      }
      updateData.quantity_required = quantityRequired;
    }

    if ('is_substitutable' in payload) {
      updateData.is_substitutable = Boolean(payload.is_substitutable);
    }

    if ('is_cutlist_item' in payload) {
      updateData.is_cutlist_item =
        payload.is_cutlist_item === null || payload.is_cutlist_item === undefined
          ? false
          : Boolean(payload.is_cutlist_item);
    }

    if ('cutlist_category' in payload) {
      updateData.cutlist_category =
        typeof payload.cutlist_category === 'string' && payload.cutlist_category.trim().length > 0
          ? payload.cutlist_category.trim()
          : null;
    }

    if ('cutlist_dimensions' in payload) {
      const cutlistDimensions =
        payload.cutlist_dimensions && typeof payload.cutlist_dimensions === 'object'
          ? payload.cutlist_dimensions
          : null;
      const backerComponentId = extractBackerComponentId(cutlistDimensions);
      if (backerComponentId) {
        const backerError = await validateOrgScopedComponentRefs(auth.orgId, [{ componentId: backerComponentId }]);
        if (backerError) {
          return NextResponse.json({ error: backerError }, { status: 400 });
        }
      }
      updateData.cutlist_dimensions = cutlistDimensions;
    }

    const { data, error } = await supabaseAdmin
      .from('billofmaterials')
      .update(updateData)
      .eq('bom_id', bomId)
      .eq('product_id', productId)
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('[product-bom] failed updating BOM row', error);
      return NextResponse.json({ error: 'Failed to update BOM row' }, { status: 500 });
    }

    return NextResponse.json({ item: data });
  } catch (error) {
    console.error('[product-bom] unexpected patch error', error);
    return NextResponse.json({ error: 'Unexpected error while updating BOM row' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  const params = await context.params;
  const productId = parsePositiveInt(params.productId);
  const bomId = parsePositiveInt(params.bomId);
  if (!productId || !bomId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  try {
    const productExists = await productExistsInOrg(productId, auth.orgId);
    if (!productExists) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const belongs = await bomBelongsToProduct(productId, bomId);
    if (!belongs) {
      return NextResponse.json({ error: 'BOM row not found for product' }, { status: 404 });
    }

    const { error } = await supabaseAdmin
      .from('billofmaterials')
      .delete()
      .eq('bom_id', bomId)
      .eq('product_id', productId);

    if (error) {
      console.error('[product-bom] failed deleting BOM row', error);
      return NextResponse.json({ error: 'Failed to delete BOM row' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[product-bom] unexpected delete error', error);
    return NextResponse.json({ error: 'Unexpected error while deleting BOM row' }, { status: 500 });
  }
}
