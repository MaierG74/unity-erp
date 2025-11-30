-- Piecework support for Bill of Labour

-- 1) Add pay_type and piece_rate_id to billoflabour
ALTER TABLE public.billoflabour
  ADD COLUMN IF NOT EXISTS pay_type TEXT NOT NULL DEFAULT 'hourly',
  ADD COLUMN IF NOT EXISTS piece_rate_id INTEGER REFERENCES public.piece_work_rates(rate_id);

-- 2) Constrain pay_type values
ALTER TABLE public.billoflabour
  ADD CONSTRAINT billoflabour_pay_type_chk
  CHECK (pay_type IN ('hourly','piece'));

-- 3) Enforce pairing rules: hourly needs rate_id; piece needs piece_rate_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'billoflabour_pay_pairing_chk'
  ) THEN
    ALTER TABLE public.billoflabour
      ADD CONSTRAINT billoflabour_pay_pairing_chk
      CHECK (
        (pay_type = 'hourly' AND rate_id IS NOT NULL AND piece_rate_id IS NULL)
        OR
        (pay_type = 'piece' AND piece_rate_id IS NOT NULL)
      );
  END IF;
END$$;

-- 4) Index to accelerate effective rate lookups on piece_work_rates
CREATE INDEX IF NOT EXISTS idx_piece_rates_lookup
  ON public.piece_work_rates (job_id, product_id, effective_date);

-- 5) Optional: ensure product_id nullable supports job default
-- (Assumes existing schema permits NULL product_id on piece_work_rates)

-- Note: UI will set time_required NULL/0 for piece lines; hourly lines keep time fields.

