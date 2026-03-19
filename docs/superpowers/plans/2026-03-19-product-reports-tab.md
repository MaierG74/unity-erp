# Product Reports Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Reports" tab to the product detail page that shows profitability, BOM cost composition, order history, and margin trend using server-fetched order data combined with current BOM cost.
**Architecture:** A new GET API route fetches `order_details` (with nested order/customer) plus BOM cost via `getProductCostSummary`; a `useProductReports` hook wraps it with react-query and handles period filtering; five child components render the data as stat cards, donut charts, a table, and an SVG sparkline — all pure props-driven with no internal data fetching.
**Tech Stack:** Next.js App Router API route, `@tanstack/react-query`, Tailwind v4, inline SVG charts, `supabaseAdmin` with explicit org filtering, `authorizedFetch`, `formatCurrency`
**Spec:** `docs/superpowers/specs/2026-03-19-product-reports-tab-design.md`

---

## Task 1: API Endpoint

**File:** `app/api/products/[productId]/reports/route.ts`

Create the GET endpoint that returns `{ bomCost, orders }`.

- [ ] Create directory `app/api/products/[productId]/reports/` and file `route.ts`
- [ ] Copy `requireProductsAccess` helper verbatim from `effective-bom/route.ts` (uses `requireModuleAccess(request, MODULE_KEYS.PRODUCTS_BOM)`)
- [ ] Parse `period` query param and compute `periodStart` ISO string (or null for `'all'`)
- [ ] Query `order_details` via `supabaseAdmin` with explicit org filter, cancel exclusion, and optional period filter
- [ ] Call `getProductCostSummary()` from `lib/assistant/costing.ts` with `supabaseAdmin`, the product's `internal_code` (resolve product first), and `{ origin, authorizationHeader }` from the request
- [ ] Map `getProductCostSummary` result to `bomCost` shape; return 200 or propagate errors
- [ ] Commit: `git commit -m "feat(products): add /api/products/[productId]/reports endpoint"`

```typescript
// app/api/products/[productId]/reports/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/api/module-access'
import { MODULE_KEYS } from '@/lib/modules/keys'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getProductCostSummary } from '@/lib/assistant/costing'

async function requireProductsAccess(request: NextRequest) {
  const access = await requireModuleAccess(request, MODULE_KEYS.PRODUCTS_BOM, {
    forbiddenMessage: 'Products module access is disabled for your organization',
  })
  if ('error' in access) return { error: access.error }
  if (!access.orgId) {
    return {
      error: NextResponse.json(
        { error: 'Organization context is required', reason: 'missing_org_context' },
        { status: 403 }
      ),
    }
  }
  return { orgId: access.orgId }
}

type Period = '7d' | '30d' | '90d' | '365d' | 'all'

function getPeriodStart(period: Period): string | null {
  if (period === 'all') return null
  const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 365
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10) // YYYY-MM-DD
}

export async function GET(req: NextRequest, context: { params: Promise<{ productId: string }> }) {
  const auth = await requireProductsAccess(req)
  if ('error' in auth) return auth.error

  try {
    const { productId: productIdParam } = await context.params
    const productId = Number(productIdParam)
    if (!Number.isFinite(productId)) {
      return NextResponse.json({ error: 'Invalid productId' }, { status: 400 })
    }

    const url = new URL(req.url)
    const periodRaw = url.searchParams.get('period') ?? 'all'
    const period: Period = ['7d', '30d', '90d', '365d', 'all'].includes(periodRaw)
      ? (periodRaw as Period)
      : 'all'
    const periodStart = getPeriodStart(period)

    // Verify product belongs to this org
    const { data: product, error: productErr } = await supabaseAdmin
      .from('products')
      .select('product_id, internal_code')
      .eq('product_id', productId)
      .eq('org_id', auth.orgId)
      .maybeSingle()
    if (productErr || !product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    // Build order_details query
    let query = supabaseAdmin
      .from('order_details')
      .select(`
        order_detail_id,
        order_id,
        quantity,
        unit_price,
        order:orders!inner(order_number, status, order_date, customer:customers(name))
      `)
      .eq('product_id', productId)
      .eq('order.org_id', auth.orgId)
      .not('order.status', 'eq', 'cancelled')
      .order('order.order_date', { ascending: false })

    if (periodStart) {
      query = query.gte('order.order_date', periodStart)
    }

    const { data: rawOrders, error: ordersErr } = await query
    if (ordersErr) throw ordersErr

    // Get BOM cost via getProductCostSummary (passes auth through to internal API routes)
    const origin = `${url.protocol}//${url.host}`
    const authorizationHeader = req.headers.get('authorization')
    const productRef = product.internal_code ?? String(productId)
    const costSummary = await getProductCostSummary(supabaseAdmin, productRef, {
      origin,
      authorizationHeader,
    })

    let bomCost = { materials: 0, labor: 0, overhead: 0, total: 0, missingPrices: 0 }
    if (costSummary.kind === 'summary') {
      bomCost = {
        materials: costSummary.materials_cost,
        labor: costSummary.labor_cost,
        overhead: costSummary.overhead_cost,
        total: costSummary.total_cost,
        missingPrices: costSummary.missing_material_prices,
      }
    }

    const orders = (rawOrders ?? []).map((row: any) => ({
      orderDetailId: row.order_detail_id,
      orderId: row.order_id,
      orderNumber: row.order?.order_number ?? null,
      customerName: row.order?.customer?.name ?? null,
      date: row.order?.order_date ?? null,
      quantity: Number(row.quantity),
      unitPrice: Number(row.unit_price),
    }))

    return NextResponse.json({ bomCost, orders })
  } catch (err) {
    console.error('product-reports error:', err)
    return NextResponse.json({ error: 'Failed to load product reports' }, { status: 500 })
  }
}
```

---

## Task 2: Client Hook

**File:** `hooks/useProductReports.ts`

Fetches report data, manages loading/error, and computes client-side profitability metrics.

- [ ] Create `hooks/useProductReports.ts`
- [ ] Use `useQuery` from `@tanstack/react-query` with `authorizedFetch`; include both `productId` and `period` in the query key so changing period triggers a refetch
- [ ] Define and export `OrderProfitability` type (raw order row + computed revenue/cost/profit/margin)
- [ ] Define and export `ProductReportData` type (aggregated stats + typed order array)
- [ ] Compute per-order and aggregate stats client-side; guard against division by zero (NaN margin when revenue is 0)
- [ ] Commit: `git commit -m "feat(products): add useProductReports hook"`

```typescript
// hooks/useProductReports.ts
'use client'

