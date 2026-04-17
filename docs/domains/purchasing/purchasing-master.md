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
- **All Purchase Orders:** Tabbed list (In Progress/Completed) with filtering by status, communication state, Q number, supplier, and date range.
  - Page: `app/purchasing/purchase-orders/page.tsx:1` (page), `app/purchasing/purchase-orders/page.tsx:19` (status badge), `app/purchasing/purchase-orders/page.tsx:28` (fetch & joins), `app/purchasing/purchase-orders/page.tsx:96` (derived status logic).
  - **Back-navigation scroll restore:** The PO list now stores the current scroll offset in the browser history entry and restores it after returning from a detail page. Filters/tab/page still live in the URL, and Back now returns buyers to the same vertical position in the list instead of jumping to the top.
  - **Communication column:** The main PO table now surfaces a compact email-status badge per PO so buyers do not need to open each record to confirm supplier-email delivery. The badge is derived from the latest PO-send log per supplier/recipient in `purchase_order_emails` (including legacy rows where `email_type` is `NULL`) and shows `Not Emailed`, `Email Sent`, `Email Delivered`, `Email Partial`, or `Email Issue`. Longer explanations, including the latest send timestamp, now live in a hover tooltip to keep list rows compact. Resend webhook states `opened` and `clicked` are treated as delivered on the list. `Needs Email Attention` is available as a list filter and is intentionally stricter than the global navbar icon: approved/receiving-stage POs remain flagged until every supplier email is delivered.
  - **Date Filtering:** The date range filter uses `order_date` if available, falling back to `created_at` for filtering. Filtering is done client-side after fetching all orders. The "From Date" and "To Date" pickers allow selecting a date range, and orders are filtered to show only those within the selected range. See `app/purchasing/purchase-orders/page.tsx:268-289` for the filtering logic.
- **PO Details:** Review items, totals, suppliers; submit for approval; approve with Q number; receive items; view receipt history.
  - Page: `app/purchasing/purchase-orders/[id]/page.tsx:1` (page), `app/purchasing/purchase-orders/[id]/page.tsx:115` (fetch with joins), `app/purchasing/purchase-orders/[id]/page.tsx:201` (approve → send emails), `app/purchasing/purchase-orders/[id]/page.tsx:232` (submit for approval), `app/purchasing/purchase-orders/[id]/page.tsx:313` (receipt: total_received), `app/purchasing/purchase-orders/[id]/page.tsx:346` (receipt: inventory), `app/purchasing/purchase-orders/[id]/page.tsx:528` (status flags, UI state), `app/purchasing/purchase-orders/[id]/page.tsx:720` (receipt history section).
  - Layout: the detail page now prioritizes `Order Items` first, places `Receipt History` immediately after it, and renders the remaining sections collapsed by default. `Attachments` stays near the bottom with a compact upload area so supporting files do not dominate the page.
  - **Attachment filing:** The PO detail page now asks operators how each upload should be filed before it is stored. Supported types are `Delivery Note`, `Proof of Payment`, and `General Attachment`. Delivery notes can optionally be linked to an existing receipt so the supporting paperwork stays tied to the receipt trail.
  - **Sticky Header:** Uses the "Page-Level Sticky Header" pattern (see `docs/overview/STYLE_GUIDE.md`) with dynamic offset calculation to position the blue header bar flush below the navbar. Implementation: `app/purchasing/purchase-orders/[id]/page.tsx:1078` (header), `app/purchasing/purchase-orders/[id]/page.module.css:1` (styles), `app/purchasing/purchase-orders/[id]/page.tsx:584` (offset calculation).
- **Quick Upload (documents):** Mobile-friendly purchasing-document filing route used by receiving and accounts staff.
  - Pages: `app/purchasing/quick-upload/page.tsx:1` and shortcut redirect `app/upload/page.tsx:1`.
  - Flow: choose the document type (`Delivery Note`, `Proof of Payment`, or `General Attachment`), select the file, find the PO, and upload it directly to the purchase order. Delivery notes can optionally be linked to an existing receipt.
  - Desktop behavior: the quick-upload tile supports click-to-browse, drag-and-drop, and clipboard paste (`Ctrl/Cmd+V`). Delivery notes stay limited to image/PDF uploads, while proof-of-payment and general attachments also accept Word, Excel, text, and CSV files.
