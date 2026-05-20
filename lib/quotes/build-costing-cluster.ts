import type { SupabaseClient } from '@supabase/supabase-js';

import { getActiveCategoryRate } from '@/lib/api/job-category-rate';
import { computeProductPieceworkLabor } from '@/lib/piecework/productCosting';
import type { BomSnapshotEntry } from '@/lib/orders/snapshot-types';
import type { QuoteItemCluster } from '@/lib/db/quotes';
import { computeCutlistMaterialSignature, writeMaterialSignature } from '@/lib/quotes/costing-material-signature';
import { isEditableQuoteCostingLine } from '@/lib/quotes/costing-tree';

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

function safeSlotPart(value: unknown): string {
  return String(value ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
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
      cutlist_slot: `primary_${safeSlotPart(materialId)}`,
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
      cutlist_slot: `backer_${safeSlotPart(materialId)}`,
    });
  }

  for (const edging of (Array.isArray(snap.edging) ? snap.edging as SnapshotEdging[] : [])) {
    const actualMeters = toNumber(edging.meters_actual) ?? 0;
    const overrideMeters = toNumber(edging.meters_override);
    const pctOverride = toNumber(edging.pct_override);
    const paddedMeters = overrideMeters !== null
      ? overrideMeters
      : pctOverride !== null
        ? actualMeters * (1 + pctOverride / 100)
        : actualMeters;
    if (paddedMeters <= 0) continue;
    const unitCost = toNumber(edging.unit_price_per_meter);
    const materialId = edging.component_id ?? edging.material_id ?? edging.thickness_mm ?? drafts.length;
    drafts.push({
      line_type: 'component',
      description: `${edging.material_name || 'Edging'}${edging.thickness_mm ? ` (${edging.thickness_mm}mm)` : ''}`,
      qty: roundQty(paddedMeters),
      unit_cost: unitCost,
      unit_price: unitCost,
      component_id: toNumber(edging.component_id),
      include_in_markup: true,
      sort_order: 50 + drafts.length,
      cutlist_slot: `edging_${safeSlotPart(materialId)}`,
    });
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
  const snap = productSnapshot as any;
  const groups = Array.isArray(quoteSnapshot) ? quoteSnapshot as any[] : [];
  if (!snap || groups.length === 0) return deriveCutlistLines(productSnapshot);

  const parts = groups.flatMap((g) => (Array.isArray(g?.parts) ? g.parts.map((p: any) => ({ ...p, __group: g })) : []));
  const totalArea = parts.reduce((sum, p) => sum + ((toNumber(p.length_mm) ?? 0) * (toNumber(p.width_mm) ?? 0) * (toNumber(p.quantity ?? p.qty) ?? 1)), 0) || 1;
  const productPrimaryQty = deriveCutlistLines(productSnapshot).filter((l) => (l.cutlist_slot ?? '').startsWith('primary')).reduce((s, l) => s + l.qty, 0);
  const productBackerQty = deriveCutlistLines(productSnapshot).filter((l) => (l.cutlist_slot ?? '').startsWith('backer')).reduce((s, l) => s + l.qty, 0);

  const board = new Map<string, { id: number | null; name: string; qty: number }>();
  const backer = new Map<string, { id: number | null; name: string; qty: number }>();
  const edgingActual = new Map<string, { id: number | null; name: string; thickness: number | null; meters: number }>();
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
    const meters = edgeMeters(part);
    if (meters > 0 || eid) {
      const ekey = `${eid ?? 'unassigned'}_${thickness ?? 'unknown'}`;
      const e = edgingActual.get(ekey) ?? { id: eid, name: part.effective_edging_name || 'Unassigned edging', thickness, meters: 0 };
      e.meters += meters;
      edgingActual.set(ekey, e);
    }
  }

  const ratioByThickness = new Map<string, { actual: number; padded: number }>();
  for (const edging of (Array.isArray((snap as any).edging) ? (snap as any).edging as SnapshotEdging[] : [])) {
    const actual = toNumber(edging.meters_actual) ?? 0;
    const override = toNumber(edging.meters_override);
    const pct = toNumber(edging.pct_override);
    const padded = override !== null ? (actual > 0 ? override : actual) : pct !== null ? actual * (1 + pct / 100) : actual;
    const key = String(toNumber(edging.thickness_mm) ?? 'unknown');
    const cur = ratioByThickness.get(key) ?? { actual: 0, padded: 0 };
    cur.actual += actual; cur.padded += padded;
    ratioByThickness.set(key, cur);
  }
  const priceMap = await componentPrices(supabase, orgId, [
    ...Array.from(board.values()).map((x) => x.id),
    ...Array.from(backer.values()).map((x) => x.id),
    ...Array.from(edgingActual.values()).map((x) => x.id),
  ]);
  const lines: QuoteCostingLineDraft[] = [];
  for (const entry of board.values()) if (entry.qty > 0) {
    const price = entry.id ? priceMap.get(entry.id) ?? null : null;
    lines.push({ line_type: 'component', description: price === null ? `${entry.name} (check price on order)` : entry.name, qty: roundQty(entry.qty), unit_cost: price, unit_price: price, component_id: entry.id, include_in_markup: true, sort_order: 10 + lines.length, cutlist_slot: `primary_${entry.id ?? 'unassigned'}` });
  }
  for (const entry of backer.values()) if (entry.qty > 0) {
    const price = entry.id ? priceMap.get(entry.id) ?? null : null;
    lines.push({ line_type: 'component', description: price === null ? `${entry.name} (check price on order)` : entry.name, qty: roundQty(entry.qty), unit_cost: price, unit_price: price, component_id: entry.id, include_in_markup: true, sort_order: 30 + lines.length, cutlist_slot: `backer_${entry.id ?? 'unassigned'}` });
  }
  for (const entry of edgingActual.values()) {
    const ratioEntry = ratioByThickness.get(String(entry.thickness ?? 'unknown'));
    const ratio = ratioEntry && ratioEntry.actual > 0 ? ratioEntry.padded / ratioEntry.actual : 1;
    const qty = entry.meters * ratio;
    if (qty <= 0) continue;
    const price = entry.id ? priceMap.get(entry.id) ?? null : null;
    lines.push({ line_type: 'component', description: `${price === null ? `${entry.name} (check price on order)` : entry.name}${entry.thickness ? ` (${entry.thickness}mm)` : ''}`, qty: roundQty(qty), unit_cost: price, unit_price: price, component_id: entry.id, include_in_markup: true, sort_order: 50 + lines.length, cutlist_slot: `edging_${entry.id ?? 'unassigned'}_${entry.thickness ?? 'unknown'}` });
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
      line_type: 'component',
      description: 'Board materials need a saved product cutlist costing layout',
      qty: 1,
      unit_cost: null,
      unit_price: null,
      include_in_markup: true,
      sort_order: 10,
      cutlist_slot: 'primary_missing',
    },
    {
      line_type: 'component',
      description: 'Edging needs a saved product cutlist costing layout',
      qty: 1,
      unit_cost: null,
      unit_price: null,
      include_in_markup: true,
      sort_order: 50,
      cutlist_slot: 'edging_missing',
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

async function overheadLines(
  supabase: SupabaseClient<any, any, any>,
  productId: number,
  orgId: string,
  materialsCost: number,
  labourCost: number
): Promise<QuoteCostingLineDraft[]> {
  const { data, error } = await supabase
    .from('product_overhead_costs')
    .select(`
      id,
      element_id,
      quantity,
      override_value,
      overhead_cost_elements (
        element_id,
        code,
        name,
        cost_type,
        default_value,
        percentage_basis
      )
    `)
    .eq('product_id', productId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  return ((data ?? []) as any[]).map((row, index) => {
    const element = row.overhead_cost_elements as any;
    const value = toNumber(row.override_value) ?? toNumber(element?.default_value) ?? 0;
    const quantity = toNumber(row.quantity) ?? 1;
    const basis = element?.percentage_basis === 'materials'
      ? materialsCost
      : element?.percentage_basis === 'labor'
        ? labourCost
        : materialsCost + labourCost;
    const unitCost = element?.cost_type === 'percentage'
      ? roundMoney(basis * value / 100)
      : value;

    return {
      line_type: 'overhead' as const,
      description: `Overhead · ${element?.name || element?.code || `Element ${row.element_id}`}`,
      qty: roundQty(quantity),
      unit_cost: unitCost,
      unit_price: unitCost,
      include_in_markup: true,
      sort_order: 500 + index,
      overhead_element_id: toNumber(element?.element_id) ?? toNumber(row.element_id),
      overhead_cost_type: element?.cost_type === 'percentage' ? 'percentage' : 'fixed',
      overhead_percentage_basis: element?.percentage_basis ?? null,
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

export async function ensureQuoteItemCostingCluster({
  supabase,
  quoteItemId,
  productId,
  orgId,
  bomSnapshot,
  cutlistMaterialSnapshot,
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
        markup_percent: 0,
      })
      .select('id')
      .single();
    if (error || !cluster) throw error ?? new Error('Failed to create quote costing cluster');
    clusterId = String(cluster.id);
  }

  const { error: lineError } = await supabase
    .from('quote_cluster_lines')
    .insert(lines.map((line) => ({
      ...line,
      cluster_id: clusterId,
      org_id: orgId,
    })));
  if (lineError) throw lineError;

  const clusters = await fetchQuoteItemClustersForCosting(supabase, quoteItemId, orgId);
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
  const oldBySlot = new Map(existing.map((line: any) => [String(line.cutlist_slot), line]));
  const nextSlots = new Set(rebuilt.map((line) => String(line.cutlist_slot)));

  for (const line of rebuilt) {
    const old: any = oldBySlot.get(String(line.cutlist_slot));
    const sameComponent = old && (toNumber(old.component_id) ?? null) === (line.component_id ?? null);
    const oldCost = toNumber(old?.unit_cost);
    const oldBase = toNumber(old?.unit_price) ?? oldCost;
    const keepOverride = sameComponent && oldCost !== null && oldBase !== null && Math.abs(oldCost - oldBase) > 0.005;
    const payload = {
      ...line,
      unit_cost: keepOverride ? oldCost : line.unit_cost,
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

  const deleteIds = existing.filter((line: any) => !nextSlots.has(String(line.cutlist_slot))).map((line: any) => line.id);
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
