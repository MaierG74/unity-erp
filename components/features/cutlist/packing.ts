// Basic types and a first-pass heuristic packer for sheet nesting.

export interface PartSpec {
  id: string;
  length_mm: number; // Y dimension
  width_mm: number;  // X dimension
  qty: number;
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
}

export interface LayoutStats {
  used_area_mm2: number;
  waste_area_mm2: number;
  cuts: number;
  cut_length_mm: number;
}

export interface LayoutResult {
  sheets: SheetLayout[];
  stats: LayoutStats;
}

export interface PackOptions {
  singleSheetOnly?: boolean;
  allowRotation?: boolean; // default true
}

interface FreeRect { x: number; y: number; w: number; h: number }

/**
 * Greedy best-fit into free rectangles. Creates new sheet when needed (unless singleSheetOnly).
 * Not optimal; intended as fast MVP.
 */
export function packPartsIntoSheets(parts: PartSpec[], stock: StockSheetSpec[], opts: PackOptions = {}): LayoutResult {
  const allowRotation = opts.allowRotation !== false;
  const kerf = Math.max(0, stock[0]?.kerf_mm || 0);

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
    return Math.max(b.length_mm, b.width_mm) - Math.max(a.length_mm, a.width_mm);
  });

  const result: LayoutResult = { sheets: [], stats: { used_area_mm2: 0, waste_area_mm2: 0, cuts: 0, cut_length_mm: 0 } };

  let sheetIdx = 0; let remainingSheets = totalQty(stock);
  while (expanded.length > 0) {
    if (remainingSheets <= 0) break;
    const sheet = stock[0]; // MVP: single size
    const free: FreeRect[] = [{ x: 0, y: 0, w: sheet.width_mm, h: sheet.length_mm }];
    const placements: Placement[] = [];

    // Try pack as many as possible onto this sheet
    for (let i = 0; i < expanded.length; ) {
      const part = expanded[i];
      const placed = tryPlace(part, free, allowRotation && !part.require_grain, kerf, placements);
      if (placed) {
        placements.push(placed);
        expanded.splice(i, 1);
      } else {
        i++;
      }
    }

    result.sheets.push({ sheet_id: `${sheet.id}:${sheetIdx+1}`, placements });
    sheetIdx++; remainingSheets--;
    if (opts.singleSheetOnly) break;
  }

  // Stats (approximate)
  const sheetArea = (stock[0]?.length_mm || 0) * (stock[0]?.width_mm || 0);
  let used = 0; let cuts = 0; let cutLen = 0;
  for (const s of result.sheets) {
    used += s.placements.reduce((sum, pl) => sum + pl.w * pl.h, 0);
    // Approximate cut length: sum of perimeters / 2 (shared edges) as a rough starting point
    const peri = s.placements.reduce((sum, pl) => sum + 2*(pl.w + pl.h), 0);
    cutLen += Math.max(0, peri / 2);
    cuts += s.placements.length; // very rough
  }
  const totalSheetArea = sheetArea * result.sheets.length;
  result.stats.used_area_mm2 = used;
  result.stats.waste_area_mm2 = Math.max(0, totalSheetArea - used);
  result.stats.cuts = cuts;
  result.stats.cut_length_mm = cutLen;
  return result;
}

function totalQty(stock: StockSheetSpec[]): number { return stock.reduce((s, it) => s + Math.max(0, it.qty|0), 0); }

function tryPlace(part: PartSpec, free: FreeRect[], allowRotation: boolean, kerf: number, placements: Placement[]): Placement | null {
  // Best-fit: choose free rect with smallest leftover area after placement
  let bestIdx = -1; let best: Placement | null = null; let bestWaste = Infinity;
  for (let i = 0; i < free.length; i++) {
    const fr = free[i];
    const candidates: Array<{w: number; h: number; rot: 0|90}> = [{ w: part.width_mm, h: part.length_mm, rot: 0 }];
    if (allowRotation) candidates.push({ w: part.length_mm, h: part.width_mm, rot: 90 });
    for (const c of candidates) {
      const w = c.w; const h = c.h;
      if (w <= fr.w && h <= fr.h) {
        const waste = (fr.w * fr.h) - (w * h);
        if (waste < bestWaste) {
          bestWaste = waste;
          bestIdx = i;
          best = { part_id: part.id, x: fr.x, y: fr.y, w, h, rot: c.rot };
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
  }
  return best;
}


