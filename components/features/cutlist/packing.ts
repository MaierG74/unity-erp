/**
 * Sheet Nesting / Packing Algorithm
 *
 * A greedy best-fit heuristic packer for 2D sheet nesting.
 * Supports lamination types for edge banding calculation.
 *
 * Edge Banding Thickness by Lamination Type:
 * - none: 16mm edging (single board)
 * - with-backer: 32mm edging (primary + backer)
 * - same-board: 32mm edging (2× primary)
 * - custom: variable edging (based on lamination_config.edgeThickness)
 */

// Import and re-export types from consolidated types file
export type {
  GrainOrientation,
  PartSpec,
  StockSheetSpec,
  Placement,
  SheetLayout,
  LayoutStats,
  UnplacedReason,
  UnplacedPart,
  LayoutResult,
  PackOptions,
  LaminationType,
  EdgingRequirement,
  CombinedPackingResult,
} from '@/lib/cutlist/types';

import type {
  GrainOrientation,
  PartSpec,
  StockSheetSpec,
  Placement,
  SheetLayout,
  LayoutStats,
  UnplacedReason,
  UnplacedPart,
  LayoutResult,
  PackOptions,
  LaminationType,
  EdgingRequirement,
  CombinedPackingResult,
  CutlistPart,
  ExpandedPart,
} from '@/lib/cutlist/types';

import {
  expandPartsWithLamination,
  expandedPartsToPartSpecs,
} from '@/lib/cutlist/boardCalculator';

import { packWithStrips } from '@/lib/cutlist/stripPacker';

// Re-export lamination expansion functions
export { expandPartsWithLamination, expandedPartsToPartSpecs };

// Export sort strategy type for external use
export type SortStrategy = 'area' | 'length' | 'width' | 'perimeter';

// =============================================================================
// Guillotine Packer (NEW - Waste-Optimized)
// =============================================================================

// Re-export the new guillotine packer
export {
  GuillotinePacker,
  packPartsGuillotine,
  packWithStrategy,
  toLayoutResult,
  DEFAULT_PACKING_CONFIG,
  type PackingConfig,
  type GuillotinePackResult,
  type SortStrategy as GuillotineSortStrategy,
} from '@/lib/cutlist/guillotinePacker';

// Re-export the strip packer (cut-minimizing algorithm)
export {
  packWithStrips,
  calculateStripScore,
  type StripPackResult,
  type StripPackerConfig,
} from '@/lib/cutlist/stripPacker';

// ============================================================================
// Internal Types
// ============================================================================

interface FreeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface VerticalSegment {
  x: number;
  y1: number;
  y2: number;
}

interface HorizontalSegment {
  y: number;
  x1: number;
  x2: number;
}

// ============================================================================
// Edge Thickness Helpers
// ============================================================================

/**
 * Get the edge thickness for a part based on its lamination type.
 */
function getPartEdgeThickness(part: PartSpec): number {
  // New lamination_type takes precedence
  if (part.lamination_type) {
    switch (part.lamination_type) {
      case 'none':
        return 16;
      case 'with-backer':
      case 'same-board':
        return 32;
      case 'custom':
        return part.lamination_config?.edgeThickness || 48;
    }
  }

  // Legacy: fall back to laminate boolean
  if (part.laminate) {
    return 32;
  }

  return 16;
}

/**
 * Check if a part should use 32mm edging (legacy compatibility).
 */
function shouldUse32mmEdging(part: PartSpec): boolean {
  // New lamination_type takes precedence
  if (part.lamination_type) {
    return part.lamination_type === 'with-backer' || part.lamination_type === 'same-board';
  }

  // Legacy: fall back to laminate boolean
  return !!part.laminate;
}

// ============================================================================
// Core Packing Algorithm
// ============================================================================

/**
 * Sort parts using the specified strategy.
 * All strategies sort descending (largest first) with deterministic tie-breakers.
 */
