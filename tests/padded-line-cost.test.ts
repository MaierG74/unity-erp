import test from 'node:test';
import assert from 'node:assert/strict';
import { computePaddedLineCost } from '../lib/orders/padded-line-cost';
import type { CutlistCostingSnapshot } from '../lib/cutlist/costingSnapshot';

function makeSnapshot(overrides: Partial<CutlistCostingSnapshot> = {}): CutlistCostingSnapshot {
  return {
    sheets: [
      {
        sheet_id: 's1', material_id: 'm1', material_name: 'White MFC',
        sheet_length_mm: 2800, sheet_width_mm: 2070,
        // Full sheet area so auto billing charges full price — keeps tests predictable.
        used_area_mm2: 2800 * 2070, billing_override: null,
      },
    ],
    global_full_board: false,
    edging: [
      {
        material_id: 'e1', material_name: 'White 1mm edging',
        thickness_mm: 1, meters_actual: 20,
        meters_override: null, pct_override: null,
        unit_price_per_meter: 2.75, component_id: 42,
      },
    ],
    board_prices: [{ material_id: 'm1', unit_price_per_sheet: 797.05, component_id: 100 }],
    backer_sheets: null,
    backer_global_full_board: false,
    backer_price_per_sheet: null,
    calculator_inputs: {
      primaryBoards: [], backerBoards: [], edging: [],
      kerf: 3, optimizationPriority: 'fast',
    },
    stats: { total_parts: 10, total_pieces: 10, total_used_area_mm2: 2_800_000, total_waste_area_mm2: 0, total_cuts: 9 },
    ...overrides,
  };
}

test('padded cost = sheet price + edging × unit_price for one unit', () => {
  const result = computePaddedLineCost({
    quantity: 1,
    snapshot: makeSnapshot(),
    bom_snapshot: [],
  });
  // 1 sheet × 797.05 + 20m × 2.75 = 797.05 + 55.00 = 852.05
  assert.equal(Math.round(result.padded_cost * 100) / 100, 852.05);
  assert.equal(Math.round(result.cutlist_portion * 100) / 100, 852.05);
  assert.equal(result.non_cutlist_portion, 0);
});

test('padded cost scales by quantity', () => {
  const result = computePaddedLineCost({
    quantity: 5,
    snapshot: makeSnapshot(),
    bom_snapshot: [],
  });
  // 852.05 × 5 = 4260.25
  assert.equal(Math.round(result.padded_cost * 100) / 100, 4260.25);
});

test('billing_override mode=full charges full sheet', () => {
  const snap = makeSnapshot({
    sheets: [{
      sheet_id: 's1', material_id: 'm1', material_name: 'White MFC',
      sheet_length_mm: 2800, sheet_width_mm: 2070,
      used_area_mm2: 100_000, // only ~1.7% used — but full-override charges full sheet
      billing_override: { mode: 'full', manualPct: 100 },
    }],
  });
  const result = computePaddedLineCost({ quantity: 1, snapshot: snap, bom_snapshot: [] });
  // Full sheet charged: 797.05 + 55.00 = 852.05
  assert.equal(Math.round(result.cutlist_portion * 100) / 100, 852.05);
});

test('global_full_board wins over billing_override (matches product-costing.tsx precedence)', () => {
  // Sheet has manual 30% override, BUT global_full_board is true.
  // Per product-costing.tsx:122-128 the global flag wins → full sheet charged.
  const snap = makeSnapshot({
    global_full_board: true,
    sheets: [{
      sheet_id: 's1', material_id: 'm1', material_name: 'White MFC',
      sheet_length_mm: 2800, sheet_width_mm: 2070,
      used_area_mm2: 100_000,
      billing_override: { mode: 'manual', manualPct: 30 },
    }],
  });
  const result = computePaddedLineCost({ quantity: 1, snapshot: snap, bom_snapshot: [] });
  // Full sheet billed: 797.05 + edging 55.00 = 852.05 (NOT 30% of the sheet).
  assert.equal(Math.round(result.cutlist_portion * 100) / 100, 852.05);
});

