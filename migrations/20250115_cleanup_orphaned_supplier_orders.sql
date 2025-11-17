-- Cleanup orphaned supplier_orders rows
-- Delete supplier_orders rows where purchase_order_id references a non-existent purchase_order
-- This cleans up rows left behind from deleted test purchase orders

DELETE FROM supplier_orders
WHERE purchase_order_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 
    FROM purchase_orders 
    WHERE purchase_orders.purchase_order_id = supplier_orders.purchase_order_id
  );

-- Log the cleanup (optional - can be removed if not needed)
DO $$
DECLARE
  deleted_count INTEGER;
BEGIN
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE 'Cleaned up % orphaned supplier_orders rows', deleted_count;
END $$;






