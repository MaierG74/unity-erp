**Overview**
- Purpose: Manages vendors (suppliers), their contact emails, supplier-specific component mappings, and price lists. The supplier detail page aggregates these into tabs for day‑to‑day maintenance.
- Scope: CRUD for suppliers, emails, supplier component mappings, and price lists; surfaced in purchasing flows (supplier orders and purchase orders).

**Routes & Pages**
- `app/suppliers/page.tsx:1`: Supplier list with search and “Has price list” filter.
- `app/suppliers/new/page.tsx:1`: Create supplier via `SupplierForm`.
- `app/suppliers/[id]/page.tsx:1`: Supplier detail with tabs: Details, Emails, Components, Price Lists.

**Key UI Components**
- `components/features/suppliers/supplier-list.tsx:1`: Lists suppliers, primary email, and number of price lists. Opens `PricelistPreviewModal`.
- `components/features/suppliers/supplier-form.tsx:1`: Create/update supplier (name, contact info) with Zod validation.
- `components/features/suppliers/supplier-emails.tsx:1`: Manage email addresses, including primary flag toggle and delete.
- `components/features/suppliers/supplier-components.tsx:1`: Table of supplier-component mappings. Supports inline edit and delete. (Add flow is prepared in API but not yet wired in the UI.)
- `components/features/suppliers/supplier-pricelists.tsx:1`: Upload and delete price lists (stored in Supabase Storage bucket `QButton`, folder `Price List/`).
- `components/features/suppliers/pricelist-preview-modal.tsx:1`: Modal preview list of price list files for a supplier.

**Client API**
- `lib/api/suppliers.ts:1` provides all data access using Supabase:
  - `getSuppliers()`, `getSupplier(id)`
  - `createSupplier(data)`, `updateSupplier(id, data)`, `deleteSupplier(id)`
  - Emails: `addSupplierEmail`, `updateSupplierEmail`, `deleteSupplierEmail`
  - Supplier components: `addSupplierComponent`, `updateSupplierComponent`, `deleteSupplierComponent`
  - Price lists: `uploadPricelist(supplierId, file, displayName)`, `deletePricelist(pricelist)`

**Types**
- `types/suppliers.ts:1` defines:
  - `Supplier { supplier_id, name, contact_info }`
  - `SupplierEmail { email_id, supplier_id, email, is_primary }`
  - `SupplierComponent { supplier_component_id, component_id, supplier_id, supplier_code, price, lead_time, min_order_quantity }`
  - `SupplierPricelist { pricelist_id, supplier_id, file_name, display_name, file_url, file_type, uploaded_at }`
  - `SupplierWithDetails` extends `Supplier` with `emails`, `components(component{internal_code, description})`, and `pricelists`.

**Database Model (excerpt)**
- Source: `schema.txt` and `db/migrations/*`.
- `suppliers`: `supplier_id` PK, `name`, `contact_info`.
- `supplier_emails`: FK `supplier_id` → `suppliers`, `is_primary` boolean.
- `suppliercomponents`: FK `component_id` → `components`, FK `supplier_id` → `suppliers`; UNIQUE `(component_id, supplier_id)` ensures one mapping per supplier per component; includes `supplier_code`, `price numeric(10,2)`, `lead_time`, `min_order_quantity`, optional `description`.
- `supplier_pricelists`: FK `supplier_id`; storage URL and metadata for uploaded files.
- Purchasing linkage:
  - `supplier_orders`: references `suppliercomponents` via `supplier_component_id`; status via `supplier_order_statuses`. Receipts in `supplier_order_receipts`.
  - The app groups supplier orders under purchase orders in `app/purchasing/purchase-orders/[id]/page.tsx:1`.

**Supplier Detail Page**
- File: `app/suppliers/[id]/page.tsx:1`.
- Data: fetched with `getSupplier(id)`; invalidates via React Query after updates.
- Subtitle removed under the supplier name to reduce chrome and align with simplified page headers.
- Tabs:
  - Details: `SupplierForm` for name/contact.
  - Emails: `SupplierEmails` with add, primary toggle, delete.
  - Components: `SupplierComponents` lists supplier component mappings with inline edit/delete.
  - Price Lists: `SupplierPricelists` upload/delete. Uses Supabase Storage bucket `QButton`.

