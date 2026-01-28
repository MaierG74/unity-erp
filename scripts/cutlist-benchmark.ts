import { performance } from 'node:perf_hooks';

import type { PartSpec, StockSheetSpec } from '../lib/cutlist/types';
import { packWithStrips } from '../lib/cutlist/stripPacker';
import { packPartsGuillotine } from '../lib/cutlist/guillotinePacker';
import { packPartsIntoSheets } from '../components/features/cutlist/packing';

type BenchmarkMetrics = {
  algorithm: string;
  sheets: number;
  usedArea: number;
  wasteArea: number;
  wastePct: number;
  cuts: number;
  cutLength: number;
  largestOffcutArea: number;
  runtimeMsAvg: number;
};

const SHEET: StockSheetSpec = {
  id: 'benchmark',
  length_mm: 2730,
  width_mm: 1830,
  qty: 10,
  kerf_mm: 3,
};

const PARTS: PartSpec[] = [
  { id: 'part-900x600', length_mm: 900, width_mm: 600, qty: 1, grain: 'any' },
  { id: 'part-700x580', length_mm: 700, width_mm: 580, qty: 4, grain: 'any' },
  { id: 'part-848x400', length_mm: 848, width_mm: 400, qty: 1, grain: 'any' },
];

const ITERATIONS = 200;

function toPct(value: number): number {
  return Math.round(value * 100) / 100;
}

function estimateLargestOffcutFromPlacements(
  sheet: StockSheetSpec,
  placements: Array<{ x: number; y: number; w: number; h: number }>
): number {
  let maxX = 0;
  let maxY = 0;
  for (const p of placements) {
    maxX = Math.max(maxX, p.x + p.w);
    maxY = Math.max(maxY, p.y + p.h);
  }
  const rightArea = Math.max(0, sheet.width_mm - maxX) * sheet.length_mm;
  const topArea = sheet.width_mm * Math.max(0, sheet.length_mm - maxY);
  return Math.max(rightArea, topArea);
}

function largestOffcutFromStrips(
  sheet: StockSheetSpec,
  stripsBySheet: Array<
    Array<{
      height: number;
      usedWidth: number;
    }>
  >
): number {
  let largest = 0;

  for (const strips of stripsBySheet) {
    const usedHeight = strips.reduce((sum, strip) => sum + strip.height, 0);
    const topArea = sheet.width_mm * Math.max(0, sheet.length_mm - usedHeight);
    largest = Math.max(largest, topArea);

    for (const strip of strips) {
      const rightArea = Math.max(0, sheet.width_mm - strip.usedWidth) * strip.height;
      largest = Math.max(largest, rightArea);
    }
  }

  return largest;
}

function averageRuntime(run: () => void, iterations: number): number {
  // Warm-up
  run();
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    run();
  }
  const end = performance.now();
  return (end - start) / iterations;
}

function benchmarkStrip(): BenchmarkMetrics {
  const run = () => packWithStrips(PARTS, SHEET);
  const result = run();
  const runtimeMsAvg = averageRuntime(run, ITERATIONS);

  const largestOffcutArea = largestOffcutFromStrips(SHEET, result.stripsBySheet);
  const wastePct = result.sheets.length
    ? (result.stats.waste_area_mm2 / (SHEET.length_mm * SHEET.width_mm * result.sheets.length)) * 100
    : 0;

  return {
    algorithm: 'strip',
    sheets: result.sheets.length,
    usedArea: result.stats.used_area_mm2,
    wasteArea: result.stats.waste_area_mm2,
    wastePct: toPct(wastePct),
    cuts: result.stats.cuts,
    cutLength: result.stats.cut_length_mm,
    largestOffcutArea,
    runtimeMsAvg: toPct(runtimeMsAvg),
  };
}

function benchmarkGuillotine(): BenchmarkMetrics {
  const run = () => packPartsGuillotine(PARTS, [SHEET]);
  const result = run();
  const runtimeMsAvg = averageRuntime(run, ITERATIONS);

  const largestOffcutArea =
    result.freeRects.length > 0
      ? Math.max(...result.freeRects.map((rect) => rect.w * rect.h))
      : 0;

  const wastePct = result.sheets.length
    ? (result.stats.waste_area_mm2 / (SHEET.length_mm * SHEET.width_mm * result.sheets.length)) * 100
    : 0;

  return {
    algorithm: 'guillotine',
    sheets: result.sheets.length,
    usedArea: result.stats.used_area_mm2,
    wasteArea: result.stats.waste_area_mm2,
    wastePct: toPct(wastePct),
    cuts: result.stats.cuts,
    cutLength: result.stats.cut_length_mm,
    largestOffcutArea,
    runtimeMsAvg: toPct(runtimeMsAvg),
  };
}

function benchmarkLegacy(): BenchmarkMetrics {
  const run = () => packPartsIntoSheets(PARTS, [SHEET]);
  const result = run();
  const runtimeMsAvg = averageRuntime(run, ITERATIONS);

  const placements = result.sheets.flatMap((sheet) => sheet.placements);
  const largestOffcutArea = estimateLargestOffcutFromPlacements(SHEET, placements);
  const wastePct = result.sheets.length
    ? (result.stats.waste_area_mm2 / (SHEET.length_mm * SHEET.width_mm * result.sheets.length)) * 100
    : 0;

  return {
    algorithm: 'legacy',
    sheets: result.sheets.length,
    usedArea: result.stats.used_area_mm2,
    wasteArea: result.stats.waste_area_mm2,
    wastePct: toPct(wastePct),
    cuts: result.stats.cuts,
    cutLength: result.stats.cut_length_mm,
    largestOffcutArea,
    runtimeMsAvg: toPct(runtimeMsAvg),
  };
}

function formatArea(value: number): string {
  return Math.round(value).toLocaleString('en-ZA');
}

function printResults(results: BenchmarkMetrics[]): void {
  console.log('\nCutlist Benchmark (Single Dataset)');
  console.log(`Sheet: ${SHEET.length_mm} x ${SHEET.width_mm} (kerf ${SHEET.kerf_mm}mm)`);
  console.log(
    `Parts: 900x600 x1, 700x580 x4, 848x400 x1 (grain: any)`
  );
  console.log('\nResults:');

  for (const r of results) {
    console.log(`\n- ${r.algorithm}`);
    console.log(`  Sheets used: ${r.sheets}`);
    console.log(`  Used area: ${formatArea(r.usedArea)} mm²`);
    console.log(`  Waste area: ${formatArea(r.wasteArea)} mm² (${r.wastePct}%)`);
    console.log(`  Cuts: ${r.cuts}`);
    console.log(`  Cut length: ${formatArea(r.cutLength)} mm`);
    console.log(`  Largest offcut area: ${formatArea(r.largestOffcutArea)} mm²`);
    console.log(`  Avg runtime: ${r.runtimeMsAvg} ms (${ITERATIONS} runs)`);
  }
}

const results = [benchmarkStrip(), benchmarkGuillotine(), benchmarkLegacy()];
printResults(results);
