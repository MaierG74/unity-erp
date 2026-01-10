-- Migration: Create labor_roles table and add role_id to jobs
-- Purpose: Enable role-based job-to-staff matching for labor planning

-- ============================================
-- Part 1: Create labor_roles table
-- ============================================

CREATE TABLE IF NOT EXISTS labor_roles (
  role_id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  color TEXT, -- For visual distinction on planning board
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add comment for documentation
COMMENT ON TABLE labor_roles IS 'Defines roles for labor planning - maps jobs to staff capabilities';
COMMENT ON COLUMN labor_roles.name IS 'Role name matching staff job_description values';
COMMENT ON COLUMN labor_roles.color IS 'Hex color code for visual distinction in UI';

-- Create index for name lookups
CREATE INDEX IF NOT EXISTS idx_labor_roles_name ON labor_roles(name);

-- ============================================
-- Part 2: Seed with existing staff roles
-- ============================================

-- Insert unique job_description values from staff table
INSERT INTO labor_roles (name)
SELECT DISTINCT job_description
FROM staff
WHERE job_description IS NOT NULL
  AND TRIM(job_description) <> ''
ON CONFLICT (name) DO NOTHING;

-- ============================================
-- Part 3: Add role_id to jobs table
-- ============================================

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES labor_roles(role_id);

-- Create index for role lookups
CREATE INDEX IF NOT EXISTS idx_jobs_role_id ON jobs(role_id);

-- Add comment
COMMENT ON COLUMN jobs.role_id IS 'Links job to a labor role for staff matching in planning';

-- ============================================
-- Part 4: Enable RLS on labor_roles
-- ============================================

ALTER TABLE labor_roles ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read roles
CREATE POLICY "Allow authenticated read labor_roles" ON labor_roles
  FOR SELECT TO authenticated USING (true);

-- Allow authenticated users to insert/update roles
CREATE POLICY "Allow authenticated insert labor_roles" ON labor_roles
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated update labor_roles" ON labor_roles
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ============================================
-- Part 5: Auto-suggest roles for existing jobs
-- This creates a function to suggest role_id based on category name
-- ============================================

CREATE OR REPLACE FUNCTION suggest_job_role(p_job_id INTEGER)
RETURNS INTEGER AS $$
DECLARE
  v_category_name TEXT;
  v_suggested_role_id INTEGER;
BEGIN
  -- Get the job's category name
  SELECT jc.name INTO v_category_name
  FROM jobs j
  JOIN job_categories jc ON j.category_id = jc.category_id
  WHERE j.job_id = p_job_id;

  IF v_category_name IS NULL THEN
    RETURN NULL;
  END IF;

  -- Try to find a matching role based on category name similarity
  -- Check for common patterns: "Assembly" category -> "Assembler" role
  SELECT role_id INTO v_suggested_role_id
  FROM labor_roles
  WHERE
    -- Exact match (case insensitive)
    LOWER(name) = LOWER(v_category_name)
    -- Or category contains role name
    OR LOWER(v_category_name) LIKE '%' || LOWER(name) || '%'
    -- Or role contains category name
    OR LOWER(name) LIKE '%' || LOWER(v_category_name) || '%'
    -- Common variations
    OR (LOWER(v_category_name) LIKE '%assembly%' AND LOWER(name) LIKE '%assembl%')
    OR (LOWER(v_category_name) LIKE '%steel%' AND LOWER(name) LIKE '%steel%')
    OR (LOWER(v_category_name) LIKE '%weld%' AND LOWER(name) LIKE '%weld%')
    OR (LOWER(v_category_name) LIKE '%powder%' AND LOWER(name) LIKE '%powder%')
    OR (LOWER(v_category_name) LIKE '%paint%' AND LOWER(name) LIKE '%paint%')
    OR (LOWER(v_category_name) LIKE '%cut%' AND LOWER(name) LIKE '%cut%')
    OR (LOWER(v_category_name) LIKE '%finish%' AND LOWER(name) LIKE '%finish%')
    OR (LOWER(v_category_name) LIKE '%quality%' AND LOWER(name) LIKE '%quality%')
  ORDER BY
    -- Prefer exact matches
    CASE WHEN LOWER(name) = LOWER(v_category_name) THEN 0 ELSE 1 END,
    -- Then prefer shorter names (more specific)
    LENGTH(name)
  LIMIT 1;

  RETURN v_suggested_role_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION suggest_job_role IS 'Suggests a role_id for a job based on category name matching';

-- ============================================
-- Part 6: View to show jobs with suggested roles
-- ============================================

CREATE OR REPLACE VIEW jobs_with_role_suggestions AS
SELECT
  j.job_id,
  j.name AS job_name,
  j.role_id AS current_role_id,
  lr.name AS current_role_name,
  jc.name AS category_name,
  suggest_job_role(j.job_id) AS suggested_role_id,
  (SELECT name FROM labor_roles WHERE role_id = suggest_job_role(j.job_id)) AS suggested_role_name
FROM jobs j
LEFT JOIN labor_roles lr ON j.role_id = lr.role_id
LEFT JOIN job_categories jc ON j.category_id = jc.category_id;

COMMENT ON VIEW jobs_with_role_suggestions IS 'Shows jobs with their current and suggested roles';
