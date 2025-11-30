-- Function to get affected orders for a specific component
-- Run this in the Supabase SQL Editor to fix the "function not found" error

CREATE OR REPLACE FUNCTION get_component_affected_orders(p_component_id INT)
RETURNS TABLE (
    order_id INT,
    order_number TEXT,
    quantity_required INT,
    status TEXT,
    order_date TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT 
        o.order_id,
        'ORD-' || o.order_id AS order_number,
        (od.quantity * bom.quantity_required)::INTEGER AS quantity_required,
        os.status_name AS status,
        o.created_at AS order_date
    FROM 
        public.orders o
    JOIN 
        public.order_statuses os ON o.status_id = os.status_id
    JOIN 
        public.order_details od ON o.order_id = od.order_id
    JOIN 
        public.billofmaterials bom ON od.product_id = bom.product_id
    WHERE 
        bom.component_id = p_component_id
        AND os.status_name NOT IN ('Completed', 'Cancelled')
    ORDER BY 
        o.created_at ASC;
$$;
