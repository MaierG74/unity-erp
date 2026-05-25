import type { QuoteClusterLine, QuoteCostSurchargeKind, QuoteItem } from '@/lib/db/quotes';
import { computeCutlistMaterialSignature, parseMaterialSignature } from '@/lib/quotes/costing-material-signature';
import { calculateQuoteMarkupPercentFromPrice } from '@/lib/quotes/markup';

export { calculateQuoteMarkupPercentFromPrice } from '@/lib/quotes/markup';

export type QuoteCostingGroupKey =
  | 'board_materials'
  | 'edging'
  | 'hardware_components'
  | 'labour'
  | 'overhead'
  | 'commercial';

export type QuoteCostingLineStatus = 'ok' | 'override' | 'warning' | 'missing_price' | 'info';

export interface QuoteCostingLineView {
  id: string;
  groupKey: QuoteCostingGroupKey;
  description: string;
  sourceUnitCost: number | null;
  quoteUnitCost: number | null;
  quantity: number;
  itemQuantity: number;
  displayQuantity: number;
  sourceTotal: number | null;
  quoteTotal: number | null;
  delta: number | null;
  editable: boolean;
  status: QuoteCostingLineStatus;
  note: string | null;
  costSurchargeKind: QuoteCostSurchargeKind | null;
  costSurchargeValue: number | null;
  costSurchargeLabel: string | null;
  costSurchargeResolved: number | null;
  line: QuoteClusterLine | null;
}

export interface QuoteCommercialCostingSummary {
  currentUnitPrice: number;
  currentSellTotal: number;
  sourceCostUnitTotal: number;
  quoteCostUnitTotal: number;
  sourceCostTotal: number;
  quoteCostTotal: number;
  markupPercent: number;
  markupAmountPerUnit: number;
  markupAmountTotal: number;
  priceFromQuoteCostsUnit: number;
  priceFromQuoteCostsTotal: number;
  currentMarginPerUnit: number;
  currentMarginTotal: number;
  sourceMarginPerUnit: number;
  sourceMarginTotal: number;
  priceDeltaPerUnit: number;
  priceDeltaTotal: number;
  surchargeTotal: number;
}

export interface QuoteCostingGroupView {
  key: QuoteCostingGroupKey;
  label: string;
  description: string;
  sourceTotal: number | null;
  total: number;
  delta: number | null;
  overrideCount: number;
  warningCount: number;
  lines: QuoteCostingLineView[];
  commercialSummary?: QuoteCommercialCostingSummary;
}

export const QUOTE_COSTING_GROUP_META: Record<QuoteCostingGroupKey, { label: string; description: string }> = {
  board_materials: {
    label: 'Board materials',
    description: 'Sheet goods from the quote Materials snapshot, using the product cutlist costing as the usage template.',
  },
  edging: {
    label: 'Edging',
    description: 'Edge-banding metres from the quote Materials snapshot, using the product cutlist costing as the usage template.',
  },
  hardware_components: {
    label: 'Hardware/components',
    description: 'Non-cutlist BOM components captured for this quote line.',
  },
  labour: {
    label: 'Labour',
    description: 'Product BOL and generated cutlist piecework labour.',
  },
  overhead: {
    label: 'Overhead',
    description: 'Product overhead allocations frozen into this quote costing.',
  },
  commercial: {
    label: 'Commercial/markup/surcharge',
    description: 'Read-only quote price, margin, and surcharge summary.',
  },
};

export const QUOTE_COSTING_GROUP_ORDER: QuoteCostingGroupKey[] = [
  'board_materials',
  'edging',
  'hardware_components',
  'labour',
  'overhead',
  'commercial',
];

const EPSILON = 0.005;

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function resolveQuoteCostLineSurcharge(
  kind: QuoteCostSurchargeKind,
  value: number,
  baselineUnitCost: number
): number {
  const raw = kind === 'percentage' ? baselineUnitCost * value / 100 : value;
  return roundMoney(raw);
}

export function applyQuoteCostLineSurcharge(
  kind: QuoteCostSurchargeKind,
  value: number,
  baselineUnitCost: number
): { resolved: number; unitCost: number } {
  const resolved = resolveQuoteCostLineSurcharge(kind, value, baselineUnitCost);
  return { resolved, unitCost: roundMoney(baselineUnitCost + resolved) };
}

function asNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isEditableQuoteCostingLine(line: Pick<QuoteClusterLine, 'cutlist_slot'>): boolean {
  const slot = line.cutlist_slot?.toLowerCase() ?? '';
  return (
    slot === 'primary' ||
    slot === 'backer' ||
    slot === 'band16' ||
    slot === 'band32' ||
    slot.startsWith('primary_') ||
    slot.startsWith('backer_') ||
    slot.startsWith('edging_') ||
    slot.startsWith('band')
  );
}

