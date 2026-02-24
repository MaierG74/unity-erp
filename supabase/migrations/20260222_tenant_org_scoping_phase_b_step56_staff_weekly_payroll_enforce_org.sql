-- Step 56: Enforce org_id constraint on staff_weekly_payroll

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.staff_weekly_payroll
    WHERE org_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot enforce org_id on staff_weekly_payroll: found NULL org_id rows';
  END IF;
END
$$;

ALTER TABLE public.staff_weekly_payroll
  VALIDATE CONSTRAINT staff_weekly_payroll_org_id_fkey;

ALTER TABLE public.staff_weekly_payroll
  ADD CONSTRAINT staff_weekly_payroll_org_id_not_null
  CHECK (org_id IS NOT NULL) NOT VALID;

ALTER TABLE public.staff_weekly_payroll
  VALIDATE CONSTRAINT staff_weekly_payroll_org_id_not_null;

ALTER TABLE public.staff_weekly_payroll
  ALTER COLUMN org_id SET NOT NULL;
