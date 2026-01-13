-- Step 1: Create hourly rate for QC category (category_id=1)
INSERT INTO job_category_rates (category_id, hourly_rate, effective_date)
VALUES (1, 50.00, '2024-01-01')
ON CONFLICT DO NOTHING;

-- Step 2: Update the problematic billoflabour row to use the rate
UPDATE billoflabour
SET rate_id = (
  SELECT rate_id
  FROM job_category_rates
  WHERE category_id = 1
  ORDER BY rate_id DESC
  LIMIT 1
)
WHERE bol_id = 1 AND pay_type = 'hourly';

-- Step 3: Verify the fix
SELECT
  'AFTER FIX:' as status,
  bol_id,
  product_id,
  job_id,
  pay_type,
  rate_id,
  piece_rate_id,
  CASE
    WHEN pay_type = 'hourly' AND rate_id IS NOT NULL AND piece_rate_id IS NULL
    THEN '✅ CONSTRAINT SATISFIED'
    WHEN pay_type = 'piece' AND piece_rate_id IS NOT NULL
    THEN '✅ CONSTRAINT SATISFIED'
    ELSE '❌ CONSTRAINT VIOLATED'
  END as validation
FROM billoflabour
WHERE bol_id = 1;
