BEGIN;

ALTER TABLE public.job_categories
  DROP COLUMN IF EXISTS current_hourly_rate;

COMMIT;
