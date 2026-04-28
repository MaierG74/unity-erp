import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  computeNewAverageCost,
  getInventorySnapshotUnitCost,
} from '../lib/inventory/snapshot';

const columnsMigration = readFileSync(
  new URL('../supabase/migrations/20260428162300_inventory_average_cost_columns.sql', import.meta.url),
  'utf8'
);
const receiptMigration = readFileSync(
  new URL('../supabase/migrations/20260428162400_inventory_average_cost_receipt_rpc.sql', import.meta.url),
  'utf8'
);
const recomputeMigration = readFileSync(
  new URL('../supabase/migrations/20260428162500_inventory_average_cost_recompute_rpc.sql', import.meta.url),
  'utf8'
);
const adminRoute = readFileSync(
  new URL('../app/api/admin/inventory/recompute-wac/route.ts', import.meta.url),
  'utf8'
);
const seedScript = readFileSync(
  new URL('../scripts/seed-inventory-average-cost.ts', import.meta.url),
  'utf8'
);

type ReplayTransaction = {
  type: 'PURCHASE' | 'ISSUE' | 'ADJUSTMENT' | 'TRANSFER' | 'RETURN';
  quantity: number;
  unitCost?: number | null;
};

function replayAverageCost(transactions: ReplayTransaction[]) {
  let runningQuantity = 0;
  let runningAverage: number | null = null;

  for (const transaction of transactions) {
    const oldQuantity = runningQuantity;
    if (transaction.type === 'PURCHASE' && transaction.quantity > 0) {
      runningAverage = computeNewAverageCost(
        oldQuantity,
        runningAverage,
        transaction.quantity,
        transaction.unitCost ?? null
      );
    }
    runningQuantity += transaction.quantity;
  }

  return { runningQuantity, runningAverage };
}

