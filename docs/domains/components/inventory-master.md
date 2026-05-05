# Inventory Master

## Purpose
- Central reference for managing master components, stock on hand, movements, and replenishment.
- Connects Components (catalog) with Purchasing (receipts), Products/BOM (consumption), and Suppliers (pricing).

## Lifecycle Overview
- Create/maintain master components in Components.
- Stock enters via Purchasing receipts and manual adjustments.
- Stock leaves via production/issue flows and manual adjustments.
- Reorder policies surface low stock and suggested quantities; purchasing converts these into POs.

## Primary UI Entrypoints
- Inventory list: `app/inventory/page.tsx` (current canonical) — tabbed interface with Components, Categories, On Order, Transactions, and Reports tabs.
- Component detail: `app/inventory/components/[id]/page.tsx` — dedicated detail page with Overview, Edit, Inventory, Suppliers, Transactions, Orders, and Analytics tabs.
- Alternative (modular) client: `app/inventory/inventory-client.tsx` — `DataGrid` + `InventoryFilters`.
- Supplier view: `app/suppliers/[id]/page.tsx` → Components tab shows supplier-specific mappings, can originate new master inventory items for the current supplier, and links each master code directly to `app/inventory/components/[id]/page.tsx`.
- Purchasing: `app/purchasing/purchase-orders/[id]/page.tsx` — receipts create movements and increase on‑hand.

## Data Model (working set)
- `components`
  - `component_id`, `internal_code` (unique), `description`, `image_url`, `category_id`, `unit_id`.
- `inventory`
  - `inventory_id`, `component_id`, `quantity_on_hand`, `location`, `reorder_level`.
  - **One-to-one relationship.** A unique constraint on `inventory.component_id` enforces at most one inventory record per component. Frontend consumers should treat `component.inventory` as a single object (Supabase now returns an object, not an array) and fall back to `null` if the record has not been created yet.
  - `location` is an optional free-form storage hint surfaced in the Edit Component dialog and Overview tab. `reorder_level` (aka minimum stock) is optional; when unset it should be stored as `NULL` and shown as a blank input (treat `NULL`/`<= 0` as “no threshold”). It drives the Low Stock alert and the reorder reference line in the stock movement chart.
- `inventory_transactions`
  - `transaction_id`, `component_id`, `quantity`, `transaction_type` ('IN'|'OUT'|'ADJUST'), `transaction_date`, optional `order_id`/reference.
- `suppliercomponents`
  - Supplier mapping with `supplier_code`, `price`, `lead_time`, `min_order_quantity`.
  - Add Component dialog: when attaching suppliers during new component creation, the supplier row can now either pick an existing supplier code or create a new supplier-specific code inline. Saving the component inserts the corresponding `components`, `inventory`, and `suppliercomponents` rows in the same submission, closes the modal after a successful save, refreshes inventory caches, and opens the new component detail page so users can verify the persisted record without searching the paginated list.
  - Supplier-origin quick-create persists the master `components` row, its `inventory` row, and the first `suppliercomponents` mapping together in one organization-scoped save path.
- Reference: `component_categories`, `unitsofmeasure` (standardized; case‑insensitive unique).

## Core Operations
- Receive stock (Purchasing)
  - On PO receipt: insert `inventory_transactions` (IN), insert `supplier_order_receipts`, recompute SO `total_received`, increment `inventory.quantity_on_hand`.
- Issue stock (Customer Orders)
  - Via `process_stock_issuance` RPC: creates OUT transaction (SALE type), decrements `inventory.quantity_on_hand`, records issuance in `stock_issuances` table.
  - UI: Order Detail page → "Issue Stock" tab with BOM integration, component selection, and PDF generation.
  - Supports partial issuance, multiple products, and component aggregation.
  - Reversible via `reverse_stock_issuance` RPC.
- Issue/consume stock (Production/Orders)
  - OUT transactions are created by job/issue flows; they reduce on‑hand.
- Adjust stock (Counts/Corrections)
  - ADJUST with reason and user attribution; affects on‑hand and audit trail.
  - Transactions tab now shows the Stock Adjustment banner even when a component has no prior movements, allowing initial stocktakes to be recorded immediately.
  - Inventory edit hardening (2026-04-09): UI quantity edits should no longer overwrite `inventory.quantity_on_hand` silently. Inventory list/detail edit paths now route quantity changes through the stock-level recording helper so the delta is written to `inventory_transactions`, while metadata (`location`, `reorder_level`) continues to live on `inventory`.
