import test from 'node:test';
import assert from 'node:assert/strict';
import { toStockSelectableItems, type InventoryComponentRow } from '../lib/db/inventory';

test('maps active components with and without inventory rows into stock picker items', () => {
  const rows: InventoryComponentRow[] = [
    {
      component_id: 20,
      internal_code: 'HINGE-20',
      description: 'Soft close hinge',
      is_active: true,
      inventory: [{ component_id: 20, quantity_on_hand: 14, quantity_reserved: 3 }],
    },
    {
      component_id: 21,
      internal_code: 'RUNNER-21',
      description: 'Drawer runner',
      is_active: true,
      inventory: null,
    },
  ];

  const items = toStockSelectableItems(rows);

  assert.deepEqual(
    items.map((item) => ({
      component_id: item.component_id,
      available_quantity: item.available_quantity,
      has_inventory_record: item.has_inventory_record,
      quantity_reserved: item.quantity_reserved,
    })),
    [
      { component_id: 21, available_quantity: 0, has_inventory_record: false, quantity_reserved: null },
      { component_id: 20, available_quantity: 11, has_inventory_record: true, quantity_reserved: 3 },
    ],
  );
});
