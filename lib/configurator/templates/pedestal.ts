import type { CutlistPart } from '@/lib/cutlist/types';
import type { PedestalConfig, FurnitureTemplate } from './types';
import { DEFAULT_PEDESTAL_CONFIG } from './types';

/**
 * Generate all cutlist parts for a desk-height pedestal.
 *
 * Assembly (bottom to top):
 *   - Adjusters (levelling feet)
 *   - Base spans between sides
 *   - Left Side + Right Side extend full height (minus adjusters) — no top panel
 *   - Back panel (optional) sits in routed slot or flush
 *   - Drawer fronts stack vertically: pencil (top), standard (middle), filing (bottom)
 *
 * Key dimensions:
 *   sideHeight = H - adjusterHeight
 *   carcassHeight = sideHeight (drawer fronts fill the full front face)
 *   baseWidth = W - T × 2 (spans between sides)
 *   baseDepth = D - shelfSetback - (hasBack ? BT + backRecess : 0)
 *   drawerFrontWidth = baseWidth - drawerGap × 2
 */
export function generatePedestalParts(config: PedestalConfig): CutlistPart[] {
  const { width: W, height: H, depth: D, materialThickness: T } = config;
  const { drawerCount, hasPencilDrawer, pencilDrawerHeight, hasFilingDrawer, filingDrawerHeight } = config;
  const { drawerGap, hasBack, backMaterialThickness: BT } = config;
  const { adjusterHeight, shelfSetback, backRecess, backSlotDepth } = config;

  // ── Derived dimensions ──
  const sideHeight = H - adjusterHeight;
  const baseWidth = W - T * 2;
  const baseDepth = D - shelfSetback - (hasBack ? BT + backRecess : 0);

  // Validate
  if (sideHeight <= 0 || baseWidth <= 0 || baseDepth <= 0) return [];

  const parts: CutlistPart[] = [];
  let counter = 0;
  const nextId = () => `cfg-${++counter}`;

  // ── SIDE PANELS ──
  // Full depth, front and back edges banded. No top panel — sides are legs.
  parts.push({
    id: nextId(),
    name: 'Left Side',
    length_mm: sideHeight,
    width_mm: D,
    quantity: 1,
    grain: 'length',
    band_edges: { top: false, right: true, bottom: false, left: true },
  });

  parts.push({
    id: nextId(),
    name: 'Right Side',
    length_mm: sideHeight,
    width_mm: D,
    quantity: 1,
    grain: 'length',
    band_edges: { top: false, right: true, bottom: false, left: true },
  });

  // ── BASE ──
  // Spans between sides, set back from rear edge. Front edge banded.
  parts.push({
    id: nextId(),
    name: 'Base',
    length_mm: baseWidth,
    width_mm: baseDepth,
    quantity: 1,
    grain: 'length',
    band_edges: { top: true, right: false, bottom: false, left: false },
  });

  // ── BACK PANEL ──
  if (hasBack) {
    const backHeight = sideHeight + backSlotDepth;
    const backWidth = baseWidth;

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

  // ── DRAWER FRONTS ──
  // Calculate drawer front dimensions
  const pencilH = hasPencilDrawer ? pencilDrawerHeight : 0;
  const filingH = hasFilingDrawer ? filingDrawerHeight : 0;
  const totalFronts = drawerCount + (hasPencilDrawer ? 1 : 0) + (hasFilingDrawer ? 1 : 0);
  const totalGaps = (totalFronts - 1) * drawerGap;
  const drawerFrontWidth = baseWidth - drawerGap * 2;

  if (drawerFrontWidth <= 0) return parts;

  // Pencil drawer front (top)
  if (hasPencilDrawer && pencilH > 0) {
    parts.push({
      id: nextId(),
      name: 'Pencil Drawer Front',
      length_mm: drawerFrontWidth,
      width_mm: pencilH,
      quantity: 1,
      grain: 'length',
      band_edges: { top: true, right: true, bottom: true, left: true },
    });
  }

  // Standard drawer fronts (middle)
  if (drawerCount > 0) {
    const carcassHeight = sideHeight;
    const standardDrawerHeight = Math.round(
      (carcassHeight - pencilH - filingH - totalGaps) / drawerCount
    );

    if (standardDrawerHeight > 0) {
      parts.push({
        id: nextId(),
        name: drawerCount === 1 ? 'Standard Drawer Front' : 'Standard Drawer Fronts',
        length_mm: drawerFrontWidth,
        width_mm: standardDrawerHeight,
        quantity: drawerCount,
        grain: 'length',
        band_edges: { top: true, right: true, bottom: true, left: true },
      });
    }
  }

  // Filing drawer front (bottom)
  if (hasFilingDrawer && filingH > 0) {
    parts.push({
      id: nextId(),
      name: 'Filing Drawer Front',
      length_mm: drawerFrontWidth,
      width_mm: filingH,
      quantity: 1,
      grain: 'length',
      band_edges: { top: true, right: true, bottom: true, left: true },
    });
  }

  return parts;
}

export const pedestalTemplate: FurnitureTemplate<PedestalConfig> = {
  id: 'pedestal',
  name: 'Desk-Height Pedestal',
  description: 'Desk-height pedestal with configurable drawer layout — pencil, standard, and filing drawers',
  defaultConfig: DEFAULT_PEDESTAL_CONFIG,
  generateParts: generatePedestalParts,
};
