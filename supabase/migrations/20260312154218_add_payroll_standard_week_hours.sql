ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS payroll_standard_week_hours NUMERIC(6,2);

UPDATE public.organizations
SET payroll_standard_week_hours = 44.00
WHERE payroll_standard_week_hours IS NULL;

ALTER TABLE public.organizations
  ALTER COLUMN payroll_standard_week_hours SET DEFAULT 44.00;

ALTER TABLE public.organizations
  ALTER COLUMN payroll_standard_week_hours SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'organizations_payroll_standard_week_hours_check'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_payroll_standard_week_hours_check
      CHECK (payroll_standard_week_hours > 0 AND payroll_standard_week_hours <= 168.00);
  END IF;
END $$;

COMMENT ON COLUMN public.organizations.payroll_standard_week_hours IS
  'Regular weekly hours before weekly overtime begins for non-double-time hours.';
