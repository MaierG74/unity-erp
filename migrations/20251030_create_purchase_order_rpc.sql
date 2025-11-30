-- Create a transactional helper to create purchase orders and supplier order lines together.
CREATE OR REPLACE FUNCTION public.create_purchase_order_with_lines(
    supplier_id integer,
    customer_order_id integer,
    line_items jsonb,
    status_id integer DEFAULT NULL,
    order_date timestamptz DEFAULT now(),
    notes text DEFAULT ''
) RETURNS TABLE (
    purchase_order_id integer,
    supplier_order_ids integer[]
)
LANGUAGE plpgsql
AS $$
DECLARE
    resolved_status_id integer := status_id;
    actual_order_date timestamptz := COALESCE(order_date, now());
    new_purchase_order_id integer;
    inserted_ids integer[];
BEGIN
    IF line_items IS NULL OR jsonb_typeof(line_items) <> 'array' OR jsonb_array_length(line_items) = 0 THEN
        RAISE EXCEPTION 'line_items payload must be a non-empty array';
    END IF;

    IF resolved_status_id IS NULL THEN
        SELECT sos.status_id
        INTO resolved_status_id
        FROM supplier_order_statuses sos
        WHERE sos.status_name = 'Draft'
        LIMIT 1;

        IF resolved_status_id IS NULL THEN
            RAISE EXCEPTION 'Could not resolve status_id for Draft supplier orders';
        END IF;
    END IF;

    INSERT INTO purchase_orders (supplier_id, status_id, order_date, notes)
    VALUES (supplier_id, resolved_status_id, actual_order_date, notes)
    RETURNING purchase_orders.purchase_order_id
    INTO new_purchase_order_id;

    WITH payload AS (
        SELECT
            supplier_component_id,
            order_quantity,
            component_id,
            COALESCE(quantity_for_order, 0::numeric) AS quantity_for_order,
            COALESCE(quantity_for_stock, 0::numeric) AS quantity_for_stock
        FROM jsonb_to_recordset(line_items) AS x(
            supplier_component_id integer,
            order_quantity numeric,
            component_id integer,
            quantity_for_order numeric,
            quantity_for_stock numeric
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
            actual_order_date,
            resolved_status_id,
            0,
            new_purchase_order_id
        FROM payload
        RETURNING supplier_orders.order_id, supplier_orders.supplier_component_id
    )
    SELECT array_agg(inserted.order_id) INTO inserted_ids FROM inserted;

    WITH payload AS (
        SELECT
            supplier_component_id,
            order_quantity,
            component_id,
            COALESCE(quantity_for_order, 0::numeric) AS quantity_for_order,
            COALESCE(quantity_for_stock, 0::numeric) AS quantity_for_stock
        FROM jsonb_to_recordset(line_items) AS x(
            supplier_component_id integer,
            order_quantity numeric,
            component_id integer,
            quantity_for_order numeric,
            quantity_for_stock numeric
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
        customer_order_id,
        payload.component_id,
        payload.quantity_for_order,
        payload.quantity_for_stock
    FROM supplier_orders so
    JOIN payload ON payload.supplier_component_id = so.supplier_component_id
    WHERE so.purchase_order_id = new_purchase_order_id;

    RETURN QUERY SELECT new_purchase_order_id, inserted_ids;
END;
$$;