export function classifyQuoteCostingLine(line: QuoteClusterLine): QuoteCostingGroupKey {
  const slot = line.cutlist_slot?.toLowerCase() ?? '';

  if (slot === 'primary' || slot === 'backer' || slot.startsWith('primary_') || slot.startsWith('backer_')) {
    return 'board_materials';
  }

  if (slot === 'band16' || slot === 'band32' || slot.startsWith('edging_') || slot.startsWith('band')) {
    return 'edging';
  }

  if (line.line_type === 'labor') return 'labour';
  if (line.line_type === 'overhead') return 'overhead';
  return 'hardware_components';
}

function lineNote(
  status: QuoteCostingLineStatus,
  editable: boolean,
  surchargeLabel: string | null
): string | null {
  if (status === 'missing_price') return 'check price on order';
  if (surchargeLabel) return `cost surcharge: ${surchargeLabel}`;
  if (status === 'override') return editable ? 'quote-only cost override' : 'cost differs from source';
  return null;
}

function buildLineView(line: QuoteClusterLine, itemQuantity: number): QuoteCostingLineView {
  const quoteUnitCost = asNumber(line.unit_cost);
  const sourceUnitCost = asNumber(line.unit_price) ?? quoteUnitCost;
  const quantity = asNumber(line.qty) ?? 0;
  const displayQuantity = quantity * itemQuantity;
  const sourceTotal = sourceUnitCost === null ? null : roundMoney(displayQuantity * sourceUnitCost);
  const quoteTotal = quoteUnitCost === null ? null : roundMoney(displayQuantity * quoteUnitCost);
  const delta = sourceTotal === null || quoteTotal === null ? null : roundMoney(quoteTotal - sourceTotal);
  const editable = isEditableQuoteCostingLine(line);
  const costSurchargeKind = line.cost_surcharge_kind === 'fixed' || line.cost_surcharge_kind === 'percentage'
    ? line.cost_surcharge_kind
    : null;
  const costSurchargeValue = asNumber(line.cost_surcharge_value);
  const costSurchargeLabel = line.cost_surcharge_label?.trim() || null;
  const costSurchargeResolved = asNumber(line.cost_surcharge_resolved);
  const hasOverride = delta !== null && Math.abs(delta) > EPSILON;
  const status: QuoteCostingLineStatus = quoteUnitCost === null
    ? 'missing_price'
    : hasOverride
      ? 'override'
      : 'ok';

  return {
    id: line.id,
    groupKey: classifyQuoteCostingLine(line),
    description: line.description?.trim() || 'Costing line',
    sourceUnitCost,
    quoteUnitCost,
    quantity,
    itemQuantity,
    displayQuantity,
    sourceTotal,
    quoteTotal,
    delta,
    editable,
    status,
    note: lineNote(status, editable, costSurchargeLabel),
    costSurchargeKind,
    costSurchargeValue,
    costSurchargeLabel,
    costSurchargeResolved,
    line,
  };
}

function getPrimaryMarkupPercent(item: QuoteItem): number {
  return roundMoney(asNumber(item.quote_item_clusters?.[0]?.markup_percent) ?? 0);
}

function makeCommercialSummary(item: QuoteItem, costLines: QuoteCostingLineView[]): QuoteCommercialCostingSummary {
  const itemQuantity = Math.max(asNumber(item.qty) ?? 0, 0);
  const quantityForUnitMath = itemQuantity > EPSILON ? itemQuantity : 1;
  const currentUnitPrice = roundMoney(asNumber(item.unit_price) ?? 0);
  const currentSellTotal = roundMoney(itemQuantity * currentUnitPrice);
  const quoteCostTotal = roundMoney(
    costLines.reduce((sum, line) => sum + (line.quoteTotal ?? 0), 0)
  );
  const sourceCostTotal = roundMoney(
    costLines.reduce((sum, line) => sum + (line.sourceTotal ?? line.quoteTotal ?? 0), 0)
  );
  const quoteCostUnitTotal = roundMoney(quoteCostTotal / quantityForUnitMath);
  const sourceCostUnitTotal = roundMoney(sourceCostTotal / quantityForUnitMath);
  const markupPercent = getPrimaryMarkupPercent(item);
  const markupAmountPerUnit = roundMoney(quoteCostUnitTotal * markupPercent / 100);
  const markupAmountTotal = roundMoney(markupAmountPerUnit * itemQuantity);
  const priceFromQuoteCostsUnit = roundMoney(quoteCostUnitTotal + markupAmountPerUnit);
  const priceFromQuoteCostsTotal = roundMoney(priceFromQuoteCostsUnit * itemQuantity);
  const currentMarginTotal = roundMoney(currentSellTotal - quoteCostTotal);
  const sourceMarginTotal = roundMoney(currentSellTotal - sourceCostTotal);
  const currentMarginPerUnit = roundMoney(currentMarginTotal / quantityForUnitMath);
  const sourceMarginPerUnit = roundMoney(sourceMarginTotal / quantityForUnitMath);
  const priceDeltaPerUnit = roundMoney(priceFromQuoteCostsUnit - currentUnitPrice);

  return {
    currentUnitPrice,
    currentSellTotal,
    sourceCostUnitTotal,
    quoteCostUnitTotal,
    sourceCostTotal,
    quoteCostTotal,
    markupPercent,
    markupAmountPerUnit,
    markupAmountTotal,
    priceFromQuoteCostsUnit,
    priceFromQuoteCostsTotal,
    currentMarginPerUnit,
    currentMarginTotal,
    sourceMarginPerUnit,
    sourceMarginTotal,
    priceDeltaPerUnit,
    priceDeltaTotal: roundMoney(priceDeltaPerUnit * itemQuantity),
    surchargeTotal: roundMoney(asNumber(item.surcharge_total) ?? 0),
  };
}