**Master Component List vs Supplier Component List**
- Master Components live in `components` table and UI at `app/inventory/page.tsx:1` with helpers under `components/features/inventory/*`.
- Supplier Component List is a per‑supplier view of `suppliercomponents` that references a master `component_id` and overlays supplier‑specific data: `supplier_code`, `price`, `lead_time`, `min_order_quantity`.
- In purchasing and order planning, the system uses `suppliercomponents` to determine vendor, code, and price for each master component shortfall. Example usage in `app/orders/[orderId]/page.tsx:391` and `app/purchasing/purchase-orders/[id]/page.tsx:700`.

**Relationship**
- `suppliercomponents.component_id` → FK to `components.component_id` (the master component).
- On the Suppliers → Components tab, the first column shows the master component’s `internal_code` and now links to the inventory page.
- Deep link: clicking the code opens `/inventory?focusComponent={component_id}` and the inventory page auto-selects that component in the details pane.

**Associate from Suppliers page**
- Add and Edit flows already pick the master component via a selector (react-select of the `components` table).
- To change the association, edit a row and select a different master component — the UNIQUE `(component_id, supplier_id)` prevents duplicates for the same supplier.

**Current Behavior: Supplier Components Tab**
- Displays columns: Component (internal code), Description, Supplier Code, Price, Lead Time, Min Order, Actions.
- Inline edit switches row to a form with `react-select` over master `components` (query key `['components']`, direct Supabase select of `component_id, internal_code, description`).
- Update and delete mutate through `updateSupplierComponent` and `deleteSupplierComponent`, followed by query invalidation of `['supplier', supplier_id]`.
- Note: `addSupplierComponent` API exists, but there is no visible “Add Component” UI in `supplier-components.tsx` yet. The import and mutation are prepared.

**Seed/Utilities**
- `add-suppliers.sql`, `add-suppliers.js`, `add-suppliers-with-data.js`: sample data loaders generating suppliers and suppliercomponents records (useful for demos/dev).
- `check-suppliers.js`, `check-suppliers-direct.js`: helpers to inspect supplier data.

**Integration Touchpoints**
- Inventory master list shows supplier options per component: `app/inventory/page.tsx:1` (nested `supplierComponents` with `supplier.name`).
- Order planning builds supplier options from `suppliercomponents`: `app/orders/[orderId]/page.tsx:391` fetchComponentSuppliers.
- Purchase orders compute totals using supplier component price: `app/purchasing/purchase-orders/[id]/page.tsx:533`–`535`.

**Work Now: Supplier’s Component List Enhancements**
- Add Component flow
  - UI: Add an “Add Component” button above the table that opens an inline create row or a small dialog.
  - Fields: `component_id` (select from master components), `supplier_code`, `price` (currency), `lead_time` (days), `min_order_quantity`.
  - Validation: enforce required fields (`component_id`, `supplier_code`, `price ≥ 0`), respect DB UNIQUE `(component_id, supplier_id)`; surface a friendly message if duplicate.
  - Mutation: call `addSupplierComponent({ component_id, supplier_id, supplier_code, price, lead_time, min_order_quantity })`, then invalidate `['supplier', supplier_id]`.
  - UX: keep `react-select` for components; display selected component’s `internal_code` + `description` in the pending row preview.

- Table improvements
  - Sorting: allow sort by `internal_code`, `price`.
  - Filtering: quick search over component code/description/supplier code.
  - Currency: format using locale (e.g., `Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' })`).
  - Pagination or virtualized list if supplier has many items.

- Consistency and data hygiene
  - Price precision: UI should round to 2 decimals; backend column is `numeric(10,2)`.
  - Lead time/MOQ: treat empty as `null` for DB consistency (code already does this when updating).
  - Prevent accidental duplicate component mappings by disabling options already linked to this supplier.

- Bulk import (optional, follow‑up)
  - From Price List: parse uploaded file to propose mappings and prices; confirm before insert.
  - CSV import/export for quick edits.

**Acceptance Checklist for the Add Flow**
- Add button is visible and opens a create form.
- Submitting creates a new `suppliercomponents` row and the table refreshes without a full page reload.
- Attempting to add an existing `(component_id, supplier_id)` shows a readable duplicate error and does not crash.
- Price and numbers are validated; ZAR “R” display matches screenshot behavior.
- Existing edit/delete continue to work.

