import assert from 'node:assert/strict';
import test from 'node:test';

import { bomRowsFromSnapshot, liveBomRowsForProduct } from './order-components';

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

test('liveBomRowsForProduct explodes phantom child BOM once for old orders without snapshots', () => {
  const bomByProduct = new Map([
    [
      100,
      [{
        product_id: 100,
        component_id: 10,
        quantity_required: 2,
        component: { component_id: 10, internal_code: 'PARENT', description: 'Parent component' },
      }],
    ],
    [
      200,
      [{
        product_id: 200,
        component_id: 20,
        quantity_required: 8,
        component: { component_id: 20, internal_code: 'SCREW', description: 'Drawer screw' },
      }],
    ],
  ]);
  const linksByParent = new Map([
    [100, [{ product_id: 100, sub_product_id: 200, scale: 3, mode: 'phantom' }]],
  ]);

  const rows = liveBomRowsForProduct(100, bomByProduct, linksByParent);

  assert.deepEqual(rows.map((row) => [row.component_id, row.quantity_required]), [
    [10, 2],
    [20, 24],
  ]);
  const detailQty = 2;
  const screws = rows.find((row) => row.component_id === 20);
  assert.equal((screws?.quantity_required ?? 0) * detailQty, 48);
});

test('liveBomRowsForProduct excludes stocked child links', () => {
  const bomByProduct = new Map([
    [
      200,
      [{
        product_id: 200,
        component_id: 20,
        quantity_required: 8,
        component: { component_id: 20, internal_code: 'SCREW', description: 'Drawer screw' },
      }],
    ],
  ]);
  const linksByParent = new Map([
    [100, [{ product_id: 100, sub_product_id: 200, scale: 3, mode: 'stocked' }]],
  ]);

  assert.deepEqual(liveBomRowsForProduct(100, bomByProduct, linksByParent), []);
});
