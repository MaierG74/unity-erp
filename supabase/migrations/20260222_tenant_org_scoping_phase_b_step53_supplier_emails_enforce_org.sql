-- Step 53: Enforce org_id constraint on supplier_emails

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.supplier_emails
    WHERE org_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot enforce org_id on supplier_emails: found NULL org_id rows';
  END IF;
END
$$;

ALTER TABLE public.supplier_emails
  VALIDATE CONSTRAINT supplier_emails_org_id_fkey;

ALTER TABLE public.supplier_emails
  ADD CONSTRAINT supplier_emails_org_id_not_null
  CHECK (org_id IS NOT NULL) NOT VALID;

ALTER TABLE public.supplier_emails
  VALIDATE CONSTRAINT supplier_emails_org_id_not_null;

ALTER TABLE public.supplier_emails
  ALTER COLUMN org_id SET NOT NULL;
