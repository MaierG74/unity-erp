-- Create supplier_order_returns table
CREATE TABLE IF NOT EXISTS public.supplier_order_returns (
    return_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    supplier_order_id bigint NOT NULL REFERENCES public.supplier_orders(order_id),
    transaction_id integer NOT NULL REFERENCES public.inventory_transactions(transaction_id),
    quantity_returned numeric NOT NULL,
    return_date timestamp with time zone NOT NULL DEFAULT now(),
    reason text NOT NULL,
    return_type text NOT NULL CHECK (return_type IN ('rejection', 'later_return')),
    receipt_id bigint REFERENCES public.supplier_order_receipts(receipt_id),
    user_id uuid REFERENCES auth.users(id),
    notes text,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.supplier_order_returns ENABLE ROW LEVEL SECURITY;

-- Basic RLS policy (authenticated users can read, service_role can do anything)
CREATE POLICY "Enable read access for authenticated users" ON public.supplier_order_returns
    FOR SELECT TO authenticated USING (true);

-- Create RPC function to process returns atomically
CREATE OR REPLACE FUNCTION public.process_supplier_order_return(
    p_supplier_order_id bigint,
    p_quantity numeric,
    p_reason text,
    p_return_type text DEFAULT 'later_return',
    p_notes text DEFAULT NULL,
    p_receipt_id bigint DEFAULT NULL,
    p_return_date timestamptz DEFAULT timezone('utc', now())
)
RETURNS table (
    return_id bigint,
    transaction_id integer,
    total_received numeric,
    order_status_id integer,
    quantity_on_hand numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order record;
    v_component_id integer;
    v_sale_type_id integer;
    v_transaction_id integer;
    v_return_id bigint;
    v_quantity_on_hand numeric;
    v_total_received numeric;
    v_new_status_id integer;
    v_approved_status_id integer;
    v_partial_status_id integer;
    v_completed_status_id integer;
    v_return_timestamp timestamptz := coalesce(p_return_date, timezone('utc', now()));
    v_current_user_id uuid := auth.uid();
BEGIN
    -- 1. Validation
    IF p_supplier_order_id IS NULL THEN
        RAISE EXCEPTION 'process_supplier_order_return: supplier order id is required';
    END IF;

    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        RAISE EXCEPTION 'process_supplier_order_return: quantity must be greater than zero';
    END IF;

    -- Lock the order row
    SELECT
        so.order_id,
        so.supplier_component_id,
        coalesce(so.order_quantity, 0) as order_quantity,
        coalesce(so.total_received, 0) as total_received,
        so.status_id
    INTO v_order
    FROM supplier_orders so
    WHERE so.order_id = p_supplier_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'process_supplier_order_return: supplier order % not found', p_supplier_order_id;
    END IF;

    IF p_quantity > v_order.total_received THEN
        RAISE EXCEPTION 'process_supplier_order_return: cannot return % which is more than received quantity %',
            p_quantity, v_order.total_received;
    END IF;

    -- 2. Get component id
    SELECT sc.component_id
    INTO v_component_id
    FROM suppliercomponents sc
    WHERE sc.supplier_component_id = v_order.supplier_component_id;

    IF v_component_id IS NULL THEN
        RAISE EXCEPTION 'process_supplier_order_return: component for supplier component % not found', v_order.supplier_component_id;
    END IF;

    -- 3. Ensure transaction type exists (SALE = 2 used for OUT)
    SELECT transaction_type_id INTO v_sale_type_id FROM transaction_types WHERE type_name = 'SALE' LIMIT 1;
    IF v_sale_type_id IS NULL THEN
        INSERT INTO transaction_types (type_name) VALUES ('SALE') ON CONFLICT (type_name) DO UPDATE SET type_name = EXCLUDED.type_name RETURNING transaction_type_id INTO v_sale_type_id;
    END IF;

    -- 4. Create OUT transaction (negative quantity)
    INSERT INTO inventory_transactions (
        component_id,
        quantity,
        transaction_type_id,
        transaction_date
    )
    VALUES (
        v_component_id,
        -p_quantity,
        v_sale_type_id,
        v_return_timestamp
    )
    RETURNING transaction_id INTO v_transaction_id;

    -- 5. Create return record
    INSERT INTO supplier_order_returns (
        supplier_order_id,
        transaction_id,
        quantity_returned,
        return_date,
        reason,
        return_type,
        receipt_id,
        user_id,
        notes
    )
    VALUES (
        p_supplier_order_id,
        v_transaction_id,
        p_quantity,
        v_return_timestamp,
        p_reason,
        p_return_type,
        p_receipt_id,
        v_current_user_id,
        p_notes
    )
    RETURNING return_id INTO v_return_id;

    -- 6. Update inventory
    UPDATE inventory
    SET quantity_on_hand = coalesce(quantity_on_hand, 0) - p_quantity
    WHERE component_id = v_component_id
    RETURNING quantity_on_hand INTO v_quantity_on_hand;

    -- 7. Update supplier order
    v_total_received := v_order.total_received - p_quantity;

    -- Determine new status
    SELECT status_id INTO v_approved_status_id FROM supplier_order_statuses WHERE lower(status_name) = 'approved' LIMIT 1;
    SELECT status_id INTO v_partial_status_id FROM supplier_order_statuses WHERE lower(status_name) = 'partially received' LIMIT 1;
    SELECT status_id INTO v_completed_status_id FROM supplier_order_statuses WHERE lower(status_name) = 'fully received' LIMIT 1;

    v_new_status_id := v_order.status_id;
    
    IF v_total_received <= 0 THEN
        v_new_status_id := coalesce(v_approved_status_id, v_order.status_id);
    ELSIF v_total_received < v_order.order_quantity THEN
        v_new_status_id := coalesce(v_partial_status_id, v_order.status_id);
    ELSE
        v_new_status_id := coalesce(v_completed_status_id, v_order.status_id);
    END IF;

    UPDATE supplier_orders
    SET total_received = v_total_received,
        status_id = v_new_status_id
    WHERE order_id = p_supplier_order_id;

    -- 8. Return results
    RETURN QUERY
    SELECT
        v_return_id,
        v_transaction_id,
        v_total_received,
        v_new_status_id,
        v_quantity_on_hand;
END;
$$;

COMMENT ON FUNCTION public.process_supplier_order_return(bigint, numeric, text, text, text, bigint, timestamptz)
    IS 'Processes a supplier order return: creates an OUT inventory transaction, records the return, updates inventory on-hand, and updates supplier order totals/status atomically.';

GRANT EXECUTE ON FUNCTION public.process_supplier_order_return(bigint, numeric, text, text, text, bigint, timestamptz)
    TO authenticated, service_role;
