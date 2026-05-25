# Quotes Feature Plan: Non-Priced / Heading Items

Status: **Implemented** (2026-02-04)

## Summary
Add a line-item type that can be used as a heading or descriptive block inside a quote. These items are not priced (no qty/unit/total) but can still carry text and attachments (e.g., floor plans or reference images). The default remains a priced quote item.

## Quote Status Lifecycle
- `draft`: Quote is still being prepared internally.
- `sent`: Quote has been emailed to the customer and is awaiting follow-up.
- `ordered`: Quote has been converted into a customer order.

Current behavior:
- Users can edit the quote status from the quote detail screen.
- Sending a quote email automatically moves the quote to `sent` unless it is already `ordered`.
- Creating an order from a quote automatically moves the quote to `ordered`.

Legacy statuses such as `in_progress`, `won`, `lost`, `accepted`, `rejected`, and `expired` are no longer part of the supported quote workflow.

## Swap and Surcharge

Snapshot-based quote product rows can carry a frozen `bom_snapshot` and `surcharge_total` on `quote_items`. A quote-side swap is independent from any related order: converting a quote copies the current snapshot and surcharge total once into `order_details`, and later quote or order edits do not sync back and forth.

The Add Item Product tab now creates snapshot-based quote product rows by default when the selected product has a BOM or cutlist material groups. The `Explode BOM into Costing Cluster` checkbox remains as an opt-in legacy path for estimator costing clusters. Products without a BOM or cutlist groups should be added through the Manual tab so the estimator can enter the line price directly.

The legacy option-set selectors were retired from the Add Item Product tab in Phase E of the swap/surcharge rollout. Active quote creation no longer writes `quote_items.selected_options`; the column remains only for historical reads until the POL-78 cleanup cycle removes the unused option-set tables and no-op column.

The quote line's base price remains under estimator control. Snapshot-based product rows expose a per-BOM-row swap action that can choose an alternative same-category component or remove the component, with a zero, positive, or negative commercial surcharge. The swap dialog supports fixed Rand surcharges and percentage surcharges; fixed Rand values are stored as the existing per-unit `surcharge_amount`, while percentage values are resolved at apply time against the quote line's current unit selling price (`unit_price * pct / 100`, rounded to cents) and then stored in the same per-unit snapshot field. Because the percentage metadata is not persisted, reopening a saved swap shows the resolved amount as a fixed Rand surcharge. Applying a swap updates `quote_items.bom_snapshot` and `quote_items.surcharge_total` together; the database quote totals trigger then recomputes subtotal and grand total from the base item total plus surcharge.

Customer-facing quote views render the parent product line at its base price, then indented child rows for non-zero BOM swap surcharges and quote-side cutlist material surcharges. Quote PDF preview/download and quote email attachments use the same parent-plus-child rendering; child rows are display-only and do not double-count beyond `quote_items.surcharge_total`. Legacy exploded costing cluster lines continue to render flat and keep their existing inline cluster editing behavior.

Quote-side cutlist material configuration reuses the shared order-side material dialog and stores the customer-specific choices on `quote_items.cutlist_material_snapshot`, `cutlist_primary_material_id`, `cutlist_primary_backer_material_id`, `cutlist_primary_edging_id`, `cutlist_part_overrides`, and the customer-facing cutlist surcharge fields. Saves go through the authenticated quote cutlist-material route, which rebuilds the effective material snapshot server-side from the selected primary board/backer/edging, per-part overrides, and board-edging pair lookup; the database trigger owns `cutlist_surcharge_resolved` and `surcharge_total`. These `quote_items.cutlist_surcharge_*` fields are for commercial quote output and totals only, not for internal supplier/color cost adjustments.

Snapshot-based quote product rows now get an internal costing tree without requiring the estimator to choose the legacy **Explode BOM into Costing Cluster** path. The tree is backed by the existing quote-owned `quote_item_clusters` / `quote_cluster_lines` rows, but the quote editor renders them as grouped costing detail instead of the old flat cluster grid. Groups are Board materials, Edging, Hardware/components, Labour, Overhead, and Commercial/markup/surcharge. Board and edging rows derive material identity from the quote line's current `cutlist_material_snapshot` effective fields, while the saved product cutlist costing snapshot remains the usage/billing template. They preserve the captured source unit cost in `quote_cluster_lines.unit_price` and store quote-only edits in `quote_cluster_lines.unit_cost`, so a quoting user can adjust board or edging prices for this quote without updating products, components, supplier prices, or product cutlist costing templates. When product-add creates quote-owned rows, the primary cluster stores a markup percent from the product default pricelist (`markup_type` / `markup_value`, with the preserved selling price as fallback). When explicit costing initialization creates rows for an older quote item, the stored markup is derived from the preserved customer-facing unit price and captured quote cost subtotal. Quote copy and row duplicate copy existing quote-owned clusters, line costs, surcharge metadata, and `quote_item_clusters.markup_percent` instead of rebuilding from current product prices. The quote line table exposes **Cost Surcharges** to enter a costing-tree mode where editable board/edging rows can carry internal per-unit surcharge metadata on `quote_cluster_lines.cost_surcharge_kind`, `cost_surcharge_value`, `cost_surcharge_label`, and `cost_surcharge_resolved`. Fixed values are Rand per costing unit; percentage values are calculated against the row's source unit cost. Applying or clearing these cost surcharges changes only quote-owned costing rows and margin/profitability views; it does not update `quote_items`, quote totals, or customer-facing PDF/email surcharge rows.

