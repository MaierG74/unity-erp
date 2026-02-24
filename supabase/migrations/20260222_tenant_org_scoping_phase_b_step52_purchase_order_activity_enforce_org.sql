-- Step 52: Enforce org_id constraint on purchase_order_activity
-- Safe rollout pattern: verify nulls then enforce NOT NULL

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.purchase_order_activity
    WHERE org_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot enforce NOT NULL on purchase_order_activity.org_id: found rows with NULL org_id';
  END IF;
END
$$;

ALTER TABLE public.purchase_order_activity
  ALTER COLUMN org_id SET NOT NULL;
