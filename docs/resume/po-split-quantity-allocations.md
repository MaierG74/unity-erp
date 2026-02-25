# PO Split Quantity Across Multiple Customer Orders

## What This Feature Does

When creating a purchase order, each line item can now split its quantity across multiple customer orders (e.g., ordering 100 widgets: 40 to Order A, 25 to Order B, 35 to stock). Previously only a single customer order dropdown was available per line.

## Status: Applied + Tested

Migration applied Feb 24, 2026. All RPC paths tested via SQL. UI tested manually. Codex code review completed.

## Files Changed

### Migration
- `supabase/migrations/20260224082415_po_split_quantity_allocations.sql` — RPC updates for both `create_purchase_order_with_lines` and `add_lines_to_purchase_order`, with server-side over-allocation guard

### Modified files
- `types/purchasing.ts` — Added `PurchaseOrderAllocation` type and `allocations` field to `PurchaseOrderFormData`
- `components/features/purchasing/new-purchase-order-form.tsx` — Split allocation UI, zod schema update, `buildLinePayload()` helper, consolidation handler update
- `components/features/purchasing/ForOrderEditPopover.tsx` — Editable multi-order split on existing POs, popover positioning fix (side="top"), overflow fix (min-w-0/truncate)
- `components/features/orders/ProcurementTab.tsx` — Uses `quantity_for_order` (allocated qty) instead of full PO line qty for display/progress on customer order side

## What Was Done

### 1. RPC Migration
- Both RPCs now accept an optional `allocations` JSONB array per line item: `[{customer_order_id, quantity_for_order}]`
- If `allocations` present → inserts one junction record per allocation + stock remainder
- If `allocations` absent → existing single-record behavior (backward compatible)
- Server-side guard: RAISE EXCEPTION if allocation sum exceeds line quantity
- Switched from CTE bulk insert to FOR loop per line to handle nested arrays

### 2. PO Creation Form
- Added `allocations` array to zod schema with `superRefine` validation (sum <= total qty, each row needs selected order)
- `SplitAllocationEditor` inline component: order dropdown + qty input + remove button per row, auto "Stock: N remaining", over-allocation warning
- "Split" link next to Customer Order label enters split mode; "Cancel split" reverts to single dropdown
- `buildLinePayload()` helper used by both main create flow and consolidation handler
- Grid layout adjusts when in split mode (2-col for supplier+qty, editor below)

### 3. ForOrderEditPopover (existing PO editing)
- Added "Split across orders" option in the command popover
- Multi-order lines now open directly into editable split editor (previously read-only)
- Save mutation: deletes existing junction records, inserts new split + stock remainder
- Activity logging captures full allocation changes
- Popover opens above trigger (side="top") to avoid clipping into Attachments section
- Select elements use min-w-0/truncate to stay within popover bounds

### 4. ProcurementTab (customer order side)
- `effectiveQty()` / `effectiveReceived()` helpers use `quantity_for_order` when > 0
- All progress bars, status dots, stats, and group headers use allocated qty

## Known Limitations / Future Work

1. **Per-allocation receipt tracking**: Receipts are still tracked at the PO line level (`supplier_orders.total_received`), not per customer order allocation. `effectiveReceived()` caps display at allocated qty but doesn't know which order's goods were actually checked in. A future enhancement could add a `received_for_order` column to `supplier_order_customer_orders`.
2. **Existing bad data**: At least one existing row (supplier_order_id=224) has allocation total exceeding order quantity. The new server-side guard prevents new bad data but doesn't fix existing rows.
