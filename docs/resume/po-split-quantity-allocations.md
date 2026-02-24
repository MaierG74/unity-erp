# PO Split Quantity Across Multiple Customer Orders

## What This Feature Does

When creating a purchase order, each line item can now split its quantity across multiple customer orders (e.g., ordering 100 widgets: 40 to Order A, 25 to Order B, 35 to stock). Previously only a single customer order dropdown was available per line.

## Status: Code Complete — Needs Migration Applied + Testing

All code changes are written and pass TypeScript + ESLint. The migration has NOT been applied to the database yet.

## Files Changed

### New file
- `supabase/migrations/20260223_po_split_quantity_allocations.sql` — RPC updates for both `create_purchase_order_with_lines` and `add_lines_to_purchase_order`

### Modified files
- `types/purchasing.ts` — Added `PurchaseOrderAllocation` type and `allocations` field to `PurchaseOrderFormData`
- `components/features/purchasing/new-purchase-order-form.tsx` — Split allocation UI, zod schema update, `buildLinePayload()` helper, consolidation handler update
- `components/features/purchasing/ForOrderEditPopover.tsx` — Editable multi-order split on existing POs (replaced read-only `MultiOrderDisplay`)

## What Was Done

### 1. RPC Migration
- Both RPCs now accept an optional `allocations` JSONB array per line item: `[{customer_order_id, quantity_for_order}]`
- If `allocations` present → inserts one junction record per allocation + stock remainder
- If `allocations` absent → existing single-record behavior (backward compatible)
- Switched from CTE bulk insert to FOR loop per line to handle nested arrays

### 2. PO Creation Form
- Added `allocations` array to zod schema with `superRefine` validation (sum ≤ total qty, each row needs selected order)
- `SplitAllocationEditor` inline component: order dropdown + qty input + remove button per row, auto "Stock: N remaining", over-allocation warning
- "Split" link next to Customer Order label enters split mode; "Cancel split" reverts to single dropdown
- `buildLinePayload()` helper used by both main create flow and consolidation handler
- Grid layout adjusts when in split mode (2-col for supplier+qty, editor below)

### 3. ForOrderEditPopover (existing PO editing)
- Added "Split across orders" option in the command popover
- Multi-order lines now open directly into editable split editor (previously read-only)
- Save mutation: deletes existing junction records, inserts new split + stock remainder
- Activity logging captures full allocation changes

## Next Steps

1. **Apply the migration** — `supabase/migrations/20260223_po_split_quantity_allocations.sql` via Supabase MCP `apply_migration`
2. **Test the happy paths:**
   - Create PO with single customer order → works as before
   - Create PO as stock order → works as before
   - Create PO, split 100 qty: 40 to Order A, 30 to Order B, 30 to stock → junction table has 3 records
   - View PO detail page → shows "2 orders" with correct quantities
   - Edit allocations on existing PO via pencil icon → changes reflected
3. **Test edge cases:**
   - Over-allocation blocked by validation
   - Zero-quantity rows blocked
   - Removing all split rows reverts to single mode
   - Draft restoration from sessionStorage preserves split state
   - Consolidation flow (adding to existing Draft PO) with split allocations
4. **Consider:** Whether the `supplier_order_customer_orders` table needs a `component_id` column populated for allocations (current RPC does pass it)
