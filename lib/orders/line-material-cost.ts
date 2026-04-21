import type { CuttingPlan } from './cutting-plan-types';
import type { PaddedLineCost } from './padded-line-cost';

export type LineMaterialCostBasis = 'padded' | 'nested_real';

export type LineMaterialCost = {
  amount: number;
  basis: LineMaterialCostBasis;
  stale: boolean;
  cutlist_portion: number;
  non_cutlist_portion: number;
  source_cutting_plan_revision?: string;
};

export type PickLineMaterialCostInput = {
  order_detail_id: number;
  cutting_plan: CuttingPlan | null;
  padded: PaddedLineCost;
};

/**
 * Pure branch-picker. Given an order detail's padded cost (pre-computed) and
 * the order's cutting_plan, return the amount to display on the line.
 *
 * Branches (spec §3):
 *   1. Fresh plan with allocation for this detail → nested_real cutlist share + padded non-cutlist
 *   2. Plan exists but stale → padded + stale flag
 *   3. Plan exists, not stale, but this line has no allocation (e.g. new line added
 *      after plan was generated and source_revision hasn't been recomputed yet)
 *      → padded + stale flag (defensive — treat missing allocation as staleness)
 *   4. No plan → padded, not stale
 */
export function pickLineMaterialCost(input: PickLineMaterialCostInput): LineMaterialCost {
  const { order_detail_id, cutting_plan, padded } = input;

  if (!cutting_plan) {
    return {
      amount: padded.padded_cost,
      basis: 'padded',
      stale: false,
      cutlist_portion: padded.cutlist_portion,
      non_cutlist_portion: padded.non_cutlist_portion,
    };
  }

  if (cutting_plan.stale) {
    return {
      amount: padded.padded_cost,
      basis: 'padded',
      stale: true,
      cutlist_portion: padded.cutlist_portion,
      non_cutlist_portion: padded.non_cutlist_portion,
      source_cutting_plan_revision: cutting_plan.source_revision,
    };
  }

  const allocation = cutting_plan.line_allocations.find(
    (a) => a.order_detail_id === order_detail_id,
  );
  if (!allocation) {
    return {
      amount: padded.padded_cost,
      basis: 'padded',
      stale: true,
      cutlist_portion: padded.cutlist_portion,
      non_cutlist_portion: padded.non_cutlist_portion,
      source_cutting_plan_revision: cutting_plan.source_revision,
    };
  }

  // Nested cutlist share + padded non-cutlist (non-cutlist never gets nested).
  // Defensive: non-finite inputs (NaN/Infinity from upstream corruption) fall back to 0
  // rather than silently propagating as `null` via JSON serialization. Same pattern as
  // computePaddedLineCost and allocateLinesByArea.
  const safeShare = Number.isFinite(allocation.line_share_amount)
    ? Math.max(0, allocation.line_share_amount)
    : 0;
  const safeNonCutlist = Number.isFinite(padded.non_cutlist_portion)
    ? Math.max(0, padded.non_cutlist_portion)
    : 0;
  const amount = Math.round((safeShare + safeNonCutlist) * 100) / 100;

  return {
    amount,
    basis: 'nested_real',
    stale: false,
    cutlist_portion: Math.round(safeShare * 100) / 100,
    non_cutlist_portion: safeNonCutlist,
    source_cutting_plan_revision: cutting_plan.source_revision,
  };
}
