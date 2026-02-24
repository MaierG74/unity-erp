-- Step 57: Enforce org_id constraint on supplier_follow_up_responses

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.supplier_follow_up_responses
    WHERE org_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot enforce org_id on supplier_follow_up_responses: found NULL org_id rows';
  END IF;
END
$$;

ALTER TABLE public.supplier_follow_up_responses
  VALIDATE CONSTRAINT supplier_follow_up_responses_org_id_fkey;

ALTER TABLE public.supplier_follow_up_responses
  ADD CONSTRAINT supplier_follow_up_responses_org_id_not_null
  CHECK (org_id IS NOT NULL) NOT VALID;

ALTER TABLE public.supplier_follow_up_responses
  VALIDATE CONSTRAINT supplier_follow_up_responses_org_id_not_null;

ALTER TABLE public.supplier_follow_up_responses
  ALTER COLUMN org_id SET NOT NULL;
