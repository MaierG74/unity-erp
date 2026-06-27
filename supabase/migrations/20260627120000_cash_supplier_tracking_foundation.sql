-- POL-129 Slice 1 foundation: supplier payment_type + invoice/payment + sign-off audit.
-- Additive + reversible. org-scoped RLS via is_org_member(org_id).
-- Applied to live (ttlyfhkrsjjrzxiagzpb) 2026-06-27 via Supabase MCP; get_advisors(security) clean.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.po_payment_signoff_activity;
--   DROP TABLE IF EXISTS public.purchase_order_invoices;
--   ALTER TABLE public.suppliers DROP COLUMN IF EXISTS payment_type;

-- A1: cash vs account supplier flag (default account => existing suppliers unchanged)
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS payment_type text NOT NULL DEFAULT 'account'
    CHECK (payment_type IN ('cash','account'));
COMMENT ON COLUMN public.suppliers.payment_type IS
  'cash = pay-now (POP loop tracked); account = pay-later on terms. Default account.';

-- A2: structured invoice + payment record (one PO -> many invoices)
CREATE TABLE IF NOT EXISTS public.purchase_order_invoices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES public.organizations(id),
  purchase_order_id     bigint NOT NULL REFERENCES public.purchase_orders(purchase_order_id) ON DELETE CASCADE,
  invoice_number        text,
  invoice_date          date,
  invoice_amount        numeric,
  invoice_received_at   timestamptz,
  invoice_attachment_id uuid REFERENCES public.purchase_order_attachments(id),
  amount_paid           numeric,
  payment_date          date,
  payment_method        text,
  payment_reference     text,
  pop_attachment_id     uuid REFERENCES public.purchase_order_attachments(id),
  payment_status        text NOT NULL DEFAULT 'awaiting_invoice'
    CHECK (payment_status IN ('awaiting_invoice','awaiting_payment','awaiting_pop','closed','cancelled')),
  payment_requested_at  timestamptz,
  paid_at               timestamptz,
  pop_sent_at           timestamptz,
  signed_off_by         uuid REFERENCES auth.users(id),
  signed_off_at         timestamptz,
  created_by            uuid REFERENCES auth.users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_po_invoices_org_status ON public.purchase_order_invoices (org_id, payment_status);
CREATE INDEX IF NOT EXISTS ix_po_invoices_org_po     ON public.purchase_order_invoices (org_id, purchase_order_id);

DROP TRIGGER IF EXISTS po_invoices_set_updated_at ON public.purchase_order_invoices;
CREATE TRIGGER po_invoices_set_updated_at
  BEFORE UPDATE ON public.purchase_order_invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.purchase_order_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_read_po_invoices"   ON public.purchase_order_invoices;
DROP POLICY IF EXISTS "org_insert_po_invoices" ON public.purchase_order_invoices;
DROP POLICY IF EXISTS "org_update_po_invoices" ON public.purchase_order_invoices;
DROP POLICY IF EXISTS "org_delete_po_invoices" ON public.purchase_order_invoices;
CREATE POLICY "org_read_po_invoices"   ON public.purchase_order_invoices FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "org_insert_po_invoices" ON public.purchase_order_invoices FOR INSERT WITH CHECK (public.is_org_member(org_id));
CREATE POLICY "org_update_po_invoices" ON public.purchase_order_invoices FOR UPDATE USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));
CREATE POLICY "org_delete_po_invoices" ON public.purchase_order_invoices FOR DELETE USING (public.is_org_member(org_id));

-- A3: append-only payment sign-off audit trail
CREATE TABLE IF NOT EXISTS public.po_payment_signoff_activity (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id),
  invoice_id  uuid NOT NULL REFERENCES public.purchase_order_invoices(id) ON DELETE CASCADE,
  action      text NOT NULL,
  actor       uuid REFERENCES auth.users(id),
  note        text,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_po_signoff_activity_org_invoice
  ON public.po_payment_signoff_activity (org_id, invoice_id, created_at DESC);

ALTER TABLE public.po_payment_signoff_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_read_po_signoff_activity"   ON public.po_payment_signoff_activity;
DROP POLICY IF EXISTS "org_insert_po_signoff_activity" ON public.po_payment_signoff_activity;
CREATE POLICY "org_read_po_signoff_activity"   ON public.po_payment_signoff_activity FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "org_insert_po_signoff_activity" ON public.po_payment_signoff_activity FOR INSERT WITH CHECK (public.is_org_member(org_id));