- **Create PO (manual):** Multi-line form to select components, pick supplier per-line, and set quantities/notes.
  - Page: `app/purchasing/purchase-orders/new/page.tsx:1` (page wrapper)
  - Form: `components/features/purchasing/new-purchase-order-form.tsx:147` (fetch Draft status), `components/features/purchasing/new-purchase-order-form.tsx:180` (supplier component fetch), `components/features/purchasing/new-purchase-order-form.tsx:210` (createPurchaseOrder), `components/features/purchasing/new-purchase-order-form.tsx:284` (mutation, redirect).
  - Deep-link prefill: `/purchasing/purchase-orders/new?componentId=<id>&suggestedQuantity=<qty>` injects the selected component into the active shared draft (or the blank first row), auto-selects the supplier when only one mapping exists, and removes the query string after the draft is hydrated. This is the canonical route used by the Dashboard low-stock `Order` action.
  - Shared-draft recovery is now tab-aware: the form remembers the exact draft selected in the current browser tab and restores that draft after refresh instead of falling back to whichever org draft was most recently updated by the same user.
  - Shared-draft autosave is now serialized client-side before submit/status transitions so large multi-line forms cannot race overlapping saves into stale version conflicts or recreate stray one-line drafts after conversion/discard.
  - Crash recovery: the form writes a local backup to `localStorage` on every autosave debounce (before the network call). If the browser crashes or the network is down and no server-side draft exists on reload, the form recovers from the local backup and warns the user to review and save. The local backup is cleared on successful autosave, draft selection change, submit, or discard.
  - Navigation guard: a `beforeunload` prompt fires if the form has meaningful unsaved content, preventing accidental data loss from refresh or tab close.
  - Validation errors now surface as toast notifications with a summary of the first few problems, and the form scrolls to the first errored field. Creation errors also surface as toasts so they are visible regardless of scroll position on long forms.
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
  - SO line with `supplier_component_id`, decimal-safe `order_quantity` / `total_received`, `status_id`, `order_date`, and `purchase_order_id` FK. See `schema.txt:199`. Column `purchase_order_id` added in `scripts/setup-database-functions.sql`.
- `purchase_orders`
  - PO header: `purchase_order_id`, `q_number` (unique), `status_id`, `order_date`, `notes`, `created_by/approved_by/at`, and `supplier_id`. See `schema.txt:248` and `migrations/add_supplier_id_to_purchase_orders.sql`.
- `purchase_order_emails`
  - Email log rows for PO sends, follow-ups, cancellations, and delivery outcomes. The PO list communication badge currently derives its top-level state from the latest `po_send` entry per supplier, while the detail page continues to show the full activity history and bounce reasons.
- `purchase_order_attachments`
  - Supporting PO documents stored against the purchase order, including delivery notes, proof of payment, and general supporting files. Rows can optionally link to a `supplier_order_receipts.receipt_id` when a document should live against a specific receipt event.
- `supplier_order_receipts`
  - Receipts with `order_id`, `transaction_id`, decimal-safe `quantity_received`, and `receipt_date`. See `schema.txt:181`.
- `inventory_transactions`
  - Records stock movements with decimal-safe `quantity`, `transaction_type_id`, and optional `order_id`. See `schema.txt:108`.
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
- Shared draft workspace (repo implementation landed 2026-03-06; migration still needs to be applied before rollout):
  - Manual PO composition now targets `purchase_order_drafts` + `purchase_order_draft_lines` instead of browser-only session storage.
  - Drafts are scoped by `org_id`, shared across users inside the same organization, and autosaved through the `save_purchase_order_draft` RPC so header + lines + version bump happen atomically.
  - Operators can open an existing shared draft, rename it, discard it, or continue editing from another workstation/browser after sign-in.
  - Successful PO creation marks the draft `converted` via `set_purchase_order_draft_status`; incomplete work no longer needs to live in `purchase_orders`.

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

