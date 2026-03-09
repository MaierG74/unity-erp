import type { CutlistPart } from '@/lib/cutlist/types';
import type { CupboardConfig, FurnitureTemplate } from './types';
import { deriveCupboardGeometry } from './cupboardGeometry';
import { DEFAULT_CUPBOARD_CONFIG } from './types';

/**
 * Generate all cutlist parts for a melamine cupboard.
 *
 * Assembly (bottom to top):
 *   - Adjusters (10mm levelling feet)
 *   - Base assembly with configurable construction:
 *       - 16mm single board
 *       - 32mm laminated pair
 *       - 32mm cleated base (16mm full panel + 100mm underside perimeter strips)
 *   - Sides sit on base, between top and base
 *   - Top assembly with configurable construction (single or laminated) sits ON TOP of sides
 *   - Top/base can overhang independently at the front and back
 *   - Overhangs configurable to 0 for side-by-side cupboard installations
 *
 * Key dimensions:
 *   carcassWidth = W - max(topOverhangSides, baseOverhangSides) × 2
 *   carcassDepth = D - max(topOverhangFront, baseOverhangFront) - max(topOverhangBack, baseOverhangBack)
 *   sideHeight = H - adjusterHeight - topThickness - baseThickness
 *
 * Back panel:
 *   Sits flush on base top surface, slots 8mm into routed groove in top underside.
 *   backHeight = sideHeight + backSlotDepth
 */
export function generateCupboardParts(config: CupboardConfig): CutlistPart[] {
  const { materialThickness: T } = config;
  const { shelfCount, doorStyle, hasBack, topConstruction, baseConstruction } = config;
  const { doorGap, backSlotDepth } = config;
  const {
    valid,
    carcassWidth,
    carcassDepth,
    sideHeight,
    internalWidth,
    topWidth,
    topDepth,
    baseWidth,
    baseDepth,
    shelfDepth,
    baseCleatWidth,
  } = deriveCupboardGeometry(config);

  // Validate
  if (!valid) return [];

  const parts: CutlistPart[] = [];
  let counter = 0;
  const nextId = () => `cfg-${++counter}`;

  // ── TOP ──
  parts.push({
    id: nextId(),
    name: topConstruction === 'laminated' ? 'Top (laminated pair)' : 'Top',
    length_mm: topWidth,
    width_mm: topDepth,
    quantity: topConstruction === 'laminated' ? 2 : 1,
    grain: 'length',
    band_edges: { top: true, right: true, bottom: true, left: true },
    lamination_type: topConstruction === 'laminated' ? 'same-board' : 'none',
  });

  // ── BASE ──
  if (baseConstruction === 'laminated') {
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
  } else if (baseConstruction === 'single') {
    parts.push({
      id: nextId(),
      name: 'Base',
      length_mm: baseWidth,
      width_mm: baseDepth,
      quantity: 1,
      grain: 'length',
      band_edges: { top: true, right: true, bottom: true, left: true },
      lamination_type: 'none',
    });
  } else {
    const sideCleatLength = Math.max(0, baseDepth - baseCleatWidth * 2);

    parts.push({
      id: nextId(),
      name: 'Base Panel (cleated)',
      length_mm: baseWidth,
      width_mm: baseDepth,
      quantity: 1,
      grain: 'length',
      // 32mm edging is applied around the finished assembly; track the perimeter on the full panel.
      band_edges: { top: true, right: true, bottom: true, left: true },
      lamination_type: 'none',
    });

    parts.push({
      id: nextId(),
      name: 'Base Cleat Front/Back',
      length_mm: baseWidth,
      width_mm: baseCleatWidth,
      quantity: 2,
      grain: 'length',
      band_edges: { top: false, right: false, bottom: false, left: false },
      lamination_type: 'none',
    });

    if (sideCleatLength > 0) {
      parts.push({
        id: nextId(),
        name: 'Base Cleat Sides',
        length_mm: sideCleatLength,
        width_mm: baseCleatWidth,
        quantity: 2,
        grain: 'length',
        band_edges: { top: false, right: false, bottom: false, left: false },
        lamination_type: 'none',
      });
    }
  }

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
  description: 'Standard melamine cupboard with configurable top/base construction and optional doors',
  defaultConfig: DEFAULT_CUPBOARD_CONFIG,
  generateParts: generateCupboardParts,
};
