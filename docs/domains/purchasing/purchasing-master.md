**Purchasing Master**

- **Scope:** Central reference for Purchasing (POs/Q numbers, supplier orders, receiving, emails, and related UI/API).
- **Audience:** Developers and operations. Anchors code, schema, and flows in one place.
- **Status:** Reflects current implementation in this repo. Notes open gaps/TODOs at the end.

**Core Concepts**

- **Supplier Component:** A vendor-specific SKU and price for a component. Key in `suppliercomponents`.
- **Supplier Order (SO):** A line to a specific supplier for a single component and quantity. Stored in `supplier_orders` and linked to a PO via `purchase_order_id`.
- **Purchase Order (PO/Q Number):** Parent record grouping supplier order lines. Finalized with a Q number by Accounts. Stored in `purchase_orders` with optional `q_number` and `supplier_id`.
- **Q Number:** Formatted like `Q23-001`. Required at approval; unique per PO.
- **Receipt:** A quantity received against a supplier order line. Stored in `supplier_order_receipts` and also records an `inventory_transactions` entry.

**UI & Routes**

- **Dashboard:** Overview and quick filters for pending/approved metrics and recent POs.
  - Page: `app/purchasing/page.tsx:49` (fetch), `app/purchasing/page.tsx:170` (derived status), `app/purchasing/page.tsx:220` (section title, list).
- **All Purchase Orders:** Tabbed list (In Progress/Completed) with filtering by status, Q number, supplier, date range.
  - Page: `app/purchasing/purchase-orders/page.tsx:1` (page), `app/purchasing/purchase-orders/page.tsx:19` (status badge), `app/purchasing/purchase-orders/page.tsx:28` (fetch & joins), `app/purchasing/purchase-orders/page.tsx:96` (derived status logic).
  - **Date Filtering:** The date range filter uses `order_date` if available, falling back to `created_at` for filtering. Filtering is done client-side after fetching all orders. The "From Date" and "To Date" pickers allow selecting a date range, and orders are filtered to show only those within the selected range. See `app/purchasing/purchase-orders/page.tsx:268-289` for the filtering logic.
- **PO Details:** Review items, totals, suppliers; submit for approval; approve with Q number; receive items; view receipt history.
  - Page: `app/purchasing/purchase-orders/[id]/page.tsx:1` (page), `app/purchasing/purchase-orders/[id]/page.tsx:115` (fetch with joins), `app/purchasing/purchase-orders/[id]/page.tsx:201` (approve → send emails), `app/purchasing/purchase-orders/[id]/page.tsx:232` (submit for approval), `app/purchasing/purchase-orders/[id]/page.tsx:313` (receipt: total_received), `app/purchasing/purchase-orders/[id]/page.tsx:346` (receipt: inventory), `app/purchasing/purchase-orders/[id]/page.tsx:528` (status flags, UI state), `app/purchasing/purchase-orders/[id]/page.tsx:720` (receipt history section).
  - **Sticky Header:** Uses the "Page-Level Sticky Header" pattern (see `docs/overview/STYLE_GUIDE.md`) with dynamic offset calculation to position the blue header bar flush below the navbar. Implementation: `app/purchasing/purchase-orders/[id]/page.tsx:1078` (header), `app/purchasing/purchase-orders/[id]/page.module.css:1` (styles), `app/purchasing/purchase-orders/[id]/page.tsx:584` (offset calculation).
- **Create PO (manual):** Multi-line form to select components, pick supplier per-line, and set quantities/notes.
  - Page: `app/purchasing/purchase-orders/new/page.tsx:1` (page wrapper)
  - Form: `components/features/purchasing/new-purchase-order-form.tsx:147` (fetch Draft status), `components/features/purchasing/new-purchase-order-form.tsx:180` (supplier component fetch), `components/features/purchasing/new-purchase-order-form.tsx:210` (createPurchaseOrder), `components/features/purchasing/new-purchase-order-form.tsx:284` (mutation, redirect).