- **Enhanced Receive Modal:** Purchase order detail page uses a modal dialog for receiving items with inspection and rejection capabilities. The "Receive" button opens a form where operators can record accepted quantities, rejected quantities, notes, and delivery-note attachments. See `app/purchasing/purchase-orders/[id]/ReceiveItemsModal.tsx` and changelog [`purchase-order-receive-modal-20250115.md`](../../changelogs/purchase-order-receive-modal-20250115.md).
- UI: Receive inputs are enabled when PO is "Approved". See `app/purchasing/purchase-orders/[id]/page.tsx:528` and table inputs at `app/purchasing/purchase-orders/[id]/page.tsx:1231`.
- Order Items table displays: Component, Description, Supplier, Unit Price, **Ordered**, **Received**, **Owing** (highlighted in orange when > 0), Receive Now (button that opens modal), and Total. The "Owing" column shows `order_quantity - total_received` to clearly indicate remaining stock to receive.
- Fractional quantities: the receive modal, bulk receive modal, return inputs, dashboard owing badges, and PO status derivation now use decimal-safe comparisons/formatting so lines such as `41.90 ordered / 41.00 received / 0.90 owing` do not degrade into browser validation errors or floating-point display noise.
- On submit (via modal):
  - Call the transactional RPC `process_supplier_order_receipt` to insert the inventory transaction, create the receipt record, update `inventory`, and recompute `supplier_orders.total_received`/status in one transaction.
  - If items are rejected, also call `process_supplier_order_return` with type='rejection' to record gate rejections (no inventory impact).
  - Generate GRN (Goods Return Number) for any rejections.
  - Show success state with PDF download and email notification options. The PDF generation fetches company settings (logo, address) from `quote_company_settings` to ensure correct branding.
- **Auto-refresh:** After receiving stock, the page automatically updates without manual refresh. The mutation invalidates and refetches queries with `refetchOnMount: true` and `staleTime: 0` configured on the purchase order query. Both inline per-row receipts (`receiveOneMutation`) and bulk receipts (`receiptMutation`) trigger immediate refetch of active queries.
- Receipt history renders under the PO with all receipts per line: `app/purchasing/purchase-orders/[id]/page.tsx:760`. Detail page implementation lives in `components/features/purchasing/order-detail.tsx`.
- Receiving guardrails: the PO detail page and bulk receive modal now detect allocation/data mismatches before calling the receipt RPC. If a line has allocation rows whose totals do not equal the supplier-order quantity, the UI shows a plain-English warning and blocks receiving for that line until the `For Order` allocation is corrected.
- Draft quantity edits now try to keep the saved `For Order` split in sync. Single-order lines follow the new line quantity automatically, stock-only lines stay stock-only, and mixed/split lines preserve their explicit customer-order quantities while adjusting the stock remainder. If a user tries to reduce a line below the quantity already assigned to customer orders, the save is blocked and they must edit the `For Order` split first.
- Deployment: apply `supabase/migrations/20260311141133_fractional_purchase_receipts.sql` before deploying the updated purchasing UI. That migration converts `supplier_order_receipts.quantity_received`, `inventory_transactions.quantity`, and `inventory.quantity_on_hand` to `numeric` and replaces `process_supplier_order_receipt` with a decimal-safe version that matches the live org-aware signature.
- Component picker: `components/features/purchasing/new-purchase-order-form.tsx` now uses an async-friendly search box powered by `react-select`. Typing filters by component code or description, selecting a result resets the supplier dropdown to avoid stale matches, and the input supports clearing selections.

**DB Functions & Views**

- `process_supplier_order_receipt(p_order_id int, p_quantity numeric, p_receipt_date timestamptz default now(), p_notes text default null, p_allocation_receipts jsonb default null, p_rejected_quantity numeric default 0, p_rejection_reason text default null, p_attachment_path text default null, p_attachment_name text default null)` — transactional RPC used by the PO receive modal and bulk receive modal. The 2026-03-11 hotfix migration `supabase/migrations/20260311141133_fractional_purchase_receipts.sql` keeps the live org-aware function shape, but changes receipt/inventory math to `numeric` so fractional balances can be received safely.
- `process_supplier_order_return(p_supplier_order_id int, p_quantity numeric, p_reason text, p_return_type text, p_return_timestamp timestamptz, p_returned_by bigint, p_notes text, p_goods_return_number text, p_batch_id bigint, p_signature_status text)` — transactional RPC for supplier returns (both immediate rejections and later returns from stock). Fixed in migration `20250113_fix_rpc_overload_conflict_v6.sql` to resolve function overload conflicts and schema mismatches. Handles inventory OUT transactions, GRN generation, and return tracking. See [`../../changelogs/supplier-returns-rpc-overload-fix-20250113.md`](../../changelogs/supplier-returns-rpc-overload-fix-20250113.md).
- `create_update_order_received_quantity_function` RPC installer creates `update_order_received_quantity(order_id int)` to recompute `total_received` and set status based on sums. See `scripts/create-rpc-function.sql:2`.
- Creation RPCs:
  - `create_purchase_order_with_lines(supplier_id int, customer_order_id int, line_items jsonb, status_id int, order_date timestamptz, notes text)` — inserts PO + SO rows atomically and updates the junction table.
