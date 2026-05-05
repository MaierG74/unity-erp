-- Add a reversal ledger so a stock issuance cannot be reversed repeatedly.

CREATE TABLE IF NOT EXISTS public.stock_issuance_reversals (
  reversal_id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  issuance_id bigint NOT NULL REFERENCES public.stock_issuances(issuance_id) ON DELETE RESTRICT,
  transaction_id integer NOT NULL UNIQUE REFERENCES public.inventory_transactions(transaction_id) ON DELETE RESTRICT,
  quantity_reversed numeric NOT NULL CHECK (quantity_reversed > 0),
  reason text,
  reversed_by uuid REFERENCES auth.users(id),
  reversed_at timestamp with time zone NOT NULL DEFAULT timezone('utc', now()),
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_stock_issuance_reversals_issuance_id
  ON public.stock_issuance_reversals (issuance_id);

ALTER TABLE public.stock_issuance_reversals ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.stock_issuance_reversals FROM anon, authenticated;

COMMENT ON TABLE public.stock_issuance_reversals
  IS 'Audit ledger of stock issuance reversal transactions. Written by reverse_stock_issuance to prevent duplicate/over reversals.';

COMMENT ON COLUMN public.stock_issuance_reversals.quantity_reversed
  IS 'Quantity restored to inventory by the reversal transaction.';

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
  v_already_reversed numeric;
  v_remaining_quantity numeric;
  v_reason text;
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
  WHERE si.issuance_id = p_issuance_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::integer, NULL::numeric, false,
      format('Issuance %s not found', p_issuance_id)::text;
    RETURN;
  END IF;

  SELECT coalesce(sum(sr.quantity_reversed), 0)
  INTO v_already_reversed
  FROM public.stock_issuance_reversals sr
  WHERE sr.issuance_id = p_issuance_id;

  v_remaining_quantity := v_issuance.quantity_issued - v_already_reversed;

  IF p_quantity_to_reverse > v_remaining_quantity THEN
    RETURN QUERY SELECT NULL::integer, NULL::numeric, false,
      format(
        'Cannot reverse %s units: only %s remain unreversed from %s issued',
        p_quantity_to_reverse,
        v_remaining_quantity,
        v_issuance.quantity_issued
      )::text;
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

  v_reason := CASE
    WHEN p_reason IS NULL OR btrim(p_reason) = '' THEN format('Reversal of issuance %s', p_issuance_id)
    ELSE format('Reversal of issuance %s: %s', p_issuance_id, p_reason)
  END;

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
    v_reason
  )
  RETURNING inventory_transactions.transaction_id INTO v_reversal_transaction_id;

  UPDATE public.inventory
  SET quantity_on_hand = coalesce(inventory.quantity_on_hand, 0) + p_quantity_to_reverse
  WHERE component_id = v_component_id
  RETURNING inventory.quantity_on_hand INTO v_quantity_on_hand;

  INSERT INTO public.stock_issuance_reversals (
    issuance_id,
    transaction_id,
    quantity_reversed,
    reason,
    reversed_by
  ) VALUES (
    p_issuance_id,
    v_reversal_transaction_id,
    p_quantity_to_reverse,
    v_reason,
    v_user_id
  );

  RETURN QUERY SELECT
    v_reversal_transaction_id,
    v_quantity_on_hand,
    true,
    format(
      'Successfully reversed %s units from issuance %s (%s remaining)',
      p_quantity_to_reverse,
      p_issuance_id,
      v_remaining_quantity - p_quantity_to_reverse
    )::text;
END;
$$;

COMMENT ON FUNCTION public.reverse_stock_issuance(bigint, numeric, text)
  IS 'Reverses a partial or full stock issuance by creating an IN transaction, updating inventory, and recording a reversal ledger row to prevent duplicate/over reversals.';

GRANT EXECUTE ON FUNCTION public.reverse_stock_issuance(bigint, numeric, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
