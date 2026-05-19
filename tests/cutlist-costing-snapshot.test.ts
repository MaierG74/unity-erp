import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshotFromCalculator } from '../lib/cutlist/costingSnapshot';
import type { LayoutResult } from '../lib/cutlist/types';

const baseResult: LayoutResult = {
  sheets: [
    {
      sheet_id: 'S1',
      placements: [
        {
          part_id: 'cfg-1',
          x: 0,
          y: 0,
          w: 400,
          h: 400,
          rot: 0,
          material_id: 'nordic-board',
        },
      ],
      used_area_mm2: 160000,
      stock_length_mm: 2750,
      stock_width_mm: 1830,
    },
  ],
  stats: { used_area_mm2: 160000, waste_area_mm2: 0, cuts: 0, cut_length_mm: 0 },
};

const alegriaBoard = {
  id: 'alegria-board',
  name: '16mm Alegria',
  length_mm: 2730,
  width_mm: 1830,
  cost: 797.05,
  isDefault: true,
  component_id: 448,
};

const nordicBoard = {
  id: 'nordic-board',
  name: '16mm Nordic Ice',
  length_mm: 2750,
  width_mm: 1830,
  cost: 963,
  isDefault: false,
  component_id: 408,
};

function makeSnapshot(result: LayoutResult) {
  return buildSnapshotFromCalculator({
    result,
    backerResult: null,
    parts: [],
    primaryBoards: [alegriaBoard, nordicBoard],
    backerBoards: [],
    edgingMaterials: [],
    kerf: 3,
    optimizationPriority: 'fast',
    sheetOverrides: {},
    globalFullBoard: false,
    backerSheetOverrides: {},
    backerGlobalFullBoard: false,
    edgingByMaterial: [],
    edgingOverrides: {},
  });
}

test('snapshot sheet name follows the placement material, not the default board', () => {
  const snapshot = makeSnapshot(baseResult);

  assert.equal(snapshot.sheets[0].material_id, 'nordic-board');
  assert.equal(snapshot.sheets[0].material_name, '16mm Nordic Ice');
});

test('snapshot does not label an unknown placement material as the default board', () => {
  const resultWithUnknownMaterial: LayoutResult = {
    ...baseResult,
    sheets: [
      {
        ...baseResult.sheets[0],
        placements: [
          {
            ...baseResult.sheets[0].placements[0],
            material_id: 'orphan-board',
          },
        ],
      },
    ],
  };

  const snapshot = makeSnapshot(resultWithUnknownMaterial);

  assert.equal(snapshot.sheets[0].material_id, 'orphan-board');
  assert.equal(snapshot.sheets[0].material_name, '');
});