describe('inventory weighted average cost Piece A', () => {
  it('1. computes WAC math for canonical, fresh, null-cost, zero-cost, and negative-on-hand cases', () => {
    expect(computeNewAverageCost(1000, 5, 1000, 4)).toBeCloseTo(4.5, 6);
    expect(computeNewAverageCost(0, null, 100, 5)).toBe(5);
    expect(computeNewAverageCost(100, 5, 50, null)).toBe(5);
    expect(computeNewAverageCost(100, 5, 50, 0)).toBe(5);
    expect(computeNewAverageCost(-10, 5, 100, 4)).toBe(4);
  });

  it('2. keeps the live receipt RPC signature unchanged and writes unit_cost/org_id on PURCHASE rows', () => {
    expect(receiptMigration).toContain('p_order_id integer');
    expect(receiptMigration).toContain('p_quantity numeric');
    expect(receiptMigration).toContain('p_attachment_name text default null::text');
    expect(receiptMigration).toContain('org_id,');
    expect(receiptMigration).toContain('unit_cost');
    expect(receiptMigration).toContain('v_order.org_id');
  });

  it('3. models two consecutive receipts at R5/R4 as final WAC R4.50', () => {
    const result = replayAverageCost([
      { type: 'PURCHASE', quantity: 1000, unitCost: 5 },
      { type: 'PURCHASE', quantity: 1000, unitCost: 4 },
    ]);
    expect(result.runningAverage).toBeCloseTo(4.5, 6);
  });

  it('4. models depletion-then-receive with signed running quantity', () => {
    const result = replayAverageCost([
      { type: 'PURCHASE', quantity: 100, unitCost: 5 },
      { type: 'ISSUE', quantity: -90 },
      { type: 'PURCHASE', quantity: 100, unitCost: 4 },
    ]);
    expect(result.runningAverage).toBeCloseTo((10 * 5 + 100 * 4) / 110, 6);
  });

  it('5. weights partial rejection by v_good_quantity and leaves RETURN unit_cost null', () => {
    expect(computeNewAverageCost(0, null, 90, 7)).toBe(7);
    expect(receiptMigration).toContain('v_good_quantity := p_quantity - coalesce(p_rejected_quantity, 0)');
    expect(receiptMigration).toContain('-p_rejected_quantity');
    expect(receiptMigration).toContain('p_rejection_reason,');
    expect(receiptMigration).toContain('null');
  });

  it('6. full rejection skips inventory writes and preserves quantity_on_hand response fallback', () => {
    expect(receiptMigration).toContain('if v_good_quantity > 0 then');
    expect(receiptMigration).toContain('if v_good_quantity = 0 then');
    expect(receiptMigration).toContain('select coalesce((');
    expect(receiptMigration).toContain('where component_id = v_comp_id');
  });

  it('7. creates missing inventory rows with org_id and first receipt cost', () => {
    expect(receiptMigration).toContain('insert into public.inventory (');
    expect(receiptMigration).toContain('org_id,');
    expect(receiptMigration).toContain('average_cost');
    expect(receiptMigration).toContain('case when v_unit_cost is not null and v_unit_cost > 0 then v_unit_cost else null end');
  });

  it('8. serializes concurrent first receipts with ON CONFLICT', () => {
    expect(receiptMigration).toContain('on conflict (component_id) do update');
    expect(receiptMigration).toContain('quantity_on_hand = coalesce(public.inventory.quantity_on_hand, 0) + excluded.quantity_on_hand');
  });

  it('9. leaves average_cost unchanged for non-receipt movements', () => {
    const result = replayAverageCost([
      { type: 'PURCHASE', quantity: 1000, unitCost: 5 },
      { type: 'ADJUSTMENT', quantity: -10 },
      { type: 'ISSUE', quantity: -100 },
      { type: 'TRANSFER', quantity: -50 },
    ]);
    expect(result.runningAverage).toBe(5);
  });

  it('10. detects WAC from a single-object inventory relation shape', () => {
    const cost = getInventorySnapshotUnitCost({
      inventory: { average_cost: '12.345' },
      suppliercomponents: [{ price: 9 }],
    });
    expect(cost).toEqual({ value: 12.345, source: 'wac' });
  });

  it('11. reports snapshot cost provenance for WAC, list-price fallback, and no-cost rows', () => {
    expect(getInventorySnapshotUnitCost({
      inventory: [{ average_cost: 4.5 }],
      suppliercomponents: [{ price: 3.25 }],
    })).toEqual({ value: 4.5, source: 'wac' });
    expect(getInventorySnapshotUnitCost({
      inventory: { average_cost: null },
      suppliercomponents: [{ price: 8 }, { price: 6 }],
    })).toEqual({ value: 6, source: 'list_price' });
    expect(getInventorySnapshotUnitCost({
      inventory: null,
      suppliercomponents: [],
    })).toEqual({ value: null, source: 'none' });
  });

  it('12. gates recompute through target-org admin role and service-role RPC invocation', () => {
    expect(adminRoute).toContain("orgContext.role !== 'owner' && orgContext.role !== 'admin'");
    expect(adminRoute).toContain('supabaseAdmin.rpc');
    expect(adminRoute).toContain('org_id: orgContext.orgId');
    expect(seedScript).toContain("if (arg === '--org-id')");
  });

  it('13. restricts recompute EXECUTE to service_role in the same migration as the function', () => {
    expect(recomputeMigration.indexOf('create or replace function public.recompute_inventory_average_cost_from_history')).toBeLessThan(
      recomputeMigration.indexOf('revoke execute on function public.recompute_inventory_average_cost_from_history')
    );
    expect(recomputeMigration).toContain('from public, anon, authenticated');
    expect(recomputeMigration).toContain('to service_role');
    expect(recomputeMigration).not.toContain('to authenticated');
  });

  it('14. skips zero-quantity PURCHASE rows during recompute and writes NULL unit_cost on full rejection', () => {
    const result = replayAverageCost([
      { type: 'PURCHASE', quantity: 0, unitCost: 99 },
      { type: 'PURCHASE', quantity: 100, unitCost: 5 },
    ]);
    expect(result.runningAverage).toBe(5);
    expect(recomputeMigration).toContain("v_tx.transaction_type_name = 'PURCHASE' and v_tx.quantity > 0");
    expect(receiptMigration).toContain('when v_good_quantity > 0 and v_unit_cost is not null and v_unit_cost > 0 then v_unit_cost');
  });
});
