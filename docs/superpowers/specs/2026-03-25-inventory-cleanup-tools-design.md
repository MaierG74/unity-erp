# Inventory Cleanup Tools — Design Spec

**Date:** 2026-03-25
**Branch:** `codex/local-transactions-explorer` (extends current work)
**Priority:** Urgent — users need these tools in the next few days to clean up drifted inventory

---

## Problem

The factory floor team has drifted out of stock. Components weren't being issued consistently, duplicate master components were created (e.g., "L650 Base ONCE OFF PRICE" alongside "L650"), and a major manual recount is underway. The current workflow for correcting stock is painfully slow: navigate to each component's detail page, click through to the Transactions tab, click Stock Adjustment, fill in the form, go back, find the next component, repeat.

## Goal

Provide low-click tools on the Transactions Explorer page so users can:
1. Quickly adjust stock for any component without leaving the page
2. Transfer stock between components to fix duplicate SKU mistakes
3. Print count sheets for physical recounting
4. Batch-edit stock levels for an entire recount in one pass
5. Disable obsolete/duplicate components

---

## Feature 1: Quick Adjust Button on Component Group Rows

### What

When the Transactions tab is grouped by component, each component header row gets an always-visible **"Adjust"** button.

### Behavior

- Button sits between the transaction count and the Stock figure on the component header row
- Clicking opens the existing `StockAdjustmentDialog` (`components/features/inventory/component-detail/StockAdjustmentDialog.tsx`), pre-filled with:
  - `componentId` from the group
  - `componentName` (internal_code)
  - `currentStock` from the stock summary
- Dialog opens as a sheet/modal overlay — user stays on the transactions page
- On successful adjustment, the transactions query invalidates and refetches — the new ADJUSTMENT transaction appears and the stock figure updates

### Auto-Advance

After a successful adjustment, instead of just closing the dialog, offer a "Save & Next" button alongside the normal "Record Adjustment" button. "Save & Next" submits the adjustment and immediately opens the dialog for the **next component** in the visible list. This lets users go component-by-component without touching the table.

### Files Affected

- `TransactionsGroupedTable.tsx` — add Adjust button to component group header
- `StockAdjustmentDialog.tsx` — accept optional `onNext` callback for auto-advance
- `TransactionsExplorer.tsx` — manage dialog state, compute "next component" from visible groups

---

## Feature 2: Stock Transfer Mode

### What

A 4th adjustment type inside the Stock Adjustment dialog: **Set To | Add | Subtract | Transfer**

### Behavior

When "Transfer" is selected:
- The quantity input changes to a "Transfer Quantity" field
- A **"Transfer To"** component picker appears (searchable select, same pattern as existing component pickers in the app)
- The reason dropdown and notes field remain
- A summary line shows: `"Transfer 50 units: L650 Base (ONCE OFF PRICE) → L650"`

### Negative Stock Guard

- If transfer quantity exceeds the source component's current stock, the submit button disables with message: "Insufficient stock (current: X)"
- Below the message, a checkbox: "Override — allow negative balance"
- When checked, the button re-enables with an amber warning style

### Backend

New Postgres RPC: `transfer_component_stock(p_from_component_id, p_to_component_id, p_quantity, p_reason, p_notes, p_user_id, p_org_id)`

The RPC atomically:
1. Inserts a negative `inventory_transactions` row on the source component (type: TRANSFER)
2. Inserts a positive `inventory_transactions` row on the destination component (type: TRANSFER)
3. Updates `inventory.quantity_on_hand` for both components
4. Links both transactions via a shared `transfer_ref` UUID

New transaction type: **TRANSFER** — added to the `transaction_types` table so it appears distinctly in reporting and the type filter.

### Files Affected

- `StockAdjustmentDialog.tsx` — add Transfer mode, component picker, negative guard
- New migration: `transfer_component_stock` RPC + TRANSFER transaction type
- `use-transactions-query.ts` — no changes needed (TRANSFER type flows through naturally)

---

## Feature 3: Remove In/Out Totals from Component Group Headers

### What

Remove the green `+X` and red `-X` movement totals from component group header rows. They clutter the view and aren't useful during stock cleanup.

### Layout After Change

```
> L650 — Nylon Base CTW38/50 castors 640mm (32)  [Adjust] [...]  Stock: 288  On Order: 0  Reserved: 0
```

The `[...]` is a small overflow/kebab menu (see Feature 6: Disable Component).

### What Stays

- In/out totals remain in the **toolbar summary** (`1,582 txns +102,928 -28,776`)
- In/out totals remain visible in **expanded transaction rows**
- Totals are still available in the print transactions view

### Files Affected

- `TransactionsGroupedTable.tsx` — remove `sumIn`/`sumOut` display from component divider rows

---

## Feature 4: Printable Stock Count Sheet

### What

A new "Print Count Sheet" option alongside the existing "Print Transactions" in the Print button dropdown.

### Count Sheet Layout

One row per component, designed for clipboard use on the warehouse floor:

| Code | Description | Category | System Stock | Counted | Difference |
|------|-------------|----------|:------------:|:-------:|:----------:|
| L650 | Nylon Base CTW38/50 640mm | Base | 288 | _______ | _______ |
| T278-S&T | Swivel & Tilt Mechanism | Mechanism | 15 | _______ | _______ |

- **Counted** and **Difference** columns: blank — staff write in by hand
- Sorted alphabetically by component code
- Header: org name, print date/time, printed by user, active filters summary
- Footer: `Counted by: _____________ Date: _____________ Signature: _____________`

