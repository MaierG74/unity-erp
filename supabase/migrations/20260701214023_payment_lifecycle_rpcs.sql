-- Cash-supplier Slice 1 (S1-A): payment lifecycle RPCs.
-- record_payment / sign_off_payment / mark_pop_sent / reopen_payment.
-- Spec: docs/projects/2026-07-01-cash-supplier-payment-lifecycle-completion.md §2.1.
-- All four follow the 20260701205117 hardening pattern: SECURITY DEFINER +
-- SET search_path + parent-PO FOR UPDATE lock + org check + attachment
-- ownership validation + both audit trails.
-- State machine: awaiting_payment -(record_payment)-> awaiting_pop
--                -(mark_pop_sent)-> closed; reopen: awaiting_pop|closed -> awaiting_payment.
-- Rollback: DROP FUNCTION public.record_payment(uuid,numeric,date,text,text,uuid,text);
--           DROP FUNCTION public.sign_off_payment(uuid,text);
--           DROP FUNCTION public.mark_pop_sent(uuid,uuid,text);
--           DROP FUNCTION public.reopen_payment(uuid,text);

-- Shared authority helper: active owner/admin membership (used by sign_off/reopen).
CREATE OR REPLACE FUNCTION public.is_org_payment_authoriser(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = p_org_id
      AND m.is_active
      AND m.role IN ('owner','admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.record_payment(
  p_invoice_id          uuid,
  p_amount_paid         numeric,
  p_payment_date        date,
  p_payment_method      text,
  p_payment_reference   text    DEFAULT NULL,
  p_pop_attachment_id   uuid    DEFAULT NULL,
  p_note                text    DEFAULT NULL
)
RETURNS public.purchase_order_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_actor   uuid := auth.uid();
  v_org_id  uuid;
  v_po_id   bigint;
  v_status  text;
  v_signed  timestamptz;
  v_invoice public.purchase_order_invoices;
BEGIN
  -- Lock the invoice row AND its parent PO (serializes all lifecycle transitions per PO).
  SELECT i.org_id, i.purchase_order_id, i.payment_status, i.signed_off_at
    INTO v_org_id, v_po_id, v_status, v_signed
  FROM public.purchase_order_invoices i
  JOIN public.purchase_orders po ON po.purchase_order_id = i.purchase_order_id
  WHERE i.id = p_invoice_id
  FOR UPDATE;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id USING ERRCODE = 'no_data_found';
  END IF;

  IF auth.role() <> 'service_role' AND NOT public.is_org_member(v_org_id) THEN
    RAISE EXCEPTION 'Not authorized for organization %', v_org_id USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_status <> 'awaiting_payment' THEN
    RAISE EXCEPTION 'record_payment requires payment_status=awaiting_payment (current: %)', v_status
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_signed IS NOT NULL THEN
    RAISE EXCEPTION 'Payment is signed off and locked; use reopen_payment first'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_amount_paid IS NULL OR p_amount_paid <= 0 THEN
    RAISE EXCEPTION 'amount_paid must be greater than zero' USING ERRCODE = 'check_violation';
  END IF;
  IF p_payment_method IS NULL OR p_payment_method NOT IN ('eft','cash','card') THEN
    RAISE EXCEPTION 'payment_method must be one of eft, cash, card' USING ERRCODE = 'check_violation';
  END IF;
  IF p_pop_attachment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.purchase_order_attachments a
    WHERE a.id = p_pop_attachment_id AND a.purchase_order_id = v_po_id
  ) THEN
    RAISE EXCEPTION 'Attachment % does not belong to purchase order %', p_pop_attachment_id, v_po_id
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.purchase_order_invoices SET
    amount_paid       = p_amount_paid,
    payment_date      = COALESCE(p_payment_date, CURRENT_DATE),
    payment_method    = p_payment_method,
    payment_reference = p_payment_reference,
    pop_attachment_id = COALESCE(p_pop_attachment_id, pop_attachment_id),
    paid_at           = now(),
    payment_status    = 'awaiting_pop',
    updated_at        = now()
  WHERE id = p_invoice_id
  RETURNING * INTO v_invoice;

  INSERT INTO public.po_payment_signoff_activity (org_id, invoice_id, action, actor, note, metadata)
  VALUES (v_org_id, p_invoice_id, 'payment_recorded', v_actor, p_note,
    jsonb_build_object(
      'purchase_order_id', v_po_id,
      'amount_paid', p_amount_paid,
      'payment_method', p_payment_method,
      'payment_reference', p_payment_reference,
      'pop_attachment_id', p_pop_attachment_id
    ));

  INSERT INTO public.purchase_order_activity (org_id, purchase_order_id, action_type, description, metadata, performed_by)
  VALUES (v_org_id, v_po_id, 'payment_recorded',
    'Payment recorded — ' || p_amount_paid::text || ' (' || p_payment_method || ')',
    jsonb_build_object('invoice_id', p_invoice_id, 'amount_paid', p_amount_paid,
                       'payment_reference', p_payment_reference, 'pop_attachment_id', p_pop_attachment_id),
    v_actor);

  RETURN v_invoice;