- Legacy components still call `update_order_received_quantity` directly if the new RPC is unavailable. Keep the fallback until all environments have the migration applied.
- Component requirement/stock views and helpers: `sql/create_component_views.sql:1` (materialized views + `get_*` functions) used by ordering workflows.

**Types**

- Primary types used across UI: `types/purchasing.ts:57` (`PurchaseOrder`), `types/purchasing.ts:20` (`SupplierOrder`), `types/purchasing.ts:30` (`PurchaseOrder.purchase_order_id` nullable usage in some contexts), plus Zod form types in the new PO form.
- Shared draft helpers/types: `types/purchasing.ts` now also defines `PurchaseOrderDraftStatus` / `PurchaseOrderDraft` / `PurchaseOrderDraftLine`, and `lib/client/purchase-order-drafts.ts` handles fetch/save/status transitions for the shared draft workspace.

**Security & Auth**

- Client uses `supabase` browser client: `lib/supabase.ts:1`. Approval records `approved_by` with current user (`supabase.auth.getUser()`); ensure RLS policies allow these updates for authenticated users in your project.

**Environment**

- Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (client), `SUPABASE_SERVICE_ROLE_KEY` (server/API, scripts), `RESEND_API_KEY` (email).
- Optional identity: `EMAIL_FROM`, `COMPANY_NAME`, `COMPANY_LOGO`, `COMPANY_ADDRESS`, `COMPANY_PHONE`, `NEXT_PUBLIC_PO_EMAIL_CC` (default CC list for the Send Supplier Emails dialog).
- Scripts: `npm run init-purchasing` runs `scripts/init-purchasing-data.ts` to seed basics (statuses, transaction types, function installer).

**Known Gaps & TODOs**

- Status seeds: Ensure `Approved`, `Partially Received`, and `Fully Received` exist in `supplier_order_statuses`. The setup script now seeds these alongside legacy names (Open/In Progress/Partially Delivered/Completed/Cancelled) for parity with UI logic.
- Deploy `process_supplier_order_receipt` everywhere so we can eventually remove the manual fallback logic from the UI.
- Resolved — Fractional receipt hotfix (2026-03-11): the receiving path now supports decimal balances end-to-end. UI inputs use `step="any"` plus rounded remaining-quantity helpers, and the migration `20260311141133_fractional_purchase_receipts.sql` converts receipt/inventory persistence plus `process_supplier_order_receipt` from integer-only math to `numeric`.
- `schema.txt` may be out of sync with `supplier_orders.purchase_order_id` addition; the script adds it, but `schema.txt` does not show it in the first definition block. Align schema snapshot.
- Validation: Prevent receiving quantities > remaining; UI enforces `max` but add server-side checks in RPCs.
- Historical allocation repair: pre-`2026-02-24` supplier orders can exist with allocation rows whose totals do not match the supplier-order quantity. Production migration `20260303145040_backfill_open_underallocated_supplier_order_stock_rows.sql` backfills the missing remainder to a stock allocation row for still-open lines so receiving does not fail with `receipt exceeds allocation cap`.
- Shared manual-PO drafts: repo support for `purchase_order_drafts` / `purchase_order_draft_lines` and Supabase autosave landed on 2026-03-06, and production now has `20260306161654_purchase_order_shared_drafts.sql` applied. Complete rollout verification in remaining target environments before treating backend-backed draft recovery as fully shipped everywhere.
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
