import { describe, expect, it } from 'vitest';
import { resolveAggregatedGroups, type AggregateDetail, type BackerLookupEntry } from '../lib/orders/cutting-plan-aggregate';
import type { MaterialAssignments } from '../lib/orders/material-assignment-types';
import type { AggregatedPartGroup } from '../lib/orders/cutting-plan-types';

const validBackers = new Map<number, BackerLookupEntry>([
  [200, { thickness_mm: 3, category_id: 75, component_name: 'Hardboard Backer' }],
  [777, { thickness_mm: 3, category_id: 75, component_name: 'Fancy Backer' }],
]);

function groupsOrThrow(result: ReturnType<typeof resolveAggregatedGroups>): AggregatedPartGroup[] {
  if (!result.ok) throw new Error(result.error);
  return result.material_groups;
}

function makeDetail(
  order_detail_id: number,
  quantity: number,
  parts: Array<{ id: string; name: string; length_mm: number; width_mm: number; quantity: number; band_edges?: Record<string, boolean> }>,
  opts?: { primary_material_id?: number; primary_material_name?: string; backer_material_id?: number | null; backer_material_name?: string | null; board_type?: string; product_name?: string },
): AggregateDetail {
  const board_type = opts?.board_type ?? '16mm-backer';
  return {
    order_detail_id,
    quantity,
    product_name: opts?.product_name ?? `Product ${order_detail_id}`,
    cutlist_material_snapshot: [
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
          band_edges: p.band_edges ?? {},
          lamination_type: 'none',
        })),
      },
    ],
  };
}

