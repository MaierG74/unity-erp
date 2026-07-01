-- Cash-supplier tracking: org-consistency hardening (review P0 + P1s).
-- Applied to live (ttlyfhkrsjjrzxiagzpb) 2026-07-01 via Supabase MCP as version 20260701205117.
--
-- Problem: RLS on purchase_order_invoices / po_payment_signoff_activity checks only the
-- row's own org_id, never that the referenced PO / invoice belongs to that org, so a
-- member of org B could plant a row pointing at org A's PO; record_invoice (SECURITY
-- DEFINER) then reused that row by purchase_order_id alone and wrote org A's invoice
-- data into an org-B-readable row.
-- Fixes:
--   1) BEFORE triggers enforcing cross-reference org consistency on both tables,
--      plus attachment-belongs-to-PO checks on invoice/pop attachment ids.
--   2) record_invoice: lock the PO row (kills the double-submit duplicate-insert race),
--      org-filter the row-reuse SELECT, validate p_attachment_id belongs to the PO.
-- Verified live: cross-org poisoned insert blocked, same-org insert accepted
-- (rolled-back DO-block test, 2026-07-01).
-- Rollback:
--   DROP TRIGGER po_invoices_enforce_org ON public.purchase_order_invoices;
--   DROP TRIGGER po_signoff_activity_enforce_org ON public.po_payment_signoff_activity;
--   DROP FUNCTION public.enforce_po_invoice_org_consistency();
--   DROP FUNCTION public.enforce_po_signoff_activity_org_consistency();
--   (record_invoice: re-apply 20260701132156_record_invoice_rpc.sql)

CREATE OR REPLACE FUNCTION public.enforce_po_invoice_org_consistency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_po_org uuid;
BEGIN
  SELECT org_id INTO v_po_org
  FROM public.purchase_orders
  WHERE purchase_order_id = NEW.purchase_order_id;

  IF v_po_org IS NULL OR NEW.org_id IS DISTINCT FROM v_po_org THEN
    RAISE EXCEPTION 'purchase_order_invoices.org_id must match the purchase order''s organization'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.invoice_attachment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.purchase_order_attachments a
    WHERE a.id = NEW.invoice_attachment_id
      AND a.purchase_order_id = NEW.purchase_order_id
  ) THEN
    RAISE EXCEPTION 'invoice_attachment_id must reference an attachment of the same purchase order'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.pop_attachment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.purchase_order_attachments a
    WHERE a.id = NEW.pop_attachment_id
      AND a.purchase_order_id = NEW.purchase_order_id
  ) THEN
    RAISE EXCEPTION 'pop_attachment_id must reference an attachment of the same purchase order'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS po_invoices_enforce_org ON public.purchase_order_invoices;
CREATE TRIGGER po_invoices_enforce_org
  BEFORE INSERT OR UPDATE ON public.purchase_order_invoices
  FOR EACH ROW EXECUTE FUNCTION public.enforce_po_invoice_org_consistency();

CREATE OR REPLACE FUNCTION public.enforce_po_signoff_activity_org_consistency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_invoice_org uuid;
BEGIN
  SELECT org_id INTO v_invoice_org
  FROM public.purchase_order_invoices
  WHERE id = NEW.invoice_id;

  IF v_invoice_org IS NULL OR NEW.org_id IS DISTINCT FROM v_invoice_org THEN
    RAISE EXCEPTION 'po_payment_signoff_activity.org_id must match the invoice''s organization'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS po_signoff_activity_enforce_org ON public.po_payment_signoff_activity;
CREATE TRIGGER po_signoff_activity_enforce_org
  BEFORE INSERT OR UPDATE ON public.po_payment_signoff_activity
  FOR EACH ROW EXECUTE FUNCTION public.enforce_po_signoff_activity_org_consistency();

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
  -- Resolve the owning organization and lock the PO row so concurrent
  -- record_invoice calls on the same PO serialize (no duplicate inserts).
  SELECT org_id INTO v_org_id
  FROM public.purchase_orders
  WHERE purchase_order_id = p_purchase_order_id
  FOR UPDATE;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Purchase order % not found', p_purchase_order_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Authorize: service role bypasses; otherwise caller must be a member of the org.
  IF auth.role() <> 'service_role' AND NOT public.is_org_member(v_org_id) THEN
    RAISE EXCEPTION 'Not authorized for organization %', v_org_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Attachment must belong to this purchase order (and therefore this org).
  IF p_attachment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.purchase_order_attachments a
    WHERE a.id = p_attachment_id
      AND a.purchase_order_id = p_purchase_order_id
  ) THEN
    RAISE EXCEPTION 'Attachment % does not belong to purchase order %', p_attachment_id, p_purchase_order_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Reuse an existing open awaiting_invoice row if one exists; otherwise create one.
  -- org filter guards against cross-org poisoned rows (SECURITY DEFINER bypasses RLS).
  SELECT id INTO v_existing_id
  FROM public.purchase_order_invoices
  WHERE purchase_order_id = p_purchase_order_id
    AND org_id = v_org_id
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

-- Signature unchanged, but re-assert grants defensively (CREATE OR REPLACE keeps
-- existing ACLs; this documents intent and is idempotent).
REVOKE ALL ON FUNCTION public.record_invoice(bigint, text, date, numeric, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_invoice(bigint, text, date, numeric, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_invoice(bigint, text, date, numeric, uuid, text) TO service_role;
