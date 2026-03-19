import type { CutlistPart } from '@/lib/cutlist/types';
import type { PigeonholeConfig, FurnitureTemplate } from './types';
import { DEFAULT_PIGEONHOLE_CONFIG } from './types';

/**
 * Generate all cutlist parts for a pigeon hole unit.
 *
 * Assembly (bottom to top):
 *   - Adjusters (levelling feet)
 *   - Base (single or laminated)
 *   - Left Side + Right Side + Vertical Dividers between top and base
 *   - Horizontal Shelves span one cell width each (between dividers/sides)
 *   - Top (single or laminated) sits on top of sides
 *   - Back panel (optional) sits flush on base, slots into top
 *
 * Key dimensions:
 *   topBaseThickness = laminateTopBase ? T × 2 : T
 *   carcassWidth = W - max(topOverhangSides, baseOverhangSides) × 2
 *   carcassDepth = D - max(topOverhangBack, baseOverhangBack)
 *   sideHeight = H - adjusterHeight - topBaseThickness × 2
 *   internalWidth = carcassWidth - T × 2  (between outer sides)
 *   cellWidth = (internalWidth - T × (columns - 1)) / columns
 *   cellHeight = (sideHeight - T × (rows - 1)) / rows
 */
export function generatePigeonholeParts(config: PigeonholeConfig): CutlistPart[] {
  const { width: W, height: H, depth: D, materialThickness: T } = config;
  const { columns, rows, laminateTopBase, hasBack, backMaterialThickness: BT } = config;
  const rawDoorStyle = config.doorStyle ?? 'none';
  const doorStyle = rawDoorStyle === 'single' || rawDoorStyle === 'double' ? 'per-cell' : rawDoorStyle;
  const doorGap = config.doorGap ?? 2;
  const { shelfSetback, adjusterHeight, backSlotDepth, backRecess } = config;
  const { topOverhangSides, topOverhangBack, baseOverhangSides, baseOverhangBack } = config;

  const TB = laminateTopBase ? T * 2 : T; // top/base panel thickness

  // ── Derived dimensions ──
  const carcassWidth = W - Math.max(topOverhangSides, baseOverhangSides) * 2;
  const carcassDepth = D - Math.max(topOverhangBack, baseOverhangBack);
  const sideHeight = H - adjusterHeight - TB - TB; // minus top and base
  const internalWidth = carcassWidth - T * 2; // between outer side panels

  // Cell dimensions
  const cellWidth = (internalWidth - T * (columns - 1)) / columns;
  const cellHeight = (sideHeight - T * (rows - 1)) / rows;

  // Validate
  if (sideHeight <= 0 || internalWidth <= 0 || carcassDepth <= T) return [];
  if (cellWidth <= 0 || cellHeight <= 0) return [];

  const parts: CutlistPart[] = [];
  let counter = 0;
  const nextId = () => `cfg-${++counter}`;

  // ── TOP ──
  const topWidth = carcassWidth + topOverhangSides * 2;
  const topDepth = carcassDepth + topOverhangBack;

  if (laminateTopBase) {
    parts.push({
      id: nextId(),
      name: 'Top (laminated pair)',
      length_mm: topWidth,
      width_mm: topDepth,
      quantity: 2,
      grain: 'length',
      band_edges: { top: true, right: true, bottom: true, left: true },
      lamination_type: 'same-board',
    });
  } else {
    parts.push({
      id: nextId(),
      name: 'Top',
      length_mm: topWidth,
      width_mm: topDepth,
      quantity: 1,
      grain: 'length',
      band_edges: { top: true, right: true, bottom: true, left: true },
    });
  }

  // ── BASE ──
  const baseWidth = carcassWidth + baseOverhangSides * 2;
  const baseDepth = carcassDepth + baseOverhangBack;

  if (laminateTopBase) {
    parts.push({
      id: nextId(),
      name: 'Base (laminated pair)',
      length_mm: baseWidth,
      width_mm: baseDepth,
      quantity: 2,
      grain: 'length',
      band_edges: { top: true, right: true, bottom: true, left: true },
      lamination_type: 'same-board',
    });
  } else {
    parts.push({
      id: nextId(),
      name: 'Base',
      length_mm: baseWidth,
      width_mm: baseDepth,
      quantity: 1,
      grain: 'length',
      band_edges: { top: true, right: true, bottom: true, left: true },
    });
  }

  // ── SIDE PANELS ──
  // Front AND back edges banded
  parts.push({
    id: nextId(),
    name: 'Left Side',
    length_mm: sideHeight,
    width_mm: carcassDepth,
    quantity: 1,
    grain: 'length',
    band_edges: { top: false, right: true, bottom: false, left: true },
  });

  parts.push({
    id: nextId(),
    name: 'Right Side',
    length_mm: sideHeight,
    width_mm: carcassDepth,
    quantity: 1,
    grain: 'length',
    band_edges: { top: false, right: true, bottom: false, left: true },
  });

  // ── VERTICAL DIVIDERS ──
  const dividerCount = columns - 1;
  if (dividerCount > 0) {
    const dividerDepth = carcassDepth - shelfSetback - (hasBack ? BT + backRecess : 0);
    if (dividerDepth > 0) {
      parts.push({
        id: nextId(),
        name: dividerCount === 1 ? 'Vertical Divider' : 'Vertical Dividers',
        length_mm: sideHeight,
        width_mm: dividerDepth,
        quantity: dividerCount,
        grain: 'length',
        band_edges: { top: true, right: false, bottom: false, left: false },
      });
    }
  }

  // ── HORIZONTAL SHELVES ──
  // Each shelf spans one cell width (between dividers/sides, not full width)
  const shelfCount = (rows - 1) * columns;
  if (shelfCount > 0) {
    const shelfDepth = carcassDepth - shelfSetback - (hasBack ? BT + backRecess : 0);
    if (shelfDepth > 0 && cellWidth > 0) {
      parts.push({
        id: nextId(),
        name: shelfCount === 1 ? 'Shelf' : 'Shelves',
        length_mm: Math.round(cellWidth),
        width_mm: shelfDepth,
        quantity: shelfCount,
        grain: 'length',
        band_edges: { top: true, right: false, bottom: false, left: false },
      });
    }
  }

  // ── BACK PANEL ──
  if (hasBack) {
    const backHeight = sideHeight + backSlotDepth;
    const backWidth = internalWidth;

    if (backHeight > 0 && backWidth > 0) {
      parts.push({
        id: nextId(),
        name: 'Back',
        length_mm: backHeight,
        width_mm: backWidth,
        quantity: 1,
        grain: 'any',
        band_edges: { top: false, right: false, bottom: false, left: false },
      });
    }
  }

  // ── DOORS (per-cell) ──
  // Each compartment gets its own door. Door is inset by doorGap on all sides
  // of the cell opening. At dividers, two adjacent doors each have doorGap,
  // giving 2× doorGap total clearance between neighbouring doors.
  if (doorStyle === 'per-cell') {
    const doorW = Math.round(cellWidth - doorGap * 2);
    const doorH = Math.round(cellHeight - doorGap * 2);
    const doorQty = columns * rows;

    if (doorW > 0 && doorH > 0) {
      parts.push({
        id: nextId(),
        name: doorQty === 1 ? 'Door' : 'Doors',
        length_mm: doorH,
        width_mm: doorW,
        quantity: doorQty,
        grain: 'length',
        band_edges: { top: true, right: true, bottom: true, left: true },
      });
    }
  }

  return parts;
}

export const pigeonholeTemplate: FurnitureTemplate<PigeonholeConfig> = {
  id: 'pigeonhole',
  name: 'Pigeon Hole',
  description: 'Grid unit with configurable columns × rows and optional doors',
  defaultConfig: DEFAULT_PIGEONHOLE_CONFIG,
  generateParts: generatePigeonholeParts,
};