function makeCommercialLines(item: QuoteItem, summary: QuoteCommercialCostingSummary): QuoteCostingLineView[] {
  const markupLine: QuoteCostingLineView = {
    id: `${item.id}-commercial-margin`,
    groupKey: 'commercial',
    description: 'Quote line margin at current internal cost',
    sourceUnitCost: summary.sourceMarginPerUnit,
    quoteUnitCost: summary.currentMarginPerUnit,
    quantity: 1,
    itemQuantity: Math.max(asNumber(item.qty) ?? 0, 0),
    displayQuantity: Math.max(asNumber(item.qty) ?? 0, 0),
    sourceTotal: summary.sourceMarginTotal,
    quoteTotal: summary.currentMarginTotal,
    delta: roundMoney(summary.currentMarginTotal - summary.sourceMarginTotal),
    editable: false,
    status: 'info',
    note: 'read-only summary; quote price changes only when Update line price is clicked',
    costSurchargeKind: null,
    costSurchargeValue: null,
    costSurchargeLabel: null,
    costSurchargeResolved: null,
    line: null,
  };

  const storedMarkupLine: QuoteCostingLineView = {
    id: `${item.id}-commercial-stored-markup`,
    groupKey: 'commercial',
    description: `Stored markup (${summary.markupPercent}%)`,
    sourceUnitCost: 0,
    quoteUnitCost: summary.markupAmountPerUnit,
    quantity: 1,
    itemQuantity: Math.max(asNumber(item.qty) ?? 0, 0),
    displayQuantity: Math.max(asNumber(item.qty) ?? 0, 0),
    sourceTotal: 0,
    quoteTotal: summary.markupAmountTotal,
    delta: summary.markupAmountTotal,
    editable: false,
    status: 'info',
    note: 'stored on quote_item_clusters.markup_percent and used by Update line price',
    costSurchargeKind: null,
    costSurchargeValue: null,
    costSurchargeLabel: null,
    costSurchargeResolved: null,
    line: null,
  };

  if (Math.abs(summary.surchargeTotal) <= EPSILON) {
    return [markupLine, storedMarkupLine];
  }

  return [
    markupLine,
    storedMarkupLine,
    {
      id: `${item.id}-commercial-surcharge`,
      groupKey: 'commercial',
      description: 'Quote swap and material surcharge total',
      sourceUnitCost: 0,
      quoteUnitCost: summary.surchargeTotal,
      quantity: 1,
      itemQuantity: 1,
      displayQuantity: 1,
      sourceTotal: 0,
      quoteTotal: roundMoney(summary.surchargeTotal),
      delta: roundMoney(summary.surchargeTotal),
      editable: false,
      status: 'info',
      note: 'managed by BOM swap and material surcharge controls',
      costSurchargeKind: null,
      costSurchargeValue: null,
      costSurchargeLabel: null,
      costSurchargeResolved: null,
      line: null,
    },
  ];
}

