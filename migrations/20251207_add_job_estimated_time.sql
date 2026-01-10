-- Migration: Add estimated time to jobs table
-- Purpose: Store standard time estimate per job for labor planning and costing

-- Add estimated time columns to jobs table
ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS estimated_minutes DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS time_unit TEXT DEFAULT 'hours' CHECK (time_unit IN ('hours', 'minutes', 'seconds'));

-- Add index for queries
CREATE INDEX IF NOT EXISTS idx_jobs_estimated_minutes ON jobs(estimated_minutes) WHERE estimated_minutes IS NOT NULL;

-- Add comments
COMMENT ON COLUMN jobs.estimated_minutes IS 'Standard estimated time for this job (used as default in BOL and labor planning)';
COMMENT ON COLUMN jobs.time_unit IS 'Unit for estimated_minutes (hours, minutes, or seconds)';
