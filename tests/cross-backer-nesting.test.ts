import { describe, expect, it } from 'vitest';
import { resolveAggregatedGroups, type AggregateDetail, type BackerLookupEntry } from '../lib/orders/cutting-plan-aggregate';
import { allocateLinesByArea } from '../lib/orders/line-allocation';
import type { MaterialAssignments } from '../lib/orders/material-assignment-types';

const backerLookup = new Map<number, BackerLookupEntry>([
  [300, { thickness_mm: 3, category_id: 75, component_name: '3mm Super-White Melamine' }],
]);

function detail(
  order_detail_id: number,
  product_name: string,
  board_type: string,
  primary_material_id: number,
  backer_material_id: number | null,
  parts: number,
): AggregateDetail {
  return {
    order_detail_id,
    quantity: 1,
    product_name,
    cutlist_material_snapshot: [
      {
        source_group_id: order_detail_id,
        name: product_name,
        board_type,
        primary_material_id,
        primary_material_name: primary_material_id === 100 ? '16mm African Wenge' : '16mm Cherry',
        backer_material_id,
        backer_material_name: backer_material_id ? '3mm Super-White Melamine' : null,
        parts: Array.from({ length: parts }, (_, index) => ({
          id: `p${index}`,
          name: `Part ${index}`,
          grain: 'none',
          quantity: 1,
          width_mm: 500,
          length_mm: 1000,
          band_edges: { top: index % 2 === 0, right: false, bottom: false, left: false },
          lamination_type: board_type.endsWith('-backer') ? 'with-backer' : 'none',
        })),
      },
    ],
  };
}

describe('cross-backer nesting fixtures', () => {
  it('bug shape consolidates same primary across backer and non-backer products', () => {
    const result = resolveAggregatedGroups([
      detail(1, 'Backed Desk', '32mm-backer', 100, 300, 10),
      detail(2, 'Plain Desk', '16mm', 100, null, 30),
    ], null, backerLookup);

    if (!result.ok) throw new Error(result.error);
    const primary = result.material_groups.filter((group) => group.kind === 'primary');
    const backer = result.material_groups.filter((group) => group.kind === 'backer');
    expect(primary).toHaveLength(1);
    expect(primary[0].material_id).toBe(100);
    expect(primary[0].sheet_thickness_mm).toBe(16);
    expect(primary[0].parts).toHaveLength(40);
    expect(backer).toHaveLength(1);
    expect(backer[0].material_id).toBe(300);
    expect(backer[0].parts).toHaveLength(10);
  });

  it('two primaries sharing a backer consolidate into one backer nest', () => {
    const result = resolveAggregatedGroups([
      detail(1, 'Wenge Desk', '32mm-backer', 100, 300, 3),
      detail(2, 'Cherry Desk', '32mm-backer', 101, 300, 2),
    ], null, backerLookup);

    if (!result.ok) throw new Error(result.error);
    expect(result.material_groups.filter((group) => group.kind === 'primary')).toHaveLength(2);
    const backers = result.material_groups.filter((group) => group.kind === 'backer');
    expect(backers).toHaveLength(1);
    expect(backers[0].parts).toHaveLength(5);
  });

  it('POL-83 per-line primary override partitions same product across two primaries', () => {
    const assignments: MaterialAssignments = {
      version: 1,
      assignments: [
        { order_detail_id: 2, board_type: '16mm', part_name: 'Part 0', length_mm: 1000, width_mm: 500, component_id: 101, component_name: '16mm Cherry' },
      ],
      backer_default: null,
      edging_defaults: [],
      edging_overrides: [],
    };
    const result = resolveAggregatedGroups([
      detail(1, 'Desk', '16mm', 100, null, 1),
      detail(2, 'Desk', '16mm', 100, null, 1),
    ], assignments, backerLookup);

    if (!result.ok) throw new Error(result.error);
    expect(result.material_groups.map((group) => group.material_id).sort()).toEqual([100, 101]);
  });

  it('line allocation remains based on upstream snapshot area', () => {
    const allocations = allocateLinesByArea([
      { order_detail_id: 1, area_mm2: 5_000_000 },
      { order_detail_id: 2, area_mm2: 15_000_000 },
    ], 400);

    expect(allocations).toEqual([
      { order_detail_id: 1, area_mm2: 5_000_000, allocation_pct: 25, line_share_amount: 100 },
      { order_detail_id: 2, area_mm2: 15_000_000, allocation_pct: 75, line_share_amount: 300 },
    ]);
  });
});
