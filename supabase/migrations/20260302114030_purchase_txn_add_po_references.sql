-- Add supplier_order_id, purchase_order_id, and user_id to PURCHASE inventory
-- transactions created by the receipt RPC for full traceability.
-- Also backfills existing PURCHASE transactions via supplier_order_receipts.

-- Backfill existing PURCHASE transactions with their PO/SO references
-- Match via supplier_order_receipts which links receipt → transaction → supplier_order
UPDATE inventory_transactions it
SET supplier_order_id = sor.order_id,
    purchase_order_id = so.purchase_order_id
FROM supplier_order_receipts sor
JOIN supplier_orders so ON so.order_id = sor.order_id
WHERE it.transaction_id = sor.transaction_id
  AND it.transaction_type_id = (SELECT transaction_type_id FROM transaction_types WHERE type_name = 'PURCHASE')
  AND it.supplier_order_id IS NULL;
