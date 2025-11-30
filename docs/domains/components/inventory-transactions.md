# Inventory Transactions

## Purpose
Canonical specification for `inventory_transactions` and how movements affect on‑hand inventory.

## Table
- `inventory_transactions`
  - `transaction_id` SERIAL PK
  - `component_id` INT FK → `components.component_id`
  - `quantity` NUMERIC — positive for IN, negative for OUT; for ADJUST store signed delta
  - `transaction_type` TEXT — 'IN' | 'OUT' | 'ADJUST'
  - `transaction_date` TIMESTAMPTZ DEFAULT now()
  - References (nullable, as applicable): `order_id`, `supplier_order_id`, `purchase_order_id`, `user_id`, `reason`

## Types & Sources
- IN
  - Purchasing receipts — from `supplier_order_receipts` via `process_supplier_order_receipt`
  - Stock issuance reversals — from `reverse_stock_issuance` (brings stock back into inventory)
  - Returns/corrections
- OUT
  - Stock issuance to customer orders — from `process_stock_issuance` (SALE type, negative quantity)
  - Production issues / order consumption
  - Returns to supplier
- ADJUST
  - Cycle counts and corrections
  - Damaged/obsolete write‑offs

## Invariants
- On‑hand per component equals base quantity plus SUM(all transactions).
- Each transaction must record provenance when available (who/what caused it).
- ADJUST requires a `reason` and `user_id` for audit.

## Receiving Contract (Server)
- Input: `supplier_order_id`, `component_id`, `quantity_received`
- Behavior:
  - Insert IN transaction
  - Insert receipt row
  - Recompute supplier order `total_received` and status
  - Increment `inventory.quantity_on_hand`

## Stock Issuance Contract (Server)
- RPC: `process_stock_issuance(p_order_id, p_component_id, p_quantity, p_purchase_order_id, p_notes, p_issuance_date)`
- Input: `order_id` (customer order), `component_id`, `quantity`, optional `purchase_order_id`, optional `notes`
- Behavior:
  - Validate inventory availability
  - Insert OUT transaction (SALE type, negative quantity)
  - Decrement `inventory.quantity_on_hand`
  - Insert `stock_issuances` record
  - Record `user_id` from auth context
  - Return `issuance_id`, `transaction_id`, updated `quantity_on_hand`, `success`, `message`
- Reversal: `reverse_stock_issuance(p_issuance_id, p_quantity_to_reverse, p_reason, p_reversal_date)`
  - Creates IN transaction (PURCHASE type, positive quantity)
  - Increments `inventory.quantity_on_hand`
  - Updates `stock_issuances` record

## Adjustment Contract (Server)
- Input: `component_id`, `delta_quantity`, `reason` (enum/string), optional `note`
- Behavior:
  - Insert ADJUST transaction with signed delta
  - Update `inventory.quantity_on_hand` by delta
  - Log `user_id` from session
  - Validate permissions and prevent zero‑delta writes

## Stock Adjustment UI (Client)
The Transactions tab on the component detail page (`/inventory/components/[id]`) includes:

### Current Stock Balance Banner
- Prominent display of current `quantity_on_hand` at the top of the Transactions tab
- Blue gradient card with icon for visual emphasis
- "Stock Adjustment" button for quick access to adjustment dialog

### Stock Adjustment Dialog
Accessible via the "Stock Adjustment" button, the dialog provides:

**Adjustment Types:**
- **Set To** — Enter the counted quantity (system calculates delta)
- **Add** — Add units to current stock
- **Subtract** — Remove units from current stock

**Reason Codes (mandatory):**
| Code | Label | Description |
|------|-------|-------------|
| `stock_count` | Stock Count Variance | Discrepancy found during stock take |
| `damage` | Damage/Spoilage | Items damaged or spoiled |
| `theft` | Theft/Loss | Items lost or stolen |
| `data_entry_error` | Data Entry Correction | Correcting previous entry error |
| `found_stock` | Found Stock | Previously unrecorded stock found |
| `quality_rejection` | Quality Rejection | Items failed quality check |
| `sample_usage` | Sample/Testing | Used for samples or testing |
| `write_off` | Write-off | Obsolete or expired stock |
| `cycle_count` | Cycle Count | Regular cycle count adjustment |
| `other` | Other | Other reason (requires notes) |

**Validation:**
- Reason is required for all adjustments
- "Other" reason requires additional notes
- Large adjustments (>50 units or >50% of current stock) show a warning
- Zero-delta adjustments are prevented

**Audit Trail:**
- Records `user_id`, `transaction_date`, and full reason text
- Transaction appears in history with "ADJUSTMENT" type badge
- Running balance is recalculated and displayed

### Best Practices (from ERP industry standards)
1. **Mandatory reason codes** — Every adjustment must have a documented reason
2. **Approval workflow** — Large adjustments should trigger review (future enhancement)
3. **Cycle counting** — Regular partial counts between full stock takes
4. **Real-time visibility** — Current balance always visible on Transactions tab
5. **Full audit trail** — Who, when, why for every adjustment

## Transaction History Filters

The Transactions tab includes a comprehensive filter panel for analyzing transaction history:

### Filter Options
- **Date Range** — From/To date pickers with quick presets (Last 7/30/90 days, This year)
- **Transaction Type** — All, Purchases (IN), Issues (OUT), Adjustments, Returns
- **Source** — All, Purchase Orders, Customer Orders, Manual Adjustments
- **Search** — Free-text search across order numbers, PO numbers, and reasons

### Features
- Filter badge shows count of matching transactions vs total
- Statistics cards update to reflect filtered data
- Export to CSV respects active filters
- Clear all filters with one click

## Quick Actions

### Create Purchase Order
The "Create PO" button in the stock balance banner links to `/purchasing/purchase-orders/new?component={id}`, pre-filling the component for quick reordering when stock is low.

### Export to CSV
Exports filtered transaction history with columns: Date, Type, Quantity, Balance, Order Reference, Reason

## Reconciliation Queries (Examples)
- Component movement summary (last 30 days)
```sql
select component_id,
       sum(case when transaction_type='IN' then quantity else 0 end) as total_in,
       sum(case when transaction_type='OUT' then -quantity else 0 end) as total_out,
       sum(case when transaction_type='ADJUST' then quantity else 0 end) as total_adjust,
       sum(quantity) as net
from inventory_transactions
where transaction_date >= now() - interval '30 days'
group by 1
order by 1;
```

- Below reorder with latest movement date
```sql
select c.internal_code,
       i.quantity_on_hand,
       i.reorder_level,
       (select max(transaction_date)
          from inventory_transactions t
         where t.component_id = i.component_id) as last_movement
from inventory i
join components c on c.component_id = i.component_id
where i.quantity_on_hand < i.reorder_level
order by i.quantity_on_hand - i.reorder_level asc;
```

## Reporting/Assistant Hooks
- `inventory.list_below_reorder` — surface low stock with suggested reorder qty (see policy in Inventory Master).
- `inventory.get_stock_on_hand` — single component lookup (optionally by location).

## Notes
- Move heavy joins to views for performance.
- Keep transaction types and reasons normalized (consider `inventory_adjustment_reasons`).
