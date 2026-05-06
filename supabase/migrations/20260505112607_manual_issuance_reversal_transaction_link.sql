-- Fix manual issuance reversals for rows whose stock_issuances.transaction_id is NULL.
-- Legacy manual issuance writers inserted stock_issuances before inventory_transactions
-- and never backfilled the transaction_id, which made reverse_stock_issuance's inner
-- join reject visible manual issuance rows as "not found".

CREATE OR REPLACE FUNCTION public.process_manual_stock_issuance(
  p_component_id integer,
  p_quantity numeric,
  p_notes text DEFAULT NULL::text,
  p_external_reference text DEFAULT NULL::text,
  p_issue_category text DEFAULT 'production'::text,
  p_staff_id integer DEFAULT NULL::integer,
  p_issuance_date timestamp with time zone DEFAULT now()
)
RETURNS TABLE (
  issuance_id integer,
  transaction_id integer,
  quantity_on_hand numeric,
  success boolean,
  message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_issuance_id integer;
  v_transaction_id integer;
  v_current_quantity numeric;
  v_new_quantity numeric;
  v_inventory_id integer;
  v_transaction_type_id integer;
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN QUERY SELECT NULL::integer, NULL::integer, NULL::numeric, false,
      'Quantity must be greater than zero'::text;
    RETURN;
  END IF;

  IF p_external_reference IS NULL OR btrim(p_external_reference) = '' THEN
    RETURN QUERY SELECT NULL::integer, NULL::integer, NULL::numeric, false,
      'External reference is required for manual issuances'::text;
    RETURN;
  END IF;

  SELECT i.inventory_id, i.quantity_on_hand
  INTO v_inventory_id, v_current_quantity
  FROM public.inventory i
  WHERE i.component_id = p_component_id
  FOR UPDATE;

  IF v_inventory_id IS NULL THEN
    RETURN QUERY SELECT NULL::integer, NULL::integer, NULL::numeric, false,
      'Component not found in inventory'::text;
    RETURN;
  END IF;

  IF v_current_quantity < p_quantity THEN
    RETURN QUERY SELECT NULL::integer, NULL::integer, v_current_quantity, false,
      format('Insufficient stock. Available: %s, Requested: %s', v_current_quantity, p_quantity)::text;
    RETURN;
  END IF;

  INSERT INTO public.transaction_types (type_name)
  VALUES ('ISSUE')
  ON CONFLICT (type_name) DO UPDATE SET type_name = excluded.type_name
  RETURNING transaction_type_id INTO v_transaction_type_id;

  v_new_quantity := v_current_quantity - p_quantity;

  INSERT INTO public.inventory_transactions (
    component_id,
    transaction_type_id,
    quantity,
    transaction_date,
    reason,
    user_id
  ) VALUES (
    p_component_id,
    v_transaction_type_id,
    -p_quantity,
    p_issuance_date,
    coalesce(p_notes, 'Manual issuance: ' || p_external_reference),
    v_user_id
  )
  RETURNING inventory_transactions.transaction_id INTO v_transaction_id;

  INSERT INTO public.stock_issuances (
    component_id,
    order_id,
    transaction_id,
    quantity_issued,
    issuance_date,
    notes,
    created_by,
    staff_id,
    external_reference,
    issue_category
  ) VALUES (
    p_component_id,
    NULL,
    v_transaction_id,
    p_quantity,
    p_issuance_date,
    p_notes,
    v_user_id,
    p_staff_id,
    p_external_reference,
    p_issue_category
  )
  RETURNING stock_issuances.issuance_id::integer INTO v_issuance_id;

  UPDATE public.inventory
  SET quantity_on_hand = v_new_quantity
  WHERE inventory_id = v_inventory_id;

  RETURN QUERY SELECT v_issuance_id, v_transaction_id, v_new_quantity, true,
    'Stock issued successfully'::text;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT NULL::integer, NULL::integer, NULL::numeric, false, SQLERRM::text;
END;
$$;

COMMENT ON FUNCTION public.process_manual_stock_issuance(integer, numeric, text, text, text, integer, timestamp with time zone)
  IS 'Processes manual stock issuance and links the stock_issuances audit row to the generated inventory transaction.';

GRANT EXECUTE ON FUNCTION public.process_manual_stock_issuance(integer, numeric, text, text, text, integer, timestamp with time zone)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reverse_stock_issuance(
  p_issuance_id bigint,
  p_quantity_to_reverse numeric,
  p_reason text DEFAULT NULL::text
)
RETURNS TABLE (
  reversal_transaction_id integer,
  quantity_on_hand numeric,
  success boolean,
  message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_issuance record;
  v_component_id integer;
  v_purchase_type_id integer;
  v_reversal_transaction_id integer;
  v_quantity_on_hand numeric;
  v_user_id uuid;
BEGIN
  IF p_issuance_id IS NULL THEN
    RETURN QUERY SELECT NULL::integer, NULL::numeric, false, 'Issuance ID is required'::text;
    RETURN;
  END IF;

  IF p_quantity_to_reverse IS NULL OR p_quantity_to_reverse <= 0 THEN
    RETURN QUERY SELECT NULL::integer, NULL::numeric, false, 'Quantity to reverse must be greater than zero'::text;
    RETURN;
  END IF;

  v_user_id := auth.uid();

  SELECT
    si.issuance_id,
    si.transaction_id,
    si.component_id,
    si.quantity_issued,
    si.order_id,
    si.purchase_order_id
  INTO v_issuance
  FROM public.stock_issuances si
  WHERE si.issuance_id = p_issuance_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::integer, NULL::numeric, false,
      format('Issuance %s not found', p_issuance_id)::text;
    RETURN;
  END IF;

  IF p_quantity_to_reverse > v_issuance.quantity_issued THEN
    RETURN QUERY SELECT NULL::integer, NULL::numeric, false,
      format('Cannot reverse %s units: only %s were issued', p_quantity_to_reverse, v_issuance.quantity_issued)::text;
    RETURN;
  END IF;

  v_component_id := v_issuance.component_id;

  INSERT INTO public.transaction_types (type_name)
  VALUES ('PURCHASE')
  ON CONFLICT (type_name) DO UPDATE SET type_name = excluded.type_name
  RETURNING transaction_type_id INTO v_purchase_type_id;

  SELECT i.quantity_on_hand
  INTO v_quantity_on_hand
  FROM public.inventory i
  WHERE i.component_id = v_component_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::integer, NULL::numeric, false,
      format('Inventory record for component %s not found', v_component_id)::text;
    RETURN;
  END IF;

  INSERT INTO public.inventory_transactions (
    component_id,
    quantity,
    transaction_type_id,
    transaction_date,
    order_id,
    purchase_order_id,
    user_id,
    reason
  ) VALUES (
    v_component_id,
    p_quantity_to_reverse,
    v_purchase_type_id,
    timezone('utc', now()),
    v_issuance.order_id,
    v_issuance.purchase_order_id,
    v_user_id,
    coalesce(p_reason, format('Reversal of issuance %s', p_issuance_id))
  )
  RETURNING inventory_transactions.transaction_id INTO v_reversal_transaction_id;

  UPDATE public.inventory
  SET quantity_on_hand = coalesce(inventory.quantity_on_hand, 0) + p_quantity_to_reverse
  WHERE component_id = v_component_id
  RETURNING inventory.quantity_on_hand INTO v_quantity_on_hand;

  RETURN QUERY SELECT
    v_reversal_transaction_id,
    v_quantity_on_hand,
    true,
    format('Successfully reversed %s units from issuance %s', p_quantity_to_reverse, p_issuance_id)::text;
END;
$$;

COMMENT ON FUNCTION public.reverse_stock_issuance(bigint, numeric, text)
  IS 'Reverses a partial or full stock issuance by creating an IN transaction and updating inventory; supports legacy manual issuance rows with NULL transaction_id.';

GRANT EXECUTE ON FUNCTION public.reverse_stock_issuance(bigint, numeric, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
