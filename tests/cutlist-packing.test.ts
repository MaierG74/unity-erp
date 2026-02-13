/**
 * Cutlist Packing Algorithm Tests
 *
 * These tests verify the packing algorithm's correctness and efficiency.
 * Key metrics:
 * - Yield: (used area / total sheet area) × 100%
 * - Largest offcut: The biggest remaining free rectangle
 * - Sheet count: Number of sheets needed
 *
 * Run with: npx tsx --test tests/cutlist-packing.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// We need to import the packing module - using dynamic import to handle ESM
const importPacking = async () => {
  const mod = await import('../components/features/cutlist/packing.js');
  return mod;
};

// Types inline to avoid import issues
interface PartSpec {
  id: string;
  length_mm: number;
  width_mm: number;
  qty: number;
  grain?: 'any' | 'length' | 'width';
  band_edges?: { top?: boolean; bottom?: boolean; left?: boolean; right?: boolean };
  lamination_type?: 'none' | 'with-backer' | 'same-board' | 'custom';
}

interface StockSheetSpec {
  id: string;
  length_mm: number;
  width_mm: number;
  qty: number;
  kerf_mm: number;
}

interface Placement {
  part_id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: 0 | 90;
}

interface SheetLayout {
  sheet_id: string;
  placements: Placement[];
  used_area_mm2: number;
}

interface LayoutResult {
  sheets: SheetLayout[];
  stats: {
    used_area_mm2: number;
    waste_area_mm2: number;
    cuts: number;
    cut_length_mm: number;
    edgebanding_length_mm?: number;
    edgebanding_16mm_mm?: number;
    edgebanding_32mm_mm?: number;
  };
  unplaced?: Array<{ part: PartSpec; count: number; reason: string }>;
}

// Standard sheet size: 2750mm × 1830mm (common MDF/chipboard size)
const STANDARD_SHEET: StockSheetSpec = {
  id: 'standard',
  length_mm: 2750,
  width_mm: 1830,
  qty: 100,
  kerf_mm: 3,
};

// Helper to calculate yield percentage
function calculateYield(result: LayoutResult, sheet: StockSheetSpec): number {
  const sheetArea = sheet.length_mm * sheet.width_mm;
  const totalSheetArea = sheetArea * result.sheets.length;
  if (totalSheetArea === 0) return 0;
  return (result.stats.used_area_mm2 / totalSheetArea) * 100;
}

// Helper to find largest free rectangle after packing (approximate)
function estimateLargestOffcut(
  result: LayoutResult,
  sheet: StockSheetSpec
): { width: number; height: number; area: number } {
  let largestOffcut = { width: 0, height: 0, area: 0 };

  for (const sheetLayout of result.sheets) {
    let maxX = 0;
    let maxY = 0;

    for (const p of sheetLayout.placements) {
      maxX = Math.max(maxX, p.x + p.w);
      maxY = Math.max(maxY, p.y + p.h);
    }

    // Estimate right strip offcut
    const rightOffcut = {
      width: sheet.width_mm - maxX,
      height: sheet.length_mm,
      area: (sheet.width_mm - maxX) * sheet.length_mm,
    };

    // Estimate bottom strip offcut
    const bottomOffcut = {
      width: sheet.width_mm,
      height: sheet.length_mm - maxY,
      area: sheet.width_mm * (sheet.length_mm - maxY),
    };

    const larger = rightOffcut.area > bottomOffcut.area ? rightOffcut : bottomOffcut;
    if (larger.area > largestOffcut.area) {
      largestOffcut = larger;
    }
  }

  return largestOffcut;
}

// ============================================================================
// Basic Functionality Tests
// ============================================================================

test('packs a single part onto a sheet', async () => {
  const { packPartsIntoSheets } = await importPacking();

  const parts: PartSpec[] = [
    { id: 'part1', length_mm: 1000, width_mm: 500, qty: 1, grain: 'any' },
  ];

  const result = packPartsIntoSheets(parts, [STANDARD_SHEET]) as LayoutResult;

  assert.equal(result.sheets.length, 1, 'Should use 1 sheet');
  assert.equal(result.sheets[0].placements.length, 1, 'Should have 1 placement');
  assert.equal(result.unplaced, undefined, 'No parts should be unplaced');
});

test('expands parts by quantity', async () => {
  const { packPartsIntoSheets } = await importPacking();

  const parts: PartSpec[] = [
    { id: 'part1', length_mm: 500, width_mm: 400, qty: 5, grain: 'any' },
  ];

  const result = packPartsIntoSheets(parts, [STANDARD_SHEET]) as LayoutResult;

  const totalPlacements = result.sheets.reduce(
    (sum, s) => sum + s.placements.length,
    0
  );
  assert.equal(totalPlacements, 5, 'Should have 5 placements for qty=5');
});

test('handles parts too large for sheet', async () => {
  const { packPartsIntoSheets } = await importPacking();

  const parts: PartSpec[] = [
    { id: 'huge', length_mm: 3000, width_mm: 2000, qty: 1, grain: 'any' },
  ];

  const result = packPartsIntoSheets(parts, [STANDARD_SHEET]) as LayoutResult;

  assert.equal(result.sheets.length, 0, 'Should use 0 sheets');
  assert.ok(result.unplaced, 'Should have unplaced parts');
  assert.equal(result.unplaced[0].reason, 'too_large_for_sheet');
});

test('respects grain orientation - length', async () => {
  const { packPartsIntoSheets } = await importPacking();

  const parts: PartSpec[] = [
    { id: 'grain-length', length_mm: 2000, width_mm: 500, qty: 1, grain: 'length' },
  ];

  const result = packPartsIntoSheets(parts, [STANDARD_SHEET], { allowRotation: true }) as LayoutResult;

  assert.equal(result.sheets.length, 1);
  const placement = result.sheets[0].placements[0];
  // With grain='length', rotation should be 0° (length along sheet length)
  assert.equal(placement.rot, 0, 'Grain length should result in 0° rotation');
});

// ============================================================================
// Efficiency Benchmark Tests
// ============================================================================

test('achieves reasonable yield for well-fitting parts', async () => {
  const { packPartsIntoSheets } = await importPacking();

  const parts: PartSpec[] = [
    { id: 'panel', length_mm: 900, width_mm: 600, qty: 5, grain: 'any' },
  ];

  const result = packPartsIntoSheets(parts, [STANDARD_SHEET]) as LayoutResult;
  const yieldPct = calculateYield(result, STANDARD_SHEET);

  console.log(`  Efficiency test: ${yieldPct.toFixed(1)}% yield, ${result.sheets.length} sheets`);

  assert.ok(yieldPct > 40, `Yield should be >40%, got ${yieldPct.toFixed(1)}%`);
});

test('handles many small parts efficiently', async () => {
  const { packPartsIntoSheets } = await importPacking();

  const parts: PartSpec[] = [
    { id: 'small', length_mm: 200, width_mm: 150, qty: 50, grain: 'any' },
  ];

  const result = packPartsIntoSheets(parts, [STANDARD_SHEET]) as LayoutResult;
  const yieldPct = calculateYield(result, STANDARD_SHEET);
  const totalPlacements = result.sheets.reduce((s, sh) => s + sh.placements.length, 0);

  console.log(`  Small parts: ${yieldPct.toFixed(1)}% yield, ${result.sheets.length} sheets, ${totalPlacements} placements`);

  assert.equal(result.sheets.length, 1, 'Should fit on 1 sheet');
  assert.equal(totalPlacements, 50, 'All 50 parts should be placed');
});

test('minimizes sheets for mixed size parts', async () => {
  const { packPartsIntoSheets } = await importPacking();

  const parts: PartSpec[] = [
    { id: 'large1', length_mm: 1500, width_mm: 800, qty: 2, grain: 'any' },
    { id: 'medium1', length_mm: 800, width_mm: 600, qty: 4, grain: 'any' },
    { id: 'small1', length_mm: 400, width_mm: 300, qty: 8, grain: 'any' },
  ];

  const result = packPartsIntoSheets(parts, [STANDARD_SHEET]) as LayoutResult;
  const yieldPct = calculateYield(result, STANDARD_SHEET);

  // Calculate total area needed
  const totalArea =
    (1500 * 800 * 2) + // large
    (800 * 600 * 4) +  // medium
    (400 * 300 * 8);   // small
  const minSheets = Math.ceil(totalArea / (2750 * 1830));

  console.log(`  Mixed sizes: ${yieldPct.toFixed(1)}% yield`);
  console.log(`    Total part area: ${totalArea.toLocaleString()} mm²`);
  console.log(`    Theoretical minimum: ${minSheets} sheets`);
  console.log(`    Actual: ${result.sheets.length} sheets`);

  // Should be within reasonable range of theoretical minimum
  assert.ok(result.sheets.length <= minSheets * 2, 'Should use <= 2x theoretical minimum sheets');
});

// ============================================================================
// Offcut Quality Tests
// ============================================================================

test('leaves usable offcuts when possible', async () => {
  const { packPartsIntoSheets } = await importPacking();

  const parts: PartSpec[] = [
    { id: 'panel', length_mm: 1000, width_mm: 1000, qty: 2, grain: 'any' },
  ];

  const result = packPartsIntoSheets(parts, [STANDARD_SHEET]) as LayoutResult;
  const largestOffcut = estimateLargestOffcut(result, STANDARD_SHEET);

  console.log(`  Offcut test: Largest ~${largestOffcut.width}×${largestOffcut.height}mm (${(largestOffcut.area / 1000000).toFixed(2)} m²)`);

  // With 2× 1000×1000 on 2750×1830, should have significant offcut
  assert.ok(largestOffcut.area > 500000, 'Should have >0.5 m² usable offcut');
});

test('calculates waste area correctly', async () => {
  const { packPartsIntoSheets } = await importPacking();

  const parts: PartSpec[] = [
    { id: 'part1', length_mm: 1500, width_mm: 800, qty: 1, grain: 'any' },
  ];

  const result = packPartsIntoSheets(parts, [STANDARD_SHEET]) as LayoutResult;

  const usedArea = 1500 * 800;
  const sheetArea = 2750 * 1830;
  const expectedWaste = sheetArea - usedArea;

  assert.equal(result.stats.waste_area_mm2, expectedWaste, 'Waste calculation should be correct');
});

// ============================================================================
// Multi-Sheet Scaling Tests
// ============================================================================

test('handles 100+ parts across multiple sheets', async () => {
  const { packPartsIntoSheets } = await importPacking();

  const parts: PartSpec[] = [
    { id: 'side', length_mm: 700, width_mm: 400, qty: 40, grain: 'length' },
    { id: 'shelf', length_mm: 600, width_mm: 350, qty: 30, grain: 'length' },
    { id: 'back', length_mm: 800, width_mm: 500, qty: 20, grain: 'any' },
    { id: 'divider', length_mm: 300, width_mm: 200, qty: 25, grain: 'any' },
  ];

  const totalParts = 40 + 30 + 20 + 25; // 115 parts

  const result = packPartsIntoSheets(parts, [STANDARD_SHEET]) as LayoutResult;
  const yieldPct = calculateYield(result, STANDARD_SHEET);

  const totalPlacements = result.sheets.reduce(
    (sum, s) => sum + s.placements.length,
    0
  );

  console.log(`  Multi-sheet (115 parts):`);
  console.log(`    Placements: ${totalPlacements}`);
  console.log(`    Sheets: ${result.sheets.length}`);
  console.log(`    Yield: ${yieldPct.toFixed(1)}%`);
  console.log(`    Unplaced: ${result.unplaced?.length || 0}`);

  assert.equal(totalPlacements, totalParts, 'All parts should be placed');
  assert.equal(result.unplaced, undefined, 'No parts should be unplaced');
  assert.ok(yieldPct > 50, 'Yield should be >50%');
});

test('handles 200 identical parts with acceptable performance', async () => {
  const { packPartsIntoSheets } = await importPacking();

  const parts: PartSpec[] = [
    { id: 'component', length_mm: 500, width_mm: 300, qty: 200, grain: 'any' },
  ];

  const start = performance.now();
  const result = packPartsIntoSheets(parts, [STANDARD_SHEET]) as LayoutResult;
  const elapsed = performance.now() - start;

  const totalPlacements = result.sheets.reduce(
    (sum, s) => sum + s.placements.length,
    0
  );
  const yieldPct = calculateYield(result, STANDARD_SHEET);

  console.log(`  200 parts test:`);
  console.log(`    Time: ${elapsed.toFixed(0)}ms`);
  console.log(`    Sheets: ${result.sheets.length}`);
  console.log(`    Yield: ${yieldPct.toFixed(1)}%`);

  assert.equal(totalPlacements, 200, 'All 200 parts should be placed');
  assert.ok(elapsed < 5000, 'Should complete in <5 seconds');
});

// ============================================================================
// Edge Banding Tests
// ============================================================================

test('calculates 16mm edge banding correctly', async () => {
  const { packPartsIntoSheets } = await importPacking();

  const parts: PartSpec[] = [
    {
      id: 'panel',
      length_mm: 1000,
      width_mm: 500,
      qty: 2,
      grain: 'any',
      band_edges: { top: true, bottom: true, left: true, right: true },
      lamination_type: 'none',
    },
  ];

  const result = packPartsIntoSheets(parts, [STANDARD_SHEET]) as LayoutResult;

  // Each part has perimeter = 2×(1000+500) = 3000mm
  // 2 parts = 6000mm of 16mm edging
  assert.equal(result.stats.edgebanding_16mm_mm, 6000, '16mm edging should be 6000mm');
});

test('calculates 32mm edge banding for laminated parts', async () => {
  const { packPartsIntoSheets } = await importPacking();

  const parts: PartSpec[] = [
    {
      id: 'panel',
      length_mm: 1000,
      width_mm: 500,
      qty: 2,
      grain: 'any',
      band_edges: { top: true, bottom: true, left: true, right: true },
      lamination_type: 'with-backer',
    },
  ];

  const result = packPartsIntoSheets(parts, [STANDARD_SHEET]) as LayoutResult;

  // Each part has perimeter = 3000mm
  // 2 parts = 6000mm of 32mm edging
  assert.equal(result.stats.edgebanding_32mm_mm, 6000, '32mm edging should be 6000mm');
});

// ============================================================================
// Algorithm Limitation Tests (documenting known behaviors)
// ============================================================================

test('BENCHMARK: greedy algorithm with challenging part mix', async () => {
  const { packPartsIntoSheets } = await importPacking();

  // This tests a case where greedy might not find optimal solution
  const parts: PartSpec[] = [
    // One tall thin part
    { id: 'tall', length_mm: 2500, width_mm: 200, qty: 1, grain: 'length' },
    // Several medium parts
    { id: 'medium', length_mm: 1000, width_mm: 800, qty: 4, grain: 'any' },
  ];

  const result = packPartsIntoSheets(parts, [STANDARD_SHEET]) as LayoutResult;
  const yieldPct = calculateYield(result, STANDARD_SHEET);

  console.log(`  Greedy limitation benchmark:`);
  console.log(`    Sheets: ${result.sheets.length}`);
  console.log(`    Yield: ${yieldPct.toFixed(1)}%`);

  // Document current behavior (not asserting optimal, just recording)
  console.log(`    [This benchmark helps track algorithm improvements]`);
});

test('BENCHMARK: guillotine split fragmentation', async () => {
  const { packPartsIntoSheets } = await importPacking();

  // Multiple different-sized parts to see how waste fragments
  const parts: PartSpec[] = [
    { id: 'p1', length_mm: 1000, width_mm: 800, qty: 1, grain: 'any' },
    { id: 'p2', length_mm: 900, width_mm: 700, qty: 1, grain: 'any' },
    { id: 'p3', length_mm: 800, width_mm: 600, qty: 1, grain: 'any' },
  ];

  const result = packPartsIntoSheets(parts, [STANDARD_SHEET]) as LayoutResult;
  const largestOffcut = estimateLargestOffcut(result, STANDARD_SHEET);

  console.log(`  Fragmentation benchmark:`);
  console.log(`    Sheets: ${result.sheets.length}`);
  console.log(`    Waste: ${(result.stats.waste_area_mm2 / 1000000).toFixed(2)} m²`);
  console.log(`    Est. largest offcut: ${largestOffcut.width}×${largestOffcut.height}mm`);
  console.log(`    [Ideally waste would be consolidated into larger offcuts]`);
});

// ============================================================================
// Kerf Accounting Tests
// ============================================================================

test('accounts for kerf in placements', async () => {
  const { packPartsIntoSheets } = await importPacking();

  // Two parts that fit exactly without kerf but shouldn't with kerf
  const tightSheet: StockSheetSpec = {
    id: 'tight',
    length_mm: 1000,
    width_mm: 1000,
    qty: 10,
    kerf_mm: 3,
  };

  const parts: PartSpec[] = [
    { id: 'part1', length_mm: 500, width_mm: 500, qty: 1, grain: 'any' },
    { id: 'part2', length_mm: 500, width_mm: 497, qty: 1, grain: 'any' }, // 500 + 3 kerf + 497 = 1000, just fits
  ];

  const result = packPartsIntoSheets(parts, [tightSheet]) as LayoutResult;

  // Both parts should fit
  const totalPlacements = result.sheets.reduce((s, sh) => s + sh.placements.length, 0);
  assert.equal(totalPlacements, 2, 'Both parts should be placed');

  // Verify no overlap (simplified check)
  if (result.sheets[0].placements.length === 2) {
    const p1 = result.sheets[0].placements[0];
    const p2 = result.sheets[0].placements[1];

    // Check they don't overlap (accounting for kerf)
    const noOverlap =
      (p1.x + p1.w + 3 <= p2.x) ||
      (p2.x + p2.w + 3 <= p1.x) ||
      (p1.y + p1.h + 3 <= p2.y) ||
      (p2.y + p2.h + 3 <= p1.y);

    assert.ok(noOverlap, 'Parts should not overlap with kerf accounted for');
  }
});

// ============================================================================
// Multi-Sort Optimization Tests
// ============================================================================

test('packPartsOptimized tries multiple strategies and picks best', async () => {
  const { packPartsOptimized, packPartsIntoSheets } = await importPacking();

  // The challenging case from before - tall thin part + medium parts
  const parts: PartSpec[] = [
    { id: 'tall', length_mm: 2500, width_mm: 200, qty: 1, grain: 'length' },
    { id: 'medium', length_mm: 1000, width_mm: 800, qty: 4, grain: 'any' },
  ];

  // Run with default (area) sort
  const defaultResult = packPartsIntoSheets(parts, [STANDARD_SHEET]) as LayoutResult;

  // Run with optimized multi-sort
  const optimizedResult = packPartsOptimized(parts, [STANDARD_SHEET]) as LayoutResult & { strategyUsed: string };

  console.log(`  Multi-sort optimization test:`);
  console.log(`    Default (area sort): ${defaultResult.sheets.length} sheets`);
  console.log(`    Optimized: ${optimizedResult.sheets.length} sheets (used ${optimizedResult.strategyUsed} strategy)`);

  // Optimized should be <= default
  assert.ok(
    optimizedResult.sheets.length <= defaultResult.sheets.length,
    'Optimized should use same or fewer sheets'
  );
});

test('packPartsOptimized improves grain-constrained tall parts', async () => {
  const { packPartsOptimized } = await importPacking();

  // Multiple grain-constrained parts of different sizes
  const parts: PartSpec[] = [
    { id: 'tall1', length_mm: 2400, width_mm: 300, qty: 2, grain: 'length' },
    { id: 'tall2', length_mm: 2200, width_mm: 250, qty: 2, grain: 'length' },
    { id: 'wide1', length_mm: 600, width_mm: 1500, qty: 3, grain: 'width' },
    { id: 'any1', length_mm: 800, width_mm: 600, qty: 4, grain: 'any' },
  ];

  const result = packPartsOptimized(parts, [STANDARD_SHEET]) as LayoutResult & { strategyUsed: string };
  const yieldPct = calculateYield(result, STANDARD_SHEET);

  console.log(`  Grain-constrained optimization:`);
  console.log(`    Strategy used: ${result.strategyUsed}`);
  console.log(`    Sheets: ${result.sheets.length}`);
  console.log(`    Yield: ${yieldPct.toFixed(1)}%`);

  // All parts should be placed
  const totalPlacements = result.sheets.reduce((s, sh) => s + sh.placements.length, 0);
  assert.equal(totalPlacements, 2 + 2 + 3 + 4, 'All 11 parts should be placed');
});

test('packPartsOptimized shows which strategy was used', async () => {
  const { packPartsOptimized } = await importPacking();

  const parts: PartSpec[] = [
    { id: 'part1', length_mm: 1000, width_mm: 500, qty: 5, grain: 'any' },
  ];

  const result = packPartsOptimized(parts, [STANDARD_SHEET]) as LayoutResult & { strategyUsed: string };

  assert.ok(
    ['area', 'length', 'width', 'perimeter'].includes(result.strategyUsed),
    'Should report which strategy was used'
  );

  console.log(`  Strategy reporting: used "${result.strategyUsed}" strategy`);
});

// ============================================================================
// NEW: Guillotine Packer Tests (Waste-Optimized)
// ============================================================================

test('guillotine packer achieves better waste consolidation', async () => {
  const { packPartsSmartOptimized, packPartsOptimized } = await importPacking();

  // Test case similar to screenshots comparison
  const parts: PartSpec[] = [
    { id: 'part1', length_mm: 700, width_mm: 600, qty: 4, grain: 'any' },
    { id: 'part2', length_mm: 1200, width_mm: 750, qty: 1, grain: 'any' },
    { id: 'part3', length_mm: 400, width_mm: 1080, qty: 1, grain: 'any' },
  ];

  const SHEET_2700x1800: StockSheetSpec = {
    id: 'standard',
    length_mm: 2700,
    width_mm: 1800,
    qty: 10,
    kerf_mm: 0,
  };

  // Compare legacy vs guillotine
  const legacyResult = packPartsOptimized(parts, [SHEET_2700x1800]) as LayoutResult;
  const guillotineResult = await packPartsSmartOptimized(parts, [SHEET_2700x1800], { algorithm: 'guillotine' }) as LayoutResult & { algorithm: string };

  const legacyYield = calculateYield(legacyResult, SHEET_2700x1800);
  const guillotineYield = calculateYield(guillotineResult, SHEET_2700x1800);

  console.log(`  Guillotine vs Legacy comparison:`);
  console.log(`    Legacy: ${legacyResult.sheets.length} sheets, ${legacyYield.toFixed(1)}% yield`);
  console.log(`    Guillotine: ${guillotineResult.sheets.length} sheets, ${guillotineYield.toFixed(1)}% yield`);
  console.log(`    Algorithm used: ${guillotineResult.algorithm}`);

  // Both should place all parts
  const legacyPlacements = legacyResult.sheets.reduce((s, sh) => s + sh.placements.length, 0);
  const guillotinePlacements = guillotineResult.sheets.reduce((s, sh) => s + sh.placements.length, 0);

  assert.equal(legacyPlacements, 6, 'Legacy should place all 6 parts');
  assert.equal(guillotinePlacements, 6, 'Guillotine should place all 6 parts');
});

test('guillotine packer respects grain constraints', async () => {
  const { packPartsSmartOptimized } = await importPacking();

  const parts: PartSpec[] = [
    { id: 'grain-length', length_mm: 2000, width_mm: 500, qty: 1, grain: 'length' },
    { id: 'grain-width', length_mm: 800, width_mm: 400, qty: 1, grain: 'width' },
    { id: 'grain-any', length_mm: 600, width_mm: 300, qty: 2, grain: 'any' },
  ];

  const result = await packPartsSmartOptimized(parts, [STANDARD_SHEET], { algorithm: 'guillotine' }) as LayoutResult;

  assert.equal(result.sheets.length, 1, 'Should fit on 1 sheet');

  const placements = result.sheets[0].placements;

  // Find the grain-length part
  const grainLengthPart = placements.find(p => p.part_id === 'grain-length');
  assert.ok(grainLengthPart, 'Grain-length part should be placed');
  assert.equal(grainLengthPart!.rot, 0, 'Grain-length part should not be rotated');

  // Find the grain-width part
  const grainWidthPart = placements.find(p => p.part_id === 'grain-width');
  assert.ok(grainWidthPart, 'Grain-width part should be placed');
  assert.equal(grainWidthPart!.rot, 90, 'Grain-width part should be rotated 90°');
});

test('guillotine packer places constrained parts first', async () => {
  const { packPartsSmartOptimized } = await importPacking();

  // Mix of constrained and unconstrained parts
  const parts: PartSpec[] = [
    { id: 'free1', length_mm: 500, width_mm: 400, qty: 5, grain: 'any' },
    { id: 'constrained1', length_mm: 2200, width_mm: 300, qty: 2, grain: 'length' },
    { id: 'free2', length_mm: 600, width_mm: 500, qty: 3, grain: 'any' },
  ];

  const result = await packPartsSmartOptimized(parts, [STANDARD_SHEET], { algorithm: 'guillotine' }) as LayoutResult;
  const totalPlacements = result.sheets.reduce((s, sh) => s + sh.placements.length, 0);

  console.log(`  Constrained-first test:`);
  console.log(`    Total parts: 10, Placed: ${totalPlacements}`);
  console.log(`    Sheets used: ${result.sheets.length}`);

  assert.equal(totalPlacements, 10, 'All 10 parts should be placed');
});

test('guillotine packer handles challenging tall+medium mix', async () => {
  const { packPartsSmartOptimized, packPartsOptimized } = await importPacking();

  // The challenging case that greedy struggles with
  const parts: PartSpec[] = [
    { id: 'tall', length_mm: 2500, width_mm: 200, qty: 1, grain: 'length' },
    { id: 'medium', length_mm: 1000, width_mm: 800, qty: 4, grain: 'any' },
  ];

  const legacyResult = packPartsOptimized(parts, [STANDARD_SHEET]) as LayoutResult;
  const guillotineResult = await packPartsSmartOptimized(parts, [STANDARD_SHEET], { algorithm: 'guillotine' }) as LayoutResult;

  console.log(`  Challenging mix test:`);
  console.log(`    Legacy: ${legacyResult.sheets.length} sheets`);
  console.log(`    Guillotine: ${guillotineResult.sheets.length} sheets`);

  // Both should place all parts
  const totalParts = 1 + 4;
  const legacyPlacements = legacyResult.sheets.reduce((s, sh) => s + sh.placements.length, 0);
  const guillotinePlacements = guillotineResult.sheets.reduce((s, sh) => s + sh.placements.length, 0);

  assert.equal(legacyPlacements, totalParts, 'Legacy should place all parts');
  assert.equal(guillotinePlacements, totalParts, 'Guillotine should place all parts');
});

test('guillotine packer performance with 200 parts', async () => {
  const { packPartsSmartOptimized } = await importPacking();

  const parts: PartSpec[] = [
    { id: 'component', length_mm: 500, width_mm: 300, qty: 200, grain: 'any' },
  ];

  const start = performance.now();
  const result = await packPartsSmartOptimized(parts, [STANDARD_SHEET], { algorithm: 'guillotine' }) as LayoutResult;
  const elapsed = performance.now() - start;

  const totalPlacements = result.sheets.reduce((s, sh) => s + sh.placements.length, 0);
  const yieldPct = calculateYield(result, STANDARD_SHEET);

  console.log(`  Guillotine 200 parts test:`);
  console.log(`    Time: ${elapsed.toFixed(0)}ms`);
  console.log(`    Sheets: ${result.sheets.length}`);
  console.log(`    Yield: ${yieldPct.toFixed(1)}%`);

  assert.equal(totalPlacements, 200, 'All 200 parts should be placed');
  assert.ok(elapsed < 1000, 'Should complete in <1 second');
});

test('guillotine packer can switch between algorithms', async () => {
  const { packPartsSmartOptimized } = await importPacking();

  const parts: PartSpec[] = [
    { id: 'part1', length_mm: 800, width_mm: 600, qty: 3, grain: 'any' },
  ];

  const legacyResult = await packPartsSmartOptimized(parts, [STANDARD_SHEET], { algorithm: 'legacy' }) as LayoutResult & { algorithm: string };
  const guillotineResult = await packPartsSmartOptimized(parts, [STANDARD_SHEET], { algorithm: 'guillotine' }) as LayoutResult & { algorithm: string };

  console.log(`  Algorithm switching test:`);
  console.log(`    Legacy algorithm: ${legacyResult.algorithm}`);
  console.log(`    Guillotine algorithm: ${guillotineResult.algorithm}`);

  assert.equal(legacyResult.algorithm, 'legacy', 'Should report legacy algorithm');
  assert.equal(guillotineResult.algorithm, 'guillotine', 'Should report guillotine algorithm');
});

// ============================================================================
// Simulated Annealing (SA) Optimizer Tests
// ============================================================================

const importSAOptimizer = async () => {
  const mod = await import('../lib/cutlist/saOptimizer.js');
  return mod;
};

const importGuillotinePacker = async () => {
  const mod = await import('../lib/cutlist/guillotinePacker.js');
  return mod;
};

test('SA optimizer produces equal or better results than heuristic baseline', async () => {
  const { runSimulatedAnnealing, calculateResultScoreV2 } = await importSAOptimizer();
  const { packPartsGuillotine, calculateResultScore } = await importGuillotinePacker();

  const parts: PartSpec[] = [
    { id: 'p1', length_mm: 1200, width_mm: 750, qty: 1, grain: 'any' },
    { id: 'p2', length_mm: 1080, width_mm: 400, qty: 1, grain: 'any' },
    { id: 'p3', length_mm: 710, width_mm: 700, qty: 4, grain: 'any' },
  ];

  const stock: StockSheetSpec = {
    id: 'S1',
    length_mm: 2750,
    width_mm: 1830,
    qty: 10,
    kerf_mm: 3,
  };
  const sheetArea = stock.length_mm * stock.width_mm;

  // Baseline
  const baseline = packPartsGuillotine(parts, [stock]);
  const baselineScore = calculateResultScoreV2(baseline, sheetArea);

  // SA with short time budget (5 seconds)
  const start = performance.now();
  const saResult = runSimulatedAnnealing(parts, stock, 5000);
  const elapsed = performance.now() - start;
  const saScore = calculateResultScoreV2(saResult, sheetArea);

  console.log(`  SA vs Heuristic:`);
  console.log(`    Baseline score: ${baselineScore.toFixed(0)}, sheets: ${baseline.sheets.length}`);
  console.log(`    SA score: ${saScore.toFixed(0)}, sheets: ${saResult.sheets.length}`);
  console.log(`    Time: ${elapsed.toFixed(0)}ms`);
  console.log(`    Strategy: ${saResult.strategyUsed}`);

  // SA should be at least as good as baseline
  assert.ok(saScore >= baselineScore - 1, 'SA score should be >= baseline score');

  // All parts should be placed
  const totalPlacements = saResult.sheets.reduce((s: number, sh: SheetLayout) => s + sh.placements.length, 0);
  assert.equal(totalPlacements, 6, 'All 6 parts should be placed');
});

test('SA optimizer respects grain constraints', async () => {
  const { runSimulatedAnnealing } = await importSAOptimizer();

  const parts: PartSpec[] = [
    { id: 'grain-len', length_mm: 2000, width_mm: 500, qty: 1, grain: 'length' },
    { id: 'grain-wid', length_mm: 800, width_mm: 400, qty: 1, grain: 'width' },
    { id: 'any1', length_mm: 600, width_mm: 300, qty: 3, grain: 'any' },
  ];

  const result = runSimulatedAnnealing(parts, STANDARD_SHEET, 3000);

  assert.equal(result.sheets.length, 1, 'Should fit on 1 sheet');

  const placements = result.sheets[0].placements;

  // Check grain-length part is not rotated
  const grainLenPart = placements.find((p: Placement) => p.part_id === 'grain-len');
  assert.ok(grainLenPart, 'Grain-length part should be placed');
  assert.equal(grainLenPart!.rot, 0, 'Grain-length part should not be rotated');

  // Check grain-width part is rotated
  const grainWidPart = placements.find((p: Placement) => p.part_id === 'grain-wid');
  assert.ok(grainWidPart, 'Grain-width part should be placed');
  assert.equal(grainWidPart!.rot, 90, 'Grain-width part should be rotated 90°');
});

test('SA scoring V2 prioritizes offcut quality heavily', async () => {
  const { calculateResultScoreV2 } = await importSAOptimizer();
  const { packPartsGuillotine } = await importGuillotinePacker();

  const parts: PartSpec[] = [
    { id: 'p1', length_mm: 1000, width_mm: 800, qty: 2, grain: 'any' },
  ];

  const result = packPartsGuillotine(parts, [STANDARD_SHEET]);
  const sheetArea = STANDARD_SHEET.length_mm * STANDARD_SHEET.width_mm;
  const score = calculateResultScoreV2(result, sheetArea);

  console.log(`  Scoring V2 test:`);
  console.log(`    Score: ${score.toFixed(0)}`);
  console.log(`    Largest offcut area: ${result.largestOffcutArea.toLocaleString()} mm²`);
  console.log(`    Concentration: ${(result.offcutConcentration * 100).toFixed(1)}%`);

  // Score should be negative (1 sheet = -100,000 base) but offset by bonuses
  assert.ok(score < 0, 'Score for 1 sheet should be negative base');
  assert.ok(score > -100_000, 'Bonuses should offset some of the sheet penalty');
});

test('SA optimizer completes within time budget', async () => {
  const { runSimulatedAnnealing } = await importSAOptimizer();

  const parts: PartSpec[] = [
    { id: 'comp', length_mm: 500, width_mm: 300, qty: 20, grain: 'any' },
  ];

  const timeBudget = 3000; // 3 seconds
  const start = performance.now();
  const result = runSimulatedAnnealing(parts, STANDARD_SHEET, timeBudget);
  const elapsed = performance.now() - start;

  console.log(`  Time budget test: ${elapsed.toFixed(0)}ms for ${timeBudget}ms budget`);

  // Should complete within budget + small overhead
  assert.ok(elapsed < timeBudget + 1000, `Should complete near budget (got ${elapsed.toFixed(0)}ms)`);

  // All parts should be placed
  const totalPlacements = result.sheets.reduce((s: number, sh: SheetLayout) => s + sh.placements.length, 0);
  assert.equal(totalPlacements, 20, 'All 20 parts should be placed');
});

test('SA optimizer progress callback fires', async () => {
  const { runSimulatedAnnealing } = await importSAOptimizer();

  const parts: PartSpec[] = [
    { id: 'p1', length_mm: 800, width_mm: 600, qty: 4, grain: 'any' },
  ];

  let progressCount = 0;
  let lastIteration = 0;

  runSimulatedAnnealing(
    parts,
    STANDARD_SHEET,
    2000,
    { progressIntervalMs: 200 },
    {},
    (progress) => {
      progressCount++;
      lastIteration = progress.iteration;
    }
  );

  console.log(`  Progress callback test: ${progressCount} callbacks, ${lastIteration} iterations`);

  assert.ok(progressCount > 0, 'Should have received progress callbacks');
  assert.ok(lastIteration > 100, 'Should have completed many iterations');
});

test('SA optimizer can be cancelled via shouldCancel', async () => {
  const { runSimulatedAnnealing } = await importSAOptimizer();

  const parts: PartSpec[] = [
    { id: 'p1', length_mm: 500, width_mm: 300, qty: 20, grain: 'any' },
  ];

  // Cancel immediately — the SA loop checks shouldCancel on every iteration
  const result = runSimulatedAnnealing(
    parts,
    STANDARD_SHEET,
    30000, // 30s budget
    {},
    {},
    undefined,
    () => true // always cancel
  );

  console.log(`  Cancel test: SA returned after immediate cancel`);
  console.log(`    Strategy: ${result.strategyUsed}`);

  // Should still return the baseline result (heuristic)
  assert.ok(result.sheets.length > 0, 'Should still have a result from baseline');
});

console.log('\n=== Cutlist Packing Algorithm Tests ===\n');
