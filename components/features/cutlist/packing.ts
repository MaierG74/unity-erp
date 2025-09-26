// Basic types and a first-pass heuristic packer for sheet nesting.

export type GrainOrientation = 'any' | 'length' | 'width';

export interface PartSpec {
  id: string;
  length_mm: number; // Y dimension
  width_mm: number;  // X dimension
  qty: number;
  laminate?: boolean; // if true, indicates backer lamination for costing/export UX
  /**
   * Preferred grain orientation.
   * - 'any': can rotate 0° or 90° (subject to global rotation option)
   * - 'length': keep part length aligned with sheet length (0° only)
   * - 'width': keep part length aligned with sheet width (90° only; requires global rotation enabled)
   * Back-compat: if `require_grain` is true and `grain` is undefined, treat as 'length'.
   */
  grain?: GrainOrientation;
  // Back-compat with older UI; if true, equivalent to grain==='length'
  require_grain?: boolean; // if true, rotation 90° is not allowed
  band_edges?: { top?: boolean; right?: boolean; bottom?: boolean; left?: boolean };
}

export interface StockSheetSpec {
  id: string;
  length_mm: number; // Y
  width_mm: number;  // X
  qty: number;
  kerf_mm?: number;  // defaults to 0
}

export interface Placement {
  part_id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: 0 | 90;
}

export interface SheetLayout {
  sheet_id: string;
  placements: Placement[];
  used_area_mm2?: number;
}

export interface LayoutStats {
  used_area_mm2: number;
  waste_area_mm2: number;
  cuts: number;
  cut_length_mm: number;
  edgebanding_length_mm?: number; // total, back-compat
  edgebanding_16mm_mm?: number;
  edgebanding_32mm_mm?: number;
}

export type UnplacedReason = 'too_large_for_sheet' | 'insufficient_sheet_capacity';

export interface UnplacedPart {
  part: PartSpec;
  count: number;
  reason: UnplacedReason;
}

export interface LayoutResult {
  sheets: SheetLayout[];
  stats: LayoutStats;
  unplaced?: UnplacedPart[];
}

export interface PackOptions {
  singleSheetOnly?: boolean;
  allowRotation?: boolean; // default true
}

interface FreeRect { x: number; y: number; w: number; h: number }

interface VerticalSegment { x: number; y1: number; y2: number }
interface HorizontalSegment { y: number; x1: number; x2: number }

/**
 * Greedy best-fit into free rectangles. Creates new sheet when needed (unless singleSheetOnly).
 * Not optimal; intended as fast MVP.
 */
