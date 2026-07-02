-- Cash-supplier Slice 1 review hardening (round 2).
-- Applied to live (ttlyfhkrsjjrzxiagzpb) 2026-07-01 via Supabase MCP as version 20260701221529.
-- Review findings (dcx 3-agent fleet) driving this migration:
--   P1 direct-DML bypass: org members could set signed_off_at / payment_status='closed'
--     through PostgREST, defeating the owner/admin sign-off gate -> lifecycle writes are
--     now RPC-only (write policies dropped; SELECT stays; SECURITY DEFINER RPCs bypass RLS).
--   P1 storage-path spoofing: attachment rows could point finance-docs paths at another
--     org's objects and the server routes would sign/delete them -> trigger validates the
--     org/PO prefix.
--   P1 cross-PO attachment moves re-stamped org silently -> now refused.
--   P2 banned_until ignored by is_org_payment_authoriser -> now checked.
--   P2 joined FOR UPDATE lock-order divergence vs record_invoice -> all four RPCs now
--     lock the parent PO first, then the invoice row.
-- Verified live: write policies count 0 on both tables; spoofed-path insert and cross-PO
-- move blocked (rolled-back DO test); staff-token direct UPDATE/DELETE refused (0 rows).
-- Rollback: re-apply 20260701214023 + 20260701214107 bodies; recreate the dropped
-- policies from 20260627120000 if direct writes must return.

-- 1) RPC-only writes
DROP POLICY IF EXISTS "org_insert_po_invoices" ON public.purchase_order_invoices;
DROP POLICY IF EXISTS "org_update_po_invoices" ON public.purchase_order_invoices;
DROP POLICY IF EXISTS "org_delete_po_invoices" ON public.purchase_order_invoices;
DROP POLICY IF EXISTS "org_insert_po_signoff_activity" ON public.po_payment_signoff_activity;

-- 2) Attachment trigger hardening
CREATE OR REPLACE FUNCTION public.enforce_po_attachment_org()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_po_org uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.purchase_order_id IS DISTINCT FROM OLD.purchase_order_id THEN
    RAISE EXCEPTION 'attachments cannot be moved between purchase orders'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT org_id INTO v_po_org
  FROM public.purchase_orders
  WHERE purchase_order_id = NEW.purchase_order_id;

  IF v_po_org IS NULL THEN
    RAISE EXCEPTION 'purchase order % not found for attachment', NEW.purchase_order_id
      USING ERRCODE = 'no_data_found';
  END IF;

  NEW.org_id := v_po_org;

  IF NEW.storage_bucket = 'finance-docs' THEN
    IF NEW.storage_path IS NULL
       OR NEW.storage_path NOT LIKE v_po_org::text || '/purchase-orders/' || NEW.purchase_order_id::text || '/%' THEN
      RAISE EXCEPTION 'finance-docs storage_path must live under the purchase order''s org prefix'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 3) banned_until in the authoriser
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
      AND (m.banned_until IS NULL OR m.banned_until < now())
      AND m.role IN ('owner','admin')
  );
$$;

-- 4) PO-first locking in all four lifecycle RPCs (bodies identical to
-- 20260701214023 except the locking preamble; see that file for the audit
-- contract). Full definitions below match the live functions exactly.

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
  SELECT purchase_order_id INTO v_po_id FROM public.purchase_order_invoices WHERE id = p_invoice_id;
  IF v_po_id IS NULL THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id USING ERRCODE = 'no_data_found';
  END IF;

  SELECT org_id INTO v_org_id FROM public.purchase_orders WHERE purchase_order_id = v_po_id FOR UPDATE;

  SELECT payment_status, signed_off_at INTO v_status, v_signed
  FROM public.purchase_order_invoices WHERE id = p_invoice_id FOR UPDATE;

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
  SELECT purchase_order_id INTO v_po_id FROM public.purchase_order_invoices WHERE id = p_invoice_id;
  IF v_po_id IS NULL THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id USING ERRCODE = 'no_data_found';
  END IF;

  SELECT org_id INTO v_org_id FROM public.purchase_orders WHERE purchase_order_id = v_po_id FOR UPDATE;

  SELECT payment_status, signed_off_at, pop_sent_at INTO v_status, v_signed, v_pop_sent
  FROM public.purchase_order_invoices WHERE id = p_invoice_id FOR UPDATE;

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
  SELECT purchase_order_id INTO v_po_id FROM public.purchase_order_invoices WHERE id = p_invoice_id;
  IF v_po_id IS NULL THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id USING ERRCODE = 'no_data_found';
  END IF;

  SELECT org_id INTO v_org_id FROM public.purchase_orders WHERE purchase_order_id = v_po_id FOR UPDATE;

  SELECT payment_status, pop_attachment_id INTO v_status, v_pop_id
  FROM public.purchase_order_invoices WHERE id = p_invoice_id FOR UPDATE;

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

  SELECT purchase_order_id INTO v_po_id FROM public.purchase_order_invoices WHERE id = p_invoice_id;
  IF v_po_id IS NULL THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id USING ERRCODE = 'no_data_found';
  END IF;

  SELECT org_id INTO v_org_id FROM public.purchase_orders WHERE purchase_order_id = v_po_id FOR UPDATE;

  SELECT payment_status INTO v_status
  FROM public.purchase_order_invoices WHERE id = p_invoice_id FOR UPDATE;

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