- **Create POs from Sales Order:** Generates one PO per supplier containing selected components and links each SO to the customer order.
  - File: `app/orders/[orderId]/page.tsx:655` (createComponentPurchaseOrders), `app/orders/[orderId]/page.tsx:743` (link via junction table).

**Data Model**

- `suppliers`
  - Basic supplier directory. Emails stored in `supplier_emails` with `is_primary` flag.
- `components`
  - Product components/buy parts. `component_id/internals_code/description`.
- `suppliercomponents`
  - Map of component to supplier with `supplier_code`, `price`, etc. See `schema.txt:224`.
- `supplier_order_statuses`
  - Canonical status names for both supplier orders and POs. See `schema.txt:192` and seed scripts below.
- `supplier_orders`
  - SO line with `supplier_component_id`, `order_quantity`, `total_received`, `status_id`, `order_date`, and `purchase_order_id` FK. See `schema.txt:199`. Column `purchase_order_id` added in `scripts/setup-database-functions.sql`.
- `purchase_orders`
  - PO header: `purchase_order_id`, `q_number` (unique), `status_id`, `order_date`, `notes`, `created_by/approved_by/at`, and `supplier_id`. See `schema.txt:248` and `migrations/add_supplier_id_to_purchase_orders.sql`.
- `supplier_order_receipts`
  - Receipts with `order_id`, `transaction_id`, `quantity_received`, `receipt_date`. See `schema.txt:181`.
- `inventory_transactions`
  - Records stock movements with `transaction_type_id` and optional `order_id`. See `schema.txt:108`.
- `supplier_order_customer_orders`
  - Junction table linking SO lines back to a customer order. See `sql/create_junction_table.sql:1`.

**Key Relationships**

- `purchase_orders 1—* supplier_orders` via `supplier_orders.purchase_order_id`.
- `supplier_orders *—1 suppliercomponents —1* suppliers` and `—1* components`.
- `supplier_order_receipts *—1 supplier_orders` and `*—1 inventory_transactions`.
- `supplier_order_customer_orders *—1 supplier_orders` and `*—1 orders` and `*—1 components`.

**Statuses & Lifecycle**

- System uses shared names in `supplier_order_statuses`. Active names referenced in code:
  - Draft → Pending Approval → Approved → Partially Received → Fully Received; Cancelled (terminal).
  - Earlier names also exist for generic supplier orders: Open, In Progress, Completed, Cancelled. Views account for both name sets.
- Seeding and existence:
  - Added by scripts: Open/In Progress/Partially Delivered/Completed/Cancelled (`scripts/setup-database-functions.sql:44`), Draft and Pending Approval (`scripts/setup-database-functions.sql:98`).
  - Code expects additional names: Approved, Partially Received, Fully Received. Ensure these exist in `supplier_order_statuses` in production.
- Derived display status for POs considers receipts:
  - If PO status Approved and any SO `total_received` > 0 but < ordered → “Partially Received”.
  - If all lines fully received → “Fully Received”. See `app/purchasing/page.tsx:170`, `app/purchasing/purchase-orders/page.tsx:96`.

**Create PO (Manual)**

- Form groups items by supplier and uses the transactional RPC `create_purchase_order_with_lines` so the purchase order header
  and supplier order rows are inserted atomically.
  - Payload: `{ supplier_id, line_items: [{ supplier_component_id, order_quantity, component_id, quantity_for_order, quantity_for_stock, customer_order_id }] }`.
  - UI builds one payload per supplier. Each line item can be optionally linked to a specific `customer_order_id`. If linked, `quantity_for_order` is set; otherwise, it defaults to `quantity_for_stock`.
  - Entry point: `components/features/purchasing/new-purchase-order-form.tsx:210`.

**Create POs From Sales Order**

- Groups selected components by supplier, builds a batched payload per supplier, and calls the transactional RPC `create_purchase_order_with_lines`.
  - The RPC handles PO header creation, inserts all supplier order lines in a single `INSERT ... VALUES (...)` call, and links them to the customer order inside the same transaction so any failure rolls everything back.
  - UI hook (grouping, payload shaping, error surfacing): `app/orders/[orderId]/page.tsx:573`.
  - User feedback lists the supplier names that failed so operators can retry only the affected groups.

