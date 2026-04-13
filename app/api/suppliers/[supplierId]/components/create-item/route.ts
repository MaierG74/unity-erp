import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { requireModuleAccess } from '@/lib/api/module-access';
import { MODULE_KEYS } from '@/lib/modules/keys';

type CreateSupplierInventoryItemBody = {
  internal_code?: unknown;
  description?: unknown;
  unit_id?: unknown;
  category_id?: unknown;
  quantity_on_hand?: unknown;
  location?: unknown;
  reorder_level?: unknown;
  supplier_code?: unknown;
  price?: unknown;
  lead_time?: unknown;
  min_order_quantity?: unknown;
};

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parsePositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseNonNegativeNumber(value: unknown, fallback: number | null = null): number | null {
  if (value === '' || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

async function requireSuppliersAccess(request: NextRequest) {
  const access = await requireModuleAccess(request, MODULE_KEYS.SUPPLIERS_MANAGEMENT, {
    forbiddenMessage: 'Suppliers module access is disabled for your organization',
  });

  if ('error' in access) return { error: access.error };

  if (!access.orgId) {
    return {
      error: NextResponse.json(
        {
          error: 'Organization context is required for supplier component creation',
          reason: 'missing_org_context',
          module_key: access.moduleKey,
        },
        { status: 403 }
      ),
    };
  }

  return {
    orgId: access.orgId,
    supabase: access.ctx.supabase,
  };
}

async function rollbackCreatedComponent(
  supabase: SupabaseClient,
  orgId: string,
  componentId: number | null
) {
  if (!componentId) return;

  const cleanupSteps = [
    () =>
      supabase
        .from('suppliercomponents')
        .delete()
        .eq('component_id', componentId)
        .eq('org_id', orgId),
    () =>
      supabase
        .from('inventory')
        .delete()
        .eq('component_id', componentId)
        .eq('org_id', orgId),
    () =>
      supabase
        .from('components')
        .delete()
        .eq('component_id', componentId)
        .eq('org_id', orgId),
  ];

  for (const cleanupStep of cleanupSteps) {
    const { error } = await cleanupStep();
    if (error) {
      console.error('[suppliers:create-item] rollback failed', {
        componentId,
        orgId,
        message: error.message,
      });
    }
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ supplierId: string }> }
) {
  const auth = await requireSuppliersAccess(request);
  if ('error' in auth) return auth.error;

  const { supplierId: supplierIdParam } = await params;
  const supplierId = Number(supplierIdParam);
  if (!Number.isInteger(supplierId) || supplierId <= 0) {
    return NextResponse.json({ error: 'Invalid supplier id' }, { status: 400 });
  }

  let body: CreateSupplierInventoryItemBody;
  try {
    body = (await request.json()) as CreateSupplierInventoryItemBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const internalCode = normalizeString(body.internal_code);
  const description = normalizeString(body.description);
  const supplierCode = normalizeString(body.supplier_code);
  const location = normalizeString(body.location);
  const unitId = parsePositiveInteger(body.unit_id);
  const categoryId = parsePositiveInteger(body.category_id);
  const quantityOnHand = parseNonNegativeNumber(body.quantity_on_hand, 0);
  const reorderLevel = parseNonNegativeNumber(body.reorder_level, null);
  const price = parseNonNegativeNumber(body.price);
  const leadTime = parseNonNegativeNumber(body.lead_time, null);
  const minOrderQuantity = parseNonNegativeNumber(body.min_order_quantity, null);

  if (!internalCode) {
    return NextResponse.json({ error: 'Master code is required' }, { status: 400 });
  }
  if (!description) {
    return NextResponse.json({ error: 'Description is required' }, { status: 400 });
  }
  if (!unitId) {
    return NextResponse.json({ error: 'Unit is required' }, { status: 400 });
  }
  if (!categoryId) {
    return NextResponse.json({ error: 'Category is required' }, { status: 400 });
  }
  if (quantityOnHand === null) {
    return NextResponse.json({ error: 'Quantity on hand must be zero or greater' }, { status: 400 });
  }
  if (!supplierCode) {
    return NextResponse.json({ error: 'Supplier code is required' }, { status: 400 });
  }
  if (price === null) {
    return NextResponse.json({ error: 'Price must be zero or greater' }, { status: 400 });
  }

  const { data: supplier, error: supplierError } = await auth.supabase
    .from('suppliers')
    .select('supplier_id, name')
    .eq('supplier_id', supplierId)
    .eq('org_id', auth.orgId)
    .maybeSingle();

  if (supplierError) {
    console.error('[suppliers:create-item] supplier lookup failed', supplierError);
    return NextResponse.json({ error: 'Failed to validate supplier' }, { status: 500 });
  }

  if (!supplier) {
    return NextResponse.json({ error: 'Supplier not found in this organization' }, { status: 404 });
  }

  const { data: existingSupplierCode, error: supplierCodeError } = await auth.supabase
    .from('suppliercomponents')
    .select('supplier_component_id')
    .eq('supplier_id', supplierId)
    .eq('supplier_code', supplierCode)
    .eq('org_id', auth.orgId)
    .limit(1)
    .maybeSingle();

  if (supplierCodeError) {
    console.error('[suppliers:create-item] supplier code lookup failed', supplierCodeError);
    return NextResponse.json({ error: 'Failed to validate supplier code' }, { status: 500 });
  }

  if (existingSupplierCode) {
    return NextResponse.json(
      { error: `Supplier code "${supplierCode}" already exists for this supplier` },
      { status: 409 }
    );
  }

  const { data: existingComponent, error: existingComponentError } = await auth.supabase
    .from('components')
    .select('component_id')
    .eq('internal_code', internalCode)
    .eq('org_id', auth.orgId)
    .limit(1)
    .maybeSingle();

  if (existingComponentError) {
    console.error('[suppliers:create-item] component lookup failed', existingComponentError);
    return NextResponse.json({ error: 'Failed to validate master code' }, { status: 500 });
  }

  if (existingComponent) {
    return NextResponse.json(
      { error: `Master code "${internalCode}" already exists for this organization` },
      { status: 409 }
    );
  }

  let createdComponentId: number | null = null;

  try {
    const { data: component, error: componentError } = await auth.supabase
      .from('components')
      .insert({
        org_id: auth.orgId,
        internal_code: internalCode,
        description,
        unit_id: unitId,
        category_id: categoryId,
      })
      .select('component_id, internal_code, description')
      .single();

    if (componentError || !component) {
      const duplicateCode =
        componentError?.code === '23505' ||
        componentError?.message?.includes('components_internal_code_key');

      if (duplicateCode) {
        return NextResponse.json(
          { error: `Master code "${internalCode}" already exists` },
          { status: 409 }
        );
      }

      console.error('[suppliers:create-item] component insert failed', componentError);
      return NextResponse.json({ error: 'Failed to create master inventory item' }, { status: 500 });
    }

    createdComponentId = component.component_id;

    const { error: inventoryError } = await auth.supabase.from('inventory').insert({
      org_id: auth.orgId,
      component_id: createdComponentId,
      quantity_on_hand: 0,
      location: location || null,
      reorder_level: reorderLevel,
    });

    if (inventoryError) {
      console.error('[suppliers:create-item] inventory insert failed', inventoryError);
      await rollbackCreatedComponent(auth.supabase, auth.orgId, createdComponentId);
      return NextResponse.json({ error: 'Failed to create inventory record' }, { status: 500 });
    }

    const { data: supplierComponent, error: supplierComponentError } = await auth.supabase
      .from('suppliercomponents')
      .insert({
        org_id: auth.orgId,
        component_id: createdComponentId,
        supplier_id: supplierId,
        supplier_code: supplierCode,
        price,
        lead_time: leadTime,
        min_order_quantity: minOrderQuantity,
      })
      .select('supplier_component_id, supplier_code, price, lead_time, min_order_quantity')
      .single();

    if (supplierComponentError || !supplierComponent) {
      console.error('[suppliers:create-item] supplier component insert failed', supplierComponentError);
      await rollbackCreatedComponent(auth.supabase, auth.orgId, createdComponentId);
      return NextResponse.json({ error: 'Failed to create supplier mapping' }, { status: 500 });
    }

    if (quantityOnHand > 0) {
      const { error: openingBalanceError } = await auth.supabase.rpc('record_component_stock_level', {
        p_component_id: createdComponentId,
        p_new_quantity: quantityOnHand,
        p_reason: 'Opening Balance',
        p_notes: 'Initial stock entered during supplier item creation',
        p_transaction_type: 'OPENING_BALANCE',
      });

      if (openingBalanceError) {
        console.error('[suppliers:create-item] opening balance failed', openingBalanceError);
        await rollbackCreatedComponent(auth.supabase, auth.orgId, createdComponentId);
        return NextResponse.json({ error: 'Failed to record opening stock' }, { status: 500 });
      }
    }

    return NextResponse.json(
      {
        success: true,
        component,
        supplier_component: supplierComponent,
      },
      { status: 201 }
    );
  } catch (error) {
    await rollbackCreatedComponent(auth.supabase, auth.orgId, createdComponentId);
    console.error('[suppliers:create-item] unexpected error', error);
    return NextResponse.json({ error: 'Failed to create inventory item for supplier' }, { status: 500 });
  }
}
