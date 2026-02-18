**Orders Master**

- **Scope:** Customer orders (sales orders) domain: schema, UI, storage, and links to Purchasing.
- **Audience:** Developers and operations.
- **Status:** Current implementation overview with cleanup guidance for test/dev.

**Core Tables**

- `orders`: Header containing `order_id`, `customer_id`, `order_date`, `status_id`, `order_number`, timestamps, optional `delivery_date`. See `schema.txt:114` (orders + statuses).
- `order_statuses`: Canonical order workflow names (e.g., New, In Progress, Completed, Cancelled).
- `order_details`: Lines: `order_detail_id`, `order_id`, `product_id`, `quantity`, `unit_price`, planned `selected_options` JSONB for configurable products (parity with `quote_items`).
- `order_attachments`: Attachment metadata (DB record) with `file_url`, `file_name`, `uploaded_at`. Storage files live in the Supabase Storage bucket (see below).
- `customers`: Linked via `customer_id`.

**Supabase Storage (Attachments)**

- Bucket: `qbutton` (lowercase in code).
- Upload path pattern: `Orders/Customer/<customer_id>/<filename>`.
- Public URL is stored in `order_attachments.file_url` after upload.
- UI for listing/uploading attachments lives in `app/orders/page.tsx`:
  - Upload uses `UploadAttachmentDialog` which writes to Supabase Storage and inserts a row in `order_attachments`.
  - Listing pulls from `order_attachments` via a React Query (`['orderAttachments', order_id]`).
  - A helper `listCustomerFiles(customerId)` exists but is not currently used by the Orders UI.

**Quick‑Open Attachments (from Product page)**

- The Product page FG reservations dialog (see `app/products/[productId]/page.tsx`) shows per‑order rows when a product is reserved.
- For each order, we fetch the latest record from `order_attachments` and provide an “Open PDF” link.
- This path is read‑only and intended for fast reference while reviewing finished‑goods availability.

**FG Reservations – API Recap**

- Server routes under `app/api/orders/[orderId]/` wrap the FG RPCs:
  - `POST reserve-fg` → `reserve_finished_goods(p_order_id)`
  - `POST release-fg` → `release_finished_goods(p_order_id)`
  - `POST consume-fg` → `consume_finished_goods(p_order_id)`
- Read route:
  - `GET fg-reservations` → reads `product_reservations` then merges product info.

**UI & Routes**

- Orders list: status filter, debounced search (order number, customer name, numeric ID), section chips, attachment count, upload dialog.
  - List page: `app/orders/page.tsx`
  - Detail page: `app/orders/[orderId]/page.tsx`
  - New order (scaffolded): `app/orders/new/page.tsx`
  - Orders layout: `app/orders/layout.tsx`
  - A bypass page also exists: `app/bypass/orders/page.tsx`
  - Each table row is hover/focus interactive and navigates directly to the detail view (chevron indicator replaces the previous "View Details" text link).
  - Delivery Date is inline-editable from the list table: click the date (or "Set date"), choose a calendar day, and the UI updates `orders.delivery_date` via `PATCH /api/orders/[orderId]` (organization-scoped access enforced server-side). The popover closes immediately on selection while the list applies an optimistic date update for snappier feedback, then rolls back with a destructive toast if the server rejects the change.
  - Attachment counts render as pill buttons with improved hover/focus treatment; Upload and Delete controls stop event propagation so row clicks do not trigger unintentionally.
  - The delete action is now an icon-only circular control (`aria-label` supplied) to declutter the actions column while keeping the tooltip/title.

**Data Fetching & Filters (List Page)**

- Query selects `orders` with nested relations: `status:order_statuses`, `customer:customers`, and `details:order_details(product:products)`; sorted by `created_at` desc.
- Status filter resolves `status_id` by `order_statuses.status_name` and filters on the header.
- Search builds an `.or(...)` clause combining:
  - `customer_id.in.(<ids matching customers.name ilike %term%>)`
  - `order_number.ilike.%<term>%`
  - `order_id.eq.<numericTerm>` (when the term parses as an int)
- Section chips are heuristic: `determineProductSections(product)` matches keywords in `product.name/description` to map to `chair`, `wood`, `steel`, `powdercoating`.
- Status badges use a local map to colors: New, In Progress, Completed, Cancelled (fallback to gray).

**Order Detail & Purchasing Linkage**

- Detail page `app/orders/[orderId]/page.tsx` loads header (`orders` with `order_statuses`, `customers`, and `quotes`) plus `order_details(product:products)`. For configurable products, extend the line editor to surface option selectors sourced from attached **Option Sets** (global + product overlays), persist `selected_options`, and call the shared resolver so FG reservations and purchasing respect the chosen configuration even when an order is created directly (no quote).
- **Stock Issuance** (✅ Implemented January 2025):
  - "Issue Stock" tab on Order Detail page (`IssueStockTab` component)
  - BOM-integrated component selection and aggregation
  - Product-level selection with independent order detail control
  - Automatic quantity prepopulation based on BOM requirements
  - Real-time inventory availability checking
  - "All components issued" visual indicators (badges and card highlighting)
  - PDF generation with signature fields for physical signing
  - Issuance history tracking via `stock_issuances` table
  - Supports partial issuance, multiple products, and component aggregation
  - Reversible via `reverse_stock_issuance` RPC (database function exists; UI pending)
  - See [`../changelogs/stock-issuance-implementation-20250104.md`](../changelogs/stock-issuance-implementation-20250104.md) for details
