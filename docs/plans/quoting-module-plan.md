# Unity ERP – Quoting Module Implementation Plan

---
## Status / UI Changelog

### 2025-11-25 – Costing Cluster Line Editing
- **Edit Line Dialog**: Added ability to edit costing cluster lines including changing the supplier
  - New `EditClusterLineDialog.tsx` component for editing line details
  - Edit button (pencil icon) added to each costing line row
  - Dialog shows line type, description, quantity, and unit cost
  - For component lines: "Change Supplier" button loads available suppliers for the component
  - Supplier selection shows price comparison with "Lowest" and "Current" badges
  - Unit cost auto-updates when selecting a new supplier (with override option)
  - Description auto-updates to include new supplier name
- **Database**: Added `supplier_component_id` column to `quote_cluster_lines` table
  - References `suppliercomponents` table for tracking which supplier offer was used
  - Enables supplier changes and price tracking
- **Migration**: `add_supplier_component_id_to_quote_cluster_lines`
- **Components updated**:
  - `QuoteClusterLineRow.tsx`: Added edit button and `onEdit` prop
  - `QuoteItemClusterGrid.tsx`: Wired up edit dialog with state management
  - `lib/db/quotes.ts`: Updated `QuoteClusterLine` interface with `supplier_component_id`

### 2025-10-04 – Currency Formatting (ZAR), Column Width Optimization & Number Input UX
- **Currency Formatting**: Implemented consistent South African Rand (ZAR) currency formatting across all quote displays
  - Updated `QuoteItemsTable.tsx`: Line item totals now display with proper ZAR formatting (e.g., "R 63,828.60")
  - Updated `QuoteClusterLineRow.tsx`: Cluster line totals now use ZAR formatting
  - Updated `QuoteItemClusterGrid.tsx`: Subtotal, markup, and total calculations display in ZAR format
  - Updated `app/quotes/page.tsx`: Quote listing grand totals formatted as ZAR
  - Updated `app/quotes/[id]/working-page.tsx`: Pricing summary (subtotal, VAT, grand total) formatted as ZAR
  - All formatting uses `formatCurrency()` utility from `lib/quotes.ts` with `en-ZA` locale and proper thousand separators
- **Currency Precision**: All currency values automatically rounded to 2 decimal places
  - Unit prices and unit costs rounded using `Math.round(value * 100) / 100` on blur/submit
  - Currency values also rounded when displayed (initialization and prop updates) to clean up existing data
  - "Update Price" button in costing cluster rounds total before setting unit price
  - Added `step="0.01"` attribute to all currency input fields
  - Updated components: `QuoteItemsTable`, `QuoteClusterLineRow`, `QuoteItemClusterGrid`, `ComponentSelectionDialog`, `AddQuoteItemDialog`
  - Existing database values with excessive decimal places (e.g., `116.051999`) now display as `116.05`
- **Column Width Optimization**: Adjusted quote line items table for better numeric display:
  - Description: Changed from fixed `w-1/3` to flexible width (takes remaining space)
  - Qty: Increased from `w-20` → `w-24` → `w-32` (128px) to accommodate large quantities (1000+)
  - Unit Price: Increased from `w-24` → `w-36` (144px) to prevent clipping on values like 3000+
  - Total: Increased from `w-24` → `w-32` → `w-40` (160px) for formatted currency display
  - These changes eliminate number clipping issues for large values while maintaining description readability
- **Number Input UX Fix**: Fixed issue where users couldn't delete leading zeros in number inputs
  - Changed all numeric inputs to store values as strings internally
  - Convert to numbers only on blur/submit events
  - Updated components: `QuoteItemsTable`, `QuoteClusterLineRow`, `QuoteItemClusterGrid`, `ComponentSelectionDialog`, `AddQuoteItemDialog`
  - Users can now clear fields completely without values immediately resetting to 0
  - Pattern documented in `docs/overview/STYLE_GUIDE.md` for future reference