test('billing_override mode=manual applied when global_full_board is false', () => {
  const snap = makeSnapshot({
    global_full_board: false,
    sheets: [{
      sheet_id: 's1', material_id: 'm1', material_name: 'White MFC',
      sheet_length_mm: 2800, sheet_width_mm: 2070,
      used_area_mm2: 100_000,
      billing_override: { mode: 'manual', manualPct: 30 },
    }],
  });
  const result = computePaddedLineCost({ quantity: 1, snapshot: snap, bom_snapshot: [] });
  // 30% of 797.05 = 239.115 + edging 55.00 = 294.12 (round to 2dp)
  assert.equal(Math.round(result.cutlist_portion * 100) / 100, 294.12);
});

test('bom entries with missing is_cutlist_item flag are treated as non-cutlist', () => {
  const result = computePaddedLineCost({
    quantity: 1,
    snapshot: null,
    bom_snapshot: [
      { line_total: 10, component_id: 1 }, // missing flag → non-cutlist
      { is_cutlist_item: false, line_total: 5, component_id: 2 },
    ],
  });
  assert.equal(result.non_cutlist_portion, 15);
});

test('edging pct_override pads meters', () => {
  const snap = makeSnapshot({
    edging: [{
      material_id: 'e1', material_name: 'White 1mm', thickness_mm: 1,
      meters_actual: 20, meters_override: null, pct_override: 10,
      unit_price_per_meter: 2.75, component_id: 42,
    }],
  });
  const result = computePaddedLineCost({ quantity: 1, snapshot: snap, bom_snapshot: [] });
  // edging = 20 × 1.10 × 2.75 = 60.50
  // sheet = 797.05
  // total = 857.55
  assert.equal(Math.round(result.cutlist_portion * 100) / 100, 857.55);
});

test('edging meters_override replaces actual', () => {
  const snap = makeSnapshot({
    edging: [{
      material_id: 'e1', material_name: 'White 1mm', thickness_mm: 1,
      meters_actual: 20, meters_override: 25, pct_override: null,
      unit_price_per_meter: 2.75, component_id: 42,
    }],
  });
  const result = computePaddedLineCost({ quantity: 1, snapshot: snap, bom_snapshot: [] });
  // edging = 25 × 2.75 = 68.75
  // sheet = 797.05 → total 865.80
  assert.equal(Math.round(result.cutlist_portion * 100) / 100, 865.80);
});

test('non-cutlist bom items contribute to non_cutlist_portion', () => {
  const result = computePaddedLineCost({
    quantity: 2,
    snapshot: null,
    bom_snapshot: [
      { is_cutlist_item: false, line_total: 50, component_id: 1 },
      { is_cutlist_item: false, line_total: 25, component_id: 2 },
      { is_cutlist_item: true, line_total: 999, component_id: 3 }, // ignored
    ],
  });
  // (50 + 25) × 2 = 150
  assert.equal(result.non_cutlist_portion, 150);
  assert.equal(result.cutlist_portion, 0);
  assert.equal(result.padded_cost, 150);
});

test('null snapshot with empty bom returns zero', () => {
  const result = computePaddedLineCost({
    quantity: 1,
    snapshot: null,
    bom_snapshot: [],
  });
  assert.equal(result.padded_cost, 0);
});

test('backer sheets contribute when present', () => {
  const snap = makeSnapshot({
    backer_sheets: [{
      sheet_id: 'b1', material_id: 'bm1', material_name: 'Backer',
      sheet_length_mm: 2440, sheet_width_mm: 1220,
      used_area_mm2: 2440 * 1220, billing_override: null,
    }],
    backer_price_per_sheet: 450,
  });
  const result = computePaddedLineCost({ quantity: 1, snapshot: snap, bom_snapshot: [] });
  // primary sheet 797.05 + edging 55.00 + backer 450 = 1302.05
  assert.equal(Math.round(result.cutlist_portion * 100) / 100, 1302.05);
});