**Approval & Q Numbers**

- Submit For Approval:
  - Sets PO and all related SOs to “Pending Approval”. See `app/purchasing/purchase-orders/[id]/page.tsx:232`.
- Approve PO:
  - Validates Q number against `/^Q\d{2}-\d{3}$/`.
  - Sets `purchase_orders.q_number`, status “Approved”, stamps `approved_at/by`, cascades SO statuses to “Approved”. See `app/purchasing/purchase-orders/[id]/page.tsx:201`.
  - Triggers email dispatch to suppliers (non-blocking).
- Manual re-send is available via "Send Supplier Emails" in the PO action bar (visible once approved).

**Email Sending**

- API route: `app/api/send-purchase-order-email/route.ts:1`.
  - Loads PO + supplier order detail, groups by supplier, resolves the primary supplier email from `supplier_emails` (or falls back to any available), renders HTML with `@react-email`, sends via Resend.
  - Request shape: `{ purchaseOrderId, overrides?, cc? }`.
  - Success/failure summaries surface as toasts; partial sends list supplier names that failed.
  - “Send Supplier Emails” opens a review dialog so operators can inspect recipient addresses, override them, and add CC recipients before dispatching.
- Templating: `emails/purchase-order-email.tsx:1`.
- The PO template uses a supplier-focused layout (branded header, spacious zebra table, footer) and automatically injects the company logo, addresses, website, and contact details from Settings so suppliers get a consistent experience without the customer-only summary or terms blocks. Messages still send from the `EMAIL_FROM` identity for deliverability, while the body shows the Settings contact details.
- Manual re-send button: `Send Supplier Emails` (bottom action bar) calls the same API for already-approved POs.
- Low-level utility (not used by API route directly): `lib/email.ts:11`.
- Branding fields (logo, address, and contact details) are sourced from `quote_company_settings` (Settings → Company). Environment variables such as `COMPANY_NAME`/`COMPANY_ADDRESS` only act as fallbacks for development.

**Receiving Flow**

- **Enhanced Receive Modal (January 2025):** 🚧 IN PROGRESS - Purchase order detail page now uses a comprehensive modal dialog for receiving items with inspection and rejection capabilities. The "Receive" button opens a modal where operators can record both received quantities AND rejected quantities (gate inspection failures) in a single form. See `app/purchasing/purchase-orders/[id]/ReceiveItemsModal.tsx` and changelog [`purchase-order-receive-modal-20250115.md`](../../changelogs/purchase-order-receive-modal-20250115.md).
- **Current Status:** Modal component created and integrated, but not yet appearing in browser (cache/build issue being investigated).
- UI: Receive inputs are enabled when PO is "Approved". See `app/purchasing/purchase-orders/[id]/page.tsx:528` and table inputs at `app/purchasing/purchase-orders/[id]/page.tsx:1231`.
- Order Items table displays: Component, Description, Supplier, Unit Price, **Ordered**, **Received**, **Owing** (highlighted in orange when > 0), Receive Now (button that opens modal), and Total. The "Owing" column shows `order_quantity - total_received` to clearly indicate remaining stock to receive.
- On submit (via modal):
  - Call the transactional RPC `process_supplier_order_receipt` to insert the inventory transaction, create the receipt record, update `inventory`, and recompute `supplier_orders.total_received`/status in one transaction.
  - If items are rejected, also call `process_supplier_order_return` with type='rejection' to record gate rejections (no inventory impact).
  - Generate GRN (Goods Return Number) for any rejections.
  - Show success state with PDF download and email notification options. The PDF generation fetches company settings (logo, address) from `quote_company_settings` to ensure correct branding.
