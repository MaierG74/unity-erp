import type { CutlistCostingSnapshot, SnapshotSheet } from '@/lib/cutlist/costingSnapshot';

export type BomSnapshotEntry = {
  is_cutlist_item?: boolean;
  line_total?: number;
  component_id?: number | null;
};

export type PaddedLineCostInput = {
  /** Line quantity (detail.quantity) */
  quantity: number;
  /** Per-product cutlist snapshot (null if product has no cutlist) */
  snapshot: CutlistCostingSnapshot | null;
  /** order_details.bom_snapshot — only rows with is_cutlist_item=false are counted */
  bom_snapshot: BomSnapshotEntry[];
};

export type PaddedLineCost = {
  padded_cost: number;
  cutlist_portion: number;
  non_cutlist_portion: number;
};

/**
 * Compute the padded material cost for ONE order_details row.
 * Cutlist portion: sheets (with per-sheet billing overrides) + edging (with pct/meters overrides)
 *   × quantity, sourced from product_cutlist_costing_snapshots.
 * Non-cutlist portion: sum of bom_snapshot.line_total where is_cutlist_item=false, × quantity.
 */
export function computePaddedLineCost(input: PaddedLineCostInput): PaddedLineCost {
  const qty = Math.max(0, input.quantity || 0);

  const cutlistPerUnit = input.snapshot ? paddedCutlistCostPerUnit(input.snapshot) : 0;
  const cutlist_portion = Math.round(cutlistPerUnit * qty * 100) / 100;

  const nonCutlistPerUnit = (input.bom_snapshot ?? [])
    .filter((e) => !e.is_cutlist_item)
    .reduce((s, e) => s + (e.line_total ?? 0), 0);
  const non_cutlist_portion = Math.round(nonCutlistPerUnit * qty * 100) / 100;

  return {
    cutlist_portion,
    non_cutlist_portion,
    padded_cost: Math.round((cutlist_portion + non_cutlist_portion) * 100) / 100,
  };
}

function paddedCutlistCostPerUnit(snap: CutlistCostingSnapshot): number {
  let total = 0;

  // Primary sheets — apply billing override per sheet, or global_full_board, or auto (full sheet for now)
  for (const sheet of snap.sheets) {
    total += sheetChargeAmount(sheet, snap.board_prices, snap.global_full_board);
  }

  // Backer sheets — use backer_price_per_sheet (single price for all backer sheets)
  if (snap.backer_sheets && snap.backer_price_per_sheet != null) {
    for (const sheet of snap.backer_sheets) {
      total += backerSheetCharge(sheet, snap.backer_price_per_sheet, snap.backer_global_full_board);
    }
  }

  // Edging — resolve meters with override (pct or meters), multiply by unit price
  for (const e of snap.edging) {
    const unitPrice = e.unit_price_per_meter ?? 0;
    let meters = e.meters_actual;
    if (e.meters_override != null) {
      meters = e.meters_override;
    } else if (e.pct_override != null) {
      meters = e.meters_actual * (1 + e.pct_override / 100);
    }
    total += meters * unitPrice;
  }

  return total;
}

function sheetChargeAmount(
  sheet: SnapshotSheet,
  board_prices: { material_id: string; unit_price_per_sheet: number | null }[],
  global_full_board: boolean,
): number {
  const price = board_prices.find((b) => b.material_id === sheet.material_id)?.unit_price_per_sheet ?? 0;
  if (price === 0) return 0;

  // Precedence matches components/features/products/product-costing.tsx:122-128
  // so the order-line cost matches what the user sees on the product costing tab.
  //   global_full_board > billing_override > auto (area-proportion).
  if (global_full_board) return price;

  const ov = sheet.billing_override;
  if (ov) {
    if (ov.mode === 'full') return price;
    if (ov.mode === 'manual') return price * (ov.manualPct / 100);
    // ov.mode === 'auto' → fall through
  }

  // Auto: charge used-area proportion of the sheet.
  const sheetArea = sheet.sheet_length_mm * sheet.sheet_width_mm;
  if (sheetArea === 0) return price; // defensive — fall back to full
  const usedPct = sheet.used_area_mm2 / sheetArea;
  return price * usedPct;
}

function backerSheetCharge(
  sheet: SnapshotSheet,
  backer_price: number,
  global_full_board: boolean,
): number {
  // Same precedence as sheetChargeAmount — global_full_board wins first.
  if (global_full_board) return backer_price;

  const ov = sheet.billing_override;
  if (ov) {
    if (ov.mode === 'full') return backer_price;
    if (ov.mode === 'manual') return backer_price * (ov.manualPct / 100);
    // ov.mode === 'auto' → fall through
  }

  const sheetArea = sheet.sheet_length_mm * sheet.sheet_width_mm;
  if (sheetArea === 0) return backer_price;
  return backer_price * (sheet.used_area_mm2 / sheetArea);
}
