-- Delivery-note scan + PO match (POL-101, plan §4.4).
-- Promotes the Matt delivery-note OCR skill into a first-class workflow on
-- the closure engine. This migration ships the supabase side:
--
--   1. public.delivery_note_scans — per-scan dedup table. Image hash unique
--      per org so re-uploads of the same photo route to the existing row.
--   2. public.record_delivery_note_scan(...) — idempotent insert; if the
--      (org_id, image_hash) already exists, returns the existing row.
--   3. public.match_delivery_note_to_po(...) — takes the OCR'd lines and
--      classifies each against the PO's outstanding supplier-order lines.
--      Caller (Sam/Matt runtime in OpenClaw) is responsible for resolving
--      raw supplier_code / description to supplier_component_id BEFORE
--      calling — fuzzy text matching stays in the LLM-aware runtime; SQL
--      just validates and computes the variance.
--
-- Closure-item registration for exception lines is done by the runtime
-- via the existing register_closure_item wrapper with
-- source_fingerprint = 'delivery_note_line:<delivery_note_scan_id>:<input_index>'.
-- The partial-unique on closure_items handles replay-safety.

-- =========================================================================
-- delivery_note_scans
-- =========================================================================

CREATE TABLE public.delivery_note_scans (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                        UUID NOT NULL REFERENCES public.organizations(id),
  image_hash                    TEXT NOT NULL,
  supplier_id                   INTEGER REFERENCES public.suppliers(supplier_id),
  q_number                      TEXT,
  delivery_note_number          TEXT,
  scanned_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scanned_by_agent_id           TEXT,
  scanned_by_telegram_user_id   TEXT,
  scanned_by_user_id            UUID REFERENCES auth.users(id),
  storage_path                  TEXT,
  ocr_payload                   JSONB NOT NULL DEFAULT '{}'::jsonb,
  match_payload                 JSONB,
  status                        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'matched', 'received', 'cancelled')),
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, image_hash)
);

CREATE INDEX delivery_note_scans_supplier_idx
  ON public.delivery_note_scans (org_id, supplier_id, created_at DESC)
  WHERE supplier_id IS NOT NULL;

CREATE INDEX delivery_note_scans_q_number_idx
  ON public.delivery_note_scans (org_id, q_number)
  WHERE q_number IS NOT NULL;

CREATE INDEX delivery_note_scans_status_idx
  ON public.delivery_note_scans (org_id, status, created_at DESC);

CREATE TRIGGER delivery_note_scans_set_updated_at
  BEFORE UPDATE ON public.delivery_note_scans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.delivery_note_scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_read_delivery_note_scans" ON public.delivery_note_scans
  FOR SELECT USING (public.is_org_member(org_id));
-- Writes via service_role through the RPCs below.

COMMENT ON TABLE public.delivery_note_scans IS
  'One row per delivery-note photo scan. UNIQUE (org_id, image_hash) drives dedup — re-uploading the same photo routes to the existing row. See POL-101 / plan §4.4.';

-- =========================================================================
-- record_delivery_note_scan — idempotent INSERT-or-return-existing
-- =========================================================================

