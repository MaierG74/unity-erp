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
- **PO Details:** Review items, totals, suppliers; submit for approval; approve with Q number; receive items; view receipt history.
  - Page: `app/purchasing/purchase-orders/[id]/page.tsx:1` (page), `app/purchasing/purchase-orders/[id]/page.tsx:115` (fetch with joins), `app/purchasing/purchase-orders/[id]/page.tsx:201` (approve → send emails), `app/purchasing/purchase-orders/[id]/page.tsx:232` (submit for approval), `app/purchasing/purchase-orders/[id]/page.tsx:313` (receipt: total_received), `app/purchasing/purchase-orders/[id]/page.tsx:346` (receipt: inventory), `app/purchasing/purchase-orders/[id]/page.tsx:528` (status flags, UI state), `app/purchasing/purchase-orders/[id]/page.tsx:720` (receipt history section).
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

- Form groups items by supplier and creates one PO per supplier, then inserts SO lines.
  - Create PO: `purchase_orders.insert({ order_date, status_id: Draft, notes, supplier_id })`.
  - Create SOs: one insert per item with `purchase_order_id` set to the new PO ID.
  - Entry points: `components/features/purchasing/new-purchase-order-form.tsx:210`.

**Create POs From Sales Order**

- Groups selected components by supplier, creates a PO per supplier, inserts SO lines, then links each SO to the customer order via junction table.
  - See `app/orders/[orderId]/page.tsx:655` (grouping), `app/orders/[orderId]/page.tsx:692` (create PO), `app/orders/[orderId]/page.tsx:732` (insert SO with `purchase_order_id`), `app/orders/[orderId]/page.tsx:743` (insert into `supplier_order_customer_orders`).

**Approval & Q Numbers**

- Submit For Approval:
  - Sets PO and all related SOs to “Pending Approval”. See `app/purchasing/purchase-orders/[id]/page.tsx:232`.
- Approve PO:
  - Validates Q number against `/^Q\d{2}-\d{3}$/`.
  - Sets `purchase_orders.q_number`, status “Approved”, stamps `approved_at/by`, cascades SO statuses to “Approved”. See `app/purchasing/purchase-orders/[id]/page.tsx:201`.
  - Triggers email dispatch to suppliers (non-blocking).

**Email Sending**

- API route: `app/api/send-purchase-order-email/route.ts:1`.
  - Loads PO + supplier order detail, groups by supplier, resolves primary supplier email from `supplier_emails`, renders HTML with `@react-email`, sends via Resend.
  - Request shape: `{ purchaseOrderId }`.
- Templating: `emails/purchase-order-email.tsx:1`.
- Low-level utility (not used by API route directly): `lib/email.ts:11`.
- Env required: `RESEND_API_KEY`, `EMAIL_FROM`, and optional company identity (`COMPANY_NAME`, `COMPANY_LOGO`, `COMPANY_ADDRESS`, `COMPANY_PHONE`).

**Receiving Flow**

- UI: Receive inputs are enabled when PO is “Approved”. See `app/purchasing/purchase-orders/[id]/page.tsx:528` and table inputs at `app/purchasing/purchase-orders/[id]/page.tsx:695`.
- On submit (per line with quantity > 0):
  - Insert `inventory_transactions` row (type = receipt).
  - Insert `supplier_order_receipts` row referencing the transaction.
  - Update `supplier_orders.total_received` and status via RPC (see “DB functions”).
  - Increment on-hand inventory via RPC. See `app/purchasing/purchase-orders/[id]/page.tsx:313` and `:346`.
- Receipt history renders under the PO with all receipts per line: `app/purchasing/purchase-orders/[id]/page.tsx:760`.

**DB Functions & Views**

- `create_update_order_received_quantity_function` RPC installer creates `update_order_received_quantity(order_id int)` to recompute `total_received` and set status based on sums. See `scripts/create-rpc-function.sql:2`.
- The UI calls the following RPCs for receiving (ensure they exist in DB):
  - `increment_total_received(p_order_id int, p_quantity int)` → update SO `total_received` and status.
  - `increment_inventory_quantity(p_component_id int, p_quantity int)` → bump inventory on-hand.
  - If your DB does not have these RPCs yet, either add them or switch to the installed `update_order_received_quantity` function used in legacy component: `components/features/purchasing/order-detail.tsx:215`.
