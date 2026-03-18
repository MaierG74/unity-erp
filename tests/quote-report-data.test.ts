// Stub env vars before imports to prevent Supabase client init from crashing
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://example.test'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-role-key'

import test from 'node:test'
import assert from 'node:assert/strict'
import { computeQuoteReportData } from '../lib/quotes/report-data'
import type { QuoteItem } from '../lib/db/quotes'

// Helper to build a minimal QuoteItem with typed cluster lines
function makeItem(overrides: Partial<QuoteItem> & {
  clusters?: Array<{
    markup_percent?: number
    lines?: Array<{
      qty: number
      unit_cost: number | null
      line_type?: 'component' | 'manual' | 'labor' | 'overhead'
    }>
  }>
}): QuoteItem {
  const { clusters, ...rest } = overrides
  return {
    id: rest.id ?? 'item-1',
    quote_id: 'quote-1',
    description: rest.description ?? 'Test Item',
    qty: rest.qty ?? 1,
    unit_price: rest.unit_price ?? 100,
    total: (rest.qty ?? 1) * (rest.unit_price ?? 100),
    item_type: rest.item_type ?? 'priced',
    text_align: 'left',
    position: rest.position ?? 0,
    quote_item_clusters: clusters?.map((c, i) => ({
      id: `cluster-${i}`,
      quote_item_id: rest.id ?? 'item-1',
      name: `Cluster ${i}`,
      position: i,
      markup_percent: c.markup_percent ?? 0,
      created_at: '',
      updated_at: '',
      quote_cluster_lines: c.lines?.map((l, j) => ({
        id: `line-${i}-${j}`,
        cluster_id: `cluster-${i}`,
        line_type: l.line_type ?? ('manual' as const),
        qty: l.qty,
        unit_cost: l.unit_cost,
        include_in_markup: true,
        sort_order: j,
        created_at: '',
        updated_at: '',
      })),
    })),
  }
}

// ─── Cost Breakdown by line_type ──────────────────────────────────────────────

test('component and manual lines map to materials', () => {
  const items = [
    makeItem({
      qty: 1, unit_price: 200,
      clusters: [{
        lines: [
          { qty: 1, unit_cost: 40, line_type: 'component' },
          { qty: 1, unit_cost: 30, line_type: 'manual' },
        ],
      }],
    }),
  ]
  const result = computeQuoteReportData(items)
  assert.equal(result.items[0].costBreakdown.materials, 70)
  assert.equal(result.items[0].costBreakdown.labor, 0)
  assert.equal(result.items[0].costBreakdown.overhead, 0)
  assert.equal(result.items[0].costBreakdown.total, 70)
})

test('labor line maps to labor category', () => {
  const items = [
    makeItem({
      qty: 1, unit_price: 200,
      clusters: [{
        lines: [{ qty: 2, unit_cost: 25, line_type: 'labor' }],
      }],
    }),
  ]
  const result = computeQuoteReportData(items)
  assert.equal(result.items[0].costBreakdown.labor, 50)
  assert.equal(result.items[0].costBreakdown.materials, 0)
})

test('overhead line maps to overhead category', () => {
  const items = [
    makeItem({
      qty: 1, unit_price: 200,
      clusters: [{
        lines: [{ qty: 1, unit_cost: 15, line_type: 'overhead' }],
      }],
    }),
  ]
  const result = computeQuoteReportData(items)
  assert.equal(result.items[0].costBreakdown.overhead, 15)
})

test('mixed line types split into correct categories', () => {
  const items = [
    makeItem({
      qty: 2, unit_price: 300,
      clusters: [{
        lines: [
          { qty: 1, unit_cost: 50, line_type: 'component' },  // materials
          { qty: 1, unit_cost: 30, line_type: 'labor' },      // labor
          { qty: 1, unit_cost: 10, line_type: 'overhead' },   // overhead
        ],
      }],
    }),
  ]
  const result = computeQuoteReportData(items)
  const item = result.items[0]
  // per-unit: materials=50, labor=30, overhead=10, total=90
  // × qty(2): materials=100, labor=60, overhead=20, total=180
  assert.equal(item.costBreakdown.materials, 100)
  assert.equal(item.costBreakdown.labor, 60)
  assert.equal(item.costBreakdown.overhead, 20)
  assert.equal(item.costBreakdown.total, 180)
})

// ─── Multiple items aggregate ─────────────────────────────────────────────────

