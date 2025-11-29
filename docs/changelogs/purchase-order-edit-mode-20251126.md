# Purchase Order Edit Mode

**Date:** November 26, 2025  
**Type:** Feature Enhancement  
**Status:** ✅ Implemented

---

## Overview

Added the ability to edit Draft purchase orders directly from the purchase order detail page. Users can now modify notes, adjust line item quantities, and delete line items before submitting for approval.

---

## Changes

### UI Enhancements

1. **Edit Button** - Added an "Edit" button in the Order Items card header that appears only for Draft purchase orders
2. **Edit Mode** - When activated, the UI switches to edit mode with:
   - Editable notes textarea in the Order Summary card
   - Inline quantity inputs for each line item
   - Delete buttons for line items (disabled if only one item remains)
   - Save/Cancel buttons in the header
   - Dynamic total recalculation as quantities change
3. **Delete Confirmation** - Added a confirmation dialog before deleting line items

### Functionality

- **Edit Notes**: Modify purchase order notes
- **Edit Quantities**: Change order quantities for any line item
- **Delete Line Items**: Remove line items (with confirmation, cannot delete last item)
- **Real-time Totals**: Line totals and grand total update as quantities are edited

### Constraints

- Edit mode is only available for **Draft** status purchase orders
- Cannot delete the last remaining line item
- Quantities must be greater than 0
- "Submit for Approval" button is hidden while in edit mode

---

## Files Modified

- `app/purchasing/purchase-orders/[id]/page.tsx` - Added edit mode state, mutations, and UI components

---

## Additional Enhancement: Customer Order Traceability

Also added a **"For Order"** column to the Order Items table that shows:
- Which customer order(s) each line item is associated with
- Clickable links to navigate to the customer order
- Quantity allocation breakdown (e.g., "Order: 80, Stock: 20")
- Badge for stock-only allocations

This provides visibility into the source of each purchase order line item.

---

## Related

- Fixed `create_purchase_order_with_lines` RPC call signature mismatch (see `purchase-order-per-line-association-20251120.md`)
- See `plans/inventory-traceability-po-consolidation-plan.md` for the full traceability and PO consolidation roadmap
