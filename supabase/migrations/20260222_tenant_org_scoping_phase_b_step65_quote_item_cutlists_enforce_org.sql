-- Step 65: Enforce org_id constraint on quote_item_cutlists

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.quote_item_cutlists WHERE org_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot enforce org_id on quote_item_cutlists: found NULL org_id rows';
  END IF;
END
$$;

ALTER TABLE public.quote_item_cutlists
  VALIDATE CONSTRAINT quote_item_cutlists_org_id_fkey;

ALTER TABLE public.quote_item_cutlists
  ADD CONSTRAINT quote_item_cutlists_org_id_not_null
  CHECK (org_id IS NOT NULL) NOT VALID;

ALTER TABLE public.quote_item_cutlists
  VALIDATE CONSTRAINT quote_item_cutlists_org_id_not_null;

ALTER TABLE public.quote_item_cutlists
  ALTER COLUMN org_id SET NOT NULL;
