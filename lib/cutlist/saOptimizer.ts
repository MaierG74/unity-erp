/**
 * Simulated Annealing Optimizer for 2D Bin Packing
 *
 * A commercial-grade iterative optimization engine that progressively
 * improves sheet layouts by making small, targeted mutations to the
 * part placement order and accepting/rejecting changes based on a
 * temperature-controlled probability function.
 *
 * Key design choices:
 * - Solution = permutation of ExpandedPartInstance[] (order fed to greedy packer)
 * - 5 neighborhood move types weighted by effectiveness
 * - Geometric cooling with reheat on stagnation
 * - Scoring heavily weighted toward offcut quality (user's #1 priority)
 * - Pure computation, no DOM dependencies (runs in Web Worker)
 */

import type { PartSpec, StockSheetSpec } from './types';
import {
  expandParts,
  packWithExpandedParts,
  packPartsGuillotine,
  sortByStrategy,
  type ExpandedPartInstance,
  type GuillotinePackResult,
  type PackingConfig,
  DEFAULT_PACKING_CONFIG,
} from './guillotinePacker';

// =============================================================================
// Types
// =============================================================================

export interface SAConfig {
  /** Starting temperature. Default: 500 */
  tStart: number;
  /** Minimum temperature. Default: 0.1 */
  tEnd: number;
  /** Cooling rate per iteration (geometric). Default: 0.9997 */
  coolingRate: number;
  /** Fraction of estimated iterations with no improvement before reheating. Default: 0.1 */
  reheatThreshold: number;
  /** Reheat temperature as fraction of tStart. Default: 0.3 */
  reheatFraction: number;
  /** How often to fire progress callback (ms). Default: 500 */
  progressIntervalMs: number;
}

export const DEFAULT_SA_CONFIG: SAConfig = {
  tStart: 500,
  tEnd: 0.1,
  coolingRate: 0.9997,
  reheatThreshold: 0.1,
  reheatFraction: 0.3,
  progressIntervalMs: 500,
};

export interface SAProgress {
  iteration: number;
  bestScore: number;
  bestResult: GuillotinePackResult;
  elapsed: number;
  temperature: number;
  improvementCount: number;
  baselineScore: number;
}

// =============================================================================
// Improved Scoring Function (V2)
// =============================================================================

/**
 * Calculate a score for a packing result with heavy offcut quality weighting.
 *
 * Score hierarchy:
 *   Tier 1: Sheet count (-100,000 per sheet) — unambiguous, dominates
 *   Tier 2: Offcut quality (×500) — user's #1 priority
 *   Tier 3: Waste concentration (×300) — consolidated waste
 *   Tier 4: Compactness (×50) — prefer parts packed in corner, not spread out
 *   Tier 5: Utilization (×1) — implied by sheet count
 *   Tier 6: Fragmentation penalty (×20) — fewer fragments better
 *
 * Higher score = better result.
 */
