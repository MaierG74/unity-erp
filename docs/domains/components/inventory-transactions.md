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
