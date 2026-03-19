# Quote Reports Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated "Reports" tab to the quote detail page with 5 data-rich sections (health stats, profitability overview, cost composition, per-item breakdown, markup analysis) — all computed client-side from already-loaded quote items, no new API calls.

**Architecture:** A new `lib/quotes/report-data.ts` module extends the existing profitability computation to produce `QuoteReportData` (with per-item cost breakdowns by `line_type`, health stats, and markup derivation). `QuoteReportsTab.tsx` consumes this via `useMemo` and renders five sub-components from `components/features/quotes/reports/`. The existing `QuoteProfitabilityCard` is simplified to a clickable teaser that navigates to the new tab.

**Tech Stack:** Next.js (App Router), React, TypeScript, Tailwind CSS v4, inline SVG charts (no external chart library), `node:test` + `node:assert/strict` for tests.

**Spec:** `docs/superpowers/specs/2026-03-18-quote-reports-tab-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `lib/quotes/report-data.ts` | **Create** | `computeQuoteReportData()` — extended computation returning `QuoteReportData` |
| `tests/quote-report-data.test.ts` | **Create** | Comprehensive unit tests for the computation |
| `components/features/quotes/reports/QuoteHealthBar.tsx` | **Create** | Section 1: 5-stat health bar (full width) |
| `components/features/quotes/reports/ProfitabilityCard.tsx` | **Create** | Section 2: donut + revenue/cost/profit summary + stacked bar |
| `components/features/quotes/reports/CostCompositionCard.tsx` | **Create** | Section 3: 3-segment composition donut + horizontal bars |
| `components/features/quotes/reports/PerItemCostTable.tsx` | **Create** | Section 4: full-width table with mini cost-split bars |
| `components/features/quotes/reports/MarkupAnalysisCard.tsx` | **Create** | Section 5: markup table + waterfall chart |
| `components/features/quotes/QuoteReportsTab.tsx` | **Create** | Tab container: 2-col responsive grid, renders all 5 sections |
| `components/features/quotes/QuoteProfitabilityCard.tsx` | **Modify** | Remove expanded state/content; clicking teaser calls `onNavigateToReports` |
| `components/quotes/EnhancedQuoteEditor.tsx` | **Modify** | Add Reports tab trigger + content; wire `onNavigateToReports` |

---

### Task 1: Report Data Computation (`lib/quotes/report-data.ts` + tests)

**Goal:** Create the extended computation module and its full test suite.

- [ ] Create `lib/quotes/report-data.ts` with the following content:

```typescript
import type { QuoteItem } from '../db/quotes'

export interface CostBreakdown {
  materials: number  // sum of component + manual lines × qty
  labor: number      // sum of labor lines × qty
  overhead: number   // sum of overhead lines × qty
  total: number      // materials + labor + overhead
}

export interface ItemReportData {
  id: string
  description: string
  qty: number
  revenue: number           // qty × unit_price
  costBreakdown: CostBreakdown  // total costs (per-unit × item qty)
  perUnitCost: number       // raw cluster subtotal before item-qty multiplication
  markupAmount: number      // unit_price - perUnitCost (per-unit)
  markupPercent: number     // (markupAmount / perUnitCost) * 100; NaN if perUnitCost is 0
  sellPrice: number         // unit_price
  marginPercent: number     // (revenue - total cost) / revenue × 100; NaN if revenue is 0
  hasCosting: boolean
  position: number
}

export interface QuoteReportData {
  // Overall profitability (only over costed items)
  totalRevenue: number
  totalCost: number
  totalProfit: number
  marginPercent: number    // NaN when no costed revenue

  // Aggregated cost composition (only over costed items)
  costBreakdown: CostBreakdown

  // Per-item detail (all priced items, costed or not)
  items: ItemReportData[]

  hasAnyCosting: boolean

  // Health stats
  totalItems: number
  costedItems: number
  uncostedItems: number
  avgMargin: number                                                     // equals marginPercent (revenue-weighted)
  lowestMarginItem: { description: string; marginPercent: number } | null  // among costed items with revenue > 0
  highestValueItem: { description: string; sellPrice: number } | null  // among costed items
}

