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
- Supplier view: `app/suppliers/[id]/page.tsx` → Components tab shows supplier-specific mappings.
- Purchasing: `app/purchasing/purchase-orders/[id]/page.tsx` — receipts create movements and increase on‑hand.

## Data Model (working set)
- `components`
  - `component_id`, `internal_code` (unique), `description`, `image_url`, `category_id`, `unit_id`.
- `inventory`
  - `inventory_id`, `component_id`, `quantity_on_hand`, `location`, `reorder_level`.
- `inventory_transactions`
  - `transaction_id`, `component_id`, `quantity`, `transaction_type` ('IN'|'OUT'|'ADJUST'), `transaction_date`, optional `order_id`/reference.
- `suppliercomponents`
  - Supplier mapping with `supplier_code`, `price`, `lead_time`, `min_order_quantity`.
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

## Reporting & Queries
- Below Reorder: `inventory.quantity_on_hand < inventory.reorder_level` with joins to components and location.
- Movement History: recent `inventory_transactions` for a component with IN/OUT/ADJUST totals.
- Where Used: BOM/collections usage via `billofmaterials` and `bom_collections` (for shortages and planning).
- On Order: Calculated from open purchase orders (`supplier_orders` where status is Open/In Progress/Approved/Partially Received/Pending Approval), showing `order_quantity - total_received` per component. Only includes `supplier_orders` linked to *existing* `purchase_orders` (via INNER JOIN), ensuring consistency with the Purchase Orders table display and excluding orphaned rows from deleted purchase orders.
- Critical Components to Order: Shows components with global shortfalls across all active orders. Uses `get_global_component_requirements()` RPC to calculate shortfalls, ensuring consistency with order detail page calculations. Displays components where `global_real_shortfall > 0` or `global_apparent_shortfall > 0`.

## Permissions & RLS
- Reads and writes enforced by Supabase RLS.
- Image uploads (component images) require authenticated session.
- Receiving and adjustments should be performed via server-side RPCs/endpoints to validate roles and invariants.
- Track implementation details in [`permissions-and-logging-plan.md`](../plans/permissions-and-logging-plan.md) as the access-control work progresses.

## Performance Notes
- Current list uses client-side pagination/filtering; consider server-side for large datasets.
- Multiple joins per row; keep detail fetches scoped and cache with React Query.

## Known Gaps
- Canonical spec for `inventory_transactions` (types, invariants, reconciliation) — see `inventory-transactions.md`.
- Stock Adjustment UI/RPC to formalize reasons and audit.
- Reorder policy and alerts/digests.
- Two UI variants exist; converging on a single canonical page is recommended.

## Cross‑Links
- Components (Inventory living doc): `components-section.md`
- Suppliers (pricing, mappings): `../../suppliers/suppliers-master.md`
- Purchasing (receipts into stock): `../../purchasing/purchasing-master.md`
- Product/BOM (consumption): `product-creation-guide.md`, `subcomponent-planning-and-execution.md`
