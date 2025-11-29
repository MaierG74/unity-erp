# Inventory Traceability & PO Consolidation Plan

**Created:** November 26, 2025  
**Status:** Planning  
**Priority:** High

---

## Overview

This plan addresses two related business needs:

1. **Inventory Traceability** - Track which customer order inventory is associated with throughout its lifecycle (purchase → receipt → issuance)
2. **PO Consolidation** - Intelligently consolidate purchase orders to the same supplier instead of creating multiple separate orders

---

## Problem Statements

### Inventory Traceability
- Currently, when viewing a Purchase Order, there's no visibility into which customer order(s) the items are for
- When receiving stock, the customer order association is not propagated
- When issuing stock, there's no enforcement/warning if using inventory earmarked for a different order
- Risk of allocating inventory to the wrong customer order

### PO Consolidation
- When creating POs from multiple customer orders, separate POs are created even if they're for the same supplier
- This creates unnecessary administrative overhead
- Suppliers prefer consolidated orders
- Multiple small orders may miss volume discounts

---

## Proposed Solution

### Phase 1: UI Visibility (Quick Wins)

#### 1.1 Show Customer Order Links on PO Detail Page
Display which customer order(s) each line item is associated with.

**Location:** `app/purchasing/purchase-orders/[id]/page.tsx`

**Changes:**
- Query `supplier_order_customer_orders` junction table
- Add "For Order" column to the line items table
- Show clickable link to customer order (e.g., "Order #175")
- Show allocation split if both `quantity_for_order` and `quantity_for_stock` are set

**UI Mockup:**
```
| Component | Description | Supplier | Price | Qty | For Order     | Received | Total |
|-----------|-------------|----------|-------|-----|---------------|----------|-------|
| COMP-001  | Widget A    | Acme     | R50   | 100 | #175 (100)    | 0        | R5000 |
| COMP-002  | Widget B    | Acme     | R30   | 50  | #175 (30), Stock (20) | 0 | R1500 |
```

**Effort:** Low (1-2 hours)

#### 1.2 Show Source Customer Orders on PO List Page
Add a column or badge showing which customer orders a PO serves.

**Effort:** Low (1 hour)

---

### Phase 2: PO Consolidation

#### 2.1 Check for Existing Draft POs When Creating

When user initiates PO creation from a customer order, check if Draft POs exist for the same supplier(s).

**Flow:**
```
User clicks "Create PO" for components
    ↓
System checks: Are there Draft POs for these suppliers?
    ↓
If YES → Show consolidation dialog
If NO → Create new PO as normal
```

**Consolidation Dialog:**
```
┌─────────────────────────────────────────────────────────────────┐
│ Existing Draft Orders Found                                      │
├─────────────────────────────────────────────────────────────────┤
│ A Draft purchase order already exists for [Supplier Name].       │
│                                                                  │
│ ○ Add to existing PO #50 (created Nov 25, 3 items, R2,500)      │
│ ○ Add to existing PO #48 (created Nov 20, 5 items, R4,200)      │
│ ○ Create new Purchase Order                                      │
│                                                                  │
│ [Cancel]                              [Continue]                 │
└─────────────────────────────────────────────────────────────────┘
```

**Database Changes:** None required - uses existing tables

**Code Changes:**
- `app/orders/[orderId]/page.tsx` - Add check before calling `create_purchase_order_with_lines`
- New component: `ConsolidatePODialog.tsx`
- New API/RPC: Query Draft POs by supplier

**Effort:** Medium (4-6 hours)

#### 2.2 Add Lines to Existing PO

New RPC function to add line items to an existing purchase order.

**Function:** `add_lines_to_purchase_order`
```sql
CREATE OR REPLACE FUNCTION add_lines_to_purchase_order(
  target_purchase_order_id integer,
  line_items jsonb  -- Same format as create_purchase_order_with_lines
) RETURNS TABLE (supplier_order_ids integer[])
```

**Effort:** Medium (2-3 hours)

#### 2.3 Merge/Consolidate Multiple Draft POs

