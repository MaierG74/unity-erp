/**
 * Guillotine Packer - Waste-Optimized 2D Bin Packing
 *
 * A guillotine-based packing algorithm optimized for melamine sheet cutting
 * with grain constraints and usable offcut consolidation.
 *
 * Key features:
 * - Per-item grain constraints (length, width, any)
 * - SSLAS (Split-Shorter-Leftover-Axis) for waste consolidation
 * - BSSF (Best-Short-Side-Fit) with waste penalties
 * - Multi-strategy optimization
 * - Built-in kerf handling via item inflation
 *
 * Based on research from:
 * - Cherri et al. (2009) - Cutting Stock Problem with Usable Leftovers
 * - Jukka Jylänki - A Thousand Ways to Pack the Bin
 * - guillotine-packer npm package patterns
 */

import type {
  PartSpec,
  StockSheetSpec,
  Placement,
  SheetLayout,
  LayoutResult,
  LayoutStats,
  UnplacedPart,
  GrainOrientation,
  BandEdges,
} from './types';

// =============================================================================
// Configuration
// =============================================================================

/**
 * Configuration for waste-aware packing behavior.
 */
export interface PackingConfig {
  /** Minimum dimension (mm) for an offcut to be usable. Default: 150 */
  minUsableDimension: number;
  /** Preferred minimum dimension (mm) for a good offcut. Default: 300 */
  preferredMinDimension: number;
  /** Minimum area (mm²) for an offcut to be usable. Default: 100,000 */
  minUsableArea: number;
  /** Penalty score for creating unusable slivers. Default: 10,000 */
  sliverPenalty: number;
  /** Penalty for sub-optimal but usable strips. Default: 2,000 */
  subOptimalPenalty: number;
  /** Bonus for placements touching sheet edges. Default: 500 */
  touchingBonus: number;
  /** Bonus for perfect fit (one dimension matches exactly). Default: 1,000 */
  perfectFitBonus: number;
  /** Weight for offcut concentration bonus (higher = favor consolidated waste). Default: 2000 */
  concentrationWeight: number;
  /** Penalty per additional free rectangle created. Default: 150 */
  fragmentationPenalty: number;
}

/**
 * Default configuration optimized for furniture manufacturing.
 */
export const DEFAULT_PACKING_CONFIG: PackingConfig = {
  minUsableDimension: 150,
  preferredMinDimension: 300,
  minUsableArea: 100_000,
  sliverPenalty: 10_000,
  subOptimalPenalty: 2_000,
  touchingBonus: 500,
  perfectFitBonus: 1_000,
  concentrationWeight: 2000,
  fragmentationPenalty: 150,
};

// =============================================================================
// Internal Types
// =============================================================================

/**
 * A free rectangle representing available space on the sheet.
 */
interface FreeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * An orientation option for placing a part.
 */
interface OrientationOption {
  /** Width when placed (after potential rotation) */
  w: number;
  /** Height when placed (after potential rotation) */
  h: number;
  /** Whether the part is rotated 90° */
  rotated: boolean;
}

/**
 * A candidate placement with score.
 */
interface PlacementCandidate {
  freeRectIndex: number;
  orientation: OrientationOption;
  score: number;
  x: number;
  y: number;
}

/**
 * Extended part with unique instance ID for quantity expansion.
 */
export interface ExpandedPartInstance extends PartSpec {
  uid: string;
}

/**
 * Sort strategy for parts before packing.
 */
export type SortStrategy =
  | 'constrained-longest'
  | 'area'
  | 'longest-side'
  | 'width'
  | 'perimeter'
  | 'width-ascending'
  | 'height';

/**
 * Result from packing with strategy info.
 */
/**
 * Per-sheet offcut information for detailed analysis.
 */
export interface SheetOffcutInfo {
  sheetIndex: number;
  freeRects: FreeRect[];
  largestOffcutArea: number;
  totalOffcutArea: number;
  concentration: number;
  fragmentCount: number;
}

