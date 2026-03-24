# Order Reports Tab — Design Spec

**Date:** 2026-03-24
**Status:** Draft
**Location:** Order detail page, new "Reports" tab (7th tab)

## Problem

Orders have estimated costs (from product BOMs and BOL at quote/order time) but no visibility into what the order **actually** cost to produce. Material waste, rework, rejected components, and extra job cards all increase the real cost. Without comparing estimated vs actual, users can't identify where costing assumptions break down or improve pricing accuracy.

## Solution

A new "Reports" tab on the order detail page with 5 sections showing order-level P&L: estimated cost (from BOMs + BOL) vs actual cost (from stock issuances + completed job card items). Phase 1 covers **materials and labor** — overhead actuals come later.

## Data Sources

### Revenue

From `order_details` for this order:
- `revenue = SUM(order_details.quantity × order_details.unit_price)`

### Estimated Materials Cost

For each product in the order (`order_details`), compute BOM cost:
1. Fetch effective BOM for the product (`billofmaterials` → `suppliercomponents.price`)
2. `estimated_material_cost_per_unit = SUM(bom.quantity_required × suppliercomponents.price)`
3. `estimated_materials = SUM(per_unit_cost × order_detail.quantity)` across all products

Also build a **component-level expected list**: for each BOM component, the expected quantity is `bom.quantity_required × order_detail.quantity`. This is used for the variance table.

### Actual Materials Cost

From `stock_issuances` for this order:
1. Fetch all issuances: `stock_issuances WHERE order_id = X`
2. Join with `suppliercomponents` to get price: use the default supplier component price for each `component_id`
3. `actual_material_cost = SUM(quantity_issued × supplier_price)` per component
4. Components issued that don't appear in any product BOM are "unmatched" — shown separately

**Price lookup for actual costs**: `stock_issuances` only has `component_id` (not `supplier_component_id`). Price resolution priority:
1. If the BOM for this order's product links a specific `supplier_component_id`, use that supplier component's price
2. Otherwise, use the cheapest active supplier component for that `component_id`

Note: This uses current supplier price, not the price at time of issuance. Phase 2 will add cost snapshots to `stock_issuances`.

**Org scoping**: `stock_issuances` has no `org_id` column. Org isolation is achieved by first validating the order belongs to the requesting org (via `orders.org_id = auth.orgId`), then querying issuances by that validated `order_id`.

### Estimated Labor Cost

From the `job_work_pool` for this order (which snapshots BOL demand):
1. Fetch all work pool rows: `job_work_pool WHERE order_id = X AND status = 'active'` (include both `source = 'bol'` and `source = 'manual'` — manual entries represent intentionally added labor demand)
2. For piece work (`pay_type = 'piece'`): `estimated_labor = SUM(required_qty × piece_rate)`
3. For hourly work (`pay_type = 'hourly'`): show row with "Hourly — no piece rate" indicator. Hourly labor is excluded from cost totals in Phase 1 but shown so users see the gap.
4. Group by `job_id` for the labor variance table

If no work pool exists, fall back to computing from `billoflabour` directly:
1. For each product in the order, fetch BOL with piece rate via: `billoflabour → piece_work_rates (WHERE rate_id = piece_rate_id) → piece_rate_amount`
2. `estimated_labor = SUM(bol.quantity × piece_rate_amount × order_detail.quantity)` for piece work only
3. Hourly BOL entries shown but excluded from cost totals (same as work pool path)

### Actual Labor Cost

