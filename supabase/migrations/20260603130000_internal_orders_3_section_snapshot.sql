-- Phase 3 (DB): per-order_detail section-route snapshot, created automatically on order_detail
-- insert. Resolution: product_sections override -> BOL-derived sections (the product's
-- billoflabour operations mapped to factory_sections) -> Assembly fallback. This is the
-- authority read by mark_order_details_ready. DB-trigger approach covers every order-creation
-- path (manual, from-quote, internal) with no UI change. Exception-guarded so a derivation
-- failure can never block order creation.

CREATE OR REPLACE FUNCTION public.snapshot_order_detail_sections(p_order_detail_id integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_org uuid; v_product integer; v_count integer;
BEGIN
  SELECT org_id, product_id INTO v_org, v_product FROM public.order_details WHERE order_detail_id = p_order_detail_id;
  IF v_org IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.order_detail_required_sections WHERE order_detail_id = p_order_detail_id) THEN RETURN; END IF;

  -- 1) explicit per-org product route override
  IF v_product IS NOT NULL AND EXISTS (SELECT 1 FROM public.product_sections WHERE org_id = v_org AND product_id = v_product) THEN
    INSERT INTO public.order_detail_required_sections(org_id, order_detail_id, section_id, sequence_order, source)
    SELECT v_org, p_order_detail_id, ps.section_id, ps.sequence_order, 'product_sections'
    FROM public.product_sections ps WHERE ps.org_id = v_org AND ps.product_id = v_product;
    RETURN;
  END IF;

  -- 2) derive from the product's BOL operations (mapped to factory_sections)
  IF v_product IS NOT NULL THEN
    INSERT INTO public.order_detail_required_sections(org_id, order_detail_id, section_id, sequence_order, source)
    SELECT v_org, p_order_detail_id, s.section_id, row_number() OVER (ORDER BY s.display_order), 'bol_derived'
    FROM (
      SELECT DISTINCT fs.section_id, fs.display_order
      FROM public.billoflabour bol
      JOIN public.jobs jb ON jb.job_id = bol.job_id
      JOIN public.job_categories jc ON jc.category_id = jb.category_id
      JOIN public.factory_sections fs ON fs.category_id = COALESCE(jc.parent_category_id, jc.category_id) AND fs.is_active
      WHERE bol.product_id = v_product AND bol.org_id = v_org
    ) s;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count > 0 THEN RETURN; END IF;
  END IF;

  -- 3) fallback: single Assembly section
  INSERT INTO public.order_detail_required_sections(org_id, order_detail_id, section_id, sequence_order, source)
  SELECT v_org, p_order_detail_id, fs.section_id, 1, 'fallback'
  FROM public.factory_sections fs
  WHERE fs.is_active AND lower(fs.name) = 'assembly'
  ORDER BY fs.display_order LIMIT 1;
END$$;

CREATE OR REPLACE FUNCTION public.trg_snapshot_order_detail_sections()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    PERFORM public.snapshot_order_detail_sections(NEW.order_detail_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'snapshot_order_detail_sections failed for detail %: %', NEW.order_detail_id, SQLERRM;
  END;
  RETURN NEW;
END$$;
DROP TRIGGER IF EXISTS trg_order_detail_snapshot ON public.order_details;
CREATE TRIGGER trg_order_detail_snapshot
  AFTER INSERT ON public.order_details
  FOR EACH ROW EXECUTE FUNCTION public.trg_snapshot_order_detail_sections();

-- Backfill helper for an existing order (used by the internal-order UI "re-derive route" action,
-- and available for an optional historical backfill — NOT auto-run here per spec non-goal).
CREATE OR REPLACE FUNCTION public.snapshot_order_sections(p_order_id integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_detail integer; v_n integer := 0;
BEGIN
  FOR v_detail IN SELECT order_detail_id FROM public.order_details WHERE order_id = p_order_id LOOP
    PERFORM public.snapshot_order_detail_sections(v_detail);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END$$;
