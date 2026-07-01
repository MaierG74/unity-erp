-- Cash-supplier Slice 1 (S1-B): private finance-docs bucket, attachment tenancy
-- trigger, storage locator columns, email-type constraint, finance module seed.
-- Spec: docs/projects/2026-07-01-cash-supplier-payment-lifecycle-completion.md §2.2/§2.4.
-- Rollback notes at bottom.

-- 1) Private bucket for NEW invoice/POP files.
INSERT INTO storage.buckets (id, name, public)
VALUES ('finance-docs', 'finance-docs', false)
ON CONFLICT (id) DO NOTHING;

-- Authenticated users may UPLOAD into their own org's prefix only.
-- No authenticated SELECT/DELETE: reads + deletes are server-authorized
-- (service role) after an RLS row check — bucket-wide SELECT would let any
-- signed-in user sign any path they learn (plan-review blocker #3).
DROP POLICY IF EXISTS "finance_docs_org_insert" ON storage.objects;
CREATE POLICY "finance_docs_org_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'finance-docs'
    AND (storage.foldername(name))[1] IN (
      SELECT m.org_id::text FROM public.organization_members m
      WHERE m.user_id = auth.uid() AND m.is_active
    )
  );

-- 2) Attachment tenancy (plan-review blocker #2, supersedes the spun-off
-- background task): org_id is NOT NULL with a hard-coded default-org DEFAULT
-- and the client insert never sets it. Attachments always belong to their
-- PO's org — derive it unconditionally, then drop the misleading default.
CREATE OR REPLACE FUNCTION public.enforce_po_attachment_org()
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

  IF v_po_org IS NULL THEN
    RAISE EXCEPTION 'purchase order % not found for attachment', NEW.purchase_order_id
      USING ERRCODE = 'no_data_found';
  END IF;

  NEW.org_id := v_po_org;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS po_attachments_enforce_org ON public.purchase_order_attachments;
CREATE TRIGGER po_attachments_enforce_org
  BEFORE INSERT OR UPDATE ON public.purchase_order_attachments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_po_attachment_org();

ALTER TABLE public.purchase_order_attachments ALTER COLUMN org_id DROP DEFAULT;

-- 3) Storage locators for private files (legacy rows stay NULL -> file_url authoritative).
ALTER TABLE public.purchase_order_attachments
  ADD COLUMN IF NOT EXISTS storage_bucket text,
  ADD COLUMN IF NOT EXISTS storage_path  text;

-- 4) Email-type constraint: add po_pop_send + po_payment_reminder, and fold in
-- the drifted po_balance_close (inserted by send-po-balance-closure-email but
-- never added to the CHECK).
ALTER TABLE public.purchase_order_emails
  DROP CONSTRAINT IF EXISTS purchase_order_emails_email_type_check;
ALTER TABLE public.purchase_order_emails
  ADD CONSTRAINT purchase_order_emails_email_type_check
  CHECK (email_type IN ('po_send','po_cancel','po_line_cancel','po_follow_up',
                        'po_balance_close','po_pop_send','po_payment_reminder'))
  NOT VALID;
ALTER TABLE public.purchase_order_emails
  VALIDATE CONSTRAINT purchase_order_emails_email_type_check;

-- 5) Finance module key + QButton entitlement.
INSERT INTO public.module_catalog (module_key, module_name, description, is_core)
VALUES ('finance', 'Finance', 'Pending supplier payments board: invoice, payment, sign-off, POP lifecycle for cash suppliers.', false)
ON CONFLICT (module_key) DO NOTHING;

INSERT INTO public.organization_module_entitlements (org_id, module_key, enabled, notes)
SELECT o.id, 'finance', true, 'Seeded with cash-supplier Slice 1 (POL-128).'
FROM public.organizations o
WHERE o.name = 'QButton'
ON CONFLICT DO NOTHING;

-- Rollback:
--   DROP POLICY "finance_docs_org_insert" ON storage.objects;
--   DELETE FROM storage.buckets WHERE id='finance-docs';  -- (after emptying)
--   DROP TRIGGER po_attachments_enforce_org ON public.purchase_order_attachments;
--   DROP FUNCTION public.enforce_po_attachment_org();
--   ALTER TABLE public.purchase_order_attachments ALTER COLUMN org_id SET DEFAULT '99183187-da8e-4ce1-b28a-d08cc70cd7d4'::uuid;
--   ALTER TABLE public.purchase_order_attachments DROP COLUMN storage_bucket, DROP COLUMN storage_path;
--   (email-type CHECK: re-add previous 4-value list)
--   DELETE FROM public.organization_module_entitlements WHERE module_key='finance';
--   DELETE FROM public.module_catalog WHERE module_key='finance';