- Manual issuance (Samples/Non‑BOM work)
  - `process_manual_stock_issuance` RPC handles validations, decrements stock, and emits `stock_issuances` rows.
  - Manual issuance history includes PDF download buttons for signed issuance records (mirrors Purchase Order issuance PDFs).

## Reporting & Queries
- Stock Snapshot As Of Date (Reports tab)
  - New report card on `app/inventory/page.tsx` → Reports tab lets users choose an `as_of` date and reverse-calculate historical stock by subtracting transactions after that date from the current on-hand quantity.
  - Default view is quantity-first. An optional toggle can show an **estimated** value using the current lowest supplier price per component, clearly labeled as a current-price estimate rather than historical cost.
  - Historical snapshots before `2026-04-09` are marked **approximate** because older quantity edits may have bypassed the transaction ledger.
- Below Reorder: `inventory.quantity_on_hand < inventory.reorder_level` with joins to components and location.
- Movement History: recent `inventory_transactions` for a component with IN/OUT/ADJUST totals.
- Where Used: BOM/collections usage via `billofmaterials` and `bom_collections` (for shortages and planning).
- On Order: Calculated from open purchase orders (`supplier_orders` where status is Open/In Progress/Approved/Partially Received/Pending Approval), showing `order_quantity - total_received` per component. Only includes `supplier_orders` linked to *existing* `purchase_orders` (via INNER JOIN), ensuring consistency with the Purchase Orders table display and excluding orphaned rows from deleted purchase orders.
- Critical Components to Order: Shows components with global shortfalls across all active orders. Uses `get_global_component_requirements()` RPC to calculate shortfalls, ensuring consistency with order detail page calculations. Displays components where `global_real_shortfall > 0` or `global_apparent_shortfall > 0`.
- Low Stock Alerts (Reports tab): runs a Supabase query for all components + inventory records, then classifies each item as `lowStock` when `quantity_on_hand > 0` and `quantity_on_hand <= reorder_level`. Out-of-stock components are shown separately (quantity ≤ 0). Because the Low Stock card depends on the `inventory` object, ensure the inventory upsert happens whenever quantity, reorder level, or location are edited.
- Stock Movement Chart: the component detail page renders a dashed reference line at the component’s `reorder_level`. The line is hidden when the level is not set (> 0 check). Always pass the normalized `inventory.reorder_level` into `TransactionsTab → StockMovementChart` to keep the chart and Overview data in sync.

## Permissions & RLS
- Reads and writes enforced by Supabase RLS.
- Image uploads (component images) require authenticated session.
- Receiving and adjustments should be performed via server-side RPCs/endpoints to validate roles and invariants.
- Track implementation details in [`permissions-and-logging-plan.md`](../plans/permissions-and-logging-plan.md) as the access-control work progresses.

## Performance Notes
- Current list uses client-side pagination/filtering after fetching the component catalog in deterministic Supabase pages. Keep full-table fetches paged so browser-side search does not silently miss records beyond PostgREST's default row cap; consider server-side search/pagination for larger datasets.
- Multiple joins per row; keep detail fetches scoped and cache with React Query.
- Inventory Components tab keeps search, category, supplier, page, and page-size state in the URL; local input state must only resync on actual URL changes so free typing stays responsive.

## Component Reservations
- `component_reservations` table earmarks on-hand stock for specific customer orders. Reservations are soft holds — they reduce available stock for other orders but do not block issuance.
- Reserve/release via `reserve_order_components` / `release_order_components` RPCs (called from Order Detail page).
- Per-order shortfall calculations (`get_detailed_component_status`) subtract other orders' reservations from available stock. Global shortfalls are unaffected (reservations redistribute, not consume).
- Auto-released when the order moves to Completed or Cancelled.
- Component detail Transactions tab hero card shows total reserved and available quantities.
- See [orders-master § Component Reservations](../orders/orders-master.md) for full API/migration details.

## Known Gaps
- Canonical spec for `inventory_transactions` (types, invariants, reconciliation) — see `inventory-transactions.md` (kept current with manual issuance notes).
- Reorder policy and alerts/digests.
- Historical inventory valuation is still not released. The current report can optionally show a current-price estimate, but a true as-of-date value still needs per-movement historical unit cost.
- Two UI variants exist; converging on a single canonical page is recommended.

## Cross‑Links
- Components (Inventory living doc): `components-section.md`
- Suppliers (pricing, mappings): `../../suppliers/suppliers-master.md`
- Purchasing (receipts into stock): `../../purchasing/purchasing-master.md`
- Product/BOM (consumption): `product-creation-guide.md`, `subcomponent-planning-and-execution.md`
