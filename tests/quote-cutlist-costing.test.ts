import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveQuoteMaterialCutlistLines } from '../lib/quotes/build-costing-cluster';

function mockSupabase(prices: Array<{ component_id: number; price: number }>) {
  return {
    from(table: string) {
      assert.equal(table, 'suppliercomponents');
      return {
        select() { return this; },
        eq() { return this; },
        in() { return Promise.resolve({ data: prices, error: null }); },
      };
    },
  } as any;
}

const productSnapshot = {
  sheets: [
    {
      material_id: 'nordic-default',
      material_name: 'Nordic default board',
      sheet_length_mm: 1000,
      sheet_width_mm: 1000,
      used_area_mm2: 500000,
    },
  ],
  primary_layout: { sheets: [] },
  board_prices: [{ material_id: 'nordic-default', component_id: 1, unit_price_per_sheet: 100 }],
  edging: [],
};

test('primary material changed derives quote-effective African component/name/price', async () => {
  const quoteSnapshot = [
    {
      source_group_id: 'g1',
      parts: [
        {
          id: 'p1',
          name: 'Door',
          length_mm: 1000,
          width_mm: 500,
          quantity: 1,
          effective_board_id: 42,
          effective_board_name: 'African Wenge',
          band_edges: {},
        },
      ],
    },
  ];

  const lines = await deriveQuoteMaterialCutlistLines(mockSupabase([{ component_id: 42, price: 250 }]), 'org-1', productSnapshot, quoteSnapshot);
  const primary = lines.find((line) => line.cutlist_slot === 'primary_42');

  assert.ok(primary);
  assert.equal(primary.description, 'African Wenge');
  assert.equal(primary.component_id, 42);
  assert.equal(primary.unit_cost, 250);
  assert.equal(primary.unit_price, 250);
});

test('multi-material quote snapshot creates separate nonzero primary rows', async () => {
  const quoteSnapshot = [
    {
      source_group_id: 'g1',
      parts: [
        { id: 'p1', length_mm: 500, width_mm: 500, quantity: 1, effective_board_id: 10, effective_board_name: 'White', band_edges: {} },
        { id: 'p2', length_mm: 500, width_mm: 500, quantity: 1, effective_board_id: 11, effective_board_name: 'Black', band_edges: {} },
      ],
    },
  ];

  const lines = await deriveQuoteMaterialCutlistLines(
    mockSupabase([{ component_id: 10, price: 100 }, { component_id: 11, price: 120 }]),
    'org-1',
    productSnapshot,
    quoteSnapshot
  );
  const primary = lines.filter((line) => line.cutlist_slot?.startsWith('primary_'));

  assert.equal(primary.length, 2);
  assert.deepEqual(primary.map((line) => line.cutlist_slot).sort(), ['primary_10', 'primary_11']);
  assert.ok(primary.every((line) => line.qty > 0));
});
