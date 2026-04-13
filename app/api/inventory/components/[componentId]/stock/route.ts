import { NextRequest, NextResponse } from 'next/server';

import { requireModuleAccess } from '@/lib/api/module-access';
import { MODULE_KEYS } from '@/lib/modules/keys';

type StockPayload = {
  new_quantity?: unknown;
  reason?: unknown;
  notes?: unknown;
  transaction_type?: unknown;
  transaction_date?: unknown;
};

async function requireInventoryAccess(request: NextRequest) {
  const access = await requireModuleAccess(request, MODULE_KEYS.INVENTORY_STOCK_CONTROL, {
    forbiddenMessage: 'Inventory module access is disabled for your organization',
  });

  if ('error' in access) {
    return { error: access.error };
  }

  if (!access.orgId) {
    return {
      error: NextResponse.json(
        {
          error: 'Organization context is required for inventory stock updates',
          reason: 'missing_org_context',
          module_key: access.moduleKey,
        },
        { status: 403 }
      ),
    };
  }

  return access;
}

function parseComponentId(rawValue: string) {
  const value = Number.parseInt(rawValue, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseQuantity(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function normalizeOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeTransactionType(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : 'ADJUSTMENT';
  return normalized === 'OPENING_BALANCE' ? 'OPENING_BALANCE' : 'ADJUSTMENT';
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ componentId: string }> }
) {
  const auth = await requireInventoryAccess(request);
  if ('error' in auth) return auth.error;

  const { componentId: componentIdParam } = await context.params;
  const componentId = parseComponentId(componentIdParam);
  if (!componentId) {
    return NextResponse.json({ error: 'Invalid component id' }, { status: 400 });
  }

  let body: StockPayload;
  try {
    body = (await request.json()) as StockPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const newQuantity = parseQuantity(body.new_quantity);
  if (newQuantity == null) {
    return NextResponse.json({ error: 'new_quantity must be zero or greater' }, { status: 400 });
  }

  const reason = normalizeOptionalString(body.reason);
  const notes = normalizeOptionalString(body.notes);
  const transactionDate = normalizeOptionalString(body.transaction_date);
  const transactionType = normalizeTransactionType(body.transaction_type);

  const { data: component, error: componentError } = await auth.ctx.supabase
    .from('components')
    .select('component_id')
    .eq('component_id', componentId)
    .eq('org_id', auth.orgId)
    .maybeSingle();

  if (componentError) {
    console.error('[inventory][stock] Failed to validate component', componentError);
    return NextResponse.json({ error: 'Failed to validate component' }, { status: 500 });
  }

  if (!component) {
    return NextResponse.json({ error: 'Component not found' }, { status: 404 });
  }

  const { data, error } = await auth.ctx.supabase.rpc('record_component_stock_level', {
    p_component_id: componentId,
    p_new_quantity: newQuantity,
    p_reason: reason,
    p_notes: notes,
    p_transaction_date: transactionDate,
    p_transaction_type: transactionType,
  });

  if (error) {
    console.error('[inventory][stock] Failed to record stock level', error);
    return NextResponse.json({ error: error.message || 'Failed to record stock level' }, { status: 500 });
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result) {
    return NextResponse.json({ error: 'No stock result returned' }, { status: 500 });
  }

  return NextResponse.json({
    component_id: componentId,
    transaction_id: result.transaction_id ?? null,
    previous_quantity: Number(result.previous_quantity ?? 0),
    new_quantity: Number(result.new_quantity ?? newQuantity),
    delta: Number(result.delta ?? 0),
    transaction_type_name: result.transaction_type_name ?? transactionType,
  });
}
