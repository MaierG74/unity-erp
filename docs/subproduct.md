# Subproduct, Finished-Good Reservations, and Components – Phase 2

Status: Implemented in September branch • Last updated: 2025‑09‑19

## Purpose
This document captures the design and implementation details for Finished‑Good (FG) reservations, how they integrate with Orders and Components, and the client‑side adjustments to component requirements based on reserved FG.

## Terminology
- FG (Finished‑Good): Stocked products with make_strategy = MTS that can be reserved and later consumed at shipment.
- Reserve: Allocate available on‑hand FG to a specific sales order without moving inventory.
- Consume: Deduct previously reserved FG from inventory when shipping.
- Release: Clear reservations for an order.

## Database: RPCs and Functions
Implemented/updated in Phase 2:

- reserve_finished_goods(p_order_id integer) returns table(product_id int, qty_reserved numeric)
  - Idempotent: clears existing rows for the order, reserves up to available FG (on‑hand − other orders’ reservations), re‑inserts and returns rows.
- release_finished_goods(p_order_id integer) returns integer
  - Deletes rows from product_reservations for the order.
- consume_finished_goods(p_order_id integer) returns table(product_id int, qty_consumed numeric)
  - Deducts on‑hand (prefers primary/null location), logs product_inventory_transactions, then clears reservations.

Component views/functions used by the Components tab:
- get_detailed_component_status(p_order_id integer)
  - Per‑order requirements + in_stock, on_order, global fields. Fixed ambiguous component_id refs and explicit casts for integer columns.
- get_all_component_requirements()
  - Provides global totals across all open orders used for context.
- get_order_component_history(p_order_id integer)
  - Supplier order history linking via supplier_order_customer_orders. Fixed numeric/varchar casts to match declared return types.

## API Endpoints
Server routes under app/api/orders/[orderId]/:
- POST reserve-fg → wraps reserve_finished_goods
- POST release-fg → wraps release_finished_goods
- POST consume-fg → wraps consume_finished_goods
- GET  fg-reservations → lists product_reservations for the order, and merges product info (two‑step fetch to avoid brittle FK joins)

## Orders UI
File: app/orders/[orderId]/page.tsx

- Finished‑Good Reservations card
  - Buttons: Reserve FG, Release, Consume (Ship).
  - On reserve success, UI optimistically updates the ['fg-reservations', orderId] cache from RPC output, then refetches.
  - A table shows per‑product reserved quantities for this order.

- Products table
  - New columns: Reserved FG, Remain to Explode.
  - remain_to_explode = max(0, ordered − reservedByProduct[product_id]).

## Components Tab: FG Coverage and Global Context
- Toggle: “Apply FG coverage” (default ON; persisted via localStorage).
  - When ON, per‑line component requirements are scaled by factor = remain_to_explode / ordered.
  - Apparent/Real shortfalls are recomputed using the scaled requirement, current in_stock, and on_order.
  - A badge “FG coverage applied” appears when ON.

- Toggle: “Show global context” (default ON; persisted via localStorage).
  - When ON, the table shows Total Across Orders and Global Shortfall (all orders) columns, plus a global shortfalls badge in the header.
  - Global metrics are not affected by FG coverage — they reflect all open orders and may still show shortages even when the current order is fully covered.

- Badges and copy
  - Per‑order badge: “All components available for this order” or “N components with shortfall (this order)”.
  - Global badge: “N global shortfalls (all orders)”. Tooltip/title clarifies scope is across all open orders.

## Product UI
File: app/products/[productId]/page.tsx

- Finished‑Goods Inventory card in Details tab
  - Displays On Hand, Reserved (all orders), Available metrics.
  - Reads from `product_inventory` and `product_reservations`.
- Reserved breakdown
  - The "Reserved (all orders)" tile includes a "View" popover that lists each order and the reserved quantity, with links to `/orders/[orderId]`.
  - Clicking "View" now opens a dialog that:
    - Lists each order with reserved quantity for this product
    - Provides a direct "Open PDF" link to the latest `order_attachments` file (if any)
    - Only fetches attachments when the dialog opens (efficient)
