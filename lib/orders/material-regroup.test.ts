import { describe, expect, it } from 'vitest';
import { regroupByAssignedMaterial } from './material-regroup';
import type { AggregateResponse } from './cutting-plan-types';
import type { MaterialAssignments } from './material-assignment-types';
import type { BackerLookupEntry } from './cutting-plan-aggregate';

const backerLookup = new Map<number, BackerLookupEntry>([
  [200, { thickness_mm: 3, category_id: 75, component_name: '3mm Super White' }],
  [201, { thickness_mm: 1.6, category_id: 75, component_name: '1.6mm Formica' }],
]);

function aggregate(): AggregateResponse {
  return {
    order_id: 1,
    source_revision: 'rev',
    total_parts: 2,
    has_cutlist_items: true,
    material_groups: [
      {
        kind: 'primary',
        sheet_thickness_mm: 16,
        material_id: 100,
        material_name: 'Wenge',
        parts: [
          {
            id: '1-side',
            original_id: 'side',
            order_detail_id: 1,
            product_name: 'Desk A',
            source_board_type: '32mm-backer',
            name: 'Side',
            grain: 'none',
            quantity: 1,
            width_mm: 500,
            length_mm: 1000,
            band_edges: { top: true, right: false, bottom: false, left: false },
            lamination_type: 'with-backer',
            effective_backer_id: 200,
            effective_backer_name: '3mm Super White',
          },
          {
            id: '2-side',
            original_id: 'side',
            order_detail_id: 2,
            product_name: 'Desk B',
            source_board_type: '16mm',
            name: 'Side',
            grain: 'none',
            quantity: 1,
            width_mm: 500,
            length_mm: 1000,
            band_edges: { top: false, right: false, bottom: false, left: false },
            lamination_type: 'none',
          },
        ],
      },
    ],
  };
}

const assignments: MaterialAssignments = {
  version: 1,
  assignments: [],
  backer_default: null,
  edging_defaults: [],
  edging_overrides: [],
};

describe('regroupByAssignedMaterial', () => {
  it('emits independent primary and backer groups with edge-neutral backer copies', () => {
    const groups = regroupByAssignedMaterial(aggregate(), assignments, backerLookup);

    expect(groups).toBeTruthy();
    expect(groups!.map((group) => group.kind).sort()).toEqual(['backer', 'primary']);
    const primary = groups!.find((group) => group.kind === 'primary')!;
    const backer = groups!.find((group) => group.kind === 'backer')!;
    expect(primary.parts).toHaveLength(2);
    expect(backer.material_id).toBe(200);
    expect(backer.sheet_thickness_mm).toBe(3);
    expect(backer.parts).toHaveLength(1);
    expect(backer.parts[0].id).toBe('1-side::backer');
    expect(backer.parts[0].band_edges).toEqual({ top: false, right: false, bottom: false, left: false });
  });

  it('immediate backer assignment change uses the new backer lookup', () => {
    const groups = regroupByAssignedMaterial(
      aggregate(),
      { ...assignments, backer_default: { component_id: 201, component_name: '1.6mm Formica' } },
      backerLookup,
    );

    const backer = groups!.find((group) => group.kind === 'backer')!;
    expect(backer.material_id).toBe(201);
    expect(backer.sheet_thickness_mm).toBe(1.6);
  });
});