- **Auto-refresh:** After receiving stock, the page automatically updates without manual refresh. The mutation invalidates and refetches queries with `refetchOnMount: true` and `staleTime: 0` configured on the purchase order query. Both inline per-row receipts (`receiveOneMutation`) and bulk receipts (`receiptMutation`) trigger immediate refetch of active queries.
- Receipt history renders under the PO with all receipts per line: `app/purchasing/purchase-orders/[id]/page.tsx:760`. Detail page implementation lives in `components/features/purchasing/order-detail.tsx`.
- Deployment: apply `supabase/migrations/20251107_process_supplier_receipt.sql` via the Supabase CLI (`supabase db push` after linking the project) or run the script directly in SQL to enable the RPC before deploying updated UI.
- Component picker: `components/features/purchasing/new-purchase-order-form.tsx` now uses an async-friendly search box powered by `react-select`. Typing filters by component code or description, selecting a result resets the supplier dropdown to avoid stale matches, and the input supports clearing selections.

**DB Functions & Views**

- `process_supplier_order_receipt(order_id int, quantity int, receipt_date timestamptz default now())` — transactional RPC defined in `supabase/migrations/20251107_process_supplier_receipt.sql`. Handles receipt insertion, inventory updates, and status recompute atomically. Granted to `authenticated` and `service_role`.
- `process_supplier_order_return(p_supplier_order_id int, p_quantity numeric, p_reason text, p_return_type text, p_return_timestamp timestamptz, p_returned_by bigint, p_notes text, p_goods_return_number text, p_batch_id bigint, p_signature_status text)` — transactional RPC for supplier returns (both immediate rejections and later returns from stock). Fixed in migration `20250113_fix_rpc_overload_conflict_v6.sql` to resolve function overload conflicts and schema mismatches. Handles inventory OUT transactions, GRN generation, and return tracking. See [`../../changelogs/supplier-returns-rpc-overload-fix-20250113.md`](../../changelogs/supplier-returns-rpc-overload-fix-20250113.md).
- `create_update_order_received_quantity_function` RPC installer creates `update_order_received_quantity(order_id int)` to recompute `total_received` and set status based on sums. See `scripts/create-rpc-function.sql:2`.
- Creation RPCs:
  - `create_purchase_order_with_lines(supplier_id int, customer_order_id int, line_items jsonb, status_id int, order_date timestamptz, notes text)` — inserts PO + SO rows atomically and updates the junction table.
- Legacy components still call `update_order_received_quantity` directly if the new RPC is unavailable. Keep the fallback until all environments have the migration applied.
- Component requirement/stock views and helpers: `sql/create_component_views.sql:1` (materialized views + `get_*` functions) used by ordering workflows.

**Types**

- Primary types used across UI: `types/purchasing.ts:57` (`PurchaseOrder`), `types/purchasing.ts:20` (`SupplierOrder`), `types/purchasing.ts:30` (`PurchaseOrder.purchase_order_id` nullable usage in some contexts), plus Zod form types in the new PO form.

**Security & Auth**

- Client uses `supabase` browser client: `lib/supabase.ts:1`. Approval records `approved_by` with current user (`supabase.auth.getUser()`); ensure RLS policies allow these updates for authenticated users in your project.

**Environment**

- Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (client), `SUPABASE_SERVICE_ROLE_KEY` (server/API, scripts), `RESEND_API_KEY` (email).
- Optional identity: `EMAIL_FROM`, `COMPANY_NAME`, `COMPANY_LOGO`, `COMPANY_ADDRESS`, `COMPANY_PHONE`, `NEXT_PUBLIC_PO_EMAIL_CC` (default CC list for the Send Supplier Emails dialog).
- Scripts: `npm run init-purchasing` runs `scripts/init-purchasing-data.ts` to seed basics (statuses, transaction types, function installer).

**Known Gaps & TODOs**

