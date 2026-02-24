-- Step 61: Enforce org_id constraint on quote_cluster_lines

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.quote_cluster_lines WHERE org_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot enforce org_id on quote_cluster_lines: found NULL org_id rows';
  END IF;
END
$$;

ALTER TABLE public.quote_cluster_lines
  VALIDATE CONSTRAINT quote_cluster_lines_org_id_fkey;

ALTER TABLE public.quote_cluster_lines
  ADD CONSTRAINT quote_cluster_lines_org_id_not_null
  CHECK (org_id IS NOT NULL) NOT VALID;

ALTER TABLE public.quote_cluster_lines
  VALIDATE CONSTRAINT quote_cluster_lines_org_id_not_null;

ALTER TABLE public.quote_cluster_lines
  ALTER COLUMN org_id SET NOT NULL;
