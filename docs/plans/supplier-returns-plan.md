# Supplier Returns Plan

## Overview
Implement functionality to return goods to suppliers for Purchase Orders. This handles both immediate rejections on delivery and later returns of previously received stock.

## Current State

### Receiving Stock (IN transactions)
- ✅ Stock receipt is fully implemented via `process_supplier_order_receipt` RPC
- ✅ Creates PURCHASE-type inventory transactions (positive quantity)
- ✅ Updates `inventory.quantity_on_hand` by incrementing
- ✅ Records receipt in `supplier_order_receipts`
- ✅ Updates supplier order `total_received` and status
- ✅ UI displays Ordered, Received, and Owing columns

### Missing: Returns Functionality
- ❌ No way to return goods to suppliers
- ❌ No way to reject goods on delivery
- ❌ No tracking of returned quantities
- ❌ No return history

### Transaction Types
Current transaction types in `transaction_types` table:
- `PURCHASE` (ID: 1) - Used for receiving stock from suppliers
- `SALE` (ID: 2) - Available for returns to supplier (OUT transactions)
- `ADJUSTMENT` (ID: 3) - Used for manual adjustments

### Inventory Transactions Schema
From `docs/domains/components/inventory-transactions.md`:
- OUT transactions are for "Returns to supplier"
- `quantity` should be negative for OUT transactions
- Can reference `supplier_order_id` and `purchase_order_id`

## Requirements

### Functional Requirements

1. **Return Goods UI**
   - Add "Return Goods" section to Purchase Order detail page
   - Display components that have been received (with received quantities)
   - Allow selecting quantities to return per component
   - Support two scenarios:
     - **Rejection on Delivery**: Return immediately after receiving (before accepting)
     - **Later Return**: Return goods that were previously accepted and are in inventory
   - Require reason/notes for the return
   - Validate that quantity to return doesn't exceed received quantity

2. **Transaction Creation**
   - Create OUT-type inventory transactions (negative quantity)
   - Use `SALE` transaction type (ID: 2) for returns
   - Decrement `inventory.quantity_on_hand`
   - Record `supplier_order_id` to link back to the supplier order
   - Record `purchase_order_id` to link back to the PO
   - Record `user_id` for audit trail
   - Record `reason` field for return reason

3. **Return Records**
   - Create return records in a new `supplier_order_returns` table
   - Track: supplier_order_id, transaction_id, quantity_returned, return_date, reason, return_type (rejection/later_return)
   - Link to the original receipt if returning against a specific receipt

4. **Business Rules**
   - Can only return stock that has been received
   - Cannot return more than received quantity
   - When returning, should reduce `total_received` on supplier order
   - Returns should update supplier order status appropriately
   - Rejections on delivery: Stock never enters inventory (or is immediately removed)
   - Later returns: Stock is removed from inventory

### Technical Requirements

1. **Database Schema**
   - Create `supplier_order_returns` table:
     - `return_id` SERIAL PK
     - `supplier_order_id` INT FK → `supplier_orders.order_id`
     - `transaction_id` INT FK → `inventory_transactions.transaction_id`
     - `quantity_returned` NUMERIC
     - `return_date` TIMESTAMPTZ DEFAULT now()
     - `reason` TEXT (required)
     - `return_type` TEXT ('rejection' | 'later_return')
     - `receipt_id` INT FK → `supplier_order_receipts.receipt_id` (nullable, if returning against specific receipt)
     - `user_id` UUID FK → `auth.users.id`
     - `notes` TEXT (nullable)

2. **Database Function**
   - Create RPC function `process_supplier_order_return` similar to `process_supplier_order_receipt`
   - Parameters: `supplier_order_id`, `component_id`, `quantity`, `reason`, `return_type`, `return_date` (optional)
   - Validate sufficient received quantity before returning
   - Create OUT transaction with SALE type
   - Decrement inventory quantity_on_hand
   - Create return record
   - Recompute `total_received` on supplier order (reduce by returned quantity)
   - Update supplier order status if needed
   - Return transaction details

3. **UI Components**
   - Add "Return Goods" section to `app/purchasing/purchase-orders/[id]/page.tsx`
   - Display received quantities per component
   - Input fields for quantities to return
   - Dropdown/input for return reason
   - Radio/checkbox for return type (rejection vs later return)
   - Validation and error handling
   - Show return history (similar to receipt history)

4. **Query Management**
   - Invalidate purchase order queries after return
   - Invalidate inventory queries
   - Auto-refresh page after successful return

## Implementation Approach

### Phase 1: Database Schema & Function
1. Create migration for `supplier_order_returns` table
2. Create `process_supplier_order_return` RPC function
   - Parameters: `p_supplier_order_id int`, `p_component_id int`, `p_quantity numeric`, `p_reason text`, `p_return_type text default 'later_return'`, `p_return_date timestamptz default now()`
   - Validate returned quantity <= received quantity
   - Lock supplier order row for update
   - Create OUT transaction with SALE type (negative quantity)
   - Decrement inventory quantity_on_hand
   - Create return record
   - Recompute total_received (subtract returned quantity)
   - Update supplier order status
   - Return transaction_id and return_id

### Phase 2: UI Implementation
1. Add "Return Goods" section to PO detail page
2. Fetch received quantities for components in the PO
3. Display return form with:
   - Component list with received quantities
   - Quantity inputs
   - Reason field (required)
   - Return type selector (rejection/later return)
   - Submit button
4. Call RPC function on submit
5. Show return history section

### Phase 3: Enhanced Features
1. Link returns to specific receipts (if returning against a specific receipt)
2. Support partial returns (return some but not all received)
3. Return reporting and analytics

## Files to Modify/Create

### New Files
- `supabase/migrations/YYYYMMDD_create_supplier_returns.sql` - Table and RPC function
- `docs/changelogs/supplier-returns-implementation-YYYYMMDD.md` - Implementation notes

### Modified Files
- `app/purchasing/purchase-orders/[id]/page.tsx` - Add returns UI
- `types/purchasing.ts` - Add return-related types
- `docs/domains/purchasing/purchasing-master.md` - Document returns flow

## Related Documentation
- `docs/domains/components/inventory-transactions.md` - Transaction specifications
- `docs/domains/components/inventory-master.md` - Inventory operations overview
- `docs/domains/purchasing/purchasing-master.md` - Purchasing workflows
- `supabase/migrations/20251107_process_supplier_receipt.sql` - Receipt RPC pattern to follow

## Questions to Resolve
1. Should rejections on delivery prevent stock from entering inventory, or enter then immediately remove?
2. Should we track returned quantities separately from received quantities, or adjust `total_received`?
3. What happens to supplier order status when goods are returned? (e.g., if fully received then partially returned)
4. Should returns require approval or can any user return stock?
5. Should we allow returning more than received (for credit/debit notes)?
6. Should returns link to specific receipts, or just to the supplier order?
7. What are standard return reasons? (Damage, Wrong Item, Quality Issue, Over-supplied, etc.)

## Return Types

### Rejection on Delivery
- Goods are rejected immediately upon delivery
- Stock should not enter inventory (or enter then immediately remove)
- May trigger reorder or replacement
- Supplier should be notified

### Later Return
- Goods were previously accepted and are in inventory
- Stock is removed from inventory
- May be for quality issues discovered later, wrong item, over-supplied, etc.
- May require credit note or replacement