Historic quote safety rules for the costing tree:
- Existing quote line `unit_price`, `total`, and `surcharge_total` are not recalculated when costing detail is created, edited, refreshed from Materials, or adjusted with internal cost surcharges. The costing tree's Commercial group opens by default and includes a **Price builder**: estimators can type markup as a percentage, Rand per unit, or target unit price. **Save markup only** updates only `quote_item_clusters.markup_percent`; **Save markup + update line price** then copies quote cost plus markup into the customer-facing unit price/total through the normal line-price path. Customer-facing material/BOM surcharge fields remain separate.
- Old quote rows without costing cluster lines render as before until a user explicitly clicks **Make costing editable for this quote**.
- The costing baseline is the moment the product row is added, or the moment that explicit initialize action is clicked for an older row. Deltas compare quote costs to that captured source cost, not to the original quote date if the quote predates the snapshot.
- Customer-facing PDF/email output remains parent line plus customer-facing quote surcharge rows only. The costing tree and cost surcharge metadata are internal estimator detail.
- Quote-to-order conversion continues to copy operational BOM/cutlist material snapshots and the current product cutlist costing template to the order line; quote-only costing tree edits are not written back to product or supplier master data.

The quote material dialog remains authoritative for which board/edging material is selected and for any customer-facing material surcharge. The costing tree is authoritative for the quote's internal board/edging cost values and profitability. When a quote Materials snapshot has no explicit edging component for a banded part, costing falls back to the saved product cutlist costing snapshot's edging row for that 16mm/32mm slot, preserving the product's selected edging material and padded metres instead of showing an unassigned edge. Costing clusters store a `<MATERIAL_SIGNATURE_V1:...>` note marker; if current Materials differ, the UI shows a stale warning and an explicit **Refresh costing from current materials** action. Refresh only rewrites cutlist-managed board/edging rows and the marker. Matching same-material quote cost overrides are preserved, changed-material overrides are discarded, and source-cost baselines refresh from the current selected material costs. Matching same-material cost surcharge metadata is preserved on refresh; percentage surcharges recompute from the refreshed baseline, fixed surcharges keep the same per-unit delta, and changed-material surcharge metadata is cleared. Overhead/BOM/labour/manual rows are intentionally preserved in this first cut, so overhead is not recalculated during material refresh.

When the legacy exploded costing-cluster path is used for a product, the quote item must keep its `product_id` and import the product's saved cutlist costing snapshot as tagged costing rows. Board rows use the `primary` or `backer` cutlist slots; edging rows use the existing `band16`/`band32` slots so the quote display can merge them into the costing cluster without manual re-entry. This keeps product cutlist material costs aligned with the product costing tab.

## Goals
- Keep the default item behavior as a priced line item.
- Allow switching an item to a non-priced type (heading or note).
- Preserve attachments for any item type.
- Ensure PDF preview/download/email render the same content.
- Prevent non-priced items from affecting quote totals and VAT.
- Avoid wasting vertical space in the PDF.

## Non-Goals
- No change to image sizing presets (small/medium/large).
- No change to how VAT rates are configured.
- No new external integrations.

## Proposed Item Types
Recommended minimal set:
- `priced` (default): normal line item with qty/unit/total.
- `heading`: bold, larger text; no pricing columns.
- `note`: plain text; no pricing columns.

Notes:
- A pure image-only line can be represented as `note` with an empty description and attachments.
- We can expand types later if needed.

## Data Model Plan
1. Add enum type `quote_item_type` with values `priced`, `heading`, `note`.
2. Add column `quote_items.item_type` (NOT NULL, default `priced`).
3. Update totals and triggers:
   - `update_quote_item_total()` should set `total = 0` when `item_type != 'priced'`.
   - `update_quote_totals()` should sum only `item_type = 'priced'`.
4. Backfill existing records to `priced` (implicit via default).

## UI Plan (Quote Editor)
### Add Item Dialog
- Add a new tab: `Text/Heading`.
- Fields:
  - Text (description)
  - Type selector (Heading / Note)
- Creates a quote item with `item_type` set and `qty/unit_price/total` set to 0.

### Line Items Table
- Add a narrow `Type` selector per row (Priced / Heading / Note).
- For `heading` and `note`:
  - Hide or disable qty/unit inputs.
  - Show dashes in total column.
  - Disable cluster/cutlist controls.
  - Keep attachments and Details dialog available.
- For `priced`:
  - Current behavior unchanged.

