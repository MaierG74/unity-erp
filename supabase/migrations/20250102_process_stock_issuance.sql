-- Create a transactional RPC to process stock issuance
-- Creates OUT transaction, decrements inventory, and records issuance
-- Supports issuing stock against customer orders with optional purchase order linkage

-- First, ensure we have the necessary columns (add if they don't exist)
DO $$
BEGIN
  -- Add purchase_order_id if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'inventory_transactions' 
    AND column_name = 'purchase_order_id'
  ) THEN
    ALTER TABLE public.inventory_transactions 
    ADD COLUMN purchase_order_id bigint REFERENCES public.purchase_orders(purchase_order_id);
  END IF;

  -- Add supplier_order_id if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'inventory_transactions' 
    AND column_name = 'supplier_order_id'
  ) THEN
    ALTER TABLE public.inventory_transactions 
    ADD COLUMN supplier_order_id bigint REFERENCES public.supplier_orders(order_id);
  END IF;

  -- Add user_id if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'inventory_transactions' 
    AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.inventory_transactions 
    ADD COLUMN user_id uuid REFERENCES auth.users(id);
  END IF;

  -- Add reason if it doesn't exist (for adjustments/reversals)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'inventory_transactions' 
    AND column_name = 'reason'
  ) THEN
    ALTER TABLE public.inventory_transactions 
    ADD COLUMN reason text;
  END IF;
END $$;