function sortByStrategy(
  parts: Array<PartSpec & { uid: string }>,
  strategy: SortStrategy
): void {
  parts.sort((a, b) => {
    let primary: number;

    switch (strategy) {
      case 'area':
        // Primary: area descending
        primary = (b.length_mm * b.width_mm) - (a.length_mm * a.width_mm);
        if (primary !== 0) return primary;
        // Secondary: max edge descending
        return Math.max(b.length_mm, b.width_mm) - Math.max(a.length_mm, a.width_mm) || a.id.localeCompare(b.id);

      case 'length':
        // Primary: length descending (good for grain-constrained tall parts)
        primary = b.length_mm - a.length_mm;
        if (primary !== 0) return primary;
        // Secondary: width descending
        return b.width_mm - a.width_mm || a.id.localeCompare(b.id);

      case 'width':
        // Primary: width descending
        primary = b.width_mm - a.width_mm;
        if (primary !== 0) return primary;
        // Secondary: length descending
        return b.length_mm - a.length_mm || a.id.localeCompare(b.id);

      case 'perimeter':
        // Primary: perimeter descending
        const perimA = 2 * (a.length_mm + a.width_mm);
        const perimB = 2 * (b.length_mm + b.width_mm);
        primary = perimB - perimA;
        if (primary !== 0) return primary;
        // Secondary: area descending
        return (b.length_mm * b.width_mm) - (a.length_mm * a.width_mm) || a.id.localeCompare(b.id);

      default:
        return 0;
    }
  });
}

/**
 * Greedy best-fit into free rectangles. Creates new sheet when needed (unless singleSheetOnly).
 * Not optimal; intended as fast MVP.
 *
 * Supports both legacy `laminate` boolean and new `lamination_type` enum for edge banding.
 */