test('aggregate costBreakdown sums across all costed items', () => {
  const items = [
    makeItem({
      id: 'a', qty: 1, unit_price: 200,
      clusters: [{ lines: [{ qty: 1, unit_cost: 60, line_type: 'component' }] }],
    }),
    makeItem({
      id: 'b', qty: 1, unit_price: 300,
      clusters: [{ lines: [{ qty: 1, unit_cost: 40, line_type: 'labor' }] }],
    }),
  ]
  const result = computeQuoteReportData(items)
  assert.equal(result.costBreakdown.materials, 60)
  assert.equal(result.costBreakdown.labor, 40)
  assert.equal(result.costBreakdown.total, 100)
})

// ─── Markup derivation ────────────────────────────────────────────────────────

test('markupAmount is unit_price minus perUnitCost', () => {
  const items = [
    makeItem({
      qty: 1, unit_price: 150,
      clusters: [{ lines: [{ qty: 1, unit_cost: 100, line_type: 'component' }] }],
    }),
  ]
  const result = computeQuoteReportData(items)
  const item = result.items[0]
  assert.equal(item.perUnitCost, 100)
  assert.equal(item.markupAmount, 50)
  assert.equal(item.markupPercent, 50)  // 50/100 * 100
})

test('markupPercent is NaN when perUnitCost is zero', () => {
  const items = [
    makeItem({ qty: 1, unit_price: 100 }),  // no clusters → perUnitCost = 0
  ]
  const result = computeQuoteReportData(items)
  assert.ok(Number.isNaN(result.items[0].markupPercent))
})

test('markupPercent derived from price-minus-cost, not stored markup_percent', () => {
  const items = [
    makeItem({
      qty: 1, unit_price: 200,
      clusters: [{ markup_percent: 99, lines: [{ qty: 1, unit_cost: 80, line_type: 'manual' }] }],
    }),
  ]
  const result = computeQuoteReportData(items)
  // markupPercent should be (200-80)/80*100 = 150, not 99
  assert.equal(result.items[0].markupPercent, 150)
})

// ─── Health stats ─────────────────────────────────────────────────────────────

test('totalItems, costedItems, uncostedItems counts', () => {
  const items = [
    makeItem({
      id: 'costed', qty: 1, unit_price: 100,
      clusters: [{ lines: [{ qty: 1, unit_cost: 60, line_type: 'manual' }] }],
    }),
    makeItem({ id: 'uncosted', qty: 1, unit_price: 200 }),
  ]
  const result = computeQuoteReportData(items)
  assert.equal(result.totalItems, 2)
  assert.equal(result.costedItems, 1)
  assert.equal(result.uncostedItems, 1)
})

test('lowestMarginItem identifies item with lowest margin among costed items', () => {
  const items = [
    makeItem({
      id: 'high', description: 'High Margin', qty: 1, unit_price: 200,
      clusters: [{ lines: [{ qty: 1, unit_cost: 60, line_type: 'manual' }] }],
    }),
    makeItem({
      id: 'low', description: 'Low Margin', qty: 1, unit_price: 100,
      clusters: [{ lines: [{ qty: 1, unit_cost: 90, line_type: 'manual' }] }],
    }),
  ]
  const result = computeQuoteReportData(items)
  assert.equal(result.lowestMarginItem?.description, 'Low Margin')
  assert.equal(result.lowestMarginItem?.marginPercent, 10)
})

test('highestValueItem identified by sell price among costed items', () => {
  const items = [
    makeItem({
      id: 'cheap', description: 'Cheap', qty: 1, unit_price: 50,
      clusters: [{ lines: [{ qty: 1, unit_cost: 30, line_type: 'manual' }] }],
    }),
    makeItem({
      id: 'expensive', description: 'Expensive', qty: 1, unit_price: 500,
      clusters: [{ lines: [{ qty: 1, unit_cost: 300, line_type: 'manual' }] }],
    }),
  ]
  const result = computeQuoteReportData(items)
  assert.equal(result.highestValueItem?.description, 'Expensive')
  assert.equal(result.highestValueItem?.sellPrice, 500)
})

test('avgMargin equals overall revenue-weighted margin (same as marginPercent)', () => {
  const items = [
    makeItem({
      qty: 1, unit_price: 200,
      clusters: [{ lines: [{ qty: 1, unit_cost: 100, line_type: 'manual' }] }],
    }),
  ]
  const result = computeQuoteReportData(items)
  assert.equal(result.avgMargin, result.marginPercent)
  assert.equal(result.avgMargin, 50)
})

