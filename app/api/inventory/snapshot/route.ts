import { NextRequest, NextResponse } from 'next/server';

import { requireModuleAccess } from '@/lib/api/module-access';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  getInventorySnapshotUnitCost,
  INVENTORY_LEDGER_HARDENED_FROM,
  toFiniteNumberOrNull,
  type InventorySnapshotResponse,
  type InventorySnapshotRow,
} from '@/lib/inventory/snapshot';

// One row per component, returned by the public.inventory_snapshot_as_of RPC. The RPC does the
// aggregation in-DB (future-delta, ledger-total, min supplier price) so the route no longer pulls
// the raw components list or every future transaction into memory — which previously truncated
// silently at the PostgREST 1,000-row cap.
type SnapshotRpcRow = {
  out_component_id: number;
  out_internal_code: string | null;
  out_description: string | null;
  out_category_name: string | null;
  out_location: string | null;
  out_reorder_level: number | string | null;
  out_average_cost: number | string | null;
  out_min_supplier_price: number | string | null;
  out_current_quantity: number | string | null;
  out_future_delta: number | string | null;
  out_ledger_total: number | string | null;
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
    const RECONCILE_EPSILON = 0.001;

    // One aggregated round-trip. The RPC sums the future-delta, the full ledger, and the min
    // supplier price per component in-DB, so there is no 1,000-row truncation and no unbounded
    // payload in the serverless function. exclusiveAfter is the same ISO string the route always
    // built; Postgres coerces it to a naive `timestamp` (zone dropped) which reproduces the old
    // `.gte('transaction_date', exclusiveAfter)` comparison exactly (proven equivalent on live data).
    const { data: rpcRows, error: rpcError } = await supabaseAdmin.rpc('inventory_snapshot_as_of', {
      p_org_id: auth.orgId,
      p_exclusive_after: exclusiveAfter,
    });

    if (rpcError) {
      console.error('[inventory][snapshot] Failed to load inventory snapshot', rpcError);
      return NextResponse.json({ error: 'Failed to load inventory snapshot' }, { status: 500 });
    }

    const rows: InventorySnapshotRow[] = ((rpcRows ?? []) as SnapshotRpcRow[]).map((row) => {
      const currentQuantity = toNumber(row.out_current_quantity);
      const futureTransactionDelta = toNumber(row.out_future_delta);
      const snapshotQuantity = currentQuantity - futureTransactionDelta;

      // Cost precedence stays entirely in getInventorySnapshotUnitCost (WAC > 0, else min positive
      // list price, else none). We hand it the raw inputs the RPC returns, wrapping the single min
      // supplier price as a one-element list so minListPrice resolves it unchanged.
      const unitCost = includeEstimates
        ? getInventorySnapshotUnitCost({
            inventory: { average_cost: row.out_average_cost },
            suppliercomponents:
              row.out_min_supplier_price == null ? null : [{ price: row.out_min_supplier_price }],
          })
        : { value: null, source: 'none' as const };

      const estimatedValueCurrentCost =
        unitCost.value == null ? null : snapshotQuantity * unitCost.value;

      // Reconciliation: does current on-hand equal the sum of every recorded movement? When it
      // doesn't, the roll-back reconstruction for this component is unreliable at every date, so we
      // surface it instead of presenting it as fact. We do NOT alter the quantity.
      const ledgerTotal = toNumber(row.out_ledger_total);
      const reconciles = Math.abs(currentQuantity - ledgerTotal) <= RECONCILE_EPSILON;

      return {
        component_id: row.out_component_id,
        internal_code: normalizeInternalCode(row.out_component_id, row.out_internal_code),
        description: row.out_description ?? null,
        category_name: row.out_category_name?.trim() || null,
        location: row.out_location?.trim() || null,
        reorder_level: row.out_reorder_level == null ? null : toNumber(row.out_reorder_level),
        current_quantity: currentQuantity,
        future_transaction_delta: futureTransactionDelta,
        snapshot_quantity: snapshotQuantity,
        unit_cost: unitCost.value,
        cost_source: unitCost.source,
        estimated_unit_cost_current: unitCost.value,
        estimated_value_current_cost: estimatedValueCurrentCost,
        ledger_total: ledgerTotal,
        reconciles,
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
        if (!row.reconciles) acc.non_reconciling_components += 1;
        if (includeEstimates) {
          acc.estimated_total_value_current_cost += row.estimated_value_current_cost ?? 0;
        }
        return acc;
      },
      {
        total_components: 0,
        stocked_components: 0,
        total_quantity: 0,
        non_reconciling_components: 0,
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
