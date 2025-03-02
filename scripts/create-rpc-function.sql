-- Create a function that can be called via RPC to create the update_order_received_quantity function
CREATE OR REPLACE FUNCTION create_update_order_received_quantity_function()
RETURNS void AS $$
BEGIN
    EXECUTE '
    CREATE OR REPLACE FUNCTION update_order_received_quantity(order_id_param INTEGER)
    RETURNS VOID AS $func$
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
      SET status_id = (SELECT status_id FROM supplier_order_statuses WHERE status_name = ''In Progress'')
      WHERE order_id = order_id_param
        AND total_received > 0
        AND total_received < order_quantity
        AND status_id = (SELECT status_id FROM supplier_order_statuses WHERE status_name = ''Open'');
      
      -- Update the status to "Completed" if fully received
      UPDATE supplier_orders
      SET status_id = (SELECT status_id FROM supplier_order_statuses WHERE status_name = ''Completed'')
      WHERE order_id = order_id_param
        AND total_received >= order_quantity
        AND status_id IN (
          SELECT status_id FROM supplier_order_statuses WHERE status_name IN (''Open'', ''In Progress'')
        );
    END;
    $func$ LANGUAGE plpgsql;
    ';
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission to the authenticated user role
GRANT EXECUTE ON FUNCTION create_update_order_received_quantity_function() TO authenticated; 