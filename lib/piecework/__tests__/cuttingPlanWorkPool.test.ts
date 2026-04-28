import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCuttingPlanWorkPoolCandidates,
  reconcileCuttingPlanWorkPool,
  type ExistingCuttingPlanPoolRow,
} from '@/lib/piecework/cuttingPlanWorkPool';
import type { CuttingPlan } from '@/lib/orders/cutting-plan-types';

const activities = [
  { id: 'cut', code: 'cut_pieces', label: 'Cutting', default_rate: 6.5, target_role_id: 5 },
  { id: 'edge', code: 'edge_bundles', label: 'Edging', default_rate: 4, target_role_id: 8 },
];

function planWithPlacements(placements: CuttingPlan['material_groups'][number]['layouts'][number]['placements']): CuttingPlan {
  return {
    version: 1,
    generated_at: '2026-04-27T00:00:00.000Z',
    optimization_quality: 'balanced',
    stale: false,
    source_revision: 'rev-1',
    total_nested_cost: 0,
    line_allocations: [],
    component_overrides: [],
    material_groups: [
      {
        board_type: '16mm',
        primary_material_id: 10,
        primary_material_name: 'White',
        backer_material_id: null,
        backer_material_name: null,
        sheets_required: 1,
        backer_sheets_required: 0,
        edging_by_material: [],
        total_parts: placements.length,
        waste_percent: 0,
        bom_estimate_sheets: 1,
        bom_estimate_backer_sheets: 0,
        stock_sheet_spec: { length_mm: 2750, width_mm: 1830 },
        layouts: [{ sheet_id: 's1', placements }],
      },
    ],
  };
}

function existing(overrides: Partial<ExistingCuttingPlanPoolRow>): ExistingCuttingPlanPoolRow {
  return {
    pool_id: overrides.pool_id ?? 1,
    piecework_activity_id: overrides.piecework_activity_id ?? 'cut',
    material_color_label: overrides.material_color_label ?? 'White / 16mm',
    expected_count: overrides.expected_count ?? 2,
    required_qty: overrides.required_qty ?? 2,
    issued_qty: overrides.issued_qty ?? 0,
    status: overrides.status ?? 'active',
  };
}

test('org with zero active piecework activities produces zero work-pool candidates', () => {
  const plan = planWithPlacements([
    {
      part_id: 'plain',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      rot: 0,
      band_edges: { top: true, right: false, bottom: false, left: false },
      lamination_type: 'none',
    },
  ]);

  assert.deepEqual(buildCuttingPlanWorkPoolCandidates(123, plan, []), []);
});

test('finalized cutting plan creates cut rows and skips zero-count edge rows', () => {
  const plan = planWithPlacements([
    {
      part_id: 'plain',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      rot: 0,
      band_edges: { top: false, right: false, bottom: false, left: false },
      lamination_type: 'none',
    },
  ]);

  const candidates = buildCuttingPlanWorkPoolCandidates(123, plan, activities);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].piecework_activity_id, 'cut');
  assert.equal(candidates[0].source, 'cutting_plan');
  assert.equal(candidates[0].required_qty, 1);
  assert.equal(candidates[0].expected_count, 1);
});

test('finalized cutting plan creates cut and edge rows for banded batches', () => {
  const plan = planWithPlacements([
    {
      part_id: 'backed',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      rot: 0,
      band_edges: { top: true, right: true, bottom: true, left: true },
      lamination_type: 'with-backer',
    },
  ]);

  const candidates = buildCuttingPlanWorkPoolCandidates(123, plan, activities);

  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map((candidate) => [candidate.piecework_activity_id, candidate.expected_count]), [
    ['cut', 2],
    ['edge', 1],
  ]);
});

test('re-finalize with unchanged rows is a no-op and does not update timestamps', () => {
  const candidate = buildCuttingPlanWorkPoolCandidates(123, planWithPlacements([
    {
      part_id: 'plain',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      rot: 0,
      band_edges: { top: false, right: false, bottom: false, left: false },
      lamination_type: 'none',
    },
  ]), activities)[0];

  const result = reconcileCuttingPlanWorkPool([candidate], [existing({ expected_count: 1, required_qty: 1 })]);

  assert.deepEqual(result, { inserts: [], updates: [], exceptions: [] });
});

test('part-count change on unissued pool row updates in place', () => {
  const candidate = buildCuttingPlanWorkPoolCandidates(123, planWithPlacements([
    {
      part_id: 'plain',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      rot: 0,
      band_edges: { top: false, right: false, bottom: false, left: false },
      lamination_type: 'none',
    },
    {
      part_id: 'plain-2',
      x: 100,
      y: 0,
      w: 100,
      h: 100,
      rot: 0,
      band_edges: { top: false, right: false, bottom: false, left: false },
      lamination_type: 'none',
    },
  ]), activities)[0];

  const result = reconcileCuttingPlanWorkPool([candidate], [existing({ expected_count: 1, required_qty: 1, issued_qty: 0 })]);

  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].required_qty, 2);
  assert.deepEqual(result.inserts, []);
  assert.deepEqual(result.exceptions, []);
});

test('part-count change on issued pool row creates an exception and avoids silent mutation', () => {
  const candidate = buildCuttingPlanWorkPoolCandidates(123, planWithPlacements([
    {
      part_id: 'plain',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      rot: 0,
      band_edges: { top: false, right: false, bottom: false, left: false },
      lamination_type: 'none',
    },
    {
      part_id: 'plain-2',
      x: 100,
      y: 0,
      w: 100,
      h: 100,
      rot: 0,
      band_edges: { top: false, right: false, bottom: false, left: false },
      lamination_type: 'none',
    },
  ]), activities)[0];

  const result = reconcileCuttingPlanWorkPool([candidate], [existing({ expected_count: 1, required_qty: 1, issued_qty: 1 })]);

  assert.equal(result.exceptions.length, 1);
  assert.equal(result.exceptions[0].pool_id, 1);
  assert.equal(result.exceptions[0].required_qty_snapshot, 2);
  assert.deepEqual(result.inserts, []);
  assert.deepEqual(result.updates, []);
});