describe('resolveAggregatedGroups', () => {
it('no assignments emits independent primary and backer groups', () => {
  const details = [makeDetail(1, 2, [{ id: 'p1', name: 'Side', length_mm: 600, width_mm: 400, quantity: 2 }])];
  const result = resolveAggregatedGroups(details, null, validBackers);
  if (!result.ok) throw new Error(result.error);
  const groups = groupsOrThrow(result);
  expect(groups.length).toBe(2);
  const primary = groups.find((g) => g.kind === 'primary');
  const backer = groups.find((g) => g.kind === 'backer');
  expect(primary).toBeTruthy();
  expect(backer).toBeTruthy();
  expect(primary!.material_id).toBe(100);
  expect(primary!.sheet_thickness_mm).toBe(8);
  expect(backer!.material_id).toBe(200);
  expect(backer!.sheet_thickness_mm).toBe(3);
  expect(result.total_parts).toBe(1);
  expect(result.has_cutlist_items).toBe(true);
  expect(primary!.parts[0].quantity).toBe(4);
});

it('per-role primary assignment splits two lines of the same product into two primary groups', () => {
  const details = [
    makeDetail(1, 1, [{ id: 'p1', name: 'Side', length_mm: 600, width_mm: 400, quantity: 1 }]),
    makeDetail(2, 1, [{ id: 'p1', name: 'Side', length_mm: 600, width_mm: 400, quantity: 1 }]),
  ];
  const assignments: MaterialAssignments = {
    version: 1,
    assignments: [
      { order_detail_id: 1, board_type: '16mm-backer', part_name: 'Side', length_mm: 600, width_mm: 400, component_id: 999, component_name: 'Black Melamine' },
    ],
    backer_default: null,
    edging_defaults: [],
    edging_overrides: [],
  };
  const result = resolveAggregatedGroups(details, assignments, validBackers);
  const groups = groupsOrThrow(result);
  const primaries = groups.filter((g) => g.kind === 'primary').map((g) => g.material_id).sort();
  expect(primaries).toEqual([100, 999]);
  expect(groups.filter((g) => g.kind === 'backer').length).toBe(1);
});

it('order-level backer_default applies to backer groups only', () => {
  const details = [
    makeDetail(1, 1, [{ id: 'p1', name: 'Side', length_mm: 600, width_mm: 400, quantity: 1 }]),
    makeDetail(2, 1, [{ id: 'p2', name: 'Side', length_mm: 600, width_mm: 400, quantity: 1 }], { board_type: '16mm', backer_material_id: null, backer_material_name: null }),
  ];
  const assignments: MaterialAssignments = {
    version: 1,
    assignments: [],
    backer_default: { component_id: 777, component_name: 'Fancy Backer' },
    edging_defaults: [],
    edging_overrides: [],
  };
  const result = resolveAggregatedGroups(details, assignments, validBackers);
  const groups = groupsOrThrow(result);
  expect(groups.filter((g) => g.kind === 'primary').length).toBe(2);
  expect(groups.filter((g) => g.kind === 'backer').length).toBe(1);
  expect(groups.find((g) => g.kind === 'backer')!.material_id).toBe(777);
});

it('two products resolving to the same primary merge into one primary group', () => {
  const details = [
    makeDetail(1, 1, [{ id: 'p1', name: 'Side', length_mm: 600, width_mm: 400, quantity: 1 }], { primary_material_id: 100 }),
    makeDetail(2, 1, [{ id: 'p1', name: 'Side', length_mm: 600, width_mm: 400, quantity: 1 }], { primary_material_id: 101 }),
  ];
  const assignments: MaterialAssignments = {
    version: 1,
    assignments: [
      { order_detail_id: 2, board_type: '16mm-backer', part_name: 'Side', length_mm: 600, width_mm: 400, component_id: 100, component_name: 'White Melamine' },
    ],
    backer_default: null,
    edging_defaults: [],
    edging_overrides: [],
  };
  const result = resolveAggregatedGroups(details, assignments, validBackers);
  const groups = groupsOrThrow(result);
  expect(groups.filter((g) => g.kind === 'primary').length).toBe(1);
  expect(groups.find((g) => g.kind === 'primary')!.parts.length).toBe(2);
});

it('backer copies zero band_edges and namespace id', () => {
  const result = resolveAggregatedGroups([
    makeDetail(1, 1, [{
      id: 'p1',
      name: 'Side',
      length_mm: 600,
      width_mm: 400,
      quantity: 1,
      band_edges: { top: true, right: true, bottom: false, left: false },
    }]),
  ], null, validBackers);
  const groups = groupsOrThrow(result);
  const backerPart = groups.find((g) => g.kind === 'backer')!.parts[0];
  expect(backerPart.id).toBe('1-p1::backer');
  expect(backerPart.band_edges).toEqual({ top: false, right: false, bottom: false, left: false });
});

it('-both groups pass through as primary-only', () => {
  const result = resolveAggregatedGroups([
    makeDetail(1, 1, [{ id: 'p1', name: 'Top', length_mm: 600, width_mm: 400, quantity: 2 }], { board_type: '32mm-both', backer_material_id: null }),
  ], null, validBackers);
  const groups = groupsOrThrow(result);
  expect(groups.length).toBe(1);
  expect(groups[0].kind).toBe('primary');
  expect(groups[0].parts[0].quantity).toBe(2);
});

it('missing backer lookup rejects with BACKER_THICKNESS_INVALID', () => {
  const result = resolveAggregatedGroups([
    makeDetail(1, 1, [{ id: 'p1', name: 'Side', length_mm: 600, width_mm: 400, quantity: 1 }]),
  ], null, new Map());
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected invalid result');
  expect(result.error).toBe('BACKER_THICKNESS_INVALID');
  expect(result.invalid).toEqual([{ component_id: 200, parsed_value: null, reason: 'null' }]);
});

it('empty details short-circuits with has_cutlist_items=false', () => {
  const result = resolveAggregatedGroups([], null);
  if (!result.ok) throw new Error(result.error);
  expect(result.has_cutlist_items).toBe(false);
  expect(result.total_parts).toBe(0);
  expect(result.material_groups.length).toBe(0);
});
});