export function calculateResultScoreV2(
  result: GuillotinePackResult,
  sheetArea: number
): number {
  const totalSheetArea = result.sheets.length * sheetArea;
  const usedArea = result.stats.used_area_mm2;

  // Utilization percentage (0-100)
  const utilizationPct = totalSheetArea > 0 ? (usedArea / totalSheetArea) * 100 : 0;

  // Offcut quality: largest single offcut as % of one sheet
  const offcutQualityPct = sheetArea > 0 ? (result.largestOffcutArea / sheetArea) * 100 : 0;

  // Concentration: 1.0 = all waste in one piece (ideal)
  const concentration = result.offcutConcentration * 100;

  // Fragment count
  const fragments = result.fragmentCount;

  // Compactness: bounding box of all placements as fraction of sheet area.
  // Lower = parts packed into a corner, higher = spread across sheet.
  // On single-sheet jobs where sheet count is equal, this becomes the
  // key differentiator between compact (operator-friendly) and spread layouts.
  let compactnessPenalty = 0;
  for (const sheet of result.sheets) {
    let maxX = 0;
    let maxY = 0;
    for (const p of sheet.placements) {
      maxX = Math.max(maxX, p.x + p.w);
      maxY = Math.max(maxY, p.y + p.h);
    }
    // Bounding box area as % of sheet area (0-100)
    const bbAreaPct = sheetArea > 0 ? ((maxX * maxY) / sheetArea) * 100 : 0;
    compactnessPenalty += bbAreaPct;
  }
  // Average across sheets
  if (result.sheets.length > 0) {
    compactnessPenalty /= result.sheets.length;
  }

  return (
    -result.sheets.length * 100_000 +   // Tier 1: fewer sheets
    offcutQualityPct * 500 +             // Tier 2: largest offcut (heavy weight)
    concentration * 300 +                 // Tier 3: consolidated waste
    -compactnessPenalty * 50 +            // Tier 4: compactness (prefer corner packing)
    utilizationPct * 1 -                  // Tier 5: efficiency (weak)
    fragments * 20                        // Tier 6: fragmentation penalty
  );
}

// =============================================================================
// Neighborhood Move Generators
// =============================================================================

/**
 * Swap two random parts in the sequence.
 * Weight: 35% — simplest, most common move
 */
function moveSwap(parts: ExpandedPartInstance[]): void {
  const n = parts.length;
  if (n < 2) return;
  const i = Math.floor(Math.random() * n);
  let j = Math.floor(Math.random() * (n - 1));
  if (j >= i) j++;
  [parts[i], parts[j]] = [parts[j], parts[i]];
}

/**
 * Undo a swap move (same operation).
 */
function undoSwap(parts: ExpandedPartInstance[], i: number, j: number): void {
  [parts[i], parts[j]] = [parts[j], parts[i]];
}

/**
 * Remove a part and re-insert at a random position.
 * Weight: 25% — larger disruption than swap
 */
function moveInsert(parts: ExpandedPartInstance[]): { from: number; to: number } {
  const n = parts.length;
  if (n < 2) return { from: 0, to: 0 };
  const from = Math.floor(Math.random() * n);
  const [removed] = parts.splice(from, 1);
  const to = Math.floor(Math.random() * n); // n-1 items now, insert at [0..n-1]
  parts.splice(to, 0, removed);
  return { from, to };
}

/**
 * Reverse a contiguous subsequence of 2-8 parts.
 * Weight: 15% — explores different local orderings
 */
function moveReverse(parts: ExpandedPartInstance[]): { start: number; end: number } {
  const n = parts.length;
  if (n < 2) return { start: 0, end: 0 };
  const segLen = 2 + Math.floor(Math.random() * Math.min(7, n - 1));
  const start = Math.floor(Math.random() * Math.max(1, n - segLen + 1));
  const end = Math.min(start + segLen, n);
  // Reverse in-place
  let lo = start;
  let hi = end - 1;
  while (lo < hi) {
    [parts[lo], parts[hi]] = [parts[hi], parts[lo]];
    lo++;
    hi--;
  }
  return { start, end };
}

/**
 * Swap two contiguous blocks of 2-4 parts.
 * Weight: 15% — larger structural change
 */
function moveBlockSwap(parts: ExpandedPartInstance[]): void {
  const n = parts.length;
  if (n < 4) {
    moveSwap(parts);
    return;
  }
  const blockSize = 2 + Math.floor(Math.random() * Math.min(3, Math.floor(n / 2) - 1));
  const maxStart = n - blockSize * 2;
  if (maxStart < 0) {
    moveSwap(parts);
    return;
  }
  const start1 = Math.floor(Math.random() * (maxStart + 1));
  const start2 = start1 + blockSize;
  // Swap block elements
  for (let k = 0; k < blockSize; k++) {
    [parts[start1 + k], parts[start2 + k]] = [parts[start2 + k], parts[start1 + k]];
  }
}