import { useQuery } from '@tanstack/react-query'
import { authorizedFetch } from '@/lib/client/auth-fetch'

export type ReportPeriod = '7d' | '30d' | '90d' | '365d' | 'all'

export interface RawOrderRow {
  orderDetailId: number
  orderId: number
  orderNumber: string | null
  customerName: string | null
  date: string | null
  quantity: number
  unitPrice: number
}

export interface BomCost {
  materials: number
  labor: number
  overhead: number
  total: number
  missingPrices: number
}

export interface OrderProfitability extends RawOrderRow {
  revenue: number
  cost: number
  profit: number
  marginPercent: number  // NaN when revenue === 0
}

export interface ProductReportStats {
  totalOrders: number       // distinct order IDs
  totalUnitsSold: number
  totalRevenue: number
  totalCost: number
  totalProfit: number
  avgMargin: number         // NaN when totalRevenue === 0
}

export interface ProductReportData {
  bomCost: BomCost
  orders: OrderProfitability[]
  stats: ProductReportStats
}

interface ApiResponse {
  bomCost: BomCost
  orders: RawOrderRow[]
}

function computeData(raw: ApiResponse): ProductReportData {
  const bomCostPerUnit = raw.bomCost.total

  const orders: OrderProfitability[] = raw.orders.map(row => {
    const revenue = row.quantity * row.unitPrice
    const cost = row.quantity * bomCostPerUnit
    const profit = revenue - cost
    const marginPercent = revenue > 0 ? (profit / revenue) * 100 : NaN
    return { ...row, revenue, cost, profit, marginPercent }
  })

  const distinctOrders = new Set(orders.map(o => o.orderId)).size
  const totalUnitsSold = orders.reduce((s, o) => s + o.quantity, 0)
  const totalRevenue = orders.reduce((s, o) => s + o.revenue, 0)
  const totalCost = orders.reduce((s, o) => s + o.cost, 0)
  const totalProfit = totalRevenue - totalCost
  const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : NaN

  return {
    bomCost: raw.bomCost,
    orders,
    stats: {
      totalOrders: distinctOrders,
      totalUnitsSold,
      totalRevenue,
      totalCost,
      totalProfit,
      avgMargin,
    },
  }
}

