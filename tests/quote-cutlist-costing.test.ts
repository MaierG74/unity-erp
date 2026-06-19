import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveQuoteMaterialCutlistLines, quoteCostingRefreshMatchKey } from '../lib/quotes/build-costing-cluster';
import { applyQuoteCostLineSurcharge, classifyQuoteCostingLine, resolveQuoteCostLineSurcharge } from '../lib/quotes/costing-tree';

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

const productSnapshotWithEdging = {
  ...productSnapshot,
  primary_layout: {
    sheets: [],
    stats: {
      edgebanding_16mm_mm: 6540,
      edgebanding_32mm_mm: 1600,
    },
  },
  edging: [
    {
      material_name: 'Nordic Ice PVC 1mm x 36mm',
      component_id: 1469,
      thickness_mm: 1,
      meters_actual: 1.6,
      meters_override: 2,
      unit_price_per_meter: 8.1,
    },
    {
      material_name: 'Nordic Ice PVC 1mm x 20mm',
      component_id: 948,
      thickness_mm: 1,
      meters_actual: 6.54,
      meters_override: 8,
      unit_price_per_meter: 4.32,
    },
  ],
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

test('same-board finished quote allocation uses physical cut-piece area', async () => {
  const quoteSnapshot = [
    {
      source_group_id: 'g1',
      parts: [
        {
          id: 'same',
          length_mm: 1000,
          width_mm: 1000,
          quantity: 1,
          lamination_type: 'same-board',
          effective_board_id: 10,
          effective_board_name: 'White',
          band_edges: {},
        },
        {
          id: 'plain',
          length_mm: 1000,
          width_mm: 1000,
          quantity: 1,
          lamination_type: 'none',
          effective_board_id: 11,
          effective_board_name: 'Black',
          band_edges: {},
        },
      ],
    },
  ];

  const lines = await deriveQuoteMaterialCutlistLines(
    mockSupabase([{ component_id: 10, price: 100 }, { component_id: 11, price: 120 }]),
    'org-1',
    productSnapshot,
    quoteSnapshot,
    { sameBoardFinishedQuantityModel: true },
  );
  const white = lines.find((line) => line.cutlist_slot === 'primary' && line.component_id === 10);
  const black = lines.find((line) => line.cutlist_slot === 'primary' && line.component_id === 11);

  assert.ok(white);
  assert.ok(black);
  assert.equal(white.qty, 0.333);
  assert.equal(black.qty, 0.167);
});

test('grouped same-board quote allocation is not doubled under finished model', async () => {
  const quoteSnapshot = [
    {
      source_group_id: 'g1',
      parts: [
        {
          id: 'same-a',
          length_mm: 1000,
          width_mm: 1000,
          quantity: 1,
          lamination_type: 'same-board',
          lamination_group: 'G1',
          effective_board_id: 10,
          effective_board_name: 'White',
          band_edges: {},
        },
        {
          id: 'same-b',
          length_mm: 1000,
          width_mm: 1000,
          quantity: 1,
          lamination_type: 'same-board',
          lamination_group: 'G1',
          effective_board_id: 10,
          effective_board_name: 'White',
          band_edges: {},
        },
      ],
    },
  ];

  const lines = await deriveQuoteMaterialCutlistLines(
    mockSupabase([{ component_id: 10, price: 100 }]),
    'org-1',
    productSnapshot,
    quoteSnapshot,
    { sameBoardFinishedQuantityModel: true },
  );
  const primary = lines.find((line) => line.cutlist_slot === 'primary' && line.component_id === 10);

  assert.ok(primary);
  assert.equal(primary.qty, 0.5);
});

test('grouped same-board quote edging counts one finished bundle per assembly', async () => {
  const quoteSnapshot = [
    {
      source_group_id: 'g1',
      parts: [
        {
          id: 'same-a',
          length_mm: 400,
          width_mm: 400,
          quantity: 1,
          lamination_type: 'same-board',
          lamination_group: 'G1',
          effective_board_id: 10,
          effective_board_name: 'White',
          effective_edging_id: null,
          effective_edging_name: null,
          effective_thickness_mm: 32,
          band_edges: { top: true, bottom: true, left: true, right: true },
        },
        {
          id: 'same-b',
          length_mm: 400,
          width_mm: 400,
          quantity: 1,
          lamination_type: 'same-board',
          lamination_group: 'G1',
          effective_board_id: 10,
          effective_board_name: 'White',
          effective_edging_id: null,
          effective_edging_name: null,
          effective_thickness_mm: 32,
          band_edges: { top: true, bottom: true, left: true, right: true },
        },
      ],
    },
  ];

  const lines = await deriveQuoteMaterialCutlistLines(
    mockSupabase([{ component_id: 10, price: 100 }]),
    'org-1',
    productSnapshotWithEdging,
    quoteSnapshot,
    { sameBoardFinishedQuantityModel: true },
  );
  const band32 = lines.find((line) => line.cutlist_slot === 'band32');

  assert.ok(band32);
  assert.equal(band32.component_id, 1469);
  assert.equal(band32.qty, 2);
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

test('unassigned quote edging falls back to product edging template by slot', async () => {
  const quoteSnapshot = [
    {
      source_group_id: 'g1',
      parts: [
        {
          id: 'p1',
          length_mm: 400,
          width_mm: 400,
          quantity: 2,
          effective_board_id: 10,
          effective_board_name: 'White',
          effective_edging_id: null,
          effective_edging_name: null,
          effective_thickness_mm: 32,
          band_edges: { top: true, bottom: true, left: true, right: true },
        },
        {
          id: 'p2',
          length_mm: 6540,
          width_mm: 100,
          quantity: 1,
          effective_board_id: 10,
          effective_board_name: 'White',
          effective_edging_id: null,
          effective_edging_name: null,
          effective_thickness_mm: 16,
          band_edges: { top: false, bottom: false, left: true, right: false },
        },
      ],
    },
  ];

  const lines = await deriveQuoteMaterialCutlistLines(mockSupabase([{ component_id: 10, price: 100 }]), 'org-1', productSnapshotWithEdging, quoteSnapshot);
  const band32 = lines.find((line) => line.cutlist_slot === 'band32');
  const band16 = lines.find((line) => line.cutlist_slot === 'band16');

  assert.ok(band32);
  assert.equal(band32.line_type, 'component');
  assert.equal(band32.component_id, 1469);
  assert.equal(band32.description, 'Nordic Ice PVC 1mm x 36mm (32mm)');
  assert.equal(band32.qty, 2);
  assert.equal(band32.unit_cost, 8.1);

  assert.ok(band16);
  assert.equal(band16.line_type, 'component');
  assert.equal(band16.component_id, 948);
  assert.equal(band16.description, 'Nordic Ice PVC 1mm x 20mm (16mm)');
  assert.equal(band16.qty, 8);
  assert.equal(band16.unit_cost, 4.32);
});

test('quote cost line surcharge resolves fixed and percentage per costing unit', () => {
  assert.equal(resolveQuoteCostLineSurcharge('fixed', 12.345, 100), 12.35);
  assert.equal(resolveQuoteCostLineSurcharge('percentage', 7.5, 200), 15);
  assert.equal(resolveQuoteCostLineSurcharge('fixed', -10, 100), -10);

  assert.deepEqual(applyQuoteCostLineSurcharge('fixed', 25, 100), { resolved: 25, unitCost: 125 });
  assert.deepEqual(applyQuoteCostLineSurcharge('percentage', -10, 100), { resolved: -10, unitCost: 90 });
});

test('refresh match key separates duplicate primary slots by component and description', () => {
  const white = quoteCostingRefreshMatchKey({ cutlist_slot: 'primary', component_id: 10, description: 'White' });
  const black = quoteCostingRefreshMatchKey({ cutlist_slot: 'primary', component_id: 11, description: 'Black' });
  const whiteAgain = quoteCostingRefreshMatchKey({ cutlist_slot: 'primary', component_id: 10, description: 'White' });

  assert.notEqual(white, black);
  assert.equal(white, whiteAgain);
});
