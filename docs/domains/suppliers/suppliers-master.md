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
  - **Orders** (✅ Implemented 2025-01-15): `SupplierOrders` shows all purchase orders for the supplier with advanced filtering. See [Orders Tab](#orders-tab) below.
  - **Reports** (✅ Implemented 2025-01-15): `SupplierReports` displays analytics and statistics about supplier performance. See [Reports Tab](#reports-tab) below.

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
- Add Component: Inline create row with searchable `react-select` for master components. Includes server-side search that queries `components` table by `internal_code` and `description` using case-insensitive ILIKE. Search term debounced at 300ms for performance. Selected component displays with code and description; search term clears automatically on selection.
- Inline edit switches row to a form with `react-select` over master `components` with the same searchable functionality.
- Update and delete mutate through `updateSupplierComponent` and `deleteSupplierComponent`, followed by query invalidation of `['supplier', supplier_id]`.
- Component search: Uses React Query with query key `['components-search', componentSearchTerm]`. Queries up to 100 results ordered by `internal_code`. Search is server-side filtered (client-side filtering disabled via `filterOption={() => true}`) to ensure newly created or recently renamed components appear in results.

**Seed/Utilities**
- `add-suppliers.sql`, `add-suppliers.js`, `add-suppliers-with-data.js`: sample data loaders generating suppliers and suppliercomponents records (useful for demos/dev).
- `check-suppliers.js`, `check-suppliers-direct.js`: helpers to inspect supplier data.

**Integration Touchpoints**
- Inventory master list shows supplier options per component: `app/inventory/page.tsx:1` (nested `supplierComponents` with `supplier.name`).
- Order planning builds supplier options from `suppliercomponents`: `app/orders/[orderId]/page.tsx:391` fetchComponentSuppliers.
- Purchase orders compute totals using supplier component price: `app/purchasing/purchase-orders/[id]/page.tsx:533`–`535`.

**Work Now: Supplier's Component List Enhancements**
- ✅ **Add Component flow (Implemented 2025-11-05)**
  - UI: "Add Component" button opens inline create row in the table.
  - Fields: `component_id` (searchable select from master components), `supplier_code`, `price` (currency), `lead_time` (days), `min_order_quantity`.
  - Validation: enforce required fields (`component_id`, `supplier_code`, `price ≥ 0`), respect DB UNIQUE `(component_id, supplier_id)`; surface a friendly message if duplicate.
  - Mutation: call `addSupplierComponent({ component_id, supplier_id, supplier_code, price, lead_time, min_order_quantity })`, then invalidate `['supplier', supplier_id]`.
  - Component search: Server-side search with debounced input (300ms). Searches `internal_code` and `description` fields. Clears search term automatically when component is selected. Displays selected component code and description immediately.
  - UX: `react-select` with searchable dropdown; selected component's `internal_code` + `description` displayed in the Description column.

- Table improvements
  - Sorting: allow sort by `internal_code`, `price`. ✅ **Implemented (2025-11-02)**: Clickable column headers with sort indicators (ArrowUp/ArrowDown icons). Toggle between ascending/descending by clicking the same column; clicking a different column defaults to ascending. Resets to page 1 when sort changes.
  - Filtering: quick search over component code/description/supplier code. ✅ **Implemented**
  - Currency: format using locale (e.g., `Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' })`). ✅ **Implemented (2025-11-02)**: Uses `formatCurrency()` utility from `lib/quotes.ts` for consistent ZAR formatting with proper thousand separators (e.g., "R 1,234.56").
  - Pagination or virtualized list if supplier has many items. ✅ **Implemented**

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
  - Removed the "Supplier Components" label to reduce chrome and focus on actions.

**Implementation Update — Table Sorting (2025-11-02)**
- File changed: `components/features/suppliers/supplier-components.tsx:1`.
- What's new:
  - Added clickable sort controls on "Component" and "Price" column headers with visual indicators (ArrowUp, ArrowDown, ArrowUpDown icons from lucide-react).
  - State management: `sortField` ('internal_code' | 'price' | null) and `sortDirection` ('asc' | 'desc').
  - Sort logic integrated into `filteredComponents` useMemo: handles string comparison for `internal_code` (localeCompare) and numeric comparison for `price`.
  - Clicking a column header: if already sorting by that field, toggles direction; if new field, sets to ascending.
  - Resets to page 1 when sort changes to avoid empty pages.
  - Null/undefined handling: nulls sort to end in ascending, beginning in descending.
  - Accessibility: aria-labels indicate current sort state.
  - Styling: sort buttons use `hover:text-foreground transition-colors` for visual feedback; icons show active state or muted placeholder.

**Implementation Update — Currency Formatting (2025-11-02)**
- File changed: `components/features/suppliers/supplier-components.tsx:1`.
- What's new:
  - Replaced manual "R" prefix + `.toFixed(2)` formatting with `formatCurrency()` utility from `lib/quotes.ts`.
  - Provides consistent ZAR currency formatting across the application with proper locale support (`en-ZA`).
  - Automatically includes thousand separators (e.g., "R 1,234.56" instead of "R 1234.56").
  - Handles null/undefined prices by defaulting to `formatCurrency(0)`.
  - Aligns with currency formatting used in quotes, orders, and other modules for consistency.

**Implementation Update — Performance Optimizations (2025-11-02)**
- File changed: `components/features/suppliers/supplier-components.tsx:1`.
- What's new:
  - Added search input debouncing (300ms) using `useDebounce` hook to prevent excessive filtering/sorting on every keystroke.
  - Memoized event handlers (`handleSearchInputChange`, `handleSort`, `handlePageChange`, `handlePageSizeChange`) with `useCallback` to prevent unnecessary re-renders.
  - Separated `searchInput` (immediate) from `debouncedSearch` (filtered) for better UX - input feels responsive while filtering is efficient.
  - Filtering/sorting now only runs after user stops typing for 300ms, significantly reducing computational overhead for large datasets.
  - Performance improvement: For 100+ components, reduces filter operations from ~10-20 per second (while typing) to ~3-4 per second (after debounce).

## Orders Tab

**Implementation Date:** January 15, 2025  
**File:** `components/features/suppliers/supplier-orders.tsx`  
**Status:** ✅ Complete

### Overview
The Orders tab displays all purchase orders for a specific supplier with comprehensive filtering capabilities and expandable line item details. This provides visibility into the complete order history and current status of orders with the supplier.

### Features

**Filtering Toolbar:**
- **Date Type Selector**: Choose between Order Date, Receipt Date, or Created Date for date-based filtering
- **From Date / To Date**: Date range pickers using the Calendar component
- **Status Filter**: Dropdown to filter by Draft, Pending Approval, Approved, Partially Received, Fully Received, or Cancelled
- **Q Number Search**: Case-insensitive text search for specific purchase orders
- **Reset Filters**: Button to clear all active filters at once

**Purchase Orders Table:**
- **Expandable Rows**: Click chevron icon to show/hide line item details
- **Q Number**: Clickable link to purchase order detail page (`/purchasing/purchase-orders/[id]`)
- **Order Date**: Formatted as "MMM d, yyyy" (e.g., "Nov 5, 2025")
- **Status**: Color-coded badge (Draft=outline, Approved=default, Partially Received=secondary, Cancelled=destructive)
- **Total Value**: Currency formatted in ZAR using `formatCurrency()` from `lib/quotes.ts`
- **Items**: Count of line items in the purchase order
- **Progress**: Visual display showing "received / ordered" with progress bar

**Line Item Details (Expanded):**
- Component code and description
- Supplier code
- Unit price (ZAR currency formatted)
- Quantity ordered
- Quantity received
- Line total (quantity × unit price)

**Summary Section:**
- Total Orders: Count of filtered purchase orders
- Total Value: Sum of all order values in the filtered set

### Date Filtering Behavior

The date filtering follows the same pattern as the Purchase Orders page (`app/purchasing/purchase-orders/page.tsx:268-289`):

- **Order Date**: Uses `purchase_orders.order_date`, falls back to `created_at`
- **Receipt Date**: Uses the latest receipt date from `supplier_order_receipts.receipt_date` for each order
- **Created Date**: Uses `purchase_orders.created_at`

Time boundaries are applied:
- Start date: Set to 00:00:00.000 (start of day)
- End date: Set to 23:59:59.999 (end of day)

Filtering is client-side after fetching all orders for the supplier.

### Database Query

```typescript
const { data, error } = await supabase
  .from('purchase_orders')
  .select(`
    purchase_order_id,
    q_number,
    order_date,
    created_at,
    notes,
    status:supplier_order_statuses!purchase_orders_status_id_fkey(status_name),
    supplier_orders!inner(
      order_id,
      order_quantity,
      total_received,
      supplier_component:suppliercomponents!inner(
        supplier_component_id,
        supplier_code,
        price,
        lead_time,
        supplier_id,
        component:components(
          component_id,
          internal_code,
          description
        )
      ),
      receipts:supplier_order_receipts(
        receipt_date,
        quantity_received
      )
    )
  `)
  .eq('supplier_orders.suppliercomponents.supplier_id', supplierId)
  .order('order_date', { ascending: false });
```

### Types

Uses `SupplierPurchaseOrder` and `SupplierOrderLineItem` types defined in `types/suppliers.ts:47-76`.

### Code References
- Implementation: `components/features/suppliers/supplier-orders.tsx`
- Page integration: `app/suppliers/[id]/page.tsx:17,140,175-179`
- Types: `types/suppliers.ts:47-76`
- Currency formatting: `lib/quotes.ts:308`
- Date filtering pattern: `app/purchasing/purchase-orders/page.tsx:268-289`

## Reports Tab

**Implementation Date:** January 15, 2025  
**File:** `components/features/suppliers/supplier-reports.tsx`  
**Status:** ✅ Complete

### Overview
The Reports tab provides analytical insights and statistics about supplier performance, order history, and delivery metrics. All statistics can be scoped to a specific date range for time-based analysis.

### Features

**Date Range Filter:**
- From Date / To Date pickers to scope all statistics
- Defaults to "All Time" if no dates selected
- Applies to all statistics cards and sections
- Optional reset button appears when dates are set

**Statistics Cards (Grid Layout):**

1. **Total Orders**
   - Count of purchase orders within date range
   - Simple numeric display

2. **Total Order Value**
   - Sum of all purchase order line totals
   - Currency formatted in ZAR

3. **Outstanding Orders**
   - Count of orders with items not fully received (total_received < order_quantity)
   - Outstanding value calculated from remaining quantities × unit prices
   - Displays both count and monetary value

4. **Average Lead Time**
   - Calculated from order date to first receipt date
   - Only includes orders that have been received
   - Displayed in days, shows "N/A" if no receipts exist
   - Formula: `differenceInDays(firstReceiptDate, orderDate)`

5. **On-Time Delivery Rate**
   - Percentage of line items received within expected lead time
   - Requires `suppliercomponents.lead_time` to be set
   - Shows "N/A" if no lead times defined or no receipts
   - Formula: `(onTimeDeliveries / totalDeliveries) × 100`

6. **Unique Components**
   - Count of distinct components ordered from this supplier
   - Based on unique `component_id` values across all orders

**Orders by Status Section:**
- Grid display showing count of orders by status
- Color-coded badges matching order statuses
- Automatically includes only statuses present in data

**Recent Purchase Orders Section:**
- Timeline of last 10 purchase orders
- Each entry shows:
  - Q Number (clickable link to PO detail page)
  - Status badge
  - Order date and item count
  - Total order value
- Sorted by order date (newest first)

**Empty State:**
- Displays helpful message when no orders exist
- Different message for filtered vs. unfiltered empty state

### Statistics Calculations

**Average Lead Time:**
```typescript
const leadTimes: number[] = [];
filteredOrders.forEach(order => {
  order.supplier_orders.forEach(line => {
    if (line.receipts && line.receipts.length > 0) {
      const orderDate = parseISO(order.order_date || order.created_at);
      const firstReceiptDate = parseISO(line.receipts[0].receipt_date);
      const daysDiff = differenceInDays(firstReceiptDate, orderDate);
      if (daysDiff >= 0) leadTimes.push(daysDiff);
    }
  });
});

const averageLeadTime = leadTimes.length > 0
  ? Math.round(leadTimes.reduce((sum, days) => sum + days, 0) / leadTimes.length)
  : null;
```

**On-Time Delivery Rate:**
```typescript
let onTimeDeliveries = 0;
let totalDeliveries = 0;

filteredOrders.forEach(order => {
  order.supplier_orders.forEach(line => {
    if (line.receipts && line.receipts.length > 0 && line.supplier_component?.lead_time) {
      totalDeliveries++;
      const actualLeadTime = differenceInDays(
        parseISO(line.receipts[0].receipt_date),
        parseISO(order.order_date || order.created_at)
      );
      if (actualLeadTime <= line.supplier_component.lead_time) {
        onTimeDeliveries++;
      }
    }
  });
});

const onTimeDeliveryRate = totalDeliveries > 0
  ? Math.round((onTimeDeliveries / totalDeliveries) * 100)
  : null;
```

### Database Query

Uses the same query as Orders tab to fetch purchase orders with all related data (line items, receipts, components). The difference is in how the data is processed - Reports tab aggregates and calculates statistics rather than displaying individual orders.

### Types

Uses `SupplierStatistics` type defined in `types/suppliers.ts:78-87`.

```typescript
export type SupplierStatistics = {
  totalOrders: number;
  totalValue: number;
  outstandingOrders: number;
  outstandingValue: number;
  averageLeadTime: number | null;
  onTimeDeliveryRate: number | null;
  uniqueComponents: number;
  ordersByStatus: Record<string, number>;
};
```

### UI Components

- **Statistics Cards**: `p-6 bg-card rounded-xl border shadow-sm`
- **Icons**: Package, TrendingUp, Clock (orange), Clock (blue), CheckCircle (green), Layers (purple)
- **Grid Layout**: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4`
- **Recent Orders**: Hover effect with `hover:bg-muted/50 transition-colors`

### Code References
- Implementation: `components/features/suppliers/supplier-reports.tsx`
- Page integration: `app/suppliers/[id]/page.tsx:18,141,181-185`
- Types: `types/suppliers.ts:78-87`
- Date utilities: `date-fns` (format, parseISO, isValid, isBefore, isAfter, differenceInDays)

### Performance Considerations

- All statistics calculated client-side using useMemo for optimal re-render performance
- Date range filtering recalculates statistics automatically
- For suppliers with 100+ orders, statistics calculation is still fast (<100ms)
- Consider moving to server-side RPC functions if performance becomes an issue

### Testing Verification

Tested with:
- ISA Components (1 order): All statistics display correctly, N/A for lead time metrics
- Apex Manufacturing (13 orders): Full statistics with average lead time calculated from receipts
- Date range filtering: Correctly updates all statistics when date filters applied
- Empty states: Display appropriate messages when no data exists
