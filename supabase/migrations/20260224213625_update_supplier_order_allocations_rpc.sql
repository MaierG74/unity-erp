-- Migration: Atomic allocation update RPC
-- Date: February 24, 2026
-- Description: Atomically replace all allocations for a supplier order.
-- Deletes existing junction rows and inserts new ones in a single transaction.
-- Fixes P1 non-atomic delete-then-insert pattern in ForOrderEditPopover.

CREATE OR REPLACE FUNCTION public.update_supplier_order_allocations(
    target_supplier_order_id integer,
    new_allocations jsonb,  -- [{order_id: int|null, quantity_for_order: numeric, quantity_for_stock: numeric}]
    target_purchase_order_id integer DEFAULT NULL  -- for activity logging context
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    alloc jsonb;
BEGIN
    -- Delete all existing allocation records
    DELETE FROM supplier_order_customer_orders
    WHERE supplier_order_id = target_supplier_order_id;

    -- Insert new allocation records
    IF new_allocations IS NOT NULL AND jsonb_typeof(new_allocations) = 'array' AND jsonb_array_length(new_allocations) > 0 THEN
        FOR alloc IN SELECT * FROM jsonb_array_elements(new_allocations)
        LOOP
            INSERT INTO supplier_order_customer_orders (
                supplier_order_id, order_id, quantity_for_order, quantity_for_stock
            ) VALUES (
                target_supplier_order_id,
                (alloc->>'order_id')::integer,
                COALESCE((alloc->>'quantity_for_order')::numeric, 0),
                COALESCE((alloc->>'quantity_for_stock')::numeric, 0)
            );
        END LOOP;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_supplier_order_allocations(integer, jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_supplier_order_allocations(integer, jsonb, integer) TO service_role;
