# Stock Issuance Plan

**Status:** ✅ **Completed** (January 4, 2025)

## Overview
✅ Implemented functionality to issue stock against customer orders. This allows moving stock OUT of inventory to fulfill customer orders, with full BOM integration, PDF generation, and issuance tracking.

**Implementation Details:** See [`../changelogs/stock-issuance-implementation-20250104.md`](../changelogs/stock-issuance-implementation-20250104.md)

## Current State

### Receiving Stock (IN transactions)
- ✅ Stock receipt is fully implemented via `process_supplier_order_receipt` RPC
- ✅ Creates PURCHASE-type inventory transactions (positive quantity)
- ✅ Updates `inventory.quantity_on_hand` by incrementing
- ✅ Records receipt in `supplier_order_receipts`
- ✅ Updates supplier order `total_received` and status
- ✅ UI displays Ordered, Received, and Owing columns

### Transaction Types
Current transaction types in `transaction_types` table:
- `PURCHASE` (ID: 1) - Used for receiving stock from suppliers
- `SALE` (ID: 2) - Available for issuing stock to fulfill orders
- `ADJUSTMENT` (ID: 3) - Used for manual adjustments

### Inventory Transactions Schema
From `docs/domains/components/inventory-transactions.md`:
- `transaction_id` SERIAL PK
- `component_id` INT FK → `components.component_id`
- `quantity` NUMERIC — positive for IN, negative for OUT
- `transaction_type_id` INT FK → `transaction_types.transaction_type_id`
- `transaction_date` TIMESTAMPTZ DEFAULT now()
- `order_id` INT FK → `orders.order_id` (nullable, for customer orders)
- `supplier_order_id` INT FK → `supplier_orders.order_id` (nullable)
- `purchase_order_id` INT FK → `purchase_orders.purchase_order_id` (nullable)
- `user_id` UUID FK → `auth.users.id` (nullable)
- `reason` TEXT (nullable, for ADJUST transactions)

### Current Purchase Order Flow
1. Create Purchase Order (manually or from Sales Order)
2. Approve PO with Q Number
3. ✅ **Receive Stock** (IN) - Stock enters inventory
4. ✅ **Issue Stock** (OUT) - **IMPLEMENTED** - Stock leaves inventory to fulfill customer orders (via Order Detail page)

## Requirements

### Functional Requirements
1. **Issue Stock UI**
   - Add "Issue Stock" section to Purchase Order detail page
   - Display components available to issue (with on-hand quantities)
   - Allow selecting quantities to issue per component
   - Validate that quantity to issue doesn't exceed available inventory
   - Link issued stock to customer orders (if PO was created from a sales order)

2. **Transaction Creation**
   - Create OUT-type inventory transactions (negative quantity)
   - Use `SALE` transaction type (ID: 2)
   - Decrement `inventory.quantity_on_hand`
   - Record `order_id` if issuing against a customer order
   - Record `purchase_order_id` to link back to the PO
   - Record `user_id` for audit trail

3. **Business Rules**
   - Can only issue stock that has been received (available inventory > 0)
   - Cannot issue more than available inventory
   - Should link to customer orders if PO was created from sales order
   - Track which components were issued from which purchase order

### Technical Requirements
1. **Database Function**
   - Create RPC function `process_stock_issuance` similar to `process_supplier_order_receipt`
   - Transactional: insert transaction, update inventory, record linkage
   - Validate sufficient inventory before issuing
   - Return success/failure with details

2. **UI Components**
   - Add "Issue Stock" section to `app/purchasing/purchase-orders/[id]/page.tsx`
   - Display available inventory per component
   - Input fields for quantities to issue
   - Validation and error handling
   - Show issuance history (similar to receipt history)

3. **Query Management**
   - Invalidate purchase order queries after issuance
   - Invalidate inventory queries
   - Auto-refresh page after successful issuance

## Implementation Approach

### Phase 1: Database Function
1. Create `process_stock_issuance` RPC function
   - Parameters: `purchase_order_id`, `component_id`, `quantity`, `order_id` (optional)
   - Validate inventory availability
   - Create OUT transaction with SALE type
   - Decrement inventory quantity_on_hand
   - Record purchase_order_id linkage
   - Return transaction details

### Phase 2: UI Implementation
1. Add "Issue Stock" section to PO detail page
2. Fetch available inventory for components in the PO
3. Display issuance form with quantities
4. Call RPC function on submit
5. Show issuance history

### Phase 3: Order Linkage
1. Link issued stock to customer orders if PO was created from sales order
2. Track which components fulfilled which customer order requirements

## Files to Modify/Create

### New Files
- `supabase/migrations/YYYYMMDD_process_stock_issuance.sql` - RPC function
- `docs/changelogs/stock-issuance-implementation-YYYYMMDD.md` - Implementation notes

### Modified Files
- `app/purchasing/purchase-orders/[id]/page.tsx` - Add issuance UI
- `types/purchasing.ts` - Add issuance-related types
- `docs/domains/purchasing/purchasing-master.md` - Document issuance flow

## Related Documentation
- `docs/domains/components/inventory-transactions.md` - Transaction specifications
- `docs/domains/components/inventory-master.md` - Inventory operations overview
- `docs/domains/purchasing/purchasing-master.md` - Purchasing workflows

## Questions to Resolve
1. Should issuance be tied to specific customer orders, or can stock be issued generally?
2. Should we track "issued quantity" separately from "received quantity" on supplier orders?
3. What happens if more stock is issued than received? (Allow negative inventory?)
4. Should issuance be reversible (undo/cancel issuance)?
5. Should issuance require approval or can any user issue stock?


