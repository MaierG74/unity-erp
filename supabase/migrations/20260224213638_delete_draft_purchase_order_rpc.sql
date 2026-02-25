-- Migration: Atomic draft PO delete RPC
-- Date: February 24, 2026
-- Description: Atomically delete a draft purchase order and all related data.
-- Only works on Draft status POs. Deletes junction records, supplier orders,
-- activity log, and the PO itself in a single transaction.
-- Fixes P1 non-atomic multi-step delete pattern in purchase-orders/[id]/page.tsx.

CREATE OR REPLACE FUNCTION public.delete_draft_purchase_order(
    target_purchase_order_id integer
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    po_status text;
    order_ids integer[];
BEGIN
    -- Verify PO exists and is Draft
    SELECT sos.status_name INTO po_status
    FROM purchase_orders po
    JOIN supplier_order_statuses sos ON sos.status_id = po.status_id
    WHERE po.purchase_order_id = target_purchase_order_id;

    IF po_status IS NULL THEN
        RAISE EXCEPTION 'Purchase order % not found', target_purchase_order_id;
    END IF;

    IF po_status <> 'Draft' THEN
        RAISE EXCEPTION 'Can only delete Draft purchase orders (current status: %)', po_status;
    END IF;

    -- Collect supplier order IDs
    SELECT array_agg(order_id) INTO order_ids
    FROM supplier_orders
    WHERE purchase_order_id = target_purchase_order_id;

    -- Delete junction records
    IF order_ids IS NOT NULL AND array_length(order_ids, 1) > 0 THEN
        DELETE FROM supplier_order_customer_orders
        WHERE supplier_order_id = ANY(order_ids);

        -- Delete supplier orders
        DELETE FROM supplier_orders
        WHERE order_id = ANY(order_ids);
    END IF;

    -- Delete activity log
    DELETE FROM purchase_order_activity
    WHERE purchase_order_id = target_purchase_order_id;

    -- Delete the PO
    DELETE FROM purchase_orders
    WHERE purchase_order_id = target_purchase_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_draft_purchase_order(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_draft_purchase_order(integer) TO service_role;