### 2025-09-30 – Automatic Totals Calculation
- Implemented database triggers for automatic quote totals calculation
- `quote_items.total` now auto-calculated on INSERT/UPDATE via `update_quote_item_total()` function
- `quotes.subtotal`, `vat_amount`, and `grand_total` now auto-calculated via `update_quote_totals()` function
- Triggers fire automatically on quote_items changes (INSERT/UPDATE/DELETE)
- VAT rate stored as percentage (15.00 = 15%) and correctly converted to decimal in calculations
- Migration: `migrations/20250930_quote_totals_triggers.sql`
- Fixed existing quote data with correct totals calculation

### 2025-09-07
- Quotes landing uses style‑guide: toolbar with search, status filter, sort; table with row‑click to open; delete uses confirm dialog + toast.
- URL query params for filters/sort/pagination: `q`, `status`, `sort`, `page`, `pageSize`.
- Debounced search (250 ms) reduces re-renders and URL churn.
- Info banner is clickable and scrolls/highlights the table, hinting that rows open on click.
- Quote detail header now includes an outline “Back to Quotes” button that prefers history back when coming from `/quotes`, else navigates to `/quotes`.
- Add Component dialog aligned with STYLE_GUIDE modal pattern: header/title, compact body spacing, scrollable content area, and footer actions with `h-9` buttons. Borders standardized to `border-input` for lists and selections.

### 2025-09-22 – UX polish
- Quote items now prefer the first costing cluster that actually contains lines, falling back to an empty shell when no lines exist. Cluster lists and their lines are sorted by `position`/`created_at` and `sort_order` respectively so re-fetching data no longer hides valid cost entries when Supabase returns rows in a different order.
- Creating a Costing Cluster with the “+ Cluster” button no longer reloads the page. The cluster is created and added to the item state optimistically, keeping the user on the Line Items tab.
- Empty clusters are now surfaced immediately in the UI so the estimator can add costing lines without the button feeling like a no-op.
- Cutlist “Export to Quote” now updates the affected item’s cluster lines in place and closes the dialog, without a full page reload. The active tab remains on Line Items.
- When multiple clusters exist for a line item (e.g., legacy manual lines plus cutlist-generated lines), the Line Items view now flattens the data so the costing table always shows the manual entries and cutlist rows together after a refresh.
- Add Component dialog: component list stays hidden until the user types in the search field, preventing the dialog from resizing on open. “Browse by supplier” moved to the top-right header.

### 2025-09-07 – Phase 2 Progress (Products as Items)
- New Add Item dialog: `components/features/quotes/AddQuoteItemDialog.tsx` with tabs `Manual | Product`.
- Product tab supports search/select, quantity, and an “Explode BOM into Costing Cluster” toggle (on by default).
- On create with explode: ensures a default cluster exists and inserts BOM component lines (via `fetchProductComponents`).
- Missing unit_cost fields are highlighted on cost lines to prompt completion.
- Toast shown when a product has no BOM; item is added without cost lines.
- Helpers added: `fetchProducts`, `fetchProductComponents`, and `fetchQuoteItemClusters` in `lib/db/quotes.ts`.
- Product image option: Product item creation can auto-attach the product’s primary image as an item attachment; PDF uses item images in the description column.
  - Helpers: `fetchPrimaryProductImage(productId)`, `createQuoteAttachmentFromUrl(...)`, `fetchAllQuoteAttachments(quoteId)`.
  - UI: checkbox “Attach product image to this item” in `AddQuoteItemDialog` (default on).

### Attachments UX (Airtable-style micro gallery)
- Replaced in-row dropzone with a compact inline gallery cell.
- Shows up to 2 square thumbnails (28px) with `object-contain`, border + rounded; a “+N” chip when more files exist.
- Non-images render a document tile; hidden-in-PDF files show an eye-off badge.
- Clicking the cell opens the full Attachment Manager dialog for drag/drop, paste, reorder, delete, and “show in PDF”.

### Component Selection Dialog (manual vs database)
- UI: `components/features/quotes/ComponentSelectionDialog.tsx`
- Invoked by cluster UI: `components/features/quotes/QuoteItemClusterGrid.tsx:212`
- Line creation handled in table: `components/features/quotes/QuoteItemsTable.tsx:306`
- Data helpers: `lib/db/quotes.ts` (`fetchComponents`, `fetchSupplierComponentsForComponent`, `createQuoteClusterLine`)