From completed `job_card_items` for this order:
1. Fetch: `job_card_items JOIN job_cards WHERE job_cards.order_id = X AND job_card_items.status = 'completed'`
2. For each item: `actual_cost = completed_quantity × piece_rate` (use `piece_rate` column directly — it's snapshotted at issuance time and is the source of truth)
3. Note: `piece_rate_override` may exist on the table — if present, use `piece_rate_override ?? piece_rate`. Verify column existence during implementation.
4. Exclude cancelled items (from cancel cascade) even if they have `completed_quantity > 0`
5. Group by `job_id` for the labor variance table
6. Account for `remainder_action`: items with `scrap` or `shortage` remainder don't generate additional cost, but `follow_up_card` items do (the follow-up card has its own cost)

### Estimated Overhead

From product overhead calculations (same as BOM cost composition):
- `estimated_overhead = SUM(product_overhead calculations × order_detail.quantity)`
- Shown as estimated only — no actuals in Phase 1

### Variance Calculations

```
material_variance = actual_materials - estimated_materials
labor_variance = actual_labor - estimated_labor
total_variance = material_variance + labor_variance

estimated_total = estimated_materials + estimated_labor + estimated_overhead
actual_total = actual_materials + actual_labor  (+ estimated_overhead as proxy)

estimated_margin = (revenue - estimated_total) / revenue × 100
actual_margin = (revenue - actual_total) / revenue × 100
margin_erosion = actual_margin - estimated_margin  (negative = erosion)
```

## API Endpoint

### `GET /api/orders/[orderId]/reports`

**Response:**

```typescript
interface OrderReportResponse {
  revenue: number              // SUM(order_details.qty × unit_price)
  products: Array<{
    productId: number
    name: string
    quantity: number
    unitPrice: number
  }>

  estimated: {
    materials: number          // BOM cost × order qty
    labor: number              // BOL piece cost × order qty
    overhead: number           // Product overhead × order qty
    total: number
  }

  actual: {
    materials: number          // stock_issuances × supplier price
    labor: number              // completed job_card_items × piece_rate
  }

  // Component-level detail for material variance
  materialDetail: Array<{
    componentId: number
    code: string
    description: string | null
    bomQty: number             // expected from BOM × order qty
    issuedQty: number          // from stock_issuances
    unitCost: number           // supplier price
    estimatedCost: number      // bomQty × unitCost
    actualCost: number         // issuedQty × unitCost
  }>

  // Components issued but not in BOM
  unmatchedIssuances: Array<{
    componentId: number
    code: string
    description: string | null
    issuedQty: number
    unitCost: number
    totalCost: number
    category: string | null    // from stock_issuances.issue_category
    notes: string | null
  }>

  // Job-level detail for labor variance
  laborDetail: Array<{
    jobId: number
    jobName: string
    productName: string | null
    estimatedQty: number       // from work pool or BOL
    actualQty: number          // completed_quantity from job_card_items
    pieceRate: number
    estimatedCost: number
    actualCost: number
    cardCount: number          // number of job cards issued for this job
  }>
}
```

**Implementation notes:**
- Uses `supabaseAdmin` with explicit `orgId` filtering (from `requireModuleAccess`)
- Fetches effective BOM via the existing resolver functions
- Joins `stock_issuances` → `components` → `suppliercomponents` for material costs
- Joins `job_card_items` → `job_cards` for labor costs
- Groups labor by `job_id` and aggregates card counts

## UI Design

### Tab Integration

The order page uses `SmartButtonsRow` for tabs (not shadcn Tabs). `SmartButtonsRow` has hardcoded tabs with individually named props. Add a 7th button: icon `BarChart3` (Lucide) + "Reports" label. No count badge needed for this tab (pass `null`/`undefined` to suppress the count display, or modify the component to conditionally render counts). The tab renders `OrderReportsTab` when `activeTab === 'reports'`.

### Layout

```
┌─────────────────────────────────────────────────────┐
│  ℹ Info banner                                      │
├─────────────────────────────────────────────────────┤
│  ORDER P&L SUMMARY (4 stat cards, full width)       │
├────────────────────────┬────────────────────────────┤
│  ESTIMATED VS ACTUAL   │  MARGIN IMPACT             │
│  (side-by-side)        │  (donut + erosion)          │
├────────────────────────┴────────────────────────────┤
│  MATERIAL VARIANCE DETAIL (component table)         │
│  + UNMATCHED ISSUANCES (extras not in BOM)          │
├─────────────────────────────────────────────────────┤
│  LABOR VARIANCE DETAIL (job card table)             │
└─────────────────────────────────────────────────────┘
```

### Section 1: Order P&L Summary (full width)

4 stat cards:

| Stat | Value | Color |
|------|-------|-------|
| Order Revenue | `revenue` | Neutral |
| Estimated Cost | `estimated.total` | Blue (`#60a5fa`) |
| Actual Cost | `actual.materials + actual.labor` | Amber (`#fbbf24`) if over, green if under |
| Cost Variance | `actual - estimated` with % | Red badge if over, green if under |

### Section 2: Estimated vs Actual (left card)

Two-column comparison:

**Estimated (BOM+BOL)** — blue header:
- Materials: `estimated.materials`
- Labor: `estimated.labor`
- Overhead: `estimated.overhead`
- **Total**: sum

**Actual (Issued+Cards)** — amber header:
- Materials: `actual.materials`
- Labor: `actual.labor`
- Overhead: "—" (Phase 2)
- **Total**: `actual.materials + actual.labor`

Each row shows variance indicator if actual differs from estimated.

### Section 3: Margin Impact (right card)

- Donut chart (120px) showing actual cost vs actual margin split
- Estimated margin % vs Actual margin % comparison
- Margin erosion metric (pts difference)
- Two stacked bars: estimated split (faded blue) and actual split (amber/green)

### Section 4: Material Variance Detail (full width)

**Main table** — columns: Component | BOM Qty | Issued Qty | Qty Variance | Unit Cost | Est. Cost | Actual Cost | Variance

- Variance badges: red "+X" for over, green "-X" for under, grey "0" for exact match
- Issued qty highlighted red if over BOM qty
- Totals row at bottom

**Unmatched Issuances** — separate sub-table below:
- Components issued to this order that don't appear in any product BOM
- Columns: Component | Issued Qty | Unit Cost | Total Cost | Category (badge from `issue_category`) | Notes
- Explanation text: "These components were issued but don't appear in product BOMs. They add R X to actual cost."

### Section 5: Labor Variance Detail (full width)

Columns: Job | Product | Est. Qty | Actual Qty | Piece Rate | Est. Cost | Actual Cost | Variance | Cards Issued

- "Cards Issued" column shows how many job cards were created for this job (1 = normal, 2+ = re-work)
- Variance badges same as materials
- Rows where cardCount > 1 get a subtle "rework" indicator
- Totals row at bottom

### Color Palette

| Element | Color |
|---------|-------|
| Estimated/BOM | Blue `#60a5fa` |
| Actual/Issued | Amber `#fbbf24` |
| Over budget | Red `#f87171` |
| Under budget | Green `#4ade80` |
| Margin | Green `#4ade80` |
| Neutral/dash | `text-muted-foreground` |

### Empty States

- **No stock issuances and no job cards**: Show "No actual costs recorded yet" with explanation
- **No BOM for a product**: Material estimated costs show "No BOM" for that product
- **No BOL for a product**: Labor estimated shows "No BOL"
- **Zero revenue** (draft order, no prices): Margin shows "N/A" instead of percentage
- **Info banner**: "Estimated costs from product BOMs + BOL at current prices. Actual material costs from stock issued. Actual labor from completed piecework job cards. Hourly labor and overhead actuals coming in Phase 2."

## Component Architecture

### New Files

| File | Responsibility |
|------|---------------|
| `app/api/orders/[orderId]/reports/route.ts` | API endpoint |
| `hooks/useOrderReports.ts` | Client hook with loading/error state |
| `components/features/orders/OrderReportsTab.tsx` | Tab container |
| `components/features/orders/reports/OrderPLSummary.tsx` | Section 1: stat cards |
| `components/features/orders/reports/EstimatedVsActualCard.tsx` | Section 2: comparison |
| `components/features/orders/reports/OrderMarginImpactCard.tsx` | Section 3: donut + erosion |
| `components/features/orders/reports/MaterialVarianceTable.tsx` | Section 4: component table + unmatched |
| `components/features/orders/reports/LaborVarianceTable.tsx` | Section 5: job card table |

### Modified Files

| File | Change |
|------|--------|
| `app/orders/[orderId]/page.tsx` | Add Reports tab button to SmartButtonsRow data, render OrderReportsTab |
| `components/features/orders/SmartButtonsRow.tsx` | Add "Reports" button with chart icon |

## Scope Exclusions

- No overhead actuals (Phase 2)
- No cost snapshot at issuance time (Phase 2 — uses current supplier prices)
- No per-product breakdown of actuals (components are issued to the order, not per product)
- No historical variance trending across orders
- No export/download
- No hourly labor tracking (piece work only)
