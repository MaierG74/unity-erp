-- Quick fix: Recalculate all order totals based on their order details
-- Run this in Supabase SQL Editor

UPDATE orders o
SET total_amount = COALESCE((
  SELECT SUM(quantity * unit_price)
  FROM order_details
  WHERE order_id = o.order_id
), 0);