export interface GuillotinePackResult extends LayoutResult {
  /** The sort strategy that produced this result */
  strategyUsed: SortStrategy | string;
  /** Remaining free rectangles (for visualization/debugging) */
  freeRects: FreeRect[];
  /** Usable offcuts above threshold */
  usableOffcuts: FreeRect[];
  /** Largest single offcut area */
  largestOffcutArea: number;
  /** Concentration ratio: largestOffcutArea / totalOffcutArea (1.0 = all waste in one piece) */
  offcutConcentration: number;
  /** Number of free rectangle fragments */
  fragmentCount: number;
  /** Per-sheet offcut details */
  perSheetOffcuts?: SheetOffcutInfo[];
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get valid orientations for a part based on grain constraint.
 */
function getValidOrientations(
  part: PartSpec,
  freeRect: FreeRect,
  kerf: number
): OrientationOption[] {
  const orientations: OrientationOption[] = [];
  const pW = part.width_mm + kerf;
  const pH = part.length_mm + kerf;
  const grain = part.grain ?? 'any';

  // Normal orientation (grain: 'length' or 'any')
  // Part length aligns with sheet length (Y axis)
  if (grain === 'length' || grain === 'any') {
    if (pW <= freeRect.w && pH <= freeRect.h) {
      orientations.push({ w: pW, h: pH, rotated: false });
    }
  }

  // Rotated orientation (grain: 'width' or 'any')
  // Part length aligns with sheet width (X axis) - rotate 90°
  if (grain === 'width' || grain === 'any') {
    // Only add rotated if dimensions are different
    if (pW !== pH && pH <= freeRect.w && pW <= freeRect.h) {
      orientations.push({ w: pH, h: pW, rotated: true });
    }
  }

  return orientations;
}

/**
 * Result of simulating a split operation.
 */
interface SplitSimulation {
  /** Free rectangles that would result from this split */
  rects: FreeRect[];
  /** Area of the largest resulting rectangle */
  largestArea: number;
  /** Total area of all resulting rectangles */
  totalArea: number;
  /** Concentration ratio: largestArea / totalArea (1.0 = all waste in one piece) */
  concentration: number;
  /** Number of resulting fragments */
  fragmentCount: number;
}

/**
 * Simulate a split operation without modifying state.
 * Used for offcut-aware scoring.
 */
function simulateSplit(
  freeRect: FreeRect,
  partW: number,
  partH: number,
  minDimension: number,
  splitHorizontal: boolean
): SplitSimulation {
  const remRightW = freeRect.w - partW;
  const remTopH = freeRect.h - partH;
  const rects: FreeRect[] = [];

  if (splitHorizontal) {
    // Split horizontally - top remnant gets full width
    if (remRightW > minDimension) {
      rects.push({
        x: freeRect.x + partW,
        y: freeRect.y,
        w: remRightW,
        h: partH,
      });
    }
    if (remTopH > minDimension) {
      rects.push({
        x: freeRect.x,
        y: freeRect.y + partH,
        w: freeRect.w,
        h: remTopH,
      });
    }
  } else {
    // Split vertically - right remnant gets full height
    if (remTopH > minDimension) {
      rects.push({
        x: freeRect.x,
        y: freeRect.y + partH,
        w: partW,
        h: remTopH,
      });
    }
    if (remRightW > minDimension) {
      rects.push({
        x: freeRect.x + partW,
        y: freeRect.y,
        w: remRightW,
        h: freeRect.h,
      });
    }
  }

  const areas = rects.map((r) => r.w * r.h);
  const largestArea = areas.length > 0 ? Math.max(...areas) : 0;
  const totalArea = areas.reduce((sum, a) => sum + a, 0);
  const concentration = totalArea > 0 ? largestArea / totalArea : 1;

  return {
    rects,
    largestArea,
    totalArea,
    concentration,
    fragmentCount: rects.length,
  };
}

/**
 * Evaluate both split directions and return the better one.
 */
function getBestSplit(
  freeRect: FreeRect,
  partW: number,
  partH: number,
  minDimension: number
): { horizontal: boolean; simulation: SplitSimulation } {
  const horizSim = simulateSplit(freeRect, partW, partH, minDimension, true);
  const vertSim = simulateSplit(freeRect, partW, partH, minDimension, false);

  // Score each split: higher concentration is better, fewer fragments is better
  // Also prefer keeping larger areas (better for future placements)
  const horizScore = horizSim.concentration * horizSim.largestArea - horizSim.fragmentCount * 10000;
  const vertScore = vertSim.concentration * vertSim.largestArea - vertSim.fragmentCount * 10000;

  if (horizScore >= vertScore) {
    return { horizontal: true, simulation: horizSim };
  }
  return { horizontal: false, simulation: vertSim };
}

/**
 * Calculate placement score using BSSF with waste penalties and offcut-aware scoring.
 * Lower score = better placement.
 */
function calculatePlacementScore(
  partW: number,
  partH: number,
  freeRect: FreeRect,
  config: PackingConfig
): number {
  const remW = freeRect.w - partW;
  const remH = freeRect.h - partH;

  // Base score: Best Short Side Fit (BSSF)
  // Prefer placements that minimize the smaller leftover dimension
  let score = Math.min(remW > 0 ? remW : Infinity, remH > 0 ? remH : Infinity);

  // Perfect fit bonus (one dimension matches exactly)
  if (remW === 0 || remH === 0) {
    score -= config.perfectFitBonus;
  }

  // Sliver penalty: heavily penalize creating unusable strips
  if (remW > 0 && remW < config.minUsableDimension) {
    score += config.sliverPenalty;
  }
  if (remH > 0 && remH < config.minUsableDimension) {
    score += config.sliverPenalty;
  }

  // Sub-optimal penalty: moderate penalty for usable but small strips
  if (remW >= config.minUsableDimension && remW < config.preferredMinDimension) {
    score += config.subOptimalPenalty;
  }
  if (remH >= config.minUsableDimension && remH < config.preferredMinDimension) {
    score += config.subOptimalPenalty;
  }

  // Touching perimeter bonus: prefer corner/edge placements
  // This consolidates free space toward one area of the sheet
  let touchingEdges = 0;
  if (freeRect.x === 0) touchingEdges++; // Left edge of sheet
  if (freeRect.y === 0) touchingEdges++; // Bottom edge of sheet
  score -= touchingEdges * config.touchingBonus;

  // === OFFCUT-AWARE SCORING ===
  // Simulate the best split and score based on waste consolidation
  const { simulation } = getBestSplit(freeRect, partW, partH, config.minUsableDimension);

  // Concentration bonus: prefer placements that keep waste consolidated
  // concentration of 1.0 means all remaining area is in one piece (ideal)
  score -= simulation.concentration * config.concentrationWeight;

  // Fragmentation penalty: penalize creating many small free rectangles
  score += simulation.fragmentCount * config.fragmentationPenalty;

  // Bonus for larger remaining offcut (relative to original rect)
  // This encourages keeping big usable pieces
  const originalArea = freeRect.w * freeRect.h;
  if (originalArea > 0) {
    const largestOffcutRatio = simulation.largestArea / originalArea;
    score -= largestOffcutRatio * 500; // Bonus for preserving large offcuts
  }

  return score;
}

/**
 * Split a free rectangle after placing a part using offcut-aware strategy.
 * Uses getBestSplit() to choose the split that best consolidates waste.
 */
function splitFreeRect(
  freeRect: FreeRect,
  partW: number,
  partH: number,
  _kerf: number, // kerf already included in partW/partH
  minDimension: number
): FreeRect[] {
  // Use the offcut-aware split selection
  const { simulation } = getBestSplit(freeRect, partW, partH, minDimension);
  return simulation.rects;
}

/**
 * Merge adjacent free rectangles that can be combined.
 * This reduces fragmentation and improves packing efficiency.
 */
function mergeFreeRects(freeRects: FreeRect[]): void {
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < freeRects.length; i++) {
      for (let j = i + 1; j < freeRects.length; j++) {
        const a = freeRects[i];
        const b = freeRects[j];

        // Horizontal merge (same y and height, adjacent in x)
        if (a.y === b.y && a.h === b.h) {
          if (Math.abs(a.x + a.w - b.x) < 1) {
            freeRects[i] = { x: a.x, y: a.y, w: a.w + b.w, h: a.h };
            freeRects.splice(j, 1);
            merged = true;
            break outer;
          } else if (Math.abs(b.x + b.w - a.x) < 1) {
            freeRects[i] = { x: b.x, y: a.y, w: a.w + b.w, h: a.h };
            freeRects.splice(j, 1);
            merged = true;
            break outer;
          }
        }

        // Vertical merge (same x and width, adjacent in y)
        if (a.x === b.x && a.w === b.w) {
          if (Math.abs(a.y + a.h - b.y) < 1) {
            freeRects[i] = { x: a.x, y: a.y, w: a.w, h: a.h + b.h };
            freeRects.splice(j, 1);
            merged = true;
            break outer;
          } else if (Math.abs(b.y + b.h - a.y) < 1) {
            freeRects[i] = { x: a.x, y: b.y, w: a.w, h: a.h + b.h };
            freeRects.splice(j, 1);
            merged = true;
            break outer;
          }
        }
      }
    }
  }
}