export function computeQuoteReportData(items: QuoteItem[]): QuoteReportData {
  const pricedItems = items.filter(item => item.item_type === 'priced')

  const itemResults: ItemReportData[] = pricedItems.map(item => {
    const revenue = item.qty * item.unit_price
    let hasAnyCostLine = false

    // Per-unit cost broken down by line_type
    let perUnitMaterials = 0
    let perUnitLabor = 0
    let perUnitOverhead = 0

    for (const cluster of item.quote_item_clusters ?? []) {
      for (const line of cluster.quote_cluster_lines ?? []) {
        if (line.unit_cost != null) {
          hasAnyCostLine = true
          const lineTotal = line.qty * line.unit_cost
          if (line.line_type === 'component' || line.line_type === 'manual') {
            perUnitMaterials += lineTotal
          } else if (line.line_type === 'labor') {
            perUnitLabor += lineTotal
          } else if (line.line_type === 'overhead') {
            perUnitOverhead += lineTotal
          }
        }
      }
    }

    const perUnitCost = perUnitMaterials + perUnitLabor + perUnitOverhead

    const costBreakdown: CostBreakdown = {
      materials: perUnitMaterials * item.qty,
      labor: perUnitLabor * item.qty,
      overhead: perUnitOverhead * item.qty,
      total: perUnitCost * item.qty,
    }

    const markupAmount = item.unit_price - perUnitCost
    const markupPercent = perUnitCost !== 0 ? (markupAmount / perUnitCost) * 100 : NaN
    const marginPercent = revenue !== 0 ? ((revenue - costBreakdown.total) / revenue) * 100 : NaN

    return {
      id: item.id,
      description: item.description,
      qty: item.qty,
      revenue,
      costBreakdown,
      perUnitCost,
      markupAmount,
      markupPercent,
      sellPrice: item.unit_price,
      marginPercent,
      hasCosting: hasAnyCostLine,
      position: item.position,
    }
  })

  const costedItemResults = itemResults.filter(i => i.hasCosting)

  const totalRevenue = costedItemResults.reduce((sum, i) => sum + i.revenue, 0)
  const totalCost = costedItemResults.reduce((sum, i) => sum + i.costBreakdown.total, 0)
  const totalProfit = totalRevenue - totalCost
  const marginPercent = totalRevenue !== 0 ? (totalProfit / totalRevenue) * 100 : NaN

  const costBreakdown: CostBreakdown = {
    materials: costedItemResults.reduce((sum, i) => sum + i.costBreakdown.materials, 0),
    labor: costedItemResults.reduce((sum, i) => sum + i.costBreakdown.labor, 0),
    overhead: costedItemResults.reduce((sum, i) => sum + i.costBreakdown.overhead, 0),
    total: totalCost,
  }

  // Health stats
  const costedItems = costedItemResults.length
  const totalItems = itemResults.length
  const uncostedItems = totalItems - costedItems

  // Lowest margin: among costed items with valid (non-NaN) margin
  const costedWithMargin = costedItemResults.filter(i => !Number.isNaN(i.marginPercent))
  const lowestMarginItem = costedWithMargin.length > 0
    ? costedWithMargin.reduce((min, i) => i.marginPercent < min.marginPercent ? i : min)
    : null

  // Highest value: among costed items, by sell price
  const highestValueItem = costedItemResults.length > 0
    ? costedItemResults.reduce((max, i) => i.sellPrice > max.sellPrice ? i : max)
    : null

  return {
    totalRevenue,
    totalCost,
    totalProfit,
    marginPercent,
    costBreakdown,
    items: itemResults,
    hasAnyCosting: costedItems > 0,
    totalItems,
    costedItems,
    uncostedItems,
    avgMargin: marginPercent,
    lowestMarginItem: lowestMarginItem
      ? { description: lowestMarginItem.description, marginPercent: lowestMarginItem.marginPercent }
      : null,
    highestValueItem: highestValueItem
      ? { description: highestValueItem.description, sellPrice: highestValueItem.sellPrice }
      : null,
  }
}
```

- [ ] Create `tests/quote-report-data.test.ts` with the following content:

```typescript
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
```

- [ ] Verify tests pass:

```bash
cd /path/to/unity-erp && node --test tests/quote-report-data.test.ts
```

- [ ] Commit:

```bash
git add lib/quotes/report-data.ts tests/quote-report-data.test.ts
git commit -m "feat: add computeQuoteReportData with cost breakdown, markup derivation, health stats"
```

---

### Task 2: QuoteHealthBar Component

**Goal:** Create the full-width 5-stat health bar for the top of the Reports tab.

- [ ] Create `components/features/quotes/reports/QuoteHealthBar.tsx`:

```tsx
'use client'

import type { QuoteReportData } from '@/lib/quotes/report-data'

interface QuoteHealthBarProps {
  data: QuoteReportData
}

function StatCard({
  label,
  value,
  valueClass = 'text-white',
}: {
  label: string
  value: React.ReactNode
  valueClass?: string
}) {
  return (
    <div className="flex-1 rounded-sm bg-[#12141c] border border-border/40 px-4 py-3 flex flex-col gap-1 min-w-0">
      <span className={`text-xl font-bold tabular-nums truncate ${valueClass}`}>{value}</span>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
    </div>
  )
}

