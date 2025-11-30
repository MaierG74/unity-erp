# Supplier Returns Implementation - Notes for New Chat

## Context: What We Just Completed

We've been working on Purchase Order functionality. Recent improvements:

1. **Purchase Order Receiving** - Fully functional
   - Stock receipt creates IN transactions (PURCHASE type)
   - RPC function: `process_supplier_order_receipt` handles transactions atomically
   - UI shows Ordered, Received, and Owing columns
   - Page auto-refreshes after receiving stock (no manual refresh needed)

2. **Purchase Order Detail Page** (`app/purchasing/purchase-orders/[id]/page.tsx`)
   - Displays purchase order with supplier orders (line items)
   - "Receive Stock" section with per-line inputs
   - Receipt history display
   - Auto-refresh implemented via React Query (`refetchOnMount: true`, `staleTime: 0`, `refetchQueries`)

## Current System State

### Purchase Order Flow (Current)
1. Create Purchase Order (manually or from Sales Order)
2. Approve PO with Q Number
3. ✅ **Receive Stock** (IN) - Stock enters inventory via `process_supplier_order_receipt`
4. ❌ **Return Goods** (OUT) - NOT YET IMPLEMENTED - This is what we need to build

### Inventory Transactions
- **IN transactions** (PURCHASE type, ID: 1) - Receiving stock from suppliers ✅
- **OUT transactions** (SALE type, ID: 2) - Available for returns to supplier ❌ (not yet used)
- **ADJUST transactions** (ADJUSTMENT type, ID: 3) - Manual adjustments ✅

### Key Relationships
- `purchase_orders` → `supplier_orders` (1-to-many)
- `supplier_orders` → `supplier_order_receipts` (many-to-many)
- `supplier_order_receipts` → `inventory_transactions` (1-to-1)
- `inventory_transactions` can reference `supplier_order_id` and `purchase_order_id`

## Goal: Implement Supplier Returns

**What we need:** Ability to return goods to suppliers for Purchase Orders, handling both:
1. **Rejection on Delivery** - Immediate rejection when goods arrive
2. **Later Return** - Returning goods that were previously accepted and are in inventory

### Requirements

1. **UI Section** on Purchase Order detail page (`app/purchasing/purchase-orders/[id]/page.tsx`)
   - "Return Goods" section (similar to "Receive Stock")
   - Display components that have been received (with received quantities)
   - Input fields for quantities to return per component
   - Reason field (required) - dropdown or text input
   - Return type selector (rejection vs later return)
   - Validate quantity doesn't exceed received quantity
   - Show return history

2. **Database Schema**
   - Create `supplier_order_returns` table:
     - `return_id` SERIAL PK
     - `supplier_order_id` INT FK → `supplier_orders.order_id`
     - `transaction_id` INT FK → `inventory_transactions.transaction_id`
     - `quantity_returned` NUMERIC
     - `return_date` TIMESTAMPTZ DEFAULT now()
     - `reason` TEXT (required)
     - `return_type` TEXT ('rejection' | 'later_return')
     - `receipt_id` INT FK → `supplier_order_receipts.receipt_id` (nullable)
     - `user_id` UUID FK → `auth.users.id`
     - `notes` TEXT (nullable)

3. **Database RPC Function** (`process_supplier_order_return`)
   - Similar pattern to `process_supplier_order_receipt`
   - Parameters: `p_supplier_order_id int`, `p_component_id int`, `p_quantity numeric`, `p_reason text`, `p_return_type text default 'later_return'`, `p_return_date timestamptz default now()`
   - Validate returned quantity <= received quantity
   - Lock supplier order row for update
   - Create OUT transaction with SALE type (negative quantity)
   - Decrement `inventory.quantity_on_hand`
   - Create return record in `supplier_order_returns`
   - Recompute `total_received` on supplier order (subtract returned quantity)
   - Update supplier order status if needed
   - Return transaction_id and return_id

4. **Business Rules**
   - Can only return stock that has been received
   - Cannot return more than received quantity
   - Returns reduce `total_received` on supplier order
   - Rejections: Stock never enters inventory (or enters then immediately removed)
   - Later returns: Stock is removed from inventory
   - Record reason for audit trail

## Key Files to Reference

### Receiving Implementation (Pattern to Follow)
- **RPC Function**: `supabase/migrations/20251107_process_supplier_order_receipt.sql`
  - Shows transactional pattern for receiving stock
  - Creates IN transaction, updates inventory, records receipt
  - Recomputes total_received and status