/**
 * Remove free rectangles that are fully contained within another.
 */
function pruneContainedRects(freeRects: FreeRect[]): void {
  for (let i = freeRects.length - 1; i >= 0; i--) {
    const a = freeRects[i];
    for (let j = 0; j < freeRects.length; j++) {
      if (i === j) continue;
      const b = freeRects[j];
      // Check if a is fully contained within b
      if (a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h) {
        freeRects.splice(i, 1);
        break;
      }
    }
  }
}

// =============================================================================
// Sorting Strategies
// =============================================================================

/**
 * Sort parts by strategy.
 * All strategies place constrained (grain-locked) parts first for flexibility.
 */
export function sortByStrategy(
  parts: ExpandedPartInstance[],
  strategy: SortStrategy
): ExpandedPartInstance[] {
  const sorted = [...parts];

  sorted.sort((a, b) => {
    // Level 1: Constrained parts first (they have less flexibility)
    const aConstrained = a.grain !== 'any' && a.grain !== undefined ? 0 : 1;
    const bConstrained = b.grain !== 'any' && b.grain !== undefined ? 0 : 1;
    if (aConstrained !== bConstrained) return aConstrained - bConstrained;

    // Level 2: Strategy-specific sorting
    switch (strategy) {
      case 'constrained-longest':
      case 'longest-side': {
        // Longest side descending (establishes major cut lines)
        const aMax = Math.max(a.length_mm, a.width_mm);
        const bMax = Math.max(b.length_mm, b.width_mm);
        if (aMax !== bMax) return bMax - aMax;
        break;
      }
      case 'area': {
        // Area descending
        const aArea = a.length_mm * a.width_mm;
        const bArea = b.length_mm * b.width_mm;
        if (aArea !== bArea) return bArea - aArea;
        break;
      }
      case 'width': {
        // Width descending
        if (a.width_mm !== b.width_mm) return b.width_mm - a.width_mm;
        break;
      }
      case 'perimeter': {
        // Perimeter descending
        const aPerim = 2 * (a.length_mm + a.width_mm);
        const bPerim = 2 * (b.length_mm + b.width_mm);
        if (aPerim !== bPerim) return bPerim - aPerim;
        break;
      }
      case 'width-ascending': {
        // Width ASCENDING - narrow parts first, wide parts last
        // This allows wide parts to fill remaining horizontal bands
        if (a.width_mm !== b.width_mm) return a.width_mm - b.width_mm;
        break;
      }
      case 'height': {
        // Height descending - based on placed height considering grain
        // For grain='length': height = length_mm
        // For grain='width': height = width_mm (rotated 90°)
        // For grain='any': height = max dimension (will likely be placed tall)
        const getPlacedHeight = (p: ExpandedPartInstance): number => {
          const grain = p.grain ?? 'any';
          if (grain === 'length') return p.length_mm;
          if (grain === 'width') return p.width_mm;
          return Math.max(p.length_mm, p.width_mm);
        };
        const aHeight = getPlacedHeight(a);
        const bHeight = getPlacedHeight(b);
        if (aHeight !== bHeight) return bHeight - aHeight;
        break;
      }
    }

    // Level 3: Area as tiebreaker
    const aArea = a.length_mm * a.width_mm;
    const bArea = b.length_mm * b.width_mm;
    if (aArea !== bArea) return bArea - aArea;

    // Level 4: ID for determinism
    return a.id.localeCompare(b.id);
  });

  return sorted;
}

