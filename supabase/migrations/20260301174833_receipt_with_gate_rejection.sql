-- Extend process_supplier_order_receipt to handle gate rejections atomically.
-- Adds optional p_rejected_quantity and p_rejection_reason params.
-- When provided: only good qty goes to stock, allocations sum to good qty,
-- and the return record is created within the same transaction.

CREATE OR REPLACE FUNCTION public.process_supplier_order_receipt(
  p_order_id integer,
  p_quantity integer,
  p_receipt_date timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_allocation_receipts jsonb DEFAULT NULL::jsonb,
  p_rejected_quantity integer DEFAULT NULL::integer,
  p_rejection_reason text DEFAULT NULL::text
)
RETURNS TABLE(
  receipt_id bigint,
  transaction_id bigint,
  total_received integer,
  order_status_id integer,
  quantity_on_hand integer,
  return_id bigint,
  goods_return_number text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_order record;
  v_comp_id integer;
  v_purch_type_id integer;
  v_return_type_id integer;
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
  -- Gate rejection variables
  v_good_quantity integer;
  v_has_rejection boolean;
  v_return_txn_id integer;
  v_return_id bigint;
  v_grn text;
  v_current_user_id uuid := auth.uid();
BEGIN
  -- Compute rejection flag and good quantity
  v_has_rejection := COALESCE(p_rejected_quantity, 0) > 0;
  v_good_quantity := p_quantity - COALESCE(p_rejected_quantity, 0);

  -- Basic validation
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'process_supplier_order_receipt: order id is required';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'process_supplier_order_receipt: quantity must be greater than zero';
  END IF;

  IF v_has_rejection AND (p_rejection_reason IS NULL OR trim(p_rejection_reason) = '') THEN
    RAISE EXCEPTION 'process_supplier_order_receipt: rejection_reason is required when rejected_quantity > 0';
  END IF;

  IF v_good_quantity < 0 THEN
    RAISE EXCEPTION 'process_supplier_order_receipt: rejected_quantity % exceeds total quantity %',
      p_rejected_quantity, p_quantity;
  END IF;

  -- Lock and fetch the supplier order
  SELECT
    so.order_id,
    so.org_id,
    so.supplier_component_id,
    so.purchase_order_id,
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

  -- Over-receipt guard at PO-line level: net received BEFORE this receipt.
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

  -- Only good items count toward the order's capacity
  IF v_good_quantity > v_remaining THEN
    RAISE EXCEPTION 'process_supplier_order_receipt: quantity % exceeds remaining % for order %',
      v_good_quantity, v_remaining, p_order_id;
  END IF;

  -- Transaction type for PURCHASE
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

  -- Inventory transaction: only good items go to stock, with PO/SO traceability
  INSERT INTO inventory_transactions (
    component_id, quantity, transaction_type_id, transaction_date,
    supplier_order_id, purchase_order_id, user_id
  ) VALUES (
    v_comp_id, v_good_quantity, v_purch_type_id, v_receipt_ts,
    p_order_id, v_order.purchase_order_id, v_current_user_id
  )
  RETURNING inventory_transactions.transaction_id INTO v_txn_id;

  -- Receipt record stores p_quantity (gross) for audit trail
  INSERT INTO supplier_order_receipts (
    order_id, transaction_id, quantity_received, receipt_date
  ) VALUES (
    p_order_id, v_txn_id, p_quantity, v_receipt_ts
  )
  RETURNING * INTO v_new_receipt;

  -- ============================================================
  -- GATE REJECTION: create return record inline if applicable
  -- ============================================================
  IF v_has_rejection THEN
    -- Get RETURN transaction type for the negative inventory txn
    SELECT transaction_type_id INTO v_return_type_id
    FROM transaction_types WHERE type_name = 'RETURN' LIMIT 1;

    IF v_return_type_id IS NULL THEN
      INSERT INTO transaction_types (type_name)
      VALUES ('RETURN')
      ON CONFLICT (type_name) DO UPDATE SET type_name = EXCLUDED.type_name
      RETURNING transaction_type_id INTO v_return_type_id;
    END IF;

    -- Negative inventory transaction for rejected quantity with PO/SO references
    INSERT INTO inventory_transactions (
      component_id, quantity, transaction_type_id, transaction_date,
      supplier_order_id, purchase_order_id, user_id, reason
    ) VALUES (
      v_comp_id, -p_rejected_quantity, v_return_type_id, v_receipt_ts,
      p_order_id, v_order.purchase_order_id, v_current_user_id, p_rejection_reason
    )
    RETURNING inventory_transactions.transaction_id INTO v_return_txn_id;

    -- Generate GRN
    v_grn := generate_goods_return_number(v_order.purchase_order_id);

    -- Create the return record
    INSERT INTO supplier_order_returns (
      supplier_order_id,
      transaction_id,
      quantity_returned,
      return_date,
      reason,
      return_type,
      receipt_id,
      user_id,
      goods_return_number,
      org_id
    ) VALUES (
      p_order_id,
      v_return_txn_id,
      p_rejected_quantity,
      v_receipt_ts,
      p_rejection_reason,
      'rejection',
      v_new_receipt.receipt_id,
      v_current_user_id,
      v_grn,
      v_order.org_id
    )
    RETURNING supplier_order_returns.return_id INTO v_return_id;
  END IF;

  -- Lock allocation rows and count them.
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

    -- Allocation sum must equal good quantity (not gross)
    IF v_payload_sum <> v_good_quantity::numeric THEN
      RAISE EXCEPTION 'process_supplier_order_receipt: allocation quantity sum % must equal receipt quantity %',
        v_payload_sum, v_good_quantity;
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
    -- Single allocation: auto-apply good quantity (not gross)
    UPDATE supplier_order_customer_orders soco
    SET received_quantity = COALESCE(soco.received_quantity, 0) + v_good_quantity
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
    IF EXISTS (
      SELECT 1
      FROM supplier_order_customer_orders soco
      WHERE soco.supplier_order_id = p_order_id
        AND soco.received_quantity IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'process_supplier_order_receipt: allocation breakdown required (tracking already started)';
    END IF;
  END IF;

  -- Update inventory: only good items added to stock
  UPDATE inventory
  SET quantity_on_hand = COALESCE(inventory.quantity_on_hand, 0) + v_good_quantity
  WHERE inventory.component_id = v_comp_id
  RETURNING inventory.quantity_on_hand INTO v_qty_on_hand;

  IF NOT FOUND THEN
    INSERT INTO inventory (component_id, quantity_on_hand, location, reorder_level)
    VALUES (v_comp_id, v_good_quantity, NULL, 0)
    RETURNING inventory.quantity_on_hand INTO v_qty_on_hand;
  END IF;

  -- Recompute total_received accounting for all returns (including the one we just created)
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
    (COALESCE((SELECT total FROM receipt_total), 0) - COALESCE((SELECT total FROM return_total), 0))::integer
  INTO v_tot_received;

  -- Status update
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
    v_qty_on_hand,
    v_return_id,
    v_grn;
END;
$function$;
