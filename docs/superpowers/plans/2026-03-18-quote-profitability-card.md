# Quote Profitability Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible profitability card below the Quote Summary on the quote detail page, showing total margin, donut chart, stacked bar, and per-item cost/margin breakdown.

**Architecture:** Pure frontend feature — no DB changes or new API calls. A single new component (`QuoteProfitabilityCard`) computes margin data from the already-loaded `QuoteItem[]` (which includes nested `quote_item_clusters → quote_cluster_lines`). The computation logic lives in a separate pure function file for testability.

**Tech Stack:** React, TypeScript, Tailwind v4, SVG (donut chart), lucide-react icons, `formatCurrency` from `lib/format-utils.ts`

**Spec:** `docs/superpowers/specs/2026-03-18-quote-profitability-card-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `lib/quotes/profitability.ts` (create) | Pure computation: takes `QuoteItem[]`, returns `QuoteProfitability` with per-item and aggregate margin data |
| `tests/quote-profitability.test.ts` (create) | Unit tests for the computation logic |
| `components/features/quotes/QuoteProfitabilityCard.tsx` (create) | React component: collapsible card with donut chart, stacked bar, per-item table |
| `components/quotes/EnhancedQuoteEditor.tsx` (modify) | Add `<QuoteProfitabilityCard>` after the Quote Summary section |

---

### Task 1: Profitability Computation — Types & Pure Function

**Files:**
- Create: `lib/quotes/profitability.ts`
- Create: `tests/quote-profitability.test.ts`

- [ ] **Step 1: Write the test file with all test cases**

Create `tests/quote-profitability.test.ts`:

```typescript
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
  // No clusters property set — defaults to undefined
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
      // no clusters
    }),
  ]
  const result = computeQuoteProfitability(items)
  // Aggregate should only reflect the costed item
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
  // item a: revenue=200, cost=80
  // item b: revenue=300, cost=150
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
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npx tsx --test tests/quote-profitability.test.ts`
Expected: All tests FAIL (module not found)

- [ ] **Step 3: Create the profitability computation module**

Create `lib/quotes/profitability.ts`:

```typescript
import type { QuoteItem } from '@/lib/db/quotes'

export interface ItemProfitability {
  id: string
  description: string
  revenue: number
  cost: number
  profit: number
  marginPercent: number  // NaN when revenue is 0
  hasCosting: boolean
  position: number
}

export interface QuoteProfitability {
  totalRevenue: number
  totalCost: number
  totalProfit: number
  marginPercent: number  // NaN when no costed revenue
  items: ItemProfitability[]
  hasAnyCosting: boolean
}

export function computeQuoteProfitability(items: QuoteItem[]): QuoteProfitability {
  const pricedItems = items.filter(item => item.item_type === 'priced')

  const itemResults: ItemProfitability[] = pricedItems.map(item => {
    const revenue = item.qty * item.unit_price
    let cost = 0
    let hasAnyCostLine = false

    for (const cluster of item.quote_item_clusters ?? []) {
      for (const line of cluster.quote_cluster_lines ?? []) {
        if (line.unit_cost != null) {
          hasAnyCostLine = true
          cost += line.qty * line.unit_cost
        }
      }
    }

    const profit = revenue - cost
    const marginPercent = revenue !== 0 ? (profit / revenue) * 100 : NaN

    return {
      id: item.id,
      description: item.description,
      revenue,
      cost,
      profit,
      marginPercent,
      hasCosting: hasAnyCostLine,
      position: item.position,
    }
  })

  const costedItems = itemResults.filter(i => i.hasCosting)
  const totalRevenue = costedItems.reduce((sum, i) => sum + i.revenue, 0)
  const totalCost = costedItems.reduce((sum, i) => sum + i.cost, 0)
  const totalProfit = totalRevenue - totalCost
  const marginPercent = totalRevenue !== 0 ? (totalProfit / totalRevenue) * 100 : NaN

  return {
    totalRevenue,
    totalCost,
    totalProfit,
    marginPercent,
    items: itemResults,
    hasAnyCosting: costedItems.length > 0,
  }
}
```

- [ ] **Step 4: Run tests to confirm they all pass**

Run: `npx tsx --test tests/quote-profitability.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/quotes/profitability.ts tests/quote-profitability.test.ts
git commit -m "feat(quotes): add profitability computation with tests"
```

---

### Task 2: QuoteProfitabilityCard Component

**Files:**
- Create: `components/features/quotes/QuoteProfitabilityCard.tsx`

**Context:** This is the main UI component. It imports `computeQuoteProfitability` from Task 1, computes margin data via `useMemo`, and renders the collapsible card with donut chart, stacked bar, and per-item table.

**Reference files for styling patterns:**
- `components/quotes/EnhancedQuoteEditor.tsx:422-446` — Quote Summary card styling (match this)
- `lib/format-utils.ts:6` — `formatCurrency()` helper

**@tailwind-v4** — Use Tailwind v4 syntax. Key gotchas: `shadow-sm` not `shadow`, `rounded-sm` not `rounded`, no `bg-opacity-*` (use `/50` modifier).

- [ ] **Step 1: Create the component file**

Create `components/features/quotes/QuoteProfitabilityCard.tsx`:

```tsx
'use client'

