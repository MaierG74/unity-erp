-- Migration: PO Consolidation RPC Functions
-- Date: November 26, 2025
-- Description: Add RPC functions for PO consolidation feature

-- Function to get Draft purchase orders for a specific supplier
-- Used to check for consolidation opportunities
CREATE OR REPLACE FUNCTION public.get_draft_purchase_orders_for_supplier(
    p_supplier_id integer
) RETURNS TABLE(
    purchase_order_id integer,
    q_number text,
    created_at timestamptz,
    notes text,
    line_count bigint,
    total_amount numeric
)
LANGUAGE sql
STABLE
AS $function$
    SELECT 
        po.purchase_order_id,
        po.q_number,
        po.created_at,
        po.notes,
        COUNT(so.order_id) as line_count,
        COALESCE(SUM(so.order_quantity * COALESCE(sc.price, 0)), 0) as total_amount
    FROM purchase_orders po
    JOIN supplier_order_statuses sos ON po.status_id = sos.status_id
    LEFT JOIN supplier_orders so ON po.purchase_order_id = so.purchase_order_id
    LEFT JOIN suppliercomponents sc ON so.supplier_component_id = sc.supplier_component_id
    WHERE po.supplier_id = p_supplier_id
      AND sos.status_name = 'Draft'
    GROUP BY po.purchase_order_id, po.q_number, po.created_at, po.notes
    ORDER BY po.created_at DESC;
$function$;

-- RPC function to add line items to an existing purchase order
-- Used for PO consolidation when user wants to add items to a Draft PO
CREATE OR REPLACE FUNCTION public.add_lines_to_purchase_order(
    target_purchase_order_id integer,
    line_items jsonb
) RETURNS TABLE(supplier_order_ids integer[])
LANGUAGE plpgsql
AS $function$
DECLARE
    po_status_id integer;
    po_order_date timestamptz;
    inserted_ids integer[];
BEGIN
    -- Validate inputs
    IF line_items IS NULL OR jsonb_typeof(line_items) <> 'array' OR jsonb_array_length(line_items) = 0 THEN
        RAISE EXCEPTION 'line_items payload must be a non-empty array';
    END IF;

    -- Get the existing PO's status and order date
    SELECT status_id, order_date
    INTO po_status_id, po_order_date
    FROM purchase_orders
    WHERE purchase_order_id = target_purchase_order_id;

    IF po_status_id IS NULL THEN
        RAISE EXCEPTION 'Purchase order % not found', target_purchase_order_id;
    END IF;

    -- Verify PO is in Draft status
    IF NOT EXISTS (
        SELECT 1 FROM supplier_order_statuses 
        WHERE status_id = po_status_id AND status_name = 'Draft'
    ) THEN
        RAISE EXCEPTION 'Can only add lines to Draft purchase orders';
    END IF;

    -- Insert new supplier orders
    WITH payload AS (
        SELECT
            supplier_component_id,
            order_quantity,
            component_id,
            COALESCE(quantity_for_order, 0::numeric) AS quantity_for_order,
            COALESCE(quantity_for_stock, 0::numeric) AS quantity_for_stock,
            customer_order_id
        FROM jsonb_to_recordset(line_items) AS x(
            supplier_component_id integer,
            order_quantity numeric,
            component_id integer,
            quantity_for_order numeric,
            quantity_for_stock numeric,
            customer_order_id integer
        )
    ),
    inserted AS (
        INSERT INTO supplier_orders (
            supplier_component_id,
            order_quantity,
            order_date,
            status_id,
            total_received,
            purchase_order_id
        )
        SELECT
            payload.supplier_component_id,
            payload.order_quantity,
            po_order_date,
            po_status_id,
            0,
            target_purchase_order_id
        FROM payload
        RETURNING supplier_orders.order_id, supplier_orders.supplier_component_id
    )
    SELECT array_agg(inserted.order_id) INTO inserted_ids FROM inserted;

    -- Insert customer order associations
    WITH payload AS (
        SELECT
            supplier_component_id,
            order_quantity,
            component_id,
            COALESCE(quantity_for_order, 0::numeric) AS quantity_for_order,
            COALESCE(quantity_for_stock, 0::numeric) AS quantity_for_stock,
            customer_order_id
        FROM jsonb_to_recordset(line_items) AS x(
            supplier_component_id integer,
            order_quantity numeric,
            component_id integer,
            quantity_for_order numeric,
            quantity_for_stock numeric,
            customer_order_id integer
        )
    )
    INSERT INTO supplier_order_customer_orders (
        supplier_order_id,
        order_id,
        component_id,
        quantity_for_order,
        quantity_for_stock
    )
    SELECT
        so.order_id,
        payload.customer_order_id,
        payload.component_id,
        payload.quantity_for_order,
        payload.quantity_for_stock
    FROM supplier_orders so
    JOIN payload ON payload.supplier_component_id = so.supplier_component_id
    WHERE so.purchase_order_id = target_purchase_order_id
      AND so.order_id = ANY(inserted_ids);

    RETURN QUERY SELECT inserted_ids;
END;
$function$;
