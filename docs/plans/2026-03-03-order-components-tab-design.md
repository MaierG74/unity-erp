# Order Components Tab Redesign

**Date**: 2026-03-03
**Status**: Approved

## Problem

The Components tab on the order detail page (`/orders/{id}?tab=components`) currently shows a stock availability progress bar and a "Components Needing Attention" table limited to shortfall items with only Need/Have/Short columns. This is less informative than the inline BOM expansion on the Products tab, which shows Required, In Stock, Reserved, Available, On Order, Shortfall, and Global columns per component.

The underlying query (`fetchOrderComponentRequirements`) already fetches rich data — supplier options, on-order breakdowns, reservation details, transaction history, draft PO info, and global demand — but the Components tab discards most of it.

## Research

Reviewed Odoo, SAP S/4HANA, NetSuite, and ERPNext. All follow a common pattern:
- Full flat component table per order (not just shortfalls)
- Header-level go/no-go status badge
- Clickable components linking to inventory/forecast views
- Explicit shortfall column (not implicit math)

## Design

### Header Section (enhance existing)

Keep the progress bar and summary stats. Add:

- **Go/no-go badge** next to "Components Summary" heading — green "Ready" (all available), amber "Partial" (some on order), red "Shortfall" (items need ordering). Mirrors Odoo's Component Status pattern.
- **Compact summary counts** row: `X in stock | Y on order | Z short`
- **"Order Components" button** stays in the header area (same dialog as today).

### Full Component Table (replaces "Needing Attention" table)

A flat, deduplicated list of ALL components across all products on the order.

**Columns** (matching the Products tab inline view for consistency):

| Column | Source | Notes |
|--------|--------|-------|
| Component | `internal_code` + `description` | Clickable — opens `/inventory/components/{id}` in new tab |
| Required | `metrics.required` | Total across all products on this order |
| In Stock | `metrics.inStock` | Current warehouse stock |
| Reserved | `metrics.reservedThisOrder` | Qty reserved for this order |
| Available | `metrics.available` | In Stock minus reserved by other orders |
| On Order | `metrics.onOrder` | Qty on open supplier orders |
| Shortfall | `metrics.real` | `max(0, required - available - onOrder)` |

**Behavior:**
- Components appearing in multiple products are deduplicated; quantities are summed.
- Default sort: shortfall items first (descending by shortfall), then alphabetical by code.
- Color coding: rows with shortfall > 0 get red accent; rows with apparent shortfall but no real shortfall (covered by on-order) get amber accent.
- Clicking a component row opens the inventory detail page in a new browser tab.

### What's Excluded

- No inline expandable rows — click navigates to inventory page instead.
- No per-row ordering actions — the bulk "Order Components" button is sufficient.
- No supplier column — available on the inventory detail page.
- No consumed/issued lifecycle columns — that's the Issue Stock tab's responsibility.

## Key Files

| File | Change |
|------|--------|
| `app/orders/[orderId]/page.tsx` | Replace Components tab content (lines ~1081-1215) |
| `lib/queries/order-components.ts` | No changes — data already available |
| `components/features/orders/ProductsTableRow.tsx` | Reference for column layout/styling |

## Data Flow

```
componentRequirements (already fetched)
  → deduplicate components across products, sum quantities
  → computeComponentMetrics per unique component
  → sort by shortfall desc, then code asc
  → render full table + header summary
```

The deduplication logic needs to aggregate `quantity_required` across products while keeping per-component stock/reservation metrics (which are already component-level, not product-level).
