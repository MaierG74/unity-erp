## Components Section - Living Document

This is a living document describing the current implementation of the Components (Inventory) section. Keep it updated as code evolves.

### Purpose
Manage components, stock levels, locations, supplier links, and images. Provide search, filtering, inline editing, and details with recent transactions.

### Primary UI Entrypoints
- `app/inventory/page.tsx` — current inventory page using a custom `DataTable` and `InventoryDetails`.
- `app/inventory/inventory-client.tsx` — alternative client layout that composes `InventoryFilters`, `DataGrid`, `InventoryDetails`, and `TransactionHistory`.

### Key Feature Components
- `components/features/inventory/DataGrid.tsx`
  - Fetches `inventory` joined to `components`, `component_categories`, `unitsofmeasure`, and `suppliercomponents` via Supabase.
  - Provides editable cells for component fields, quantity, location, reorder level.
  - Uses React Query for data and hook-based mutations for updates.
  - Client-side filtering/sorting/pagination using TanStack Table.

- `components/features/inventory/Filters.tsx`
  - Controls: search, category select, stock level select (all/in-stock/low-stock/out-of-stock).
  - Loads categories from `component_categories` via Supabase, debounces search input.

- `components/features/inventory/ComponentDialog.tsx`
  - Add/Edit component dialog with image upload to Supabase Storage bucket `QButton`.
  - Fields: internal code, description, unit, category, suppliers (code/price), quantity, reorder level, location.
  - On save: upserts component, inventory row, and supplier component rows. Handles image addition/removal.

- `components/features/inventory/Details.tsx`
  - Right-side panel showing selected item details, stock status badge, category, unit, location, suppliers with prices.

- `components/features/inventory/TransactionHistory.tsx`
  - Shows recent `inventory_transactions` for the selected component (last 10), with IN/OUT and date formatting.

- `components/ui/data-table.tsx`
  - Generic table with inline editing support, column filters, sorting, pagination. Used by `app/inventory/page.tsx`.

### Hooks (Mutations)
- `hooks/use-update-component.ts` — Update `components` table fields; invalidates `['inventory','components']` query and toasts.
- `hooks/use-change-category.ts` — Get-or-create `component_categories` entry by name, then update `components.category_id`.
- `hooks/use-update-inventory.ts` — Update `inventory` row fields.

### Data Model (as used in UI)
- `components`
  - `component_id`, `internal_code` (unique), `description`, `image_url`, `category_id`, `unit_id`.
  - Relations used: `component_categories(cat_id, categoryname)`, `unitsofmeasure(unit_id, unit_name)`.
- `inventory`
  - `inventory_id`, `component_id`, `quantity_on_hand`, `location`, `reorder_level`.
- `suppliercomponents`
  - `supplier_component_id`, `component_id`, `supplier_id`, `supplier_code`, `price`.
  - Joined to `suppliers(name)` for display.
- `inventory_transactions`
  - `transaction_id`, `component_id`, `quantity`, `transaction_type` ('IN'|'OUT'), `transaction_date`, `order_id`.
- `unitsofmeasure`
  - Canonical list of measurement units used by components.
  - Columns: `unit_id` (PK), `unit_code` (e.g., EA, KG, M), `unit_name` (e.g., Each, Kilogram, Meter).
  - Constraints: case-insensitive uniqueness on both `unit_code` and `unit_name` to prevent duplicates.
  - Normalization: DB trigger uppercases `unit_code` and Title-Cases `unit_name` on insert/update.

Types referenced:
- `types/inventory.ts: InventoryItem` — shape used by `DataGrid`, `Details`, etc.
- `types/purchasing.ts: Component` — base component fields used elsewhere.

### Data Fetching and Caching
- React Query keys:
  - `['inventory']` — DataGrid list of inventory items with joins.
  - `['inventory','components']` — Components list in `app/inventory/page.tsx`.
  - `['categories']`, `['units']`, `['suppliers']`, `['supplierComponents']` — metadata lists.
- Invalidation occurs on successful mutations to ensure UI refresh.

### User Flows
1) Browse and search components
   - Toolbar search and filters (category, supplier on `page.tsx`; category/stock-level via `InventoryFilters` in client variant).
   - Table sorting by clicking headers; local pagination.

2) Inline editing in tables
   - Edits dispatch to `useUpdateComponent`, `useChangeCategory`, `useUpdateInventory`.
   - Success triggers query invalidation and toast.

3) View details and recent transactions
   - Selecting a row sets `selectedItem` and renders `InventoryDetails` and `TransactionHistory`.

