# Quote Profitability Card — Design Spec

**Date:** 2026-03-18
**Status:** Draft
**Location:** Quote detail page, Quote Details tab

## Problem

The Quote Summary shows revenue (subtotal, VAT, total) but no cost or margin visibility. Cost data already exists in cluster lines (`unit_cost`) but is only visible when drilling into individual item clusters. There's no aggregate view showing whether a quote is profitable and which items are driving or dragging margin.

## Solution

A collapsible "Profitability" section below the existing Quote Summary card on the Quote Details tab. Internal-only — never rendered on PDF or customer-facing output.

## Data Source

All data is already loaded client-side. `fetchQuote()` returns items with nested `quote_item_clusters → quote_cluster_lines`. Each cluster line has `unit_cost` and `qty`. No new API calls or database columns needed.

### Cost Calculation Per Item

Filter to `item.item_type === 'priced'` only — headings and notes are excluded from all calculations.

For each priced `QuoteItem`:

1. Iterate its `quote_item_clusters[]`
2. For each cluster, sum `cluster_line.qty × (cluster_line.unit_cost ?? 0)` across all `quote_cluster_lines[]`. Note: `unit_cost` is nullable — treat `null` as `0`.
3. That sum is the **cluster cost subtotal**
4. The cluster's sell contribution uses the existing markup: `cost_subtotal + (cost_subtotal × markup_percent / 100)` — but for margin purposes we only care about the raw cost
5. **Item total cost** = sum of all cluster cost subtotals
6. **Item revenue** = `item.qty × item.unit_price`
7. **Item margin** = `(revenue - cost) / revenue × 100`
8. **Zero-revenue edge case**: if revenue is 0 (qty or unit_price is 0), show margin as "N/A" and exclude from aggregate margin calculation

Note: `include_in_markup` on cluster lines affects markup calculation but not raw cost — all lines contribute to cost regardless. Overhead lines with `overhead_cost_type: 'percentage'` have pre-computed `unit_cost` values, so `qty × unit_cost` works uniformly for all line types.

Quote-level totals are the sum across all costed priced items. Use the project's existing `formatCurrency()` helper for all currency display.

### Items Without Costing Data

An item "has costing" if it has at least one cluster with at least one cluster line where `unit_cost` is not null. Items without costing data are shown in the per-item breakdown **greyed out** with a ⚠ warning icon and "No cost data" in place of margin. They are excluded from the aggregate margin calculation to avoid inflating the percentage.

## UI Design

### Collapsed State

A single row below the Quote Summary card:

```
▶ Profitability    Margin: 37.8% · R 3,540 profit
```

- Left: chevron icon + "Profitability" label
- Right: margin percentage (green if positive, red if negative) + absolute profit amount
- If no items have costing data: show "No cost data" instead of numbers
- Clicking anywhere on the row toggles expansion

### Expanded State

```
▼ Profitability

┌─────────────────────────────────────────────┐
│  [Donut Chart]     Revenue    R 9,360.00    │
│  37.8% center      Cost       R 5,820.00    │
│                    ─────────────────────     │
│                    Profit     R 3,540.00     │
│                                             │
│  ████████████████████████████░░░░░░░░░░░░░  │
│  ← cost (red) →  ← margin (green) →        │
│                                             │
│  PER ITEM                                   │
│  ───────────────────────────────────────     │
│  Kitchen Cabinets  R6,200  R3,720  40.0%    │
│  ███████████░░░░░░░░                        │
│  Countertop        R3,160  R2,100  33.5%    │
│  ████████████░░░░░░                         │
│  ⚠ Delivery        R800     —     No cost   │  ← greyed out
└─────────────────────────────────────────────┘
```

### Visual Elements

1. **Donut chart** — SVG, cost (red/`destructive`) vs margin (green/`#4ade80`) as proportions of revenue. Margin % displayed in center. Small — ~64-80px diameter.

2. **Summary numbers** — Revenue, Cost, Profit in a compact column beside the donut. Profit line is bold. Cost colored red, profit colored green.

3. **Stacked bar** — Full-width horizontal bar below the summary. Cost portion in red, margin in green. 6-8px tall, rounded.

4. **Per-item breakdown** — Table with columns: Item description (truncated), Sell total, Cost total, Margin %.
   - Each row has a mini stacked bar (6px) showing individual cost/margin split
   - Only priced items shown (headings/notes excluded)
   - Items without costing: greyed text, ⚠ icon, "No cost data" in margin column
   - Sorted by item position (same as line items table)

### Color Palette

- Cost: `text-destructive` / red-400 (`#f87171`)
- Profit/Margin (positive): green-400 (`#4ade80`)
- Profit/Margin (negative): red-400 with "negative margin" warning
- No-cost items: `text-muted-foreground` with reduced opacity

### Negative Margin Handling

If total cost exceeds revenue:
- Donut shows 100% red with negative percentage in center
- Stacked bar is fully red
- Profit number shown in red as negative value

## Component Architecture

### New File

`components/features/quotes/QuoteProfitabilityCard.tsx`

### Props

```typescript
interface QuoteProfitabilityCardProps {
  items: QuoteItem[];   // Already loaded with nested clusters/lines
}
```

### Internal State

- `isExpanded: boolean` — collapse/expand toggle, default `false`

### Pure Computation

A `useMemo` hook computes all profitability data from items:

```typescript
interface ItemProfitability {
  id: string;
  description: string;
  revenue: number;        // qty × unit_price
  cost: number;           // sum of cluster line costs
  profit: number;         // revenue - cost
  marginPercent: number;  // (profit / revenue) × 100
  hasCosting: boolean;    // has at least one cluster with lines
}

interface QuoteProfitability {
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  marginPercent: number;
  items: ItemProfitability[];
  hasAnyCosting: boolean;  // at least one item has cost data
}
```

### Integration Point

In `EnhancedQuoteEditor.tsx`, render `<QuoteProfitabilityCard items={items} />` inside the right-column wrapper `<div>`, between the Quote Summary `</section>` closing tag and the wrapper `</div>` closing tag. This keeps the profitability card in the same column as the quote summary.

## Scope Exclusions

- No PDF rendering of profitability data
- No database changes
- No new API endpoints
- No per-cluster breakdown (users can drill into clusters via the existing cluster grid)
- No historical margin tracking or comparison
- No target margin / threshold alerts (future enhancement)