END;
$$;

CREATE OR REPLACE FUNCTION public.sign_off_payment(
  p_invoice_id uuid,
  p_note       text DEFAULT NULL
)
RETURNS public.purchase_order_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_actor    uuid := auth.uid();
  v_org_id   uuid;
  v_po_id    bigint;
  v_status   text;
  v_signed   timestamptz;
  v_pop_sent timestamptz;
  v_invoice  public.purchase_order_invoices;
BEGIN
  SELECT i.org_id, i.purchase_order_id, i.payment_status, i.signed_off_at, i.pop_sent_at
    INTO v_org_id, v_po_id, v_status, v_signed, v_pop_sent
  FROM public.purchase_order_invoices i
  JOIN public.purchase_orders po ON po.purchase_order_id = i.purchase_order_id
  WHERE i.id = p_invoice_id
  FOR UPDATE;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id USING ERRCODE = 'no_data_found';
  END IF;

  -- Sign-off authority: active owner/admin of the org (service_role bypasses).
  IF auth.role() <> 'service_role' AND NOT public.is_org_payment_authoriser(v_org_id) THEN
    RAISE EXCEPTION 'Payment sign-off requires an owner/admin role in organization %', v_org_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_status <> 'awaiting_pop' THEN
    RAISE EXCEPTION 'sign_off_payment requires payment_status=awaiting_pop (current: %)', v_status
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_pop_sent IS NOT NULL THEN
    RAISE EXCEPTION 'POP already sent; reopen the payment to amend it' USING ERRCODE = 'check_violation';
  END IF;
  IF v_signed IS NOT NULL THEN
    RAISE EXCEPTION 'Payment is already signed off' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.purchase_order_invoices SET
    signed_off_by = v_actor,
    signed_off_at = now(),
    updated_at    = now()
  WHERE id = p_invoice_id
  RETURNING * INTO v_invoice;

  INSERT INTO public.po_payment_signoff_activity (org_id, invoice_id, action, actor, note, metadata)
  VALUES (v_org_id, p_invoice_id, 'signed_off', v_actor, p_note,
    jsonb_build_object('purchase_order_id', v_po_id));

  INSERT INTO public.purchase_order_activity (org_id, purchase_order_id, action_type, description, metadata, performed_by)
  VALUES (v_org_id, v_po_id, 'payment_signed_off', 'Payment signed off',
    jsonb_build_object('invoice_id', p_invoice_id), v_actor);

  RETURN v_invoice;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_pop_sent(
  p_invoice_id        uuid,
  p_pop_attachment_id uuid DEFAULT NULL,
  p_note              text DEFAULT NULL
)
RETURNS public.purchase_order_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_actor   uuid := auth.uid();
  v_org_id  uuid;
  v_po_id   bigint;
  v_status  text;
  v_pop_id  uuid;
  v_invoice public.purchase_order_invoices;
