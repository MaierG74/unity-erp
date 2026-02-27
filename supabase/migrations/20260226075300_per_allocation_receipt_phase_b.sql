-- Migration: Per-allocation receipt tracking (Phase B)
-- Date: February 25, 2026
-- Description: Enforce allocation breakdown payload for split PO lines.

CREATE OR REPLACE FUNCTION public.process_supplier_order_receipt(
    p_order_id integer,
    p_quantity integer,
    p_receipt_date timestamptz DEFAULT NULL,
    p_allocation_receipts jsonb DEFAULT NULL
) RETURNS TABLE (
    receipt_id bigint,
    transaction_id bigint,
    total_received integer,
    order_status_id integer,
    quantity_on_hand integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_comp_id integer;
  v_purch_type_id integer;
  v_txn_id bigint;
  v_new_receipt supplier_order_receipts%rowtype;
  v_qty_on_hand integer;
  v_tot_received integer;
  v_net_received_before integer;
  v_remaining integer;
  v_new_stat_id integer;
  v_comp_stat_id integer;
  v_part_stat_id integer;
  v_receipt_ts timestamptz := COALESCE(p_receipt_date, timezone('utc', now()));
  v_alloc_count integer := 0;
  v_payload_count integer := 0;
  v_payload_distinct_count integer := 0;
  v_payload_sum numeric := 0;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'process_supplier_order_receipt: order id is required';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'process_supplier_order_receipt: quantity must be greater than zero';
  END IF;

  SELECT
    so.order_id,
    so.org_id,
    so.supplier_component_id,
    COALESCE(so.order_quantity, 0) AS order_quantity,
    COALESCE(so.total_received, 0) AS total_received,
    so.status_id
  INTO v_order
  FROM supplier_orders so
  WHERE so.order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_supplier_order_receipt: supplier order % not found', p_order_id;
  END IF;

  IF v_order.org_id IS NOT NULL AND auth.role() <> 'service_role' AND NOT is_org_member(v_order.org_id) THEN
    RAISE EXCEPTION 'process_supplier_order_receipt: access denied';
  END IF;

  IF v_order.supplier_component_id IS NULL THEN
    RAISE EXCEPTION 'process_supplier_order_receipt: supplier order % is missing supplier component id', p_order_id;
  END IF;

  SELECT sc.component_id
  INTO v_comp_id
  FROM suppliercomponents sc
  WHERE sc.supplier_component_id = v_order.supplier_component_id;

  IF v_comp_id IS NULL THEN
    RAISE EXCEPTION 'process_supplier_order_receipt: component for supplier component % not found', v_order.supplier_component_id;
  END IF;

  WITH receipt_total AS (
    SELECT COALESCE(SUM(quantity_received), 0) AS total
    FROM supplier_order_receipts
    WHERE supplier_order_receipts.order_id = p_order_id
  ),
  return_total AS (
    SELECT COALESCE(SUM(quantity_returned), 0) AS total
    FROM supplier_order_returns
    WHERE supplier_order_returns.supplier_order_id = p_order_id
  )
  SELECT
    COALESCE((SELECT total FROM receipt_total), 0) - COALESCE((SELECT total FROM return_total), 0)
  INTO v_net_received_before;

  v_remaining := GREATEST(v_order.order_quantity - v_net_received_before, 0);

  IF p_quantity > v_remaining THEN
    RAISE EXCEPTION 'process_supplier_order_receipt: quantity % exceeds remaining % for order %',
      p_quantity, v_remaining, p_order_id;
  END IF;

  INSERT INTO transaction_types (type_name)
  VALUES ('PURCHASE')
  ON CONFLICT (type_name) DO UPDATE SET type_name = EXCLUDED.type_name
  RETURNING transaction_types.transaction_type_id INTO v_purch_type_id;

  IF v_purch_type_id IS NULL THEN
    SELECT transaction_types.transaction_type_id
    INTO v_purch_type_id
    FROM transaction_types
    WHERE transaction_types.type_name = 'PURCHASE';
  END IF;

  INSERT INTO inventory_transactions (
    component_id, quantity, transaction_type_id, transaction_date
  ) VALUES (
    v_comp_id, p_quantity, v_purch_type_id, v_receipt_ts
  )
  RETURNING inventory_transactions.transaction_id INTO v_txn_id;

  INSERT INTO supplier_order_receipts (
    order_id, transaction_id, quantity_received, receipt_date
  ) VALUES (
    p_order_id, v_txn_id, p_quantity, v_receipt_ts
  )
  RETURNING * INTO v_new_receipt;

  SELECT COUNT(*)
  INTO v_alloc_count
  FROM (
    SELECT 1
    FROM supplier_order_customer_orders
    WHERE supplier_order_id = p_order_id
    FOR UPDATE
  ) locked_allocs;

  IF p_allocation_receipts IS NOT NULL THEN
    IF jsonb_typeof(p_allocation_receipts) <> 'array' OR jsonb_array_length(p_allocation_receipts) = 0 THEN
      RAISE EXCEPTION 'process_supplier_order_receipt: allocation payload must be a non-empty array';
    END IF;

    SELECT
      COUNT(*)::integer,
      COUNT(DISTINCT p.allocation_id)::integer,
      COALESCE(SUM(p.quantity), 0)
    INTO v_payload_count, v_payload_distinct_count, v_payload_sum
    FROM (
      SELECT
        (elem->>'allocation_id')::integer AS allocation_id,
        (elem->>'quantity')::numeric AS quantity
      FROM jsonb_array_elements(p_allocation_receipts) elem
    ) p;

    IF v_payload_count <> v_payload_distinct_count THEN
      RAISE EXCEPTION 'process_supplier_order_receipt: duplicate allocation_id in payload';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM (
        SELECT (elem->>'quantity')::numeric AS quantity
        FROM jsonb_array_elements(p_allocation_receipts) elem
      ) p
      WHERE p.quantity IS NULL OR p.quantity <= 0
    ) THEN
      RAISE EXCEPTION 'process_supplier_order_receipt: each allocation quantity must be greater than zero';
    END IF;

    IF v_payload_sum <> p_quantity::numeric THEN
      RAISE EXCEPTION 'process_supplier_order_receipt: allocation quantity sum % must equal receipt quantity %',
        v_payload_sum, p_quantity;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM (
        SELECT (elem->>'allocation_id')::integer AS allocation_id
        FROM jsonb_array_elements(p_allocation_receipts) elem
      ) p
      LEFT JOIN supplier_order_customer_orders soco
        ON soco.id = p.allocation_id
       AND soco.supplier_order_id = p_order_id
      WHERE soco.id IS NULL
    ) THEN
      RAISE EXCEPTION 'process_supplier_order_receipt: allocation payload contains rows not tied to order %', p_order_id;
    END IF;

    UPDATE supplier_order_customer_orders soco
    SET received_quantity = COALESCE(soco.received_quantity, 0) + p.quantity
    FROM (
      SELECT
        (elem->>'allocation_id')::integer AS allocation_id,
        (elem->>'quantity')::numeric AS quantity
      FROM jsonb_array_elements(p_allocation_receipts) elem
    ) p
    WHERE soco.id = p.allocation_id
      AND soco.supplier_order_id = p_order_id;

    IF EXISTS (
      SELECT 1
      FROM supplier_order_customer_orders soco
      WHERE soco.supplier_order_id = p_order_id
        AND soco.received_quantity IS NOT NULL
        AND soco.received_quantity > CASE
          WHEN soco.order_id IS NULL THEN COALESCE(soco.quantity_for_stock, 0)
          ELSE COALESCE(soco.quantity_for_order, 0)
        END
    ) THEN
      RAISE EXCEPTION 'process_supplier_order_receipt: receipt exceeds allocation cap';
    END IF;
  ELSIF v_alloc_count = 1 THEN
    UPDATE supplier_order_customer_orders soco
    SET received_quantity = COALESCE(soco.received_quantity, 0) + p_quantity
    WHERE soco.supplier_order_id = p_order_id;

    IF EXISTS (
      SELECT 1
      FROM supplier_order_customer_orders soco
      WHERE soco.supplier_order_id = p_order_id
        AND soco.received_quantity IS NOT NULL
        AND soco.received_quantity > CASE
          WHEN soco.order_id IS NULL THEN COALESCE(soco.quantity_for_stock, 0)
          ELSE COALESCE(soco.quantity_for_order, 0)
        END
    ) THEN
      RAISE EXCEPTION 'process_supplier_order_receipt: receipt exceeds allocation cap';
    END IF;
  ELSIF v_alloc_count > 1 THEN
    -- Phase B enforcement: split lines require explicit allocation payload.
    RAISE EXCEPTION 'process_supplier_order_receipt: split line requires allocation breakdown';
  END IF;

  UPDATE inventory
  SET quantity_on_hand = COALESCE(inventory.quantity_on_hand, 0) + p_quantity
  WHERE inventory.component_id = v_comp_id
  RETURNING inventory.quantity_on_hand INTO v_qty_on_hand;

  IF NOT FOUND THEN
    INSERT INTO inventory (component_id, quantity_on_hand, location, reorder_level)
    VALUES (v_comp_id, p_quantity, NULL, 0)
    RETURNING inventory.quantity_on_hand INTO v_qty_on_hand;
  END IF;

  v_tot_received := v_net_received_before + p_quantity;

  SELECT supplier_order_statuses.status_id INTO v_comp_stat_id
  FROM supplier_order_statuses
  WHERE lower(supplier_order_statuses.status_name) = 'fully received'
  LIMIT 1;

  SELECT supplier_order_statuses.status_id INTO v_part_stat_id
  FROM supplier_order_statuses
  WHERE lower(supplier_order_statuses.status_name) = 'partially received'
  LIMIT 1;

  v_new_stat_id := v_order.status_id;

  IF v_tot_received >= v_order.order_quantity AND v_comp_stat_id IS NOT NULL THEN
    v_new_stat_id := v_comp_stat_id;
  ELSIF v_tot_received > 0 AND v_part_stat_id IS NOT NULL THEN
    v_new_stat_id := v_part_stat_id;
  END IF;

  UPDATE supplier_orders
  SET total_received = v_tot_received,
      status_id = v_new_stat_id
  WHERE supplier_orders.order_id = p_order_id;

  RETURN QUERY
  SELECT
    v_new_receipt.receipt_id,
    v_txn_id,
    v_tot_received,
    v_new_stat_id,
    v_qty_on_hand;
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_supplier_order_receipt(integer, integer, timestamptz, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_supplier_order_receipt(integer, integer, timestamptz, jsonb) TO service_role;