export default function QuoteHealthBar({ data }: QuoteHealthBarProps) {
  const { totalItems, costedItems, uncostedItems, avgMargin, lowestMarginItem } = data

  // Traffic light for avg margin
  const marginDotColor =
    Number.isNaN(avgMargin) ? '#6b7280'
    : avgMargin >= 30 ? '#4ade80'
    : avgMargin >= 15 ? '#fbbf24'
    : '#f87171'

  const marginDisplay = Number.isNaN(avgMargin) ? 'N/A' : `${avgMargin.toFixed(1)}%`
  const marginValueClass =
    Number.isNaN(avgMargin) ? 'text-muted-foreground'
    : avgMargin >= 30 ? 'text-green-400'
    : avgMargin >= 15 ? 'text-amber-400'
    : 'text-red-400'

  const missingValueClass = uncostedItems === 0 ? 'text-green-400' : 'text-amber-400'

  return (
    <div className="flex gap-3">
      <StatCard
        label="Line Items"
        value={totalItems}
      />
      <StatCard
        label="Costed"
        value={costedItems}
        valueClass="text-green-400"
      />
      <StatCard
        label="Missing Cost"
        value={uncostedItems}
        valueClass={missingValueClass}
      />
      <StatCard
        label="Avg Margin"
        value={
          <span className="flex items-center gap-2">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{
                backgroundColor: marginDotColor,
                boxShadow: `0 0 6px ${marginDotColor}`,
              }}
            />
            {marginDisplay}
          </span>
        }
        valueClass={marginValueClass}
      />
      <StatCard
        label="Lowest Margin"
        value={
          lowestMarginItem
            ? `${lowestMarginItem.marginPercent.toFixed(1)}%`
            : '—'
        }
      />
    </div>
  )
}
```

- [ ] Commit:

```bash
git add components/features/quotes/reports/QuoteHealthBar.tsx
git commit -m "feat: add QuoteHealthBar stats component"
```

---

### Task 3: ProfitabilityCard Component

**Goal:** Donut chart + revenue/cost/profit summary + stacked bar, left card in the 2-col grid.

- [ ] Create `components/features/quotes/reports/ProfitabilityCard.tsx`:

```tsx
'use client'

import type { QuoteReportData } from '@/lib/quotes/report-data'
import { formatCurrency } from '@/lib/format-utils'

interface ProfitabilityCardProps {
  data: QuoteReportData
}

