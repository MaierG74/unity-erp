-- Migration: Add time tracking to labor_plan_assignments
-- Purpose: Track job status lifecycle and capture actual times for averaging

-- ============================================
-- Part 1: Add status and time columns to labor_plan_assignments
-- ============================================

-- Add job_status column with lifecycle states
ALTER TABLE labor_plan_assignments
ADD COLUMN IF NOT EXISTS job_status TEXT DEFAULT 'scheduled'
CHECK (job_status IN ('scheduled', 'issued', 'in_progress', 'completed', 'on_hold'));

-- Add timestamp columns for tracking
ALTER TABLE labor_plan_assignments
ADD COLUMN IF NOT EXISTS issued_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE;

-- Add actual time columns (in minutes from midnight, like start_minutes/end_minutes)
ALTER TABLE labor_plan_assignments
ADD COLUMN IF NOT EXISTS actual_start_minutes INTEGER,
ADD COLUMN IF NOT EXISTS actual_end_minutes INTEGER,
ADD COLUMN IF NOT EXISTS actual_duration_minutes INTEGER;

-- Add notes field for completion notes
ALTER TABLE labor_plan_assignments
ADD COLUMN IF NOT EXISTS completion_notes TEXT;

-- Create index for status queries
CREATE INDEX IF NOT EXISTS idx_labor_assignments_status ON labor_plan_assignments(job_status);
CREATE INDEX IF NOT EXISTS idx_labor_assignments_date_status ON labor_plan_assignments(assignment_date, job_status);

-- Add comments
COMMENT ON COLUMN labor_plan_assignments.job_status IS 'Job lifecycle status: scheduled, issued, in_progress, completed, on_hold';
COMMENT ON COLUMN labor_plan_assignments.issued_at IS 'When the job card was printed/issued';
COMMENT ON COLUMN labor_plan_assignments.started_at IS 'When the worker started the job';
COMMENT ON COLUMN labor_plan_assignments.completed_at IS 'When the job was marked complete';
COMMENT ON COLUMN labor_plan_assignments.actual_start_minutes IS 'Actual start time in minutes from midnight';
COMMENT ON COLUMN labor_plan_assignments.actual_end_minutes IS 'Actual end time in minutes from midnight';
COMMENT ON COLUMN labor_plan_assignments.actual_duration_minutes IS 'Actual duration in minutes (calculated or entered)';

-- ============================================
-- Part 2: Create job_time_history table
-- ============================================