// =============================================================================
// Main Packer Class
// =============================================================================

/**
 * Guillotine Packer - Waste-optimized 2D bin packing.
 */
export class GuillotinePacker {
  private freeRects: FreeRect[] = [];
  private placements: Placement[] = [];
  private sheetW: number;
  private sheetH: number;
  private kerf: number;
  private config: PackingConfig;

  constructor(
    sheetW: number,
    sheetH: number,
    kerf: number = 4,
    config: Partial<PackingConfig> = {}
  ) {
    this.sheetW = sheetW;
    this.sheetH = sheetH;
    this.kerf = kerf;
    this.config = { ...DEFAULT_PACKING_CONFIG, ...config };
    this.reset();
  }

  /**
   * Reset the packer for a new sheet.
   */
  reset(): void {
    this.freeRects = [{ x: 0, y: 0, w: this.sheetW, h: this.sheetH }];
    this.placements = [];
  }

  /**
   * Get current free rectangles (for debugging/visualization).
   */
  getFreeRects(): FreeRect[] {
    return [...this.freeRects];
  }

  /**
   * Get current placements.
   */
  getPlacements(): Placement[] {
    return [...this.placements];
  }

  /**
   * Try to place a single part on the current sheet.
   * Returns true if placed successfully.
   */
  tryPlace(part: PartSpec): boolean {
    let bestCandidate: PlacementCandidate | null = null;

    // Evaluate all free rectangles and orientations
    for (let i = 0; i < this.freeRects.length; i++) {
      const freeRect = this.freeRects[i];
      const orientations = getValidOrientations(part, freeRect, this.kerf);

      for (const orient of orientations) {
        const score = calculatePlacementScore(
          orient.w,
          orient.h,
          freeRect,
          this.config
        );

        if (!bestCandidate || score < bestCandidate.score) {
          bestCandidate = {
            freeRectIndex: i,
            orientation: orient,
            score,
            x: freeRect.x,
            y: freeRect.y,
          };
        }
      }
    }

    if (!bestCandidate) {
      return false;
    }

    // Place the part
    const { freeRectIndex, orientation, x, y } = bestCandidate;
    const freeRect = this.freeRects[freeRectIndex];

    // Record placement (store actual part dimensions, not inflated)
    this.placements.push({
      part_id: part.id,
      label: part.label,
      x,
      y,
      w: orientation.w - this.kerf,
      h: orientation.h - this.kerf,
      rot: orientation.rotated ? 90 : 0,
    });

    // Split the free rectangle
    const newFreeRects = splitFreeRect(
      freeRect,
      orientation.w,
      orientation.h,
      this.kerf,
      this.config.minUsableDimension
    );

    // Update free rectangles list
    this.freeRects.splice(freeRectIndex, 1, ...newFreeRects);

    // Merge and prune to reduce fragmentation
    mergeFreeRects(this.freeRects);
    pruneContainedRects(this.freeRects);

    return true;
  }

  /**
   * Pack multiple parts onto sheets.
   * Returns parts that couldn't be placed.
   */
  packAll(parts: PartSpec[]): PartSpec[] {
    const unplaced: PartSpec[] = [];

    for (const part of parts) {
      if (!this.tryPlace(part)) {
        unplaced.push(part);
      }
    }

    return unplaced;
  }

  /**
   * Calculate used area on current sheet.
   */
  getUsedArea(): number {
    return this.placements.reduce((sum, p) => sum + p.w * p.h, 0);
  }

  /**
   * Get usable offcuts (above minimum thresholds).
   */
  getUsableOffcuts(): FreeRect[] {
    return this.freeRects.filter(
      (r) =>
        Math.min(r.w, r.h) >= this.config.minUsableDimension &&
        r.w * r.h >= this.config.minUsableArea
    );
  }
}

// =============================================================================
// High-Level Packing Functions
// =============================================================================

/**
 * Expand parts by quantity into individual instances.
 */
export function expandParts(parts: PartSpec[]): ExpandedPartInstance[] {
  const expanded: ExpandedPartInstance[] = [];
  for (const p of parts) {
    const count = Math.max(1, Math.floor(p.qty));
    for (let i = 0; i < count; i++) {
      expanded.push({ ...p, uid: `${p.id}#${i + 1}` });
    }
  }
  return expanded;
}