- Component requirement/stock views and helpers: `sql/create_component_views.sql:1` (materialized views + `get_*` functions) used by ordering workflows.

**Types**

- Primary types used across UI: `types/purchasing.ts:57` (`PurchaseOrder`), `types/purchasing.ts:20` (`SupplierOrder`), `types/purchasing.ts:30` (`PurchaseOrder.purchase_order_id` nullable usage in some contexts), plus Zod form types in the new PO form.

**Security & Auth**

- Client uses `supabase` browser client: `lib/supabase.ts:1`. Approval records `approved_by` with current user (`supabase.auth.getUser()`); ensure RLS policies allow these updates for authenticated users in your project.

**Environment**

- Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (client), `SUPABASE_SERVICE_ROLE_KEY` (server/API, scripts), `RESEND_API_KEY` (email).
- Optional identity: `EMAIL_FROM`, `COMPANY_NAME`, `COMPANY_LOGO`, `COMPANY_ADDRESS`, `COMPANY_PHONE`.
- Scripts: `npm run init-purchasing` runs `scripts/init-purchasing-data.ts` to seed basics (statuses, transaction types, function installer).

**Known Gaps & TODOs**

- Status seeds: Ensure `Approved`, `Partially Received`, and `Fully Received` exist in `supplier_order_statuses`. Current seed scripts add Draft/Pending Approval and legacy Open/In Progress/Completed/Cancelled; add the missing three for parity with UI logic.
- RPCs for receiving: `increment_total_received` and `increment_inventory_quantity` are called by the PO details page but are not defined in the repo SQL. Either:
  - Add these RPC functions, or
  - Replace calls with `update_order_received_quantity` and direct updates, plus `inventory` adjustments via a single `exec_sql`/RPC.
- `schema.txt` may be out of sync with `supplier_orders.purchase_order_id` addition; the script adds it, but `schema.txt` does not show it in the first definition block. Align schema snapshot.
- Validation: Prevent receiving quantities > remaining; UI enforces `max` but add server-side checks in RPCs.
- Email routing: If a supplier has no primary email, API logs and skips. Consider fallback to any email or flag PO for manual follow-up.
- Multi-supplier PO header: We currently store a `supplier_id` on `purchase_orders` for manual PO path; multi-supplier POs (from sales order grouping) still compute supplier lists from lines. Confirm whether `supplier_id` should be optional or represent a “primary supplier”.
- Q number uniqueness: DB constraint exists; add graceful handling when collision occurs (e.g., toast with retry).

**Quick Reference**

- Dashboard metrics query: `app/purchasing/page.tsx:117`.
- All orders filters (status/Q/supplier/date): `app/purchasing/purchase-orders/page.tsx:260`.
- Approve PO + email: `app/purchasing/purchase-orders/[id]/page.tsx:201` and `app/api/send-purchase-order-email/route.ts:1`.
- Receive flow: `app/purchasing/purchase-orders/[id]/page.tsx:313`, `:346`, and history at `:760`.
- Manual PO create: `components/features/purchasing/new-purchase-order-form.tsx:210`.
- PO generation from Sales Order: `app/orders/[orderId]/page.tsx:655`.

**How To Verify End‑to‑End**

- Create a PO via Purchasing → New. Confirm a PO per-supplier is created and SO lines exist.
- Submit for approval, then approve with a valid Q number. Check supplier email(s) are sent (API logs/results returned).
- Receive partial quantities, verify SO `total_received` increments, PO derived status becomes “Partially Received”.
- Receive the balance, verify status becomes “Fully Received” and inventory increases correctly.

**Reset & Cleanup**

- See `docs/domains/purchasing/purchasing-reset-guide.md` for the scoped cleanup script, dry‑run steps, and safeguards when clearing only Purchasing data.
