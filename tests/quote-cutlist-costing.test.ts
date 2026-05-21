import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveQuoteMaterialCutlistLines, quoteCostingRefreshMatchKey } from '../lib/quotes/build-costing-cluster';
import { classifyQuoteCostingLine } from '../lib/quotes/costing-tree';

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
  const primary = lines.find((line) => line.cutlist_slot === 'primary' && line.component_id === 42);

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
  const primary = lines.filter((line) => line.cutlist_slot === 'primary');

  assert.equal(primary.length, 2);
  assert.deepEqual(primary.map((line) => line.component_id).sort(), [10, 11]);
  assert.ok(primary.every((line) => line.qty > 0));
});

test('unassigned quote-material edging rows use manual line type while staying in edging group', async () => {
  const quoteSnapshot = [
    {
      source_group_id: 'g1',
      parts: [
        {
          id: 'p1',
          length_mm: 1000,
          width_mm: 500,
          quantity: 1,
          effective_board_id: 10,
          effective_board_name: 'White',
          effective_edging_id: null,
          effective_edging_name: 'Unassigned edging',
          effective_thickness_mm: 32,
          band_edges: { top: true, bottom: true, left: true, right: true },
        },
      ],
    },
  ];

  const lines = await deriveQuoteMaterialCutlistLines(mockSupabase([{ component_id: 10, price: 100 }]), 'org-1', productSnapshot, quoteSnapshot);
  const edging = lines.find((line) => line.cutlist_slot === 'band32');

  assert.ok(edging);
  assert.equal(edging.line_type, 'manual');
  assert.equal(edging.component_id, null);
  assert.equal(edging.unit_cost, null);
  assert.equal(classifyQuoteCostingLine({ ...edging, id: 'edge-1', cluster_id: 'cluster-1', created_at: '', updated_at: '' }), 'edging');
});

test('refresh match key separates duplicate primary slots by component and description', () => {
  const white = quoteCostingRefreshMatchKey({ cutlist_slot: 'primary', component_id: 10, description: 'White' });
  const black = quoteCostingRefreshMatchKey({ cutlist_slot: 'primary', component_id: 11, description: 'Black' });
  const whiteAgain = quoteCostingRefreshMatchKey({ cutlist_slot: 'primary', component_id: 10, description: 'White' });

  assert.notEqual(white, black);
  assert.equal(white, whiteAgain);
});
