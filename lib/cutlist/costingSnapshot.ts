import type { CompactPart, BoardMaterial, EdgingMaterial } from '@/components/features/cutlist/primitives';
import type { LayoutResult, SheetBillingOverride, EdgingSummaryEntry, EdgingBillingOverride } from '@/lib/cutlist/types';

// =============================================================================
// Snapshot Types
// =============================================================================

export interface SnapshotSheet {
  sheet_id: string;
  material_id: string;
  material_name: string;
  sheet_length_mm: number;
  sheet_width_mm: number;
  used_area_mm2: number;
  billing_override: { mode: 'auto' | 'full' | 'manual'; manualPct: number } | null;
}

export interface SnapshotEdging {
  material_id: string;
  material_name: string;
  thickness_mm: number;
  meters_actual: number;
  meters_override: number | null;
  pct_override: number | null;
  unit_price_per_meter: number | null;
  component_id: number | null;
}

export interface SnapshotBoardPrice {
  material_id: string;
  unit_price_per_sheet: number | null;
  component_id: number | null;
}

export interface SnapshotCalculatorInputs {
  primaryBoards: {
    id: string; name: string; length_mm: number; width_mm: number;
    cost: number; isDefault: boolean; component_id?: number;
  }[];
  backerBoards: {
    id: string; name: string; length_mm: number; width_mm: number;
    cost: number; isDefault: boolean; component_id?: number;
  }[];
  edging: {
    id: string; name: string; thickness_mm: number; width_mm: number;
    cost_per_meter: number; isDefaultForThickness: boolean; component_id?: number;
  }[];
  kerf: number;
  optimizationPriority: 'fast' | 'offcut' | 'deep';
}

export interface CutlistCostingSnapshot {
  sheets: SnapshotSheet[];
  global_full_board: boolean;
  edging: SnapshotEdging[];
  board_prices: SnapshotBoardPrice[];
  backer_sheets: SnapshotSheet[] | null;
  backer_global_full_board: boolean;
  backer_price_per_sheet: number | null;
  calculator_inputs: SnapshotCalculatorInputs;
  stats: {
    total_parts: number;
    total_pieces: number;
    total_used_area_mm2: number;
    total_waste_area_mm2: number;
    total_cuts: number;
  };
}

// =============================================================================
// Parts Hash
// =============================================================================

export function computePartsHash(parts: CompactPart[]): string {
  const normalized = parts.map(p => ({
    id: p.id,
    length_mm: p.length_mm,
    width_mm: p.width_mm,
    quantity: p.quantity,
    material_id: p.material_id,
    grain: p.grain,
    band_edges: p.band_edges,
    lamination_type: p.lamination_type,
    lamination_group: p.lamination_group,
    edging_material_id: p.edging_material_id,
  }));
  // Simple djb2 hash — deterministic, fast, no crypto needed
  const str = JSON.stringify(normalized);
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
  }
  return hash.toString(36);
}

// =============================================================================
// Snapshot Builder
// =============================================================================

export interface BuildSnapshotArgs {
  result: LayoutResult;
  backerResult: LayoutResult | null;
  parts: CompactPart[];
  primaryBoards: BoardMaterial[];
  backerBoards: BoardMaterial[];
  edgingMaterials: EdgingMaterial[];
  kerf: number;
  optimizationPriority: 'fast' | 'offcut' | 'deep';
  sheetOverrides: Record<string, SheetBillingOverride>;
  globalFullBoard: boolean;
  backerSheetOverrides: Record<string, SheetBillingOverride>;
  backerGlobalFullBoard: boolean;
  edgingByMaterial: EdgingSummaryEntry[];
  edgingOverrides: Record<string, EdgingBillingOverride>;
}