export function packPartsIntoSheets(
  parts: PartSpec[],
  stock: StockSheetSpec[],
  opts: PackOptions & { sortStrategy?: SortStrategy } = {}
): LayoutResult {
  const allowRotation = opts.allowRotation !== false;
  const kerf = Math.max(0, stock[0]?.kerf_mm || 0);
  const sortStrategy = opts.sortStrategy || 'area';
  // Thresholds for pruning tiny scraps and avoiding slivers
  const MIN_DIMENSION_MM = Math.max(kerf, 10);

  // Expand parts list by quantity
  const expanded: Array<PartSpec & { uid: string }> = [];
  for (const p of parts) {
    const count = Math.max(1, Math.floor(p.qty));
    for (let i = 0; i < count; i++) expanded.push({ ...p, uid: `${p.id}#${i + 1}` });
  }

  // Sort using the specified strategy
  sortByStrategy(expanded, sortStrategy);

  // Initialize result with edging tracking by thickness
  const edgingByThickness = new Map<number, number>();
  const result: LayoutResult = {
    sheets: [],
    stats: {
      used_area_mm2: 0,
      waste_area_mm2: 0,
      cuts: 0,
      cut_length_mm: 0,
      edgebanding_length_mm: 0,
      edgebanding_16mm_mm: 0,
      edgebanding_32mm_mm: 0,
      edging_by_thickness: [],
    },
  };

  let sheetIdx = 0;
  let remainingSheets = totalQty(stock);

  while (expanded.length > 0) {
    if (remainingSheets <= 0) break;
    const sheet = stock[0]; // MVP: single size
    const free: FreeRect[] = [{ x: 0, y: 0, w: sheet.width_mm, h: sheet.length_mm }];
    const placements: Placement[] = [];
    const vSegments: VerticalSegment[] = [];
    const hSegments: HorizontalSegment[] = [];

    // Try pack as many as possible onto this sheet
    for (let i = 0; i < expanded.length; ) {
      const part = expanded[i];
      const placed = tryPlace(
        part,
        free,
        allowRotation,
        kerf,
        placements,
        vSegments,
        hSegments,
        MIN_DIMENSION_MM
      );

      if (placed) {
        placements.push(placed);

        // Edge banding length accounting (map edges if rotated)
        if (part.band_edges) {
          const be = part.band_edges;
          let pieceBand = 0;

          if (placed.rot === 0) {
            pieceBand =
              (be.top ? placed.w : 0) +
              (be.right ? placed.h : 0) +
              (be.bottom ? placed.w : 0) +
              (be.left ? placed.h : 0);
          } else {
            // rot 90°: top->left, right->top, bottom->right, left->bottom
            pieceBand =
              (be.left ? placed.w : 0) +
              (be.top ? placed.h : 0) +
              (be.right ? placed.w : 0) +
              (be.bottom ? placed.h : 0);
          }

          // Update total edging
          result.stats.edgebanding_length_mm! += pieceBand;

          // Get edge thickness for this part
          const edgeThickness = getPartEdgeThickness(part);

          // Track by thickness (new approach)
          const currentThicknessTotal = edgingByThickness.get(edgeThickness) || 0;
          edgingByThickness.set(edgeThickness, currentThicknessTotal + pieceBand);

          // Legacy 16mm/32mm tracking
          if (shouldUse32mmEdging(part)) {
            result.stats.edgebanding_32mm_mm! += pieceBand;
          } else {
            result.stats.edgebanding_16mm_mm! += pieceBand;
          }
        }

        expanded.splice(i, 1);
      } else {
        i++;
      }
    }

    const sheetUsedArea = placements.reduce((sum, pl) => sum + pl.w * pl.h, 0);

    if (placements.length === 0 || sheetUsedArea === 0) {
      break;
    }

    result.sheets.push({
      sheet_id: `${sheet.id}:${sheetIdx + 1}`,
      placements,
      used_area_mm2: sheetUsedArea,
    });
    sheetIdx++;
    remainingSheets--;
    if (opts.singleSheetOnly) break;
  }

  // Stats (with cut-segment accounting)
  const sheetArea = (stock[0]?.length_mm || 0) * (stock[0]?.width_mm || 0);
  let used = 0;
  for (const s of result.sheets) {
    const sheetUsed =
      typeof s.used_area_mm2 === 'number'
        ? s.used_area_mm2
        : s.placements.reduce((sum, pl) => sum + pl.w * pl.h, 0);
    if (typeof s.used_area_mm2 !== 'number') s.used_area_mm2 = sheetUsed;
    used += sheetUsed;
  }

  const totalSheetArea = sheetArea * result.sheets.length;
  result.stats.used_area_mm2 = used;
  result.stats.waste_area_mm2 = Math.max(0, totalSheetArea - used);

  // Recompute cut segments deterministically
  const combinedV: VerticalSegment[] = [];
  const combinedH: HorizontalSegment[] = [];
  for (const s of result.sheets) {
    for (const pl of s.placements) {
      combinedV.push({ x: pl.x + pl.w, y1: pl.y, y2: pl.y + pl.h });
      combinedH.push({ y: pl.y + pl.h, x1: pl.x, x2: pl.x + pl.w });
    }
  }

  const { mergedLength: vLen, count: vCount } = mergeAndMeasureVertical(combinedV);
  const { mergedLength: hLen, count: hCount } = mergeAndMeasureHorizontal(combinedH);
  result.stats.cuts = vCount + hCount;
  result.stats.cut_length_mm = vLen + hLen;

  // Convert edging by thickness map to array
  result.stats.edging_by_thickness = Array.from(edgingByThickness.entries())
    .map(([thickness_mm, length_mm]) => ({ thickness_mm, length_mm }))
    .sort((a, b) => a.thickness_mm - b.thickness_mm);

  if (expanded.length > 0) {
    result.unplaced = summarizeUnplacedParts(
      expanded,
      stock[0],
      allowRotation,
      remainingSheets <= 0 || opts.singleSheetOnly === true
    );
  }

  return result;
}

