-- 1. Add TRANSFER transaction type
INSERT INTO public.transaction_types (type_name)
SELECT 'TRANSFER'
WHERE NOT EXISTS (
  SELECT 1 FROM public.transaction_types WHERE type_name = 'TRANSFER'
);

-- 2. Add transfer_ref column to inventory_transactions (nullable, audit-only)
ALTER TABLE public.inventory_transactions
  ADD COLUMN IF NOT EXISTS transfer_ref uuid NULL;

-- 3. Add is_active column to components
ALTER TABLE public.components
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- 4. Recreate the enriched view to include new columns
CREATE OR REPLACE VIEW public.inventory_transactions_enriched
WITH (security_invoker = true) AS
SELECT
  it.transaction_id,
  it.component_id,
  it.quantity,
  it.transaction_date,
  it.order_id,
  it.purchase_order_id,
  it.user_id,
  it.reason,
  it.org_id,
  it.transaction_type_id,
  c.internal_code  AS component_code,
  c.description    AS component_description,
  c.category_id,
  cc.categoryname  AS category_name,
  tt.type_name     AS transaction_type_name,
  po.q_number      AS po_number,
  po.supplier_id,
  s.name           AS supplier_name,
  o.order_number,
  it.transfer_ref,
  c.is_active      AS component_is_active
FROM public.inventory_transactions it
LEFT JOIN public.components        c  ON c.component_id        = it.component_id
LEFT JOIN public.component_categories cc ON cc.cat_id           = c.category_id
LEFT JOIN public.transaction_types tt ON tt.transaction_type_id = it.transaction_type_id
LEFT JOIN public.purchase_orders   po ON po.purchase_order_id   = it.purchase_order_id
LEFT JOIN public.suppliers         s  ON s.supplier_id          = po.supplier_id
LEFT JOIN public.orders            o  ON o.order_id             = it.order_id;

GRANT SELECT ON public.inventory_transactions_enriched TO authenticated;

-- 5. Transfer stock RPC
CREATE OR REPLACE FUNCTION public.transfer_component_stock(
  p_from_component_id integer,
  p_to_component_id integer,
  p_quantity numeric,
  p_reason text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_transfer_ref uuid := gen_random_uuid();
  v_transfer_type_id integer;
  v_from_txn_id integer;
  v_to_txn_id integer;
  v_full_reason text;
  v_org_id uuid;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Transfer quantity must be greater than zero';
  END IF;

  IF p_from_component_id = p_to_component_id THEN
    RAISE EXCEPTION 'Source and destination components must differ';
  END IF;

  -- Derive org_id from the source component (RLS already ensures the user can see it)
  SELECT org_id INTO v_org_id FROM public.components WHERE component_id = p_from_component_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Source component not found';
  END IF;

  -- Validate caller is an active member of this org
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = auth.uid() AND org_id = v_org_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

  -- Validate destination component belongs to same org
  IF NOT EXISTS (SELECT 1 FROM public.components WHERE component_id = p_to_component_id AND org_id = v_org_id) THEN
    RAISE EXCEPTION 'Destination component not found in organization';
  END IF;

  -- Get TRANSFER type ID
  SELECT transaction_type_id INTO v_transfer_type_id
  FROM public.transaction_types WHERE type_name = 'TRANSFER';
  IF v_transfer_type_id IS NULL THEN
    RAISE EXCEPTION 'TRANSFER transaction type not found';
  END IF;

  -- Build reason string
  v_full_reason := p_reason || CASE WHEN p_notes IS NOT NULL AND p_notes != '' THEN ': ' || p_notes ELSE '' END;

  -- Insert negative transaction on source
  INSERT INTO public.inventory_transactions (
    component_id, quantity, transaction_type_id, transaction_date,
    user_id, reason, org_id, transfer_ref
  ) VALUES (
    p_from_component_id, -p_quantity, v_transfer_type_id, now(),
    auth.uid(), v_full_reason, v_org_id, v_transfer_ref
  ) RETURNING transaction_id INTO v_from_txn_id;

  -- Insert positive transaction on destination
  INSERT INTO public.inventory_transactions (
    component_id, quantity, transaction_type_id, transaction_date,
    user_id, reason, org_id, transfer_ref
  ) VALUES (
    p_to_component_id, p_quantity, v_transfer_type_id, now(),
    auth.uid(), v_full_reason, v_org_id, v_transfer_ref
  ) RETURNING transaction_id INTO v_to_txn_id;

  -- Explicitly stamp org_id instead of relying on the legacy default.
  INSERT INTO public.inventory (component_id, quantity_on_hand, reorder_level, org_id)
  VALUES (p_from_component_id, -p_quantity, 0, v_org_id)
  ON CONFLICT (component_id) DO UPDATE
  SET quantity_on_hand = COALESCE(public.inventory.quantity_on_hand, 0) - p_quantity;

  INSERT INTO public.inventory (component_id, quantity_on_hand, reorder_level, org_id)
  VALUES (p_to_component_id, p_quantity, 0, v_org_id)
  ON CONFLICT (component_id) DO UPDATE
  SET quantity_on_hand = COALESCE(public.inventory.quantity_on_hand, 0) + p_quantity;

  RETURN jsonb_build_object(
    'transfer_ref', v_transfer_ref,
    'from_transaction_id', v_from_txn_id,
    'to_transaction_id', v_to_txn_id,
    'quantity', p_quantity
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_component_stock TO authenticated;
