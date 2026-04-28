import { NextRequest, NextResponse } from 'next/server';

import { requireModuleAccess } from '@/lib/api/module-access';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  getInventorySnapshotUnitCost,
  getRelationRecord,
  INVENTORY_LEDGER_HARDENED_FROM,
  toFiniteNumberOrNull,
  type InventorySnapshotResponse,
  type InventorySnapshotRow,
} from '@/lib/inventory/snapshot';

type ComponentSnapshotRow = {
  component_id: number;
  internal_code: string | null;
  description: string | null;
  category: { categoryname?: string | null } | Array<{ categoryname?: string | null }> | null;
  inventory:
    | {
        quantity_on_hand?: number | string | null;
        reorder_level?: number | string | null;
        location?: string | null;
        average_cost?: number | string | null;
      }
    | Array<{
        quantity_on_hand?: number | string | null;
        reorder_level?: number | string | null;
        location?: string | null;
        average_cost?: number | string | null;
      }>
    | null;
  suppliercomponents?: Array<{ price?: number | string | null }> | null;
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
          error: 'Organization context is required for inventory snapshot access',
          reason: 'missing_org_context',
          module_key: access.moduleKey,
        },
        { status: 403 }
      ),
    };
  }

  return { orgId: access.orgId };
}

function parseAsOfDate(rawValue: string | null) {
  if (!rawValue || !/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) {
    return null;
  }
  return rawValue;
}

function parseExclusiveAfter(asOfDate: string, rawValue: string | null) {
  if (rawValue) {
    const parsed = new Date(rawValue);
    if (Number.isFinite(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  const nextDay = new Date(`${asOfDate}T00:00:00`);
  nextDay.setDate(nextDay.getDate() + 1);
  return nextDay.toISOString();
}

function toNumber(value: number | string | null | undefined) {
  return toFiniteNumberOrNull(value) ?? 0;
}

function normalizeInternalCode(componentId: number, value: string | null) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : `UNCODED-${componentId}`;
}

function includeEstimatedValues(rawValue: string | null) {
  return rawValue === 'true' || rawValue === '1';
}

export async function GET(request: NextRequest) {
  const auth = await requireInventoryAccess(request);
  if ('error' in auth) return auth.error;

  const asOfDate = parseAsOfDate(request.nextUrl.searchParams.get('as_of'));
  if (!asOfDate) {
    return NextResponse.json({ error: 'Valid as_of date (YYYY-MM-DD) is required' }, { status: 400 });
  }

  const exclusiveAfter = parseExclusiveAfter(asOfDate, request.nextUrl.searchParams.get('exclusive_after'));
  const includeEstimates = includeEstimatedValues(
    request.nextUrl.searchParams.get('include_estimated_values')
  );

  try {
    const [{ data: components, error: componentError }, { data: futureTransactions, error: transactionError }] =
      await Promise.all([
        supabaseAdmin
          .from('components')
          .select(`
            component_id,
            internal_code,
            description,
            category:component_categories (
              categoryname
            ),
            inventory:inventory (
              quantity_on_hand,
              reorder_level,
              location,
              average_cost
            ),
            suppliercomponents (
              price
            )
          `)
          .eq('org_id', auth.orgId)
          .order('internal_code'),
        supabaseAdmin
          .from('inventory_transactions')
          .select('component_id, quantity')
          .eq('org_id', auth.orgId)
          .gte('transaction_date', exclusiveAfter),
      ]);

    if (componentError) {
      console.error('[inventory][snapshot] Failed to load components', componentError);
      return NextResponse.json({ error: 'Failed to load inventory components' }, { status: 500 });
    }

    if (transactionError) {
      console.error('[inventory][snapshot] Failed to load future transactions', transactionError);
      return NextResponse.json({ error: 'Failed to load inventory transactions' }, { status: 500 });
    }

    const futureDeltaByComponent = new Map<number, number>();
    for (const transaction of futureTransactions ?? []) {
      const componentId = Number(transaction.component_id);
      if (!Number.isFinite(componentId)) continue;
      const quantity = toNumber(transaction.quantity);
      futureDeltaByComponent.set(componentId, (futureDeltaByComponent.get(componentId) ?? 0) + quantity);
    }

    const rows: InventorySnapshotRow[] = ((components ?? []) as ComponentSnapshotRow[]).map((component) => {
      const inventory = getRelationRecord(component.inventory);
      const category = getRelationRecord(component.category);
      const currentQuantity = toNumber(inventory?.quantity_on_hand);
      const futureTransactionDelta = futureDeltaByComponent.get(component.component_id) ?? 0;
      const snapshotQuantity = currentQuantity - futureTransactionDelta;
      const unitCost = includeEstimates
        ? getInventorySnapshotUnitCost({
            inventory: component.inventory,
            suppliercomponents: component.suppliercomponents,
          })
        : { value: null, source: 'none' as const };
      const estimatedValueCurrentCost =
        unitCost.value == null ? null : snapshotQuantity * unitCost.value;

      return {
        component_id: component.component_id,
        internal_code: normalizeInternalCode(component.component_id, component.internal_code),
        description: component.description ?? null,
        category_name: category?.categoryname?.trim() || null,
        location: inventory?.location?.trim() || null,
        reorder_level:
          inventory?.reorder_level == null ? null : toNumber(inventory.reorder_level),
        current_quantity: currentQuantity,
        future_transaction_delta: futureTransactionDelta,
        snapshot_quantity: snapshotQuantity,
        unit_cost: unitCost.value,
        cost_source: unitCost.source,
        estimated_unit_cost_current: unitCost.value,
        estimated_value_current_cost: estimatedValueCurrentCost,
      };
    });

    rows.sort((a, b) => {
      if (b.snapshot_quantity !== a.snapshot_quantity) {
        return b.snapshot_quantity - a.snapshot_quantity;
      }
      return a.internal_code.localeCompare(b.internal_code);
    });

    const summary = rows.reduce(
      (acc, row) => {
        acc.total_components += 1;
        if (row.snapshot_quantity !== 0) acc.stocked_components += 1;
        acc.total_quantity += row.snapshot_quantity;
        if (includeEstimates) {
          acc.estimated_total_value_current_cost += row.estimated_value_current_cost ?? 0;
        }
        return acc;
      },
      {
        total_components: 0,
        stocked_components: 0,
        total_quantity: 0,
        estimated_total_value_current_cost: 0,
      }
    );

    const bestEffort = asOfDate < INVENTORY_LEDGER_HARDENED_FROM;

    const response: InventorySnapshotResponse = {
      as_of_date: asOfDate,
      exclusive_after: exclusiveAfter,
      best_effort: bestEffort,
      best_effort_reason: bestEffort
        ? `Before ${INVENTORY_LEDGER_HARDENED_FROM}, some stock adjustments were made without ledger entries. Quantities shown are approximate, and actual on-hand at the selected date may have been different.`
        : null,
      hardening_reference_date: INVENTORY_LEDGER_HARDENED_FROM,
      includes_estimated_values: includeEstimates,
      estimated_value_basis: includeEstimates ? 'weighted_average_cost_with_list_price_fallback' : 'none',
      estimated_value_disclaimer: includeEstimates
        ? 'Values use current weighted average cost where available, with current lowest supplier list price as a fallback.'
        : null,
      summary,
      rows,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[inventory][snapshot] Unexpected error', error);
    return NextResponse.json({ error: 'Failed to build inventory snapshot' }, { status: 500 });
  }
}
