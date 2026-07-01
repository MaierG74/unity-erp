-- Phase 1A (4/5): per-org numbering settings + running-balance view.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS delivery_note_starting_number integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS delivery_note_prefix          text    NOT NULL DEFAULT 'DN-',
  ADD COLUMN IF NOT EXISTS stock_receipt_starting_number integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS stock_receipt_prefix          text    NOT NULL DEFAULT 'SR-',
  ADD COLUMN IF NOT EXISTS delivery_note_pdf_letterhead_url text;

-- Running-balance view over product_inventory_transactions.
-- security_invoker=true so org-scoped RLS on the base table propagates to callers.
DROP VIEW IF EXISTS public.product_inventory_transactions_with_balance;
CREATE VIEW public.product_inventory_transactions_with_balance
WITH (security_invoker = true)
AS
SELECT
  t.id,
  t.org_id,
  t.product_id,
  t.quantity,
  t.type,
  t.occurred_at,
  t.order_id,
  t.reference,
  SUM(t.quantity) OVER (
    PARTITION BY t.org_id, t.product_id
    ORDER BY t.occurred_at, t.id
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS running_balance
FROM public.product_inventory_transactions t;

REVOKE ALL ON public.product_inventory_transactions_with_balance FROM PUBLIC;
GRANT SELECT ON public.product_inventory_transactions_with_balance TO authenticated;