/**
 * Move a grain-constrained part earlier in the sequence.
 * Weight: 10% — constrained parts benefit from placement priority
 */
function movePromoteConstrained(parts: ExpandedPartInstance[]): { from: number; to: number } {
  const n = parts.length;
  // Find constrained parts not already at the front
  const constrainedIndices: number[] = [];
  for (let i = 1; i < n; i++) {
    const grain = parts[i].grain ?? 'any';
    if (grain !== 'any') {
      constrainedIndices.push(i);
    }
  }
  if (constrainedIndices.length === 0) {
    // Fall back to insert
    return moveInsert(parts);
  }
  const from = constrainedIndices[Math.floor(Math.random() * constrainedIndices.length)];
  const to = Math.floor(Math.random() * from); // move earlier
  const [removed] = parts.splice(from, 1);
  parts.splice(to, 0, removed);
  return { from, to };
}

/**
 * Apply a weighted random move. Returns a function to undo it.
 * Move weights: swap(35%), insert(25%), reverse(15%), blockSwap(15%), promote(10%)
 */
function applyRandomMove(parts: ExpandedPartInstance[]): () => void {
  const roll = Math.random();

  if (roll < 0.35) {
    // Swap
    const n = parts.length;
    const i = Math.floor(Math.random() * n);
    let j = Math.floor(Math.random() * (n - 1));
    if (j >= i) j++;
    [parts[i], parts[j]] = [parts[j], parts[i]];
    return () => undoSwap(parts, i, j);
  }

  if (roll < 0.60) {
    // Insert
    const { from, to } = moveInsert(parts);
    return () => {
      const [removed] = parts.splice(to, 1);
      parts.splice(from, 0, removed);
    };
  }

  if (roll < 0.75) {
    // Reverse segment
    const { start, end } = moveReverse(parts);
    return () => {
      let lo = start;
      let hi = end - 1;
      while (lo < hi) {
        [parts[lo], parts[hi]] = [parts[hi], parts[lo]];
        lo++;
        hi--;
      }
    };
  }

  if (roll < 0.90) {
    // Block swap (not easily undoable, just clone if needed)
    const snapshot = [...parts];
    moveBlockSwap(parts);
    return () => {
      for (let i = 0; i < parts.length; i++) {
        parts[i] = snapshot[i];
      }
    };
  }

  // Promote constrained
  const snapshot = [...parts];
  movePromoteConstrained(parts);
  return () => {
    for (let i = 0; i < parts.length; i++) {
      parts[i] = snapshot[i];
    }
  };
}

// =============================================================================
// Main SA Loop
// =============================================================================

/**
 * Run simulated annealing optimization on a cutlist packing problem.
 *
 * @param parts - Original part specs (will be expanded internally)
 * @param stock - Stock sheet specification (single sheet size)
 * @param timeBudgetMs - Maximum time to run in milliseconds
 * @param config - SA configuration overrides
 * @param packingConfig - Guillotine packer configuration overrides
 * @param onProgress - Callback fired every ~500ms with current best result
 * @param shouldCancel - Function returning true to abort early
 * @returns Best GuillotinePackResult found
 */