export function useProductReports(productId: number, period: ReportPeriod = 'all') {
  return useQuery<ProductReportData>({
    queryKey: ['product-reports', productId, period],
    queryFn: async () => {
      const res = await authorizedFetch(
        `/api/products/${productId}/reports?period=${period}`
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `Request failed (${res.status})`)
      }
      const raw: ApiResponse = await res.json()
      return computeData(raw)
    },
    staleTime: 60_000,
  })
}
```

---

## Task 3: ProductHealthBar

**File:** `components/features/products/reports/ProductHealthBar.tsx`

Five-stat bar matching `QuoteHealthBar` style.

- [ ] Create `components/features/products/reports/` directory
- [ ] Create `ProductHealthBar.tsx` with a local `StatCard` sub-component matching the `bg-[#12141c] border border-border/40` style from `QuoteHealthBar`
- [ ] Traffic light for Avg Margin: green `text-green-400` ≥30%, amber `text-amber-400` 15–30%, red `text-red-400` <15%; glowing dot with `boxShadow`
- [ ] Total Profit in `text-green-400` when positive, `text-red-400` when negative
- [ ] Handle NaN margin with `'N/A'` display and neutral colour
- [ ] Commit: `git commit -m "feat(products): add ProductHealthBar component"`

```typescript
// components/features/products/reports/ProductHealthBar.tsx
'use client'

import { formatCurrency } from '@/lib/format-utils'
import type { ProductReportStats } from '@/hooks/useProductReports'

interface ProductHealthBarProps {
  stats: ProductReportStats
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

export default function ProductHealthBar({ stats }: ProductHealthBarProps) {
  const { totalOrders, totalUnitsSold, totalRevenue, avgMargin, totalProfit } = stats

  const marginDotColor =
    Number.isNaN(avgMargin) ? '#6b7280'
    : avgMargin >= 30 ? '#4ade80'
    : avgMargin >= 15 ? '#fbbf24'
    : '#f87171'

  const marginValueClass =
    Number.isNaN(avgMargin) ? 'text-muted-foreground'
    : avgMargin >= 30 ? 'text-green-400'
    : avgMargin >= 15 ? 'text-amber-400'
    : 'text-red-400'

  const marginDisplay = Number.isNaN(avgMargin) ? 'N/A' : `${avgMargin.toFixed(1)}%`
  const profitClass = totalProfit >= 0 ? 'text-green-400' : 'text-red-400'

  return (
    <div className="flex gap-3">
      <StatCard label="Total Orders" value={totalOrders} />
      <StatCard label="Units Sold" value={totalUnitsSold} />
      <StatCard label="Total Revenue" value={formatCurrency(totalRevenue)} />
      <StatCard
        label="Avg Margin"
        value={
          <span className="flex items-center gap-2">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: marginDotColor, boxShadow: `0 0 6px ${marginDotColor}` }}
            />
            {marginDisplay}
          </span>
        }
        valueClass={marginValueClass}
      />
      <StatCard label="Total Profit" value={formatCurrency(totalProfit)} valueClass={profitClass} />
    </div>
  )
}
```

---

## Task 4: ProductMarginCard

**File:** `components/features/products/reports/ProductMarginCard.tsx`

Donut chart + revenue/cost/profit summary + stacked bar, with "BOM cost: R X/unit" annotation.

- [ ] Create `ProductMarginCard.tsx`
- [ ] Inline `DonutChart` SVG sub-component (120px, rotate -90deg, cost arc in red-400, margin arc in green-400, centre shows `marginPercent` or `'N/A'`)
- [ ] Show revenue, cost (BOM), profit rows matching `ProfitabilityCard` style; profit row in red-400 or green-400
- [ ] Stacked bar + legend below the summary (red for cost %, green for margin %)
- [ ] Annotation line below: `BOM cost: R {bomCost.total.toFixed(2)}/unit · {totalUnitsSold} units sold`
- [ ] Empty state when `totalRevenue === 0`
- [ ] Commit: `git commit -m "feat(products): add ProductMarginCard component"`

```typescript
// components/features/products/reports/ProductMarginCard.tsx
'use client'

import { formatCurrency } from '@/lib/format-utils'
import type { BomCost, ProductReportStats } from '@/hooks/useProductReports'

interface ProductMarginCardProps {
  stats: ProductReportStats
  bomCost: BomCost
}

function DonutChart({ costPercent, marginPercent }: { costPercent: number; marginPercent: number }) {
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

export default function ProductMarginCard({ stats, bomCost }: ProductMarginCardProps) {
  const { totalRevenue, totalCost, totalProfit, avgMargin, totalUnitsSold } = stats

  if (totalRevenue === 0) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/30 p-4 flex flex-col gap-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Margin Overview</h3>
        <p className="text-xs text-muted-foreground">No revenue data for this period.</p>
      </div>
    )
  }

  const costPercent = (totalCost / totalRevenue) * 100
  const clampedCost = Math.max(0, Math.min(100, costPercent))
  const isNegative = totalProfit < 0

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-4 flex flex-col gap-4">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Margin Overview</h3>

      <div className="flex items-center gap-4">
        <DonutChart costPercent={costPercent} marginPercent={avgMargin} />
        <div className="flex-1 space-y-1.5 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Revenue</span>
            <span className="font-medium tabular-nums">{formatCurrency(totalRevenue)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Cost (BOM)</span>
            <span className="font-medium text-red-400 tabular-nums">{formatCurrency(totalCost)}</span>
          </div>
          <div className="flex justify-between items-center border-t border-border/50 pt-1.5">
            <span className="font-semibold">Gross Profit</span>
            <span className={`font-bold tabular-nums ${isNegative ? 'text-red-400' : 'text-green-400'}`}>
              {formatCurrency(totalProfit)}
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

      <p className="text-[10px] text-muted-foreground border-t border-border/40 pt-2">
        BOM cost: {formatCurrency(bomCost.total)}/unit · {totalUnitsSold} units sold
      </p>
    </div>
  )
}
```

---

## Task 5: BomCostCard

**File:** `components/features/products/reports/BomCostCard.tsx`

Per-unit BOM cost donut + horizontal bars for materials/labor/overhead. NOT period-filtered.

- [ ] Create `BomCostCard.tsx`
- [ ] Three-segment `CompositionDonut` SVG (blue=materials, purple=labor, amber=overhead), centre shows `R {total}/unit`
- [ ] `HorizBar` sub-component: label with coloured dot, percentage + absolute value, filled bar
- [ ] Empty state when `total === 0` (no BOM configured)
- [ ] Show missing-price warning text below bars when `missingPrices > 0`
- [ ] Commit: `git commit -m "feat(products): add BomCostCard component"`

```typescript
// components/features/products/reports/BomCostCard.tsx
'use client'

import { formatCurrency } from '@/lib/format-utils'
import type { BomCost } from '@/hooks/useProductReports'

interface BomCostCardProps {
  bomCost: BomCost
}

const COLORS = {
  materials: '#60a5fa',
  labor: '#c084fc',
  overhead: '#fbbf24',
} as const

function CompositionDonut({ materials, labor, overhead, total }: Omit<BomCost, 'missingPrices'>) {
  const r = 52
  const circumference = 2 * Math.PI * r
  const mArc = total > 0 ? (materials / total) * circumference : 0
  const lArc = total > 0 ? (labor / total) * circumference : 0
  const oArc = total > 0 ? (overhead / total) * circumference : 0

  return (
    <div className="relative w-[120px] h-[120px] flex-shrink-0">
      <svg viewBox="0 0 120 120" className="w-[120px] h-[120px]" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="currentColor" className="text-border" strokeWidth="3" />
        {mArc > 0 && (
          <circle cx="60" cy="60" r={r} fill="none" stroke={COLORS.materials} strokeWidth="3"
            strokeDasharray={`${mArc} ${circumference}`} strokeDashoffset="0" />
        )}
        {lArc > 0 && (
          <circle cx="60" cy="60" r={r} fill="none" stroke={COLORS.labor} strokeWidth="3"
            strokeDasharray={`${lArc} ${circumference}`} strokeDashoffset={`${-mArc}`} />
        )}
        {oArc > 0 && (
          <circle cx="60" cy="60" r={r} fill="none" stroke={COLORS.overhead} strokeWidth="3"
            strokeDasharray={`${oArc} ${circumference}`} strokeDashoffset={`${-(mArc + lArc)}`} />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-bold text-white leading-none">{formatCurrency(total)}</span>
        <span className="text-[10px] text-muted-foreground mt-0.5">/unit</span>
      </div>
    </div>
  )
}

function HorizBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
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

export default function BomCostCard({ bomCost }: BomCostCardProps) {
  const { materials, labor, overhead, total, missingPrices } = bomCost

  if (total === 0) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/30 p-4 flex flex-col gap-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">BOM Cost Composition</h3>
        <p className="text-xs text-muted-foreground">No BOM cost data configured for this product.</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-4 flex flex-col gap-4">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">BOM Cost Composition</h3>

      <div className="flex items-center gap-4">
        <CompositionDonut materials={materials} labor={labor} overhead={overhead} total={total} />
        <div className="flex-1 space-y-3">
          <HorizBar label="Materials" value={materials} total={total} color={COLORS.materials} />
          <HorizBar label="Labor" value={labor} total={total} color={COLORS.labor} />
          <HorizBar label="Overhead" value={overhead} total={total} color={COLORS.overhead} />
        </div>
      </div>

      {missingPrices > 0 && (
        <p className="text-[10px] text-amber-400 border-t border-border/40 pt-2">
          ⚠ {missingPrices} BOM item{missingPrices > 1 ? 's' : ''} missing supplier price — cost may be understated.
        </p>
      )}
    </div>
  )
}
```

---

## Task 6: OrderHistoryTable

**File:** `components/features/products/reports/OrderHistoryTable.tsx`

Full-width table: Order # (link) | Customer | Date | Qty | Unit Price | Revenue | Cost | Profit | Margin badge | Mini split bar.

- [ ] Create `OrderHistoryTable.tsx`
- [ ] Columns: Order # (link to `/orders/${orderId}`), Customer, Date, Qty, Unit Price, Revenue, Cost (BOM), Profit, Margin (badge), Split (mini bar)
- [ ] Fallback for null `orderNumber`: display `Order #${orderId}`
- [ ] Margin badge colours: `bg-green-500/20 text-green-400` ≥30%, `bg-amber-500/20 text-amber-400` 15–30%, `bg-red-500/20 text-red-400` <15%; NaN → `text-muted-foreground`
- [ ] Mini split bar (40px wide): red portion for cost %, green portion for margin % — clamp to 0–100
- [ ] Empty state: "No orders found in this period."
- [ ] Commit: `git commit -m "feat(products): add OrderHistoryTable component"`

```typescript
// components/features/products/reports/OrderHistoryTable.tsx
'use client'

import Link from 'next/link'
import { formatCurrency } from '@/lib/format-utils'
import type { OrderProfitability } from '@/hooks/useProductReports'

interface OrderHistoryTableProps {
  orders: OrderProfitability[]
  bomCostPerUnit: number
}

function MarginBadge({ margin }: { margin: number }) {
  if (Number.isNaN(margin)) {
    return <span className="text-[10px] text-muted-foreground">N/A</span>
  }
  const cls =
    margin >= 30
      ? 'bg-green-500/20 text-green-400'
      : margin >= 15
        ? 'bg-amber-500/20 text-amber-400'
        : 'bg-red-500/20 text-red-400'
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold tabular-nums ${cls}`}>
      {margin.toFixed(1)}%
    </span>
  )
}

