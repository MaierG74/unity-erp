import type { SheetLayout } from './types';

export interface UtilizationBreakdown {
  totalArea_mm2: number;
  partsArea_mm2: number;
  reusableArea_mm2: number;
  scrapArea_mm2: number;
  mechanicalPctRaw: number;
  effectivePctRaw: number;
  displayPartsPct: number;
  displayReusablePct: number;
  displayScrapPct: number;
  hasReusable: boolean;
  hasAreaDrift: boolean;
}

interface AreaInputs {
  totalArea_mm2: number;
  partsArea_mm2: number;
  reusableArea_mm2: number;
}

const DRIFT_TOLERANCE_MM2 = 0.5;

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function sumPlacementArea(sheet: SheetLayout) {
  return sheet.placements.reduce((sum, placement) => sum + placement.w * placement.h, 0);
}

function roundToTenth(value: number) {
  return Math.round(value * 10) / 10;
}

function computeDisplayPercentages(partsRaw: number, reusableRaw: number, scrapRaw: number) {
  const rounded = [roundToTenth(partsRaw), roundToTenth(reusableRaw), roundToTenth(scrapRaw)];
  const delta = roundToTenth(100 - rounded.reduce((sum, pct) => sum + pct, 0));
  if (delta !== 0) {
    const rawValues = [partsRaw, reusableRaw, scrapRaw];
    const largestIndex = rawValues.indexOf(Math.max(...rawValues));
    rounded[largestIndex] = roundToTenth(rounded[largestIndex] + delta);
  }
  return {
    displayPartsPct: rounded[0],
    displayReusablePct: rounded[1],
    displayScrapPct: rounded[2],
  };
}

function buildBreakdown({ totalArea_mm2, partsArea_mm2, reusableArea_mm2 }: AreaInputs): UtilizationBreakdown {
  const totalArea = Math.max(0, Number.isFinite(totalArea_mm2) ? totalArea_mm2 : 0);
  const rawPartsArea = Math.max(0, Number.isFinite(partsArea_mm2) ? partsArea_mm2 : 0);
  const rawReusableArea = Math.max(0, Number.isFinite(reusableArea_mm2) ? reusableArea_mm2 : 0);
  const hasAreaDrift = rawPartsArea + rawReusableArea > totalArea + DRIFT_TOLERANCE_MM2;

  if (totalArea <= 0) {
    return {
      totalArea_mm2: 0,
      partsArea_mm2: 0,
      reusableArea_mm2: 0,
      scrapArea_mm2: 0,
      mechanicalPctRaw: 0,
      effectivePctRaw: 0,
      displayPartsPct: 0,
      displayReusablePct: 0,
      displayScrapPct: 0,
      hasReusable: false,
      hasAreaDrift,
    };
  }

  const partsArea = clamp(rawPartsArea, 0, totalArea);
  const reusableArea = clamp(rawReusableArea, 0, totalArea - partsArea);
  const scrapArea = Math.max(0, totalArea - partsArea - reusableArea);
  const mechanicalPctRaw = (partsArea / totalArea) * 100;
  const reusablePctRaw = (reusableArea / totalArea) * 100;
  const scrapPctRaw = (scrapArea / totalArea) * 100;
  const displayPercentages = computeDisplayPercentages(
    mechanicalPctRaw,
    reusablePctRaw,
    scrapPctRaw,
  );

  return {
    totalArea_mm2: totalArea,
    partsArea_mm2: partsArea,
    reusableArea_mm2: reusableArea,
    scrapArea_mm2: scrapArea,
    mechanicalPctRaw,
    effectivePctRaw: mechanicalPctRaw + reusablePctRaw,
    ...displayPercentages,
    hasReusable: reusableArea > 0,
    hasAreaDrift,
  };
}

export function computeSheetUtilization(
  sheet: SheetLayout,
  sheetWidth_mm: number,
  sheetLength_mm: number,
): UtilizationBreakdown {
  return buildBreakdown({
    totalArea_mm2: sheetWidth_mm * sheetLength_mm,
    partsArea_mm2: sheet.used_area_mm2 ?? sumPlacementArea(sheet),
    reusableArea_mm2: sheet.offcut_summary?.reusableArea_mm2 ?? 0,
  });
}

export function computeRolledUpUtilization(
  sheets: Array<{ layout: SheetLayout; widthMm: number; lengthMm: number }>,
): UtilizationBreakdown {
  return buildBreakdown(
    sheets.reduce(
      (totals, sheet) => {
        totals.totalArea_mm2 += sheet.widthMm * sheet.lengthMm;
        totals.partsArea_mm2 += sheet.layout.used_area_mm2 ?? sumPlacementArea(sheet.layout);
        totals.reusableArea_mm2 += sheet.layout.offcut_summary?.reusableArea_mm2 ?? 0;
        return totals;
      },
      { totalArea_mm2: 0, partsArea_mm2: 0, reusableArea_mm2: 0 },
    ),
  );
}
