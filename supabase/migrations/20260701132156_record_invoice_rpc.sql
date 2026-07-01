-- Cash-supplier invoice tracking — Part Two (Phase C)
-- record_invoice(): first lifecycle transition awaiting_invoice -> awaiting_payment.
-- Atomically creates/updates the PO's purchase_order_invoices row and writes both
-- audit trails (po_payment_signoff_activity + purchase_order_activity).
--
-- Modeled on public.close_supplier_order_balance:
--   SECURITY DEFINER + SET search_path = public + explicit org check + FOR UPDATE lock.
-- Rollback: DROP FUNCTION public.record_invoice(bigint, text, date, numeric, uuid, text);

CREATE OR REPLACE FUNCTION public.record_invoice(
  p_purchase_order_id bigint,
  p_invoice_number     text    DEFAULT NULL,
  p_invoice_date       date    DEFAULT NULL,
  p_invoice_amount     numeric DEFAULT NULL,
  p_attachment_id      uuid    DEFAULT NULL,
  p_note               text    DEFAULT NULL
)
RETURNS public.purchase_order_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_org_id      uuid;
  v_actor       uuid := auth.uid();
  v_existing_id uuid;
  v_invoice     public.purchase_order_invoices;
BEGIN
  -- Resolve the owning organization from the purchase order.
  SELECT org_id INTO v_org_id
  FROM public.purchase_orders
  WHERE purchase_order_id = p_purchase_order_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Purchase order % not found', p_purchase_order_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Authorize: service role bypasses; otherwise caller must be a member of the org.
  IF auth.role() <> 'service_role' AND NOT public.is_org_member(v_org_id) THEN
    RAISE EXCEPTION 'Not authorized for organization %', v_org_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Reuse an existing open awaiting_invoice row if one exists; otherwise create one.
  -- (The finance board defaults every cash PO with no open invoice to awaiting_invoice,
  --  so most POs have no row yet and take the INSERT path.)
  SELECT id INTO v_existing_id
  FROM public.purchase_order_invoices
  WHERE purchase_order_id = p_purchase_order_id
    AND payment_status = 'awaiting_invoice'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_existing_id IS NULL THEN
    INSERT INTO public.purchase_order_invoices (
      org_id, purchase_order_id, invoice_number, invoice_date, invoice_amount,
      invoice_received_at, invoice_attachment_id, payment_status, created_by
    ) VALUES (
      v_org_id, p_purchase_order_id, p_invoice_number, p_invoice_date, p_invoice_amount,
      now(), p_attachment_id, 'awaiting_payment', v_actor
    )
    RETURNING * INTO v_invoice;
  ELSE
    UPDATE public.purchase_order_invoices SET
      invoice_number        = COALESCE(p_invoice_number, invoice_number),
      invoice_date          = COALESCE(p_invoice_date, invoice_date),
      invoice_amount        = COALESCE(p_invoice_amount, invoice_amount),
      invoice_attachment_id = COALESCE(p_attachment_id, invoice_attachment_id),
      invoice_received_at   = now(),
      payment_status        = 'awaiting_payment',
      updated_at            = now()
    WHERE id = v_existing_id
    RETURNING * INTO v_invoice;
  END IF;

  -- Append-only sign-off audit trail.
  INSERT INTO public.po_payment_signoff_activity (org_id, invoice_id, action, actor, note, metadata)
  VALUES (
    v_org_id, v_invoice.id, 'invoice_recorded', v_actor, p_note,
    jsonb_build_object(
      'purchase_order_id', p_purchase_order_id,
      'invoice_number',    p_invoice_number,
      'invoice_amount',    p_invoice_amount,
      'attachment_id',     p_attachment_id
    )
  );

  -- Summary row on the PO timeline.
  INSERT INTO public.purchase_order_activity (org_id, purchase_order_id, action_type, description, metadata, performed_by)
  VALUES (
    v_org_id, p_purchase_order_id, 'invoice_recorded',
    'Invoice recorded'
      || COALESCE(' #' || p_invoice_number, '')
      || COALESCE(' — ' || p_invoice_amount::text, ''),
    jsonb_build_object(
      'invoice_id',     v_invoice.id,
      'invoice_amount', p_invoice_amount,
      'attachment_id',  p_attachment_id
    ),
    v_actor
  );

  RETURN v_invoice;
END;
$$;

-- Signed-in users only: strip the default PUBLIC execute privilege so anon
-- cannot call this SECURITY DEFINER function via /rest/v1/rpc/record_invoice
-- (clears advisor 0028_anon_security_definer_function_executable).
REVOKE ALL ON FUNCTION public.record_invoice(bigint, text, date, numeric, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_invoice(bigint, text, date, numeric, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_invoice(bigint, text, date, numeric, uuid, text) TO service_role;
