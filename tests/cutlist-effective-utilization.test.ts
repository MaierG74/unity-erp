import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRolledUpUtilization,
  computeSheetUtilization,
} from '../lib/cutlist/effectiveUtilization';
import type { SheetLayout } from '../lib/cutlist/types';

function sheet(overrides: Partial<SheetLayout>): SheetLayout {
  return {
    sheet_id: 'sheet-1',
    placements: [],
    ...overrides,
  };
}

function withReusable(usedArea: number, reusableArea: number): SheetLayout {
  return sheet({
    used_area_mm2: usedArea,
    offcut_summary: {
      fragments: reusableArea > 0 ? 1 : 0,
      reusableCount: reusableArea > 0 ? 1 : 0,
      scrapCount: 0,
      reusableArea_mm2: reusableArea,
      scrapArea_mm2: 0,
      largestReusableArea_mm2: reusableArea,
      reusableOffcuts: [],
      scrapOffcuts: [],
    },
  });
}

test('computes 40/30/30 split with display percentages summing to 100', () => {
  const result = computeSheetUtilization(withReusable(400, 300), 10, 100);
  assert.equal(result.mechanicalPctRaw, 40);
  assert.equal(result.effectivePctRaw, 70);
  assert.equal(result.displayPartsPct, 40);
  assert.equal(result.displayReusablePct, 30);
  assert.equal(result.displayScrapPct, 30);
  assert.equal(result.displayPartsPct + result.displayReusablePct + result.displayScrapPct, 100);
});

test('zero reusable matches effective to mechanical and hides reusable state', () => {
  const result = computeSheetUtilization(withReusable(500, 0), 10, 100);
  assert.equal(result.hasReusable, false);
  assert.equal(result.reusableArea_mm2, 0);
  assert.equal(result.effectivePctRaw, result.mechanicalPctRaw);
});

test('100 percent used displays parts at 100 and other segments at 0', () => {
  const result = computeSheetUtilization(withReusable(1000, 0), 10, 100);
  assert.equal(result.displayPartsPct, 100);
  assert.equal(result.displayReusablePct, 0);
  assert.equal(result.displayScrapPct, 0);
});

test('area drift preserves parts area and clamps reusable to remaining area', () => {
  const result = computeSheetUtilization(withReusable(800, 400), 10, 100);
  assert.equal(result.partsArea_mm2, 800);
  assert.equal(result.reusableArea_mm2, 200);
  assert.equal(result.scrapArea_mm2, 0);
  assert.equal(result.mechanicalPctRaw, 80);
  assert.equal(result.hasAreaDrift, true);
});

test('parts overflow clamps parts to total and clears reusable and scrap', () => {
  const result = computeSheetUtilization(withReusable(1200, 200), 10, 100);
  assert.equal(result.partsArea_mm2, 1000);
  assert.equal(result.reusableArea_mm2, 0);
  assert.equal(result.scrapArea_mm2, 0);
  assert.equal(result.displayPartsPct, 100);
});

test('zero total area avoids divide-by-zero and returns zero percentages', () => {
  const result = computeSheetUtilization(withReusable(100, 50), 0, 100);
  assert.equal(result.totalArea_mm2, 0);
  assert.equal(result.mechanicalPctRaw, 0);
  assert.equal(result.effectivePctRaw, 0);
  assert.equal(result.displayPartsPct, 0);
  assert.equal(result.displayReusablePct, 0);
  assert.equal(result.displayScrapPct, 0);
});

test('missing offcut summary defaults reusable area to zero', () => {
  const result = computeSheetUtilization(sheet({ used_area_mm2: 250 }), 10, 100);
  assert.equal(result.reusableArea_mm2, 0);
  assert.equal(result.hasReusable, false);
});

test('rolled-up utilization sums areas before computing percentages', () => {
  const result = computeRolledUpUtilization([
    { layout: withReusable(4_000_000, 1_000_000), widthMm: 1000, lengthMm: 5000 },
    { layout: withReusable(0, 0), widthMm: 1000, lengthMm: 5000 },
  ]);
  assert.equal(result.partsArea_mm2, 4_000_000);
  assert.equal(result.reusableArea_mm2, 1_000_000);
  assert.equal(result.totalArea_mm2, 10_000_000);
  assert.equal(result.displayPartsPct, 40);
  assert.equal(result.displayReusablePct, 10);
  assert.equal(result.displayScrapPct, 50);
});

test('empty rolled-up utilization guards against divide-by-zero', () => {
  const result = computeRolledUpUtilization([]);
  assert.equal(result.totalArea_mm2, 0);
  assert.equal(result.mechanicalPctRaw, 0);
  assert.equal(result.effectivePctRaw, 0);
});
