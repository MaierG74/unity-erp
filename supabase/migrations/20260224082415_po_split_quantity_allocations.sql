-- Migration: PO Split Quantity Allocations
-- Date: February 23, 2026
-- Description: Update RPC functions to support splitting a line item's quantity
-- across multiple customer orders via an optional `allocations` JSONB array.
-- Backward compatible: if allocations is absent, uses existing single-record behavior.

-- Drop old signature to avoid overload conflicts
DROP FUNCTION IF EXISTS public.create_purchase_order_with_lines(integer, jsonb, integer, timestamptz, text);

CREATE OR REPLACE FUNCTION public.create_purchase_order_with_lines(
    supplier_id integer,
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
    inserted_ids integer[] := '{}';
    line jsonb;
    new_order_id integer;
    alloc jsonb;
    alloc_sum numeric;
    line_qty numeric;
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

    FOR line IN SELECT * FROM jsonb_array_elements(line_items)
    LOOP
        -- Insert supplier order line
        INSERT INTO supplier_orders (
            supplier_component_id, order_quantity, order_date,
            status_id, total_received, purchase_order_id
        ) VALUES (
            (line->>'supplier_component_id')::integer,
            (line->>'order_quantity')::numeric,
            actual_order_date,
            resolved_status_id,
            0,
            new_purchase_order_id
        ) RETURNING supplier_orders.order_id INTO new_order_id;

        inserted_ids := inserted_ids || new_order_id;
        line_qty := (line->>'order_quantity')::numeric;

        -- Check for multi-order allocations array
        IF line ? 'allocations' AND jsonb_typeof(line->'allocations') = 'array'
           AND jsonb_array_length(line->'allocations') > 0 THEN

            alloc_sum := 0;
            FOR alloc IN SELECT * FROM jsonb_array_elements(line->'allocations')
            LOOP
                alloc_sum := alloc_sum + (alloc->>'quantity_for_order')::numeric;
            END LOOP;

            -- Guard: reject over-allocation
            IF alloc_sum > line_qty THEN
                RAISE EXCEPTION 'Allocation total (%) exceeds line quantity (%) for supplier_component_id %',
                    alloc_sum, line_qty, (line->>'supplier_component_id');
            END IF;

            -- Now insert the allocation rows
            FOR alloc IN SELECT * FROM jsonb_array_elements(line->'allocations')
            LOOP
                INSERT INTO supplier_order_customer_orders (
                    supplier_order_id, order_id, component_id,
                    quantity_for_order, quantity_for_stock
                ) VALUES (
                    new_order_id,
                    (alloc->>'customer_order_id')::integer,
                    (line->>'component_id')::integer,
                    (alloc->>'quantity_for_order')::numeric,
                    0
                );
            END LOOP;

            -- Remaining quantity goes to stock
            IF alloc_sum < line_qty THEN
                INSERT INTO supplier_order_customer_orders (
                    supplier_order_id, order_id, component_id,
                    quantity_for_order, quantity_for_stock
                ) VALUES (
                    new_order_id,
                    NULL,
                    (line->>'component_id')::integer,
                    0,
                    line_qty - alloc_sum
                );
            END IF;
        ELSE
            -- Legacy single-record behavior
            INSERT INTO supplier_order_customer_orders (
                supplier_order_id, order_id, component_id,
                quantity_for_order, quantity_for_stock
            ) VALUES (
                new_order_id,
                (line->>'customer_order_id')::integer,
                (line->>'component_id')::integer,
                COALESCE((line->>'quantity_for_order')::numeric, 0),
                COALESCE((line->>'quantity_for_stock')::numeric, 0)
            );
        END IF;
    END LOOP;

    -- Insert line notes into supplier_orders if present
    FOR line IN SELECT * FROM jsonb_array_elements(line_items)
    LOOP
        IF line->>'line_notes' IS NOT NULL AND line->>'line_notes' <> '' THEN
            UPDATE supplier_orders
            SET notes = line->>'line_notes'
            WHERE purchase_order_id = new_purchase_order_id
              AND supplier_component_id = (line->>'supplier_component_id')::integer;
        END IF;
    END LOOP;

    RETURN QUERY SELECT new_purchase_order_id, inserted_ids;
END;
$$;


-- Update add_lines_to_purchase_order with the same allocations support
DROP FUNCTION IF EXISTS public.add_lines_to_purchase_order(integer, jsonb);

CREATE OR REPLACE FUNCTION public.add_lines_to_purchase_order(
    target_purchase_order_id integer,
    line_items jsonb
) RETURNS TABLE(supplier_order_ids integer[])
LANGUAGE plpgsql
AS $$
DECLARE
    po_status_id integer;
    po_order_date timestamptz;
    inserted_ids integer[] := '{}';
    line jsonb;
    new_order_id integer;
    alloc jsonb;
    alloc_sum numeric;
    line_qty numeric;
BEGIN
    IF line_items IS NULL OR jsonb_typeof(line_items) <> 'array' OR jsonb_array_length(line_items) = 0 THEN
        RAISE EXCEPTION 'line_items payload must be a non-empty array';
    END IF;

    SELECT po.status_id, po.order_date
    INTO po_status_id, po_order_date
    FROM purchase_orders po
    WHERE po.purchase_order_id = target_purchase_order_id;

    IF po_status_id IS NULL THEN
        RAISE EXCEPTION 'Purchase order % not found', target_purchase_order_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM supplier_order_statuses
        WHERE supplier_order_statuses.status_id = po_status_id AND status_name = 'Draft'
    ) THEN
        RAISE EXCEPTION 'Can only add lines to Draft purchase orders';
    END IF;

    FOR line IN SELECT * FROM jsonb_array_elements(line_items)
    LOOP
        INSERT INTO supplier_orders (
            supplier_component_id, order_quantity, order_date,
            status_id, total_received, purchase_order_id
        ) VALUES (
            (line->>'supplier_component_id')::integer,
            (line->>'order_quantity')::numeric,
            po_order_date,
            po_status_id,
            0,
            target_purchase_order_id
        ) RETURNING supplier_orders.order_id INTO new_order_id;

        inserted_ids := inserted_ids || new_order_id;
        line_qty := (line->>'order_quantity')::numeric;

        IF line ? 'allocations' AND jsonb_typeof(line->'allocations') = 'array'
           AND jsonb_array_length(line->'allocations') > 0 THEN

            alloc_sum := 0;
            FOR alloc IN SELECT * FROM jsonb_array_elements(line->'allocations')
            LOOP
                alloc_sum := alloc_sum + (alloc->>'quantity_for_order')::numeric;
            END LOOP;

            -- Guard: reject over-allocation
            IF alloc_sum > line_qty THEN
                RAISE EXCEPTION 'Allocation total (%) exceeds line quantity (%) for supplier_component_id %',
                    alloc_sum, line_qty, (line->>'supplier_component_id');
            END IF;

            FOR alloc IN SELECT * FROM jsonb_array_elements(line->'allocations')
            LOOP
                INSERT INTO supplier_order_customer_orders (
                    supplier_order_id, order_id, component_id,
                    quantity_for_order, quantity_for_stock
                ) VALUES (
                    new_order_id,
                    (alloc->>'customer_order_id')::integer,
                    (line->>'component_id')::integer,
                    (alloc->>'quantity_for_order')::numeric,
                    0
                );
            END LOOP;

            IF alloc_sum < line_qty THEN
                INSERT INTO supplier_order_customer_orders (
                    supplier_order_id, order_id, component_id,
                    quantity_for_order, quantity_for_stock
                ) VALUES (
                    new_order_id,
                    NULL,
                    (line->>'component_id')::integer,
                    0,
                    line_qty - alloc_sum
                );
            END IF;
        ELSE
            INSERT INTO supplier_order_customer_orders (
                supplier_order_id, order_id, component_id,
                quantity_for_order, quantity_for_stock
            ) VALUES (
                new_order_id,
                (line->>'customer_order_id')::integer,
                (line->>'component_id')::integer,
                COALESCE((line->>'quantity_for_order')::numeric, 0),
                COALESCE((line->>'quantity_for_stock')::numeric, 0)
            );
        END IF;

        -- Update line notes if present
        IF line->>'line_notes' IS NOT NULL AND line->>'line_notes' <> '' THEN
            UPDATE supplier_orders
            SET notes = line->>'line_notes'
            WHERE order_id = new_order_id;
        END IF;
    END LOOP;

    RETURN QUERY SELECT inserted_ids;
END;
$$;