### Item Details Dialog
- Add `Item Type` selector (mirrors row selector for accessibility).
- If `heading`:
  - Use bold/heading style in PDF.
- If `note`:
  - Use normal body text style in PDF.

## PDF Plan
### Priced Item
- Keep current layout: name + qty/unit/total on first row, then attachments/bullets below.

### Heading Item
- Render description in bold (slightly larger).
- No qty/unit/total values.
- Attachments/bullets render below.

### Note Item
- Render description in normal text.
- No qty/unit/total values.
- Attachments/bullets render below.

### Totals Section
- Only priced items count toward subtotal/VAT/total.

## Email / Preview / Download Consistency
- All three actions use the same `QuotePDFDocument`, so layout changes apply everywhere.
- The protected quote email send action must call `/api/quotes/[id]/send-email` via the shared authenticated fetch helper so the Supabase bearer token is forwarded explicitly; relying on request cookies alone can surface intermittent `Missing Supabase access token` failures.

## Pricing Behavior
- Costing cluster lines remain the internal cost basis for a priced quote item.
- Adding a product to a quote pre-populates the quote line's unit price from the product's default price-list selling price when one is saved.
- Legacy product explosion into costing clusters must mirror the Product Costing tab: BOM/material lines, cutlist snapshot material lines, configured BOL labor, generated cutlist piecework labor, and overhead all come across as quote costing lines.
- Exploded product quote items keep the full selling price on the parent quote row and apply the saved product markup basis to the costing cluster for estimator-side markup/profit visibility.
- `Update Price` copies the currently displayed cluster total into the line item's `unit_price`; it does not zero the cluster markup.
- If an estimator manually edits `unit_price`, the quote keeps that selling price and recalculates the primary costing cluster's effective `markup_percent` from the current cost subtotal.
- No automatic whole-Rand rounding is applied during price sync; the estimator remains in control of any manual rounding decisions.

## Implementation Steps (Detailed)
1. Schema + triggers
   - Create migration to add `quote_item_type` enum and `item_type` column.
   - Update `update_quote_item_total` and `update_quote_totals` to ignore non-priced items.
2. Type definitions
   - Update `QuoteItem` type in `lib/db/quotes.ts` to include `item_type`.
3. Data flows
   - `createQuoteItem`: skip default cluster creation when `item_type != 'priced'`.
   - `updateQuoteItem`: allow `item_type` updates; when switching to non-priced, set `qty/unit_price/total` to 0.
4. UI
   - Add “Text/Heading” tab in `AddQuoteItemDialog`.
   - Add `Type` selector in `QuoteItemsTable` row and Details dialog.
   - Hide/disable pricing fields for non-priced items and remove cluster actions.
5. PDF renderer
   - Add item-type branches to render heading/note rows without pricing columns.
6. QA / manual verification
   - Mix priced + heading + note items in one quote.
   - Confirm totals/VAT ignore non-priced.
   - Confirm PDF preview/download/email match.

## Risks / Open Questions
- Should switching to non-priced delete existing clusters or just hide them?
  - Recommendation: keep data but hide; do not delete automatically.
- Do we want a dedicated “image-only” type or use `note` + empty description?
  - Recommendation: start with `note` and expand if needed.

## AI Review Checklist
- Verify totals and VAT ignore non-priced items.
- Confirm PDF renders identical for preview/download/email.
- Confirm attachments still display for non-priced items.
- Confirm clusters are not created for non-priced items.
- Confirm UI clearly distinguishes priced vs heading/note items.

## Implementation Summary (2026-02-04)

### Database
- Migration: `db/migrations/20260204_quote_item_types.sql`
- Added `quote_item_type` enum with values: `priced`, `heading`, `note`
- Added `item_type` column to `quote_items` (default: `priced`)
- Updated `update_quote_item_total` trigger: sets total=0 for non-priced items
- Updated `update_quote_totals` trigger: only sums priced items

### TypeScript
- Added `QuoteItemType` type to `lib/db/quotes.ts`
- Added `item_type` field to `QuoteItem` interface
- Updated `createQuoteItem` to skip cluster creation for non-priced items

### UI Changes
- **AddQuoteItemDialog**: Added "Text / Heading" tab with text input and Heading/Note radio selection
- **QuoteItemsTable**:
  - Non-priced rows show "H" or "N" indicator instead of cluster controls
  - Qty/Price/Total columns show dashes for non-priced items
  - Cutlist button hidden for non-priced items
  - Headings render with bold description text
  - Rows with item_type=heading have subtle background highlight
  - Manual `unit_price` edits now keep the entered sell price and recalculate the displayed cluster markup from the current costing subtotal
  - `Update Price` keeps the existing markup logic intact while syncing the cluster total into `unit_price`

### PDF Changes
- **QuotePDFDocument**:
  - Heading items render as bold, larger text spanning full width
  - Note items render as normal text spanning full width
  - Both types can include images/attachments below
  - Only priced items contribute to subtotal/VAT/total