function MiniBar({ revenue, cost }: { revenue: number; cost: number }) {
  const costPct = revenue > 0 ? Math.min(100, (cost / revenue) * 100) : 100
  const marginPct = Math.max(0, 100 - costPct)
  return (
    <div className="w-10 h-2 rounded-sm bg-border overflow-hidden flex flex-shrink-0">
      <div className="bg-red-400 h-full" style={{ width: `${costPct}%` }} />
      <div className="bg-green-400 h-full" style={{ width: `${marginPct}%` }} />
    </div>
  )
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function OrderHistoryTable({ orders }: OrderHistoryTableProps) {
  if (orders.length === 0) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/30 p-4">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Order History & Margin
        </h3>
        <p className="text-xs text-muted-foreground">No orders found in this period.</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-4 flex flex-col gap-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Order History & Margin
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50">
              {['Order #', 'Customer', 'Date', 'Qty', 'Unit Price', 'Revenue', 'Cost (BOM)', 'Profit', 'Margin', 'Split'].map(h => (
                <th key={h} className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground pb-2 pr-3 last:pr-0 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orders.map(row => {
              const label = row.orderNumber ?? `Order #${row.orderId}`
              const isNegProfit = row.profit < 0
              return (
                <tr key={row.orderDetailId} className="border-b border-border/30 last:border-0">
                  <td className="py-2 pr-3">
                    <Link href={`/orders/${row.orderId}`} className="text-blue-400 hover:underline whitespace-nowrap">
                      {label}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground truncate max-w-[120px]">{row.customerName ?? '—'}</td>
                  <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">{formatDate(row.date)}</td>
                  <td className="py-2 pr-3 tabular-nums">{row.quantity}</td>
                  <td className="py-2 pr-3 tabular-nums">{formatCurrency(row.unitPrice)}</td>
                  <td className="py-2 pr-3 tabular-nums">{formatCurrency(row.revenue)}</td>
                  <td className="py-2 pr-3 tabular-nums text-red-400">{formatCurrency(row.cost)}</td>
                  <td className={`py-2 pr-3 tabular-nums font-medium ${isNegProfit ? 'text-red-400' : 'text-green-400'}`}>
                    {formatCurrency(row.profit)}
                  </td>
                  <td className="py-2 pr-3">
                    <MarginBadge margin={row.marginPercent} />
                  </td>
                  <td className="py-2">
                    <MiniBar revenue={row.revenue} cost={row.cost} />
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

---

## Task 7: MarginTrendChart

**File:** `components/features/products/reports/MarginTrendChart.tsx`

SVG sparkline with area fill. Aggregates multiple `order_details` per `orderId` into a single weighted-margin data point.

- [ ] Create `MarginTrendChart.tsx`
- [ ] Aggregate: group by `orderId`, sum revenue and cost per order, compute weighted margin `(totalProfit / totalRevenue) * 100`; sort ascending by date
- [ ] SVG chart: 500×160 viewBox, green line, gradient area fill, data point circles, date labels on x-axis, horizontal grid lines at 20%, 30%, 40%, y-axis label
- [ ] Handle 0 orders: show "No orders in this period" message
- [ ] Handle 1 order: render single dot (no line needed, still show axes/grid)
- [ ] Commit: `git commit -m "feat(products): add MarginTrendChart component"`

```typescript
// components/features/products/reports/MarginTrendChart.tsx
'use client'

import type { OrderProfitability } from '@/hooks/useProductReports'

interface MarginTrendChartProps {
  orders: OrderProfitability[]
}

interface TrendPoint {
  orderId: number
  date: string
  margin: number
}

function aggregateByOrder(orders: OrderProfitability[]): TrendPoint[] {
  const byOrder = new Map<number, { date: string; totalRevenue: number; totalCost: number }>()
  for (const o of orders) {
    const existing = byOrder.get(o.orderId)
    if (existing) {
      existing.totalRevenue += o.revenue
      existing.totalCost += o.cost
    } else {
      byOrder.set(o.orderId, { date: o.date ?? '', totalRevenue: o.revenue, totalCost: o.cost })
    }
  }
  return Array.from(byOrder.entries())
    .map(([orderId, d]) => ({
      orderId,
      date: d.date,
      margin: d.totalRevenue > 0 ? ((d.totalRevenue - d.totalCost) / d.totalRevenue) * 100 : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

function formatShortDate(dateStr: string) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })
}

export default function MarginTrendChart({ orders }: MarginTrendChartProps) {
  const points = aggregateByOrder(orders)

  if (points.length === 0) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/30 p-4 flex flex-col gap-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Margin Trend</h3>
        <p className="text-xs text-muted-foreground">No orders in this period.</p>
      </div>
    )
  }

  const W = 500
  const H = 160
  const padLeft = 36
  const padRight = 16
  const padTop = 16
  const padBottom = 32
  const chartW = W - padLeft - padRight
  const chartH = H - padTop - padBottom

  const margins = points.map(p => p.margin)
  const minM = Math.min(0, ...margins)
  const maxM = Math.max(50, ...margins)
  const range = maxM - minM || 1

  const toX = (i: number) =>
    padLeft + (points.length === 1 ? chartW / 2 : (i / (points.length - 1)) * chartW)
  const toY = (m: number) =>
    padTop + chartH - ((m - minM) / range) * chartH

  const linePoints = points.map((p, i) => `${toX(i)},${toY(p.margin)}`).join(' ')

  // Area path: down to baseline, back along x-axis
  const baseY = toY(Math.max(0, minM))
  const areaD =
    `M ${toX(0)},${toY(points[0].margin)} ` +
    points.slice(1).map((p, i) => `L ${toX(i + 1)},${toY(p.margin)}`).join(' ') +
    ` L ${toX(points.length - 1)},${baseY} L ${toX(0)},${baseY} Z`

  const gridLines = [20, 30, 40]

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-4 flex flex-col gap-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Margin Trend</h3>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 180 }}>
        <defs>
          <linearGradient id="marginAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4ade80" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#4ade80" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {gridLines.map(g => {
          const y = toY(g)
          if (y < padTop || y > padTop + chartH) return null
          return (
            <g key={g}>
              <line x1={padLeft} y1={y} x2={W - padRight} y2={y} stroke="#334155" strokeWidth="1" strokeDasharray="3,3" />
              <text x={padLeft - 4} y={y + 4} textAnchor="end" fontSize="9" fill="#6b7280">{g}%</text>
            </g>
          )
        })}

        {/* Area fill */}
        {points.length > 1 && <path d={areaD} fill="url(#marginAreaGrad)" />}

        {/* Line */}
        {points.length > 1 && (
          <polyline points={linePoints} fill="none" stroke="#4ade80" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        )}

        {/* Data points */}
        {points.map((p, i) => (
          <g key={p.orderId}>
            <circle cx={toX(i)} cy={toY(p.margin)} r="3" fill="#4ade80" />
            <text x={toX(i)} y={toY(p.margin) - 7} textAnchor="middle" fontSize="9" fill="#4ade80">
              {p.margin.toFixed(1)}%
            </text>
          </g>
        ))}

        {/* X-axis date labels */}
        {points.map((p, i) => (
          <text key={`date-${p.orderId}`} x={toX(i)} y={H - 4} textAnchor="middle" fontSize="9" fill="#6b7280">
            {formatShortDate(p.date)}
          </text>
        ))}
      </svg>
    </div>
  )
}
```

---

## Task 8: ProductReportsTab + Page Integration

**Files:** `components/features/products/ProductReportsTab.tsx` (new), `app/products/[productId]/page.tsx` (modified)

- [ ] Create `components/features/products/ProductReportsTab.tsx`:
  - Accept `productId: number` prop
  - Local `period` state defaulting to `'all'`
  - Period selector `<select>` (or `<Select>` from shadcn) with options: Last 7 days / Last 30 days / Last quarter / Last year / All time
  - Call `useProductReports(productId, period)`
  - Info banner: default variant shows BOM cost/unit; warning variant (`bomCost.missingPrices > 0`) shows missing price count
  - Loading skeleton: render 5 placeholder divs with `animate-pulse bg-muted/40` at appropriate heights
  - Error state: message + retry button (call `refetch()` from react-query)
  - Grid layout matching spec: health bar full-width, two-column row for margin + BOM cost cards, history table full-width, trend chart full-width
- [ ] Modify `app/products/[productId]/page.tsx`:
  - Add `'reports'` to `PRODUCT_DETAIL_TABS` constant
  - Add `<TabsTrigger value="reports">Reports</TabsTrigger>` after "Transactions"
  - Add `<TabsContent value="reports">` with lazy render guard (`activeTab === 'reports' && <ProductReportsTab productId={product.product_id} />`)
  - Import `ProductReportsTab` at top of file
- [ ] Commit: `git commit -m "feat(products): add ProductReportsTab and wire into product detail page"`

```typescript
// components/features/products/ProductReportsTab.tsx
'use client'

import { useState } from 'react'
import { useProductReports, type ReportPeriod } from '@/hooks/useProductReports'
import { formatCurrency } from '@/lib/format-utils'
import ProductHealthBar from './reports/ProductHealthBar'
import ProductMarginCard from './reports/ProductMarginCard'
import BomCostCard from './reports/BomCostCard'
import OrderHistoryTable from './reports/OrderHistoryTable'
import MarginTrendChart from './reports/MarginTrendChart'

const PERIOD_LABELS: Record<ReportPeriod, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last quarter',
  '365d': 'Last year',
  'all': 'All time',
}

interface ProductReportsTabProps {
  productId: number
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-muted/40 ${className}`} />
}

export default function ProductReportsTab({ productId }: ProductReportsTabProps) {
  const [period, setPeriod] = useState<ReportPeriod>('all')
  const { data, isLoading, error, refetch } = useProductReports(productId, period)

  return (
    <div className="space-y-4">
      {/* Period selector + info banner */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Period</label>
          <select
            value={period}
            onChange={e => setPeriod(e.target.value as ReportPeriod)}
            className="text-sm rounded-sm border border-border/50 bg-[#12141c] text-foreground px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {(Object.keys(PERIOD_LABELS) as ReportPeriod[]).map(p => (
              <option key={p} value={p}>{PERIOD_LABELS[p]}</option>
            ))}
          </select>
        </div>

        {data && (
          <div className={`text-xs px-3 py-2 rounded-sm border ${
            data.bomCost.missingPrices > 0
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
              : 'border-border/40 bg-muted/20 text-muted-foreground'
          }`}>
            {data.bomCost.missingPrices > 0
              ? `⚠ ${data.bomCost.missingPrices} BOM item${data.bomCost.missingPrices > 1 ? 's' : ''} missing supplier prices — cost may be understated.`
              : `Costs based on current BOM pricing (${formatCurrency(data.bomCost.total)}/unit). Per-order actual costing coming soon.`
            }
          </div>
        )}
      </div>

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-4">
          <div className="flex gap-3">
            {[1,2,3,4,5].map(i => <Skeleton key={i} className="flex-1 h-16" />)}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
          </div>
          <Skeleton className="h-56" />
          <Skeleton className="h-48" />
        </div>
      )}

      {/* Error state */}
      {error && !isLoading && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 flex items-center justify-between">
          <p className="text-sm text-red-400">Failed to load report data: {(error as Error).message}</p>
          <button
            onClick={() => refetch()}
            className="text-xs text-red-400 border border-red-500/40 rounded px-2 py-1 hover:bg-red-500/10"
          >
            Retry
          </button>
        </div>
      )}

      {/* Report sections */}
      {data && !isLoading && (
        <div className="space-y-4">
          {/* Section 1: Health bar */}
          <ProductHealthBar stats={data.stats} />

          {/* Section 2 + 3: Two-column cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ProductMarginCard stats={data.stats} bomCost={data.bomCost} />
            <BomCostCard bomCost={data.bomCost} />
          </div>

          {/* Section 4: Order history table */}
          <OrderHistoryTable orders={data.orders} bomCostPerUnit={data.bomCost.total} />

          {/* Section 5: Margin trend */}
          <MarginTrendChart orders={data.orders} />
        </div>
      )}
    </div>
  )
}
```

**Diff for `app/products/[productId]/page.tsx`:**

```typescript
// Line 75 — update PRODUCT_DETAIL_TABS:
const PRODUCT_DETAIL_TABS = ['details', 'images', 'categories', 'costing', 'cutlist', 'options', 'transactions', 'reports'] as const;

// Add import near top (with other feature component imports):
import ProductReportsTab from '@/components/features/products/ProductReportsTab'

// Inside <TabsList> (after the Transactions trigger):
<TabsTrigger value="reports">Reports</TabsTrigger>

// Add TabsContent after the transactions TabsContent:
<TabsContent value="reports" className="space-y-4">
  {activeTab === 'reports' && <ProductReportsTab productId={product.product_id} />}
</TabsContent>
```

---

## Task 9: Visual Verification + Lint

- [ ] Run `npm run lint` — fix any errors before declaring done
- [ ] Run `npx tsc --noEmit` — if unrelated pre-existing errors block a clean run, document which files they are
- [ ] Open Chrome via `mcp__claude-in-chrome__navigate` to `http://localhost:3000`
- [ ] Log in with test account (`testai@qbutton.co.za` / `ClaudeTest2026!`) if needed
- [ ] Navigate to a product detail page and click the Reports tab
- [ ] Verify: period selector renders, info banner shows, all 5 sections load (health bar, margin card, BOM cost card, order table, trend chart)
- [ ] Take screenshot as proof of render
- [ ] Check browser console for runtime errors via `mcp__claude-in-chrome__read_console_messages`
- [ ] Commit: `git commit -m "chore: lint pass and visual verification for product reports tab"`

---

## File Checklist

| File | Status |
|------|--------|
| `app/api/products/[productId]/reports/route.ts` | New |
| `hooks/useProductReports.ts` | New |
| `components/features/products/reports/ProductHealthBar.tsx` | New |
| `components/features/products/reports/ProductMarginCard.tsx` | New |
| `components/features/products/reports/BomCostCard.tsx` | New |
| `components/features/products/reports/OrderHistoryTable.tsx` | New |
| `components/features/products/reports/MarginTrendChart.tsx` | New |
| `components/features/products/ProductReportsTab.tsx` | New |
| `app/products/[productId]/page.tsx` | Modified |

## Notes for Implementer

- `getProductCostSummary` resolves the product by `productRef` string (internal code or name). Since we already have the `product_id`, resolve `internal_code` from the product row first; fall back to `String(productId)` if null. The function calls sibling API routes internally via HTTP — pass `origin` (from `new URL(req.url)`) and `authorizationHeader` (from `req.headers.get('authorization')`) so those sub-calls are authenticated.
- The `order_details` Supabase query uses `!inner` join on `orders` so rows with no matching order are excluded. The `.eq('order.org_id', auth.orgId)` filter works on the joined relation — verify this returns correct results; if Supabase admin client requires a different approach, filter via `.eq('orders.org_id', auth.orgId)` with an explicit join alias.
- `avgMargin` and per-row `marginPercent` can be `NaN` when revenue is 0 — all display code guards with `Number.isNaN()`.
- The `'reports'` tab is lazy-rendered (`activeTab === 'reports' && ...`) to avoid firing the API call on every page load.
- Tailwind v4: use `shadow-sm` not `shadow`, `rounded-sm` not `rounded`, `/50` opacity modifiers, `bg-(--var)` not `bg-[--var]`.
