import assert from 'node:assert/strict';
import test from 'node:test';

import { packPartsIntoSheets, packPartsSmartOptimized } from '../components/features/cutlist/packing';
import { packPartsGuillotine } from '../lib/cutlist/guillotinePacker';
import { packWithStrips } from '../lib/cutlist/stripPacker';
import {
  cutPieceCountFromQuantity,
  finishedPartCountFromQuantity,
} from '../lib/cutlist/quantityModel';
import type { PartSpec, StockSheetSpec } from '../lib/cutlist/types';

const stock: StockSheetSpec = {
  id: 'sheet',
  length_mm: 2750,
  width_mm: 1830,
  qty: 10,
  kerf_mm: 3,
};

const sameBoardPart: PartSpec = {
  id: 'top',
  label: 'Top',
  length_mm: 700,
  width_mm: 500,
  qty: 1,
  grain: 'length',
  band_edges: { top: true, right: true, bottom: true, left: true },
  lamination_type: 'same-board',
};

function placementCount(result: { sheets: Array<{ placements: unknown[] }> }) {
  return result.sheets.reduce((sum, sheet) => sum + sheet.placements.length, 0);
}

test('same-board finished qty helper separates physical cuts from finished edging count', () => {
  assert.equal(cutPieceCountFromQuantity(sameBoardPart, { finishedModel: true }), 2);
  assert.equal(finishedPartCountFromQuantity(
    { quantity: 1, lamination_type: 'same-board' },
    { finishedModel: true },
  ), 1);

  assert.equal(cutPieceCountFromQuantity(sameBoardPart, { finishedModel: false }), 1);
  assert.equal(finishedPartCountFromQuantity(
    { quantity: 2, lamination_type: 'same-board' },
    { finishedModel: false },
  ), 1);
});

test('same-board finished qty expands in all packer entry points', async () => {
  const opts = { sameBoardFinishedQuantityModel: true };

  assert.equal(placementCount(packPartsIntoSheets([sameBoardPart], [stock], opts)), 2);
  assert.equal(placementCount(packWithStrips([sameBoardPart], stock, opts)), 2);
  assert.equal(placementCount(packPartsGuillotine([sameBoardPart], [stock], opts)), 2);
  assert.equal(placementCount(await packPartsSmartOptimized([sameBoardPart], [stock], opts)), 2);
});

test('same-board pieces-v0 remains unchanged by default', async () => {
  assert.equal(placementCount(packPartsIntoSheets([sameBoardPart], [stock])), 1);
  assert.equal(placementCount(packWithStrips([sameBoardPart], stock)), 1);
  assert.equal(placementCount(packPartsGuillotine([sameBoardPart], [stock])), 1);
  assert.equal(placementCount(await packPartsSmartOptimized([sameBoardPart], [stock])), 1);
});

test('with-backer and grouped same-board are not multiplied by same-board finished model', () => {
  const withBacker: PartSpec = {
    ...sameBoardPart,
    id: 'with-backer',
    lamination_type: 'with-backer',
  };
  const groupedSameBoard: PartSpec = {
    ...sameBoardPart,
    id: 'grouped',
    lamination_group: 'A',
  };

  assert.equal(cutPieceCountFromQuantity(withBacker, { finishedModel: true }), 1);
  assert.equal(cutPieceCountFromQuantity(groupedSameBoard, { finishedModel: true }), 1);
});

test('custom cut-piece helper preserves raw quantity rather than expanding layers', () => {
  const custom: PartSpec = {
    ...sameBoardPart,
    id: 'custom',
    lamination_type: 'custom',
    qty: 2,
    lamination_config: {
      finalThickness: 48,
      edgeThickness: 48,
      layers: [
        { materialId: '1', materialName: 'Primary', isPrimary: true },
        { materialId: '2', materialName: 'Core', isPrimary: true },
        { materialId: '3', materialName: 'Backer', isPrimary: false },
      ],
    },
  };

  assert.equal(cutPieceCountFromQuantity(custom, { finishedModel: true }), 2);
  assert.equal(cutPieceCountFromQuantity(custom, { finishedModel: false }), 2);
});