### Respects Current Filters

The count sheet prints whatever is currently filtered. If the user filters to category "Bases", only base components appear on the sheet. This avoids building a separate filter UI.

### On-Order Section

A second section at the bottom: **"On Order — Not Yet Received"**

Lists components that have open purchase orders (on_order > 0) but zero transactions in the current date range. These are items that may have been physically received but not checked into the system. Same columns but System Stock shows as 0 and an "On Order: X" note.

This section pulls component IDs from the stock summary where `onOrder > 0` and the component doesn't appear in the main transaction results.

### Print Mechanism

Uses the same `window.print()` + hidden print div approach as the existing `PrintView.tsx`. A new `CountSheetPrintView` component renders the count sheet layout in a `hidden print:block` div.

### Files Affected

- New: `CountSheetPrintView.tsx` in `components/features/inventory/transactions/`
- `TransactionsToolbar.tsx` — split Print button into dropdown with two options
- `TransactionsExplorer.tsx` — pass data to CountSheetPrintView, fetch on-order components

---

## Feature 5: Batch Adjust Mode (Inline Editing)

### What

A "Batch Adjust" button in the toolbar that transforms the grouped-by-component view into an inline spreadsheet-style stock editing mode.

### Activation

- Toolbar button: "Batch Adjust"
- Automatically switches to component grouping if not already
- Collapses all groups (transaction detail hidden — focus on stock levels)
- The toolbar transforms to show: changed count, "Apply All Adjustments", "Cancel"

### Inline Editing

Each component row changes from:

```
> L650 — Nylon Base (32)  Stock: 288  On Order: 0  Reserved: 0
```

To:

```
> L650 — Nylon Base    System: 288  Counted: [___]  Diff: —    On Order: 0
```

- **System**: read-only, shows current stock
- **Counted**: editable input field, initially blank
- **Diff**: computed in real-time (`counted - system`), shown in green (positive) or red (negative). Blank when Counted is empty.
- Rows where Counted differs from System get a subtle highlight (e.g., amber left border)
- Rows where Counted matches System get a green checkmark

### Keyboard Navigation

- **Tab** moves focus to the next row's Counted field
- **Shift+Tab** moves to the previous row
- **Enter** in a field also advances to the next row
- Entire recount can be done keyboard-only

### Apply All

Clicking "Apply All Adjustments" opens a confirmation dialog:
- Summary table: Component | System Stock | Counted | Adjustment (only rows that changed)
- A single **reason dropdown** that applies to all adjustments (default: "Cycle Count")
- Optional notes field
- "Confirm X Adjustments" button

Each changed row creates an individual ADJUSTMENT transaction (same as the single-adjust flow), so the audit trail is granular per-component.

### Cancel

Discards all unapplied changes and exits batch mode.

### Files Affected

- New: `BatchAdjustMode.tsx` in `components/features/inventory/transactions/`
- New: `BatchAdjustConfirmDialog.tsx` for the confirmation summary
- `TransactionsGroupedTable.tsx` — accept `batchMode` prop, render editable rows
- `TransactionsToolbar.tsx` — add Batch Adjust button, show batch toolbar when active
- `TransactionsExplorer.tsx` — manage batch state, collect edits, submit

---

## Feature 6: Disable Component

### What

An action to mark a component as inactive, accessible from the Transactions page during cleanup.

### Database Change

Add `is_active boolean NOT NULL DEFAULT true` to the `components` table. No migration of existing data needed — all existing components default to active.

### UI on Transactions Page

A small kebab/overflow menu (`...`) on each component group header row, with options:
- **Disable Component** — sets `is_active = false`
- (Future: Merge Component, View Detail, etc.)

When clicked, a brief confirmation: "Disable [code]? It will be hidden from PO creation, BOM pickers, and stock issue. Historical data is preserved."

### Behavior When Disabled

- **Hidden from**: component search/select pickers (PO creation, BOM editor, stock issue, cutlist component picker), Components tab default view
- **Visible in**: Transactions explorer (with a muted "Inactive" badge on the group header), component detail page (if navigated to directly), historical reports
- **Components tab**: Add a toggle/filter to show inactive components (default: hidden)
- **Re-enable**: Can be re-activated from the component detail page or the kebab menu

### Files Affected

- New migration: add `is_active` column to `components`
- Update `inventory_transactions_enriched` view to include `is_active`
- `TransactionsGroupedTable.tsx` — add kebab menu, inactive badge
- All component picker/search queries — add `.eq('is_active', true)` filter
- `ComponentsTab.tsx` — add inactive filter toggle

---

## Transaction Type Addition

Add a new row to `transaction_types`:
- `type_name`: "TRANSFER"
- Used by the stock transfer feature
- Distinct from ADJUSTMENT in reporting and filtering

---

## Implementation Priority

Given the urgency, suggested build order:

1. **Feature 3** (remove in/out totals) — 15 min, instant declutter
2. **Feature 1** (quick adjust button + auto-advance) — core cleanup tool
3. **Feature 2** (stock transfer) — fixes the duplicate SKU problem
4. **Feature 5** (batch adjust mode) — the big recount accelerator
5. **Feature 4** (print count sheet) — supports the physical counting workflow
6. **Feature 6** (disable component) — cleanup of obsolete items

Features 1-3 unblock the immediate crisis. Features 4-6 improve the ongoing workflow.