CREATE OR REPLACE FUNCTION public.record_delivery_note_scan(
  p_org_id                       UUID,
  p_image_hash                   TEXT,
  p_supplier_id                  INTEGER DEFAULT NULL,
  p_q_number                     TEXT DEFAULT NULL,
  p_delivery_note_number         TEXT DEFAULT NULL,
  p_scanned_by_agent_id          TEXT DEFAULT NULL,
  p_scanned_by_telegram_user_id  TEXT DEFAULT NULL,
  p_scanned_by_user_id           UUID DEFAULT NULL,
  p_storage_path                 TEXT DEFAULT NULL,
  p_ocr_payload                  JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.delivery_note_scans%ROWTYPE;
  v_new_id   UUID;
BEGIN
  IF p_org_id IS NULL THEN RAISE EXCEPTION 'p_org_id is required'; END IF;
  IF p_image_hash IS NULL OR p_image_hash = '' THEN
    RAISE EXCEPTION 'p_image_hash is required';
  END IF;

  -- Dedup path: same (org_id, image_hash) → return the existing row.
  SELECT * INTO v_existing
    FROM public.delivery_note_scans
   WHERE org_id = p_org_id AND image_hash = p_image_hash;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'is_duplicate', true,
      'id', v_existing.id,
      'status', v_existing.status,
      'supplier_id', v_existing.supplier_id,
      'q_number', v_existing.q_number,
      'delivery_note_number', v_existing.delivery_note_number,
      'scanned_at', v_existing.scanned_at,
      'created_at', v_existing.created_at
    );
  END IF;

  INSERT INTO public.delivery_note_scans (
    org_id, image_hash, supplier_id, q_number, delivery_note_number,
    scanned_by_agent_id, scanned_by_telegram_user_id, scanned_by_user_id,
    storage_path, ocr_payload
  ) VALUES (
    p_org_id, p_image_hash, p_supplier_id, p_q_number, p_delivery_note_number,
    p_scanned_by_agent_id, p_scanned_by_telegram_user_id, p_scanned_by_user_id,
    p_storage_path, COALESCE(p_ocr_payload, '{}'::jsonb)
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'is_duplicate', false,
    'id', v_new_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_delivery_note_scan(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_delivery_note_scan(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, JSONB) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.record_delivery_note_scan(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, JSONB) TO service_role;

COMMENT ON FUNCTION public.record_delivery_note_scan(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, JSONB) IS
  'Idempotent INSERT into delivery_note_scans keyed by (org_id, image_hash). Returns {is_duplicate, id, ...}. POL-101 / plan §4.4.';

-- =========================================================================
-- match_delivery_note_to_po — classify OCR lines against the PO
-- =========================================================================

CREATE OR REPLACE FUNCTION public.match_delivery_note_to_po(
  p_org_id    UUID,
  p_q_number  TEXT,
  p_lines     JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po                 RECORD;
  v_line_results       JSONB := '[]'::jsonb;
  v_unmatched_po_rows  JSONB;
  v_line               JSONB;
  v_line_idx           INT  := 0;
  v_supplier_component_id INT;
  v_delivered_qty      NUMERIC;
  v_so                 RECORD;
  v_seen_so_ids        INT[] := ARRAY[]::INT[];
  v_classification     TEXT;
  v_outstanding        NUMERIC;
  v_variance           NUMERIC;
  v_dup_count          INT;
BEGIN
  IF p_org_id IS NULL THEN RAISE EXCEPTION 'p_org_id is required'; END IF;
  IF p_q_number IS NULL OR p_q_number = '' THEN
    RAISE EXCEPTION 'p_q_number is required';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'p_lines must be a JSON array';
  END IF;

  -- 1. Resolve the PO.
  SELECT po.purchase_order_id, po.supplier_id, po.q_number, s.name AS supplier_name
    INTO v_po
    FROM public.purchase_orders po
    JOIN public.suppliers s ON s.supplier_id = po.supplier_id
   WHERE po.org_id = p_org_id AND po.q_number = p_q_number;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'matched', false,
      'reason', 'po_not_found',
      'q_number', p_q_number
    );
  END IF;

  -- 2. Classify each delivery-note line.
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_supplier_component_id := NULLIF(v_line->>'supplier_component_id', '')::INT;
    v_delivered_qty := COALESCE(NULLIF(v_line->>'delivered_qty', '')::NUMERIC, 0);

    IF v_supplier_component_id IS NULL THEN
      v_line_results := v_line_results || jsonb_build_object(
        'input_index', v_line_idx,
        'classification', 'unknown',
        'reason', 'supplier_component_id missing — runtime did not resolve a match',
        'delivered_qty', v_delivered_qty,
        'raw_supplier_code', v_line->>'raw_supplier_code',
        'raw_description', v_line->>'raw_description'
      );
      v_line_idx := v_line_idx + 1;
      CONTINUE;
    END IF;

    -- Duplicate check (same supplier_component_id appearing multiple times in p_lines).
    SELECT count(*) INTO v_dup_count
      FROM jsonb_array_elements(p_lines) l
     WHERE NULLIF(l->>'supplier_component_id', '')::INT = v_supplier_component_id;

    SELECT so.order_id AS supplier_order_id,
           so.order_quantity, so.total_received, so.closed_quantity,
           sc.supplier_code, sc.component_id,
           c.internal_code, c.description
      INTO v_so
      FROM public.supplier_orders so
      JOIN public.suppliercomponents sc ON sc.supplier_component_id = so.supplier_component_id
      JOIN public.components c ON c.component_id = sc.component_id
     WHERE so.org_id = p_org_id
       AND so.purchase_order_id = v_po.purchase_order_id
       AND so.supplier_component_id = v_supplier_component_id;

    IF NOT FOUND THEN
      v_line_results := v_line_results || jsonb_build_object(
        'input_index', v_line_idx,
        'classification', 'unknown',
        'reason', 'supplier_component_id not found on this PO',
        'supplier_component_id', v_supplier_component_id,
        'delivered_qty', v_delivered_qty,
        'raw_supplier_code', v_line->>'raw_supplier_code',
        'raw_description', v_line->>'raw_description'
      );
      v_line_idx := v_line_idx + 1;
      CONTINUE;
    END IF;

    v_seen_so_ids := array_append(v_seen_so_ids, v_so.supplier_order_id);
    v_outstanding := v_so.order_quantity - COALESCE(v_so.total_received, 0) - v_so.closed_quantity;
    v_variance := v_delivered_qty - v_outstanding;

    IF v_dup_count > 1 THEN
      v_classification := 'duplicate';
    ELSIF v_variance = 0 THEN
      v_classification := 'clean';
    ELSIF v_variance < 0 THEN
      v_classification := 'short';
    ELSE
      v_classification := 'over';
    END IF;

    v_line_results := v_line_results || jsonb_build_object(
      'input_index', v_line_idx,
      'classification', v_classification,
      'supplier_component_id', v_supplier_component_id,
      'supplier_order_id', v_so.supplier_order_id,
      'component_id', v_so.component_id,
      'internal_code', v_so.internal_code,
      'description', v_so.description,
      'supplier_code', v_so.supplier_code,
      'ordered_qty', v_so.order_quantity,
      'total_received', COALESCE(v_so.total_received, 0),
      'closed_quantity', v_so.closed_quantity,
      'outstanding_qty', v_outstanding,
      'delivered_qty', v_delivered_qty,
      'variance', v_variance
    );

    v_line_idx := v_line_idx + 1;
  END LOOP;

  -- 3. PO lines NOT covered by the delivery note. Only those still outstanding.
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'supplier_order_id', so.order_id,
             'supplier_component_id', so.supplier_component_id,
             'internal_code', c.internal_code,
             'description', c.description,
             'supplier_code', sc.supplier_code,
             'ordered_qty', so.order_quantity,
             'total_received', COALESCE(so.total_received, 0),
             'closed_quantity', so.closed_quantity,
             'outstanding_qty', so.order_quantity - COALESCE(so.total_received, 0) - so.closed_quantity
           )
         ), '[]'::jsonb)
    INTO v_unmatched_po_rows
    FROM public.supplier_orders so
    JOIN public.suppliercomponents sc ON sc.supplier_component_id = so.supplier_component_id
    JOIN public.components c ON c.component_id = sc.component_id
   WHERE so.org_id = p_org_id
     AND so.purchase_order_id = v_po.purchase_order_id
     AND (so.order_quantity - COALESCE(so.total_received, 0) - so.closed_quantity) > 0
     AND NOT (so.order_id = ANY (v_seen_so_ids));

  RETURN jsonb_build_object(
    'matched', true,
    'purchase_order_id', v_po.purchase_order_id,
    'supplier_id', v_po.supplier_id,
    'supplier_name', v_po.supplier_name,
    'q_number', v_po.q_number,
    'lines', v_line_results,
    'po_lines_not_in_note', v_unmatched_po_rows
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.match_delivery_note_to_po(UUID, TEXT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.match_delivery_note_to_po(UUID, TEXT, JSONB) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.match_delivery_note_to_po(UUID, TEXT, JSONB) TO service_role;

COMMENT ON FUNCTION public.match_delivery_note_to_po(UUID, TEXT, JSONB) IS
  'Classifies OCR''d delivery-note lines against the PO''s outstanding supplier-order lines. Caller resolves raw supplier_code/description to supplier_component_id before calling; SQL just validates and computes variance. Returns matched PO + per-line classification (clean/short/over/unknown/duplicate) + PO lines not touched by the note. POL-101 / plan §4.4.';
