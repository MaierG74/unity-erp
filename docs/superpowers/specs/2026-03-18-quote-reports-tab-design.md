# Quote Reports Tab — Design Spec

**Date:** 2026-03-18
**Status:** Draft
**Location:** Quote detail page, new "Reports" tab

## Problem

The profitability card on the Quote Details tab gives a quick margin snapshot, but there's no space for deeper analysis — cost composition by category, per-item cost breakdowns, or markup consistency. Users need a dedicated space for quote-level reporting.

## Solution

A new "Reports" tab on the quote detail page (4th tab, after Attachments). Contains 5 report sections in a responsive grid layout. The existing collapsible profitability card on the Quote Details tab becomes a clickable link that navigates to the Reports tab.

All data is computed client-side from the already-loaded `QuoteItem[]` with nested `quote_item_clusters → quote_cluster_lines`. No new API calls or database changes.

## Data Model

### Existing Fields Used

- `QuoteItem.qty`, `QuoteItem.unit_price`, `QuoteItem.item_type`, `QuoteItem.description`
- `QuoteClusterLine.qty`, `QuoteClusterLine.unit_cost` (nullable), `QuoteClusterLine.line_type`
- `QuoteItemCluster.markup_percent`

### Cost Category Mapping

The `line_type` field on `QuoteClusterLine` maps to display categories:

| `line_type` | Display Category | Chart Color |
|-------------|-----------------|-------------|
| `component` | Materials | Blue (`#60a5fa`) |
| `manual` | Materials | Blue (`#60a5fa`) |
| `labor` | Labor | Purple (`#c084fc`) |
| `overhead` | Overhead | Amber (`#fbbf24`) |

### Computation Extensions

Extend the existing `lib/quotes/profitability.ts` module with additional interfaces and computation:

```typescript
interface CostBreakdown {
  materials: number   // sum of component + manual lines
  labor: number       // sum of labor lines
  overhead: number    // sum of overhead lines
  total: number       // materials + labor + overhead
}

interface ItemReportData {
  id: string
  description: string
  qty: number
  revenue: number           // qty × unit_price
  costBreakdown: CostBreakdown  // per-unit costs × qty
  perUnitCost: number       // raw cluster subtotal (before qty multiplication)
  markupPercent: number     // cluster markup_percent (weighted avg if multiple clusters)
  markupAmount: number      // per-unit: sell price - per-unit cost
  sellPrice: number         // unit_price
  marginPercent: number     // (revenue - total cost) / revenue × 100
  hasCosting: boolean
}

interface QuoteReportData {
  // Existing profitability fields
  totalRevenue: number
  totalCost: number
  totalProfit: number
  marginPercent: number
  hasAnyCosting: boolean

  // Cost composition (aggregated across all costed items)
  costBreakdown: CostBreakdown

  // Per-item detail
  items: ItemReportData[]

  // Health stats
  totalItems: number        // count of priced items
  costedItems: number       // items with hasCosting = true
  uncostedItems: number     // items without costing
  avgMargin: number         // average margin across costed items
  lowestMarginItem: { description: string; marginPercent: number } | null
  highestValueItem: { description: string; sellPrice: number } | null
}
```

### Cost Computation Per Item

For each priced `QuoteItem`:

1. Filter to `item_type === 'priced'` only
2. Iterate `quote_item_clusters[]` → `quote_cluster_lines[]`
3. For each line, categorize by `line_type` and sum `line.qty × (line.unit_cost ?? 0)`:
   - `component` or `manual` → `materials`
   - `labor` → `labor`
   - `overhead` → `overhead`
4. The per-unit cost sums are the `CostBreakdown` before qty multiplication
5. Multiply each category by `item.qty` to get the item's total `CostBreakdown`
6. `perUnitCost` = sum of per-unit category costs (before qty multiplication)
7. `markupAmount` = `item.unit_price - perUnitCost`
8. `markupPercent`: if item has one cluster, use its `markup_percent`; if multiple, compute weighted average by cluster cost subtotal; if no clusters, `NaN`
9. Null `unit_cost` values treated as 0; a line with null `unit_cost` does not count toward `hasCosting`

### Edge Cases

- Zero revenue (qty=0 or unit_price=0): margin shown as "N/A", excluded from aggregates
- No costed items: all sections show "No cost data" empty states
- Negative margins: red coloring, no special capping
- Items without costing: greyed out in tables with ⚠ icon, excluded from aggregate calculations
- All cost categories zero except one: donut/bars still render correctly (0-width segments)

## UI Design

### Layout

Two-column responsive grid. Full-width cards span both columns. On narrow screens (<900px), falls back to single column.

```
┌─────────────────────────────────────────────────────┐
│  QUOTE HEALTH (full width stats bar)                │
├────────────────────────┬────────────────────────────┤
│  PROFITABILITY         │  COST COMPOSITION          │
│  OVERVIEW              │                            │
│  (donut + summary)     │  (donut + horiz bars)      │
├────────────────────────┴────────────────────────────┤
│  PER-ITEM COST BREAKDOWN (full width table)         │
├─────────────────────────────────────────────────────┤
│  MARKUP ANALYSIS (full width: table + waterfall)    │
└─────────────────────────────────────────────────────┘
```

### Section 1: Quote Health (full width)

5-stat bar in a row:

| Stat | Content | Styling |
|------|---------|---------|
| Line Items | Count of priced items | Neutral (white) |
| Costed | Count with costing data | Green value |
| Missing Cost | Count without costing | Amber value (or green "0" if all costed) |
| Avg Margin | Weighted average margin % with traffic light dot | Green >30%, amber 15-30%, red <15% |
| Lowest Margin | Item description + margin % | Neutral value, muted label |