- Status seeds: Ensure `Approved`, `Partially Received`, and `Fully Received` exist in `supplier_order_statuses`. The setup script now seeds these alongside legacy names (Open/In Progress/Partially Delivered/Completed/Cancelled) for parity with UI logic.
- Deploy `process_supplier_order_receipt` everywhere so we can eventually remove the manual fallback logic from the UI.
- `schema.txt` may be out of sync with `supplier_orders.purchase_order_id` addition; the script adds it, but `schema.txt` does not show it in the first definition block. Align schema snapshot.
- Validation: Prevent receiving quantities > remaining; UI enforces `max` but add server-side checks in RPCs.
- Resolved — Receiving insert bug: `receiveStock` in `app/purchasing/purchase-orders/[id]/page.tsx` now mirrors the working `OrderDetail` logic. It looks up the component first, omits the sales‑order FK when inserting into `inventory_transactions`, records the receipt, updates on‑hand inventory, and recomputes `total_received` via `update_order_received_quantity` (with manual fallback).
- Resolved — Purchase order detail page auto-refresh: Added `refetchOnMount: true` and `staleTime: 0` to the purchase order query, and updated receipt mutations to use `refetchQueries` with `type: 'active'` to ensure the page updates immediately after receiving stock without manual refresh.
- Resolved — "Owing" column added: The Order Items table now displays Ordered, Received, and Owing columns. Owing shows `order_quantity - total_received` with orange highlighting when > 0, making it easy to see remaining stock to receive.
- Email routing: If a supplier has no primary email, API logs and skips. Consider fallback to any email or flag PO for manual follow-up.
- Multi-supplier PO header: We currently store a `supplier_id` on `purchase_orders` for manual PO path; multi-supplier POs (from sales order grouping) still compute supplier lists from lines. Confirm whether `supplier_id` should be optional or represent a "primary supplier".
- Q number uniqueness: DB constraint exists; add graceful handling when collision occurs (e.g., toast with retry).
- **Stock Issuance:** ✅ Implemented (January 2025). Stock issuance functionality is available on the Order Detail page ("Issue Stock" tab) rather than the Purchase Order page. This allows issuing stock OUT of inventory against customer orders with full BOM integration, PDF generation, and issuance tracking. Uses SALE transaction type (ID: 2) for OUT transactions. See [`../changelogs/stock-issuance-implementation-20250104.md`](../changelogs/stock-issuance-implementation-20250104.md) for implementation details and [`../domains/components/inventory-transactions.md`](../domains/components/inventory-transactions.md) for transaction specifications.
- **Supplier Returns:** 🚧 IN PROGRESS (January 2025). Enhanced receiving modal with gate rejection capability being implemented. The `process_supplier_order_return` RPC function exists and is fixed (v6 migration), `supplier_order_returns` table exists, GRN generation works, PDF and email integrations ready. UI modal component created but not yet appearing in browser (cache/build issue). See [`../../changelogs/purchase-order-receive-modal-20250115.md`](../../changelogs/purchase-order-receive-modal-20250115.md) for current status.

**Quick Reference**

- Dashboard metrics query: `app/purchasing/page.tsx:117`.
- All orders filters (status/Q/supplier/date): `app/purchasing/purchase-orders/page.tsx:214` (filtering logic), `app/purchasing/purchase-orders/page.tsx:268-289` (date range filtering).
- Approve PO + email: `app/purchasing/purchase-orders/[id]/page.tsx:201` and `app/api/send-purchase-order-email/route.ts:1`.
- Receive flow: `app/purchasing/purchase-orders/[id]/page.tsx:313`, `:346`, and history at `:760`.
- Manual PO create: `components/features/purchasing/new-purchase-order-form.tsx:210`.
- PO generation from Sales Order: `app/orders/[orderId]/page.tsx:655`.

**How To Verify End‑to‑End**

- Create a PO via Purchasing → New. Confirm a PO per-supplier is created and SO lines exist.
- Submit for approval, then approve with a valid Q number. Check supplier email(s) are sent (API logs/results returned).
- Optionally open “Send Supplier Emails” to confirm recipients/CCs and manually resend; toast output will note any suppliers that failed.
- Optional: use “Send Supplier Emails” to manually resend and confirm toast feedback (success vs partial failure).
- Receive partial quantities, verify SO `total_received` increments, PO derived status becomes “Partially Received”.
- Receive the balance, verify status becomes “Fully Received” and inventory increases correctly.

**Reset & Cleanup**

- See `docs/domains/purchasing/purchasing-reset-guide.md` for the scoped cleanup script, dry‑run steps, and safeguards when clearing only Purchasing data.
