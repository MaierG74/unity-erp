import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCutlistCostingSnapshot } from '../lib/orders/cutlist-costing-freeze';
import { computePaddedLineCost } from '../lib/orders/padded-line-cost';
import type { CutlistCostingSnapshot } from '../lib/cutlist/costingSnapshot';

function makeSnapshot(sheetPrice: number): CutlistCostingSnapshot {
  return {
    sheets: [
      {
        sheet_id: 's1',
        material_id: 'm1',
        material_name: 'White MFC',
        sheet_length_mm: 2800,
        sheet_width_mm: 2070,
        used_area_mm2: 2800 * 2070,
        billing_override: null,
      },
    ],
    global_full_board: false,
    primary_layout: {
      sheets: [],
      stats: { used_area_mm2: 0, waste_area_mm2: 0, cuts: 0, cut_length_mm: 0 },
    },
    backer_layout: null,
    edging: [],
    board_prices: [{ material_id: 'm1', unit_price_per_sheet: sheetPrice, component_id: 100 }],
    backer_sheets: null,
    backer_global_full_board: false,
    backer_price_per_sheet: null,
    calculator_inputs: {
      primaryBoards: [],
      backerBoards: [],
      edging: [],
      kerf: 3,
      optimizationPriority: 'fast',
    },
    stats: {
      total_parts: 1,
      total_pieces: 1,
      total_used_area_mm2: 2800 * 2070,
      total_waste_area_mm2: 0,
      total_cuts: 0,
    },
  };
}

test('frozen order-line costing snapshot wins over changed product template', () => {
  const frozenAtOrderAdd = makeSnapshot(100);
  const productAfterSaveToCosting = makeSnapshot(250);

  const { snapshot, source } = resolveCutlistCostingSnapshot(
    frozenAtOrderAdd,
    productAfterSaveToCosting,
  );
  const padded = computePaddedLineCost({
    quantity: 2,
    snapshot,
    bom_snapshot: [],
  });

  assert.equal(source, 'order_line');
  assert.equal(padded.cutlist_portion, 200);
});

test('legacy order lines without a frozen snapshot fall back to product template', () => {
  const { snapshot, source } = resolveCutlistCostingSnapshot(null, makeSnapshot(125));
  const padded = computePaddedLineCost({
    quantity: 2,
    snapshot,
    bom_snapshot: [],
  });

  assert.equal(source, 'product_template');
  assert.equal(padded.cutlist_portion, 250);
});
