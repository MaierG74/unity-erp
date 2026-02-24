-- Step 63: Enforce org_id constraint on quote_item_clusters

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.quote_item_clusters WHERE org_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot enforce org_id on quote_item_clusters: found NULL org_id rows';
  END IF;
END
$$;

ALTER TABLE public.quote_item_clusters
  VALIDATE CONSTRAINT quote_item_clusters_org_id_fkey;

ALTER TABLE public.quote_item_clusters
  ADD CONSTRAINT quote_item_clusters_org_id_not_null
  CHECK (org_id IS NOT NULL) NOT VALID;

ALTER TABLE public.quote_item_clusters
  VALIDATE CONSTRAINT quote_item_clusters_org_id_not_null;

ALTER TABLE public.quote_item_clusters
  ALTER COLUMN org_id SET NOT NULL;
