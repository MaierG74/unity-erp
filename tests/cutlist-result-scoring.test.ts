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