export function buildSnapshotFromCalculator(args: BuildSnapshotArgs): CutlistCostingSnapshot {
  const {
    result, backerResult, parts, primaryBoards, backerBoards, edgingMaterials,
    kerf, optimizationPriority, sheetOverrides, globalFullBoard,
    backerSheetOverrides, backerGlobalFullBoard, edgingByMaterial, edgingOverrides,
  } = args;

  // Fallback material for sheets where placements don't carry material_id
  const defaultBoard = primaryBoards.find(b => b.isDefault) || primaryBoards[0];

  // Map sheets with their billing overrides
  const sheets: SnapshotSheet[] = result.sheets.map(s => ({
    sheet_id: s.sheet_id,
    material_id: s.placements.find(p => p.material_id)?.material_id || defaultBoard?.id || '',
    material_name: s.material_label || defaultBoard?.name || '',
    sheet_length_mm: s.stock_length_mm || 0,
    sheet_width_mm: s.stock_width_mm || 0,
    used_area_mm2: s.used_area_mm2 || 0,
    billing_override: sheetOverrides[s.sheet_id]
      ? { mode: sheetOverrides[s.sheet_id].mode, manualPct: sheetOverrides[s.sheet_id].manualPct }
      : null,
  }));

  // Backer sheets — use default backer board for material identity
  const defaultBacker = backerBoards.find(b => b.isDefault) || backerBoards[0];
  const backer_sheets: SnapshotSheet[] | null = backerResult
    ? backerResult.sheets.map(s => ({
        sheet_id: s.sheet_id,
        material_id: defaultBacker?.id || '',
        material_name: defaultBacker?.name || '',
        sheet_length_mm: s.stock_length_mm || 0,
        sheet_width_mm: s.stock_width_mm || 0,
        used_area_mm2: s.used_area_mm2 || 0,
        billing_override: backerSheetOverrides[s.sheet_id]
          ? { mode: backerSheetOverrides[s.sheet_id].mode, manualPct: backerSheetOverrides[s.sheet_id].manualPct }
          : null,
      }))
    : null;

  // Edging with overrides and resolved prices
  const edging: SnapshotEdging[] = edgingByMaterial.map(e => {
    const override = edgingOverrides[e.materialId];
    return {
      material_id: e.materialId,
      material_name: e.name,
      thickness_mm: e.thickness_mm,
      meters_actual: e.length_mm / 1000,
      meters_override: override?.metersOverride ?? null,
      pct_override: override?.pctOverride ?? null,
      unit_price_per_meter: e.cost_per_meter || null,
      component_id: e.component_id ?? null,
    };
  });

  // Board prices — one entry per unique primary board material
  const seenBoardIds = new Set<string>();
  const board_prices: SnapshotBoardPrice[] = [];
  for (const b of primaryBoards) {
    if (!seenBoardIds.has(b.id)) {
      seenBoardIds.add(b.id);
      board_prices.push({
        material_id: b.id,
        unit_price_per_sheet: b.cost || null,
        component_id: b.component_id ?? null,
      });
    }
  }

  // Calculator inputs for self-containedness
  const calculator_inputs: SnapshotCalculatorInputs = {
    primaryBoards: primaryBoards.map(b => ({
      id: b.id, name: b.name, length_mm: b.length_mm, width_mm: b.width_mm,
      cost: b.cost, isDefault: b.isDefault, component_id: b.component_id,
    })),
    backerBoards: backerBoards.map(b => ({
      id: b.id, name: b.name, length_mm: b.length_mm, width_mm: b.width_mm,
      cost: b.cost, isDefault: b.isDefault, component_id: b.component_id,
    })),
    edging: edgingMaterials.map(e => ({
      id: e.id, name: e.name, thickness_mm: e.thickness_mm, width_mm: e.width_mm,
      cost_per_meter: e.cost_per_meter, isDefaultForThickness: e.isDefaultForThickness,
      component_id: e.component_id,
    })),
    kerf,
    optimizationPriority,
  };

  // Stats
  const totalPieces = parts.reduce((sum, p) => sum + (p.quantity || 0), 0);
  const stats = {
    total_parts: parts.length,
    total_pieces: totalPieces,
    total_used_area_mm2: result.stats.used_area_mm2,
    total_waste_area_mm2: result.stats.waste_area_mm2,
    total_cuts: result.stats.cuts,
  };

  return {
    sheets,
    global_full_board: globalFullBoard,
    edging,
    board_prices,
    backer_sheets,
    backer_global_full_board: backerGlobalFullBoard,
    backer_price_per_sheet: defaultBacker?.cost ?? null,
    calculator_inputs,
    stats,
  };
}