/**
 * Pack parts into sheets using a single sort strategy.
 */
export function packWithStrategy(
  parts: PartSpec[],
  stock: StockSheetSpec,
  strategy: SortStrategy,
  config: Partial<PackingConfig> = {}
): GuillotinePackResult {
  const kerf = stock.kerf_mm ?? 4;
  const fullConfig = { ...DEFAULT_PACKING_CONFIG, ...config };

  // Expand parts by quantity
  const expanded = expandParts(parts);

  // Sort by strategy
  const sorted = sortByStrategy(expanded, strategy);

  // Track results across multiple sheets
  const sheets: SheetLayout[] = [];
  let remaining = [...sorted];
  let sheetIndex = 0;
  const maxSheets = stock.qty || 100;

  while (remaining.length > 0 && sheetIndex < maxSheets) {
    const packer = new GuillotinePacker(stock.width_mm, stock.length_mm, kerf, fullConfig);

    const stillUnplaced: ExpandedPartInstance[] = [];
    for (const part of remaining) {
      if (!packer.tryPlace(part)) {
        stillUnplaced.push(part);
      }
    }

    const placements = packer.getPlacements();
    if (placements.length === 0) {
      // No progress - remaining parts don't fit
      break;
    }

    sheets.push({
      sheet_id: `${stock.id}:${sheetIndex + 1}`,
      placements,
      used_area_mm2: packer.getUsedArea(),
    });

    remaining = stillUnplaced;
    sheetIndex++;
  }

  // Calculate stats
  const sheetArea = stock.width_mm * stock.length_mm;
  const totalSheetArea = sheetArea * sheets.length;
  const usedArea = sheets.reduce((sum, s) => sum + (s.used_area_mm2 ?? 0), 0);
  const wasteArea = Math.max(0, totalSheetArea - usedArea);

  // Get final free rects from last sheet for visualization
  const lastPacker = new GuillotinePacker(stock.width_mm, stock.length_mm, kerf, fullConfig);
  if (sheets.length > 0) {
    // Replay last sheet to get free rects
    const lastSheet = sheets[sheets.length - 1];
    for (const placement of lastSheet.placements) {
      const part: PartSpec = {
        id: placement.part_id,
        length_mm: placement.rot === 90 ? placement.w : placement.h,
        width_mm: placement.rot === 90 ? placement.h : placement.w,
        qty: 1,
        grain: 'any', // Doesn't matter for replay
      };
      lastPacker.tryPlace(part);
    }
  }

  const freeRects = sheets.length > 0 ? lastPacker.getFreeRects() : [];
  const usableOffcuts = freeRects.filter(
    (r) =>
      Math.min(r.w, r.h) >= fullConfig.minUsableDimension &&
      r.w * r.h >= fullConfig.minUsableArea
  );
  const allOffcutAreas = freeRects.map((r) => r.w * r.h);
  const largestOffcutArea = allOffcutAreas.length > 0 ? Math.max(...allOffcutAreas) : 0;
  const totalOffcutArea = allOffcutAreas.reduce((sum, a) => sum + a, 0);
  const offcutConcentration = totalOffcutArea > 0 ? largestOffcutArea / totalOffcutArea : 1;
  const fragmentCount = freeRects.length;

  // Calculate edge banding (basic - just sum of edges)
  let edgebandingLength = 0;
  for (const sheet of sheets) {
    for (const p of sheet.placements) {
      const originalPart = parts.find((part) => p.part_id.startsWith(part.id));
      if (originalPart?.band_edges) {
        const be = originalPart.band_edges;
        if (p.rot === 0) {
          edgebandingLength +=
            (be.top ? p.w : 0) + (be.right ? p.h : 0) + (be.bottom ? p.w : 0) + (be.left ? p.h : 0);
        } else {
          edgebandingLength +=
            (be.left ? p.w : 0) + (be.top ? p.h : 0) + (be.right ? p.w : 0) + (be.bottom ? p.h : 0);
        }
      }
    }
  }

  // Build unplaced summary
  const unplaced: UnplacedPart[] = [];
  if (remaining.length > 0) {
    const unplacedByPart = new Map<string, number>();
    for (const p of remaining) {
      const count = unplacedByPart.get(p.id) ?? 0;
      unplacedByPart.set(p.id, count + 1);
    }
    Array.from(unplacedByPart.entries()).forEach(([partId, count]) => {
      const originalPart = parts.find((p) => p.id === partId);
      if (originalPart) {
        unplaced.push({
          part: originalPart,
          count,
          reason:
            originalPart.width_mm > stock.width_mm || originalPart.length_mm > stock.length_mm
              ? 'too_large_for_sheet'
              : 'insufficient_sheet_capacity',
        });
      }
    });
  }

  // Calculate cuts (simplified - count unique cut lines)
  let cuts = 0;
  let cutLength = 0;
  for (const sheet of sheets) {
    // Each placement adds at most 2 cuts (right edge and bottom edge)
    cuts += sheet.placements.length * 2;
    for (const p of sheet.placements) {
      cutLength += p.w + p.h;
    }
  }

  const stats: LayoutStats = {
    used_area_mm2: usedArea,
    waste_area_mm2: wasteArea,
    cuts,
    cut_length_mm: cutLength,
    edgebanding_length_mm: edgebandingLength,
  };

  return {
    sheets,
    stats,
    unplaced: unplaced.length > 0 ? unplaced : undefined,
    strategyUsed: strategy,
    freeRects,
    usableOffcuts,
    largestOffcutArea,
    offcutConcentration,
    fragmentCount,
  };
}

