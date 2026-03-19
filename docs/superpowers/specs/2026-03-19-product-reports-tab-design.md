# Product Reports Tab — Design Spec

**Date:** 2026-03-19
**Status:** Draft
**Location:** Product detail page, new "Reports" tab (8th tab)

## Problem

The product detail page shows inventory, costing, and transactions, but there's no view of how the product performs across orders — total revenue, margin, profitability trends. Users can't answer "is this product profitable?" or "how has margin changed over time?" without manually cross-referencing orders.

## Solution

A new "Reports" tab on the product detail page with 5 report sections and a period filter. Uses the product's current BOM cost (materials + labor + overhead) as the cost basis, combined with order history data (`order_details`) for revenue.

### Key Difference from Quote Reports Tab

Unlike the quote Reports tab (which computes everything client-side from already-loaded data), the product Reports tab requires a **server-side query** — fetching all `order_details` for this product joined with order metadata. A new API endpoint handles this.

## Data Sources

### Orders Data (server-side, period-filtered)

Supabase query on `order_details` with nested `orders` and `customers`:

```typescript
supabaseAdmin
  .from('order_details')
  .select(`
    order_detail_id, order_id, quantity, unit_price,
    order:orders!inner(order_number, status, order_date, customer:customers(name))
  `)
  .eq('product_id', productId)
  .eq('order.org_id', orgId)           // explicit org filter (supabaseAdmin bypasses RLS)
  .not('order.status', 'eq', 'cancelled')  // exclude cancelled orders
  .gte('order.order_date', periodStart)    // period filter
  .order('order.order_date', { ascending: false })
```

Notes:
- Uses `supabaseAdmin` with **explicit `orgId` filtering** (not RLS — admin client bypasses RLS). Follows the existing pattern from `effective-bom/route.ts` using `requireModuleAccess()` to obtain `orgId`.
- Filters on `order_date` (business date the order was placed), not `created_at` (record insertion timestamp).
- Excludes `cancelled` orders from profitability calculations.
- `order_number` may be null — client should fall back to `Order #${orderId}`.
- If the same product appears multiple times in one order, each `order_detail` row is a separate entry.

### BOM Cost Data (server-side, not period-filtered)

Computed via existing infrastructure — the product's effective BOM, BOL, and overhead:
- **Materials**: `SUM(bom.quantity_required × suppliercomponents.price)` from effective BOM
- **Labor**: `SUM(bol calculations)` from bill of labour
- **Overhead**: fixed + percentage-based from `product_overhead`
- **Total**: materials + labor + overhead