import { useMemo, useState } from 'react'
import { ChevronRight, ChevronDown, TrendingUp, AlertTriangle } from 'lucide-react'
import type { QuoteItem } from '@/lib/db/quotes'
import { computeQuoteProfitability } from '@/lib/quotes/profitability'
import { formatCurrency } from '@/lib/format-utils'

interface QuoteProfitabilityCardProps {
  items: QuoteItem[]
}

function DonutChart({ costPercent, marginPercent }: { costPercent: number; marginPercent: number }) {
  const r = 14
  const circumference = 2 * Math.PI * r
  // Clamp cost between 0-100% for visual
  const clampedCost = Math.max(0, Math.min(100, costPercent))
  const clampedMargin = Math.max(0, 100 - clampedCost)
  const costArc = (clampedCost / 100) * circumference
  const marginArc = (clampedMargin / 100) * circumference

  const displayMargin = Number.isNaN(marginPercent) ? 0 : marginPercent
  const isNegative = displayMargin < 0

  return (
    <div className="relative w-16 h-16 flex-shrink-0">
      <svg viewBox="0 0 36 36" className="w-16 h-16" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" className="text-border" strokeWidth="4" />
        <circle
          cx="18" cy="18" r={r} fill="none"
          stroke="#f87171" strokeWidth="4"
          strokeDasharray={`${costArc} ${circumference}`}
          strokeDashoffset="0"
        />
        {clampedMargin > 0 && (
          <circle
            cx="18" cy="18" r={r} fill="none"
            stroke="#4ade80" strokeWidth="4"
            strokeDasharray={`${marginArc} ${circumference}`}
            strokeDashoffset={`${-costArc}`}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-xs font-bold ${isNegative ? 'text-red-400' : 'text-green-400'}`}>
          {displayMargin.toFixed(1)}%
        </span>
      </div>
    </div>
  )
}

function StackedBar({ costPercent }: { costPercent: number }) {
  const clamped = Math.max(0, Math.min(100, costPercent))
  return (
    <div className="h-1.5 rounded-full bg-border overflow-hidden flex">
      <div className="bg-red-400" style={{ width: `${clamped}%` }} />
      <div className="bg-green-400" style={{ width: `${100 - clamped}%` }} />
    </div>
  )
}

export default function QuoteProfitabilityCard({ items }: QuoteProfitabilityCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const profitability = useMemo(() => computeQuoteProfitability(items), [items])

  if (profitability.items.length === 0) return null

  const costPercent = profitability.totalRevenue > 0
    ? (profitability.totalCost / profitability.totalRevenue) * 100
    : 100

  const marginDisplay = Number.isNaN(profitability.marginPercent)
    ? 'N/A'
    : `${profitability.marginPercent.toFixed(1)}%`

  const isNegative = profitability.totalProfit < 0
  const marginColor = isNegative ? 'text-red-400' : 'text-green-400'

  return (
    <section className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-3">
      {/* Collapsed header — always visible */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <TrendingUp size={14} />
          Profitability
        </span>
        {profitability.hasAnyCosting ? (
          <span className={`text-xs font-medium ${marginColor}`}>
            Margin: {marginDisplay} · {formatCurrency(profitability.totalProfit)} profit
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">No cost data</span>
        )}
      </button>

      {/* Expanded content */}
      {isExpanded && profitability.hasAnyCosting && (
        <div className="space-y-4 pt-1">
          {/* Donut + summary numbers */}
          <div className="flex items-center gap-4">
            <DonutChart costPercent={costPercent} marginPercent={profitability.marginPercent} />
            <div className="flex-1 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Revenue</span>
                <span className="font-medium">{formatCurrency(profitability.totalRevenue)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cost</span>
                <span className="font-medium text-red-400">{formatCurrency(profitability.totalCost)}</span>
              </div>
              <div className="flex justify-between border-t border-border/50 pt-1">
                <span className="font-semibold">Profit</span>
                <span className={`font-semibold ${marginColor}`}>{formatCurrency(profitability.totalProfit)}</span>
              </div>
            </div>
          </div>

          {/* Stacked bar */}
          <StackedBar costPercent={costPercent} />

          {/* Per-item breakdown */}
          <div className="space-y-2">
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Per Item</h4>

            {/* Column headers */}
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 text-[10px] text-muted-foreground px-0.5">
              <span />
              <span className="text-right">Sell</span>
              <span className="text-right">Cost</span>
              <span className="text-right">Margin</span>
            </div>

            {/* Item rows */}
            {profitability.items.map(item => {
              const itemCostPercent = item.revenue > 0 ? (item.cost / item.revenue) * 100 : 100
              const hasCosting = item.hasCosting
              const rowOpacity = hasCosting ? '' : 'opacity-50'

              return (
                <div key={item.id} className={`space-y-1 ${rowOpacity}`}>
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 text-xs px-0.5">
                    <span className="truncate flex items-center gap-1">
                      {!hasCosting && <AlertTriangle size={10} className="text-yellow-500 flex-shrink-0" />}
                      {item.description}
                    </span>
                    <span className="text-right tabular-nums">{formatCurrency(item.revenue)}</span>
                    <span className="text-right tabular-nums">
                      {hasCosting ? formatCurrency(item.cost) : '—'}
                    </span>
                    <span className={`text-right tabular-nums ${hasCosting ? (item.marginPercent < 0 ? 'text-red-400' : 'text-green-400') : 'text-muted-foreground'}`}>
                      {!hasCosting
                        ? 'No cost'
                        : Number.isNaN(item.marginPercent)
                          ? 'N/A'
                          : `${item.marginPercent.toFixed(1)}%`
                      }
                    </span>
                  </div>
                  {hasCosting && (
                    <div className="h-1 rounded-full bg-border overflow-hidden flex">
                      <div className="bg-red-400" style={{ width: `${Math.max(0, Math.min(100, itemCostPercent))}%` }} />
                      <div className="bg-green-400" style={{ width: `${Math.max(0, 100 - Math.max(0, Math.min(100, itemCostPercent)))}%` }} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Expanded but no costing data */}
      {isExpanded && !profitability.hasAnyCosting && (
        <p className="text-xs text-muted-foreground pt-1">
          No items have costing data. Add clusters with cost lines to see margin analysis.
        </p>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No new errors from this file (existing unrelated errors may appear)

- [ ] **Step 3: Commit**

```bash
git add components/features/quotes/QuoteProfitabilityCard.tsx
git commit -m "feat(quotes): add QuoteProfitabilityCard component with donut chart and per-item breakdown"
```

---

### Task 3: Integrate into EnhancedQuoteEditor

**Files:**
- Modify: `components/quotes/EnhancedQuoteEditor.tsx`

**Context:** The Quote Summary section ends at line ~446 with `</section>`. The right-column wrapper `</div>` is on line ~447. Insert `<QuoteProfitabilityCard>` between these two lines.

- [ ] **Step 1: Add the import**

At the top of `EnhancedQuoteEditor.tsx`, add after the existing `QuoteItemsTable` import (around line 19):

```typescript
import QuoteProfitabilityCard from '@/components/features/quotes/QuoteProfitabilityCard';
```

- [ ] **Step 2: Render the component**

In `EnhancedQuoteEditor.tsx`, find the closing `</section>` tag of the Quote Summary (the section containing `<Calculator size={14} />` and "Quote Summary"). Immediately after that `</section>`, before the wrapper `</div>`, insert:

```tsx
            <QuoteProfitabilityCard items={items} />
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No new errors from this change

- [ ] **Step 4: Commit**

```bash
git add components/quotes/EnhancedQuoteEditor.tsx
git commit -m "feat(quotes): integrate profitability card into quote editor"
```

---

### Task 4: Visual Verification

**Context:** Use Chrome MCP to verify the component renders correctly on the quote detail page.

- [ ] **Step 1: Navigate to a quote with costing data**

Use `mcp__claude-in-chrome__navigate` to go to a quote detail page (e.g., the quote visible in the screenshot: `http://localhost:3000/quotes/07f573ef-0e95-4837-b82a-5ee53af924a1`). Log in with test account if needed (testai / ClaudeTest2026!).

- [ ] **Step 2: Verify collapsed state renders**

Use `mcp__claude-in-chrome__read_page` to confirm the "Profitability" collapsible row appears below the Quote Summary.

- [ ] **Step 3: Expand and verify full card**

Click the Profitability row and take a screenshot to verify:
- Donut chart renders with correct proportions
- Revenue/Cost/Profit numbers display correctly
- Stacked bar appears
- Per-item rows show (with warning icons on uncosted items if any)

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: No new lint errors

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(quotes): profitability card visual fixes"
```