Flow
- User clicks “Add Line” → dialog opens.
- Select `Component Type`:
  - Manual Entry: free‑text `description`, `qty`, `unit_cost`.
  - Database Component: search `components`, choose a component, then select a supplier offer to set `unit_cost`.
- Click “Add Component”: dialog emits a normalized payload to the cluster grid, which then calls `createQuoteClusterLine` with `line_type` derived from the entry type and updates UI optimistically.

Payloads
- Manual: `{ type: 'manual', description, qty, unit_cost }`
- Database: `{ type: 'database', description, qty, unit_cost, component_id, supplier_component_id }`

Validation
- Button disabled until required fields are present: manual requires description; database requires component + supplier component.

Styling
- Matches `STYLE_GUIDE` dialog pattern: compact spacing (`space-y-3`), scroll body (`max-h-[70vh] overflow-y-auto`), footer actions (`size="sm" className="h-9"`).
- Prevents focus ring clipping via `focus:ring-inset focus:ring-offset-0` on `SelectTrigger` and small container padding.

### New Requirement: Add Products to Quotes
We need to support selecting a Product in two contexts:

1) In the Add Component dialog (current flow)
- Purpose: quickly explode a Product’s BOM into the current cluster as multiple component lines (costing by composition).
- UX: Add a third `Component Type` option `Product` with product search + quantity multiplier.
- Behavior: choosing a product loads its components and inserts one line per component into the active cluster using `createQuoteClusterLine` with `line_type='component'` and `qty = productQty * componentQty`.
- Notes: This is for costing only; it does not add a new top‑level quote item.

2) At the Line Items level (top table)
- Purpose: add a top‑level quote item from a Product with optional BOM awareness.
- UX: change “Add Item” to open `AddQuoteItemDialog` with tabs: `Manual`, `Product`. (Implemented)
- Behavior (Implemented – initial): Product tab lets you pick a product and set quantity; it creates a `quote_items` row with `description = product.name`, `unit_price = 0` for now, and `qty` set by user. If “Explode” is enabled, a default Costing Cluster is ensured and BOM lines are inserted for internal cost tracking.

Data considerations
- Products table: available through `/api/products` and direct `products` table queries (fields: `product_id, name, internal_code, description`; no `default_price` at present).
- BOM lookup: reuse RPC `get_product_components` already used in Orders page (`app/orders/[orderId]/page.tsx:1719`). Mirror a lightweight helper in `lib/db/quotes.ts` (e.g., `fetchProductComponents(productId)`).

Action Plan
1. Data helpers
   - Add `fetchProducts()` (list with `product_id, name, internal_code`). [Implemented]
   - Add `fetchProductComponents(productId)` using RPC `get_product_components` or join tables. [Implemented]
   - Add `fetchProductOptionGroups(productId)` to surface option groups/values in UI; capture selections alongside BOM explosion. [Implemented]
2. Dialog extension (costing)
   - Extend `ComponentSelectionDialog`:
     - Add `product` to `entryType` union.
     - Product search list (reusing Input+list pattern), summary, qty multiplier.
     - On submit: call `onAddComponent` with `{ type: 'product', product_id, qty, explode }`.
   - In `QuoteItemsTable.handleAddClusterLine`, detect `type==='product'` and: fetch product components, then create `quote_cluster_lines` for each component. Optimistically update UI. (Batching planned.) [Implemented]
3. New `AddQuoteItemDialog` (top‑level)
   - Trigger from “Add Item”. Tabs: Manual | Product. [Implemented]
   - Manual behaves like today (but in dialog). Product creates `quote_items`, surfaces option selectors (when available), and optionally explodes BOM with selected configurations applied. [Implemented]
   - Product Options tab now focuses on attaching reusable **Option Sets** (see `docs/domains/components/bom-option-cut.md`) and lightweight per-product overlays. Bespoke groups remain supported for edge cases.
4. Pricing + totals
   - For product lines, set `unit_price` from product or computed from cluster total via “Update Price” action already present. [Planned]
   - Highlight missing unit costs on exploded lines to aid costing. [Implemented]
   - BOM overrides managed from the product Options tab now feed the resolver so exploded lines follow the selected configuration.
5. Docs & tests
   - Document UX and payload shapes; add examples and edge cases (no BOM, missing prices).
   - Add resolver/unit tests covering option selections and base-only fallbacks (pending option override data).

