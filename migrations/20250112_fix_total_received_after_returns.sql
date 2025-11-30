-- Migration: Fix total_received for orders with returns
-- Date: 2025-01-12
-- Issue: Orders with returns created before Phase 1 deployment have incorrect total_received
-- The old RPC didn't subtract returns from total_received, causing "owing" calculation to be wrong

-- Recalculate total_received for all supplier orders
-- Formula: total_received = (sum of receipts) - (sum of later_return type returns only)
-- Rejections should NOT be subtracted because they never entered inventory

UPDATE supplier_orders so
SET total_received = (
  SELECT
    COALESCE(
      (SELECT SUM(quantity_received) FROM supplier_order_receipts WHERE order_id = so.order_id),
      0
    ) -
    COALESCE(
      (SELECT SUM(quantity_returned)
       FROM supplier_order_returns
       WHERE supplier_order_id = so.order_id
         AND return_type = 'later_return'
      ),
      0
    )
)
WHERE EXISTS (
  -- Only update orders that have returns
  SELECT 1
  FROM supplier_order_returns
  WHERE supplier_order_id = so.order_id
);

-- Also update the status based on the corrected total_received
UPDATE supplier_orders so
SET status_id = (
  CASE
    -- If total_received >= order_quantity, mark as fully received
    WHEN so.total_received >= so.order_quantity THEN
      (SELECT status_id FROM supplier_order_statuses WHERE LOWER(status_name) = 'fully received' LIMIT 1)
    -- If total_received > 0 but < order_quantity, mark as partially received
    WHEN so.total_received > 0 THEN
      (SELECT status_id FROM supplier_order_statuses WHERE LOWER(status_name) = 'partially received' LIMIT 1)
    -- Otherwise keep current status
    ELSE so.status_id
  END
)
WHERE EXISTS (
  -- Only update orders that have returns
  SELECT 1
  FROM supplier_order_returns
  WHERE supplier_order_id = so.order_id
);
