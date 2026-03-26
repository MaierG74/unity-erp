# Batch Markup Update — Design Spec

**Date:** 2026-03-26
**Component:** Quote Items Table (`QuoteItemsTable.tsx`)

## Problem

When a customer says a quote is too expensive, the user needs to adjust markups across many items. Currently, markup is edited one cluster at a time by expanding each item — tedious for large quotes with 10+ items.

## Solution

A **batch markup mode** on the quote items table. The user enters a selection mode, picks items, sets a new markup (% or fixed R), previews the price impact, and applies with a confirmation step.

## User Flow

1. Click **Batch Markup** button in the toolbar (next to Add Item)
2. Table enters batch mode:
   - **Attachments** and **Actions** columns are hidden
   - Three new columns appear: **Markup**, **Profit**, **Checkbox**
   - A toolbar bar appears above the table with: select-all checkbox, item count, markup type toggle (% / R), value input, Preview button, Cancel button
3. User checks items (or select all), enters new markup value
4. Click **Preview** — table updates to show:
   - **Unit Price** cell: strikethrough old price above bold purple new price
   - **Total** cell: updated to qty × new price
   - **Markup** column: `35→30%` transition display for selected items, unchanged markup for unselected
   - **Profit** column: new profit amount per item (in green)
   - Footer row: old quote total (strikethrough) → new quote total, total profit sum
5. Click **Apply** (replaces Preview button after preview is shown) — confirmation dialog appears:
   - "Apply Batch Markup?"
   - "Updating N items to X% markup" (or "R X fixed markup")
   - Old quote total → New quote total
   - Difference amount (red if decrease, green if increase)
   - Cancel / Apply Changes buttons
6. Confirm → persists changes, exits batch mode
7. **Cancel** at any point → exits batch mode, no changes saved

## Data Model

No schema changes required. The feature operates on existing structures:

- **`quote_item_clusters.markup_percent`** — the field being batch-updated
- **Cluster subtotal** — `SUM(line.qty × line.unit_cost)` for all lines in the cluster
- **Markup amount** — percentage mode: `subtotal × (markup_percent / 100)`, fixed mode: `markup_percent` (the field stores the fixed amount)
- **New unit price** — `subtotal + markup_amount` (pushed to `quote_items.unit_price`)
- **Profit** — equals the markup amount (price minus cost)

Each item has exactly one cluster in practice ("Costing Cluster"). The batch operation targets `item.quote_item_clusters[0]`.

## Column Layout

### Normal Mode (unchanged)
| Controls (w-20) | Description (min-w-250) | Qty (w-32) | Unit Price (w-36) | Total (w-40) | Attachments (w-28) | Actions (w-40) |

### Batch Mode
| Controls (w-20) | Description (min-w-250) | Qty (w-32) | Unit Price (w-36) | Total (w-40) | Markup (w-16) | Profit (w-28) | ☑ (w-10) |

- **Markup column**: shows current markup %. After preview, selected items show `old→new%` in amber. Unselected items show their current % dimmed.
- **Profit column**: shows profit amount (markup in rands) per item in green. Calculated from cluster subtotal and markup.
- **Checkbox column**: header has select-all checkbox. Individual row checkboxes for priced items only.
- **Unit Price cell** (after preview): stacked layout — strikethrough old price (muted, smaller) above bold new price (purple).

## Item Filtering in Batch Mode

- **Priced items** (`item_type === 'priced'`) with at least one cluster: fully interactive, selectable
- **Priced items without clusters**: shown but checkbox disabled, dimmed — no cost data to calculate from
- **Heading/note items** (`item_type === 'heading' | 'note'`): rendered but greyed out, no checkbox — they have no pricing

## Toolbar

Rendered above the table when batch mode is active. Contains:

```
[☑ All] [3 of 5 selected] | [% ▾ / R ▾] [___30___] [Preview] .............. [Cancel]
```

- **Select All**: checkbox that toggles all eligible items
- **Count**: "N of M selected" (M = eligible priced items with clusters)
- **Type toggle**: `<Select>` with "%" and "R (fixed)" options
- **Value input**: numeric input for the new markup value
- **Preview button**: calculates and shows new prices without saving. Changes to "Apply" after preview is shown.
- **Cancel**: exits batch mode, discards all preview state

## Preview Calculation (client-side only)

For each selected item:
1. Get cluster subtotal: `SUM(line.qty × line.unit_cost)` from `item.quote_item_clusters[0].quote_cluster_lines`
2. Calculate new markup amount:
   - Percentage: `subtotal × (newMarkupValue / 100)`
   - Fixed: `newMarkupValue`
3. New unit price = `subtotal + markupAmount`
4. New total = `item.qty × newUnitPrice`
5. Profit = `markupAmount`

All preview data is held in component state — nothing is persisted until Apply is confirmed.

## Apply Operation

On confirm:
1. For each selected item, in parallel:
   - `updateQuoteItemCluster(clusterId, { markup_percent: newValue })` — update cluster markup
   - `updateQuoteItem(itemId, { unit_price: newUnitPrice, total: newTotal })` — update item price
2. Call `onItemsChange()` with updated items array for optimistic UI
3. Exit batch mode
4. Show success toast: "Updated markup on N items"

## State Management

New state in `QuoteItemsTable`:

```typescript
const [batchMode, setBatchMode] = useState(false);
const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
const [batchMarkupType, setBatchMarkupType] = useState<'percentage' | 'fixed'>('percentage');
const [batchMarkupValue, setBatchMarkupValue] = useState<string>('');
const [previewData, setPreviewData] = useState<Map<string, {
  oldPrice: number;
  newPrice: number;
  newTotal: number;
  oldMarkup: number;
  profit: number;
}> | null>(null);
const [showConfirmDialog, setShowConfirmDialog] = useState(false);
```

## Confirmation Dialog

Standard `<Dialog>` with:
- Title: "Apply Batch Markup?"
- Body: "Updating N items to X% markup" (or "R X fixed markup")
- Summary table:
  - Old quote total (strikethrough)
  - New quote total (bold)
  - Difference (red if negative, green if positive)
- Footer: Cancel (secondary) + Apply Changes (primary)

## Edge Cases

- **Empty markup input**: Preview button disabled until a value is entered
- **Zero markup**: allowed — effectively removes all markup (cost price)
- **No items selected**: Preview button disabled
- **Item has no cluster lines**: skip in calculation, show "No cost data" in Markup column
- **Markup type change during preview**: clears preview state, user must Preview again
- **Selection change during preview**: clears preview state for consistency