// ============================================================================
// Multi-Sort Optimized Packing
// ============================================================================

/**
 * Pack parts using multiple sort strategies and return the best result.
 *
 * This function tries 4 different sorting strategies:
 * - area: Largest area first (default, good for general use)
 * - length: Longest parts first (good for grain-constrained tall parts)
 * - width: Widest parts first (good for grain-constrained wide parts)
 * - perimeter: Largest perimeter first (balances tall and wide)
 *
 * The strategy that produces the fewest sheets wins.
 * In case of a tie, the one with highest yield (least waste) wins.
 *
 * For jobs with strict grain requirements, this can save 1+ sheets by finding
 * a better packing order.
 */
export function packPartsOptimized(
  parts: PartSpec[],
  stock: StockSheetSpec[],
  opts: PackOptions = {}
): LayoutResult & { strategyUsed: SortStrategy } {
  const strategies: SortStrategy[] = ['area', 'length', 'width', 'perimeter'];

  let bestResult: LayoutResult | null = null;
  let bestStrategy: SortStrategy = 'area';
  let bestSheetCount = Infinity;
  let bestYield = 0;

  for (const strategy of strategies) {
    const result = packPartsIntoSheets(parts, stock, { ...opts, sortStrategy: strategy });

    const sheetCount = result.sheets.length;
    const totalSheetArea = sheetCount * (stock[0]?.length_mm || 0) * (stock[0]?.width_mm || 0);
    const yieldPct = totalSheetArea > 0 ? result.stats.used_area_mm2 / totalSheetArea : 0;

    // Better if: fewer sheets, or same sheets with higher yield
    const isBetter =
      sheetCount < bestSheetCount ||
      (sheetCount === bestSheetCount && yieldPct > bestYield);

    if (isBetter) {
      bestResult = result;
      bestStrategy = strategy;
      bestSheetCount = sheetCount;
      bestYield = yieldPct;
    }
  }

  // Return best result (fallback to area strategy if something went wrong)
  if (!bestResult) {
    bestResult = packPartsIntoSheets(parts, stock, { ...opts, sortStrategy: 'area' });
  }

  return {
    ...bestResult,
    strategyUsed: bestStrategy,
  };
}

// ============================================================================
// Guillotine Optimized Packing (NEW - Waste-Consolidated)
// ============================================================================

import {
  packPartsGuillotine as packGuillotine,
  toLayoutResult as guillotineToLayout,
  type GuillotinePackResult,
  type PackingConfig,
} from '@/lib/cutlist/guillotinePacker';

/**
 * Algorithm choice for packing.
 * - 'strip': Cut-minimizing algorithm using vertical sections (best for guillotine cutting)
 * - 'guillotine': Waste-optimized guillotine packer
 * - 'legacy': Original greedy best-fit algorithm
 */
export type PackingAlgorithm = 'strip' | 'guillotine' | 'legacy';

/**
 * Extended pack options with algorithm choice.
 */
export interface ExtendedPackOptions extends PackOptions {
  /** Which packing algorithm to use. Default: 'strip' */
  algorithm?: PackingAlgorithm;
  /** Configuration for guillotine packer (only used if algorithm='guillotine') */
  packingConfig?: Partial<PackingConfig>;
}

/**
 * Pack parts using the best available algorithm.
 *
 * This is the recommended entry point for packing. It uses the strip
 * algorithm by default, which produces optimal layouts for guillotine cutting
 * (minimizes cuts and matches Cutlist Optimizer quality).
 *
 * @param parts - Parts to pack
 * @param stock - Available stock sheets
 * @param opts - Packing options including algorithm choice
 * @returns LayoutResult with best packing found
 */