/**
 * Overloaded version that accepts pre-expanded and sorted parts with a custom strategy name.
 * Used internally for multi-pass optimization.
 */
export function packWithExpandedParts(
  sortedParts: ExpandedPartInstance[],
  stock: StockSheetSpec,
  strategyName: string,
  originalParts: PartSpec[],
  config: Partial<PackingConfig> = {}
): GuillotinePackResult {
  const kerf = stock.kerf_mm ?? 4;
  const fullConfig = { ...DEFAULT_PACKING_CONFIG, ...config };

  // Track results across multiple sheets
  const sheets: SheetLayout[] = [];
  let remaining = [...sortedParts];
  let sheetIndex = 0;
  const maxSheets = stock.qty || 100;

  const perSheetOffcuts: SheetOffcutInfo[] = [];

  while (remaining.length > 0 && sheetIndex < maxSheets) {
    const packer = new GuillotinePacker(stock.width_mm, stock.length_mm, kerf, fullConfig);

    const stillUnplaced: ExpandedPartInstance[] = [];
    for (const part of remaining) {
      if (!packer.tryPlace(part)) {
        stillUnplaced.push(part);
      }
    }

    const placements = packer.getPlacements();
    if (placements.length === 0) {
      break;
    }

    // Capture per-sheet offcut info directly from packer state
    const sheetFreeRects = packer.getFreeRects();
    const sheetOffcutAreas = sheetFreeRects.map((r) => r.w * r.h);
    const sheetLargestOffcut = sheetOffcutAreas.length > 0 ? Math.max(...sheetOffcutAreas) : 0;
    const sheetTotalOffcut = sheetOffcutAreas.reduce((sum, a) => sum + a, 0);
    perSheetOffcuts.push({
      sheetIndex,
      freeRects: sheetFreeRects,
      largestOffcutArea: sheetLargestOffcut,
      totalOffcutArea: sheetTotalOffcut,
      concentration: sheetTotalOffcut > 0 ? sheetLargestOffcut / sheetTotalOffcut : 1,
      fragmentCount: sheetFreeRects.length,
    });

    sheets.push({
      sheet_id: `${stock.id}:${sheetIndex + 1}`,
      placements,
      used_area_mm2: packer.getUsedArea(),
    });

    remaining = stillUnplaced;
    sheetIndex++;
  }

  // Calculate stats
  const sheetArea = stock.width_mm * stock.length_mm;
  const totalSheetArea = sheetArea * sheets.length;
  const usedArea = sheets.reduce((sum, s) => sum + (s.used_area_mm2 ?? 0), 0);
  const wasteArea = Math.max(0, totalSheetArea - usedArea);

  // Aggregate offcut data from per-sheet tracking (last sheet for backwards compat)
  const lastSheetOffcuts = perSheetOffcuts.length > 0 ? perSheetOffcuts[perSheetOffcuts.length - 1] : null;
  const freeRects = lastSheetOffcuts?.freeRects ?? [];
  const usableOffcuts = freeRects.filter(
    (r) =>
      Math.min(r.w, r.h) >= fullConfig.minUsableDimension &&
      r.w * r.h >= fullConfig.minUsableArea
  );
  const largestOffcutArea = lastSheetOffcuts?.largestOffcutArea ?? 0;
  const totalOffcutArea = lastSheetOffcuts?.totalOffcutArea ?? 0;
  const offcutConcentration = lastSheetOffcuts?.concentration ?? 1;
  const fragmentCount = lastSheetOffcuts?.fragmentCount ?? 0;

  // Calculate edge banding
  let edgebandingLength = 0;
  for (const sheet of sheets) {
    for (const p of sheet.placements) {
      const originalPart = originalParts.find((part) => p.part_id.startsWith(part.id));
      if (originalPart?.band_edges) {
        const be = originalPart.band_edges;
        if (p.rot === 0) {
          edgebandingLength +=
            (be.top ? p.w : 0) + (be.right ? p.h : 0) + (be.bottom ? p.w : 0) + (be.left ? p.h : 0);
        } else {
          edgebandingLength +=
            (be.left ? p.w : 0) + (be.top ? p.h : 0) + (be.right ? p.w : 0) + (be.bottom ? p.h : 0);
        }
      }
    }
  }

  // Build unplaced summary
  const unplaced: UnplacedPart[] = [];
  if (remaining.length > 0) {
    const unplacedByPart = new Map<string, number>();
    for (const p of remaining) {
      const count = unplacedByPart.get(p.id) ?? 0;
      unplacedByPart.set(p.id, count + 1);
    }
    Array.from(unplacedByPart.entries()).forEach(([partId, count]) => {
      const originalPart = originalParts.find((p) => p.id === partId);
      if (originalPart) {
        unplaced.push({
          part: originalPart,
          count,
          reason:
            originalPart.width_mm > stock.width_mm || originalPart.length_mm > stock.length_mm
              ? 'too_large_for_sheet'
              : 'insufficient_sheet_capacity',
        });
      }
    });
  }

  // Calculate cuts
  let cuts = 0;
  let cutLength = 0;
  for (const sheet of sheets) {
    cuts += sheet.placements.length * 2;
    for (const p of sheet.placements) {
      cutLength += p.w + p.h;
    }
  }

  const stats: LayoutStats = {
    used_area_mm2: usedArea,
    waste_area_mm2: wasteArea,
    cuts,
    cut_length_mm: cutLength,
    edgebanding_length_mm: edgebandingLength,
  };

  return {
    sheets,
    stats,
    unplaced: unplaced.length > 0 ? unplaced : undefined,
    strategyUsed: strategyName,
    freeRects,
    usableOffcuts,
    largestOffcutArea,
    offcutConcentration,
    fragmentCount,
    perSheetOffcuts,
  };
}

