# Quotes Feature Plan: Non-Priced / Heading Items

Status: **Implemented** (2026-02-04)

## Summary
Add a line-item type that can be used as a heading or descriptive block inside a quote. These items are not priced (no qty/unit/total) but can still carry text and attachments (e.g., floor plans or reference images). The default remains a priced quote item.

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

### PDF Changes
- **QuotePDFDocument**:
  - Heading items render as bold, larger text spanning full width
  - Note items render as normal text spanning full width
  - Both types can include images/attachments below
  - Only priced items contribute to subtotal/VAT/total

