-- Create the supplier_order_customer_orders junction table
CREATE TABLE IF NOT EXISTS supplier_order_customer_orders (
    id SERIAL PRIMARY KEY,
    supplier_order_id INTEGER NOT NULL REFERENCES supplier_orders(order_id),
    order_id INTEGER NOT NULL REFERENCES orders(order_id),
    component_id INTEGER NOT NULL REFERENCES components(component_id),
    quantity_for_order INTEGER NOT NULL DEFAULT 0,
    quantity_for_stock INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(supplier_order_id, order_id, component_id)
);

-- Add indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_soco_supplier_order_id ON supplier_order_customer_orders(supplier_order_id);
CREATE INDEX IF NOT EXISTS idx_soco_order_id ON supplier_order_customer_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_soco_component_id ON supplier_order_customer_orders(component_id);

-- Create helper function to get component order history for a customer order
CREATE OR REPLACE FUNCTION get_order_component_history(p_order_id INTEGER)
RETURNS TABLE (
    component_id INTEGER,
    supplier_order_id INTEGER,
    supplier_name TEXT,
    order_date TIMESTAMP WITH TIME ZONE,
    order_quantity INTEGER,
    quantity_for_order INTEGER,
    quantity_for_stock INTEGER,
    total_received INTEGER,
    status_name TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        soco.component_id,
        so.order_id AS supplier_order_id,
        s.name AS supplier_name,
        so.order_date,
        so.order_quantity,
        soco.quantity_for_order,
        soco.quantity_for_stock,
        so.total_received,
        sos.status_name
    FROM 
        supplier_order_customer_orders soco
    JOIN 
        supplier_orders so ON soco.supplier_order_id = so.order_id
    JOIN 
        supplier_order_statuses sos ON so.status_id = sos.status_id
    JOIN 
        suppliercomponents sc ON so.supplier_component_id = sc.supplier_component_id
    JOIN 
        suppliers s ON sc.supplier_id = s.supplier_id
    WHERE 
        soco.order_id = p_order_id
    ORDER BY 
        so.order_date DESC;
END;
$$ LANGUAGE plpgsql; 