/**
 * Calculate a score for a packing result.
 * Higher score = better result.
 *
 * Scoring hierarchy (in order of importance):
 * 1. Fewer sheets (primary - sheet count dominates all other factors)
 * 2. Higher utilization (secondary - efficiency per sheet)
 * 3. Quality of offcuts (tertiary - larger, fewer offcuts are better)
 * 4. Offcut concentration (prefer waste in one contiguous piece)
 */
export function calculateResultScore(result: GuillotinePackResult, sheetArea: number): number {
  const totalSheetArea = result.sheets.length * sheetArea;
  const usedArea = result.stats.used_area_mm2;

  // Calculate utilization percentage (0-100)
  const utilizationPct = totalSheetArea > 0 ? (usedArea / totalSheetArea) * 100 : 0;

  // Calculate offcut quality score (normalized 0-100)
  // Larger single offcut relative to sheet area is better
  const offcutQualityPct = (result.largestOffcutArea / sheetArea) * 100;

  // Offcut concentration: 1.0 = all waste in one piece (ideal), 0 = fragmented
  const concentrationBonus = result.offcutConcentration * 100;

  // Fewer fragmented offcuts is better (penalty for fragmentation)
  const fragmentationPenalty = result.fragmentCount * 5;

  // Score breakdown:
  // - Sheet count: -10,000 per sheet (dominates all other factors)
  // - Utilization: +0-100 points for efficiency
  // - Offcut quality: +0-100 points for large offcuts (increased weight)
  // - Concentration: +0-100 points for consolidated waste
  // - Fragmentation: penalty per fragment
  return (
    -result.sheets.length * 10_000 + // Fewer sheets (primary)
    utilizationPct + // Higher utilization (secondary)
    offcutQualityPct + // Larger offcuts (increased from 0.5 to 1.0)
    concentrationBonus - // Consolidated waste bonus
    fragmentationPenalty // Fragment penalty
  );
}

/**
 * Deterministic shuffle using a seed-based approach.
 * Produces consistent results for the same input.
 */
function deterministicShuffle<T>(array: T[], seed: number): T[] {
  const result = [...array];
  // Simple seeded random using linear congruential generator
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };

  // Fisher-Yates shuffle with seeded random
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Pack parts using multiple strategies and return the best result.
 * This is the main entry point for optimized packing.
 *
 * Multi-pass optimization:
 * 1. Try all standard sort strategies
 * 2. Try reversed versions of each strategy
 * 3. Try deterministic shuffles for additional diversity
 */
