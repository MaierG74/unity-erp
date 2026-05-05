import { describe, expect, it } from 'vitest';
import { computeEdging } from '../lib/orders/edging-computation';
import type { AggregatedPartGroup } from '../lib/orders/cutting-plan-types';
import type { MaterialAssignments } from '../lib/orders/material-assignment-types';

function makeGroup(overrides: Partial<AggregatedPartGroup> = {}): AggregatedPartGroup {
  return {
    kind: 'primary',
    sheet_thickness_mm: 16,
    material_id: 100,
    material_name: 'White Melamine',
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

describe('computeEdging', () => {
it('top-only edge uses width_mm (short edge)', () => {
  // 1000mm × 500mm part, qty 2, top edge only
  // Top is a "width edge" so it spans width_mm (500) × qty (2) = 1000mm = 1m
  const group = makeGroup({
    parts: [
      {
        id: '1-a',
        original_id: 'a',
        order_detail_id: 1,
        product_name: 'Cupboard',
        source_board_type: '16mm',
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
  expect(result).toBeTruthy();

  expect(result!.edgingOverrides.length).toBe(1);
  expect(result!.edgingOverrides[0].component_id).toBe(200);
  expect(result!.edgingOverrides[0].unit).toBe('m');
  expect(result!.edgingOverrides[0].quantity).toBe(1);
});

it('left-only edge uses length_mm (long edge)', () => {
  // 1000mm × 500mm part, qty 1, left edge only
  // Left is a "length edge" so it spans length_mm (1000) × qty (1) = 1000mm = 1m
  const group = makeGroup({
    parts: [
      {
        id: '1-left',
        original_id: 'left',
        order_detail_id: 1,
        product_name: 'Cupboard',
        source_board_type: '16mm',
        name: 'Side',
        grain: 'none',
        quantity: 1,
        width_mm: 500,
        length_mm: 1000,
        band_edges: { top: false, bottom: false, left: true, right: false },
        lamination_type: 'none',
      },
    ],
  });

  const result = computeEdging([group], makeAssignments());
  expect(result).toBeTruthy();
  expect(result!.edgingOverrides[0].quantity).toBe(1);
});

it('full-perimeter banding sums all four edges correctly', () => {
  // 1000mm × 500mm part, qty 2, ALL four edges
  // per-part perimeter = 2×length_mm + 2×width_mm = 2000 + 1000 = 3000mm
  // × qty 2 = 6000mm = 6m
  const group = makeGroup({
    parts: [
      {
        id: '1-full',
        original_id: 'full',
        order_detail_id: 1,
        product_name: 'Cupboard',
        source_board_type: '16mm',
        name: 'Door',
        grain: 'none',
        quantity: 2,
        width_mm: 500,
        length_mm: 1000,
        band_edges: { top: true, bottom: true, left: true, right: true },
        lamination_type: 'none',
      },
    ],
  });

  const result = computeEdging([group], makeAssignments());
  expect(result).toBeTruthy();
  expect(result!.edgingOverrides.length).toBe(1);
  expect(result!.edgingOverrides[0].unit).toBe('m');
  expect(result!.edgingOverrides[0].quantity).toBe(6);
});

it('sub-meter edging lengths are preserved as fractional meters', () => {
  // 1234mm × 400mm, qty 1, top edge only — top spans width_mm = 400mm = 0.4m
  const group = makeGroup({
    parts: [
      {
        id: '1-b',
        original_id: 'b',
        order_detail_id: 1,
        product_name: 'Cupboard',
        source_board_type: '16mm',
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
  expect(result).toBeTruthy();
  expect(result!.edgingOverrides.length).toBe(1);
  expect(result!.edgingOverrides[0].unit).toBe('m');
  expect(result!.edgingOverrides[0].quantity).toBe(0.4);
});

it('groupEdging display entries stay in mm (display unit)', () => {
  // The per-group display entries keep mm for the UI — only the
  // purchasing-facing edgingOverrides need to be in meters.
  // 1000 × 500 qty 2, top only → width_mm (500) × 2 = 1000mm
  const group = makeGroup({
    parts: [
      {
        id: '1-c',
        original_id: 'c',
        order_detail_id: 1,
        product_name: 'Cupboard',
        source_board_type: '16mm',
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
  expect(result).toBeTruthy();
  const entries = result!.groupEdging.get('primary|16|100');
  expect(entries).toBeTruthy();
  expect(entries!.length).toBe(1);
  expect(entries![0].unit).toBe('mm');
  expect(entries![0].length_mm).toBe(1000);
});
});
