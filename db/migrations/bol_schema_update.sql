-- Add description field to job_categories table
ALTER TABLE job_categories ADD COLUMN IF NOT EXISTS description TEXT;

-- Add current_hourly_rate field to job_categories table
ALTER TABLE job_categories ADD COLUMN IF NOT EXISTS current_hourly_rate DECIMAL(10, 2) NOT NULL DEFAULT 0;

-- Create job_category_rates table for versioned rates
CREATE TABLE IF NOT EXISTS job_category_rates (
  rate_id SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES job_categories(category_id) ON DELETE CASCADE,
  hourly_rate DECIMAL(10, 2) NOT NULL,
  effective_date DATE NOT NULL,
  end_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Ensure rates don't overlap for the same category
  CONSTRAINT no_overlapping_rates UNIQUE (category_id, effective_date),
  
  -- Ensure end_date is after effective_date if provided
  CONSTRAINT valid_date_range CHECK (end_date IS NULL OR end_date > effective_date)
);

-- Create index for faster lookups of current rates
CREATE INDEX IF NOT EXISTS idx_category_rates_lookup ON job_category_rates (category_id, effective_date);

-- Update jobs table to reference categories instead of having direct cost
ALTER TABLE jobs DROP COLUMN IF EXISTS cost_per_unit_time;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES job_categories(category_id);

-- Update billoflabour table to include time units, quantity, and rate reference
ALTER TABLE billoflabour ADD COLUMN IF NOT EXISTS time_unit VARCHAR(10) NOT NULL DEFAULT 'hours';
ALTER TABLE billoflabour ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;
ALTER TABLE billoflabour ADD COLUMN IF NOT EXISTS rate_id INTEGER REFERENCES job_category_rates(rate_id);

-- Migrate existing data (example - adjust as needed)
-- This assumes you have existing data to migrate
-- If this is a new system, you can remove or modify these statements

-- First, create a default category for existing jobs if needed
INSERT INTO job_categories (name, current_hourly_rate)
SELECT 'Default Category', 0
WHERE NOT EXISTS (SELECT 1 FROM job_categories WHERE name = 'Default Category');

-- Then, update jobs to use the default category if they don't have one
UPDATE jobs 
SET category_id = (SELECT category_id FROM job_categories WHERE name = 'Default Category')
WHERE category_id IS NULL;

-- Create initial rate entries for each category
INSERT INTO job_category_rates (category_id, hourly_rate, effective_date)
SELECT category_id, current_hourly_rate, CURRENT_DATE
FROM job_categories
WHERE NOT EXISTS (
  SELECT 1 FROM job_category_rates r 
  WHERE r.category_id = job_categories.category_id
);

-- Make category_id NOT NULL after migration
ALTER TABLE jobs ALTER COLUMN category_id SET NOT NULL; 