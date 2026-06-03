-- Phase 2 (1/2): the ready engine — all new functions/triggers. Additive: nothing here changes
-- the existing job-card completion flow (the cascade tail is wired into complete_job_card_v2 in 2/2).
-- Section model = factory_sections; readiness reads the per-detail snapshot order_detail_required_sections.

-- ===== stock-receipt number issuance (used by the auto-draft trigger + Phase 4 manual path) =====
CREATE OR REPLACE FUNCTION public.issue_stock_receipt_number(p_org_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_prefix text; v_start integer; v_next integer;
BEGIN
  SELECT stock_receipt_prefix, stock_receipt_starting_number INTO v_prefix, v_start
  FROM public.organizations WHERE id = p_org_id FOR UPDATE;   -- serialise per-org allocation
  v_prefix := COALESCE(v_prefix, 'SR-');
  v_start  := COALESCE(v_start, 1);
  SELECT COALESCE(MAX((substring(receipt_number FROM length(v_prefix) + 1))::integer), v_start - 1)
  INTO v_next
  FROM public.stock_receipts
  WHERE org_id = p_org_id
    AND receipt_number LIKE v_prefix || '%'
    AND substring(receipt_number FROM length(v_prefix) + 1) ~ '^[0-9]+$';
  v_next := GREATEST(v_next + 1, v_start);
  RETURN v_prefix || lpad(v_next::text, 4, '0');
END$$;

-- ===== single-writer order status-event logger =====
CREATE OR REPLACE FUNCTION public.log_order_status_event()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE v_source text; v_reason text; v_actor uuid;
BEGIN
  IF NEW.status_id IS NOT DISTINCT FROM OLD.status_id THEN RETURN NEW; END IF;
  IF NEW.status_id IS NULL THEN RETURN NEW; END IF;   -- never block a status clear
  v_source := NULLIF(current_setting('app.order_status_trigger_source', true), '');
  v_reason := NULLIF(current_setting('app.order_status_reason', true), '');
  BEGIN
    v_actor := NULLIF(current_setting('app.actor_id', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN v_actor := auth.uid();
  END;
  IF v_source IS NULL THEN v_source := 'user'; END IF;
  IF v_actor  IS NULL THEN v_actor  := auth.uid(); END IF;
  INSERT INTO public.order_status_events(org_id, order_id, from_status_id, to_status_id, changed_by, reason, trigger_source)
  VALUES (NEW.org_id, NEW.order_id, OLD.status_id, NEW.status_id, v_actor, v_reason, v_source);
  RETURN NEW;
END$$;
DROP TRIGGER IF EXISTS trg_log_order_status_event ON public.orders;
CREATE TRIGGER trg_log_order_status_event
  AFTER UPDATE OF status_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.log_order_status_event();

-- ===== Stage 1 promotion: Ready For Delivery (status_id = 1) =====
CREATE OR REPLACE FUNCTION public.check_order_readiness(p_order_id integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_status integer; v_all_ready boolean; v_has_details boolean;
BEGIN
  SELECT status_id INTO v_status FROM public.orders WHERE order_id = p_order_id;
  IF v_status IS NULL THEN RETURN; END IF;
  IF v_status IN (1, 30, 31) THEN RETURN; END IF;   -- already ready / completed / cancelled
  SELECT EXISTS (SELECT 1 FROM public.order_details WHERE order_id = p_order_id AND status <> 'cancelled')
    INTO v_has_details;
  IF NOT v_has_details THEN RETURN; END IF;
  SELECT NOT EXISTS (
    SELECT 1 FROM public.order_details
    WHERE order_id = p_order_id AND status <> 'cancelled' AND status <> 'ready'
  ) INTO v_all_ready;
  IF v_all_ready THEN
    PERFORM set_config('app.order_status_trigger_source', 'auto_ready', true);
    PERFORM set_config('app.order_status_reason', 'all lines ready', true);
    UPDATE public.orders SET status_id = 1 WHERE order_id = p_order_id AND status_id <> 1;
    PERFORM set_config('app.order_status_trigger_source', '', true);
    PERFORM set_config('app.order_status_reason', '', true);
  END IF;
END$$;

-- ===== the ready event =====
-- Per detail: per required section take MIN across operations of finished-good-normalised
-- completion; then MIN across required sections; cap at ordered qty. Monotonic + idempotent.
CREATE OR REPLACE FUNCTION public.mark_order_details_ready(p_job_card_id integer)
RETURNS SETOF integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_id integer;
  v_org uuid;
  rec record;
  v_new integer;
  v_ordered integer;
BEGIN
  SELECT jc.order_id, o.org_id INTO v_order_id, v_org
  FROM public.job_cards jc LEFT JOIN public.orders o ON o.order_id = jc.order_id
  WHERE jc.job_card_id = p_job_card_id;
  IF v_order_id IS NULL THEN RETURN; END IF;
  IF v_org IS NOT NULL AND NOT public.is_org_member(v_org) THEN
    RAISE EXCEPTION 'Access denied: not a member of this organisation';
  END IF;

  FOR rec IN
    WITH touched AS (
      SELECT DISTINCT jwp.order_detail_id AS detail_id
      FROM public.job_card_items jci
      JOIN public.job_work_pool jwp ON jwp.pool_id = jci.work_pool_id
      WHERE jci.job_card_id = p_job_card_id
        AND jci.work_pool_id IS NOT NULL
        AND jwp.order_detail_id IS NOT NULL
    ),
    op AS (   -- one row per active pool operation against a touched detail
      SELECT jwp.order_detail_id AS detail_id, jwp.section_id,
             jwp.required_qty, jwp.required_qty_per_finished_good AS mult,
             COALESCE((
               SELECT SUM(jci.completed_quantity) FROM public.job_card_items jci
               JOIN public.job_cards jc ON jc.job_card_id = jci.job_card_id
               WHERE jci.work_pool_id = jwp.pool_id
                 AND jc.status <> 'cancelled' AND jci.status <> 'cancelled'
             ), 0) AS completed
      FROM public.job_work_pool jwp
      WHERE jwp.order_detail_id IN (SELECT detail_id FROM touched)
        AND jwp.status <> 'cancelled'
    ),
    op_fg AS (   -- finished-good-normalised completion per operation
      SELECT detail_id, section_id,
             FLOOR(LEAST(completed, required_qty)::numeric / NULLIF(mult, 0)) AS op_units
      FROM op
    ),
    sec AS (   -- per required section: MIN across its operations (no ops -> 0)
      SELECT rs.order_detail_id AS detail_id, rs.section_id,
             COUNT(op_fg.op_units) AS op_count,
             COALESCE(MIN(op_fg.op_units), 0) AS section_units
      FROM public.order_detail_required_sections rs
      LEFT JOIN op_fg ON op_fg.detail_id = rs.order_detail_id AND op_fg.section_id = rs.section_id
      WHERE rs.order_detail_id IN (SELECT detail_id FROM touched)
      GROUP BY rs.order_detail_id, rs.section_id
    ),
    detail_calc AS (   -- MIN across required sections; sections with no ops contribute 0
      SELECT s.detail_id,
             MIN(CASE WHEN s.op_count = 0 THEN 0 ELSE s.section_units END) AS min_units,
             COUNT(*) AS section_count
      FROM sec s GROUP BY s.detail_id
    )
    SELECT dc.detail_id, dc.min_units, od.quantity AS ordered, od.ready_qty AS old_ready, od.status AS old_status
    FROM detail_calc dc JOIN public.order_details od ON od.order_detail_id = dc.detail_id
    WHERE COALESCE(od.quantity, 0) > 0 AND dc.section_count > 0
  LOOP
    v_ordered := COALESCE(rec.ordered, 0);
    v_new := LEAST(v_ordered, GREATEST(rec.min_units, 0))::integer;
    IF v_new > rec.old_ready AND rec.old_status <> 'cancelled' THEN
      UPDATE public.order_details
      SET ready_qty = v_new,
          status = CASE WHEN v_new >= v_ordered AND status <> 'cancelled' THEN 'ready' ELSE status END
      WHERE order_detail_id = rec.detail_id AND status <> 'cancelled';
      IF v_new >= v_ordered AND rec.old_status <> 'ready' THEN
        RETURN NEXT rec.detail_id;
      END IF;
    END IF;
  END LOOP;

  PERFORM public.check_order_readiness(v_order_id);
  RETURN;
END$$;

REVOKE EXECUTE ON FUNCTION public.mark_order_details_ready(integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mark_order_details_ready(integer) TO authenticated;

-- ===== order_details pending -> in_production on first job-card-item issuance =====
CREATE OR REPLACE FUNCTION public.mark_order_detail_in_production()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_detail integer;
BEGIN
  IF NEW.work_pool_id IS NULL THEN RETURN NEW; END IF;
  SELECT order_detail_id INTO v_detail FROM public.job_work_pool WHERE pool_id = NEW.work_pool_id;
  IF v_detail IS NULL THEN RETURN NEW; END IF;
  UPDATE public.order_details SET status = 'in_production'
   WHERE order_detail_id = v_detail AND status = 'pending';
  RETURN NEW;
END$$;
DROP TRIGGER IF EXISTS trg_jci_in_production ON public.job_card_items;
CREATE TRIGGER trg_jci_in_production
  AFTER INSERT ON public.job_card_items
  FOR EACH ROW EXECUTE FUNCTION public.mark_order_detail_in_production();

-- ===== auto-maintain a draft stock receipt for internal orders as ready_qty grows =====
CREATE OR REPLACE FUNCTION public.maintain_draft_stock_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_type text; v_delta integer; v_receipt_id bigint;
BEGIN
  v_delta := NEW.ready_qty - OLD.ready_qty;
  IF v_delta <= 0 THEN RETURN NEW; END IF;
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;
  SELECT order_type INTO v_type FROM public.orders WHERE order_id = NEW.order_id FOR SHARE;
  IF v_type IS DISTINCT FROM 'internal' THEN RETURN NEW; END IF;

  SELECT stock_receipt_id INTO v_receipt_id FROM public.stock_receipts
   WHERE org_id = NEW.org_id AND order_id = NEW.order_id AND status = 'draft' FOR UPDATE;

  IF v_receipt_id IS NULL THEN
    INSERT INTO public.stock_receipts(org_id, order_id, receipt_number, status, created_by)
    VALUES (NEW.org_id, NEW.order_id, public.issue_stock_receipt_number(NEW.org_id), 'draft', auth.uid())
    ON CONFLICT (org_id, order_id) WHERE status = 'draft' DO NOTHING
    RETURNING stock_receipt_id INTO v_receipt_id;
    IF v_receipt_id IS NULL THEN
      SELECT stock_receipt_id INTO v_receipt_id FROM public.stock_receipts
       WHERE org_id = NEW.org_id AND order_id = NEW.order_id AND status = 'draft' FOR UPDATE;
    END IF;
  END IF;

  INSERT INTO public.stock_receipt_items(org_id, stock_receipt_id, order_detail_id, product_id, quantity)
  VALUES (NEW.org_id, v_receipt_id, NEW.order_detail_id, NEW.product_id, v_delta)
  ON CONFLICT (stock_receipt_id, order_detail_id)
  DO UPDATE SET quantity = stock_receipt_items.quantity + EXCLUDED.quantity;

  RETURN NEW;
END$$;
DROP TRIGGER IF EXISTS trg_maintain_draft_stock_receipt ON public.order_details;
CREATE TRIGGER trg_maintain_draft_stock_receipt
  AFTER UPDATE OF ready_qty ON public.order_details
  FOR EACH ROW EXECUTE FUNCTION public.maintain_draft_stock_receipt();