Next up
- Persist `selected_options` when converting quotes to orders and expose them in order detail editors.
- Display configuration chips in quote line summary and include in PDF exports.
- Mirror option-aware BOM handling in direct order entry so quotes and orders stay in sync (see `docs/domains/orders/orders-master.md`).

Open Questions
- Source of product default price? Use `products.unit_price` if available; otherwise compute from BOM or leave 0 and prompt to update.
- Do we always explode BOM into clusters, or make it optional? Proposal: optional toggle (“Explode cost details”).

## Purpose
Provide a flexible, auditable, and user-friendly quoting workflow that supports:
1. Multiple products per quote with granular pricing.
2. Rich context via attachments (photos, drawings, external docs).
3. Inline notes and calculation helpers.
4. Tight integration with Inventory while still allowing ad-hoc external line items.
5. Versioning, approvals, and streamlined conversion from Quote → Order.

---

## Data Model
### Core tables
- `quotes` – header record (id, customer_id, status, total_price, currency, created_by, approved_by, created_at).
- `quote_items` – one row per line item. Links to `inventory_items` (nullable) _or_ stores free-text description for external items / subcontractor costs (fields: description, vendor_id, unit_cost, markup_pct, unit_price, quantity, line_total, attachments).
  - Fields now include `selected_options jsonb` to store product configuration choices captured in the Add Item dialog.
- `quote_attachments` – files attached at either quote level or line-item level (`scope ENUM('quote','item')`, `quote_item_id` nullable).
- `quote_notes` – RICH TEXT notes/observations keyed to quote_id and optionally quote_item_id.
- `quote_versions` – snapshot of quote JSON at commit points for diff / rollback.

### Derived fields & Automatic Calculations
All totals are automatically maintained by database triggers (implemented 2025-09-30):

**Quote Items:**
- `total` – automatically calculated as `qty * unit_price` via `update_quote_item_total()` trigger

**Quotes:**
- `subtotal` – sum of all `quote_items.total` for the quote
- `vat_rate` – stored as percentage (e.g., `15.00` = 15%)
- `vat_amount` – calculated as `subtotal * (vat_rate / 100)`
- `grand_total` – calculated as `subtotal + vat_amount`

These fields are maintained by the `update_quote_totals()` function triggered on quote_items INSERT/UPDATE/DELETE.

**Migration:** `migrations/20250930_quote_totals_triggers.sql`

---

## Key Features (MVP)
1. **Multi-item Quote Builder**
   - Search & add inventory items with live stock/price lookup.
   - Add custom items with manual cost & vendor refs.
   - Quantity, unit price, markup %, line total auto-calc.

2. **Attachment Management**
   - Drag-and-drop multiple images/drawings at quote or item level.
   - Uses Supabase Storage (`qbutton/quotes/{quote-id}/...`).
   - Preview thumbnails in UI; allow download/delete with RLS enforced.

3. **Notes & Rich Comments**
   - Markdown-supported notes field per quote & per item.
   - Mentions (`@username`) & timestamps for audit trail.

4. **Inline Calculation Sheet**
   - Calculator component that can reference line totals (ex: steel weight * rate).
   - Store calc results back into hidden items (e.g., "Labour") if required.

5. **External Document References**
   - Link external URLs or upload PDFs from suppliers.
   - Optionally include selected pages in exported quote PDF.

6. **Inventory & External Price Mix**
   - For inventory items: lock price from `inventory_items.price` or allow override with permission.
   - For external items: require vendor name & attachment of vendor quote.

7. **Quote Versioning & Approval**
   - Save & label versions (e.g., v1, Customer Rev A).
   - Compare diff (price/notes).
   - Basic approval workflow with role-based RLS (draft → pending → approved → sent).

8. **Export & Delivery**
   - Generate beautiful PDF with company letterhead, embedded images, optionally external docs as appendix.
   - Email directly from app with log of send attempts. **See [`quote-email-plan.md`](quote-email-plan.md) for implementation details.**

---

## Stretch Goals
- **Bulk PDF Export / Archive** – batch export selected quotes.
- **Margin Analysis Dashboard** – see cost vs sell, margin % by quote/item.
- **Mobile-first Quick Quote** – simplified flow for on-site quoting.
- **Dynamic BOM Expansion** – explode assemblies into parts on quote.
- **Cutlist / Nesting Tool** – see `docs/plans/cutlist-nesting-plan.md` for the planning doc and MVP.