Allow user to select multiple Draft POs and merge them into one.

**Location:** `app/purchasing/purchase-orders/page.tsx` (list page)

**UI:**
- Add checkbox selection to Draft POs
- "Merge Selected" button appears when 2+ Drafts for same supplier selected
- Confirmation dialog showing what will be merged
- Keep the oldest PO, move all lines to it, delete the others

**Flow:**
```
User selects Draft PO #48 and #50 (both for same supplier)
    ↓
Clicks "Merge Selected"
    ↓
Confirmation: "Merge 2 purchase orders into PO #48?"
    ↓
System moves all lines from #50 to #48
System deletes #50
User redirected to merged PO #48
```

**RPC Function:** `merge_purchase_orders`
```sql
CREATE OR REPLACE FUNCTION merge_purchase_orders(
  target_po_id integer,
  source_po_ids integer[]
) RETURNS integer  -- Returns target PO id
```

**Effort:** Medium-High (4-6 hours)

---

### Phase 3: Inventory Reservation System

#### 3.1 Track Customer Order Through Receipts

When receiving stock, record which customer order the quantity is earmarked for.

**Schema Change:**
```sql
ALTER TABLE supplier_order_receipts 
ADD COLUMN customer_order_id integer REFERENCES orders(order_id);
```

**Code Changes:**
- Receipt modal needs to show/select customer order allocation
- Auto-populate from `supplier_order_customer_orders` data

**Effort:** Medium (3-4 hours)

#### 3.2 Reserved Inventory Concept

New table to track inventory reservations by customer order.

**Schema:**
```sql
CREATE TABLE inventory_reservations (
  reservation_id serial PRIMARY KEY,
  component_id integer NOT NULL REFERENCES components(component_id),
  customer_order_id integer NOT NULL REFERENCES orders(order_id),
  quantity_reserved numeric NOT NULL,
  source_supplier_order_id integer REFERENCES supplier_orders(order_id),
  source_receipt_id integer REFERENCES supplier_order_receipts(receipt_id),
  status varchar(20) DEFAULT 'reserved', -- reserved, issued, released
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

**Behavior:**
- When stock is received for a customer order → create reservation
- When stock is issued to that order → mark reservation as issued
- When order is cancelled → release reservation back to free stock

**Effort:** High (8-12 hours)

#### 3.3 Available Stock Calculation

Update inventory calculations to account for reservations.

**Current:**
```
Available = quantity_on_hand
```

**New:**
```
Available = quantity_on_hand - reserved_for_orders
Reserved for Order X = SUM(quantity_reserved WHERE customer_order_id = X)
```

**Views/Functions:**
```sql
CREATE OR REPLACE VIEW inventory_availability AS
SELECT 
  i.component_id,
  i.quantity_on_hand,
  COALESCE(SUM(r.quantity_reserved) FILTER (WHERE r.status = 'reserved'), 0) as total_reserved,
  i.quantity_on_hand - COALESCE(SUM(r.quantity_reserved) FILTER (WHERE r.status = 'reserved'), 0) as available