export function packPartsSmartOptimized(
  parts: PartSpec[],
  stock: StockSheetSpec[],
  opts: ExtendedPackOptions = {}
): LayoutResult & { strategyUsed: string; algorithm: PackingAlgorithm } {
  const algorithm = opts.algorithm ?? 'strip';

  if (algorithm === 'strip') {
    // Use the new strip-based packer for optimal guillotine cutting
    const sheet = stock[0];
    if (!sheet) {
      return {
        sheets: [],
        stats: {
          used_area_mm2: 0,
          waste_area_mm2: 0,
          cuts: 0,
          cut_length_mm: 0,
          edgebanding_length_mm: 0,
        },
        strategyUsed: 'strip',
        algorithm: 'strip',
      };
    }
    const result = packWithStrips(parts, sheet);
    return {
      ...result,
      strategyUsed: 'vertical-first',
      algorithm: 'strip',
    };
  }

  if (algorithm === 'guillotine') {
    const result = packGuillotine(parts, stock, opts.packingConfig);
    return {
      ...guillotineToLayout(result),
      strategyUsed: result.strategyUsed,
      algorithm: 'guillotine',
    };
  }

  // Legacy algorithm
  const legacyResult = packPartsOptimized(parts, stock, opts);
  return {
    ...legacyResult,
    algorithm: 'legacy',
  };
}

// ============================================================================
// High-Level Packing with Lamination Expansion
// ============================================================================

/**
 * Pack parts with automatic lamination expansion.
 *
 * This function:
 * 1. Expands parts based on their lamination types
 * 2. Packs primary boards and backer boards separately
 * 3. Returns combined results with edging by thickness
 *
 * @param parts - Array of CutlistParts with lamination_type and optional lamination_config
 * @param primaryStock - Stock sheets for primary boards
 * @param backerStock - Stock sheets for backer boards (optional, defaults to primaryStock)
 * @param defaultMaterialId - Default material ID for parts without material_id
 * @param defaultBackerMaterialId - Default backer material ID
 * @param opts - Packing options
 */
export function packPartsWithLamination(
  parts: CutlistPart[],
  primaryStock: StockSheetSpec[],
  backerStock?: StockSheetSpec[],
  defaultMaterialId?: string,
  defaultBackerMaterialId?: string,
  opts: PackOptions = {}
): CombinedPackingResult {
  // Expand parts based on lamination types
  const expansion = expandPartsWithLamination(parts, defaultMaterialId, defaultBackerMaterialId);

  // Pack primary boards by material
  const primaryResults = new Map<string, LayoutResult>();
  let totalPrimarySheets = 0;

  for (const [materialId, expandedParts] of expansion.primaryPartsByMaterial) {
    const partSpecs = expandedPartsToPartSpecs(expandedParts);
    const result = packPartsIntoSheets(partSpecs, primaryStock, opts);
    primaryResults.set(materialId, result);
    totalPrimarySheets += result.sheets.length;
  }

  // Pack backer boards by material
  const backerResults = new Map<string, LayoutResult>();
  let totalBackerSheets = 0;
  const effectiveBackerStock = backerStock || primaryStock;

  for (const [materialId, expandedParts] of expansion.backerPartsByMaterial) {
    const partSpecs = expandedPartsToPartSpecs(expandedParts);
    const result = packPartsIntoSheets(partSpecs, effectiveBackerStock, opts);
    backerResults.set(materialId, result);
    totalBackerSheets += result.sheets.length;
  }

  // Convert edging map to array
  const edgingByThickness: EdgingRequirement[] = Array.from(expansion.edgingByThickness.entries())
    .map(([thickness_mm, length_mm]) => ({ thickness_mm, length_mm }))
    .sort((a, b) => a.thickness_mm - b.thickness_mm);

  // Calculate total edging
  const totalEdgingLength = edgingByThickness.reduce((sum, e) => sum + e.length_mm, 0);

  return {
    primaryResults,
    backerResults,
    edgingByThickness,
    summary: {
      totalPrimarySheets,
      totalBackerSheets,
      totalEdgingLength,
    },
  };
}

