import assert from 'node:assert/strict';

import { bomRowsFromSnapshot } from './order-components';

declare const test: (name: string, fn: () => void) => void;

test('bomRowsFromSnapshot uses effective component and quantity fields', () => {
  const rows = bomRowsFromSnapshot([
    {
      component_id: 10,
      component_code: 'DEFAULT',
      component_description: 'Default component',
      quantity_required: 2,
      effective_component_id: 11,
      effective_component_code: 'ALT',
      effective_quantity_required: 3,
    },
  ]);

  assert.deepEqual(rows, [
    {
      component_id: 11,
      quantity_required: 3,
      component: {
        component_id: 11,
        internal_code: 'ALT',
        description: 'Default component',
      },
    },
  ]);
});

test('bomRowsFromSnapshot skips removed and zero-demand rows', () => {
  const rows = bomRowsFromSnapshot([
    {
      component_id: 10,
      component_code: 'REMOVED',
      quantity_required: 2,
      effective_component_id: 10,
      effective_quantity_required: 0,
      is_removed: true,
    },
    {
      component_id: 12,
      component_code: 'ZERO',
      quantity_required: 1,
      effective_component_id: 12,
      effective_quantity_required: 0,
    },
    {
      component_id: 13,
      component_code: 'KEEP',
      component_description: null,
      quantity_required: 1,
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].component_id, 13);
});
