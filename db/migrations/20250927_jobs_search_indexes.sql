-- Jobs search performance indexes
-- Purpose: Speed up category-filtered and name search for large job lists.
-- Safe to run multiple times (IF NOT EXISTS guards).

-- 1) Enable pg_trgm for fuzzy/ILIKE acceleration (no-op if already enabled)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2) Composite index for category + case-insensitive name filtering/order
--    Supports queries that filter by category_id and ILIKE/ORDER BY name
CREATE INDEX IF NOT EXISTS idx_jobs_category_lower_name
  ON public.jobs (category_id, lower(name));

-- 3) Trigram index to accelerate ILIKE '%term%'
--    This helps when no category filter is present or for fuzzy matching
CREATE INDEX IF NOT EXISTS idx_jobs_name_trgm
  ON public.jobs USING gin (name gin_trgm_ops);