/**
 * Aggregate edging from multiple packing results.
 */
export function aggregateEdging(results: LayoutResult[]): EdgingRequirement[] {
  const byThickness = new Map<number, number>();

  for (const result of results) {
    if (result.stats.edging_by_thickness) {
      for (const req of result.stats.edging_by_thickness) {
        const current = byThickness.get(req.thickness_mm) || 0;
        byThickness.set(req.thickness_mm, current + req.length_mm);
      }
    } else {
      // Legacy: use 16mm and 32mm fields
      if (result.stats.edgebanding_16mm_mm) {
        const current16 = byThickness.get(16) || 0;
        byThickness.set(16, current16 + result.stats.edgebanding_16mm_mm);
      }
      if (result.stats.edgebanding_32mm_mm) {
        const current32 = byThickness.get(32) || 0;
        byThickness.set(32, current32 + result.stats.edgebanding_32mm_mm);
      }
    }
  }

  return Array.from(byThickness.entries())
    .map(([thickness_mm, length_mm]) => ({ thickness_mm, length_mm }))
    .sort((a, b) => a.thickness_mm - b.thickness_mm);
}

// ============================================================================
// Internal Helper Functions
// ============================================================================

function totalQty(stock: StockSheetSpec[]): number {
  return stock.reduce((s, it) => s + Math.max(0, it.qty | 0), 0);
}

function tryPlace(
  part: PartSpec,
  free: FreeRect[],
  allowRotation: boolean,
  kerf: number,
  placements: Placement[],
  vSegments: VerticalSegment[],
  hSegments: HorizontalSegment[],
  minDim: number
): Placement | null {
  // Composite scoring: leftover area + sliver penalty + aspect ratio penalty
  let bestIdx = -1;
  let best: Placement | null = null;
  let bestScore = Infinity;
  let bestTie: { y: number; x: number; rot: 0 | 90 } | null = null;

  for (let i = 0; i < free.length; i++) {
    const fr = free[i];
    const partGrain: GrainOrientation = (part.grain ??
      (part.require_grain ? 'length' : 'any')) as GrainOrientation;
    const candidates: Array<{ w: number; h: number; rot: 0 | 90 }> = [];

    // 0° candidate: length along sheet length (Y)
    if (partGrain === 'any' || partGrain === 'length') {
      candidates.push({ w: part.width_mm, h: part.length_mm, rot: 0 });
    }

    // 90° candidate requires global rotation and either 'any' or explicit 'width'
    if (allowRotation && (partGrain === 'any' || partGrain === 'width')) {
      candidates.push({ w: part.length_mm, h: part.width_mm, rot: 90 });
    }

    for (const c of candidates) {
      const w = c.w;
      const h = c.h;
      if (w <= fr.w && h <= fr.h) {
        // Simulate split
        const rightW = Math.max(0, fr.w - w - kerf);
        const rightH = h;
        const bottomW = fr.w;
        const bottomH = Math.max(0, fr.h - h - kerf);
        const leftoverArea = fr.w * fr.h - w * h;

        // Penalties
        let sliverPenalty = 0;
        if (rightW > 0 && rightH > 0 && (rightW < minDim || rightH < minDim)) sliverPenalty += 1;
        if (bottomW > 0 && bottomH > 0 && (bottomW < minDim || bottomH < minDim)) sliverPenalty += 1;
        const aspect = Math.max(w / h, h / w);
        const aspectPenalty = (aspect - 1) * w * h * 0.01; // scaled by area

        const score = leftoverArea + sliverPenalty * 1_000_000 + aspectPenalty;
        const tie = { y: fr.y, x: fr.x, rot: c.rot };

        if (score < bestScore || (Math.abs(score - bestScore) < 1e-6 && tieBreak(tie, bestTie))) {
          bestScore = score;
          bestIdx = i;
          best = { part_id: part.id, label: part.label, x: fr.x, y: fr.y, w, h, rot: c.rot };
          bestTie = tie;
        }
      }
    }
  }

  if (best && bestIdx >= 0) {
    // Split the free rect guillotine-style into up to 2 rects (right and bottom)
    const used = free[bestIdx];
    const right: FreeRect = {
      x: used.x + best.w + kerf,
      y: used.y,
      w: Math.max(0, used.w - best.w - kerf),
      h: best.h,
    };
    const bottom: FreeRect = {
      x: used.x,
      y: used.y + best.h + kerf,
      w: used.w,
      h: Math.max(0, used.h - best.h - kerf),
    };

    const remainder: FreeRect[] = [];
    if (right.w > 0 && right.h > 0) remainder.push(right);
    if (bottom.w > 0 && bottom.h > 0) remainder.push(bottom);
    free.splice(bestIdx, 1, ...remainder);

    // Prune and merge free list to reduce fragmentation
    pruneFreeListInPlace(free, minDim);
    mergeAdjacentFreeRectsInPlace(free);

    // Track cut segments (right edge and bottom edge of placement)
    vSegments.push({ x: best.x + best.w, y1: best.y, y2: best.y + best.h });
    hSegments.push({ y: best.y + best.h, x1: best.x, x2: best.x + best.w });
  }

  return best;
}