CREATE TABLE IF NOT EXISTS job_time_history (
  history_id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES jobs(job_id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(product_id) ON DELETE SET NULL,
  assignment_id BIGINT REFERENCES labor_plan_assignments(assignment_id) ON DELETE SET NULL,
  staff_id INTEGER REFERENCES staff(staff_id) ON DELETE SET NULL,

  -- Time data
  estimated_minutes INTEGER,
  actual_minutes INTEGER,
  variance_minutes INTEGER, -- actual - estimated (positive = took longer)

  -- Context
  order_id INTEGER,
  assignment_date DATE,
  pay_type TEXT CHECK (pay_type IN ('hourly', 'piece')),

  -- Metadata
  recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_job_time_history_job ON job_time_history(job_id);
CREATE INDEX IF NOT EXISTS idx_job_time_history_product ON job_time_history(product_id);
CREATE INDEX IF NOT EXISTS idx_job_time_history_job_product ON job_time_history(job_id, product_id);
CREATE INDEX IF NOT EXISTS idx_job_time_history_recorded ON job_time_history(recorded_at DESC);

-- Add comments
COMMENT ON TABLE job_time_history IS 'Historical time data for jobs, used to calculate averages';
COMMENT ON COLUMN job_time_history.variance_minutes IS 'Difference between actual and estimated (positive = took longer than expected)';

-- ============================================
-- Part 3: Enable RLS on job_time_history
-- ============================================

ALTER TABLE job_time_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read job_time_history" ON job_time_history
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated insert job_time_history" ON job_time_history
  FOR INSERT TO authenticated WITH CHECK (true);

-- ============================================
-- Part 4: Create function to get job time statistics
-- ============================================

CREATE OR REPLACE FUNCTION get_job_time_stats(p_job_id INTEGER, p_product_id INTEGER DEFAULT NULL)
RETURNS TABLE (
  avg_actual_minutes NUMERIC,
  avg_estimated_minutes NUMERIC,
  avg_variance_minutes NUMERIC,
  min_actual_minutes INTEGER,
  max_actual_minutes INTEGER,
  sample_size BIGINT,
  last_recorded_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ROUND(AVG(actual_minutes)::NUMERIC, 1) AS avg_actual_minutes,
    ROUND(AVG(estimated_minutes)::NUMERIC, 1) AS avg_estimated_minutes,
    ROUND(AVG(variance_minutes)::NUMERIC, 1) AS avg_variance_minutes,
    MIN(actual_minutes) AS min_actual_minutes,
    MAX(actual_minutes) AS max_actual_minutes,
    COUNT(*) AS sample_size,
    MAX(recorded_at) AS last_recorded_at
  FROM job_time_history
  WHERE job_id = p_job_id
    AND (p_product_id IS NULL OR product_id = p_product_id);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_job_time_stats IS 'Get time statistics for a job, optionally filtered by product';

-- ============================================
-- Part 5: Create function to record time history on completion
-- ============================================

CREATE OR REPLACE FUNCTION record_job_time_on_complete()
RETURNS TRIGGER AS $$
DECLARE
  v_estimated_minutes INTEGER;
  v_job_id INTEGER;
  v_product_id INTEGER;
BEGIN
  -- Only trigger when status changes to 'completed'
  IF NEW.job_status = 'completed' AND (OLD.job_status IS NULL OR OLD.job_status <> 'completed') THEN
    -- Get job_id and estimated time from the assignment or BOL
    v_job_id := NEW.job_id;

    -- Try to get product_id from order_details if we have order_detail_id
    IF NEW.order_detail_id IS NOT NULL THEN
      SELECT od.product_id INTO v_product_id
      FROM order_details od
      WHERE od.order_detail_id = NEW.order_detail_id;
    END IF;

    -- Try to get estimated minutes from BOL if we have bol_id
    IF NEW.bol_id IS NOT NULL THEN
      SELECT
        CASE
          WHEN bol.time_unit = 'hours' THEN ROUND(bol.time_required * 60)
          WHEN bol.time_unit = 'minutes' THEN bol.time_required
          WHEN bol.time_unit = 'seconds' THEN ROUND(bol.time_required / 60)
          ELSE bol.time_required * 60 -- default assume hours
        END::INTEGER
      INTO v_estimated_minutes
      FROM billoflabour bol
      WHERE bol.bol_id = NEW.bol_id;
    END IF;

    -- Calculate actual duration if not provided
    IF NEW.actual_duration_minutes IS NULL AND NEW.actual_start_minutes IS NOT NULL AND NEW.actual_end_minutes IS NOT NULL THEN
      NEW.actual_duration_minutes := NEW.actual_end_minutes - NEW.actual_start_minutes;
    END IF;

    -- Insert time history record
    IF NEW.actual_duration_minutes IS NOT NULL THEN
      INSERT INTO job_time_history (
        job_id,
        product_id,
        assignment_id,
        staff_id,
        estimated_minutes,
        actual_minutes,
        variance_minutes,
        order_id,
        assignment_date,
        pay_type
      ) VALUES (
        v_job_id,
        v_product_id,
        NEW.assignment_id,
        NEW.staff_id,
        v_estimated_minutes,
        NEW.actual_duration_minutes,
        NEW.actual_duration_minutes - COALESCE(v_estimated_minutes, NEW.actual_duration_minutes),
        NEW.order_id,
        NEW.assignment_date,
        NEW.pay_type
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS trg_record_job_time_on_complete ON labor_plan_assignments;
CREATE TRIGGER trg_record_job_time_on_complete
  BEFORE UPDATE ON labor_plan_assignments
  FOR EACH ROW
  EXECUTE FUNCTION record_job_time_on_complete();

COMMENT ON FUNCTION record_job_time_on_complete IS 'Automatically records time history when a job is marked complete';

-- ============================================
-- Part 6: View for jobs currently out in factory
-- ============================================

CREATE OR REPLACE VIEW jobs_in_factory AS
SELECT
  lpa.assignment_id,
  lpa.job_instance_id,
  lpa.order_id,
  o.id AS order_number,
  lpa.job_id,
  j.name AS job_name,
  lpa.staff_id,
  CONCAT(s.first_name, ' ', s.last_name) AS staff_name,
  lpa.assignment_date,
  lpa.start_minutes,
  lpa.end_minutes,
  lpa.job_status,
  lpa.issued_at,
  lpa.started_at,
  lpa.completed_at,
  lpa.actual_start_minutes,
  lpa.actual_end_minutes,
  lpa.actual_duration_minutes,
  CASE
    WHEN lpa.job_status = 'issued' THEN EXTRACT(EPOCH FROM (NOW() - lpa.issued_at)) / 60
    WHEN lpa.job_status = 'in_progress' THEN EXTRACT(EPOCH FROM (NOW() - lpa.started_at)) / 60
    ELSE NULL
  END::INTEGER AS minutes_elapsed,
  p.name AS product_name,
  p.internal_code AS product_code
FROM labor_plan_assignments lpa
LEFT JOIN jobs j ON lpa.job_id = j.job_id
LEFT JOIN staff s ON lpa.staff_id = s.staff_id
LEFT JOIN orders o ON lpa.order_id = o.order_id
LEFT JOIN order_details od ON lpa.order_detail_id = od.order_detail_id
LEFT JOIN products p ON od.product_id = p.product_id
WHERE lpa.job_status IN ('issued', 'in_progress')
ORDER BY
  CASE lpa.job_status
    WHEN 'in_progress' THEN 1
    WHEN 'issued' THEN 2
  END,
  lpa.issued_at ASC;

COMMENT ON VIEW jobs_in_factory IS 'Shows all jobs currently issued or in progress on the factory floor';
