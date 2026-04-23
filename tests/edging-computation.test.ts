import test from 'node:test';
import assert from 'node:assert/strict';
import { computeEdging } from '../lib/orders/edging-computation';
import type { AggregatedPartGroup } from '../lib/orders/cutting-plan-types';
import type { MaterialAssignments } from '../lib/orders/material-assignment-types';

function makeGroup(overrides: Partial<AggregatedPartGroup> = {}): AggregatedPartGroup {
  return {
    board_type: '16mm',
    primary_material_id: 100,
    primary_material_name: 'White Melamine',
    backer_material_id: null,
    backer_material_name: null,
    parts: [],
    ...overrides,
  };
}

function makeAssignments(overrides: Partial<MaterialAssignments> = {}): MaterialAssignments {
  return {
    version: 1,
    assignments: [],
    backer_default: null,
    edging_defaults: [
      { board_component_id: 100, edging_component_id: 200, edging_component_name: 'Black PVC' },
    ],
    edging_overrides: [],
    ...overrides,
  };
}

test('computeEdging: edgingOverrides quantity is in meters, unit is "m"', () => {
  // 1000mm × 500mm part, quantity 2, edge on top only
  // edgingLength = length_mm (1000) × qty (2) = 2000mm = 2m
  const group = makeGroup({
    parts: [
      {
        id: '1-a',
        original_id: 'a',
        order_detail_id: 1,
        product_name: 'Cupboard',
        name: 'Top',
        grain: 'none',
        quantity: 2,
        width_mm: 500,
        length_mm: 1000,
        band_edges: { top: true, bottom: false, left: false, right: false },
        lamination_type: 'none',
      },
    ],
  });

  const result = computeEdging([group], makeAssignments());
  assert.ok(result, 'result should not be null');

  assert.equal(result!.edgingOverrides.length, 1);
  assert.equal(result!.edgingOverrides[0].component_id, 200);
  assert.equal(
    result!.edgingOverrides[0].unit,
    'm',
    'unit should be meters for purchasing',
  );
  assert.equal(
    result!.edgingOverrides[0].quantity,
    2,
    '2000mm of edging should be 2 meters of purchasing demand',
  );
});

test('computeEdging: sub-meter edging lengths are preserved as fractional meters', () => {
  // 1234mm length × qty 1, edge top only → 1234mm = 1.234m
  const group = makeGroup({
    parts: [
      {
        id: '1-b',
        original_id: 'b',
        order_detail_id: 1,
        product_name: 'Cupboard',
        name: 'Shelf',
        grain: 'none',
        quantity: 1,
        width_mm: 400,
        length_mm: 1234,
        band_edges: { top: true, bottom: false, left: false, right: false },
        lamination_type: 'none',
      },
    ],
  });

  const result = computeEdging([group], makeAssignments());
  assert.ok(result);
  assert.equal(result!.edgingOverrides.length, 1);
  assert.equal(result!.edgingOverrides[0].unit, 'm');
  assert.equal(result!.edgingOverrides[0].quantity, 1.234);
});

test('computeEdging: groupEdging display entries stay in mm (display unit)', () => {
  // The per-group display entries keep mm for the UI — only the
  // purchasing-facing edgingOverrides need to be in meters.
  const group = makeGroup({
    parts: [
      {
        id: '1-c',
        original_id: 'c',
        order_detail_id: 1,
        product_name: 'Cupboard',
        name: 'Side',
        grain: 'none',
        quantity: 2,
        width_mm: 500,
        length_mm: 1000,
        band_edges: { top: true, bottom: false, left: false, right: false },
        lamination_type: 'none',
      },
    ],
  });

  const result = computeEdging([group], makeAssignments());
  assert.ok(result);
  const entries = result!.groupEdging.get('16mm|100|none');
  assert.ok(entries);
  assert.equal(entries!.length, 1);
  assert.equal(entries![0].unit, 'mm');
  assert.equal(entries![0].length_mm, 2000);
});