export function packPartsGuillotine(
  parts: PartSpec[],
  stock: StockSheetSpec[],
  config: Partial<PackingConfig> = {}
): GuillotinePackResult {
  const strategies: SortStrategy[] = [
    'constrained-longest',
    'area',
    'longest-side',
    'width',
    'perimeter',
    'width-ascending',
    'height',
  ];

  const sheet = stock[0]; // MVP: single sheet size
  const sheetArea = sheet.width_mm * sheet.length_mm;
  const fullConfig = { ...DEFAULT_PACKING_CONFIG, ...config };

  let bestResult: GuillotinePackResult | null = null;
  let bestScore = -Infinity;

  const updateBest = (result: GuillotinePackResult) => {
    const score = calculateResultScore(result, sheetArea);
    if (score > bestScore) {
      bestScore = score;
      bestResult = result;
    }
  };

  // Phase 1: Standard sort strategies
  for (const strategy of strategies) {
    const result = packWithStrategy(parts, sheet, strategy, config);
    updateBest(result);
  }

  // Phase 2: Expand parts and try additional orderings
  const expanded = expandParts(parts);

  // Try reversed versions of each strategy
  for (const strategy of strategies) {
    const sorted = sortByStrategy(expanded, strategy);
    const reversed = [...sorted].reverse();
    const result = packWithExpandedParts(reversed, sheet, `${strategy}-reversed`, parts, config);
    updateBest(result);
  }

  // Phase 3: Deterministic shuffles for additional diversity
  // Use different seeds to explore different orderings
  const shuffleSeeds = [42, 123, 456, 789, 1337];
  for (const seed of shuffleSeeds) {
    // Shuffle the area-sorted list (good baseline)
    const areaSorted = sortByStrategy(expanded, 'area');
    const shuffled = deterministicShuffle(areaSorted, seed);
    const result = packWithExpandedParts(shuffled, sheet, `shuffle-${seed}`, parts, config);
    updateBest(result);
  }

  // Phase 4: Try "corner packing" - sort by position preference
  // Parts that should go in corners first (largest parts at origin)
  const cornerSorted = [...expanded].sort((a, b) => {
    // Prefer larger parts first
    const aArea = a.length_mm * a.width_mm;
    const bArea = b.length_mm * b.width_mm;
    if (aArea !== bArea) return bArea - aArea;
    // Then by aspect ratio (squarer parts are more flexible)
    const aRatio = Math.max(a.length_mm, a.width_mm) / Math.min(a.length_mm, a.width_mm);
    const bRatio = Math.max(b.length_mm, b.width_mm) / Math.min(b.length_mm, b.width_mm);
    return aRatio - bRatio;
  });
  const cornerResult = packWithExpandedParts(cornerSorted, sheet, 'corner-priority', parts, config);
  updateBest(cornerResult);

  // Phase 5: "Strip building" - group similar heights together
  const heightGrouped = [...expanded].sort((a, b) => {
    // Round heights to 50mm bands for grouping
    const getPlacedHeight = (p: ExpandedPartInstance): number => {
      const grain = p.grain ?? 'any';
      if (grain === 'length') return p.length_mm;
      if (grain === 'width') return p.width_mm;
      return Math.max(p.length_mm, p.width_mm);
    };
    const aH = Math.floor(getPlacedHeight(a) / 50);
    const bH = Math.floor(getPlacedHeight(b) / 50);
    if (aH !== bH) return bH - aH; // Taller bands first
    // Within band, sort by width descending
    return b.width_mm - a.width_mm;
  });
  const stripResult = packWithExpandedParts(heightGrouped, sheet, 'height-bands', parts, config);
  updateBest(stripResult);

  // Fallback to first strategy if something went wrong
  if (!bestResult) {
    bestResult = packWithStrategy(parts, sheet, 'constrained-longest', config);
  }

  return bestResult;
}


/**
 * Deep optimization: Pack parts using a time budget to explore many variations.
 *
 * @param parts - Parts to pack
 * @param stock - Stock sheets
 * @param timeBudgetMs - Max time to run in milliseconds (default: 1000)
 * @param config - Packing configuration
 * @returns Best result found
 */
export async function packPartsGuillotineDeep(
  parts: PartSpec[],
  stock: StockSheetSpec[],
  timeBudgetMs: number = 1000,
  config: Partial<PackingConfig> = {}
): Promise<GuillotinePackResult> {
  const startTime = performance.now();
  const sheet = stock[0]; // MVP: single sheet size
  const sheetArea = sheet.width_mm * sheet.length_mm;
  const fullConfig = { ...DEFAULT_PACKING_CONFIG, ...config };

  // Initial result using standard heuristics (baseline)
  let bestResult = packPartsGuillotine(parts, stock, config);
  let bestScore = calculateResultScore(bestResult, sheetArea);

  // Expand parts once for reuse
  const expanded = expandParts(parts);

  // Optimization loop
  let iterations = 0;
  const strategies: SortStrategy[] = [
    'area',
    'constrained-longest',
    'width',
    'perimeter',
    'height',
  ];

  // Helper to yield to event loop to keep UI responsive
  const yieldToEventLoop = () => new Promise((resolve) => setTimeout(resolve, 0));

  while (performance.now() - startTime < timeBudgetMs) {
    iterations++;

    // Yield every 20 iterations to prevent UI freeze
    if (iterations % 20 === 0) {
      await yieldToEventLoop();
    }

    // Generate a random variation of parts
    // 1. Pick a random base strategy
    const baseStrategy = strategies[Math.floor(Math.random() * strategies.length)];
    const sorted = sortByStrategy(expanded, baseStrategy);

    // 2. Shuffle a random subset or swizzle pairs
    // For deep optimization, we want significant variations.
    // Let's use a randomized shuffle with a random seed.
    const seed = Math.floor(Math.random() * 1000000);
    const shuffled = deterministicShuffle(sorted, seed);

    // 3. Occasionally reverse the list
    if (Math.random() > 0.5) {
      shuffled.reverse();
    }

    // Pack this variation
    const strategyName = `deep-${baseStrategy}-${seed}`;
    const result = packWithExpandedParts(shuffled, sheet, strategyName, parts, config);
    const score = calculateResultScore(result, sheetArea);

    // Keep if better
    if (score > bestScore) {
      bestScore = score;
      bestResult = result;
    }
  }

  // Debug: uncomment to see iteration count
  // console.log(`Deep optimization: ${iterations} iterations in ${Math.round(performance.now() - startTime)}ms`);

  // Ensure we identify this as a deep optimization result
  return {
    ...bestResult,
    strategyUsed: `deep-optimized (${iterations} passes)`,
  };
}

// =============================================================================
// Helper: Convert to LayoutResult
// =============================================================================

/**
 * Convert GuillotinePackResult to standard LayoutResult for compatibility.
 */
export function toLayoutResult(result: GuillotinePackResult): LayoutResult {
  return {
    sheets: result.sheets,
    stats: result.stats,
    unplaced: result.unplaced,
  };
}