// ─── Edge cases ───────────────────────────────────────────────────────────────

test('no costing — all health stats are zero, NaN margins, null items', () => {
  const items = [
    makeItem({ qty: 1, unit_price: 100 }),
    makeItem({ id: 'b', qty: 1, unit_price: 200 }),
  ]
  const result = computeQuoteReportData(items)
  assert.equal(result.hasAnyCosting, false)
  assert.equal(result.totalRevenue, 0)
  assert.equal(result.totalCost, 0)
  assert.ok(Number.isNaN(result.marginPercent))
  assert.equal(result.costedItems, 0)
  assert.equal(result.uncostedItems, 2)
  assert.equal(result.lowestMarginItem, null)
  assert.equal(result.highestValueItem, null)
})

test('zero revenue item — margin is NaN, excluded from aggregate', () => {
  const items = [
    makeItem({
      qty: 0, unit_price: 0,
      clusters: [{ lines: [{ qty: 1, unit_cost: 50, line_type: 'manual' }] }],
    }),
  ]
  const result = computeQuoteReportData(items)
  assert.equal(result.items[0].revenue, 0)
  assert.ok(Number.isNaN(result.items[0].marginPercent))
})

test('null unit_cost lines treated as 0 and do not trigger hasCosting', () => {
  const items = [
    makeItem({
      qty: 1, unit_price: 100,
      clusters: [{ lines: [{ qty: 1, unit_cost: null, line_type: 'manual' }] }],
    }),
  ]
  const result = computeQuoteReportData(items)
  assert.equal(result.items[0].hasCosting, false)
  assert.equal(result.items[0].costBreakdown.total, 0)
})

test('null clusters and null cluster lines handled safely (RLS nulls)', () => {
  const item: QuoteItem = {
    id: 'item-1',
    quote_id: 'quote-1',
    description: 'No Clusters',
    qty: 1,
    unit_price: 100,
    total: 100,
    item_type: 'priced',
    text_align: 'left',
    position: 0,
    quote_item_clusters: null as unknown as undefined,
  }
  const result = computeQuoteReportData([item])
  assert.equal(result.items[0].hasCosting, false)
  assert.equal(result.hasAnyCosting, false)
})

test('negative margin when cost exceeds revenue', () => {
  const items = [
    makeItem({
      qty: 1, unit_price: 50,
      clusters: [{ lines: [{ qty: 1, unit_cost: 80, line_type: 'manual' }] }],
    }),
  ]
  const result = computeQuoteReportData(items)
  assert.ok(result.items[0].marginPercent < 0)
  assert.ok(result.totalProfit < 0)
})

test('heading and note items excluded from all calculations', () => {
  const items = [
    makeItem({
      id: 'priced', qty: 1, unit_price: 100, item_type: 'priced',
      clusters: [{ lines: [{ qty: 1, unit_cost: 50, line_type: 'manual' }] }],
    }),
    makeItem({ id: 'heading', item_type: 'heading', qty: 0, unit_price: 0 }),
    makeItem({ id: 'note', item_type: 'note', qty: 0, unit_price: 0 }),
  ]
  const result = computeQuoteReportData(items)
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].id, 'priced')
})

test('empty items array returns zero/null everything', () => {
  const result = computeQuoteReportData([])
  assert.equal(result.totalRevenue, 0)
  assert.equal(result.totalCost, 0)
  assert.equal(result.totalProfit, 0)
  assert.equal(result.totalItems, 0)
  assert.equal(result.costedItems, 0)
  assert.equal(result.hasAnyCosting, false)
  assert.equal(result.lowestMarginItem, null)
  assert.equal(result.highestValueItem, null)
  assert.equal(result.items.length, 0)
})

test('costBreakdown.total equals sum of all category costs', () => {
  const items = [
    makeItem({
      qty: 1, unit_price: 500,
      clusters: [{
        lines: [
          { qty: 1, unit_cost: 100, line_type: 'component' },
          { qty: 2, unit_cost: 50, line_type: 'labor' },
          { qty: 1, unit_cost: 25, line_type: 'overhead' },
        ],
      }],
    }),
  ]
  const result = computeQuoteReportData(items)
  const bd = result.items[0].costBreakdown
  assert.equal(bd.total, bd.materials + bd.labor + bd.overhead)
  assert.equal(bd.total, 225)  // 100 + 100 + 25
})