---

## UI / UX To-Dos
- Wizard-style quote builder with progress steps.
- Tabbed layout: Items | Attachments | Notes | Calculations | History.
- Sticky quote summary card with running totals.
- Inline image preview & annotation.
- Per-item attachment drop zone displayed inline with each quote item.
- Global quote-level attachment drop zone (existing).
- Keyboard shortcuts for adding items / navigating fields.

## Current Implementation Files (2025-11-25)
- `app/quotes/page.tsx`
- `app/quotes/[id]/page.tsx`
- `app/quotes/new/page.tsx`
- `components/features/quotes/QuoteAttachmentsList.tsx`
- `components/features/quotes/QuoteItemsTable.tsx`
- `components/features/quotes/AddQuoteItemDialog.tsx`
- `components/features/quotes/QuoteClusterLineRow.tsx`
- `components/features/quotes/QuoteItemClusterGrid.tsx`
- `components/features/quotes/EditClusterLineDialog.tsx` – Edit costing line with supplier change
- `components/features/quotes/ComponentSelectionDialog.tsx`
- `lib/db/quotes.ts`

---

## Technical Tasks
- [ ] Extend data model & SQL migrations for new tables/enums.
  - [ ] Backup live database before running migrations.
  - [ ] Test migrations on a staging copy and validate safety.
  - [ ] Prepare rollback scripts and schedule a maintenance window.
- [ ] Storage policy updates for new attachment scopes & per-item access.
- [x] Item-level attachment UI component and database linkage.
- [x] Investigate and resolve RLS policies blocking quote item creation/updates.
- [ ] Render per-item attachments in item row
- [ ] Fetch and display existing item attachments
- [ ] Add remove functionality per-item attachments
- [ ] Build React hook `useQuoteBuilder` for state & validation.
- [ ] Unit tests for price calculations & totals trigger.
- [ ] PDF template in `react-pdf`.
- [ ] Role-based RLS policies for approvals and attachment access.

### New technical tasks (Phase 2 – Products as Items)
- [ ] Batch insert BOM lines for performance (`createQuoteClusterLines(lines[])`).
- [ ] Normalize/implement RPC `get_product_components(product_id int)` server-side for consistent BOM fetching.
- [x] DB triggers: maintain `quote_items.total = qty * unit_price` and `quotes.grand_total = sum(items.total)`.
  - ✅ Implemented in migration `20250930_quote_totals_triggers.sql`
  - ✅ `update_quote_item_total()` function auto-calculates item totals
  - ✅ `update_quote_totals()` function auto-calculates quote subtotal, VAT (15%), and grand total
  - ✅ VAT rate stored as percentage (15.00 = 15%) and converted to decimal in calculations
- [ ] Optional: endpoint/helper to compute item price from cluster subtotal + markup.

### Email Integration (Planned)
- [ ] Email quote PDFs to customers directly from quote detail page
- [ ] See **[`quote-email-plan.md`](quote-email-plan.md)** for complete implementation plan
- [ ] Leverages existing Resend email infrastructure
- [ ] Includes email audit trail and customer email validation

---

## Pricing Notes & Next Steps
Pricing will be addressed after product-as-item UX stabilizes.

- Auto price from costing: per-item toggle to sync `unit_price` from the item’s cluster total (subtotal + markup). Updates as lines/markup change.
- Suggested price when no BOM: if product has no BOM rows or “explode” is off, suggest a price based on manual entry or derived costs with configurable margin.
- UI cues: soft warning for items priced at R0.00; tooltip on red unit_cost inputs explaining they’re missing.
- Integrity: database triggers ensure totals correctness even without UI interaction.
 - Media: when pricing is finalized, ensure image sizing rules for PDF (max 2 per item row; scale down to 80x60) are documented.

Implementation order
1. Batch BOM inserts + RPC normalization.
2. Auto price-from-costing toggle and live sync to `unit_price`.
3. Totals triggers in DB; remove ad‑hoc recalculations.
4. Suggested price path for no‑BOM/“explode off”.
