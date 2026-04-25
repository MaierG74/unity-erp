/**
 * Reusable-offcut classification.
 *
 * Sheet grain convention: grain runs along the sheet's length_mm (Y) axis.
 * For an offcut FreeRect { w, h }:
 *   - AG (along grain) = h (Y axis)
 *   - CG (across grain) = w (X axis)
 */

import type { GrainOrientation } from './types';

export interface OffcutClassificationConfig {
  minUsableLength: number;
  minUsableWidth: number;
  minUsableGrain: GrainOrientation;
}

export function isReusableOffcut(
  rect: { w: number; h: number },
  cfg: OffcutClassificationConfig,
): boolean {
  const ag = rect.h; // along grain - Y axis
  const cg = rect.w; // across grain - X axis
  switch (cfg.minUsableGrain) {
    case 'length':
      return ag >= cfg.minUsableLength && cg >= cfg.minUsableWidth;
    case 'width':
      return cg >= cfg.minUsableLength && ag >= cfg.minUsableWidth;
    case 'any':
    default:
      return Math.max(ag, cg) >= cfg.minUsableLength
          && Math.min(ag, cg) >= cfg.minUsableWidth;
  }
}