BEGIN
  SELECT i.org_id, i.purchase_order_id, i.payment_status, i.pop_attachment_id
    INTO v_org_id, v_po_id, v_status, v_pop_id
  FROM public.purchase_order_invoices i
  JOIN public.purchase_orders po ON po.purchase_order_id = i.purchase_order_id
  WHERE i.id = p_invoice_id
  FOR UPDATE;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id USING ERRCODE = 'no_data_found';
  END IF;

  IF auth.role() <> 'service_role' AND NOT public.is_org_member(v_org_id) THEN
    RAISE EXCEPTION 'Not authorized for organization %', v_org_id USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_status <> 'awaiting_pop' THEN
    RAISE EXCEPTION 'mark_pop_sent requires payment_status=awaiting_pop (current: %)', v_status
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_pop_attachment_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.purchase_order_attachments a
      WHERE a.id = p_pop_attachment_id AND a.purchase_order_id = v_po_id
    ) THEN
      RAISE EXCEPTION 'Attachment % does not belong to purchase order %', p_pop_attachment_id, v_po_id
        USING ERRCODE = 'check_violation';
    END IF;
    v_pop_id := p_pop_attachment_id;
  END IF;

  -- Closing without any POP on record demands an explanatory note.
  IF v_pop_id IS NULL AND (p_note IS NULL OR btrim(p_note) = '') THEN
    RAISE EXCEPTION 'A note is required when closing without a proof-of-payment file'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.purchase_order_invoices SET
    pop_attachment_id = v_pop_id,
    pop_sent_at       = now(),
    payment_status    = 'closed',
    updated_at        = now()
  WHERE id = p_invoice_id
  RETURNING * INTO v_invoice;

  INSERT INTO public.po_payment_signoff_activity (org_id, invoice_id, action, actor, note, metadata)
  VALUES (v_org_id, p_invoice_id, 'pop_sent', v_actor, p_note,
    jsonb_build_object('purchase_order_id', v_po_id, 'pop_attachment_id', v_pop_id));

  INSERT INTO public.purchase_order_activity (org_id, purchase_order_id, action_type, description, metadata, performed_by)
  VALUES (v_org_id, v_po_id, 'pop_sent',
    CASE WHEN v_pop_id IS NULL THEN 'Payment closed without POP — ' || p_note
         ELSE 'POP sent to supplier' END,
    jsonb_build_object('invoice_id', p_invoice_id, 'pop_attachment_id', v_pop_id),
    v_actor);

  RETURN v_invoice;
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_payment(
  p_invoice_id uuid,
  p_note       text
)
RETURNS public.purchase_order_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_actor   uuid := auth.uid();
  v_org_id  uuid;
  v_po_id   bigint;
  v_status  text;
  v_invoice public.purchase_order_invoices;
BEGIN
  IF p_note IS NULL OR btrim(p_note) = '' THEN
    RAISE EXCEPTION 'A note explaining the reopen is required' USING ERRCODE = 'check_violation';
  END IF;

  SELECT i.org_id, i.purchase_order_id, i.payment_status
    INTO v_org_id, v_po_id, v_status
  FROM public.purchase_order_invoices i
  JOIN public.purchase_orders po ON po.purchase_order_id = i.purchase_order_id
  WHERE i.id = p_invoice_id
  FOR UPDATE;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id USING ERRCODE = 'no_data_found';
  END IF;

  IF auth.role() <> 'service_role' AND NOT public.is_org_payment_authoriser(v_org_id) THEN
    RAISE EXCEPTION 'Reopening a payment requires an owner/admin role in organization %', v_org_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_status NOT IN ('awaiting_pop','closed') THEN
    RAISE EXCEPTION 'reopen_payment requires payment_status awaiting_pop or closed (current: %)', v_status
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.purchase_order_invoices SET
    amount_paid       = NULL,
    payment_date      = NULL,
    payment_method    = NULL,
    payment_reference = NULL,
    pop_attachment_id = NULL,
    paid_at           = NULL,
    pop_sent_at       = NULL,
    signed_off_by     = NULL,
    signed_off_at     = NULL,
    payment_status    = 'awaiting_payment',
    updated_at        = now()
  WHERE id = p_invoice_id
  RETURNING * INTO v_invoice;

  INSERT INTO public.po_payment_signoff_activity (org_id, invoice_id, action, actor, note, metadata)
  VALUES (v_org_id, p_invoice_id, 'reopened', v_actor, p_note,
    jsonb_build_object('purchase_order_id', v_po_id, 'previous_status', v_status));

  INSERT INTO public.purchase_order_activity (org_id, purchase_order_id, action_type, description, metadata, performed_by)
  VALUES (v_org_id, v_po_id, 'payment_reopened', 'Payment reopened — ' || p_note,
    jsonb_build_object('invoice_id', p_invoice_id, 'previous_status', v_status), v_actor);

  RETURN v_invoice;
END;
$$;

-- Privileges: signed-in users only (advisor 0028 pattern).
REVOKE ALL ON FUNCTION public.record_payment(uuid,numeric,date,text,text,uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sign_off_payment(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_pop_sent(uuid,uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reopen_payment(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_org_payment_authoriser(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_payment(uuid,numeric,date,text,text,uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sign_off_payment(uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_pop_sent(uuid,uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reopen_payment(uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_org_payment_authoriser(uuid) TO authenticated, service_role;