-- Create stock issuance tracking table
CREATE TABLE IF NOT EXISTS public.stock_issuances (
  issuance_id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  order_id integer NOT NULL REFERENCES public.orders(order_id),
  transaction_id integer NOT NULL REFERENCES public.inventory_transactions(transaction_id),
  component_id integer NOT NULL REFERENCES public.components(component_id),
  quantity_issued numeric NOT NULL CHECK (quantity_issued > 0),
  issuance_date timestamptz NOT NULL DEFAULT now(),
  purchase_order_id bigint REFERENCES public.purchase_orders(purchase_order_id),
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create index for lookups
CREATE INDEX IF NOT EXISTS idx_stock_issuances_order_id ON public.stock_issuances(order_id);
CREATE INDEX IF NOT EXISTS idx_stock_issuances_component_id ON public.stock_issuances(component_id);
CREATE INDEX IF NOT EXISTS idx_stock_issuances_transaction_id ON public.stock_issuances(transaction_id);

-- Enable RLS
ALTER TABLE public.stock_issuances ENABLE ROW LEVEL SECURITY;

-- RLS Policy: authenticated users can view all issuances
CREATE POLICY stock_issuances_select_authenticated ON public.stock_issuances
  FOR SELECT
  TO authenticated
  USING (true);

-- RLS Policy: authenticated users can insert issuances
CREATE POLICY stock_issuances_insert_authenticated ON public.stock_issuances
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Main RPC function: process_stock_issuance
CREATE OR REPLACE FUNCTION public.process_stock_issuance(
  p_order_id integer,
  p_component_id integer,
  p_quantity numeric,
  p_purchase_order_id bigint DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_issuance_date timestamptz DEFAULT timezone('utc', now())
)
RETURNS TABLE (
  issuance_id bigint,
  transaction_id integer,
  quantity_on_hand numeric,
  success boolean,
  message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_component_id integer;
  v_sale_type_id integer;
  v_transaction_id integer;
  v_issuance_id bigint;
  v_quantity_on_hand numeric;
  v_user_id uuid;
  v_issuance_timestamp timestamptz := coalesce(p_issuance_date, timezone('utc', now()));
BEGIN
  -- Validate inputs
  IF p_order_id IS NULL THEN
    RETURN QUERY SELECT NULL::bigint, NULL::integer, NULL::numeric, false, 'Order ID is required'::text;
    RETURN;
  END IF;

  IF p_component_id IS NULL THEN
    RETURN QUERY SELECT NULL::bigint, NULL::integer, NULL::numeric, false, 'Component ID is required'::text;
    RETURN;
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN QUERY SELECT NULL::bigint, NULL::integer, NULL::numeric, false, 'Quantity must be greater than zero'::text;
    RETURN;
  END IF;

  -- Get current user
  v_user_id := auth.uid();

  -- Verify component exists
  SELECT component_id INTO v_component_id
  FROM components
  WHERE component_id = p_component_id;

  IF v_component_id IS NULL THEN
    RETURN QUERY SELECT NULL::bigint, NULL::integer, NULL::numeric, false, format('Component %s not found', p_component_id)::text;
    RETURN;
  END IF;

  -- Get or create SALE transaction type
  INSERT INTO transaction_types (type_name)
  VALUES ('SALE')
  ON CONFLICT (type_name) DO UPDATE SET type_name = excluded.type_name
  RETURNING transaction_type_id INTO v_sale_type_id;

  IF v_sale_type_id IS NULL THEN
    SELECT transaction_type_id
    INTO v_sale_type_id
    FROM transaction_types
    WHERE type_name = 'SALE';
  END IF;

  -- Lock inventory row for update to prevent race conditions
  SELECT inventory.quantity_on_hand
  INTO v_quantity_on_hand
  FROM inventory
  WHERE inventory.component_id = p_component_id
  FOR UPDATE;

  -- If no inventory record exists, create one with 0 quantity
  IF NOT FOUND THEN
    INSERT INTO inventory (
      component_id,
      quantity_on_hand,
      location,
      reorder_level
    )
    VALUES (
      p_component_id,
      0,
      NULL,
      0
    )
    RETURNING quantity_on_hand INTO v_quantity_on_hand;
  END IF;

  -- Check available inventory (allow negative if authorized - for now we'll warn but allow)
  -- Note: In the future, add authorization check here for negative inventory
  IF v_quantity_on_hand < p_quantity THEN
    -- Warning: issuing more than available, but proceed
    -- TODO: Add authorization check for negative inventory
  END IF;

  -- Create OUT transaction (negative quantity)
  INSERT INTO inventory_transactions (
    component_id,
    quantity,
    transaction_type_id,
    transaction_date,
    order_id,
    purchase_order_id,
    user_id
  )
  VALUES (
    p_component_id,
    -p_quantity,  -- Negative for OUT
    v_sale_type_id,
    v_issuance_timestamp,
    p_order_id,
    p_purchase_order_id,
    v_user_id
  )
  RETURNING transaction_id
  INTO v_transaction_id;

  -- Update inventory quantity_on_hand
  UPDATE inventory
  SET quantity_on_hand = coalesce(inventory.quantity_on_hand, 0) - p_quantity
  WHERE component_id = p_component_id
  RETURNING inventory.quantity_on_hand
  INTO v_quantity_on_hand;

  -- Create issuance record
  INSERT INTO stock_issuances (
    order_id,
    transaction_id,
    component_id,
    quantity_issued,
    issuance_date,
    purchase_order_id,
    notes,
    created_by
  )
  VALUES (
    p_order_id,
    v_transaction_id,
    p_component_id,
    p_quantity,
    v_issuance_timestamp,
    p_purchase_order_id,
    p_notes,
    v_user_id
  )
  RETURNING issuance_id
  INTO v_issuance_id;

  -- Return success
  RETURN QUERY SELECT
    v_issuance_id,
    v_transaction_id,
    v_quantity_on_hand,
    true,
    format('Successfully issued %s units of component %s', p_quantity, p_component_id)::text;
END;
$$;

COMMENT ON FUNCTION public.process_stock_issuance(integer, integer, numeric, bigint, text, timestamptz)
  IS 'Processes stock issuance: creates OUT transaction, decrements inventory, and records issuance atomically.';

GRANT EXECUTE ON FUNCTION public.process_stock_issuance(integer, integer, numeric, bigint, text, timestamptz)
  TO authenticated, service_role;

-- RPC function: reverse_stock_issuance (for partial reversal)
CREATE OR REPLACE FUNCTION public.reverse_stock_issuance(
  p_issuance_id bigint,
  p_quantity_to_reverse numeric,
  p_reason text DEFAULT NULL
)
RETURNS TABLE (
  reversal_transaction_id integer,
  quantity_on_hand numeric,
  success boolean,
  message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_issuance record;
  v_component_id integer;
  v_purchase_type_id integer;
  v_reversal_transaction_id integer;
  v_quantity_on_hand numeric;
  v_user_id uuid;
BEGIN
  -- Validate inputs
  IF p_issuance_id IS NULL THEN
    RETURN QUERY SELECT NULL::integer, NULL::numeric, false, 'Issuance ID is required'::text;
    RETURN;
  END IF;

  IF p_quantity_to_reverse IS NULL OR p_quantity_to_reverse <= 0 THEN
    RETURN QUERY SELECT NULL::integer, NULL::numeric, false, 'Quantity to reverse must be greater than zero'::text;
    RETURN;
  END IF;

  -- Get current user
  v_user_id := auth.uid();

  -- Get issuance details
  SELECT 
    si.issuance_id,
    si.transaction_id,
    si.component_id,
    si.quantity_issued,
    si.order_id,
    si.purchase_order_id,
    it.transaction_id as original_transaction_id
  INTO v_issuance
  FROM stock_issuances si
  JOIN inventory_transactions it ON it.transaction_id = si.transaction_id
  WHERE si.issuance_id = p_issuance_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::integer, NULL::numeric, false, format('Issuance %s not found', p_issuance_id)::text;
    RETURN;
  END IF;

  -- Validate reversal quantity doesn't exceed issued quantity
  IF p_quantity_to_reverse > v_issuance.quantity_issued THEN
    RETURN QUERY SELECT NULL::integer, NULL::numeric, false, 
      format('Cannot reverse %s units: only %s were issued', p_quantity_to_reverse, v_issuance.quantity_issued)::text;
    RETURN;
  END IF;

  v_component_id := v_issuance.component_id;

  -- Get or create PURCHASE transaction type (for reversal, we're bringing stock back IN)
  INSERT INTO transaction_types (type_name)
  VALUES ('PURCHASE')
  ON CONFLICT (type_name) DO UPDATE SET type_name = excluded.type_name
  RETURNING transaction_type_id INTO v_purchase_type_id;

  IF v_purchase_type_id IS NULL THEN
    SELECT transaction_type_id
    INTO v_purchase_type_id
    FROM transaction_types
    WHERE type_name = 'PURCHASE';
  END IF;

  -- Lock inventory row
  SELECT inventory.quantity_on_hand
  INTO v_quantity_on_hand
  FROM inventory
  WHERE inventory.component_id = v_component_id
  FOR UPDATE;

  -- Create reversal transaction (positive quantity, bringing stock back IN)
  INSERT INTO inventory_transactions (
    component_id,
    quantity,
    transaction_type_id,
    transaction_date,
    order_id,
    purchase_order_id,
    user_id,
    reason
  )
  VALUES (
    v_component_id,
    p_quantity_to_reverse,  -- Positive for reversal (IN)
    v_purchase_type_id,
    timezone('utc', now()),
    v_issuance.order_id,
    v_issuance.purchase_order_id,
    v_user_id,
    coalesce(p_reason, format('Reversal of issuance %s', p_issuance_id))
  )
  RETURNING transaction_id
  INTO v_reversal_transaction_id;

  -- Update inventory quantity_on_hand (add back the reversed quantity)
  UPDATE inventory
  SET quantity_on_hand = coalesce(inventory.quantity_on_hand, 0) + p_quantity_to_reverse
  WHERE inventory.component_id = v_component_id
  RETURNING inventory.quantity_on_hand
  INTO v_quantity_on_hand;

  -- Update issuance record to reflect reversal (track remaining issued quantity)
  -- Note: We don't delete the issuance, we just note the reversal
  -- Future: Could add a stock_issuance_reversals table for full audit trail

  -- Return success
  RETURN QUERY SELECT
    v_reversal_transaction_id,
    v_quantity_on_hand,
    true,
    format('Successfully reversed %s units from issuance %s', p_quantity_to_reverse, p_issuance_id)::text;
END;
$$;

COMMENT ON FUNCTION public.reverse_stock_issuance(bigint, numeric, text)
  IS 'Reverses a partial or full stock issuance by creating an IN transaction and updating inventory.';

GRANT EXECUTE ON FUNCTION public.reverse_stock_issuance(bigint, numeric, text)
  TO authenticated, service_role;

