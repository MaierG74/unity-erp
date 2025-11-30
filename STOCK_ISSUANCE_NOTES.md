# Stock Issuance Implementation - Notes for New Chat

**Status:** ✅ **COMPLETED** (January 4, 2025)

## Context: What We Just Completed

We've completed the Stock Issuance feature. Recent improvements:

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
4. ✅ **Issue Stock** (OUT) - **IMPLEMENTED** - Stock leaves inventory via `process_stock_issuance` on Order Detail page

### Inventory Transactions
- **IN transactions** (PURCHASE type, ID: 1) - Receiving stock from suppliers
- **OUT transactions** (SALE type, ID: 2) - ✅ Used for issuing stock via `process_stock_issuance`
- **ADJUST transactions** (ADJUSTMENT type, ID: 3) - Manual adjustments

### Key Relationships
- `purchase_orders` → `supplier_orders` (1-to-many)
- `supplier_orders` → `supplier_order_customer_orders` → `orders` (many-to-many via junction table)
- `supplier_order_customer_orders` links purchase order components to customer orders
- `inventory_transactions` can reference `order_id` (customer order), `purchase_order_id`, `supplier_order_id`

## Implementation Complete ✅

**What was built:** Complete stock issuance functionality allowing stock to be issued OUT of inventory against customer orders, with BOM integration, PDF generation, and issuance tracking.

**Key Implementation:**
- Database RPC functions: `process_stock_issuance` and `reverse_stock_issuance`
- UI Component: `IssueStockTab` on Order Detail page
- PDF Generation: `StockIssuancePDF` component with signature fields
- BOM Integration: Automatic component aggregation and prepopulation
- Visual Indicators: "All components issued" badges

See [`docs/changelogs/stock-issuance-implementation-20250104.md`](docs/changelogs/stock-issuance-implementation-20250104.md) for full details.

### Requirements

1. **UI Section** on Purchase Order detail page (`app/purchasing/purchase-orders/[id]/page.tsx`)
   - "Issue Stock" section (similar to "Receive Stock")
   - Display components from the PO with available inventory quantities
   - Input fields for quantities to issue per component
   - Validate quantity doesn't exceed available inventory
   - Show issuance history

2. **Database RPC Function** (`process_stock_issuance`)
   - Similar pattern to `process_supplier_order_receipt`
   - Parameters: `purchase_order_id`, `component_id`, `quantity`, `order_id` (optional)
   - Validate inventory availability
   - Create OUT transaction with SALE type (ID: 2)
   - Decrement `inventory.quantity_on_hand`
   - Record `purchase_order_id` and `order_id` linkage
   - Record `user_id` for audit trail
   - Transactional (all or nothing)

3. **Business Rules**
   - Can only issue stock that has been received (available inventory > 0)
   - Cannot issue more than available inventory
   - Link to customer orders if PO was created from sales order (via `supplier_order_customer_orders`)
   - Track which components were issued from which purchase order

## Key Files to Reference

### Receiving Implementation (Pattern to Follow)
- **RPC Function**: `supabase/migrations/20251107_process_supplier_order_receipt.sql`
  - Shows transactional pattern for receiving stock
  - Creates IN transaction, updates inventory, records receipt

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
  - Can reference `order_id`, `purchase_order_id`, `supplier_order_id`

- **Junction Table**: `sql/create_junction_table.sql`
  - `supplier_order_customer_orders` links supplier orders to customer orders
  - Contains `quantity_for_order` and `quantity_for_stock`

### Documentation
- **Planning Doc**: `docs/plans/stock-issuance-plan.md` - Full implementation plan
- **Purchasing Master**: `docs/domains/purchasing/purchasing-master.md` - Overall purchasing workflows
- **Inventory Transactions**: `docs/domains/components/inventory-transactions.md` - Transaction specs

## Implementation Approach

### Phase 1: Database Function
Create `supabase/migrations/YYYYMMDD_process_stock_issuance.sql`:
- Function signature: `process_stock_issuance(purchase_order_id int, component_id int, quantity numeric, order_id int default null, issue_date timestamptz default now())`
- Validate inventory availability
- Lock inventory row for update
- Create OUT transaction with SALE type (negative quantity)
- Decrement inventory quantity_on_hand
- Record purchase_order_id and order_id
- Record user_id from auth context
- Return transaction_id

### Phase 2: UI Implementation
Add to `app/purchasing/purchase-orders/[id]/page.tsx`:
- Fetch available inventory for components in the PO
- Add "Issue Stock" section below "Receive Stock"
- Form with component list, available quantities, input fields
- Mutation calling RPC function
- Invalidate/refetch queries after issuance (same pattern as receiving)
- Show issuance history section

### Phase 3: Order Linkage
- Query `supplier_order_customer_orders` to find linked customer orders
- Allow selecting which customer order to issue against (if multiple)
- Default to customer order if PO was created from sales order

## Open Questions to Resolve

1. Should issuance be tied to specific customer orders, or can stock be issued generally?
2. Should we track "issued quantity" separately from "received quantity" on supplier orders?
3. What happens if more stock is issued than received? (Allow negative inventory?)
4. Should issuance be reversible (undo/cancel issuance)?
5. Should issuance require approval or can any user issue stock?
6. Should we show "issued" quantity separately from "received" quantity in the UI?

## Testing Approach

1. Create a purchase order from a sales order
2. Receive stock (IN transaction)
3. Verify inventory increases
4. Issue stock (OUT transaction)
5. Verify inventory decreases
6. Verify transaction records purchase_order_id and order_id
7. Verify page auto-refreshes after issuance

## Notes

- Follow the same React Query pattern as receiving: `invalidateQueries` + `refetchQueries` with `type: 'active'`
- Use SALE transaction type (ID: 2) for OUT transactions
- Reference `process_supplier_order_receipt` as the pattern for transactional RPC functions
- The `supplier_order_customer_orders` junction table can help identify which customer orders are linked to the PO