function tieBreak(
  a: { y: number; x: number; rot: 0 | 90 } | null,
  b: { y: number; x: number; rot: 0 | 90 } | null
): boolean {
  if (!b) return true;
  if (!a) return false;
  if (a.y !== b.y) return a.y < b.y;
  if (a.x !== b.x) return a.x < b.x;
  return a.rot === 0 && b.rot === 90;
}

function pruneFreeListInPlace(free: FreeRect[], minDim: number): void {
  // Remove contained rectangles and tiny scraps
  for (let i = free.length - 1; i >= 0; i--) {
    const a = free[i];
    if (a.w < minDim || a.h < minDim) {
      free.splice(i, 1);
      continue;
    }
    for (let j = 0; j < free.length; j++) {
      if (i === j) continue;
      const b = free[j];
      if (a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h) {
        free.splice(i, 1);
        break;
      }
    }
  }
}

function mergeAdjacentFreeRectsInPlace(free: FreeRect[]): void {
  // Merge orthogonally adjacent rectangles that share a full edge and have equal opposite dimension
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < free.length; i++) {
      for (let j = i + 1; j < free.length; j++) {
        const a = free[i];
        const b = free[j];
        // Horizontal merge (same y and height, adjacent in x)
        if (a.y === b.y && a.h === b.h) {
          if (a.x + a.w === b.x) {
            free[i] = { x: a.x, y: a.y, w: a.w + b.w, h: a.h };
            free.splice(j, 1);
            merged = true;
            break outer;
          } else if (b.x + b.w === a.x) {
            free[i] = { x: b.x, y: a.y, w: a.w + b.w, h: a.h };
            free.splice(j, 1);
            merged = true;
            break outer;
          }
        }
        // Vertical merge (same x and width, adjacent in y)
        if (a.x === b.x && a.w === b.w) {
          if (a.y + a.h === b.y) {
            free[i] = { x: a.x, y: a.y, w: a.w, h: a.h + b.h };
            free.splice(j, 1);
            merged = true;
            break outer;
          } else if (b.y + b.h === a.y) {
            free[i] = { x: a.x, y: b.y, w: a.w, h: a.h + b.h };
            free.splice(j, 1);
            merged = true;
            break outer;
          }
        }
      }
    }
  }
}

