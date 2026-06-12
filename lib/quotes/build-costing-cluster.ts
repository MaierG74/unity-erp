import type { SupabaseClient } from '@supabase/supabase-js';

import { getActiveCategoryRate } from '@/lib/api/job-category-rate';
import { computeProductPieceworkLabor } from '@/lib/piecework/productCosting';
import type { BomSnapshotEntry } from '@/lib/orders/snapshot-types';
import {
  computeEffectiveOverheadLines,
  type DirectOverheadRow,
} from '@/lib/products/effective-overhead';
import type { QuoteCostSurchargeKind, QuoteItemCluster } from '@/lib/db/quotes';
import { computeCutlistMaterialSignature, writeMaterialSignature } from '@/lib/quotes/costing-material-signature';
import { applyQuoteCostLineSurcharge, isEditableQuoteCostingLine } from '@/lib/quotes/costing-tree';
import { calculateQuoteMarkupPercentFromPrice } from '@/lib/quotes/markup';

export type QuoteCostingLineDraft = {
  line_type: 'component' | 'manual' | 'labor' | 'overhead';
  description: string;
  qty: number;
  unit_cost: number | null;
  unit_price: number | null;
  component_id?: number | null;
  supplier_component_id?: number | null;
  include_in_markup: boolean;
  sort_order: number;
  cutlist_slot?: string | null;
  cost_surcharge_kind?: QuoteCostSurchargeKind | null;
  cost_surcharge_value?: number | null;
  cost_surcharge_label?: string | null;
  cost_surcharge_resolved?: number | null;
  labor_type?: string | null;
  hours?: number | null;
  rate?: number | null;
  overhead_element_id?: number | null;
  overhead_cost_type?: 'fixed' | 'percentage' | null;
  overhead_percentage_basis?: 'materials' | 'labor' | 'total' | null;
};

type BuildQuoteCostingLinesArgs = {
  supabase: SupabaseClient<any, any, any>;
  productId: number;
  orgId: string;
  bomSnapshot?: unknown;
  cutlistMaterialSnapshot?: unknown;
};

type EnsureQuoteItemCostingArgs = BuildQuoteCostingLinesArgs & {
  quoteItemId: string;
  markupPercent?: number | null;
};

type SnapshotSheet = {
  sheet_id?: string;
  material_id?: string;
  material_name?: string;
  sheet_length_mm?: number;
  sheet_width_mm?: number;
  used_area_mm2?: number;
  billing_override?: { mode?: 'auto' | 'full' | 'manual'; manualPct?: number } | null;
};

