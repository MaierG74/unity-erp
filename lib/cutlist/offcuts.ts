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

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
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

function intersect(a: Rect, b: Rect): Rect | null {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function subtractRect(rect: Rect, cutter: Rect): Rect[] {
  const cut = intersect(rect, cutter);
  if (!cut) return [rect];

  const pieces: Rect[] = [];
  const rectRight = rect.x + rect.w;
  const rectBottom = rect.y + rect.h;
  const cutRight = cut.x + cut.w;
  const cutBottom = cut.y + cut.h;

  if (cut.y > rect.y) {
    pieces.push({ x: rect.x, y: rect.y, w: rect.w, h: cut.y - rect.y });
  }
  if (cutBottom < rectBottom) {
    pieces.push({ x: rect.x, y: cutBottom, w: rect.w, h: rectBottom - cutBottom });
  }
  if (cut.x > rect.x) {
    pieces.push({ x: rect.x, y: cut.y, w: cut.x - rect.x, h: cut.h });
  }
  if (cutRight < rectRight) {
    pieces.push({ x: cutRight, y: cut.y, w: rectRight - cutRight, h: cut.h });
  }

  return pieces.filter((piece) => piece.w > 0 && piece.h > 0);
}

export function subtractOccupiedRects(candidates: Rect[], occupied: Rect[]): Rect[] {
  let free = candidates;
  for (const blocker of occupied) {
    free = free.flatMap((rect) => subtractRect(rect, blocker));
  }
  return free;
}