export function packPartsIntoSheets(parts: PartSpec[], stock: StockSheetSpec[], opts: PackOptions = {}): LayoutResult {
  const allowRotation = opts.allowRotation !== false;
  const kerf = Math.max(0, stock[0]?.kerf_mm || 0);
  // Thresholds for pruning tiny scraps and avoiding slivers
  const MIN_DIMENSION_MM = Math.max(kerf, 10);

  // Expand parts list by quantity
  const expanded: Array<PartSpec & { uid: string }> = [];
  for (const p of parts) {
    const count = Math.max(1, Math.floor(p.qty));
    for (let i = 0; i < count; i++) expanded.push({ ...p, uid: `${p.id}#${i+1}` });
  }
  // Sort by area desc then max edge desc
  expanded.sort((a, b) => {
    const areaA = a.length_mm * a.width_mm;
    const areaB = b.length_mm * b.width_mm;
    if (areaA !== areaB) return areaB - areaA;
    const edgeCmp = Math.max(b.length_mm, b.width_mm) - Math.max(a.length_mm, a.width_mm);
    if (edgeCmp !== 0) return edgeCmp;
    // Deterministic tie-breaker
    return a.id.localeCompare(b.id);
  });

  const result: LayoutResult = { sheets: [], stats: { used_area_mm2: 0, waste_area_mm2: 0, cuts: 0, cut_length_mm: 0, edgebanding_length_mm: 0, edgebanding_16mm_mm: 0, edgebanding_32mm_mm: 0 } };

  let sheetIdx = 0; let remainingSheets = totalQty(stock);
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
      const placed = tryPlace(part, free, allowRotation, kerf, placements, vSegments, hSegments, MIN_DIMENSION_MM);
      if (placed) {
        placements.push(placed);
        // Edge banding length accounting (map edges if rotated)
        if (part.band_edges) {
          const be = part.band_edges;
          let pieceBand = 0;
          if (placed.rot === 0) {
            pieceBand = (be.top ? placed.w : 0) + (be.right ? placed.h : 0) + (be.bottom ? placed.w : 0) + (be.left ? placed.h : 0);
          } else {
            // rot 90°: top->left, right->top, bottom->right, left->bottom
            pieceBand = (be.left ? placed.w : 0) + (be.top ? placed.h : 0) + (be.right ? placed.w : 0) + (be.bottom ? placed.h : 0);
          }
          result.stats.edgebanding_length_mm! += pieceBand;
          if (part.laminate) {
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

    result.sheets.push({ sheet_id: `${sheet.id}:${sheetIdx+1}`, placements, used_area_mm2: sheetUsedArea });
    sheetIdx++; remainingSheets--;
    if (opts.singleSheetOnly) break;
  }

  // Stats (with cut-segment accounting)
  const sheetArea = (stock[0]?.length_mm || 0) * (stock[0]?.width_mm || 0);
  let used = 0; let cuts = 0; let cutLen = 0;
  for (const s of result.sheets) {
    const sheetUsed = typeof s.used_area_mm2 === 'number' ? s.used_area_mm2 : s.placements.reduce((sum, pl) => sum + pl.w * pl.h, 0);
    if (typeof s.used_area_mm2 !== 'number') s.used_area_mm2 = sheetUsed;
    used += sheetUsed;
  }
  const totalSheetArea = sheetArea * result.sheets.length;
  result.stats.used_area_mm2 = used;
  result.stats.waste_area_mm2 = Math.max(0, totalSheetArea - used);
  // Note: cut segments were collected per sheet; recompute deterministically by simulating segments from placements
  // to keep the function pure on external state.
  const combinedV: VerticalSegment[] = [];
  const combinedH: HorizontalSegment[] = [];
  // Recreate segments to avoid storing internal arrays in the result schema
  for (const s of result.sheets) {
    for (const pl of s.placements) {
      combinedV.push({ x: pl.x + pl.w, y1: pl.y, y2: pl.y + pl.h });
      combinedH.push({ y: pl.y + pl.h, x1: pl.x, x2: pl.x + pl.w });
    }
  }
  const { mergedLength: vLen, count: vCount } = mergeAndMeasureVertical(combinedV);
  const { mergedLength: hLen, count: hCount } = mergeAndMeasureHorizontal(combinedH);
  cutLen = vLen + hLen;
  cuts = vCount + hCount;
  result.stats.cuts = cuts;
  result.stats.cut_length_mm = cutLen;
  if (expanded.length > 0) {
    result.unplaced = summarizeUnplacedParts(expanded, stock[0], allowRotation, remainingSheets <= 0 || opts.singleSheetOnly === true);
  }
  return result;
}

function totalQty(stock: StockSheetSpec[]): number { return stock.reduce((s, it) => s + Math.max(0, it.qty|0), 0); }

function tryPlace(part: PartSpec, free: FreeRect[], allowRotation: boolean, kerf: number, placements: Placement[], vSegments: VerticalSegment[], hSegments: HorizontalSegment[], minDim: number): Placement | null {
  // Composite scoring: leftover area + sliver penalty + aspect ratio penalty
  let bestIdx = -1; let best: Placement | null = null; let bestScore = Infinity; let bestTie: { y: number; x: number; rot: 0|90 } | null = null;
  for (let i = 0; i < free.length; i++) {
    const fr = free[i];
    const partGrain: GrainOrientation = (part.grain ?? (part.require_grain ? 'length' : 'any')) as GrainOrientation;
    const candidates: Array<{w: number; h: number; rot: 0|90}> = [];
    // 0° candidate: length along sheet length (Y)
    if (partGrain === 'any' || partGrain === 'length') {
      candidates.push({ w: part.width_mm, h: part.length_mm, rot: 0 });
    }
    // 90° candidate requires global rotation and either 'any' or explicit 'width'
    if (allowRotation && (partGrain === 'any' || partGrain === 'width')) {
      candidates.push({ w: part.length_mm, h: part.width_mm, rot: 90 });
    }
    for (const c of candidates) {
      const w = c.w; const h = c.h;
      if (w <= fr.w && h <= fr.h) {
        // Simulate split
        const rightW = Math.max(0, fr.w - w - kerf);
        const rightH = h;
        const bottomW = fr.w;
        const bottomH = Math.max(0, fr.h - h - kerf);
        const leftoverArea = (fr.w * fr.h) - (w * h);
        // Penalties
        let sliverPenalty = 0;
        if ((rightW > 0 && rightH > 0 && (rightW < minDim || rightH < minDim))) sliverPenalty += 1;
        if ((bottomW > 0 && bottomH > 0 && (bottomW < minDim || bottomH < minDim))) sliverPenalty += 1;
        const aspect = Math.max(w / h, h / w);
        const aspectPenalty = (aspect - 1) * w * h * 0.01; // scaled by area
        const score = leftoverArea + sliverPenalty * 1_000_000 + aspectPenalty;
        const tie = { y: fr.y, x: fr.x, rot: c.rot };
        if (score < bestScore || (Math.abs(score - bestScore) < 1e-6 && tieBreak(tie, bestTie))) {
          bestScore = score;
          bestIdx = i;
          best = { part_id: part.id, x: fr.x, y: fr.y, w, h, rot: c.rot };
          bestTie = tie;
        }
      }
    }
  }
  if (best && bestIdx >= 0) {
    // Split the free rect guillotine-style into up to 2 rects (right and bottom) and remove used one
    const used = free[bestIdx];
    const right: FreeRect = { x: used.x + best.w + kerf, y: used.y, w: Math.max(0, used.w - best.w - kerf), h: best.h };
    const bottom: FreeRect = { x: used.x, y: used.y + best.h + kerf, w: used.w, h: Math.max(0, used.h - best.h - kerf) };
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

function tieBreak(a: { y: number; x: number; rot: 0|90 } | null, b: { y: number; x: number; rot: 0|90 } | null): boolean {
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
    if (a.w < minDim || a.h < minDim) { free.splice(i, 1); continue; }
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
            free.splice(j, 1); merged = true; break outer;
          } else if (b.x + b.w === a.x) {
            free[i] = { x: b.x, y: a.y, w: a.w + b.w, h: a.h };
            free.splice(j, 1); merged = true; break outer;
          }
        }
        // Vertical merge (same x and width, adjacent in y)
        if (a.x === b.x && a.w === b.w) {
          if (a.y + a.h === b.y) {
            free[i] = { x: a.x, y: a.y, w: a.w, h: a.h + b.h };
            free.splice(j, 1); merged = true; break outer;
          } else if (b.y + b.h === a.y) {
            free[i] = { x: a.x, y: b.y, w: a.w, h: a.h + b.h };
            free.splice(j, 1); merged = true; break outer;
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
  let length = 0; let count = 0;
  for (const [, arr] of byX) {
    arr.sort((a, b) => a.y1 - b.y1 || a.y2 - b.y2);
    let cur: { y1: number; y2: number } | null = null;
    for (const seg of arr) {
      if (!cur) { cur = { ...seg }; continue; }
      if (seg.y1 <= cur.y2) {
        cur.y2 = Math.max(cur.y2, seg.y2);
      } else {
        length += cur.y2 - cur.y1; count++;
        cur = { ...seg };
      }
    }
    if (cur) { length += cur.y2 - cur.y1; count++; }
  }
  return { mergedLength: length, count };
}

function summarizeUnplacedParts(parts: Array<PartSpec & { uid: string }>, sheet: StockSheetSpec | undefined, allowRotation: boolean, noAdditionalSheetsAvailable: boolean): UnplacedPart[] {
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
  const partGrain: GrainOrientation = (part.grain ?? (part.require_grain ? 'length' : 'any')) as GrainOrientation;
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

function mergeAndMeasureHorizontal(segments: HorizontalSegment[]): { mergedLength: number; count: number } {
  // Group by y, merge overlapping intervals on x
  const byY = new Map<number, Array<{ x1: number; x2: number }>>();
  for (const s of segments) {
    if (s.x2 <= s.x1) continue;
    const arr = byY.get(s.y) || [];
    arr.push({ x1: s.x1, x2: s.x2 });
    byY.set(s.y, arr);
  }
  let length = 0; let count = 0;
  for (const [, arr] of byY) {
    arr.sort((a, b) => a.x1 - b.x1 || a.x2 - b.x2);
    let cur: { x1: number; x2: number } | null = null;
    for (const seg of arr) {
      if (!cur) { cur = { ...seg }; continue; }
      if (seg.x1 <= cur.x2) {
        cur.x2 = Math.max(cur.x2, seg.x2);
      } else {
        length += cur.x2 - cur.x1; count++;
        cur = { ...seg };
      }
    }
    if (cur) { length += cur.x2 - cur.x1; count++; }
  }
  return { mergedLength: length, count };
}


