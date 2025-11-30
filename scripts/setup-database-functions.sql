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
  
  IF NOT EXISTS (SELECT 1 FROM supplier_order_statuses WHERE status_name = 'Partially Delivered') THEN
    INSERT INTO supplier_order_statuses (status_name) VALUES ('Partially Delivered');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM supplier_order_statuses WHERE status_name = 'Completed') THEN
    INSERT INTO supplier_order_statuses (status_name) VALUES ('Completed');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM supplier_order_statuses WHERE status_name = 'Cancelled') THEN
    INSERT INTO supplier_order_statuses (status_name) VALUES ('Cancelled');
  END IF;
  
  -- Additional names used by UI/queries (keep alongside legacy names)
  IF NOT EXISTS (SELECT 1 FROM supplier_order_statuses WHERE status_name = 'Approved') THEN
    INSERT INTO supplier_order_statuses (status_name) VALUES ('Approved');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM supplier_order_statuses WHERE status_name = 'Partially Received') THEN
    INSERT INTO supplier_order_statuses (status_name) VALUES ('Partially Received');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM supplier_order_statuses WHERE status_name = 'Fully Received') THEN
    INSERT INTO supplier_order_statuses (status_name) VALUES ('Fully Received');
  END IF;
END
$$;

-- Create purchase_orders table for Q-number tracking
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'purchase_orders') THEN
        CREATE TABLE public.purchase_orders (
            purchase_order_id SERIAL PRIMARY KEY,
            q_number TEXT,
            order_date TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            status_id INTEGER,
            notes TEXT,
            created_by UUID REFERENCES auth.users(id),
            approved_by UUID REFERENCES auth.users(id),
            created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            approved_at TIMESTAMP WITHOUT TIME ZONE,
            CONSTRAINT purchase_orders_q_number_key UNIQUE (q_number),
            CONSTRAINT purchase_orders_status_id_fkey FOREIGN KEY (status_id) 
                REFERENCES public.supplier_order_statuses(status_id)
        );
        
        RAISE NOTICE 'Created purchase_orders table';
    ELSE
        RAISE NOTICE 'purchase_orders table already exists';
    END IF;
END$$;

-- Create purchase order statuses if they don't exist
DO $$
BEGIN
    -- Check and insert 'Draft' status
    IF NOT EXISTS (SELECT 1 FROM supplier_order_statuses WHERE status_name = 'Draft') THEN
        INSERT INTO supplier_order_statuses (status_name) VALUES ('Draft');
        RAISE NOTICE 'Added Draft status';
    END IF;
    
    -- Check and insert 'Pending Approval' status
    IF NOT EXISTS (SELECT 1 FROM supplier_order_statuses WHERE status_name = 'Pending Approval') THEN
        INSERT INTO supplier_order_statuses (status_name) VALUES ('Pending Approval');
        RAISE NOTICE 'Added Pending Approval status';
    END IF;
END$$;

-- Add purchase_order_id column to supplier_orders if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'supplier_orders' 
                   AND column_name = 'purchase_order_id') THEN
        
        ALTER TABLE public.supplier_orders 
        ADD COLUMN purchase_order_id INTEGER REFERENCES public.purchase_orders(purchase_order_id);
        
        RAISE NOTICE 'Added purchase_order_id column to supplier_orders';
    ELSE
        RAISE NOTICE 'purchase_order_id column already exists in supplier_orders';
    END IF;
END$$; 
