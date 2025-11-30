-- Migration: Add automatic total calculation for orders
-- Created: 2025-01-16
-- Purpose: Automatically maintain orders.total_amount based on order_details

-- Function to update orders.total_amount
CREATE OR REPLACE FUNCTION update_order_total()
RETURNS TRIGGER AS $$
DECLARE
  order_pk INTEGER;
  items_sum NUMERIC;
BEGIN
  -- Determine which order to update
  IF TG_OP = 'DELETE' THEN
    order_pk := OLD.order_id;
  ELSE
    order_pk := NEW.order_id;
  END IF;

  -- Calculate sum of all order detail totals (quantity * unit_price)
  SELECT COALESCE(SUM(quantity * unit_price), 0)
  INTO items_sum
  FROM order_details
  WHERE order_id = order_pk;

  -- Update the order total_amount
  UPDATE orders
  SET
    total_amount = items_sum,
    updated_at = NOW()
  WHERE order_id = order_pk;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update orders.total_amount when order_details change
DROP TRIGGER IF EXISTS order_details_total_update_trigger ON order_details;
CREATE TRIGGER order_details_total_update_trigger
  AFTER INSERT OR UPDATE OF quantity, unit_price OR DELETE
  ON order_details
  FOR EACH ROW
  EXECUTE FUNCTION update_order_total();

-- Fix existing data: update all orders totals
UPDATE orders o
SET
  total_amount = COALESCE((
    SELECT SUM(quantity * unit_price)
    FROM order_details
    WHERE order_id = o.order_id
  ), 0),
  updated_at = NOW();
