-- Phase 1B (1/2): section source-of-truth on job_work_pool + job_cards.
--
-- DEVIATION from spec (documented): the spec proposed adding section_id to billoflabour OR jobs,
-- then editing every pool-insert path. Live verification showed BOL pool rows are generated
-- CLIENT-SIDE (JobCardsTab.tsx) and cutting_plan rows via an API route — editing each is fragile.
-- Instead a BEFORE INSERT trigger auto-derives section_id from the live factory_sections model
-- (job -> job_categories -> COALESCE(parent,self) -> factory_sections.category_id; cutting_plan ->
-- the Cut & Edge lane) and snapshots required_qty_per_finished_good from billoflabour.quantity.
-- This covers all insert paths at once.
--
-- section_id is NULLABLE (and NOT enforced NOT NULL): live data proved some job categories
-- (e.g. "Woodworking Finishing", category 16) map to NO factory_section. Forcing NOT NULL would
-- break issuance for those jobs — the exact failure the spec's round-1 reviewer flagged. Unmapped
-- rows simply don't roll up to ready (consistent with NULL work_pool_id handling).

ALTER TABLE public.job_work_pool
  ADD COLUMN IF NOT EXISTS section_id integer REFERENCES public.factory_sections(section_id),
  ADD COLUMN IF NOT EXISTS required_qty_per_finished_good numeric NOT NULL DEFAULT 1;

ALTER TABLE public.job_work_pool DROP CONSTRAINT IF EXISTS jwp_multiplier_positive_chk;
ALTER TABLE public.job_work_pool ADD CONSTRAINT jwp_multiplier_positive_chk
  CHECK (required_qty_per_finished_good > 0);

ALTER TABLE public.job_cards
  ADD COLUMN IF NOT EXISTS section_id integer REFERENCES public.factory_sections(section_id);

-- Derive trigger (runs for every job_work_pool insert path).
CREATE OR REPLACE FUNCTION public.derive_job_work_pool_section()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE v_cat integer; v_eff_cat integer;
BEGIN
  -- Snapshot the per-finished-good multiplier from the BOL line for bol-sourced rows.
  IF NEW.bol_id IS NOT NULL THEN
    NEW.required_qty_per_finished_good := GREATEST(
      COALESCE((SELECT quantity FROM public.billoflabour WHERE bol_id = NEW.bol_id), 1), 1);
  ELSIF NEW.required_qty_per_finished_good IS NULL OR NEW.required_qty_per_finished_good <= 0 THEN
    NEW.required_qty_per_finished_good := 1;
  END IF;

  -- Derive section only when not explicitly provided.
  IF NEW.section_id IS NULL THEN
    IF NEW.source = 'cutting_plan' THEN
      SELECT fs.section_id INTO NEW.section_id
      FROM public.factory_sections fs
      WHERE fs.is_active AND lower(fs.name) LIKE '%cut%edge%'
      ORDER BY fs.display_order LIMIT 1;
    ELSIF NEW.job_id IS NOT NULL THEN
      SELECT jb.category_id INTO v_cat FROM public.jobs jb WHERE jb.job_id = NEW.job_id;
      IF v_cat IS NOT NULL THEN
        SELECT COALESCE(jc.parent_category_id, jc.category_id) INTO v_eff_cat
        FROM public.job_categories jc WHERE jc.category_id = v_cat;
        SELECT fs.section_id INTO NEW.section_id
        FROM public.factory_sections fs
        WHERE fs.category_id = v_eff_cat AND fs.is_active
        ORDER BY fs.display_order LIMIT 1;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_derive_job_work_pool_section ON public.job_work_pool;
CREATE TRIGGER trg_derive_job_work_pool_section
  BEFORE INSERT ON public.job_work_pool
  FOR EACH ROW EXECUTE FUNCTION public.derive_job_work_pool_section();

-- ===== Backfill the 21 existing rows =====
UPDATE public.job_work_pool p
SET required_qty_per_finished_good = GREATEST(
      COALESCE((SELECT quantity FROM public.billoflabour b WHERE b.bol_id = p.bol_id), 1), 1)
WHERE p.bol_id IS NOT NULL;

UPDATE public.job_work_pool p
SET section_id = CASE
  WHEN p.source = 'cutting_plan' THEN
    (SELECT fs.section_id FROM public.factory_sections fs
      WHERE fs.is_active AND lower(fs.name) LIKE '%cut%edge%' ORDER BY fs.display_order LIMIT 1)
  WHEN p.job_id IS NOT NULL THEN
    (SELECT fs.section_id FROM public.jobs jb
       JOIN public.job_categories jc ON jc.category_id = jb.category_id
       JOIN public.factory_sections fs ON fs.category_id = COALESCE(jc.parent_category_id, jc.category_id) AND fs.is_active
      WHERE jb.job_id = p.job_id ORDER BY fs.display_order LIMIT 1)
  ELSE NULL END
WHERE p.section_id IS NULL;

-- Defensive assertion (round-3 MAJOR #2 spirit): every backfilled multiplier is > 0.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.job_work_pool WHERE required_qty_per_finished_good <= 0) THEN
    RAISE EXCEPTION 'Backfill produced a non-positive required_qty_per_finished_good';
  END IF;
END$$;

-- Manual-row grain invariant (round-2 MAJOR #6 / round-3 MINOR #2): one active manual pool row
-- per operation. Positive-enumeration predicate so future statuses don't silently collide.
CREATE UNIQUE INDEX IF NOT EXISTS job_work_pool_manual_op_uq
  ON public.job_work_pool (org_id, order_id, order_detail_id, section_id, job_id)
  WHERE source = 'manual' AND status = 'active';
