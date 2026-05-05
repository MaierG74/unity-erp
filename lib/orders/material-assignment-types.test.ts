import assert from 'node:assert/strict';

import { buildPartRoles, type MaterialAssignments } from './material-assignment-types';
import type { AggregateResponse } from './cutting-plan-types';

declare const test: (name: string, fn: () => void) => void;

const emptyAssignments: MaterialAssignments = {
  version: 1,
  assignments: [],
  backer_default: null,
  edging_defaults: [],
  edging_overrides: [],
};

test('buildPartRoles excludes quantity-0 cutlist parts', () => {
  const aggregate: AggregateResponse = {
    order_id: 1,
    source_revision: 'rev',
    total_parts: 2,
    has_cutlist_items: true,
    material_groups: [
      {
        kind: 'primary',
        sheet_thickness_mm: 16,
        material_id: 10,
        material_name: 'White',
        parts: [
          {
            id: 'removed',
            original_id: 'removed',
            order_detail_id: 100,
            product_name: 'Desk',
            source_board_type: '16mm',
            name: 'Removed part',
            grain: 'none',
            quantity: 0,
            width_mm: 300,
            length_mm: 400,
            band_edges: {},
            lamination_type: 'none',
          },
          {
            id: 'kept',
            original_id: 'kept',
            order_detail_id: 100,
            product_name: 'Desk',
            source_board_type: '16mm',
            name: 'Kept part',
            grain: 'none',
            quantity: 2,
            width_mm: 300,
            length_mm: 400,
            band_edges: {},
            lamination_type: 'none',
          },
        ],
      },
    ],
  };

  const roles = buildPartRoles(aggregate, emptyAssignments);

  assert.equal(roles.length, 1);
  assert.equal(roles[0].part_name, 'Kept part');
  assert.equal(roles[0].total_quantity, 2);
});
