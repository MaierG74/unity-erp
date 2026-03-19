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

Query `order_details` joined with `orders`:

```sql
SELECT
  od.order_detail_id, od.order_id, od.quantity, od.unit_price,
  o.order_number, o.status, o.created_at,
  c.name as customer_name
FROM order_details od
JOIN orders o ON od.order_id = o.order_id
LEFT JOIN customers c ON o.customer_id = c.id
WHERE od.product_id = :productId
  AND o.created_at >= :periodStart
ORDER BY o.created_at DESC
```

### BOM Cost Data (server-side, not period-filtered)

Computed via existing infrastructure — the product's effective BOM, BOL, and overhead:
- **Materials**: `SUM(bom.quantity_required × suppliercomponents.price)` from effective BOM
- **Labor**: `SUM(bol calculations)` from bill of labour
- **Overhead**: fixed + percentage-based from `product_overhead`
- **Total**: materials + labor + overhead

Uses the existing API endpoints: `/api/products/[productId]/effective-bom`, `/api/products/[productId]/effective-bol`, `/api/products/[productId]/overhead`.

### Period Filter

Dropdown at the top of the Reports tab:

| Option | Filter |
|--------|--------|
| Last 7 days | `created_at >= now - 7d` |
| Last 30 days | `created_at >= now - 30d` |
| Last quarter | `created_at >= now - 90d` |
| Last year | `created_at >= now - 365d` |
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
    orderNumber: string
    customerName: string | null
    date: string           // ISO date string
    quantity: number
    unitPrice: number
  }>
}
```

The endpoint returns raw data; the client computes profitability by combining `bomCost.total` with each order's `unitPrice` and `quantity`.

**Implementation:** Uses `supabaseAdmin` for the order query (server-side, org-scoped via RLS). Reuses the existing effective-bom/bol/overhead API pattern from `getProductCostSummary()` but simplified — we only need the totals, not per-line details.

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

If only 1 order, show a single point instead of a line.
If 0 orders, show "No orders in this period" message.

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