4) Add or edit component via dialog
   - Launch `ComponentDialog`; on submit, upserts component/inventory/suppliercomponents.
   - Image upload handled with Supabase Storage; supports removal.

5) Delete component (from `page.tsx`)
   - Deletes in order: `inventory_transactions` → `inventory` → `suppliercomponents` → `components`.
   - Then invalidates and toasts.

### Page Variants
- `app/inventory/page.tsx` implements its own `DataTable`, filters (search/category/supplier), and details pane.
- `app/inventory/inventory-client.tsx` composes modular `DataGrid` + `InventoryFilters` with tabs for Details/Transactions.
  - Consider converging these or choosing one canonical UX.

### Supabase Usage
- Client-side authenticated access using `lib/supabase` and `lib/supabaseClient` (note: both exist; standardize import usage).
- Storage bucket `QButton` for component images; generates public URLs.

### Error Handling and UX Notes
- Loading states via React Query and spinners (`Loader2`).
- `QueryError` component used in `page.tsx` to render server errors.
- Toaster notifications on mutations.
- Numeric coercion applied after fetching to normalize `quantity_on_hand` and `reorder_level` to numbers.

### Security & RLS
- All reads/writes depend on Supabase RLS policies. Ensure policies allow intended operations for authenticated users.
- Image upload requires valid auth; `ComponentDialog` checks session before storage operations.

### Performance Considerations
- Client-side filtering/pagination; could move to server-side for large datasets.
- Multiple joins in a single query; monitor payload size and latency.
- Image thumbnails are loaded as avatar-sized; consider using optimized, cached thumbnails.

### Known Inconsistencies / Cleanup Targets
- Two inventory page approaches (`page.tsx` vs `inventory-client.tsx`). Decide on one pattern.
- Mixed imports: `@/lib/supabase` vs `@/lib/supabaseClient`. Standardize.
- `components/ui/data-table.tsx` and `features/inventory/DataGrid.tsx` overlap. Consider consolidating to one table abstraction.
- Supplier filter only exists in `page.tsx` variant; replicate in `InventoryFilters` if needed.

### Units Standardization (2025-09-07)
- Problem: Duplicate units existed due to case variants (EA/ea, M/m, KG/kg).
- Fix applied:
  - Remapped component references to canonical unit IDs.
  - Removed duplicate rows from `unitsofmeasure`.
  - Added case-insensitive unique indexes on `lower(unit_code)` and `lower(unit_name)`.
  - UI now defensively de-duplicates units in the Component dialog dropdown.
- Policy going forward:
  - `unit_code`: Uppercase abbreviations (EA, KG, M, MM, CM, L, SQM, PR, PCS). Unique, case-insensitive.
  - `unit_name`: Title Case for display (Each, Kilogram, Meter, …). Unique, case-insensitive.
  - Add new units via `unitsofmeasure` only; do not inline strings elsewhere.

### Future Enhancements (Backlog)
- Server API routes for inventory CRUD to reduce client permissions surface and centralize validation.
- Bulk import/export of components and supplier links (CSV/XLSX).
- Soft delete/archive with audit trail and `inventory_transactions` consistency checks.
- Stock adjustment workflow with reasons and user attribution.
- Low stock alerts and reorder suggestions.
- Image management: background uploads, progress, thumbnail generation.
- Role-based capabilities (view-only vs edit).

### Component Detail View (Planning — 2025-09-26)
- **Goal**: move beyond the narrow side panel and provide a dedicated component detail surface that mirrors the richer tabbed layout used on product detail pages.
- **Entry**: add a `View` button on each DataTable row (or double-click) that routes to `app/inventory/components/[componentId]/page.tsx`. Keep the existing side panel for quick context so list navigation remains fast.
- **Page Shell**: reuse the `Tabs` pattern from product detail. Top header shows code, description, status pill (based on stock state), and quick actions (`Edit`, `Adjust Stock`, `Delete`). A secondary toolbar offers `Refresh` and deep links to purchase orders / work orders.

#### Proposed Tabs
- `Overview`
  - Hero block with primary image (fallback icon), core metadata (code, description, unit, category, default location).
  - Stock summary cards: On-hand, Reserved, Available, Reorder level (per location if tracking multiples). Pull from `inventory`, `inventory_reservations` (if/when introduced), and open MO/WO allocations.
  - Supplier panel with preferred supplier, last PO price, lead time (join `suppliercomponents`, `purchase_order_lines`).
  - Quick links to edit metadata and manage suppliers (reuse `ComponentDialog` sections inline).
