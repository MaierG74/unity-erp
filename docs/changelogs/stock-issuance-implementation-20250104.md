# Stock Issuance Implementation

**Date:** January 4, 2025  
**Status:** ✅ Completed

## Overview
Implemented comprehensive stock issuance functionality to issue stock OUT of inventory against customer orders. This feature allows moving stock from inventory to fulfill customer orders, with full BOM integration, PDF generation, and issuance tracking.

## Implementation Summary

### Database Layer
- **Migration:** `supabase/migrations/20250102_process_stock_issuance.sql`
  - Created `stock_issuances` table to track individual issuances
  - Implemented `process_stock_issuance` RPC function for atomic stock issuance
  - Implemented `reverse_stock_issuance` RPC function for partial reversal
  - Added necessary columns to `inventory_transactions` table (if missing)
  - All operations are transactional and include proper validation

### UI Components
- **New Component:** `components/features/orders/IssueStockTab.tsx`
  - Product selection with independent order detail selection
  - BOM-based component aggregation and prepopulation
  - Component-level quantity inputs with validation
  - Real-time inventory availability checking
  - Issuance history display
  - "All components issued" indicator badges
  - PDF generation integration

- **PDF Component:** `components/features/orders/StockIssuancePDF.tsx`
  - Professional PDF document generation
  - Company letterhead support
  - Component issuance table
  - Signature fields for physical signing
  - Per-issuance and combined PDF options

### Integration Points
- **Order Detail Page:** `app/orders/[orderId]/page.tsx`
  - Added "Issue Stock" tab alongside other order tabs
  - Integrated with existing order component requirements system
  - Maintains real-time inventory updates

## Key Features

### 1. BOM Integration
- Automatically aggregates component requirements from selected products
- Handles components used by multiple products in the same order
- Pre-populates issue quantities based on BOM requirements
- Allows issuing more than BOM quantity (for lost/damaged parts)

### 2. Smart Component Tracking
- Calculates and displays which products have all components issued
- Visual indicators with green badges and card highlighting
- Non-blocking - allows reissuing or additional issuances as needed

### 3. PDF Generation
- Per-issuance PDF documents for signing
- Combined PDF option for all issuances on an order
- Includes company letterhead, order information, component details, and signature fields
- Download and print functionality

### 4. Reversibility
- Database function `reverse_stock_issuance` supports partial reversal
- UI placeholder for reversal dialog (TODO: full UI implementation)

## Business Rules Implemented

1. **Stock issuance is tied to customer orders** - 90% of issuances will be order-specific
2. **Negative inventory requires authorization** - Currently not enforced (open TODO)
3. **Issuance is reversible** - Database function exists; UI pending
4. **BOM-driven issuance** - Automatically calculates requirements from product BOMs
5. **Multiple products support** - Can issue components for multiple products in one operation
6. **Partial issuance allowed** - Can issue subsets of components as needed

## Technical Details

### RPC Functions

#### `process_stock_issuance`
- Parameters: `p_order_id`, `p_component_id`, `p_quantity`, `p_purchase_order_id` (optional), `p_notes` (optional), `p_issuance_date` (optional)
- Returns: `issuance_id`, `transaction_id`, `quantity_on_hand`, `success`, `message`
- Creates OUT transaction (SALE type, negative quantity)
- Updates inventory `quantity_on_hand`
- Creates `stock_issuances` record
- Records user ID from auth context

#### `reverse_stock_issuance`
- Parameters: `p_issuance_id`, `p_quantity_to_reverse`, `p_reason` (optional), `p_reversal_date` (optional)
- Returns: `reversal_transaction_id`, `quantity_on_hand`, `success`, `message`
- Creates reversal transaction (PURCHASE type, positive quantity)
- Updates inventory `quantity_on_hand`
- Updates `stock_issuances` record

### Database Schema

#### `stock_issuances` Table
- `issuance_id` (bigint, PK, auto-generated)
- `order_id` (integer, FK to orders)
- `transaction_id` (integer, FK to inventory_transactions)
- `component_id` (integer, FK to components)
- `quantity_issued` (numeric, > 0)
- `issuance_date` (timestamptz)
- `purchase_order_id` (bigint, FK to purchase_orders, nullable)
- `notes` (text, nullable)
- `created_by` (uuid, FK to auth.users, nullable)
- `created_at` (timestamptz)

### Transaction Flow
1. User selects products on order detail page
2. System aggregates BOM requirements for selected products
3. User adjusts quantities and adds notes/PO ID
4. User clicks "Issue Stock"
5. System calls `process_stock_issuance` for each component
6. RPC creates OUT transaction, updates inventory, records issuance
7. UI refreshes to show updated inventory and issuance history

## Files Created/Modified

### New Files
- `supabase/migrations/20250102_process_stock_issuance.sql` - Database migration
- `components/features/orders/IssueStockTab.tsx` - Main UI component
- `components/features/orders/StockIssuancePDF.tsx` - PDF generation component
- `docs/changelogs/stock-issuance-implementation-20250104.md` - This file

### Modified Files
- `app/orders/[orderId]/page.tsx` - Added Issue Stock tab

## Testing Notes

1. Test basic issuance flow:
   - Select product(s) on order
   - Verify BOM aggregation
   - Issue stock
   - Verify inventory decreases
   - Verify issuance appears in history

2. Test multi-product issuance:
   - Select multiple products
   - Verify component aggregation
   - Issue stock
   - Verify all components issued correctly

3. Test "all components issued" indicator:
   - Issue all required components
   - Verify badge appears
   - Verify card highlighting

4. Test PDF generation:
   - Generate PDF for single issuance
   - Generate PDF for all issuances
   - Verify signature fields present
   - Verify company info included

5. Test edge cases:
   - Issuing more than available inventory (should warn)
   - Issuing more than BOM quantity (should allow)
   - Issuing same component multiple times (should aggregate)

## Open Items / Future Enhancements

1. **Partial Reversal UI** - Database function exists, but UI dialog is not yet implemented
2. **Negative Inventory Authorization** - Should require approval for negative inventory scenarios
3. **Bulk Issuance** - Could add functionality to issue all components for all products at once
4. **Issuance Templates** - Could save common issuance patterns for reuse

## Related Documentation

- Planning: [`docs/plans/stock-issuance-plan.md`](../plans/stock-issuance-plan.md)
- Inventory Transactions: [`docs/domains/components/inventory-transactions.md`](../domains/components/inventory-transactions.md)
- Inventory Master: [`docs/domains/components/inventory-master.md`](../domains/components/inventory-master.md)
- Orders Master: [`docs/domains/orders/orders-master.md`](../domains/orders/orders-master.md)

