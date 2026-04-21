import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAggregatedGroups, type AggregateDetail } from '../lib/orders/cutting-plan-aggregate';
import type { MaterialAssignments } from '../lib/orders/material-assignment-types';

function makeDetail(
  order_detail_id: number,
  quantity: number,
  parts: Array<{ id: string; name: string; length_mm: number; width_mm: number; quantity: number }>,
  opts?: { primary_material_id?: number; primary_material_name?: string; backer_material_id?: number | null; backer_material_name?: string | null; board_type?: string; product_name?: string },
): AggregateDetail {
  const board_type = opts?.board_type ?? 'melamine';
  return {
    order_detail_id,
    quantity,
    product_name: opts?.product_name ?? `Product ${order_detail_id}`,
    cutlist_snapshot: [
      {
        source_group_id: 1,
        name: 'G1',
        board_type,
        primary_material_id: opts?.primary_material_id ?? 100,
        primary_material_name: opts?.primary_material_name ?? 'White Melamine',
        backer_material_id: opts?.backer_material_id === undefined ? 200 : opts.backer_material_id,
        backer_material_name: opts?.backer_material_name === undefined ? 'Hardboard Backer' : opts.backer_material_name,
        parts: parts.map((p) => ({
          ...p,
          grain: 'none',
          band_edges: {},
          lamination_type: 'none',
        })),
      },
    ],
  };
}

test('no assignments → grouping falls back to nominal primary + backer', () => {
  const details = [makeDetail(1, 2, [{ id: 'p1', name: 'Side', length_mm: 600, width_mm: 400, quantity: 2 }])];
  const result = resolveAggregatedGroups(details, null);
  assert.equal(result.material_groups.length, 1);
  assert.equal(result.material_groups[0].primary_material_id, 100);
  assert.equal(result.material_groups[0].backer_material_id, 200);
  assert.equal(result.total_parts, 1);
  assert.equal(result.has_cutlist_items, true);
  // lineQty=2 × part.quantity=2 → 4
  assert.equal(result.material_groups[0].parts[0].quantity, 4);
});

test('per-role primary assignment splits two lines of the same product into two groups', () => {
  const details = [
    makeDetail(1, 1, [{ id: 'p1', name: 'Side', length_mm: 600, width_mm: 400, quantity: 1 }]),
    makeDetail(2, 1, [{ id: 'p1', name: 'Side', length_mm: 600, width_mm: 400, quantity: 1 }]),
  ];
  const assignments: MaterialAssignments = {
    version: 1,
    assignments: [
      // Only line 1 has an override — line 2 keeps nominal
      { order_detail_id: 1, board_type: 'melamine', part_name: 'Side', length_mm: 600, width_mm: 400, component_id: 999, component_name: 'Black Melamine' },
    ],
    backer_default: null,
    edging_defaults: [],
    edging_overrides: [],
  };
  const result = resolveAggregatedGroups(details, assignments);
  assert.equal(result.material_groups.length, 2);
  const primaries = result.material_groups.map((g) => g.primary_material_id).sort();
  assert.deepEqual(primaries, [100, 999]);
});

test('order-level backer_default applies to groups with a backer but not groups without', () => {
  const details = [
    makeDetail(1, 1, [{ id: 'p1', name: 'Side', length_mm: 600, width_mm: 400, quantity: 1 }]),
    makeDetail(2, 1, [{ id: 'p2', name: 'Side', length_mm: 600, width_mm: 400, quantity: 1 }], { backer_material_id: null, backer_material_name: null, product_name: 'No-Backer Product' }),
  ];
  const assignments: MaterialAssignments = {
    version: 1,
    assignments: [],
    backer_default: { component_id: 777, component_name: 'Fancy Backer' },
    edging_defaults: [],
    edging_overrides: [],
  };
  const result = resolveAggregatedGroups(details, assignments);
  assert.equal(result.material_groups.length, 2);
  const groupWithBacker = result.material_groups.find((g) => g.backer_material_id != null);
  const groupWithoutBacker = result.material_groups.find((g) => g.backer_material_id == null);
  assert.ok(groupWithBacker);
  assert.ok(groupWithoutBacker);
  assert.equal(groupWithBacker!.backer_material_id, 777);
  assert.equal(groupWithoutBacker!.backer_material_id, null);
});

test('two products resolving to the same primary merge into one group', () => {
  const details = [
    makeDetail(1, 1, [{ id: 'p1', name: 'Side', length_mm: 600, width_mm: 400, quantity: 1 }], { primary_material_id: 100, product_name: 'Product A' }),
    makeDetail(2, 1, [{ id: 'p1', name: 'Side', length_mm: 600, width_mm: 400, quantity: 1 }], { primary_material_id: 101, product_name: 'Product B' }),
  ];
  // Override Product B's nominal primary to 100 (matching Product A) via a per-role assignment
  const assignments: MaterialAssignments = {
    version: 1,
    assignments: [
      { order_detail_id: 2, board_type: 'melamine', part_name: 'Side', length_mm: 600, width_mm: 400, component_id: 100, component_name: 'White Melamine' },
    ],
    backer_default: null,
    edging_defaults: [],
    edging_overrides: [],
  };
  const result = resolveAggregatedGroups(details, assignments);
  assert.equal(result.material_groups.length, 1);
  assert.equal(result.material_groups[0].parts.length, 2);
});

test('malformed assignments (non-array assignments, non-object backer) treated as absent', () => {
  const details = [makeDetail(1, 1, [{ id: 'p1', name: 'Side', length_mm: 600, width_mm: 400, quantity: 1 }])];
  const malformed = {
    version: 1,
    assignments: 'not-an-array' as unknown as MaterialAssignments['assignments'],
    backer_default: 42 as unknown as MaterialAssignments['backer_default'],
  } as unknown as MaterialAssignments;
  const result = resolveAggregatedGroups(details, malformed);
  // Should not throw; should fall back to nominal
  assert.equal(result.material_groups.length, 1);
  assert.equal(result.material_groups[0].primary_material_id, 100);
  assert.equal(result.material_groups[0].backer_material_id, 200);
});

test('empty details short-circuits with has_cutlist_items=false', () => {
  const result = resolveAggregatedGroups([], null);
  assert.equal(result.has_cutlist_items, false);
  assert.equal(result.total_parts, 0);
  assert.equal(result.material_groups.length, 0);
});
