import { NextRequest, NextResponse } from 'next/server';

import {
  parsePositiveInt,
  productExistsInOrg,
  requireProductsAccess,
  validateOrgScopedComponentRefs,
} from '@/lib/api/products-access';
import { supabaseAdmin } from '@/lib/supabase-admin';

type RouteParams = {
  productId?: string;
};

type BomPayload = {
  component_id?: number | null;
  quantity_required?: number;
  supplier_component_id?: number | null;
  is_cutlist_item?: boolean | null;
  cutlist_category?: string | null;
  cutlist_dimensions?: Record<string, unknown> | null;
};

type BomRequestBody = BomPayload | { items?: BomPayload[] };

function normalizeBomPayload(payload: BomPayload): Record<string, unknown> {
  const componentId =
    payload.component_id === null || payload.component_id === undefined
      ? null
      : parsePositiveInt(payload.component_id);
  const supplierComponentId =
    payload.supplier_component_id === null || payload.supplier_component_id === undefined
      ? null
      : parsePositiveInt(payload.supplier_component_id);
  const quantityRequired = Number(payload.quantity_required ?? 0);

  if (!Number.isFinite(quantityRequired) || quantityRequired <= 0) {
    throw new Error('quantity_required must be greater than 0');
  }

  return {
    component_id: componentId,
    quantity_required: quantityRequired,
    supplier_component_id: supplierComponentId,
    is_cutlist_item: payload.is_cutlist_item === null || payload.is_cutlist_item === undefined
      ? false
      : Boolean(payload.is_cutlist_item),
    cutlist_category:
      typeof payload.cutlist_category === 'string' && payload.cutlist_category.trim().length > 0
        ? payload.cutlist_category.trim()
        : null,
    cutlist_dimensions:
      payload.cutlist_dimensions && typeof payload.cutlist_dimensions === 'object'
        ? payload.cutlist_dimensions
        : null,
  };
}

function extractBackerComponentId(cutlistDimensions: Record<string, unknown> | null): number | null {
  if (!cutlistDimensions || typeof cutlistDimensions !== 'object') return null;
  const laminate = (cutlistDimensions as { laminate?: unknown }).laminate;
  if (!laminate || typeof laminate !== 'object') return null;
  return parsePositiveInt(
    (laminate as { backer_component_id?: number | string | null }).backer_component_id ?? null
  );
}

export async function POST(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  const params = await context.params;
  const productId = parsePositiveInt(params.productId);
  if (!productId) {
    return NextResponse.json({ error: 'Invalid product ID' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as BomRequestBody | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const rawItems = Array.isArray((body as { items?: BomPayload[] }).items)
    ? (body as { items: BomPayload[] }).items
    : [body as BomPayload];

  if (rawItems.length === 0) {
    return NextResponse.json({ error: 'At least one BOM item is required' }, { status: 400 });
  }

  try {
    const productExists = await productExistsInOrg(productId, auth.orgId);
    if (!productExists) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const normalizedItems = rawItems.map((item) => normalizeBomPayload(item));

    const refError = await validateOrgScopedComponentRefs(
      auth.orgId,
      normalizedItems.map((item) => ({
        componentId: parsePositiveInt(item.component_id as number | null | undefined),
        supplierComponentId: parsePositiveInt(item.supplier_component_id as number | null | undefined),
      }))
    );
    if (refError) {
      return NextResponse.json({ error: refError }, { status: 400 });
    }

    const backerRefs = normalizedItems
      .map((item) => extractBackerComponentId((item.cutlist_dimensions as Record<string, unknown> | null) ?? null))
      .filter((value): value is number => typeof value === 'number' && value > 0);
    if (backerRefs.length > 0) {
      const backerError = await validateOrgScopedComponentRefs(
        auth.orgId,
        backerRefs.map((componentId) => ({ componentId }))
      );
      if (backerError) {
        return NextResponse.json({ error: backerError }, { status: 400 });
      }
    }

    const insertRows = normalizedItems.map((item) => ({
      product_id: productId,
      component_id: item.component_id,
      quantity_required: item.quantity_required,
      supplier_component_id: item.supplier_component_id,
      is_cutlist_item: item.is_cutlist_item,
      cutlist_category: item.cutlist_category,
      cutlist_dimensions: item.cutlist_dimensions,
    }));

    const { data, error } = await supabaseAdmin
      .from('billofmaterials')
      .insert(insertRows)
      .select('*');

    if (error) {
      console.error('[product-bom] failed inserting BOM row(s)', error);
      return NextResponse.json({ error: 'Failed to save BOM rows' }, { status: 500 });
    }

    return NextResponse.json({
      items: data ?? [],
      item: data?.[0] ?? null,
    });
  } catch (error: any) {
    console.error('[product-bom] unexpected insert error', error);
    return NextResponse.json(
      { error: error?.message || 'Unexpected error while saving BOM rows' },
      { status: 500 }
    );
  }
}