export function getQuoteCostingGroups(item: QuoteItem): QuoteCostingGroupView[] {
  const itemQuantity = Math.max(asNumber(item.qty) ?? 0, 0);
  const costLines = (item.quote_item_clusters ?? [])
    .flatMap((cluster) => cluster.quote_cluster_lines ?? [])
    .filter(Boolean)
    .sort((a, b) => {
      const sortA = a.sort_order ?? 0;
      const sortB = b.sort_order ?? 0;
      if (sortA !== sortB) return sortA - sortB;
      return String(a.id).localeCompare(String(b.id));
    })
    .map((line) => buildLineView(line, itemQuantity));

  const commercialSummary = makeCommercialSummary(item, costLines);
  const allLines = [...costLines, ...makeCommercialLines(item, commercialSummary)];

  return QUOTE_COSTING_GROUP_ORDER.map((key) => {
    const meta = QUOTE_COSTING_GROUP_META[key];
    const lines = allLines.filter((line) => line.groupKey === key);
    const sourceTotals = lines.map((line) => line.sourceTotal).filter((value): value is number => value !== null);
    const quoteTotals = lines.map((line) => line.quoteTotal).filter((value): value is number => value !== null);
    const total = key === 'commercial'
      ? commercialSummary.currentMarginTotal
      : roundMoney(quoteTotals.reduce((sum, value) => sum + value, 0));
    const sourceTotal = key === 'commercial'
      ? commercialSummary.sourceMarginTotal
      : sourceTotals.length === lines.length
        ? roundMoney(sourceTotals.reduce((sum, value) => sum + value, 0))
        : null;
    const delta = sourceTotal === null ? null : roundMoney(total - sourceTotal);

    return {
      key,
      label: meta.label,
      description: meta.description,
      sourceTotal,
      total,
      delta,
      overrideCount: lines.filter((line) => line.status === 'override').length,
      warningCount: lines.filter((line) => line.status === 'missing_price' || line.status === 'warning').length,
      lines,
      commercialSummary: key === 'commercial' ? commercialSummary : undefined,
    };
  });
}

export function hasPersistedQuoteCostingLines(item: QuoteItem): boolean {
  return (item.quote_item_clusters ?? []).some((cluster) => (cluster.quote_cluster_lines ?? []).length > 0);
}

function partHasBandEdges(part: any): boolean {
  const edges = part?.band_edges ?? {};
  const length = asNumber(part?.length_mm) ?? 0;
  const width = asNumber(part?.width_mm) ?? 0;
  return Boolean((edges.top && width > 0) || (edges.bottom && width > 0) || (edges.left && length > 0) || (edges.right && length > 0));
}

function quoteSnapshotComponentSets(snapshot: unknown): Record<'primary' | 'backer' | 'edging', Set<number>> {
  const sets = { primary: new Set<number>(), backer: new Set<number>(), edging: new Set<number>() };
  for (const group of (Array.isArray(snapshot) ? snapshot as any[] : [])) {
    const groupBacker = asNumber(group?.effective_backer_id);
    if (groupBacker) sets.backer.add(groupBacker);
    for (const part of (Array.isArray(group?.parts) ? group.parts : [])) {
      const board = asNumber(part?.effective_board_id);
      const backer = asNumber(part?.effective_backer_id) ?? groupBacker;
      const edging = asNumber(part?.effective_edging_id);
      if (board) sets.primary.add(board);
      if (backer) sets.backer.add(backer);
      if (edging && partHasBandEdges(part)) sets.edging.add(edging);
    }
  }
  return sets;
}

function lineComponentSets(item: QuoteItem): Record<'primary' | 'backer' | 'edging', Set<number>> {
  const sets = { primary: new Set<number>(), backer: new Set<number>(), edging: new Set<number>() };
  for (const line of (item.quote_item_clusters ?? []).flatMap((c) => c.quote_cluster_lines ?? [])) {
    const slot = line.cutlist_slot?.toLowerCase() ?? '';
    const id = asNumber(line.component_id);
    if (!id) continue;
    if (slot === 'primary' || slot.startsWith('primary_')) sets.primary.add(id);
    else if (slot === 'backer' || slot.startsWith('backer_')) sets.backer.add(id);
    else if (slot === 'band16' || slot === 'band32' || slot.startsWith('edging_') || slot.startsWith('band')) sets.edging.add(id);
  }
  return sets;
}

function sameSet(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

export function isQuoteCostingMaterialsStale(item: QuoteItem): boolean {
  if (!hasPersistedQuoteCostingLines(item) || !item.cutlist_material_snapshot) return false;
  const current = computeCutlistMaterialSignature(item.cutlist_material_snapshot);
  const marker = parseMaterialSignature(item.quote_item_clusters?.[0]?.notes);
  if (marker && current) return marker !== current;
  const expected = quoteSnapshotComponentSets(item.cutlist_material_snapshot);
  const existing = lineComponentSets(item);
  return !sameSet(expected.primary, existing.primary)
    || !sameSet(expected.backer, existing.backer)
    || !sameSet(expected.edging, existing.edging);
}