type SnapshotEdging = {
  material_id?: string;
  material_name?: string;
  thickness_mm?: number;
  meters_actual?: number;
  meters_override?: number | null;
  pct_override?: number | null;
  unit_price_per_meter?: number | null;
  component_id?: number | null;
};

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundQty(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function lineCost(line: QuoteCostingLineDraft): number {
  return Number(line.qty || 0) * Number(line.unit_cost || 0);
}

function supabaseErrorDetails(error: any) {
  return {
    message: error?.message,
    details: error?.details,
    code: error?.code,
    hint: error?.hint,
  };
}

type LegacyEdgingSlot = 'band16' | 'band32';

type ProductEdgingTemplate = {
  slot: LegacyEdgingSlot;
  componentId: number | null;
  name: string;
  unitCost: number | null;
  actualMeters: number;
  paddedMeters: number;
};

function legacyEdgingSlot(thickness: number | null): LegacyEdgingSlot {
  return thickness === 16 ? 'band16' : 'band32';
}

function paddedEdgingMeters(edging: SnapshotEdging): number {
  const actualMeters = toNumber(edging.meters_actual) ?? 0;
  const overrideMeters = toNumber(edging.meters_override);
  const pctOverride = toNumber(edging.pct_override);
  return overrideMeters !== null
    ? overrideMeters
    : pctOverride !== null
      ? actualMeters * (1 + pctOverride / 100)
      : actualMeters;
}

function edgingSlotFromMaterialName(name: string | null | undefined): LegacyEdgingSlot | null {
  const matches = Array.from(String(name ?? '').matchAll(/[x×]\s*(\d+(?:\.\d+)?)\s*mm/gi));
  const width = matches.length > 0 ? toNumber(matches[matches.length - 1]?.[1]) : null;
  if (!width) return null;
  return width > 24 ? 'band32' : 'band16';
}

function productEdgingSlot(snap: any, edging: SnapshotEdging): LegacyEdgingSlot {
  const nameSlot = edgingSlotFromMaterialName(edging.material_name);
  if (nameSlot) return nameSlot;

  const actual = toNumber(edging.meters_actual) ?? 0;
  const stats = snap?.primary_layout?.stats ?? {};
  const band16Actual = (toNumber(stats.edgebanding_16mm_mm) ?? 0) / 1000;
  const band32Actual = (toNumber(stats.edgebanding_32mm_mm) ?? 0) / 1000;
  const has16 = band16Actual > 0;
  const has32 = band32Actual > 0;
  if (has16 !== has32) return has16 ? 'band16' : 'band32';
  if (actual > 0 && (has16 || has32)) {
    const diff16 = has16 ? Math.abs(actual - band16Actual) : Number.POSITIVE_INFINITY;
    const diff32 = has32 ? Math.abs(actual - band32Actual) : Number.POSITIVE_INFINITY;
    const tolerance = Math.max(0.001, actual * 0.02);
    if (Math.min(diff16, diff32) <= tolerance) return diff16 <= diff32 ? 'band16' : 'band32';
  }

  return legacyEdgingSlot(toNumber(edging.thickness_mm));
}

function productEdgingTemplatesBySlot(snapshot: unknown): Map<LegacyEdgingSlot, ProductEdgingTemplate[]> {
  const snap = snapshot as any;
  const result = new Map<LegacyEdgingSlot, ProductEdgingTemplate[]>([
    ['band16', []],
    ['band32', []],
  ]);

  for (const edging of (Array.isArray(snap?.edging) ? snap.edging as SnapshotEdging[] : [])) {
    const paddedMeters = paddedEdgingMeters(edging);
    const actualMeters = toNumber(edging.meters_actual) ?? 0;
    if (paddedMeters <= 0 && actualMeters <= 0) continue;
    const slot = productEdgingSlot(snap, edging);
    result.get(slot)?.push({
      slot,
      componentId: toNumber(edging.component_id),
      name: edging.material_name || 'Edging',
      unitCost: toNumber(edging.unit_price_per_meter),
      actualMeters,
      paddedMeters,
    });
  }

  return result;
}

function productEdgingPaddedMetersBySlot(templatesBySlot: Map<LegacyEdgingSlot, ProductEdgingTemplate[]>): Map<LegacyEdgingSlot, number> {
  return new Map<LegacyEdgingSlot, number>([
    ['band16', (templatesBySlot.get('band16') ?? []).reduce((sum, template) => sum + template.paddedMeters, 0)],
    ['band32', (templatesBySlot.get('band32') ?? []).reduce((sum, template) => sum + template.paddedMeters, 0)],
  ]);
}

export function quoteCostingRefreshMatchKey(line: Pick<QuoteCostingLineDraft, 'cutlist_slot' | 'component_id' | 'description'>): string {
  return [line.cutlist_slot ?? '', line.component_id ?? 'unassigned', line.description ?? ''].join('|');
}

function describeComponent(entry: BomSnapshotEntry): string {
  const code = entry.effective_component_code || entry.component_code || entry.default_component_code;
  const description = entry.component_description?.trim();
  if (code && description) return `${code} · ${description}`;
  return description || code || `BOM ${entry.source_bom_id}`;
}

function bomSnapshotLines(snapshot: unknown): QuoteCostingLineDraft[] {
  if (!Array.isArray(snapshot)) return [];

  return (snapshot as BomSnapshotEntry[])
    .filter((entry) => !entry.is_cutlist_item)
    .map((entry, index) => {
      const quoteUnitCost = toNumber(entry.effective_unit_price) ?? toNumber(entry.unit_price);
      const sourceUnitCost = toNumber(entry.default_unit_price) ?? toNumber(entry.unit_price) ?? quoteUnitCost;
      const qty = toNumber(entry.effective_quantity_required) ?? toNumber(entry.quantity_required) ?? 0;

      return {
        line_type: 'component' as const,
        description: describeComponent(entry),
        qty: roundQty(qty),
        unit_cost: quoteUnitCost,
        unit_price: sourceUnitCost,
        component_id: toNumber(entry.effective_component_id) ?? toNumber(entry.component_id),
        supplier_component_id: toNumber(entry.supplier_component_id),
        include_in_markup: true,
        sort_order: 100 + index,
      };
    })
    .filter((line) => line.qty > 0 || line.unit_cost !== null);
}

function findLayoutSheet(layout: any, sheet: SnapshotSheet, index: number): any | null {
  const sheets = Array.isArray(layout?.sheets) ? layout.sheets : [];
  return sheets.find((layoutSheet: any) => layoutSheet.sheet_id === sheet.sheet_id) ?? sheets[index] ?? null;
}

function placementArea(sheet: any): number {
  const placements = Array.isArray(sheet?.placements) ? sheet.placements : [];
  return placements.reduce((sum: number, placement: any) => {
    const width = toNumber(placement.width_mm ?? placement.w) ?? 0;
    const length = toNumber(placement.length_mm ?? placement.h) ?? 0;
    return sum + width * length;
  }, 0);
}

function sheetUsedArea(sheet: SnapshotSheet, layout: any, index: number): number {
  const stored = toNumber(sheet.used_area_mm2) ?? 0;
  if (stored > 0) return stored;
  return placementArea(findLayoutSheet(layout, sheet, index));
}

function sheetArea(snap: any, sheet: SnapshotSheet, layout: any, index: number, kind: 'primary' | 'backer'): number {
  const storedLength = toNumber(sheet.sheet_length_mm) ?? 0;
  const storedWidth = toNumber(sheet.sheet_width_mm) ?? 0;
  if (storedLength > 0 && storedWidth > 0) return storedLength * storedWidth;

  const layoutSheet = findLayoutSheet(layout, sheet, index);
  const layoutLength = toNumber(layoutSheet?.stock_length_mm) ?? 0;
  const layoutWidth = toNumber(layoutSheet?.stock_width_mm) ?? 0;
  if (layoutLength > 0 && layoutWidth > 0) return layoutLength * layoutWidth;

  const boards = kind === 'backer' ? snap?.calculator_inputs?.backerBoards : snap?.calculator_inputs?.primaryBoards;
  const material = Array.isArray(boards)
    ? boards.find((board: any) => board.id === sheet.material_id) ?? boards[0]
    : null;
  return material ? Number(material.length_mm ?? 0) * Number(material.width_mm ?? 0) : 0;
}

function billedSheetFraction(snap: any, sheet: SnapshotSheet, layout: any, index: number, kind: 'primary' | 'backer'): number {
  if (kind === 'primary' && snap?.global_full_board) return 1;
  if (kind === 'backer' && snap?.backer_global_full_board) return 1;

  if (sheet.billing_override?.mode === 'full') return 1;
  if (sheet.billing_override?.mode === 'manual') return Math.max(0, Number(sheet.billing_override.manualPct ?? 0) / 100);

  const area = sheetArea(snap, sheet, layout, index, kind);
  return area > 0 ? sheetUsedArea(sheet, layout, index) / area : 0;
}

function deriveCutlistLines(snapshot: unknown): QuoteCostingLineDraft[] {
  const snap = snapshot as any;
  if (!snap || typeof snap !== 'object') return [];

  const drafts: QuoteCostingLineDraft[] = [];
  const primarySheets = new Map<string, { name: string; qty: number; unitCost: number | null; componentId: number | null }>();
  const boardPrices = Array.isArray(snap.board_prices) ? snap.board_prices : [];

  for (const [index, sheet] of (Array.isArray(snap.sheets) ? snap.sheets as SnapshotSheet[] : []).entries()) {
    const materialId = String(sheet.material_id ?? '');
    if (!materialId) continue;
    const price = boardPrices.find((entry: any) => entry.material_id === materialId);
    const current = primarySheets.get(materialId) ?? {
      name: sheet.material_name || materialId,
      qty: 0,
      unitCost: toNumber(price?.unit_price_per_sheet),
      componentId: toNumber(price?.component_id),
    };
    current.qty += billedSheetFraction(snap, sheet, snap.primary_layout, index, 'primary');
    primarySheets.set(materialId, current);
  }

  for (const [materialId, sheet] of primarySheets) {
    if (sheet.qty <= 0) continue;
    drafts.push({
      line_type: 'component',
      description: sheet.name,
      qty: roundQty(sheet.qty),
      unit_cost: sheet.unitCost,
      unit_price: sheet.unitCost,
      component_id: sheet.componentId,
      include_in_markup: true,
      sort_order: 10 + drafts.length,
      cutlist_slot: 'primary',
    });
  }

  const backerSheets = new Map<string, { name: string; qty: number; unitCost: number | null; componentId: number | null }>();
  const backerBoards = Array.isArray(snap.calculator_inputs?.backerBoards) ? snap.calculator_inputs.backerBoards : [];
  for (const [index, sheet] of (Array.isArray(snap.backer_sheets) ? snap.backer_sheets as SnapshotSheet[] : []).entries()) {
    const materialId = String(sheet.material_id ?? 'backer');
    const material = backerBoards.find((board: any) => board.id === materialId) ?? backerBoards[0] ?? null;
    const current = backerSheets.get(materialId) ?? {
      name: sheet.material_name || material?.name || 'Backer board',
      qty: 0,
      unitCost: toNumber(material?.cost) ?? toNumber(snap.backer_price_per_sheet),
      componentId: toNumber(material?.component_id),
    };
    current.qty += billedSheetFraction(snap, sheet, snap.backer_layout, index, 'backer');
    backerSheets.set(materialId, current);
  }

  for (const [materialId, sheet] of backerSheets) {
    if (sheet.qty <= 0) continue;
    drafts.push({
      line_type: 'component',
      description: sheet.name,
      qty: roundQty(sheet.qty),
      unit_cost: sheet.unitCost,
      unit_price: sheet.unitCost,
      component_id: sheet.componentId,
      include_in_markup: true,
      sort_order: 30 + drafts.length,
      cutlist_slot: 'backer',
    });
  }

  for (const templates of productEdgingTemplatesBySlot(snapshot).values()) {
    for (const template of templates) {
      if (template.paddedMeters <= 0) continue;
      drafts.push({
        line_type: template.componentId ? 'component' : 'manual',
        description: `${template.name} (${template.slot === 'band16' ? '16mm' : '32mm'})`,
        qty: roundQty(template.paddedMeters),
        unit_cost: template.unitCost,
        unit_price: template.unitCost,
        component_id: template.componentId,
        include_in_markup: true,
        sort_order: 50 + drafts.length,
        cutlist_slot: template.slot,
      });
    }
  }

  return drafts;
}

function edgeMeters(part: any): number {
  const edges = part?.band_edges ?? {};
  const length = toNumber(part?.length_mm) ?? 0;
  const width = toNumber(part?.width_mm) ?? 0;
  const qty = toNumber(part?.quantity ?? part?.qty) ?? 1;
  let mm = 0;
  if (edges.top) mm += width;
  if (edges.bottom) mm += width;
  if (edges.left) mm += length;
  if (edges.right) mm += length;
  return (mm * qty) / 1000;
}

async function componentPrices(supabase: SupabaseClient<any, any, any>, orgId: string, ids: Array<number | null>): Promise<Map<number, number>> {
  const unique = Array.from(new Set(ids.filter((id): id is number => Number.isFinite(id as number) && Number(id) > 0)));
  const prices = new Map<number, number>();
  if (unique.length === 0) return prices;
  const { data, error } = await supabase
    .from('suppliercomponents')
    .select('component_id, price')
    .eq('org_id', orgId)
    .in('component_id', unique);
  if (error) throw error;
  for (const row of (data ?? []) as any[]) {
    const id = toNumber(row.component_id);
    const price = toNumber(row.price);
    if (!id || price === null) continue;
    const current = prices.get(id);
    if (current === undefined || price < current) prices.set(id, price);
  }
  return prices;
}

export async function deriveQuoteMaterialCutlistLines(
  supabase: SupabaseClient<any, any, any>,
  orgId: string,
  productSnapshot: unknown,
  quoteSnapshot: unknown
): Promise<QuoteCostingLineDraft[]> {
  const groups = Array.isArray(quoteSnapshot) ? quoteSnapshot as any[] : [];
  if (!productSnapshot || groups.length === 0) return deriveCutlistLines(productSnapshot);

  const parts = groups.flatMap((g) => (Array.isArray(g?.parts) ? g.parts.map((p: any) => ({ ...p, __group: g })) : []));
  const totalArea = parts.reduce((sum, p) => sum + ((toNumber(p.length_mm) ?? 0) * (toNumber(p.width_mm) ?? 0) * (toNumber(p.quantity ?? p.qty) ?? 1)), 0) || 1;
  const productPrimaryQty = deriveCutlistLines(productSnapshot).filter((l) => (l.cutlist_slot ?? '').startsWith('primary')).reduce((s, l) => s + l.qty, 0);
  const productBackerQty = deriveCutlistLines(productSnapshot).filter((l) => (l.cutlist_slot ?? '').startsWith('backer')).reduce((s, l) => s + l.qty, 0);
  const productEdgingTemplates = productEdgingTemplatesBySlot(productSnapshot);
  const productPaddedMetersBySlot = productEdgingPaddedMetersBySlot(productEdgingTemplates);

  const board = new Map<string, { id: number | null; name: string; qty: number }>();
  const backer = new Map<string, { id: number | null; name: string; qty: number }>();
  const edgingActual = new Map<string, { id: number | null; name: string; thickness: number | null; slot: LegacyEdgingSlot; meters: number }>();
  for (const part of parts) {
    const areaShare = ((toNumber(part.length_mm) ?? 0) * (toNumber(part.width_mm) ?? 0) * (toNumber(part.quantity ?? part.qty) ?? 1)) / totalArea;
    const bid = toNumber(part.effective_board_id);
    const bkey = bid ? String(bid) : 'unassigned';
    const b = board.get(bkey) ?? { id: bid, name: part.effective_board_name || 'Unassigned board material', qty: 0 };
    b.qty += productPrimaryQty * areaShare;
    board.set(bkey, b);

    const kid = toNumber(part.effective_backer_id ?? part.__group?.effective_backer_id);
    if (kid || productBackerQty > 0) {
      const kkey = kid ? String(kid) : 'unassigned';
      const bk = backer.get(kkey) ?? { id: kid, name: part.effective_backer_name || part.__group?.effective_backer_name || 'Unassigned backer board', qty: 0 };
      bk.qty += productBackerQty * areaShare;
      backer.set(kkey, bk);
    }

    const eid = toNumber(part.effective_edging_id);
    const thickness = toNumber(part.effective_thickness_mm);
    const slot = legacyEdgingSlot(thickness);
    const meters = edgeMeters(part);
    if (meters > 0 || eid) {
      const ekey = `${eid ?? 'unassigned'}_${slot}`;
      const e = edgingActual.get(ekey) ?? { id: eid, name: part.effective_edging_name || 'Unassigned edging', thickness, slot, meters: 0 };
      e.meters += meters;
      edgingActual.set(ekey, e);
    }
  }

  const quoteMetersBySlot = new Map<LegacyEdgingSlot, number>([
    ['band16', 0],
    ['band32', 0],
  ]);
  for (const entry of edgingActual.values()) {
    quoteMetersBySlot.set(entry.slot, (quoteMetersBySlot.get(entry.slot) ?? 0) + entry.meters);
  }

  const priceMap = await componentPrices(supabase, orgId, [
    ...Array.from(board.values()).map((x) => x.id),
    ...Array.from(backer.values()).map((x) => x.id),
    ...Array.from(edgingActual.values()).map((x) => x.id),
    ...Array.from(productEdgingTemplates.values()).flat().map((template) => template.componentId),
  ]);
  const lines: QuoteCostingLineDraft[] = [];
  for (const entry of board.values()) if (entry.qty > 0) {
    const price = entry.id ? priceMap.get(entry.id) ?? null : null;
    lines.push({ line_type: entry.id ? 'component' : 'manual', description: price === null ? `${entry.name} (check price on order)` : entry.name, qty: roundQty(entry.qty), unit_cost: price, unit_price: price, component_id: entry.id, include_in_markup: true, sort_order: 10 + lines.length, cutlist_slot: 'primary' });
  }
  for (const entry of backer.values()) if (entry.qty > 0) {
    const price = entry.id ? priceMap.get(entry.id) ?? null : null;
    lines.push({ line_type: entry.id ? 'component' : 'manual', description: price === null ? `${entry.name} (check price on order)` : entry.name, qty: roundQty(entry.qty), unit_cost: price, unit_price: price, component_id: entry.id, include_in_markup: true, sort_order: 30 + lines.length, cutlist_slot: 'backer' });
  }
  for (const entry of edgingActual.values()) {
    const quoteMetersForSlot = quoteMetersBySlot.get(entry.slot) ?? 0;
    const productPaddedMeters = productPaddedMetersBySlot.get(entry.slot) ?? 0;
    const ratio = productPaddedMeters > 0 && quoteMetersForSlot > 0 ? productPaddedMeters / quoteMetersForSlot : 1;
    const qty = entry.meters * ratio;
    if (qty <= 0) continue;

    const template = entry.id ? null : productEdgingTemplates.get(entry.slot)?.[0] ?? null;
    const componentId = entry.id ?? template?.componentId ?? null;
    const price = template?.unitCost ?? (componentId ? priceMap.get(componentId) ?? null : null);
    const name = template?.name ?? entry.name;
    lines.push({ line_type: componentId ? 'component' : 'manual', description: `${price === null ? `${name} (check price on order)` : name}${entry.thickness ? ` (${entry.thickness}mm)` : ''}`, qty: roundQty(qty), unit_cost: price, unit_price: price, component_id: componentId, include_in_markup: true, sort_order: 50 + lines.length, cutlist_slot: entry.slot });
  }
  return lines;
}

async function productCutlistLines(
  supabase: SupabaseClient<any, any, any>,
  productId: number,
  orgId: string,
  cutlistMaterialSnapshot?: unknown
): Promise<QuoteCostingLineDraft[]> {
  const { data, error } = await supabase
    .from('product_cutlist_costing_snapshots')
    .select('snapshot_data')
    .eq('product_id', productId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) throw error;
  const productSnapshot = (data as any)?.snapshot_data ?? null;
  const lines = cutlistMaterialSnapshot
    ? await deriveQuoteMaterialCutlistLines(supabase, orgId, productSnapshot, cutlistMaterialSnapshot)
    : deriveCutlistLines(productSnapshot);
  if (lines.length > 0) return lines;

  const { data: groups, error: groupsError } = await supabase
    .from('product_cutlist_groups')
    .select('id')
    .eq('product_id', productId)
    .eq('org_id', orgId)
    .limit(1);
  if (groupsError) throw groupsError;
  if (!groups || groups.length === 0) return [];

  return [
    {
      line_type: 'manual',
      description: 'Board materials need a saved product cutlist costing layout (check price on order)',
      qty: 1,
      unit_cost: null,
      unit_price: null,
      include_in_markup: true,
      sort_order: 10,
      cutlist_slot: 'primary',
    },
    {
      line_type: 'manual',
      description: 'Edging needs a saved product cutlist costing layout (check price on order)',
      qty: 1,
      unit_cost: null,
      unit_price: null,
      include_in_markup: true,
      sort_order: 50,
      cutlist_slot: 'band32',
    },
  ];
}

type BolRow = {
  bol_id?: number | null;
  job_id: number;
  time_required?: number | null;
  time_unit?: 'hours' | 'minutes' | 'seconds' | null;
  quantity?: number | null;
  pay_type?: 'hourly' | 'piece' | null;
  rate_id?: number | null;
  piece_rate_id?: number | null;
  hourly_rate_id?: number | null;
};

type ProductLinkRow = {
  sub_product_id: number;
  sub_product_name: string;
  scale: number;
  mode: string;
};

type JobMeta = {
  job_id: number;
  name: string | null;
  category_id: number | null;
  category_name: string | null;
};

function toHours(value: number, unit: 'hours' | 'minutes' | 'seconds'): number {
  if (unit === 'hours') return value;
  if (unit === 'minutes') return value / 60;
  return value / 3600;
}

async function loadJobMeta(
  supabase: SupabaseClient<any, any, any>,
  jobIds: number[]
): Promise<Map<number, JobMeta>> {
  const uniqueIds = Array.from(new Set(jobIds.filter((id) => Number.isFinite(id) && id > 0)));
  const map = new Map<number, JobMeta>();
  if (uniqueIds.length === 0) return map;

  const { data, error } = await supabase
    .from('jobs')
    .select('job_id, name, category_id, job_categories(name)')
    .in('job_id', uniqueIds);
  if (error) throw error;

  for (const row of (data ?? []) as any[]) {
    map.set(Number(row.job_id), {
      job_id: Number(row.job_id),
      name: row.name ?? null,
      category_id: toNumber(row.category_id),
      category_name: row.job_categories?.name ?? null,
    });
  }
  return map;
}

async function resolvePieceRate(
  supabase: SupabaseClient<any, any, any>,
  jobId: number,
  productId: number,
  pieceRateId: number | null,
  today: string
): Promise<number | null> {
  if (pieceRateId) {
    const { data, error } = await supabase
      .from('piece_work_rates')
      .select('rate')
      .eq('rate_id', pieceRateId)
      .maybeSingle();
    if (error) throw error;
    if (data) return toNumber((data as any).rate);
  }

  const { data, error } = await supabase
    .from('piece_work_rates')
    .select('rate, product_id, effective_date, end_date')
    .eq('job_id', jobId)
    .lte('effective_date', today)
    .or(`end_date.is.null,end_date.gte.${today}`)
    .order('effective_date', { ascending: false });
  if (error) throw error;

  const chosen = ((data ?? []) as any[]).find((row) => Number(row.product_id) === productId)
    ?? ((data ?? []) as any[]).find((row) => row.product_id == null)
    ?? null;
  return chosen ? toNumber(chosen.rate) : null;
}

async function resolveHourlyRate(
  supabase: SupabaseClient<any, any, any>,
  row: BolRow,
  job: JobMeta | undefined,
  today: string
): Promise<number | null> {
  if (row.hourly_rate_id) {
    const { data, error } = await supabase
      .from('job_hourly_rates')
      .select('hourly_rate')
      .eq('rate_id', row.hourly_rate_id)
      .maybeSingle();
    if (error) throw error;
    if (data) return toNumber((data as any).hourly_rate);
  }

  if (row.rate_id) {
    const { data, error } = await supabase
      .from('job_category_rates')
      .select('hourly_rate')
      .eq('rate_id', row.rate_id)
      .maybeSingle();
    if (error) throw error;
    if (data) return toNumber((data as any).hourly_rate);
  }

  if (job?.category_id) {
    const activeRate = await getActiveCategoryRate(job.category_id, today);
    return activeRate?.hourly_rate ?? null;
  }

  return null;
}

async function loadBolRows(
  supabase: SupabaseClient<any, any, any>,
  productId: number,
  orgId: string,
  scale = 1,
  sourceLabel?: string
): Promise<QuoteCostingLineDraft[]> {
  const { data, error } = await supabase
    .from('billoflabour')
    .select('bol_id, job_id, time_required, time_unit, quantity, pay_type, rate_id, piece_rate_id, hourly_rate_id')
    .eq('product_id', productId)
    .eq('org_id', orgId);
  if (error) throw error;

  const rows = ((data ?? []) as any[]).map((row) => ({
    ...row,
    job_id: Number(row.job_id),
  })) as BolRow[];
  if (rows.length === 0) return [];

  const jobs = await loadJobMeta(supabase, rows.map((row) => row.job_id));
  const today = new Date().toISOString().split('T')[0];
  const lines: QuoteCostingLineDraft[] = [];

  for (const [index, row] of rows.entries()) {
    const job = jobs.get(row.job_id);
    const payType = (row.pay_type || 'hourly') as 'hourly' | 'piece';
    const baseQuantity = (toNumber(row.quantity) ?? 1) * scale;
    const jobName = job?.name || `Job ${row.job_id}`;
    const description = `Labour · ${job?.category_name ? `${job.category_name} · ` : ''}${jobName}${sourceLabel ? ` (${sourceLabel})` : ''}`;

    if (payType === 'piece') {
      const rate = await resolvePieceRate(supabase, row.job_id, productId, toNumber(row.piece_rate_id), today);
      lines.push({
        line_type: 'labor',
        description,
        qty: roundQty(baseQuantity),
        unit_cost: rate,
        unit_price: rate,
        include_in_markup: true,
        labor_type: 'piece',
        hours: null,
        rate,
        sort_order: 300 + index,
      });
      continue;
    }

    const hours = toHours(toNumber(row.time_required) ?? 0, row.time_unit || 'hours');
    const rate = await resolveHourlyRate(supabase, row, job, today);
    lines.push({
      line_type: 'labor',
      description,
      qty: roundQty(baseQuantity * hours),
      unit_cost: rate,
      unit_price: rate,
      include_in_markup: true,
      labor_type: 'hourly',
      hours: roundQty(hours),
      rate,
      sort_order: 300 + index,
    });
  }

  return lines;
}

async function labourLines(
  supabase: SupabaseClient<any, any, any>,
  productId: number,
  orgId: string
): Promise<QuoteCostingLineDraft[]> {
  const lines = await loadBolRows(supabase, productId, orgId);

  const { data: links, error: linkError } = await supabase
    .from('product_bom_links')
    .select('sub_product_id, scale')
    .eq('product_id', productId)
    .eq('org_id', orgId);
  if (linkError) throw linkError;

  for (const link of (links ?? []) as any[]) {
    const subProductId = Number(link.sub_product_id);
    if (!Number.isFinite(subProductId) || subProductId <= 0) continue;
    const scale = Number(link.scale || 1);
    lines.push(...await loadBolRows(supabase, subProductId, orgId, scale, `sub-product ${subProductId}`));
  }

  try {
    const piecework = await computeProductPieceworkLabor(String(productId), orgId, supabase);
    for (const [index, line] of piecework.entries()) {
      lines.push({
        line_type: 'labor',
        description: `Labour · ${line.activityLabel}`,
        qty: roundQty(Number(line.count || 0)),
        unit_cost: toNumber(line.rate),
        unit_price: toNumber(line.rate),
        include_in_markup: true,
        labor_type: 'piecework_activity',
        hours: null,
        rate: toNumber(line.rate),
        sort_order: 360 + index,
      });
    }
  } catch (error) {
    console.warn('[quote-costing] piecework labor unavailable', error);
  }

  return lines.filter((line) => line.qty > 0 || line.unit_cost !== null);
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function mapOverheadRow(row: any): DirectOverheadRow | null {
  const element = relationOne(row.overhead_cost_elements as any);
  if (!element) return null;

  const costType = element.cost_type === 'percentage' ? 'percentage' : 'fixed';
  const percentageBasis = element.percentage_basis === 'materials' || element.percentage_basis === 'labor' || element.percentage_basis === 'total'
    ? element.percentage_basis
    : null;

  return {
    id: toNumber(row.id),
    element_id: toNumber(row.element_id) ?? toNumber(element.element_id) ?? 0,
    code: String(element.code ?? ''),
    name: String(element.name ?? ''),
    cost_type: costType,
    percentage_basis: percentageBasis,
    quantity: toNumber(row.quantity) ?? 1,
    default_value: toNumber(element.default_value) ?? 0,
    override_value: toNumber(row.override_value),
  };
}

async function loadOverheadRowsByProduct(
  supabase: SupabaseClient<any, any, any>,
  productIds: number[]
): Promise<Map<number, DirectOverheadRow[]>> {
  const uniqueIds = Array.from(new Set(productIds.filter((id) => Number.isFinite(id) && id > 0)));
  const byProduct = new Map<number, DirectOverheadRow[]>();
  for (const id of uniqueIds) byProduct.set(id, []);
  if (uniqueIds.length === 0) return byProduct;

  const { data, error } = await supabase
    .from('product_overhead_costs')
    .select(`
      id,
      product_id,
      element_id,
      quantity,
      override_value,
      created_at,
      overhead_cost_elements (
        element_id,
        code,
        name,
        cost_type,
        default_value,
        percentage_basis
      )
    `)
    .in('product_id', uniqueIds)
    .order('created_at', { ascending: true });
  if (error) throw error;

  for (const row of (data ?? []) as any[]) {
    const productId = toNumber(row.product_id);
    if (!productId) continue;
    const mapped = mapOverheadRow(row);
    if (!mapped) continue;
    byProduct.set(productId, [...(byProduct.get(productId) ?? []), mapped]);
  }

  return byProduct;
}

async function loadDirectBomMaterialCost(
  supabase: SupabaseClient<any, any, any>,
  productId: number
): Promise<number> {
  const { data, error } = await supabase
    .from('billofmaterials')
    .select('quantity_required, suppliercomponents(price)')
    .eq('product_id', productId);
  if (error) throw error;

  return ((data ?? []) as any[]).reduce((sum, row) => {
    const supplier = relationOne(row.suppliercomponents as any);
    return sum + (toNumber(row.quantity_required) ?? 0) * (toNumber(supplier?.price) ?? 0);
  }, 0);
}

async function overheadLines(
  supabase: SupabaseClient<any, any, any>,
  productId: number,
  orgId: string,
  materialsCost: number,
  labourCost: number
): Promise<QuoteCostingLineDraft[]> {
  const { data: linksData, error: linkError } = await supabase
    .from('product_bom_links')
    .select('sub_product_id, scale, mode')
    .eq('product_id', productId)
    .eq('org_id', orgId);
  if (linkError) throw linkError;

  const childIds = Array.from(new Set(((linksData ?? []) as any[])
    .filter((link) => (link.mode ?? 'phantom') === 'phantom')
    .map((link) => Number(link.sub_product_id))
    .filter((id) => Number.isFinite(id) && id > 0)));

  const { data: childProducts, error: childProductError } = childIds.length > 0
    ? await supabase
      .from('products')
      .select('product_id, name')
      .eq('org_id', orgId)
      .in('product_id', childIds)
    : { data: [], error: null };
  if (childProductError) throw childProductError;

  const childNameById = new Map(((childProducts ?? []) as any[]).map((row) => [
    Number(row.product_id),
    String(row.name ?? `Product ${row.product_id}`),
  ]));

  const links: ProductLinkRow[] = ((linksData ?? []) as any[])
    .map((link) => ({
      sub_product_id: Number(link.sub_product_id),
      sub_product_name: childNameById.get(Number(link.sub_product_id)) ?? `Product ${link.sub_product_id}`,
      scale: toNumber(link.scale) ?? 1,
      mode: String(link.mode ?? 'phantom'),
    }));

  const overheadByProduct = await loadOverheadRowsByProduct(supabase, [productId, ...childIds]);
  const childBasisBySubId = new Map<number, { materialsCost: number; labourCost: number }>();
  for (const childId of childIds) {
    const [childMaterialsCost, childLabourLines] = await Promise.all([
      loadDirectBomMaterialCost(supabase, childId),
      loadBolRows(supabase, childId, orgId),
    ]);
    childBasisBySubId.set(childId, {
      materialsCost: childMaterialsCost,
      labourCost: childLabourLines.reduce((sum, line) => sum + lineCost(line), 0),
    });
  }

  const childOverheadBySubId = new Map(childIds.map((childId) => [childId, overheadByProduct.get(childId) ?? []]));
  const scaleBySubId = new Map(links.map((link) => [link.sub_product_id, link.scale]));
  const effectiveLines = computeEffectiveOverheadLines({
    direct: overheadByProduct.get(productId) ?? [],
    links,
    childOverheadBySubId,
    childBasisBySubId,
  });

  return effectiveLines.map((line, index) => {
    const basis = line.percentage_basis === 'materials'
      ? materialsCost
      : line.percentage_basis === 'labor'
        ? labourCost
        : materialsCost + labourCost;
    const unitCost = line._source === 'link'
      ? roundMoney(line.resolved_unit_amount)
      : line.cost_type === 'percentage'
        ? roundMoney(basis * line.value / 100)
        : line.value;
    const quantity = line._source === 'link' ? 1 : line.quantity;
    const scale = line._sub_product_id ? scaleBySubId.get(line._sub_product_id) : null;
    const sourceSuffix = line._source === 'link'
      ? ` - from ${line._sub_product_name ?? `Product ${line._sub_product_id}`}${scale && scale !== 1 ? ` x${scale}` : ''}`
      : '';

    return {
      line_type: 'overhead' as const,
      description: `Overhead · ${line.name || line.code || `Element ${line.element_id}`}${sourceSuffix}`,
      qty: roundQty(quantity),
      unit_cost: unitCost,
      unit_price: unitCost,
      include_in_markup: true,
      sort_order: 500 + index,
      overhead_element_id: line.element_id,
      overhead_cost_type: line.cost_type,
      overhead_percentage_basis: line.percentage_basis,
    };
  });
}

export async function buildQuoteProductCostingLines({
  supabase,
  productId,
  orgId,
  bomSnapshot,
  cutlistMaterialSnapshot,
}: BuildQuoteCostingLinesArgs): Promise<QuoteCostingLineDraft[]> {
  const [cutlist, labour] = await Promise.all([
    productCutlistLines(supabase, productId, orgId, cutlistMaterialSnapshot),
    labourLines(supabase, productId, orgId),
  ]);

  const bom = bomSnapshotLines(bomSnapshot);
  const materialsCost = [...cutlist, ...bom].reduce((sum, line) => sum + lineCost(line), 0);
  const labourCost = labour.reduce((sum, line) => sum + lineCost(line), 0);
  const overhead = await overheadLines(supabase, productId, orgId, materialsCost, labourCost);

  return [...cutlist, ...bom, ...labour, ...overhead]
    .filter((line) => line.qty > 0 || line.unit_cost !== null)
    .map((line, index) => ({ ...line, sort_order: line.sort_order ?? index }));
}

export async function fetchQuoteItemClustersForCosting(
  supabase: SupabaseClient<any, any, any>,
  quoteItemId: string,
  orgId: string
): Promise<QuoteItemCluster[]> {
  const { data, error } = await supabase
    .from('quote_item_clusters')
    .select('*, quote_cluster_lines(*)')
    .eq('quote_item_id', quoteItemId)
    .eq('org_id', orgId)
    .order('position', { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as QuoteItemCluster[];
}

export function calculateQuoteCostingUnitSubtotal(clusters: QuoteItemCluster[]): number {
  const firstCluster = clusters[0];
  return Math.round((firstCluster?.quote_cluster_lines ?? []).reduce((sum, line) => {
    return sum + Number(line.qty || 0) * Number(line.unit_cost || 0);
  }, 0) * 100) / 100;
}

export async function applyQuoteCostingMarkupPercent({
  supabase,
  clusters,
  markupPercent,
  orgId,
}: {
  supabase: SupabaseClient<any, any, any>;
  clusters: QuoteItemCluster[];
  markupPercent: number;
  orgId: string;
}): Promise<QuoteItemCluster[]> {
  const firstCluster = clusters[0];
  if (!firstCluster?.id) return clusters;

  const roundedMarkup = Number.isFinite(markupPercent) ? Math.round(markupPercent * 100) / 100 : 0;
  const { data, error } = await supabase
    .from('quote_item_clusters')
    .update({ markup_percent: roundedMarkup })
    .eq('id', firstCluster.id)
    .eq('org_id', orgId)
    .select('*')
    .single();
  if (error) throw error;

  return clusters.map((cluster) => cluster.id === firstCluster.id
    ? { ...cluster, ...(data as QuoteItemCluster), quote_cluster_lines: cluster.quote_cluster_lines }
    : cluster
  );
}

export async function applyQuoteCostingMarkupFromUnitPrice({
  supabase,
  clusters,
  unitPrice,
  orgId,
}: {
  supabase: SupabaseClient<any, any, any>;
  clusters: QuoteItemCluster[];
  unitPrice: number;
  orgId: string;
}): Promise<QuoteItemCluster[]> {
  const costSubtotal = calculateQuoteCostingUnitSubtotal(clusters);
  return applyQuoteCostingMarkupPercent({
    supabase,
    clusters,
    markupPercent: calculateQuoteMarkupPercentFromPrice(costSubtotal, Number(unitPrice || 0)),
    orgId,
  });
}

export async function ensureQuoteItemCostingCluster({
  supabase,
  quoteItemId,
  productId,
  orgId,
  bomSnapshot,
  cutlistMaterialSnapshot,
  markupPercent,
}: EnsureQuoteItemCostingArgs): Promise<{ clusters: QuoteItemCluster[]; created: boolean; lineCount: number }> {
  const existingClusters = await fetchQuoteItemClustersForCosting(supabase, quoteItemId, orgId);
  const existingLineCount = existingClusters.reduce((sum, cluster) => sum + (cluster.quote_cluster_lines?.length ?? 0), 0);
  if (existingLineCount > 0) {
    return { clusters: existingClusters, created: false, lineCount: existingLineCount };
  }

  const lines = await buildQuoteProductCostingLines({ supabase, productId, orgId, bomSnapshot, cutlistMaterialSnapshot });
  if (lines.length === 0) {
    return { clusters: existingClusters, created: false, lineCount: 0 };
  }

  let clusterId = existingClusters[0]?.id;
  if (!clusterId) {
    const { data: cluster, error } = await supabase
      .from('quote_item_clusters')
      .insert({
        quote_item_id: quoteItemId,
        org_id: orgId,
        name: 'Quote Costing',
        notes: writeMaterialSignature('Quote-owned costing snapshot. Line cost edits do not update product or supplier prices.', computeCutlistMaterialSignature(cutlistMaterialSnapshot)),
        position: 0,
        markup_percent: Number.isFinite(Number(markupPercent)) ? Math.round(Number(markupPercent) * 100) / 100 : 0,
      })
      .select('id')
      .single();
    if (error || !cluster) {
      console.error('[quote-costing] quote_item_clusters insert failed', {
        quoteItemId,
        productId,
        orgId,
        ...supabaseErrorDetails(error),
      });

      // Safe recovery for local/racy retries: if an empty costing cluster was created
      // concurrently or a duplicate position constraint fired, reuse the visible cluster.
      const refetched = await fetchQuoteItemClustersForCosting(supabase, quoteItemId, orgId);
      const reusable = refetched[0];
      if (reusable?.id) {
        clusterId = String(reusable.id);
      } else {
        throw error ?? new Error('Failed to create quote costing cluster');
      }
    } else {
      clusterId = String(cluster.id);
    }
  }

  const { error: lineError } = await supabase
    .from('quote_cluster_lines')
    .insert(lines.map((line) => ({
      ...line,
      cluster_id: clusterId,
      org_id: orgId,
    })));
  if (lineError) {
    console.error('[quote-costing] quote_cluster_lines insert failed', {
      quoteItemId,
      productId,
      orgId,
      clusterId,
      lineCount: lines.length,
      slots: lines.map((line) => line.cutlist_slot).filter(Boolean),
      ...supabaseErrorDetails(lineError),
    });
    throw lineError;
  }

  let clusters = await fetchQuoteItemClustersForCosting(supabase, quoteItemId, orgId);
  if (clusterId && Number.isFinite(Number(markupPercent)) && clusters[0]?.id === clusterId) {
    clusters = await applyQuoteCostingMarkupPercent({
      supabase,
      clusters,
      markupPercent: Number(markupPercent),
      orgId,
    });
  }
  return { clusters, created: true, lineCount: lines.length };
}

export async function refreshQuoteItemCostingMaterials({
  supabase,
  quoteItemId,
  productId,
  orgId,
  bomSnapshot,
  cutlistMaterialSnapshot,
}: EnsureQuoteItemCostingArgs): Promise<{ clusters: QuoteItemCluster[]; lineCount: number }> {
  const clusters = await fetchQuoteItemClustersForCosting(supabase, quoteItemId, orgId);
  const cluster = clusters[0];
  if (!cluster) throw new Error('Quote item has no costing cluster');

  const rebuilt = (await productCutlistLines(supabase, productId, orgId, cutlistMaterialSnapshot))
    .filter((line) => isEditableQuoteCostingLine({ cutlist_slot: line.cutlist_slot ?? null }));
  const existing = (cluster.quote_cluster_lines ?? [])
    .filter((line) => isEditableQuoteCostingLine({ cutlist_slot: line.cutlist_slot ?? null }));
  const oldByKey = new Map(existing.map((line: any) => [quoteCostingRefreshMatchKey(line), line]));
  const nextKeys = new Set(rebuilt.map((line) => quoteCostingRefreshMatchKey(line)));

  for (const line of rebuilt) {
    const old: any = oldByKey.get(quoteCostingRefreshMatchKey(line));
    const sameComponent = old && (toNumber(old.component_id) ?? null) === (line.component_id ?? null);
    const oldCost = toNumber(old?.unit_cost);
    const oldBase = toNumber(old?.unit_price) ?? oldCost;
    const oldSurchargeKind = old?.cost_surcharge_kind === 'fixed' || old?.cost_surcharge_kind === 'percentage'
      ? old.cost_surcharge_kind as QuoteCostSurchargeKind
      : null;
    const oldSurchargeValue = toNumber(old?.cost_surcharge_value);
    const nextBase = toNumber(line.unit_price) ?? toNumber(line.unit_cost);
    const candidateSurcharge = sameComponent && oldSurchargeKind && oldSurchargeValue !== null && nextBase !== null
      ? applyQuoteCostLineSurcharge(oldSurchargeKind, oldSurchargeValue, nextBase)
      : null;
    const keepSurcharge = Boolean(candidateSurcharge && candidateSurcharge.unitCost >= 0);
    const keepOverride = !keepSurcharge && sameComponent && oldCost !== null && oldBase !== null && Math.abs(oldCost - oldBase) > 0.005;
    const surcharge = keepSurcharge ? candidateSurcharge : null;
    const payload = {
      ...line,
      unit_cost: surcharge ? surcharge.unitCost : keepOverride ? oldCost : line.unit_cost,
      unit_price: nextBase,
      cost_surcharge_kind: keepSurcharge ? oldSurchargeKind : null,
      cost_surcharge_value: keepSurcharge ? oldSurchargeValue : null,
      cost_surcharge_label: keepSurcharge ? old?.cost_surcharge_label ?? null : null,
      cost_surcharge_resolved: surcharge?.resolved ?? null,
      cluster_id: cluster.id,
      org_id: orgId,
    };
    if (old?.id) {
      const { error } = await supabase.from('quote_cluster_lines').update(payload).eq('id', old.id).eq('org_id', orgId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('quote_cluster_lines').insert(payload);
      if (error) throw error;
    }
  }

  const deleteIds = existing.filter((line: any) => !nextKeys.has(quoteCostingRefreshMatchKey(line))).map((line: any) => line.id);
  if (deleteIds.length > 0) {
    const { error } = await supabase.from('quote_cluster_lines').delete().eq('org_id', orgId).in('id', deleteIds);
    if (error) throw error;
  }

  const signature = computeCutlistMaterialSignature(cutlistMaterialSnapshot);
  const { error: notesError } = await supabase
    .from('quote_item_clusters')
    .update({ notes: writeMaterialSignature(cluster.notes, signature) })
    .eq('id', cluster.id)
    .eq('org_id', orgId);
  if (notesError) throw notesError;

  const refreshed = await fetchQuoteItemClustersForCosting(supabase, quoteItemId, orgId);
  return { clusters: refreshed, lineCount: rebuilt.length };
}
