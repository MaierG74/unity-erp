// Stub env vars before imports to prevent Supabase client init from crashing
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://example.test'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-role-key'

import test from 'node:test'
import assert from 'node:assert/strict'
import { computeQuoteProfitability } from '../lib/quotes/profitability'
import type { QuoteItem } from '../lib/db/quotes'

// Helper to build a minimal QuoteItem with clusters
function makeItem(overrides: Partial<QuoteItem> & {
  clusters?: Array<{
    markup_percent?: number;
    lines?: Array<{ qty: number; unit_cost: number | null }>;
  }>;
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
        line_type: 'manual' as const,
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

test('basic margin calculation', () => {
  const items = [
    makeItem({
      qty: 1, unit_price: 100,
      clusters: [{ lines: [{ qty: 1, unit_cost: 60 }] }],
    }),
  ]
  const result = computeQuoteProfitability(items)
  assert.equal(result.totalRevenue, 100)
  assert.equal(result.totalCost, 60)
  assert.equal(result.totalProfit, 40)
  assert.equal(result.marginPercent, 40)
  assert.equal(result.hasAnyCosting, true)
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].hasCosting, true)
})

test('multiple cluster lines sum correctly', () => {
  const items = [
    makeItem({
      qty: 2, unit_price: 200,
      clusters: [
        { lines: [{ qty: 3, unit_cost: 20 }, { qty: 1, unit_cost: 50 }] },
        { lines: [{ qty: 2, unit_cost: 10 }] },
      ],
    }),
  ]
  const result = computeQuoteProfitability(items)
  // cost = (3*20 + 1*50) + (2*10) = 60 + 50 + 20 = 130
  // revenue = 2*200 = 400
  assert.equal(result.totalRevenue, 400)
  assert.equal(result.totalCost, 130)
  assert.equal(result.totalProfit, 270)
})

test('null unit_cost treated as 0', () => {
  const items = [
    makeItem({
      qty: 1, unit_price: 100,
      clusters: [{ lines: [{ qty: 1, unit_cost: null }, { qty: 1, unit_cost: 30 }] }],
    }),
  ]
  const result = computeQuoteProfitability(items)
  assert.equal(result.totalCost, 30)
  assert.equal(result.items[0].hasCosting, true)
})

test('item with only null unit_cost lines has no costing', () => {
  const items = [
    makeItem({
      qty: 1, unit_price: 100,
      clusters: [{ lines: [{ qty: 1, unit_cost: null }] }],
    }),
  ]
  const result = computeQuoteProfitability(items)
  assert.equal(result.items[0].hasCosting, false)
})

test('heading and note items excluded', () => {
  const items = [
    makeItem({
      id: 'priced', qty: 1, unit_price: 100,
      item_type: 'priced',
      clusters: [{ lines: [{ qty: 1, unit_cost: 50 }] }],
    }),
    makeItem({ id: 'heading', item_type: 'heading', qty: 0, unit_price: 0 }),
    makeItem({ id: 'note', item_type: 'note', qty: 0, unit_price: 0 }),
  ]
  const result = computeQuoteProfitability(items)
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].id, 'priced')
})

test('item with no clusters has no costing', () => {
  const items = [
    makeItem({ qty: 1, unit_price: 100 }),
  ]
  const result = computeQuoteProfitability(items)
  assert.equal(result.items[0].hasCosting, false)
  assert.equal(result.hasAnyCosting, false)
})

test('zero revenue item shows NaN margin (handled as N/A)', () => {
  const items = [
    makeItem({
      qty: 0, unit_price: 0,
      clusters: [{ lines: [{ qty: 1, unit_cost: 50 }] }],
    }),
  ]
  const result = computeQuoteProfitability(items)
  assert.equal(result.items[0].revenue, 0)
  assert.equal(result.items[0].cost, 50)
  assert.ok(Number.isNaN(result.items[0].marginPercent))
})

test('negative margin when cost exceeds revenue', () => {
  const items = [
    makeItem({
      qty: 1, unit_price: 50,
      clusters: [{ lines: [{ qty: 1, unit_cost: 80 }] }],
    }),
  ]
  const result = computeQuoteProfitability(items)
  assert.equal(result.totalProfit, -30)
  assert.ok(result.marginPercent < 0)
})

test('aggregate margin excludes items without costing', () => {
  const items = [
    makeItem({
      id: 'costed', qty: 1, unit_price: 200,
      clusters: [{ lines: [{ qty: 1, unit_cost: 100 }] }],
    }),
    makeItem({
      id: 'uncosted', qty: 1, unit_price: 300,
    }),
  ]
  const result = computeQuoteProfitability(items)
  assert.equal(result.totalRevenue, 200)
  assert.equal(result.totalCost, 100)
  assert.equal(result.marginPercent, 50)
})

test('empty items array', () => {
  const result = computeQuoteProfitability([])
  assert.equal(result.totalRevenue, 0)
  assert.equal(result.totalCost, 0)
  assert.equal(result.totalProfit, 0)
  assert.equal(result.hasAnyCosting, false)
  assert.equal(result.items.length, 0)
})

test('multiple costed items aggregate correctly', () => {
  const items = [
    makeItem({
      id: 'a', qty: 1, unit_price: 200, position: 0,
      clusters: [{ lines: [{ qty: 1, unit_cost: 80 }] }],
    }),
    makeItem({
      id: 'b', qty: 2, unit_price: 150, position: 1,
      clusters: [{ lines: [{ qty: 1, unit_cost: 100 }, { qty: 1, unit_cost: 50 }] }],
    }),
  ]
  const result = computeQuoteProfitability(items)
  assert.equal(result.totalRevenue, 500)
  assert.equal(result.totalCost, 230)
  assert.equal(result.totalProfit, 270)
  assert.equal(result.items.length, 2)
})

test('output items preserve input order (position order from fetchQuote)', () => {
  const items = [
    makeItem({
      id: 'first', position: 0, qty: 1, unit_price: 100,
      clusters: [{ lines: [{ qty: 1, unit_cost: 50 }] }],
    }),
    makeItem({
      id: 'second', position: 1, qty: 1, unit_price: 200,
      clusters: [{ lines: [{ qty: 1, unit_cost: 100 }] }],
    }),
  ]
  const result = computeQuoteProfitability(items)
  assert.equal(result.items[0].id, 'first')
  assert.equal(result.items[1].id, 'second')
})
