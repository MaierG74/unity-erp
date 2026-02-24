-- Step 55: Enforce org_id constraint on staff_weekly_hours

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.staff_weekly_hours
    WHERE org_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot enforce org_id on staff_weekly_hours: found NULL org_id rows';
  END IF;
END
$$;

ALTER TABLE public.staff_weekly_hours
  VALIDATE CONSTRAINT staff_weekly_hours_org_id_fkey;

ALTER TABLE public.staff_weekly_hours
  ADD CONSTRAINT staff_weekly_hours_org_id_not_null
  CHECK (org_id IS NOT NULL) NOT VALID;

ALTER TABLE public.staff_weekly_hours
  VALIDATE CONSTRAINT staff_weekly_hours_org_id_not_null;

ALTER TABLE public.staff_weekly_hours
  ALTER COLUMN org_id SET NOT NULL;
