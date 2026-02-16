import type { CutlistPart } from '@/lib/cutlist/types';
import type { CupboardConfig, FurnitureTemplate } from './types';
import { DEFAULT_CUPBOARD_CONFIG } from './types';

/**
 * Generate all cutlist parts for a melamine cupboard.
 *
 * Assembly (bottom to top):
 *   - Adjusters (10mm levelling feet)
 *   - Base assembly (32mm laminated: 2× 16mm same-colour) with overhang
 *   - Sides sit on base, between top and base
 *   - Top assembly (32mm laminated: 2× 16mm same-colour) sits ON TOP of sides
 *   - Both top and base overhang 10mm past sides (L+R) and 10mm past back
 *   - Overhangs configurable to 0 for side-by-side cupboard installations
 *
 * Key dimensions:
 *   carcassWidth = W - max(topOverhangSides, baseOverhangSides) × 2
 *   carcassDepth = D - max(topOverhangBack, baseOverhangBack)
 *   sideHeight = H - adjusterHeight - 32mm(top) - 32mm(base)
 *
 * Back panel:
 *   Sits flush on base top surface, slots 8mm into routed groove in top underside.
 *   backHeight = sideHeight + backSlotDepth
 */
export function generateCupboardParts(config: CupboardConfig): CutlistPart[] {
  const { width: W, height: H, depth: D, materialThickness: T } = config;
  const { shelfCount, doorStyle, hasBack, backMaterialThickness: BT } = config;
  const { doorGap, shelfSetback, adjusterHeight, backSlotDepth } = config;
  const { topOverhangSides, topOverhangBack, baseOverhangSides, baseOverhangBack } = config;

  const T2 = T * 2; // 32mm laminated thickness

  // ── Derived dimensions ──

  // Carcass = the box formed by the sides. The sides sit between top and base.
  // The carcass width is determined by the side-to-side gap inside the overhanging top/base.
  const carcassWidth = W - Math.max(topOverhangSides, baseOverhangSides) * 2;
  const carcassDepth = D - Math.max(topOverhangBack, baseOverhangBack);

  // Side height = total H minus adjusters, minus top (32mm, sits on top), minus base (32mm, sides sit on base)
  const sideHeight = H - adjusterHeight - T2 - T2;

  // Internal width (between side panels)
  const internalWidth = carcassWidth - T * 2;

  // Validate
  if (sideHeight <= 0) return [];
  if (internalWidth <= 0) return [];
  if (carcassDepth <= T) return [];

  const parts: CutlistPart[] = [];
  let counter = 0;
  const nextId = () => `cfg-${++counter}`;

  // ── TOP (32mm laminated, same-board) ──
  // Two identical 16mm sheets. Overhangs past sides and back.
  // Top width = carcassWidth + topOverhangSides × 2
  // Top depth = carcassDepth + topOverhangBack
  const topWidth = carcassWidth + topOverhangSides * 2;
  const topDepth = carcassDepth + topOverhangBack;

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

  // ── BASE (32mm laminated, same-board — mirrors top) ──
  const baseWidth = carcassWidth + baseOverhangSides * 2;
  const baseDepth = carcassDepth + baseOverhangBack;

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

  // ── SIDE PANELS ──
  // Sides sit between top and base assemblies. Height = sideHeight, depth = carcassDepth.
  // Front edge gets banded.
  parts.push({
    id: nextId(),
    name: 'Left Side',
    length_mm: sideHeight,
    width_mm: carcassDepth,
    quantity: 1,
    grain: 'length',
    band_edges: { top: false, right: true, bottom: false, left: false },
  });

  parts.push({
    id: nextId(),
    name: 'Right Side',
    length_mm: sideHeight,
    width_mm: carcassDepth,
    quantity: 1,
    grain: 'length',
    band_edges: { top: false, right: false, bottom: false, left: true },
  });

  // ── SHELVES ──
  if (shelfCount > 0) {
    const shelfDepth = carcassDepth - shelfSetback - (hasBack ? BT : 0);
    if (shelfDepth > 0 && internalWidth > 0) {
      parts.push({
        id: nextId(),
        name: shelfCount === 1 ? 'Shelf' : 'Shelves',
        length_mm: internalWidth,
        width_mm: shelfDepth,
        quantity: shelfCount,
        grain: 'length',
        band_edges: { top: true, right: false, bottom: false, left: false },
      });
    }
  }

  // ── BACK PANEL ──
  if (hasBack) {
    // Sits flush on base top surface, slots backSlotDepth into routed groove in top.
    // Height = sideHeight + backSlotDepth (extends into top groove)
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

  // ── DOORS ──
  // Doors overlay the carcass front face (between top and base assemblies).
  const doorHeight = sideHeight - doorGap * 2;
  const singleDoorWidth = carcassWidth - doorGap * 2;

  if (doorStyle === 'single' && doorHeight > 0 && singleDoorWidth > 0) {
    parts.push({
      id: nextId(),
      name: 'Door',
      length_mm: doorHeight,
      width_mm: singleDoorWidth,
      quantity: 1,
      grain: 'length',
      band_edges: { top: true, right: true, bottom: true, left: true },
    });
  } else if (doorStyle === 'double' && doorHeight > 0) {
    const doorWidth = Math.floor((carcassWidth - doorGap * 3) / 2);
    if (doorWidth > 0) {
      parts.push({
        id: nextId(),
        name: 'Door Left',
        length_mm: doorHeight,
        width_mm: doorWidth,
        quantity: 1,
        grain: 'length',
        band_edges: { top: true, right: true, bottom: true, left: true },
      });
      parts.push({
        id: nextId(),
        name: 'Door Right',
        length_mm: doorHeight,
        width_mm: doorWidth,
        quantity: 1,
        grain: 'length',
        band_edges: { top: true, right: true, bottom: true, left: true },
      });
    }
  }

  return parts;
}

export const cupboardTemplate: FurnitureTemplate<CupboardConfig> = {
  id: 'cupboard',
  name: 'Cupboard',
  description: 'Standard melamine cupboard with adjusters, laminated top & base, and optional doors',
  defaultConfig: DEFAULT_CUPBOARD_CONFIG,
  generateParts: generateCupboardParts,
};