- `Inventory Activity`
  - Timeline/table showing `inventory_transactions` with quantity, type (IN/OUT/ADJUST), reference (purchase order, order consumption, manual adjustment), user, and notes.
  - Filters: date range, transaction type. Expose “Expected” rows by combining pending PO receipts (lines with `expected_delivery_date` in future) and open production issues that will consume the component.
  - Provide export (`CSV`) and `Load more` pagination using infinite query.
- `Purchasing`
  - List of open purchase orders that include this component with status, supplier, expected receipt, ordered qty, received qty. Source tables: `purchase_orders`, `purchase_order_lines` filtered by `component_id`.
  - Section for historical receipts (last 5) with cost trend chart (optional stretch).
  - Actions: `Create PO` prefilled with this component, `Email supplier` (link to existing flow).
- `Usage / Where Used`
  - “Bill of Materials” usage: query `product_bom` and upcoming `bom_collections` links to show which products and collections depend on the component (quantity per). Add badges for `active` vs `archived` products.
  - “Open Orders” usage: gather current sales/work orders that reserve the component via `order_requirements` / `work_order_components`. Show qty reserved/issued.
  - “Historical” drill-down: optionally link to analytics dashboard once available.
- `Images`
  - Port over `ImageGallery` from products but scoped to components (storage bucket `QButton`). Allow upload, set primary image, delete. Show crop guidance for consistent 1:1 squares.
- `Files` *(optional follow-up)*
  - Placeholder for spec sheets, MSDS PDFs stored in Supabase Storage `component-files/`.

#### Data & API Considerations
- Create React Query hook `useComponentDetail(componentId)` that assembles:
  - Base component (`components` + `component_categories` + `unitsofmeasure`).
  - Inventory summary (`inventory`, future `inventory_locations`).
  - Supplier pricing (`suppliercomponents` + `suppliers`).
  - Aggregated counts (e.g., reserved qty) via RPC or view to avoid multiple round trips.
- Add supporting queries:
  - `GET /api/inventory/components/:componentId/transactions` with pagination & filters.
  - `GET /api/inventory/components/:componentId/purchase-orders` for open PO lines.
  - `GET /api/inventory/components/:componentId/usage` returning BOM and order usage arrays.
- Consider Supabase Postgres views/materialized views for heavy joins:
  - `component_usage_view` summarising BOM references and quantities.
  - `component_open_po_view` showing outstanding procurement per supplier.
- Ensure RLS covers new endpoints: allow authenticated `org` members to read detail data while protecting supplier pricing by role.

#### UX Notes
- Favor skeleton states for each tab instead of global spinner so users can pivot quickly.
- Persist last-opened tab per user (LocalStorage key `component-detail:lastTab`).
- Show breadcrumb `Inventory / Components / {code}` for orientation; include back-to-list button.
- For navigation from the list, shallow push the route (`router.push('/inventory?focusComponent=…', { shallow: true })`) so filters persist when returning.
- Keep destructive actions inside the detail page as secondary (use existing delete flow but require confirmation with usage summary).

#### Open Questions
- Should adjustments (manual, cycle counts) move to a dedicated modal accessible from this page? Need workflow definition.
- Do we need multi-location support before launching detail view? Current schema stores one location per component inventory row; design should not block future expansion.
- How to handle archived/obsolete components? Plan for `status` field and archive badge.
- Should we cache aggregated usage to speed up load? Evaluate once we size the record counts (products × components).

### Testing Ideas
- Unit tests for hooks (mutations) mocking Supabase client.
- Integration tests for `ComponentDialog` form flows, including image upload mock.
- E2E tests for search/filter/sort, inline edits, transaction visibility.

### Key Files Index
```1:20:app/inventory/page.tsx
// Inventory page rendering Components list and details
```
```1:40:app/inventory/inventory-client.tsx
// Alternative modular client for inventory
```
```1:40:components/features/inventory/DataGrid.tsx
// Data grid with inline editing powered by hooks and React Query
```
```1:40:components/ui/data-table.tsx
// Generic table used by page.tsx variant
```
```1:40:components/features/inventory/ComponentDialog.tsx
// Add/Edit dialog with storage upload and multi-table writes
```
```1:20:components/features/inventory/Details.tsx
// Side panel details
```
```1:20:components/features/inventory/TransactionHistory.tsx
// Recent transactions list
```

Keep this document updated with structural changes, decisions, and TODOs.