function mergeAndMeasureVertical(segments: VerticalSegment[]): { mergedLength: number; count: number } {
  // Group by x, merge overlapping intervals on y
  const byX = new Map<number, Array<{ y1: number; y2: number }>>();
  for (const s of segments) {
    if (s.y2 <= s.y1) continue;
    const arr = byX.get(s.x) || [];
    arr.push({ y1: s.y1, y2: s.y2 });
    byX.set(s.x, arr);
  }

  let length = 0;
  let count = 0;
  for (const [, arr] of byX) {
    arr.sort((a, b) => a.y1 - b.y1 || a.y2 - b.y2);
    let cur: { y1: number; y2: number } | null = null;
    for (const seg of arr) {
      if (!cur) {
        cur = { ...seg };
        continue;
      }
      if (seg.y1 <= cur.y2) {
        cur.y2 = Math.max(cur.y2, seg.y2);
      } else {
        length += cur.y2 - cur.y1;
        count++;
        cur = { ...seg };
      }
    }
    if (cur) {
      length += cur.y2 - cur.y1;
      count++;
    }
  }

  return { mergedLength: length, count };
}

function mergeAndMeasureHorizontal(segments: HorizontalSegment[]): { mergedLength: number; count: number } {
  // Group by y, merge overlapping intervals on x
  const byY = new Map<number, Array<{ x1: number; x2: number }>>();
  for (const s of segments) {
    if (s.x2 <= s.x1) continue;
    const arr = byY.get(s.y) || [];
    arr.push({ x1: s.x1, x2: s.x2 });
    byY.set(s.y, arr);
  }

  let length = 0;
  let count = 0;
  for (const [, arr] of byY) {
    arr.sort((a, b) => a.x1 - b.x1 || a.x2 - b.x2);
    let cur: { x1: number; x2: number } | null = null;
    for (const seg of arr) {
      if (!cur) {
        cur = { ...seg };
        continue;
      }
      if (seg.x1 <= cur.x2) {
        cur.x2 = Math.max(cur.x2, seg.x2);
      } else {
        length += cur.x2 - cur.x1;
        count++;
        cur = { ...seg };
      }
    }
    if (cur) {
      length += cur.x2 - cur.x1;
      count++;
    }
  }

  return { mergedLength: length, count };
}

function summarizeUnplacedParts(
  parts: Array<PartSpec & { uid: string }>,
  sheet: StockSheetSpec | undefined,
  allowRotation: boolean,
  noAdditionalSheetsAvailable: boolean
): UnplacedPart[] {
  if (parts.length === 0) return [];

  const summary = new Map<string, UnplacedPart>();
  for (const item of parts) {
    const { uid, ...rest } = item as PartSpec & { uid: string };
    const fits = sheet ? canFitOnEmptySheet(rest, sheet, allowRotation) : false;

    let reason: UnplacedReason;
    if (!sheet) {
      reason = 'insufficient_sheet_capacity';
    } else if (fits) {
      reason = noAdditionalSheetsAvailable ? 'insufficient_sheet_capacity' : 'insufficient_sheet_capacity';
    } else {
      reason = 'too_large_for_sheet';
    }

    const existing = summary.get(rest.id);
    if (existing) {
      existing.count += 1;
      if (reason === 'too_large_for_sheet') existing.reason = 'too_large_for_sheet';
    } else {
      summary.set(rest.id, { part: { ...rest, qty: 0 }, count: 1, reason });
    }
  }

  for (const entry of summary.values()) {
    entry.part = { ...entry.part, qty: entry.count };
  }

  return Array.from(summary.values());
}

function canFitOnEmptySheet(part: PartSpec, sheet: StockSheetSpec, allowRotation: boolean): boolean {
  const partGrain: GrainOrientation = (part.grain ??
    (part.require_grain ? 'length' : 'any')) as GrainOrientation;

  if (partGrain === 'any' || partGrain === 'length') {
    if (part.width_mm <= sheet.width_mm && part.length_mm <= sheet.length_mm) {
      return true;
    }
  }

  if (allowRotation && (partGrain === 'any' || partGrain === 'width')) {
    if (part.length_mm <= sheet.width_mm && part.width_mm <= sheet.length_mm) {
      return true;
    }
  }

  return false;
}