function DonutChart({
  costPercent,
  marginPercent,
}: {
  costPercent: number
  marginPercent: number
}) {
  const r = 52
  const circumference = 2 * Math.PI * r
  const clampedCost = Math.max(0, Math.min(100, costPercent))
  const clampedMargin = Math.max(0, 100 - clampedCost)
  const costArc = (clampedCost / 100) * circumference
  const marginArc = (clampedMargin / 100) * circumference

  const displayMargin = Number.isNaN(marginPercent) ? 0 : marginPercent
  const isNegative = displayMargin < 0

  return (
    <div className="relative w-[120px] h-[120px] flex-shrink-0">
      <svg viewBox="0 0 120 120" className="w-[120px] h-[120px]" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="currentColor" className="text-border" strokeWidth="3" />
        <circle
          cx="60" cy="60" r={r} fill="none"
          stroke="#f87171" strokeWidth="3"
          strokeDasharray={`${costArc} ${circumference}`}
          strokeDashoffset="0"
        />
        {clampedMargin > 0 && (
          <circle
            cx="60" cy="60" r={r} fill="none"
            stroke="#4ade80" strokeWidth="3"
            strokeDasharray={`${marginArc} ${circumference}`}
            strokeDashoffset={`${-costArc}`}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-base font-bold leading-none ${isNegative ? 'text-red-400' : 'text-green-400'}`}>
          {Number.isNaN(marginPercent) ? 'N/A' : `${displayMargin.toFixed(1)}%`}
        </span>
        <span className="text-[10px] text-muted-foreground mt-0.5">margin</span>
      </div>
    </div>
  )
}

export default function ProfitabilityCard({ data }: ProfitabilityCardProps) {
  if (!data.hasAnyCosting) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/30 p-4 flex flex-col gap-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Profitability Overview
        </h3>
        <p className="text-xs text-muted-foreground">No cost data available.</p>
      </div>
    )
  }

  const costPercent =
    data.totalRevenue > 0
      ? (data.totalCost / data.totalRevenue) * 100
      : 100

  const marginPercent = data.marginPercent
  const isNegative = data.totalProfit < 0
  const clampedCost = Math.max(0, Math.min(100, costPercent))

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-4 flex flex-col gap-4">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Profitability Overview
      </h3>

      <div className="flex items-center gap-4">
        <DonutChart costPercent={costPercent} marginPercent={marginPercent} />
        <div className="flex-1 space-y-1.5 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Revenue</span>
            <span className="font-medium tabular-nums">{formatCurrency(data.totalRevenue)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Total Cost</span>
            <span className="font-medium text-red-400 tabular-nums">{formatCurrency(data.totalCost)}</span>
          </div>
          <div className="flex justify-between items-center border-t border-border/50 pt-1.5">
            <span className="font-semibold">Gross Profit</span>
            <span className={`font-bold tabular-nums ${isNegative ? 'text-red-400' : 'text-green-400'}`}>
              {formatCurrency(data.totalProfit)}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="h-2 rounded-sm bg-border overflow-hidden flex">
          <div className="bg-red-400 h-full" style={{ width: `${clampedCost}%` }} />
          <div className="bg-green-400 h-full" style={{ width: `${Math.max(0, 100 - clampedCost)}%` }} />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-red-400" />
            Cost {clampedCost.toFixed(1)}%
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-green-400" />
            Margin {Math.max(0, 100 - clampedCost).toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] Commit:

```bash
git add components/features/quotes/reports/ProfitabilityCard.tsx
git commit -m "feat: add ProfitabilityCard with 120px donut chart and stacked bar"
```

---

### Task 4: CostCompositionCard Component

**Goal:** 3-segment donut + horizontal bar breakdown for materials/labor/overhead.

- [ ] Create `components/features/quotes/reports/CostCompositionCard.tsx`:

```tsx
'use client'

import type { QuoteReportData } from '@/lib/quotes/report-data'
import { formatCurrency } from '@/lib/format-utils'

interface CostCompositionCardProps {
  data: QuoteReportData
}

const COLORS = {
  materials: '#60a5fa',
  labor: '#c084fc',
  overhead: '#fbbf24',
} as const

function CompositionDonut({
  materials,
  labor,
  overhead,
  total,
}: {
  materials: number
  labor: number
  overhead: number
  total: number
}) {
  const r = 52
  const circumference = 2 * Math.PI * r

  const mPct = total > 0 ? materials / total : 0
  const lPct = total > 0 ? labor / total : 0
  const oPct = total > 0 ? overhead / total : 0

  const mArc = mPct * circumference
  const lArc = lPct * circumference
  const oArc = oPct * circumference

  return (
    <div className="relative w-[120px] h-[120px] flex-shrink-0">
      <svg viewBox="0 0 120 120" className="w-[120px] h-[120px]" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="currentColor" className="text-border" strokeWidth="3" />
        {/* Materials segment */}
        {mArc > 0 && (
          <circle
            cx="60" cy="60" r={r} fill="none"
            stroke={COLORS.materials} strokeWidth="3"
            strokeDasharray={`${mArc} ${circumference}`}
            strokeDashoffset="0"
          />
        )}
        {/* Labor segment */}
        {lArc > 0 && (
          <circle
            cx="60" cy="60" r={r} fill="none"
            stroke={COLORS.labor} strokeWidth="3"
            strokeDasharray={`${lArc} ${circumference}`}
            strokeDashoffset={`${-mArc}`}
          />
        )}
        {/* Overhead segment */}
        {oArc > 0 && (
          <circle
            cx="60" cy="60" r={r} fill="none"
            stroke={COLORS.overhead} strokeWidth="3"
            strokeDasharray={`${oArc} ${circumference}`}
            strokeDashoffset={`${-(mArc + lArc)}`}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-bold text-white leading-none">{formatCurrency(total)}</span>
        <span className="text-[10px] text-muted-foreground mt-0.5">total cost</span>
      </div>
    </div>
  )
}

interface HorizBarProps {
  label: string
  value: number
  total: number
  color: string
}

function HorizBar({ label, value, total, color }: HorizBarProps) {
  const pct = total > 0 ? (value / total) * 100 : 0
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
          {label}
        </span>
        <span className="tabular-nums text-muted-foreground">
          {pct.toFixed(1)}% · {formatCurrency(value)}
        </span>
      </div>
      <div className="h-2 rounded-sm bg-border overflow-hidden">
        <div className="h-full rounded-sm" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

export default function CostCompositionCard({ data }: CostCompositionCardProps) {
  if (!data.hasAnyCosting) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/30 p-4 flex flex-col gap-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Cost Composition
        </h3>
        <p className="text-xs text-muted-foreground">No cost data available.</p>
      </div>
    )
  }

  const { materials, labor, overhead, total } = data.costBreakdown

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-4 flex flex-col gap-4">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Cost Composition
      </h3>

      <div className="flex items-center gap-4">
        <CompositionDonut materials={materials} labor={labor} overhead={overhead} total={total} />
        <div className="flex-1 space-y-3">
          <HorizBar label="Materials" value={materials} total={total} color={COLORS.materials} />
          <HorizBar label="Labor" value={labor} total={total} color={COLORS.labor} />
          <HorizBar label="Overhead" value={overhead} total={total} color={COLORS.overhead} />
        </div>
      </div>
    </div>
  )
}
```

- [ ] Commit:

```bash
git add components/features/quotes/reports/CostCompositionCard.tsx
git commit -m "feat: add CostCompositionCard with 3-segment donut and horizontal bars"
```

---

### Task 5: PerItemCostTable Component

**Goal:** Full-width table with per-item cost breakdown by category and mini stacked bars.

- [ ] Create `components/features/quotes/reports/PerItemCostTable.tsx`:

```tsx
'use client'

import { AlertTriangle } from 'lucide-react'
import type { ItemReportData } from '@/lib/quotes/report-data'
import { formatCurrency } from '@/lib/format-utils'

interface PerItemCostTableProps {
  items: ItemReportData[]
}

function MiniCostBar({
  materials,
  labor,
  overhead,
}: {
  materials: number
  labor: number
  overhead: number
}) {
  const total = materials + labor + overhead
  if (total === 0) return <div className="h-1.5 rounded-sm bg-border w-full" />

  const mPct = (materials / total) * 100
  const lPct = (labor / total) * 100
  const oPct = (overhead / total) * 100

  return (
    <div className="h-1.5 rounded-sm overflow-hidden flex w-full">
      <div style={{ width: `${mPct}%`, backgroundColor: '#60a5fa' }} />
      <div style={{ width: `${lPct}%`, backgroundColor: '#c084fc' }} />
      <div style={{ width: `${oPct}%`, backgroundColor: '#fbbf24' }} />
    </div>
  )
}

export default function PerItemCostTable({ items }: PerItemCostTableProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/30 p-4">
        <p className="text-xs text-muted-foreground">No priced items.</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Per-Item Cost Breakdown
      </h3>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] text-muted-foreground border-b border-border/50">
              <th className="text-left font-semibold uppercase tracking-wider pb-2 pr-3">Item</th>
              <th className="text-right font-semibold uppercase tracking-wider pb-2 px-2">
                <span className="flex items-center justify-end gap-1">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#60a5fa' }} />
                  Materials
                </span>
              </th>
              <th className="text-right font-semibold uppercase tracking-wider pb-2 px-2">
                <span className="flex items-center justify-end gap-1">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#c084fc' }} />
                  Labor
                </span>
              </th>
              <th className="text-right font-semibold uppercase tracking-wider pb-2 px-2">
                <span className="flex items-center justify-end gap-1">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#fbbf24' }} />
                  Overhead
                </span>
              </th>
              <th className="text-right font-semibold uppercase tracking-wider pb-2 px-2">Total Cost</th>
              <th className="text-right font-semibold uppercase tracking-wider pb-2 px-2">Sell Price</th>
              <th className="text-right font-semibold uppercase tracking-wider pb-2 px-2">Margin</th>
              <th className="text-right font-semibold uppercase tracking-wider pb-2 pl-2">Cost Split</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {items.map(item => {
              const hasCosting = item.hasCosting
              const rowClass = hasCosting ? '' : 'opacity-50'
              const marginDisplay = !hasCosting
                ? 'No cost'
                : Number.isNaN(item.marginPercent)
                  ? 'N/A'
                  : `${item.marginPercent.toFixed(1)}%`
              const marginClass = !hasCosting
                ? 'text-muted-foreground'
                : item.marginPercent < 0
                  ? 'text-red-400'
                  : 'text-green-400'

              return (
                <tr key={item.id} className={rowClass}>
                  <td className="py-2 pr-3 max-w-[180px]">
                    <span className="flex items-center gap-1.5 truncate">
                      {!hasCosting && (
                        <AlertTriangle size={11} className="text-yellow-500 flex-shrink-0" />
                      )}
                      <span className="truncate">{item.description}</span>
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {hasCosting ? formatCurrency(item.costBreakdown.materials) : '—'}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {hasCosting ? formatCurrency(item.costBreakdown.labor) : '—'}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {hasCosting ? formatCurrency(item.costBreakdown.overhead) : '—'}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums font-medium">
                    {hasCosting ? formatCurrency(item.costBreakdown.total) : '—'}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {formatCurrency(item.sellPrice)}
                  </td>
                  <td className={`py-2 px-2 text-right tabular-nums ${marginClass}`}>
                    {marginDisplay}
                  </td>
                  <td className="py-2 pl-2 w-[80px]">
                    {hasCosting ? (
                      <MiniCostBar
                        materials={item.costBreakdown.materials}
                        labor={item.costBreakdown.labor}
                        overhead={item.costBreakdown.overhead}
                      />
                    ) : (
                      <div className="h-1.5 rounded-sm bg-border w-full" />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] Commit:

```bash
git add components/features/quotes/reports/PerItemCostTable.tsx
git commit -m "feat: add PerItemCostTable with per-category columns and mini cost-split bars"
```

---

### Task 6: MarkupAnalysisCard Component

**Goal:** Markup table with colored badges (left half) + waterfall chart for highest-value item (right half).

- [ ] Create `components/features/quotes/reports/MarkupAnalysisCard.tsx`:

```tsx
'use client'

import type { ItemReportData } from '@/lib/quotes/report-data'
import { formatCurrency } from '@/lib/format-utils'

interface MarkupAnalysisCardProps {
  items: ItemReportData[]
}

function MarkupBadge({ markupPercent }: { markupPercent: number }) {
  if (Number.isNaN(markupPercent)) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-[10px] font-semibold bg-muted text-muted-foreground">
        N/A
      </span>
    )
  }
  const [bg, text] =
    markupPercent >= 40
      ? ['bg-green-500/20 text-green-400', '']
      : markupPercent >= 20
        ? ['bg-amber-500/20 text-amber-400', '']
        : ['bg-red-500/20 text-red-400', '']

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-[10px] font-semibold ${bg}`}>
      {markupPercent.toFixed(1)}%
    </span>
  )
}

function WaterfallChart({ item }: { item: ItemReportData }) {
  const rawCost = item.perUnitCost
  const markup = item.markupAmount
  const sellPrice = item.sellPrice

  const maxVal = Math.max(rawCost, markup, sellPrice, 1)
  const rawH = Math.round((rawCost / maxVal) * 160)
  const markupH = Math.round((Math.max(0, markup) / maxVal) * 160)
  const sellH = Math.round((sellPrice / maxVal) * 160)

  return (
    <div className="flex flex-col h-full">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        Price Build-up · <span className="normal-case font-normal truncate max-w-[180px] inline-block align-bottom">{item.description}</span>
      </p>
      <div className="flex items-end gap-6 flex-1 pb-2" style={{ minHeight: '200px' }}>
        {/* Raw Cost bar */}
        <div className="flex flex-col items-center gap-1 flex-1">
          <span className="text-[10px] text-muted-foreground tabular-nums">{formatCurrency(rawCost)}</span>
          <div
            className="w-full rounded-t-sm"
            style={{
              height: `${rawH}px`,
              background: 'linear-gradient(to top, #dc2626, #f87171)',
              minHeight: '8px',
            }}
          />
          <span className="text-[10px] text-muted-foreground mt-1">Raw Cost</span>
        </div>

        <div className="self-center text-muted-foreground text-sm pb-6">→</div>

        {/* Markup bar */}
        <div className="flex flex-col items-center gap-1 flex-1">
          <span className="text-[10px] text-muted-foreground tabular-nums">{formatCurrency(Math.max(0, markup))}</span>
          <div
            className="w-full rounded-t-sm"
            style={{
              height: `${markupH}px`,
              background: 'linear-gradient(to top, #d97706, #fbbf24)',
              minHeight: '8px',
            }}
          />
          <span className="text-[10px] text-muted-foreground mt-1">Markup</span>
        </div>

        <div className="self-center text-muted-foreground text-sm pb-6">=</div>

        {/* Sell Price bar */}
        <div className="flex flex-col items-center gap-1 flex-1">
          <span className="text-[10px] text-muted-foreground tabular-nums">{formatCurrency(sellPrice)}</span>
          <div
            className="w-full rounded-t-sm"
            style={{
              height: `${sellH}px`,
              background: 'linear-gradient(to top, #16a34a, #4ade80)',
              minHeight: '8px',
            }}
          />
          <span className="text-[10px] text-muted-foreground mt-1">Sell Price</span>
        </div>
      </div>
    </div>
  )
}

export default function MarkupAnalysisCard({ items }: MarkupAnalysisCardProps) {
  const costedItems = items.filter(i => i.hasCosting)

  if (costedItems.length === 0) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Markup Analysis
        </h3>
        <p className="text-xs text-muted-foreground">No costed items to analyse.</p>
      </div>
    )
  }

  const highestValueItem = costedItems.reduce((max, i) => i.sellPrice > max.sellPrice ? i : max)

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Markup Analysis
      </h3>

      <div className="grid grid-cols-2 gap-6">
        {/* Left: Markup table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-muted-foreground border-b border-border/50">
                <th className="text-left font-semibold uppercase tracking-wider pb-2 pr-3">Item</th>
                <th className="text-right font-semibold uppercase tracking-wider pb-2 px-2">Raw Cost</th>
                <th className="text-right font-semibold uppercase tracking-wider pb-2 px-2">Markup</th>
                <th className="text-right font-semibold uppercase tracking-wider pb-2 px-2">Sell Price</th>
                <th className="text-right font-semibold uppercase tracking-wider pb-2 pl-2">Markup %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {items.map(item => (
                <tr key={item.id} className={item.hasCosting ? '' : 'opacity-40'}>
                  <td className="py-2 pr-3 max-w-[120px]">
                    <span className="truncate block">{item.description}</span>
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {item.hasCosting ? formatCurrency(item.perUnitCost) : '—'}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {item.hasCosting ? formatCurrency(item.markupAmount) : '—'}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {formatCurrency(item.sellPrice)}
                  </td>
                  <td className="py-2 pl-2 text-right">
                    {item.hasCosting ? (
                      <MarkupBadge markupPercent={item.markupPercent} />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Right: Waterfall chart */}
        <WaterfallChart item={highestValueItem} />
      </div>
    </div>
  )
}
```

- [ ] Commit:

```bash
git add components/features/quotes/reports/MarkupAnalysisCard.tsx
git commit -m "feat: add MarkupAnalysisCard with markup table and waterfall chart"
```

---

### Task 7: QuoteReportsTab + Integration

**Goal:** Wire everything together — create the tab container, modify `QuoteProfitabilityCard`, and update `EnhancedQuoteEditor`.

#### Step 7a — Create QuoteReportsTab

- [ ] Create `components/features/quotes/QuoteReportsTab.tsx`:

```tsx
'use client'

import { useMemo } from 'react'
import type { QuoteItem } from '@/lib/db/quotes'
import { computeQuoteReportData } from '@/lib/quotes/report-data'
import QuoteHealthBar from './reports/QuoteHealthBar'
import ProfitabilityCard from './reports/ProfitabilityCard'
import CostCompositionCard from './reports/CostCompositionCard'
import PerItemCostTable from './reports/PerItemCostTable'
import MarkupAnalysisCard from './reports/MarkupAnalysisCard'

interface QuoteReportsTabProps {
  items: QuoteItem[]
}

export default function QuoteReportsTab({ items }: QuoteReportsTabProps) {
  const data = useMemo(() => computeQuoteReportData(items), [items])

  return (
    <div className="space-y-4">
      {/* Section 1: Health bar (full width) */}
      <QuoteHealthBar data={data} />

      {/* Sections 2 + 3: 2-col grid */}
      <div className="grid grid-cols-1 gap-4 [&:has([data-col])]:grid-cols-2 md:grid-cols-2">
        <ProfitabilityCard data={data} />
        <CostCompositionCard data={data} />
      </div>

      {/* Section 4: Per-item table (full width) */}
      <PerItemCostTable items={data.items} />

      {/* Section 5: Markup analysis (full width) */}
      <MarkupAnalysisCard items={data.items} />
    </div>
  )
}
```

#### Step 7b — Modify QuoteProfitabilityCard

- [ ] Open `components/features/quotes/QuoteProfitabilityCard.tsx` and replace its entire contents with the simplified version below. The key changes are: remove `isExpanded` state and all expanded content (DonutChart, StackedBar, per-item table); add `onNavigateToReports` prop; clicking the teaser button calls `onNavigateToReports` instead of toggling expansion.

```tsx
'use client'

import { useMemo } from 'react'
import { ChevronRight, TrendingUp } from 'lucide-react'
import type { QuoteItem } from '@/lib/db/quotes'
import { computeQuoteProfitability } from '@/lib/quotes/profitability'
import { formatCurrency } from '@/lib/format-utils'

interface QuoteProfitabilityCardProps {
  items: QuoteItem[]
  onNavigateToReports: () => void
}

export default function QuoteProfitabilityCard({
  items,
  onNavigateToReports,
}: QuoteProfitabilityCardProps) {
  const profitability = useMemo(() => computeQuoteProfitability(items), [items])

  if (profitability.items.length === 0) return null

  const marginDisplay = Number.isNaN(profitability.marginPercent)
    ? 'N/A'
    : `${profitability.marginPercent.toFixed(1)}%`

  const isNegative = profitability.totalProfit < 0
  const marginColor = isNegative ? 'text-red-400' : 'text-green-400'

  return (
    <section className="rounded-lg border border-border/50 bg-muted/30 p-4">
      <button
        type="button"
        onClick={onNavigateToReports}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <ChevronRight size={14} />
          <TrendingUp size={14} />
          Profitability
        </span>
        {profitability.hasAnyCosting ? (
          <span className={`text-xs font-medium ${marginColor}`}>
            Margin: {marginDisplay} · {formatCurrency(profitability.totalProfit)} profit
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">No cost data · View Reports</span>
        )}
      </button>
    </section>
  )
}
```

#### Step 7c — Modify EnhancedQuoteEditor

- [ ] In `components/quotes/EnhancedQuoteEditor.tsx`, add the import for `QuoteReportsTab` alongside the other feature imports (near the top of the file):

```typescript
import QuoteReportsTab from '@/components/features/quotes/QuoteReportsTab'
```

- [ ] Change `grid-cols-3` to `grid-cols-4` on the `TabsList` and add the Reports trigger. Find this block:

```tsx
<TabsList className="grid w-full grid-cols-3">
  <TabsTrigger value="details">Quote Details</TabsTrigger>
  <TabsTrigger value="items">Line Items</TabsTrigger>
  <TabsTrigger value="attachments">Attachments</TabsTrigger>
</TabsList>
```

Replace with:

```tsx
<TabsList className="grid w-full grid-cols-4">
  <TabsTrigger value="details">Quote Details</TabsTrigger>
  <TabsTrigger value="items">Line Items</TabsTrigger>
  <TabsTrigger value="attachments">Attachments</TabsTrigger>
  <TabsTrigger value="reports">Reports</TabsTrigger>
</TabsList>
```

- [ ] Add `TabsContent` for the reports tab immediately after the attachments `TabsContent` block (before the closing `</Tabs>`):

```tsx
<TabsContent value="reports" className="space-y-4">
  <QuoteReportsTab items={items} />
</TabsContent>
```

- [ ] Wire `onNavigateToReports` into the existing `QuoteProfitabilityCard` usage. Find the existing usage (it will be inside the `details` tab content). Add the prop:

```tsx
<QuoteProfitabilityCard
  items={items}
  onNavigateToReports={() => setActiveTab('reports')}
/>
```

- [ ] Commit:

```bash
git add components/features/quotes/QuoteReportsTab.tsx \
        components/features/quotes/QuoteProfitabilityCard.tsx \
        components/quotes/EnhancedQuoteEditor.tsx
git commit -m "feat: add QuoteReportsTab, wire Reports tab into EnhancedQuoteEditor, simplify ProfitabilityCard"
```

---

### Task 8: Visual Verification

**Goal:** Confirm the Reports tab renders correctly in Chrome with no runtime errors.

- [ ] Run lint:

```bash
cd /path/to/unity-erp && npm run lint
```

- [ ] Run TypeScript check on the touched area:

```bash
npx tsc --noEmit
```

  If unrelated pre-existing errors block a clean run, report them but do not treat them as failures of this task.

- [ ] Open Chrome and navigate to a quote with costed items. Confirm:
  - 4 tabs are visible: Quote Details / Line Items / Attachments / Reports
  - Clicking "Reports" tab renders all 5 sections without errors
  - QuoteHealthBar shows correct counts and traffic-light dot
  - ProfitabilityCard donut chart renders with correct margin
  - CostCompositionCard shows 3-segment donut and horizontal bars
  - PerItemCostTable shows each priced item; uncosted rows are dimmed with ⚠ icon
  - MarkupAnalysisCard shows markup table with colored badges and a waterfall chart for the highest-value item
  - Clicking the Profitability teaser on the Details tab navigates to the Reports tab

- [ ] Take a screenshot of the Reports tab as proof.

- [ ] Final commit (if any lint/type fixes were applied):

```bash
git add -A
git commit -m "fix: address lint/type issues in quote reports tab"
```

---

## Key Implementation Notes

### Tailwind v4 Patterns

- Use `shadow-sm` (not `shadow`), `rounded-sm` (not `rounded`), `ring-3` (not `ring`).
- No `bg-opacity-*` — use `/50` modifier: `bg-muted/30`, `border-border/50`.
- Dark stat card bg: `bg-[#12141c]` (literal hex, no CSS var needed for this specific value).

### SVG Donut Construction

Both donuts use the same pattern from the existing `QuoteProfitabilityCard`:
- `viewBox="0 0 120 120"`, `r=52`, `strokeWidth="3"`, `rotate(-90deg)` on the SVG element
- First segment: `strokeDashoffset="0"`
- Subsequent segments: `strokeDashoffset={-(sum of previous arcs)}`
- The base track circle uses `stroke="currentColor"` with `className="text-border"`

### RLS Null-Guard

Always use `item.quote_item_clusters ?? []` and `cluster.quote_cluster_lines ?? []` — nested Supabase relations can be `null` when RLS filters out related rows.

### Currency

All currency output uses `formatCurrency(value)` from `@/lib/format-utils`. This outputs `R x.xx` format.

### Items Ordering

`computeQuoteReportData` preserves input order (same order as `items` prop, which comes from `fetchQuote` already sorted by `position`). No re-sorting needed in components.
