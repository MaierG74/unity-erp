import { describe, expect, it } from 'vitest';

import { resolveAggregatedGroups, type AggregateDetail } from './cutting-plan-aggregate';

describe('resolveAggregatedGroups', () => {
it('excludes quantity-0 parts from material groups', () => {
  const details: AggregateDetail[] = [
    {
      order_detail_id: 1,
      quantity: 1,
      product_name: 'Desk',
      cutlist_material_snapshot: [
        {
          source_group_id: 1,
          name: 'Group',
          board_type: '16mm',
          primary_material_id: 10,
          primary_material_name: 'White',
          backer_material_id: null,
          backer_material_name: null,
          parts: [
            {
              id: 'removed',
              name: 'Removed',
              grain: 'none',
              quantity: 0,
              width_mm: 300,
              length_mm: 400,
              band_edges: {},
              lamination_type: 'none',
            },
            {
              id: 'kept',
              name: 'Kept',
              grain: 'none',
              quantity: 1,
              width_mm: 300,
              length_mm: 400,
              band_edges: {},
              lamination_type: 'none',
            },
          ],
        },
      ],
    },
  ];

  const result = resolveAggregatedGroups(details, null);

  if (!result.ok) throw new Error(result.error);
  expect(result.material_groups.length).toBe(1);
  expect(result.material_groups[0].parts.length).toBe(1);
  expect(result.material_groups[0].parts[0].name).toBe('Kept');
  expect(result.total_parts).toBe(1);
});
});