**Quick How‑To**
- Where to edit UI: `components/features/suppliers/supplier-components.tsx:1`.
- Data access: `lib/api/suppliers.ts:1` (`addSupplierComponent`, `updateSupplierComponent`, `deleteSupplierComponent`).
- Types: `types/suppliers.ts:1`.
- Master components for the selector: `components` table; selector currently fetched in `supplier-components.tsx:26`.

**Open Questions**
- Currency: confirm if all suppliers use ZAR or if per‑supplier currency is needed.
- Lead time unit: currently integer field; confirm days vs. business days.
- Audit/logging: do we need who/when changed prices for compliance?

**Implementation Update — Add Component UI**
- File changed: `components/features/suppliers/supplier-components.tsx:1`.
- What’s new:
  - Added a compact toolbar with an “Add Component” button per Style Guide toolbar pattern (`p-3 bg-card rounded-xl border shadow-sm`, h‑9 controls).
  - Inline create row rendered as a single aligned table row (one cell per column) with `react-select` over master components and inputs for supplier code, price, lead time, and MOQ.
  - Client validation and friendly duplicate error for UNIQUE `(component_id, supplier_id)`.
  - Disables options already mapped to the supplier to prevent duplicates.
  - Uses semantic tokens: `bg-card`, `border`, `text-muted-foreground`, `ring-ring`, destructive text for errors.
- react-select dropdown uses `menuPortalTarget={document.body}` and `menuPosition="fixed"` to avoid clipping by table scroll/overflow and to render correctly in dark mode.
- Inputs aligned to Style Guide density (`h-9`) with tokenized borders and focus rings (`focus:ring-2 focus:ring-ring`).
- Dark mode text fix: select control now sets `singleValue`, `input`, and `placeholder` to `text-foreground`/`text-muted-foreground`, and indicator colors follow tokens. This ensures readable labels in dark theme.
- react-select uses inline styles that can overpower classes; we added a `styles` override mapping to CSS variables (background: `hsl(var(--background))`, menu: `hsl(var(--popover))`, etc.) so dark/light themes render correctly even when portal’d.
- Squashed select fix: set a minimum width for the component selector (`min-w-[14rem]` via class and `styles.container.minWidth`) and shortened placeholder text to “Select” to keep the row balanced on smaller screens.
 - Wider dropdown for readability: the react-select menu is portal’d with `styles.menu.minWidth = '28rem'` and `maxWidth = '90vw'`, so the list renders a bit wider than the column without overflowing small screens.
- Style Guide references:
  - Buttons and heights: see “Core Principles”, “Color & Theme”, and “Toolbar with left primary action and right filters”.
  - Tables: sticky header tokens and neutral surfaces. We upgraded the container to `rounded-xl border bg-card shadow-sm` as recommended.
  - Focus/Accessibility: kept `focus:ring-2 focus:ring-ring` via select `classNames` and standard input patterns.

**Implementation Update — Components Filter (2025-09)**
- File changed: `components/features/suppliers/supplier-components.tsx:1`.
- What’s new:
  - Added a toolbar search field on the right using the Style Guide pattern (search icon, `h-9`, clear button).
  - Client-side filtering across `component.internal_code`, `component.description`, and `supplier_code`.
  - Empty state differentiates between “no components yet” and “no matches for filter”.
- Usage:
  - Type to filter; click the clear button to reset.
  - Add row remains available while filtering.
- Styling:
  - Toolbar follows the left primary action (Add Component) and right filters layout.
  - Input tokens: `border-input`, `bg-background`, `placeholder:text-muted-foreground`, and focus ring `ring-ring`.

**Implementation Update — Sticky Header & Toolbar Layout (2025-09)**
- Files: `components/features/suppliers/supplier-components.tsx:1`.
- Sticky header:
  - Applied Style Guide header classes on each `th`: `sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60 text-left p-4 font-medium` (numeric columns use `text-right`).
  - Wrapper now uses `max-h-[65vh] overflow-auto` so the table has its own vertical scroll container; sticky header pins within this container reliably regardless of page-level scroll handling.
- Toolbar layout:
  - Moved search to the left; kept Add Component on the right for easier scan and reach on wide screens.
  - Removed the “Supplier Components” label to reduce chrome and focus on actions.