- Add Finished Goods action
  - Inline form with Quantity and optional Location.
  - API: `POST /api/products/[productId]/add-fg` updates or inserts a row in `product_inventory`.
  - On success: refetches inventory and reservation totals and shows a toast.
- Edit Product dialog
  - Edits Product Code, Name, Description via inline dialog.
  - Saves to `products` and refetches on success.

## Error Fixes Applied in Phase 2
- Ambiguous column references in SQL (e.g., component_id) were qualified.
- Type mismatches fixed with explicit casts (e.g., bigint→integer, numeric(10,2)→integer where required by PostgREST signatures).
- API GET for fg-reservations made resilient by avoiding inner joins on FK; merges product data in a follow‑up query.
- Frontend bug where reservedByProduct was scoped incorrectly has been corrected.

## Test Plan
1) Create or open an order with MTS stocked products.
2) Click “Reserve FG”: rows appear in the FG Reservations card and the Products table shows Reserved FG and Remain to Explode.
3) Toggle “Apply FG coverage” ON/OFF in Components tab and observe Required/Shortfall values change accordingly.
4) Verify global context columns and global shortfalls badge are unaffected by the toggle.
5) Click “Release”: reservations clear and UI updates.
6) Click “Consume (Ship)”: on‑hand decreases, a transaction is logged, reservations clear.
7) On a Product page with reservations, click Reserved → View: the dialog shows per‑order rows and “Open PDF” links where available.

## Future Enhancements
- Move FG‑coverage scaling from client to a DB view/RPC to ensure consistent reporting.
- Add confirmations and loading states to Release/Consume flows (UI polish).
- Reporting for FG turnover and reorder suggestions.
- Performance: materialize/refresh views where needed; add indexes guided by EXPLAIN.

## FG Consumption Timing (Toggle)

We support two operational modes for when reservations are converted into consumed stock:

- Consume on Add (instant consumption)
  - When FG is added into `product_inventory`, immediately allocate/consume against existing reservations (FIFO by order date or reservation time), decreasing `qty_reserved` and the on‑hand balance in one logical operation.
  - Best for make‑to‑order where building FG is synonymous with fulfilling specific orders.

- Consume on Ship (deferred consumption)
  - Keep the on‑hand balance increased by Add FG, keep reservations unchanged; actual deduction happens when shipping via `consume_finished_goods(p_order_id)`.
  - Best for mixed MTS/MTO or when QA/packing happens later.

Proposed implementation:
- Global setting key: `fg_auto_consume_on_add` in `settings` table (boolean; default false ⇒ "Consume on Ship").
- Add‑FG endpoint checks this setting:
  - If true: call `auto_consume_on_add(p_product_id, p_quantity_added)` RPC that walks reservations (ordered by creation) and applies FIFO consumption, inserting rows in `product_inventory_transactions`.
  - If false: current behavior (increase on‑hand only).
- UI: surface a toggle in Settings, and an inline hint under the Add FG form reflecting the current mode.

Status: Not yet implemented. Default runtime behavior is "Consume on Ship" via `consume_finished_goods(p_order_id)`.

## Backend Assets (Migrations & Scripts)
- Migration: `db/migrations/20250920_fg_reservations.sql`
  - Ensures `product_reservations` table exists (id, product_id, order_id, qty_reserved, created_at).
  - Creates or replaces RPCs: `reserve_finished_goods`, `release_finished_goods`, `consume_finished_goods`.
- Scripts:
  - `scripts/check-fg.mjs` — read‑only verification of tables and RPC endpoints. Usage:
    - `node -r dotenv/config scripts/check-fg.mjs dotenv_config_path=.env.local`
  - `scripts/apply-fg-migration.mjs` — applies the migration via PG connection (requires SUPABASE_DB_URL or PG* env vars). Usage:
    - `node -r dotenv/config scripts/apply-fg-migration.mjs dotenv_config_path=.env.local`

## References
- UI: app/orders/[orderId]/page.tsx
- RPCs: db/migrations/20250917_fg_phase2_reservations.sql and follow‑ups
- Components views/functions: sql/create_component_views.sql
- Related docs: docs/orders-master.md, docs/components-section.md