- Component requirements pipeline:
  - RPC: `get_all_component_requirements` to compute global totals.
  - RPC: `get_detailed_component_status(p_order_id)` for per-order requirements with stock/on-order and global fields.
  - RPC: `get_order_component_history(p_order_id)` for per-component historical context.
  - UI summary now distinguishes **Ready Now** (fully covered by on-hand stock) vs **Pending Deliveries** (covered only once outstanding supplier orders arrive). When any component is pending deliveries, the Components Summary card swaps the "All components available in stock" badge for an amber warning explaining that availability depends on incoming receipts, and it shows the count of affected components so planners know what must arrive before issuing stock.
- Suppliers & PO creation:
  - Suppliers fetched from `suppliercomponents` (with supplier emails joined from `supplier_emails`).
  - Components grouped by supplier; user selects components and quantities, and can allocate between "For this order" vs "For stock".
  - **Global Shortfall Ordering**: Component ordering is available when either per-order OR global shortfalls exist. When a component has only a global shortfall (no per-order shortfall due to FG coverage), the "Order Components" dialog displays it with a "For Stock" badge and defaults allocation to stock rather than the current order.
  - **Smart Allocation Defaults**:
    - Components with per-order shortfall: Default allocation to "For this order" (quantity_for_order)
    - Components with only global shortfall: Default allocation to "For stock" (quantity_for_stock)
    - All allocations are user-adjustable before creating the purchase order
  - PO creation looks up `Draft` in `supplier_order_statuses`, inserts into `purchase_orders` and `supplier_orders`, then links each supplier order line to the sales order via `supplier_order_customer_orders` with `quantity_for_order` and `quantity_for_stock`.
  - **Future Enhancement**: Track allocation/earmarking of ordered stock to specific orders for better visibility into what stock is intended for which orders.

**API Routes**

- `app/api/orders/[orderId]/add-products/route.ts` inserts `order_details` rows in bulk and recomputes the order total. Validates `order_id` and request shape.

**Types & DB Utilities**

- Types: `types/orders.ts` defines `Order`, `OrderDetail`, `OrderAttachment`, `Customer`, `OrderStatus`. `Order` uses `order_id` (number) and includes optional `quote` summary.
- DB helpers: `lib/db/orders.ts` defines minimal `createOrder(order)` and `fetchOrders()`. Note: the `Order` interface here uses `id` instead of `order_id` and `quote_id` as string — this differs from `types/orders.ts` and the actual `orders` table.

**Known Gaps / Inconsistencies**

- `lib/db/orders.ts` shape vs runtime:
  - Uses `id` (string) while UI and DB use `order_id` (number). The New Order page navigates with `router.push(\`/orders/${order.id}\`)`, which will be incorrect if Supabase returns `order_id`. Align types and navigation.
- The New Order form is a scaffold; real customer/product selection and header creation are not implemented yet. Current flow prefers creating an order from a Quote (`quote_id`).
- Configurable products: direct order entry does not yet capture option selections. Need to reuse the quote option UI backed by the new option set catalog, persist `selected_options` on `order_details`, and update BOM/reservation logic to honor the configuration without requiring a quote.
- Section chips are heuristic and based on product text; consider explicit product → section metadata.
- Attachments listing relies on `order_attachments`; a storage listing helper exists but is not used. Ensure DB rows are the source of truth to avoid drift.

**Next Steps — Configurable Products Parity**
- Add `selected_options` persistence to `order_details` (column/migration + API updates).
- Reuse `resolveProductConfiguration` when adding or editing products on an order so BOM/FG reservations reflect option choices.
- Display configuration summary chips in the order detail UI and include selections in PDFs/emails to match the quoting experience.

**Cleanup & Reset**

- See `docs/domains/orders/orders-reset-guide.md` for test/dev cleanup.
- Helper scripts: `scripts/cleanup-orders.ts` and `scripts/cleanup-purchasing.ts` can be used to reset data; Purchasing can be cleaned independently (see `docs/domains/purchasing/purchasing-reset-guide.md`).

**Related Schema References**

- Orders domain: `schema.txt` (orders + statuses around line 114 in the snapshot).
- Junction table linking supplier orders to customer orders: `sql/create_junction_table.sql` (table: `supplier_order_customer_orders`).

**Link to Purchasing**

- There is no direct FK from `orders` to `purchase_orders`.
- When generating POs from an order, each supplier order line is linked via junction `supplier_order_customer_orders` containing:
  - `supplier_order_id` (SO), `order_id` (sales order), `component_id`, `quantity_for_order`, `quantity_for_stock`.
  - Schema: `sql/create_junction_table.sql`.
- Component requirement functions (`get_order_component_status`, `get_detailed_component_status`, `get_global_component_requirements`) treat every order status except **Completed** and **Cancelled** as "active". Newly created orders stay visible to purchasing immediately, without needing a status transition.

**Cleanup Considerations**

- If you delete orders, you should also:
  - Remove `supplier_order_customer_orders` rows referencing those orders (to avoid dangling links in Purchasing).
  - Delete `order_attachments` DB rows and delete the corresponding storage files under `qbutton/Orders/Customer/<customer_id>/`.
  - Delete `order_details` rows before deleting the `orders` headers.
  - Refresh component views if you use them to compute requirements: `SELECT refresh_component_views();`.
- Purchasing can be cleaned independently (see `docs/domains/purchasing/purchasing-reset-guide.md`). If you do not also delete POs, the POs and supplier orders remain but will no longer be linked to any order.
- After inserting, updating, or deleting supplier orders directly (outside the UI workflow), run `SELECT refresh_component_views();` so the materialized views feeding the order component dashboards pick up the latest "On Order" quantities.

**Recommended Status Workflow**

- New → In Progress → Completed or Cancelled.
- Cancel instead of delete in production to preserve auditability. For test/dev, see `docs/domains/orders/orders-reset-guide.md` for a safe deletion path.
