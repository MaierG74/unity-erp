/**
 * Direct unit tests for cutlist scoring helpers.
 *
 * Run with: npx tsx --test tests/cutlist-result-scoring.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const importGuillotine = async () => {
  const mod = await import('../lib/cutlist/guillotinePacker.js');
  return mod;
};

const importSAOptimizer = async () => {
  const mod = await import('../lib/cutlist/saOptimizer.js');
  return mod;
};

test('countUnplacedPieces returns 0 when unplaced is undefined', async () => {
  const { countUnplacedPieces } = await importGuillotine();
  assert.equal(countUnplacedPieces({ unplaced: undefined } as any), 0);
});

test('countUnplacedPieces returns 0 when unplaced is an empty array', async () => {
  const { countUnplacedPieces } = await importGuillotine();
  assert.equal(countUnplacedPieces({ unplaced: [] } as any), 0);
});

test('countUnplacedPieces sums the count field across grouped entries', async () => {
  const { countUnplacedPieces } = await importGuillotine();
  const result = {
    unplaced: [
      { part: { id: 'leg' }, count: 2, reason: 'insufficient_sheet_capacity' },
      { part: { id: 'modesty' }, count: 1, reason: 'insufficient_sheet_capacity' },
    ],
  };
  // 3 missing pieces total, not 2 (array length).
  assert.equal(countUnplacedPieces(result as any), 3);
});

test('calculateResultScore: complete layout beats partial with better offcut', async () => {
  const { calculateResultScore } = await importGuillotine();
  const sheetArea = 2730 * 1830;

  // Partial layout: 2 unplaced pieces, but a huge contiguous offcut.
  const partial = {
    sheets: [{ placements: [{ x: 0, y: 0, w: 600, h: 1200 }] }],
    stats: { used_area_mm2: 600 * 1200, waste_area_mm2: 0, cuts: 0, cut_length_mm: 0, edgebanding_length_mm: 0 },
    unplaced: [{ part: { id: 'leg' }, count: 2, reason: 'insufficient_sheet_capacity' }],
    largestOffcutArea: 0.85 * sheetArea,
    offcutConcentration: 1,
    fragmentCount: 1,
  } as any;

  // Complete layout: 0 unplaced, but a fragmented offcut.
  const complete = {
    sheets: [{ placements: [{ x: 0, y: 0, w: 600, h: 1200 }] }],
    stats: { used_area_mm2: 600 * 1200, waste_area_mm2: 0, cuts: 0, cut_length_mm: 0, edgebanding_length_mm: 0 },
    unplaced: undefined,
    largestOffcutArea: 0.10 * sheetArea,
    offcutConcentration: 0.3,
    fragmentCount: 6,
  } as any;

  assert.ok(
    calculateResultScore(complete, sheetArea) > calculateResultScore(partial, sheetArea),
    'Complete layout must outrank partial layout regardless of offcut quality',
  );
});

test('calculateResultScore: among complete layouts, larger offcut still wins', async () => {
  const { calculateResultScore } = await importGuillotine();
  const sheetArea = 2730 * 1830;

  const big = {
    sheets: [{ placements: [{ x: 0, y: 0, w: 600, h: 1200 }] }],
    stats: { used_area_mm2: 600 * 1200, waste_area_mm2: 0, cuts: 0, cut_length_mm: 0, edgebanding_length_mm: 0 },
    unplaced: undefined,
    largestOffcutArea: 0.85 * sheetArea,
    offcutConcentration: 1,
    fragmentCount: 1,
  } as any;

  const small = { ...big, largestOffcutArea: 0.10 * sheetArea, offcutConcentration: 0.3, fragmentCount: 6 };

  assert.ok(
    calculateResultScore(big, sheetArea) > calculateResultScore(small, sheetArea),
    'Among complete layouts, larger contiguous offcut must still win',
  );
});

test('calculateResultScore: fewer unplaced beats more unplaced even with worse offcut', async () => {
  const { calculateResultScore } = await importGuillotine();
  const sheetArea = 2730 * 1830;

  const oneMissing = {
    sheets: [{ placements: [] }],
    stats: { used_area_mm2: 0, waste_area_mm2: 0, cuts: 0, cut_length_mm: 0, edgebanding_length_mm: 0 },
    unplaced: [{ part: { id: 'a' }, count: 1, reason: 'insufficient_sheet_capacity' }],
    largestOffcutArea: 0.10 * sheetArea,
    offcutConcentration: 0.3,
    fragmentCount: 6,
  } as any;

  const threeMissing = {
    ...oneMissing,
    unplaced: [{ part: { id: 'a' }, count: 3, reason: 'insufficient_sheet_capacity' }],
    largestOffcutArea: 0.85 * sheetArea,
    offcutConcentration: 1,
    fragmentCount: 1,
  };

  assert.ok(
    calculateResultScore(oneMissing, sheetArea) > calculateResultScore(threeMissing, sheetArea),
    'A layout missing 1 piece must outrank a layout missing 3 pieces',
  );
});

test('calculateResultScoreV2: complete layout beats partial with better offcut', async () => {
  const { calculateResultScoreV2 } = await importSAOptimizer();
  const sheetArea = 2730 * 1830;

  const partial = {
    sheets: [{ placements: [{ x: 0, y: 0, w: 600, h: 1200 }] }],
    stats: { used_area_mm2: 600 * 1200, waste_area_mm2: 0, cuts: 0, cut_length_mm: 0, edgebanding_length_mm: 0 },
    unplaced: [{ part: { id: 'leg' }, count: 2, reason: 'insufficient_sheet_capacity' }],
    largestOffcutArea: 0.85 * sheetArea,
    offcutConcentration: 1,
    fragmentCount: 1,
  } as any;

  const complete = {
    sheets: [{ placements: [{ x: 0, y: 0, w: 600, h: 1200 }] }],
    stats: { used_area_mm2: 600 * 1200, waste_area_mm2: 0, cuts: 0, cut_length_mm: 0, edgebanding_length_mm: 0 },
    unplaced: undefined,
    largestOffcutArea: 0.10 * sheetArea,
    offcutConcentration: 0.3,
    fragmentCount: 6,
  } as any;

  assert.ok(
    calculateResultScoreV2(complete, sheetArea) > calculateResultScoreV2(partial, sheetArea),
    'V2: complete layout must outrank partial layout regardless of offcut quality',
  );
});

test('calculateResultScoreV2: among complete layouts, larger offcut still wins (V2 weighting preserved)', async () => {
  const { calculateResultScoreV2 } = await importSAOptimizer();
  const sheetArea = 2730 * 1830;

  const big = {
    sheets: [{ placements: [{ x: 0, y: 0, w: 600, h: 1200 }] }],
    stats: { used_area_mm2: 600 * 1200, waste_area_mm2: 0, cuts: 0, cut_length_mm: 0, edgebanding_length_mm: 0 },
    unplaced: undefined,
    largestOffcutArea: 0.85 * sheetArea,
    offcutConcentration: 1,
    fragmentCount: 1,
  } as any;

  const small = { ...big, largestOffcutArea: 0.10 * sheetArea, offcutConcentration: 0.3, fragmentCount: 6 };

  assert.ok(
    calculateResultScoreV2(big, sheetArea) > calculateResultScoreV2(small, sheetArea),
    'V2: among complete layouts, larger offcut must still win; V2 offcut weighting preserved',
  );
});

test('compareResults: complete layout beats partial regardless of sheet count', async () => {
  const { compareResults } = await importGuillotine();
  const sheetArea = 2730 * 1830;

  const completeMany = {
    sheets: Array.from({ length: 200 }, () => ({ placements: [] })),
    stats: { used_area_mm2: 0, waste_area_mm2: 0, cuts: 0, cut_length_mm: 0, edgebanding_length_mm: 0 },
    unplaced: undefined,
    largestOffcutArea: 0,
    offcutConcentration: 0,
    fragmentCount: 0,
  } as any;

  const partialOne = {
    sheets: [{ placements: [] }],
    stats: { used_area_mm2: 0, waste_area_mm2: 0, cuts: 0, cut_length_mm: 0, edgebanding_length_mm: 0 },
    unplaced: [{ part: { id: 'a' }, count: 1, reason: 'insufficient_sheet_capacity' }],
    largestOffcutArea: 0,
    offcutConcentration: 0,
    fragmentCount: 0,
  } as any;

  assert.ok(
    compareResults(completeMany, partialOne, sheetArea) > 0,
    'compareResults must rank a 200-sheet complete layout above a 1-sheet partial layout',
  );
  assert.ok(
    compareResults(partialOne, completeMany, sheetArea) < 0,
    'Symmetric: partial loses to complete regardless of operand order',
  );
});

test('compareResults: among layouts with same unplaced count, scalar score breaks the tie', async () => {
  const { compareResults } = await importGuillotine();
  const sheetArea = 2730 * 1830;

  const big = {
    sheets: [{ placements: [{ x: 0, y: 0, w: 600, h: 1200 }] }],
    stats: { used_area_mm2: 600 * 1200, waste_area_mm2: 0, cuts: 0, cut_length_mm: 0, edgebanding_length_mm: 0 },
    unplaced: undefined,
    largestOffcutArea: 0.85 * sheetArea,
    offcutConcentration: 1,
    fragmentCount: 1,
  } as any;

  const small = { ...big, largestOffcutArea: 0.10 * sheetArea, offcutConcentration: 0.3, fragmentCount: 6 };

  assert.ok(
    compareResults(big, small, sheetArea) > 0,
    'Among complete layouts, larger offcut wins via the scalar tiebreaker',
  );
});

test('compareResults: returns 0 for layouts that are objectively equal', async () => {
  const { compareResults } = await importGuillotine();
  const sheetArea = 2730 * 1830;

  const a = {
    sheets: [{ placements: [] }],
    stats: { used_area_mm2: 100, waste_area_mm2: 0, cuts: 0, cut_length_mm: 0, edgebanding_length_mm: 0 },
    unplaced: undefined,
    largestOffcutArea: 1000,
    offcutConcentration: 0.5,
    fragmentCount: 2,
  } as any;
  const b = { ...a };

  assert.equal(compareResults(a, b, sheetArea), 0, 'Identical layouts compare equal');
});

test('compareResults: accepts an alternate scoreFn for SA V2 weighting', async () => {
  const { compareResults } = await importGuillotine();
  const { calculateResultScoreV2 } = await importSAOptimizer();
  const sheetArea = 2730 * 1830;

  const completeBigOffcut = {
    sheets: [{ placements: [{ x: 0, y: 0, w: 600, h: 1200 }] }],
    stats: { used_area_mm2: 600 * 1200, waste_area_mm2: 0, cuts: 0, cut_length_mm: 0, edgebanding_length_mm: 0 },
    unplaced: undefined,
    largestOffcutArea: 0.85 * sheetArea,
    offcutConcentration: 1,
    fragmentCount: 1,
  } as any;

  const completeSmallOffcut = {
    ...completeBigOffcut,
    largestOffcutArea: 0.10 * sheetArea,
    offcutConcentration: 0.3,
    fragmentCount: 6,
  };

  assert.ok(
    compareResults(completeBigOffcut, completeSmallOffcut, sheetArea, calculateResultScoreV2) > 0,
    'V2 scorer also picks the bigger-offcut layout when completeness ties',
  );
});