- **UI Implementation**: `app/purchasing/purchase-orders/[id]/page.tsx`
  - Lines 492-503: Purchase order query with auto-refresh config
  - Lines 625-656: `receiptMutation` with invalidation/refetch pattern
  - Lines 658-687: `receiveOneMutation` (inline per-row receipt)
  - Lines 760+: Receipt history display

- **Receiving Function**: `app/purchasing/purchase-orders/[id]/page.tsx:296-461`
  - `receiveStock` function that calls RPC with fallback

### Database Schema
- **Inventory Transactions**: `docs/domains/components/inventory-transactions.md`
  - OUT transactions use negative quantity
  - Can reference `supplier_order_id`, `purchase_order_id`
  - "Returns to supplier" is listed as an OUT transaction type

- **Receipts Table**: `supplier_order_receipts`
  - `receipt_id`, `order_id`, `transaction_id`, `quantity_received`, `receipt_date`
  - Reference for creating similar returns table

### Documentation
- **Planning Doc**: `docs/plans/supplier-returns-plan.md` - Full implementation plan
- **Purchasing Master**: `docs/domains/purchasing/purchasing-master.md` - Overall purchasing workflows
- **Inventory Transactions**: `docs/domains/components/inventory-transactions.md` - Transaction specs

## Implementation Approach

### Phase 1: Database Schema & Function
1. Create migration: `supabase/migrations/YYYYMMDD_create_supplier_returns.sql`
   - Create `supplier_order_returns` table
   - Create `process_supplier_order_return` RPC function
   - Function should:
     - Validate sufficient received quantity
     - Lock supplier order for update
     - Create OUT transaction (SALE type, negative quantity)
     - Decrement inventory
     - Create return record
     - Recompute total_received (subtract returned quantity)
     - Update supplier order status
     - Return transaction_id and return_id

### Phase 2: UI Implementation
1. Add "Return Goods" section to `app/purchasing/purchase-orders/[id]/page.tsx`
2. Fetch received quantities for components in the PO
3. Display return form:
   - Component list with received quantities
   - Quantity inputs (max = received quantity)
   - Reason field (required) - consider dropdown with common reasons
   - Return type selector (rejection/later return)
   - Submit button
4. Create mutation calling RPC function
5. Invalidate/refetch queries after return (same pattern as receiving)
6. Show return history section

### Phase 3: Enhanced Features
1. Link returns to specific receipts (optional enhancement)
2. Standard return reasons dropdown
3. Supplier notification (optional)

## Return Types

### Rejection on Delivery
- Goods rejected immediately upon delivery
- Stock should not enter inventory (or enter then immediately remove)
- May trigger reorder or replacement
- Supplier should be notified

### Later Return
- Goods were previously accepted and are in inventory
- Stock is removed from inventory
- May be for quality issues, wrong item, over-supplied, etc.
- May require credit note or replacement

## Questions to Resolve

1. Should rejections on delivery prevent stock from entering inventory, or enter then immediately remove?
2. Should we track returned quantities separately from received quantities, or adjust `total_received`?
3. What happens to supplier order status when goods are returned? (e.g., if fully received then partially returned)
4. Should returns require approval or can any user return stock?
5. Should we allow returning more than received (for credit/debit notes)?
6. Should returns link to specific receipts, or just to the supplier order?
7. What are standard return reasons? (Damage, Wrong Item, Quality Issue, Over-supplied, etc.)

## Testing Approach

1. Create a purchase order and receive stock
2. Verify inventory increases
3. Return some stock (later return)
4. Verify inventory decreases
5. Verify `total_received` decreases
6. Verify transaction records supplier_order_id and purchase_order_id
7. Verify return record is created
8. Test rejection on delivery scenario
9. Verify page auto-refreshes after return

## Notes

- Follow the same React Query pattern as receiving: `invalidateQueries` + `refetchQueries` with `type: 'active'`
- Use SALE transaction type (ID: 2) for OUT transactions (returns)
- Reference `process_supplier_order_receipt` as the pattern for transactional RPC functions
- Returns should reduce `total_received` on supplier orders (not track separately)
- Consider standard return reasons: Damage, Wrong Item, Quality Issue, Over-supplied, Customer Cancellation, etc.


