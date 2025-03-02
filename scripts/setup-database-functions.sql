-- Function to update total_received in supplier_orders based on sum of supplier_order_receipts
CREATE OR REPLACE FUNCTION update_order_received_quantity(order_id_param INTEGER)
RETURNS VOID AS $$
BEGIN
  -- Update the total_received column with the sum of all receipt quantities
  UPDATE supplier_orders
  SET total_received = (
    SELECT COALESCE(SUM(quantity_received), 0)
    FROM supplier_order_receipts
    WHERE order_id = order_id_param
  )
  WHERE order_id = order_id_param;
  
  -- Update the status to "In Progress" if partially received
  UPDATE supplier_orders
  SET status_id = 2 -- Assuming 2 is "In Progress" status
  WHERE order_id = order_id_param
    AND total_received > 0
    AND total_received < order_quantity
    AND status_id = 1; -- Only update if currently "Open" (status_id = 1)
  
  -- Update the status to "Completed" if fully received
  UPDATE supplier_orders
  SET status_id = 3 -- Assuming 3 is "Completed" status
  WHERE order_id = order_id_param
    AND total_received >= order_quantity
    AND status_id IN (1, 2); -- Only update if currently "Open" or "In Progress"
END;
$$ LANGUAGE plpgsql;

-- Add initial transaction types if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM transaction_types WHERE type_name = 'PURCHASE') THEN
    INSERT INTO transaction_types (type_name) VALUES ('PURCHASE');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM transaction_types WHERE type_name = 'SALE') THEN
    INSERT INTO transaction_types (type_name) VALUES ('SALE');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM transaction_types WHERE type_name = 'ADJUSTMENT') THEN
    INSERT INTO transaction_types (type_name) VALUES ('ADJUSTMENT');
  END IF;
END
$$;

-- Add initial supplier order statuses if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM supplier_order_statuses WHERE status_name = 'Open') THEN
    INSERT INTO supplier_order_statuses (status_name) VALUES ('Open');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM supplier_order_statuses WHERE status_name = 'In Progress') THEN
    INSERT INTO supplier_order_statuses (status_name) VALUES ('In Progress');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM supplier_order_statuses WHERE status_name = 'Completed') THEN
    INSERT INTO supplier_order_statuses (status_name) VALUES ('Completed');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM supplier_order_statuses WHERE status_name = 'Cancelled') THEN
    INSERT INTO supplier_order_statuses (status_name) VALUES ('Cancelled');
  END IF;
END
$$; 