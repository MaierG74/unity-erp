-- Reconciles production migration history for quote overhead lines.
-- Production has this version applied; keep the file locally so migration history stays append-only.

ALTER TYPE public.quote_cluster_line_type
  ADD VALUE IF NOT EXISTS 'overhead';

ALTER TABLE public.quote_cluster_lines
  ADD COLUMN IF NOT EXISTS overhead_element_id bigint,
  ADD COLUMN IF NOT EXISTS overhead_cost_type text,
  ADD COLUMN IF NOT EXISTS overhead_percentage_basis text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quote_cluster_lines_overhead_element_id_fkey'
  ) THEN
    ALTER TABLE public.quote_cluster_lines
      ADD CONSTRAINT quote_cluster_lines_overhead_element_id_fkey
      FOREIGN KEY (overhead_element_id)
      REFERENCES public.overhead_cost_elements(element_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_overhead_cost_type'
  ) THEN
    ALTER TABLE public.quote_cluster_lines
      ADD CONSTRAINT chk_overhead_cost_type
      CHECK (
        overhead_cost_type IS NULL
        OR overhead_cost_type = ANY (ARRAY['fixed'::text, 'percentage'::text])
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_overhead_percentage_basis'
  ) THEN
    ALTER TABLE public.quote_cluster_lines
      ADD CONSTRAINT chk_overhead_percentage_basis
      CHECK (
        overhead_percentage_basis IS NULL
        OR overhead_percentage_basis = ANY (ARRAY['materials'::text, 'labor'::text, 'total'::text])
      );
  END IF;
END
$$;
