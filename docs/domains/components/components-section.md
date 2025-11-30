## Components Section - Living Document

This is a living document describing the current implementation of the Components (Inventory) section. Keep it updated as code evolves.

### Purpose
Manage components, stock levels, locations, supplier links, and images. Provide search, filtering, inline editing, and details with recent transactions.

### Primary UI Entrypoints
- `app/inventory/page.tsx` — main inventory page with tabbed interface (Components, Categories, On Order, Transactions, Reports) using `DataTable`.
- `app/inventory/components/[id]/page.tsx` — dedicated component detail page with tabbed layout (Overview, Edit, Inventory, Suppliers, Transactions, Orders, Analytics).
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

- `components/features/inventory/component-detail/AddSupplierDialog.tsx` (2025-01-15)
  - Dialog for linking supplier components to a component.
  - Shows searchable table of available unlinked supplier components.
  - Visual row selection with checkmark indicator.
  - Optional price override when linking.
  - Filters out already-linked components automatically.

- `components/features/inventory/component-detail/EditSupplierDialog.tsx`
  - Edit existing supplier component links (price, supplier code, etc.).

- `components/features/inventory/component-detail/DeleteSupplierDialog.tsx`
  - Remove supplier component links with confirmation.

### Hooks (Mutations)
- `hooks/use-update-component.ts` — Update `components` table fields; invalidates `['inventory','components']` query and toasts.
- `hooks/use-change-category.ts` — Get-or-create `component_categories` entry by name, then update `components.category_id`.
- `hooks/use-update-inventory.ts` — Update `inventory` row fields.

### Bulk Categorization Features (Updated 2025-10-19)
The category cells in the inventory table now support multiple efficient workflows for bulk categorization:

#### 1. Single-Click Editing
- **Usage**: Click any category cell to immediately open the dropdown selector
- **When to use**: For one-off category changes
- **Keyboard shortcut**: Press **Esc** to close the dropdown without saving
- **Create new categories**: Click "Create new category..." at the bottom of the dropdown
  - Type the category name and press **Enter** or click the checkmark
  - The new category is created and immediately applied
  - Press **Esc** to cancel

#### 2. Copy/Paste
- **Usage**: 
  - Click a category cell to focus it
  - Press `Ctrl+C` (or `Cmd+C` on Mac) to copy the category value
  - Click another component's category cell
  - Press `Ctrl+V` (or `Cmd+V` on Mac) to paste and immediately save
- **When to use**: For applying a category to a few scattered items
- **Visual feedback**: Toast notifications confirm copy and paste actions

#### 3. Quick Apply Mode (Sticky Category)
- **Usage**:
  - Hover over a category cell with the category you want to apply to multiple items
  - Click the **Pin icon** (📌) that appears on hover
  - The cell highlights with a blue border and a toast confirms "Quick Apply enabled"
  - Click on any other component's category cell to instantly apply the pinned category
  - Cells that will receive the pinned category show a green highlight with "← will apply [category]" hint
  - Press **Esc** or click the Pin icon again to disable Quick Apply mode
- **When to use**: For categorizing many items with the same category (e.g., marking 20+ items as "Melamine Boards")
- **Visual feedback**:
  - Pinned category cell: Blue highlight with ring border
  - Target cells: Green background with inline hint text
  - Toast notifications for enable/disable actions
- **Keyboard shortcut**: Press **Esc** to cancel Quick Apply mode from anywhere

#### 4. Hover Actions
All category cells show two action buttons on hover:
- **Copy button** (📄): Quick copy without keyboard shortcuts
- **Pin button** (📌): Toggle Quick Apply mode

#### Technical Implementation
- `CategoryCell` component uses global state for sticky mode coordination across all cells
- Keyboard event listeners attached to individual cells with proper cleanup
- Subscribe/unsubscribe pattern ensures all cells react to sticky mode changes
- Single-click replaces previous double-click interaction for faster access

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
- Product option override regression tracked at `docs/issues/options-issues.md` (updated 2025-10-10) — follow this thread for the effective BOM resolver status.

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

### Component Detail View (Implemented — 2025-01-15)
- **Status**: ✅ Implemented
- **Entry**: Clicking a component row in the inventory list navigates to `app/inventory/components/[componentId]/page.tsx`.
- **Page Structure**: Tabbed layout with Overview, Edit, Inventory, Suppliers, Transactions, Orders, and Analytics tabs.

#### Implemented Tabs
- `Overview` (`components/features/inventory/component-detail/OverviewTab.tsx`)
  - Component image, stock status, key metrics, and supplier list summary.
- `Edit` (`components/features/inventory/component-detail/EditTab.tsx`)
  - Form for editing component details (extracted from `ComponentDialog`).
- `Inventory` (`components/features/inventory/component-detail/InventoryTab.tsx`)
  - Stock levels, reorder levels, and location management.
- `Suppliers` (`components/features/inventory/component-detail/SuppliersTab.tsx`)
  - Price statistics, supplier list table with Add/Edit/Delete actions.
  - **Add Supplier Dialog** (`AddSupplierDialog.tsx`): Searchable table of available supplier components. Select from existing catalog instead of manual code entry. Optional price override.
  - **Edit Supplier Dialog** (`EditSupplierDialog.tsx`): Edit existing supplier links.
  - **Delete Supplier Dialog** (`DeleteSupplierDialog.tsx`): Remove supplier links with confirmation.
- `Transactions` (`components/features/inventory/component-detail/TransactionsTab.tsx`)
  - Component-specific transaction history.
- `Orders` (`components/features/inventory/component-detail/OrdersTab.tsx`)
  - Where component is used (BOM) and required by active orders.
- `Analytics` (`components/features/inventory/component-detail/AnalyticsTab.tsx`)
  - Component-specific analytics and statistics.

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
// Inventory page with tabbed interface (Components, Categories, On Order, Transactions, Reports)
```
```1:40:app/inventory/components/[id]/page.tsx
// Component detail page with tabbed layout
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
```1:40:components/features/inventory/component-detail/AddSupplierDialog.tsx
// Add supplier dialog with searchable supplier component table
```
```1:40:components/features/inventory/component-detail/SuppliersTab.tsx
// Suppliers tab with CRUD operations for supplier links
```

Keep this document updated with structural changes, decisions, and TODOs.