Each stat is a small card with large value on top, uppercase label below.

### Section 2: Profitability Overview (left card)

- **Donut chart** (120px): cost (red `#f87171`) vs margin (green `#4ade80`), margin % in center with "margin" label below
- **Summary column**: Revenue, Total Cost (red), Gross Profit (green, bold) with separator line
- **Stacked bar** below with legend: "Cost 65.7%" / "Margin 34.3%"

### Section 3: Cost Composition (right card)

- **Donut chart** (120px): Materials (blue `#60a5fa`) / Labor (purple `#c084fc`) / Overhead (amber `#fbbf24`), total cost in center
- **Horizontal bar chart**: 3 bars, each showing category label, filled bar with percentage text, and absolute value
- Bar widths proportional to percentage of total cost

### Section 4: Per-Item Cost Breakdown (full width)

Table columns: Item | Materials | Labor | Overhead | Total Cost | Sell Price | Margin | Cost Split

- **Cost Split column**: mini stacked bar (6px tall) with blue/purple/amber segments showing materials/labor/overhead proportions
- Items without costing: greyed row (opacity-50), ⚠ icon, dashes in cost columns, "No cost" in margin column
- Sorted by item position (same as line items table)

### Section 5: Markup Analysis (full width)

Split into two halves:

**Left: Markup table**
Columns: Item | Raw Cost (per-unit) | Markup | Sell Price | Markup %
- Markup % shown as colored badge: green (`>40%`), amber (`20-40%`), red (`<20%`)
- Raw Cost = per-unit cluster cost subtotal
- Markup = sell price - raw cost

**Right: Waterfall chart**
Shows price build-up for the highest-value item:
- 3 vertical bars: Raw Cost (red gradient) → Markup (amber gradient) → Sell Price (green gradient)
- Bar heights proportional to values
- Labels above bars with values, labels below with category names
- Arrow connectors between bars (→ and =)

### Existing Profitability Card Changes

The collapsible profitability card on the Quote Details tab:
- **Keep collapsed teaser** (chevron + "Profitability" + margin/profit summary)
- **Remove expanded content** (donut, per-item table, etc. — now lives in Reports tab)
- **Clicking the teaser switches to the Reports tab** instead of expanding inline

### Color Palette

| Element | Color |
|---------|-------|
| Cost / negative | Red `#f87171` |
| Profit / positive margin | Green `#4ade80` |
| Materials | Blue `#60a5fa` |
| Labor | Purple `#c084fc` |
| Overhead | Amber `#fbbf24` |
| Muted text | `text-muted-foreground` |
| Card background | `bg-muted/30` with `border-border/50` |
| Stat card inner | Darker bg (`#12141c` equivalent in Tailwind) |
| Traffic light glow | Colored `box-shadow` matching dot color |

### Currency Formatting

Use existing `formatCurrency()` from `lib/format-utils.ts` for all currency values.

## Component Architecture

### New Files

| File | Responsibility |
|------|---------------|
| `lib/quotes/report-data.ts` | Extended computation: `computeQuoteReportData(items)` returning `QuoteReportData` |
| `tests/quote-report-data.test.ts` | Unit tests for the extended computation |
| `components/features/quotes/QuoteReportsTab.tsx` | Tab container: 2-col grid layout, renders all 5 sections |
| `components/features/quotes/reports/QuoteHealthBar.tsx` | Section 1: stats bar |
| `components/features/quotes/reports/ProfitabilityCard.tsx` | Section 2: donut + summary + stacked bar |
| `components/features/quotes/reports/CostCompositionCard.tsx` | Section 3: composition donut + horizontal bars |
| `components/features/quotes/reports/PerItemCostTable.tsx` | Section 4: detailed table with mini bars |
| `components/features/quotes/reports/MarkupAnalysisCard.tsx` | Section 5: markup table + waterfall chart |

### Modified Files

| File | Change |
|------|--------|
| `components/quotes/EnhancedQuoteEditor.tsx` | Add "Reports" tab to TabsList; add TabsContent rendering `QuoteReportsTab`; modify profitability card click to switch tab |
| `components/features/quotes/QuoteProfitabilityCard.tsx` | Remove expanded content; clicking teaser calls `onNavigateToReports` callback instead of expanding |

### Props Flow

```
EnhancedQuoteEditor
  ├── QuoteProfitabilityCard
  │     props: { items: QuoteItem[], onNavigateToReports: () => void }
  │
  └── QuoteReportsTab
        props: { items: QuoteItem[] }
        computes: QuoteReportData via useMemo
        ├── QuoteHealthBar        props: { data: QuoteReportData }
        ├── ProfitabilityCard     props: { data: QuoteReportData }
        ├── CostCompositionCard   props: { data: QuoteReportData }
        ├── PerItemCostTable      props: { items: ItemReportData[] }
        └── MarkupAnalysisCard    props: { items: ItemReportData[] }
```

### SVG Charts

All charts are pure inline SVG — no external chart library. This matches the existing donut chart pattern in the profitability card. Charts:
- 2 donut charts (SVG `<circle>` with `stroke-dasharray`)
- 2 stacked bars (CSS `flex` with percentage widths)
- 3 horizontal bars (CSS widths)
- Per-row mini bars (CSS flex)
- 1 waterfall chart (CSS flex with bar heights + gradient backgrounds)

## Scope Exclusions

- No PDF rendering of report data
- No database changes or new API endpoints
- No chart animation (static renders)
- No export/download of report data
- No configurable margin thresholds (hardcoded: green >30%, amber 15-30%, red <15%)
- No drill-down from report items to cluster detail (users use Line Items tab for that)