Import the underlying computation functions directly (e.g., from the effective-bom route's resolver) rather than making HTTP round-trips to sibling API routes. This avoids the server-to-server fetch antipattern.

### Period Filter

Dropdown at the top of the Reports tab:

| Option | Filter |
|--------|--------|
| Last 7 days | `order_date >= now - 7d` |
| Last 30 days | `order_date >= now - 30d` |
| Last quarter | `order_date >= now - 90d` |
| Last year | `order_date >= now - 365d` |
| All time (default) | No date filter |

Period affects: Health stats, Margin Overview, Order History table, Margin Trend chart.
Period does NOT affect: BOM Cost Composition (always shows current BOM).

### Computation (client-side from fetched data)

For each order detail row:
- `revenue = quantity × unit_price`
- `cost = quantity × bomCostPerUnit`
- `profit = revenue - cost`
- `marginPercent = (profit / revenue) × 100` (NaN if revenue is 0)

Aggregates across all orders in the period:
- `totalOrders` = count of distinct orders
- `totalUnitsSold` = sum of quantities
- `totalRevenue` = sum of revenues
- `totalCost` = sum of costs
- `totalProfit` = totalRevenue - totalCost
- `avgMargin` = (totalProfit / totalRevenue) × 100

## API Endpoint

### `GET /api/products/[productId]/reports`

**Query params:**
- `period`: `7d` | `30d` | `90d` | `365d` | `all` (default: `all`)

**Response:**

```typescript
interface ProductReportResponse {
  bomCost: {
    materials: number
    labor: number
    overhead: number
    total: number        // per-unit total BOM cost
    missingPrices: number  // count of BOM items without supplier price
  }
  orders: Array<{
    orderDetailId: number
    orderId: number
    orderNumber: string | null  // may be null; client falls back to "Order #{orderId}"
    customerName: string | null
    date: string           // ISO date string
    quantity: number
    unitPrice: number
  }>
}
```

The endpoint returns raw data; the client computes profitability by combining `bomCost.total` with each order's `unitPrice` and `quantity`.

**Implementation:** Uses `supabaseAdmin` with explicit `orgId` filtering (obtained via `requireModuleAccess()`). For BOM cost, imports the underlying computation functions directly rather than calling sibling API routes. Only needs the category totals, not per-line details.

**Client hook:** `useProductReports(productId, period)` uses `authorizedFetch` from `lib/client/auth-fetch` for authenticated requests. Manages loading, error, and data state. Refetches when period changes.

**Loading state:** Show skeleton placeholders for each section while data loads. On error, show a retry-able error message.

## UI Design

### Layout

Same pattern as quote Reports tab — responsive two-column grid with full-width sections.

```
┌─────────────────────────────────────────────────────┐
│  [Period: All time ▾]                               │
│  ℹ Costs based on current BOM pricing (R X/unit)    │
├─────────────────────────────────────────────────────┤
│  PRODUCT SALES HEALTH (full width stats bar)        │
├────────────────────────┬────────────────────────────┤
│  MARGIN OVERVIEW       │  BOM COST COMPOSITION      │
│  (donut + summary)     │  (per-unit breakdown)       │
├────────────────────────┴────────────────────────────┤
│  ORDER HISTORY & MARGIN (full width table)          │
├─────────────────────────────────────────────────────┤
│  MARGIN TREND (sparkline chart)                     │
└─────────────────────────────────────────────────────┘
```

### Info Banner

Subtle banner below the period filter:
> "Costs based on current BOM pricing (R {bomCost.total}/unit). Per-order actual costing coming soon."

If `bomCost.missingPrices > 0`, show warning variant:
> "⚠ {n} BOM items missing supplier prices — cost may be understated."

### Section 1: Product Sales Health (full width)

5-stat bar:

| Stat | Value | Color |
|------|-------|-------|
| Total Orders | count | Neutral |
| Units Sold | sum of qty | Neutral |
| Total Revenue | sum | Neutral |
| Avg Margin | % with traffic light | Green >30%, amber 15-30%, red <15% |
| Total Profit | sum | Green |

### Section 2: Margin Overview (left card)

Same pattern as quote profitability card:
- Donut chart (120px): cost vs margin split
- Revenue / Cost (BOM) / Profit summary
- Annotation: "BOM cost: R X/unit · Y units sold"
- Stacked bar with legend

### Section 3: BOM Cost Composition (right card)

Per-unit BOM cost breakdown — NOT period-filtered:
- Donut chart (120px): materials (blue) / labor (purple) / overhead (amber)
- Horizontal bars with percentages and absolute values
- Center label: "R {total}/unit"

### Section 4: Order History & Margin (full width table)

Columns: Order # (link) | Customer | Date | Qty | Unit Price | Revenue | Cost (BOM) | Profit | Margin (badge) | Split (mini bar)

- Order # links to `/orders/{orderId}`
- Margin badge colors: green >30%, amber 15-30%, red <15%
- Sorted by date descending
- Period-filtered

### Section 5: Margin Trend (full width)

SVG sparkline:
- X axis: order dates
- Y axis: margin % per order
- Green line with area fill gradient
- Data point circles with % labels
- Date labels on x-axis
- Horizontal grid lines at 20%, 30%, 40%

If only 1 data point, show a single point instead of a line.
If 0 orders, show "No orders in this period" message.
If multiple order_details share the same orderId, aggregate them into a single data point (weighted margin by revenue) for the trend chart. The order history table shows each order_detail row individually.

### Empty States

- **No orders at all**: All sections show "No orders found for this product"
- **No orders in period**: Stats show 0, table empty, trend shows "No orders in this period"
- **No BOM cost data**: Margin calculations show "N/A", info banner warns about missing cost

## Component Architecture

### New Files

| File | Responsibility |
|------|---------------|
| `app/api/products/[productId]/reports/route.ts` | API endpoint: fetches order history + BOM cost |
| `hooks/useProductReports.ts` | Client hook: fetches report data with period param, manages loading/error state |
| `components/features/products/ProductReportsTab.tsx` | Tab container: period selector + grid layout |
| `components/features/products/reports/ProductHealthBar.tsx` | Section 1: stats bar |
| `components/features/products/reports/ProductMarginCard.tsx` | Section 2: donut + summary |
| `components/features/products/reports/BomCostCard.tsx` | Section 3: BOM composition |
| `components/features/products/reports/OrderHistoryTable.tsx` | Section 4: order table |
| `components/features/products/reports/MarginTrendChart.tsx` | Section 5: sparkline |

### Modified Files

| File | Change |
|------|--------|
| `app/products/[productId]/page.tsx` | Add 'reports' to `PRODUCT_DETAIL_TABS`, add TabsTrigger + TabsContent |

### Data Flow

```
ProductReportsTab
  ├── useProductReports(productId, period)  →  GET /api/products/:id/reports?period=X
  │     returns: { bomCost, orders, isLoading }
  │
  ├── Client-side computation: bomCost + orders → aggregated stats
  │
  ├── ProductHealthBar       props: { stats }
  ├── ProductMarginCard      props: { stats, bomCost }
  ├── BomCostCard            props: { bomCost }
  ├── OrderHistoryTable      props: { orders, bomCostPerUnit }
  └── MarginTrendChart       props: { orders, bomCostPerUnit }
```

## Scope Exclusions

- No per-order actual costing (future — track supplier prices at order time)
- No export/download of report data
- No comparison between periods
- No custom date range picker (preset periods only)
- No quote history (orders only)
- No PDF rendering