FROM inventory i
LEFT JOIN inventory_reservations r ON i.component_id = r.component_id
GROUP BY i.component_id, i.quantity_on_hand;
```

**Effort:** Medium (4-6 hours)

#### 3.4 Allocation Warnings on Stock Issuance

When issuing stock, warn if using inventory reserved for a different order.

**UI Changes:**
- Stock issuance modal shows reserved quantities
- Warning badge: "⚠️ 50 units reserved for Order #180"
- Option to proceed anyway or adjust

**Effort:** Medium (3-4 hours)

---

### Phase 4: Full Traceability UI

#### 4.1 Inventory Ledger View

New page showing the full journey of inventory for a component or order.

**Views:**
- By Component: See all movements for a specific component
- By Customer Order: See all inventory associated with an order

**Columns:**
```
| Date | Type | Qty | From/To | Customer Order | PO | Reference |
|------|------|-----|---------|----------------|-----|-----------|
| Nov 25 | Received | +100 | Acme Supplies | #175 | PO #50 | Receipt #123 |
| Nov 26 | Issued | -50 | Production | #175 | - | Issuance #456 |
```

**Effort:** High (6-8 hours)

#### 4.2 Component Detail Page Enhancement

Show reservation status on component detail page.

**UI:**
```
Stock Status
├── On Hand: 150
├── Reserved: 100
│   ├── Order #175: 50
│   └── Order #180: 50
├── Available: 50
└── On Order: 200
```

**Effort:** Medium (3-4 hours)

---

## Implementation Phases

### Phase 1: Quick Wins (Week 1)
- [x] Edit mode for Draft POs (completed)
- [x] Show customer order links on PO detail page (completed Nov 26, 2025)
- [ ] Show customer orders on PO list page

### Phase 2: PO Consolidation (Week 2)
- [x] Check for existing Drafts when creating PO (completed Nov 26, 2025)
- [x] Consolidation dialog component (completed Nov 26, 2025)
- [x] `add_lines_to_purchase_order` RPC (completed Nov 26, 2025)
- [x] `get_draft_purchase_orders_for_supplier` RPC (completed Nov 26, 2025)
- [ ] Merge multiple Draft POs feature
- [ ] `merge_purchase_orders` RPC

### Phase 3: Inventory Reservations (Week 3-4)
- [ ] Add `customer_order_id` to receipts
- [ ] Create `inventory_reservations` table
- [ ] Update receipt flow to create reservations
- [ ] Update availability calculations
- [ ] Add allocation warnings to issuance

### Phase 4: Traceability UI (Week 4-5)
- [ ] Inventory ledger view
- [ ] Component detail enhancements
- [ ] Order detail - show associated inventory

---

## Database Schema Summary

### New Tables
```sql
-- Track reserved inventory by customer order
CREATE TABLE inventory_reservations (
  reservation_id serial PRIMARY KEY,
  component_id integer NOT NULL REFERENCES components(component_id),
  customer_order_id integer NOT NULL REFERENCES orders(order_id),
  quantity_reserved numeric NOT NULL,
  source_supplier_order_id integer REFERENCES supplier_orders(order_id),
  source_receipt_id integer REFERENCES supplier_order_receipts(receipt_id),
  status varchar(20) DEFAULT 'reserved',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_reservations_component ON inventory_reservations(component_id);
CREATE INDEX idx_reservations_order ON inventory_reservations(customer_order_id);
```

### Schema Modifications
```sql
-- Link receipts to customer orders
ALTER TABLE supplier_order_receipts 
ADD COLUMN customer_order_id integer REFERENCES orders(order_id);
```

### New Functions
```sql
-- Add lines to existing PO
CREATE FUNCTION add_lines_to_purchase_order(...)

-- Merge multiple POs
CREATE FUNCTION merge_purchase_orders(...)

-- Get available inventory (accounting for reservations)
CREATE VIEW inventory_availability AS ...
```

---

## Open Questions

1. **Partial Receipts**: If a line is for 100 units (80 for order, 20 for stock), and we receive 50, how do we allocate? FIFO (order first)? Pro-rata? User choice?

2. **Over-Receipt**: If we receive more than ordered, does the extra go to stock or can user allocate to another order?

3. **Order Cancellation**: When a customer order is cancelled, should reserved inventory automatically become available, or require manual release?

4. **Reporting**: What reports would be useful for this traceability data?

---

## Success Metrics

- Reduced time spent manually tracking which inventory is for which order
- Zero instances of incorrect inventory allocation
- Fewer separate POs to same supplier (consolidation rate)
- Clear audit trail for any inventory question

---

## Related Documentation

- [Purchase Order Per-Line Association](../changelogs/purchase-order-per-line-association-20251120.md)
- [Purchase Order Edit Mode](../changelogs/purchase-order-edit-mode-20251126.md)
- [Stock Issuance Implementation](../changelogs/stock-issuance-implementation-20250104.md)
