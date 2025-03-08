-- Create a function that can be called via RPC to create the update_order_received_quantity function
CREATE OR REPLACE FUNCTION create_update_order_received_quantity_function()
RETURNS void AS $$
BEGIN
    EXECUTE '
    CREATE OR REPLACE FUNCTION update_order_received_quantity(order_id_param INTEGER)
    RETURNS VOID AS $func$
    DECLARE
      completed_status_id INTEGER;
      partially_delivered_status_id INTEGER;
      open_status_id INTEGER;
    BEGIN
      -- Get status IDs directly
      SELECT status_id INTO completed_status_id FROM supplier_order_statuses WHERE status_name = ''Completed'';
      SELECT status_id INTO partially_delivered_status_id FROM supplier_order_statuses WHERE status_name = ''Partially Delivered'';
      SELECT status_id INTO open_status_id FROM supplier_order_statuses WHERE status_name = ''Open'';
      
      -- Update the total_received column with the sum of all receipt quantities
      UPDATE supplier_orders
      SET total_received = (
        SELECT COALESCE(SUM(quantity_received), 0)
        FROM supplier_order_receipts
        WHERE order_id = order_id_param
      )
      WHERE order_id = order_id_param;
      
      -- Update the status to "Partially Delivered" if partially received
      UPDATE supplier_orders
      SET status_id = partially_delivered_status_id
      WHERE order_id = order_id_param
        AND total_received > 0
        AND total_received < order_quantity
        AND status_id = open_status_id;
      
      -- Update the status to "Completed" if fully received
      UPDATE supplier_orders
      SET status_id = completed_status_id
      WHERE order_id = order_id_param
        AND total_received >= order_quantity;
        
      -- Debug output
      RAISE NOTICE ''Order % updated: total_received: %, status: %'', 
        order_id_param, 
        (SELECT total_received FROM supplier_orders WHERE order_id = order_id_param),
        (SELECT status_name FROM supplier_order_statuses 
         WHERE status_id = (SELECT status_id FROM supplier_orders WHERE order_id = order_id_param));
    END;
    $func$ LANGUAGE plpgsql;
    ';
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission to the authenticated user role
GRANT EXECUTE ON FUNCTION create_update_order_received_quantity_function() TO authenticated; 