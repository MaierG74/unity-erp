import test from 'node:test';
import assert from 'node:assert/strict';
import { pickLineMaterialCost } from '../lib/orders/line-material-cost';
import type { CuttingPlan } from '../lib/orders/cutting-plan-types';

const freshPlan: CuttingPlan = {
  version: 1,
  generated_at: '2026-04-20T00:00:00Z',
  optimization_quality: 'balanced',
  stale: false,
  source_revision: 'abc123',
  material_groups: [],
  component_overrides: [],
  total_nested_cost: 800,
  line_allocations: [
    { order_detail_id: 1, area_mm2: 4_000_000, line_share_amount: 320, allocation_pct: 40 },
    { order_detail_id: 2, area_mm2: 6_000_000, line_share_amount: 480, allocation_pct: 60 },
  ],
};

test('branch 1: fresh plan + allocation → nested_real', () => {
  const result = pickLineMaterialCost({
    order_detail_id: 1,
    cutting_plan: freshPlan,
    padded: { padded_cost: 400, cutlist_portion: 400, non_cutlist_portion: 0 },
  });
  assert.equal(result.basis, 'nested_real');
  assert.equal(result.amount, 320);
  assert.equal(result.stale, false);
  assert.equal(result.source_cutting_plan_revision, 'abc123');
});

test('branch 2: stale plan → padded + stale flag', () => {
  const stalePlan: CuttingPlan = { ...freshPlan, stale: true };
  const result = pickLineMaterialCost({
    order_detail_id: 1,
    cutting_plan: stalePlan,
    padded: { padded_cost: 400, cutlist_portion: 400, non_cutlist_portion: 0 },
  });
  assert.equal(result.basis, 'padded');
  assert.equal(result.amount, 400);
  assert.equal(result.stale, true);
});

test('branch 3: no plan → padded fresh', () => {
  const result = pickLineMaterialCost({
    order_detail_id: 1,
    cutting_plan: null,
    padded: { padded_cost: 400, cutlist_portion: 400, non_cutlist_portion: 0 },
  });
  assert.equal(result.basis, 'padded');
  assert.equal(result.amount, 400);
  assert.equal(result.stale, false);
});

test('fresh plan but no allocation for this detail → padded + stale flag', () => {
  const result = pickLineMaterialCost({
    order_detail_id: 999, // not in allocations
    cutting_plan: freshPlan,
    padded: { padded_cost: 400, cutlist_portion: 400, non_cutlist_portion: 0 },
  });
  // Plan exists and is "fresh" by flag, but this line isn't covered — treat as stale
  assert.equal(result.basis, 'padded');
  assert.equal(result.stale, true);
});

test('nested_real preserves non-cutlist portion from padded input', () => {
  // Non-cutlist hardware shouldn't be nested — it's always added on top of allocated cutlist
  // (The current spec has cutting_plan total cover cutlist only; non-cutlist always padded.)
  const result = pickLineMaterialCost({
    order_detail_id: 1,
    cutting_plan: freshPlan,
    padded: { padded_cost: 500, cutlist_portion: 400, non_cutlist_portion: 100 },
  });
  // 320 (nested cutlist share) + 100 (non-cutlist) = 420
  assert.equal(result.amount, 420);
  assert.equal(result.basis, 'nested_real');
});
