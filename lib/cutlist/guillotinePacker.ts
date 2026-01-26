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
interface ExpandedPartInstance extends PartSpec {
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
export interface GuillotinePackResult extends LayoutResult {
  /** The sort strategy that produced this result */
  strategyUsed: SortStrategy;
  /** Remaining free rectangles (for visualization/debugging) */
  freeRects: FreeRect[];
  /** Usable offcuts above threshold */
  usableOffcuts: FreeRect[];
  /** Largest single offcut area */
  largestOffcutArea: number;
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
 * Calculate placement score using BSSF with waste penalties.
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

  return score;
}

/**
 * Split a free rectangle after placing a part using SSLAS strategy.
 * SSLAS = Split-Shorter-Leftover-Axis
 * Chooses the split that maximizes the largest remaining rectangle.
 */
function splitFreeRect(
  freeRect: FreeRect,
  partW: number,
  partH: number,
  _kerf: number, // kerf already included in partW/partH
  minDimension: number
): FreeRect[] {
  // partW and partH already include kerf, so no need to subtract it again
  const remRightW = freeRect.w - partW;
  const remTopH = freeRect.h - partH;

  // Calculate area of largest remnant for each split option
  // Split Horizontal: Top remnant gets full width
  const areaIfSplitHorz = freeRect.w * Math.max(0, remTopH);
  // Split Vertical: Right remnant gets full height
  const areaIfSplitVert = Math.max(0, remRightW) * freeRect.h;

  const result: FreeRect[] = [];

  if (areaIfSplitHorz >= areaIfSplitVert) {
    // Split horizontally - top remnant gets full width (better for waste consolidation)
    // Right remnant (beside the part)
    if (remRightW > minDimension) {
      result.push({
        x: freeRect.x + partW, // partW already includes kerf
        y: freeRect.y,
        w: remRightW,
        h: partH, // Only as tall as the part
      });
    }
    // Top remnant (above the part) - full width
    if (remTopH > minDimension) {
      result.push({
        x: freeRect.x,
        y: freeRect.y + partH, // partH already includes kerf
        w: freeRect.w, // Full width of original rect
        h: remTopH,
      });
    }
  } else {
    // Split vertically - right remnant gets full height (better for this case)
    // Top remnant (above the part)
    if (remTopH > minDimension) {
      result.push({
        x: freeRect.x,
        y: freeRect.y + partH, // partH already includes kerf
        w: partW, // Only as wide as the part
        h: remTopH,
      });
    }
    // Right remnant (beside the part) - full height
    if (remRightW > minDimension) {
      result.push({
        x: freeRect.x + partW, // partW already includes kerf
        y: freeRect.y,
        w: remRightW,
        h: freeRect.h, // Full height of original rect
      });
    }
  }

  return result;
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
function sortByStrategy(
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
function expandParts(parts: PartSpec[]): ExpandedPartInstance[] {
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
  const largestOffcutArea =
    usableOffcuts.length > 0 ? Math.max(...usableOffcuts.map((r) => r.w * r.h)) : 0;

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
 */
function calculateResultScore(result: GuillotinePackResult, sheetArea: number): number {
  const totalSheetArea = result.sheets.length * sheetArea;
  const usedArea = result.stats.used_area_mm2;

  // Calculate utilization percentage (0-100)
  const utilizationPct = (usedArea / totalSheetArea) * 100;

  // Calculate offcut quality score (normalized 0-100)
  // Larger single offcut relative to sheet area is better
  const offcutQualityPct = (result.largestOffcutArea / sheetArea) * 100;

  // Fewer fragmented offcuts is better (penalty for fragmentation)
  const fragmentationPenalty = Math.min(result.usableOffcuts.length * 2, 20);

  // Score breakdown:
  // - Sheet count: -10,000 per sheet (dominates all other factors)
  // - Utilization: +0-100 points for efficiency
  // - Offcut quality: +0-50 points for large offcuts
  // - Fragmentation: -0-20 points for many small offcuts
  return (
    -result.sheets.length * 10_000 + // Fewer sheets (primary)
    utilizationPct + // Higher utilization (secondary)
    offcutQualityPct * 0.5 - // Larger offcuts (tertiary)
    fragmentationPenalty // Fewer fragments (tertiary)
  );
}

/**
 * Pack parts using multiple strategies and return the best result.
 * This is the main entry point for optimized packing.
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

  let bestResult: GuillotinePackResult | null = null;
  let bestScore = -Infinity;

  for (const strategy of strategies) {
    const result = packWithStrategy(parts, sheet, strategy, config);
    const score = calculateResultScore(result, sheetArea);

    if (score > bestScore) {
      bestScore = score;
      bestResult = result;
    }
  }

  // Fallback to first strategy if something went wrong
  if (!bestResult) {
    bestResult = packWithStrategy(parts, sheet, 'constrained-longest', config);
  }

  return bestResult;
}

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