export function runSimulatedAnnealing(
  parts: PartSpec[],
  stock: StockSheetSpec,
  timeBudgetMs: number = 30_000,
  config: Partial<SAConfig> = {},
  packingConfig: Partial<PackingConfig> = {},
  onProgress?: (progress: SAProgress) => void,
  shouldCancel?: () => boolean
): GuillotinePackResult {
  const cfg = { ...DEFAULT_SA_CONFIG, ...config };
  const startTime = performance.now();
  const sheetArea = stock.width_mm * stock.length_mm;

  // Phase 0: Get baseline from heuristic multi-pass
  const baseline = packPartsGuillotine(parts, [stock], packingConfig);
  let bestResult = baseline;
  let bestScore = calculateResultScoreV2(baseline, sheetArea);
  const baselineScore = bestScore;

  // Expand parts once for reuse
  const expanded = expandParts(parts);
  if (expanded.length < 2) {
    return bestResult;
  }

  // Initialize current solution as best heuristic ordering
  // Use the area-sorted ordering as starting point
  const currentParts = sortByStrategy(expanded, 'area');
  let currentScore = bestScore;

  // Temperature schedule
  let temperature = cfg.tStart;
  let iteration = 0;
  let improvementCount = 0;
  let itersSinceImprovement = 0;
  let lastProgressTime = startTime;

  // Dynamic calibration: after 100 iterations, adjust cooling rate
  // to match the time budget
  let calibrated = false;

  while (true) {
    const now = performance.now();
    const elapsed = now - startTime;

    // Check time budget
    if (elapsed >= timeBudgetMs) break;

    // Check cancellation
    if (shouldCancel?.()) break;

    // Check temperature floor
    if (temperature < cfg.tEnd) {
      // Reheat if we haven't exhausted time
      if (elapsed < timeBudgetMs * 0.9) {
        temperature = cfg.tStart * cfg.reheatFraction;
      } else {
        break;
      }
    }

    iteration++;

    // Dynamic calibration after 100 iterations
    if (!calibrated && iteration === 100) {
      calibrated = true;
      const iterTime = elapsed / 100; // ms per iteration
      const remainingMs = timeBudgetMs - elapsed;
      const estimatedTotalIters = Math.floor(remainingMs / iterTime) + 100;
      // Adjust cooling rate to reach tEnd by estimated total iterations
      const targetRate = Math.pow(cfg.tEnd / cfg.tStart, 1 / estimatedTotalIters);
      cfg.coolingRate = Math.max(0.99, Math.min(0.99999, targetRate));
    }

    // Apply a random neighborhood move
    const undo = applyRandomMove(currentParts);

    // Evaluate the new solution
    const candidateResult = packWithExpandedParts(
      currentParts,
      stock,
      `sa-iter-${iteration}`,
      parts,
      packingConfig
    );
    const candidateScore = calculateResultScoreV2(candidateResult, sheetArea);

    // SA acceptance criterion
    const delta = candidateScore - currentScore;
    const accept =
      delta > 0 || Math.random() < Math.exp(delta / temperature);

    if (accept) {
      currentScore = candidateScore;

      // Track global best
      if (candidateScore > bestScore) {
        bestScore = candidateScore;
        bestResult = candidateResult;
        improvementCount++;
        itersSinceImprovement = 0;
      } else {
        itersSinceImprovement++;
      }
    } else {
      // Reject: undo the move
      undo();
      itersSinceImprovement++;
    }

    // Cool down
    temperature *= cfg.coolingRate;

    // Reheat on stagnation
    const estimatedItersPerSecond = iteration / (elapsed / 1000);
    const estimatedTotalIters = estimatedItersPerSecond * (timeBudgetMs / 1000);
    if (itersSinceImprovement > estimatedTotalIters * cfg.reheatThreshold) {
      temperature = cfg.tStart * cfg.reheatFraction;
      itersSinceImprovement = 0;
    }

    // Progress callback
    if (onProgress && now - lastProgressTime >= cfg.progressIntervalMs) {
      lastProgressTime = now;
      onProgress({
        iteration,
        bestScore,
        bestResult,
        elapsed,
        temperature,
        improvementCount,
        baselineScore,
      });
    }
  }

  // Final progress callback
  onProgress?.({
    iteration,
    bestScore,
    bestResult,
    elapsed: performance.now() - startTime,
    temperature,
    improvementCount,
    baselineScore,
  });

  return {
    ...bestResult,
    strategyUsed: `sa-optimized (${iteration} iters, ${improvementCount} improvements)`,
  };
}
