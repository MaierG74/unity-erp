import type { CupboardConfig } from './types';

export const STANDARD_CUPBOARD_BASE_CLEAT_WIDTH = 100;

export interface CupboardDerivedGeometry {
  valid: boolean;
  carcassWidth: number;
  carcassDepth: number;
  sideHeight: number;
  internalWidth: number;
  topWidth: number;
  topDepth: number;
  baseWidth: number;
  baseDepth: number;
  shelfDepth: number;
  topThickness: number;
  baseThickness: number;
  baseCleatWidth: number;
  overallLeft: number;
  overallRight: number;
  overallFront: number;
  overallBack: number;
  carcassLeft: number;
  carcassRight: number;
  carcassFront: number;
  carcassBack: number;
  baseBottomY: number;
  baseTopY: number;
  sideBottomY: number;
  sideTopY: number;
  topBottomY: number;
  topTopY: number;
}

export function deriveCupboardGeometry(config: CupboardConfig): CupboardDerivedGeometry {
  const {
    width: W,
    depth: D,
    height: H,
    materialThickness: T,
    topConstruction,
    baseConstruction,
    topOverhangSides,
    topOverhangFront,
    topOverhangBack,
    baseOverhangSides,
    baseOverhangFront,
    baseOverhangBack,
    shelfSetback,
    hasBack,
    backMaterialThickness,
    backRecess,
    adjusterHeight,
  } = config;

  const topThickness = topConstruction === 'single' ? T : T * 2;
  const baseThickness = baseConstruction === 'single' ? T : T * 2;
  const maxSideOverhang = Math.max(topOverhangSides, baseOverhangSides);
  const maxFrontOverhang = Math.max(topOverhangFront, baseOverhangFront);
  const maxBackOverhang = Math.max(topOverhangBack, baseOverhangBack);
  const carcassWidth = W - maxSideOverhang * 2;
  const carcassDepth = D - maxFrontOverhang - maxBackOverhang;
  const sideHeight = H - adjusterHeight - topThickness - baseThickness;
  const internalWidth = carcassWidth - T * 2;
  const topWidth = carcassWidth + topOverhangSides * 2;
  const topDepth = carcassDepth + topOverhangFront + topOverhangBack;
  const baseWidth = carcassWidth + baseOverhangSides * 2;
  const baseDepth = carcassDepth + baseOverhangFront + baseOverhangBack;
  const shelfDepth = carcassDepth - shelfSetback - (hasBack ? backMaterialThickness + backRecess : 0);
  const baseCleatWidth =
    baseConstruction === 'cleated'
      ? Math.min(STANDARD_CUPBOARD_BASE_CLEAT_WIDTH, Math.floor(Math.min(baseWidth, baseDepth) / 2))
      : 0;
  const overallLeft = -W / 2;
  const overallRight = W / 2;
  const overallFront = -D / 2;
  const overallBack = D / 2;
  const carcassLeft = -carcassWidth / 2;
  const carcassRight = carcassWidth / 2;
  const carcassFront = overallFront + maxFrontOverhang;
  const carcassBack = overallBack - maxBackOverhang;
  const baseBottomY = adjusterHeight;
  const baseTopY = baseBottomY + baseThickness;
  const sideBottomY = baseTopY;
  const sideTopY = sideBottomY + sideHeight;
  const topBottomY = sideTopY;
  const topTopY = topBottomY + topThickness;

  return {
    valid: sideHeight > 0 && internalWidth > 0 && carcassDepth > T,
    carcassWidth,
    carcassDepth,
    sideHeight,
    internalWidth,
    topWidth,
    topDepth,
    baseWidth,
    baseDepth,
    shelfDepth,
    topThickness,
    baseThickness,
    baseCleatWidth,
    overallLeft,
    overallRight,
    overallFront,
    overallBack,
    carcassLeft,
    carcassRight,
    carcassFront,
    carcassBack,
    baseBottomY,
    baseTopY,
    sideBottomY,
    sideTopY,
    topBottomY,
    topTopY,
  };
}
