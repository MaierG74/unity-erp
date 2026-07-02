-- Cash-supplier Slice 2 (S2-A): accounts team, detection RPC, escalation-event claiming.
-- Applied to live (ttlyfhkrsjjrzxiagzpb) 2026-07-02 via Supabase MCP as version 20260702084544.
-- Note: the as-recorded apply had a type bug in detect_cash_po_exceptions
-- (order_date is timestamp; date arithmetic needed ::date casts); the function
-- was CREATE OR REPLACEd live minutes later with the corrected body below.
-- This file is the canonical, corrected text.
-- Spec: docs/projects/2026-07-01-cash-supplier-payment-lifecycle-completion.md §3.1.
-- Verified live (rolled-back DO): detect=6 on Apex data, escalate fired 6 owner
-- events (p_next_escalation_at := now() is REQUIRED — register_closure_item
-- defaults NULL and escalate_due_closure_items skips NULL rows), claim=6,
-- immediate re-claim=0. EXPLAIN ANALYZE: index-driven, 0.43ms, no per-row LATERALs.
-- Rollback:
--   DROP FUNCTION public.detect_cash_po_exceptions(uuid);
--   DROP FUNCTION public.claim_escalation_events(uuid, text[], integer);
--   ALTER TABLE public.closure_escalation_events
--     DROP COLUMN processing_started_at, DROP COLUMN processed_at, DROP COLUMN delivery_status;
--   DROP TABLE public.org_accounts_team;

-- 1) Org accounts team (escalation 'supervisor' recipients).
CREATE TABLE IF NOT EXISTS public.org_accounts_team (
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_by   uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
ALTER TABLE public.org_accounts_team ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_read_accounts_team" ON public.org_accounts_team;
DROP POLICY IF EXISTS "org_manage_accounts_team" ON public.org_accounts_team;
CREATE POLICY "org_read_accounts_team" ON public.org_accounts_team
  FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "org_manage_accounts_team" ON public.org_accounts_team
  FOR ALL USING (public.is_org_payment_authoriser(org_id))
  WITH CHECK (public.is_org_payment_authoriser(org_id));

-- 2) Notification cursor on escalation events (worker idempotency).
ALTER TABLE public.closure_escalation_events
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_status text;

-- 3) Atomic claim for the notification worker (service_role only).
-- Stale claims (worker died mid-send) become reclaimable after 15 minutes.
CREATE OR REPLACE FUNCTION public.claim_escalation_events(
  p_org_id       uuid,
  p_source_types text[],
  p_limit        integer DEFAULT 25
)
RETURNS TABLE (
  event_id          uuid,
  closure_item_id   uuid,
  escalation_level  integer,
  target_type       text,
  target_user_id    uuid,
  source_type       text,
  source_id         text,
  item_title        text,
  item_payload      jsonb,
  owner_user_id     uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT e.id
    FROM public.closure_escalation_events e
    JOIN public.closure_items ci ON ci.id = e.closure_item_id
    WHERE e.org_id = p_org_id
      AND ci.source_type = ANY (p_source_types)
      AND e.processed_at IS NULL
      AND (e.processing_started_at IS NULL OR e.processing_started_at < now() - interval '15 minutes')
    ORDER BY e.fired_at
    LIMIT p_limit
    FOR UPDATE OF e SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.closure_escalation_events e
    SET processing_started_at = now()
    FROM claimable c
    WHERE e.id = c.id
    RETURNING e.id, e.closure_item_id, e.escalation_level, e.target_type, e.target_user_id
  )
  SELECT
    cl.id, cl.closure_item_id, cl.escalation_level, cl.target_type, cl.target_user_id,
    ci.source_type, ci.source_id, ci.title, ci.payload, ci.owner_user_id
  FROM claimed cl
  JOIN public.closure_items ci ON ci.id = cl.closure_item_id;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_escalation_events(uuid, text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_escalation_events(uuid, text[], integer) TO service_role;

-- 4) Detection: one grouped scan over cash-supplier POs -> register/auto-close
-- closure items. Called by the OpenClaw runtime via agent-closure-rpc.
CREATE OR REPLACE FUNCTION public.detect_cash_po_exceptions(
  p_org_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_candidate  RECORD;
  v_item       RECORD;
  v_count      integer := 0;
  v_policy     jsonb := jsonb_build_object('steps', jsonb_build_array(
                  jsonb_build_object('target','owner',       'after_minutes',0,    'channel','email'),
                  jsonb_build_object('target','supervisor',  'after_minutes',2880, 'channel','email'),
                  jsonb_build_object('target','daily_brief', 'after_minutes',5760, 'channel','brief')
                ));
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'p_org_id is required';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _cash_candidates (
    source_type text,
    po_id       bigint,
    fingerprint text,
    title       text,
    summary     text,
    owner_uid   uuid,
    payload     jsonb
  ) ON COMMIT DROP;
  TRUNCATE _cash_candidates;  -- not DELETE: pg-safeupdate on the PostgREST path rejects DELETE without WHERE

  INSERT INTO _cash_candidates (source_type, po_id, fingerprint, title, summary, owner_uid, payload)
  WITH cash_pos AS (
    SELECT po.purchase_order_id, po.q_number, po.order_date, po.created_at,
           po.created_by, po.expected_delivery_date, po.status_id, s.name AS supplier_name
    FROM public.purchase_orders po
    JOIN public.suppliers s ON s.supplier_id = po.supplier_id
    WHERE po.org_id = p_org_id
      AND s.org_id = p_org_id
      AND s.payment_type = 'cash'
      AND s.is_active
      AND po.status_id NOT IN (4, 5, 6)
  ),
  open_inv AS (
    SELECT DISTINCT ON (i.purchase_order_id)
           i.purchase_order_id, i.id AS invoice_id, i.payment_status,
           i.invoice_received_at, i.paid_at
    FROM public.purchase_order_invoices i
    WHERE i.org_id = p_org_id
      AND i.payment_status NOT IN ('closed','cancelled')
    ORDER BY i.purchase_order_id, i.updated_at DESC NULLS LAST
  )
  SELECT * FROM (
    SELECT 'cash_invoice_overdue', cp.purchase_order_id,
           cp.purchase_order_id::text || ':cash_invoice_overdue',
           COALESCE(cp.q_number, 'PO-' || cp.purchase_order_id) || ': no supplier invoice yet',
           'Cash PO to ' || cp.supplier_name || ' placed ' ||
             GREATEST(0, (CURRENT_DATE - COALESCE(cp.order_date::date, cp.created_at::date)))::text ||
             ' days ago with no invoice recorded.',
           cp.created_by,
           jsonb_build_object('purchase_order_id', cp.purchase_order_id, 'supplier_name', cp.supplier_name)
    FROM cash_pos cp
    LEFT JOIN open_inv oi ON oi.purchase_order_id = cp.purchase_order_id
    WHERE oi.purchase_order_id IS NULL
      AND COALESCE(cp.order_date::date, cp.created_at::date) < CURRENT_DATE - 2
      AND NOT EXISTS (
        SELECT 1 FROM public.purchase_order_invoices f
        WHERE f.purchase_order_id = cp.purchase_order_id AND f.org_id = p_org_id
      )

    UNION ALL
    SELECT 'cash_payment_overdue', cp.purchase_order_id,
           cp.purchase_order_id::text || ':cash_payment_overdue',
           COALESCE(cp.q_number, 'PO-' || cp.purchase_order_id) || ': invoice awaiting payment',
           'Invoice for cash PO to ' || cp.supplier_name || ' has waited ' ||
             GREATEST(0, (CURRENT_DATE - oi.invoice_received_at::date))::text || ' days for payment.',
           cp.created_by,
           jsonb_build_object('purchase_order_id', cp.purchase_order_id, 'invoice_id', oi.invoice_id)
    FROM cash_pos cp
    JOIN open_inv oi ON oi.purchase_order_id = cp.purchase_order_id
    WHERE oi.payment_status = 'awaiting_payment'
      AND oi.invoice_received_at < now() - interval '2 days'

    UNION ALL
    SELECT 'cash_pop_overdue', cp.purchase_order_id,
           cp.purchase_order_id::text || ':cash_pop_overdue',
           COALESCE(cp.q_number, 'PO-' || cp.purchase_order_id) || ': POP not sent to supplier',
           'Payment for cash PO to ' || cp.supplier_name || ' was made ' ||
             GREATEST(0, (CURRENT_DATE - oi.paid_at::date))::text || ' days ago but no POP has gone out.',
           cp.created_by,
           jsonb_build_object('purchase_order_id', cp.purchase_order_id, 'invoice_id', oi.invoice_id)
    FROM cash_pos cp
    JOIN open_inv oi ON oi.purchase_order_id = cp.purchase_order_id
    WHERE oi.payment_status = 'awaiting_pop'
      AND oi.paid_at < now() - interval '2 days'

    UNION ALL
    SELECT 'po_eta_overdue', cp.purchase_order_id,
           cp.purchase_order_id::text || ':po_eta_overdue',
           COALESCE(cp.q_number, 'PO-' || cp.purchase_order_id) || ': expected delivery overdue',
           'Cash PO to ' || cp.supplier_name || ' was expected ' ||
             (CURRENT_DATE - cp.expected_delivery_date::date)::text || ' days ago and is not fully received.',
           cp.created_by,
           jsonb_build_object('purchase_order_id', cp.purchase_order_id, 'expected_delivery_date', cp.expected_delivery_date)
    FROM cash_pos cp
    WHERE cp.expected_delivery_date IS NOT NULL
      AND cp.expected_delivery_date::date < CURRENT_DATE
      AND cp.status_id <> 9

    UNION ALL
    SELECT 'cash_closed_unsigned', cp.purchase_order_id,
           cp.purchase_order_id::text || ':cash_closed_unsigned',
           COALESCE(cp.q_number, 'PO-' || cp.purchase_order_id) || ': payment closed without sign-off',
           'The POP for cash PO to ' || cp.supplier_name || ' went out without an owner/admin sign-off.',
           cp.created_by,
           jsonb_build_object('purchase_order_id', cp.purchase_order_id, 'invoice_id', ci.id)
    FROM cash_pos cp
    JOIN public.purchase_order_invoices ci ON ci.purchase_order_id = cp.purchase_order_id
    WHERE ci.org_id = p_org_id
      AND ci.payment_status = 'closed'
      AND ci.signed_off_at IS NULL
      AND ci.pop_sent_at > now() - interval '30 days'
  ) c(source_type, po_id, fingerprint, title, summary, owner_uid, payload);

  FOR v_candidate IN SELECT * FROM _cash_candidates LOOP
    PERFORM public.register_closure_item(
      p_org_id             := p_org_id,
      p_source_type        := v_candidate.source_type,
      p_source_id          := v_candidate.po_id::text,
      p_source_fingerprint := v_candidate.fingerprint,
      p_capability         := 'finance',
      p_item_type          := 'cash_payment_exception',
      p_title              := v_candidate.title,
      p_summary            := v_candidate.summary,
      p_severity           := 'medium',
      p_owner_user_id      := v_candidate.owner_uid,
      p_payload            := v_candidate.payload,
      p_escalation_policy  := v_policy,
      p_next_escalation_at := now()
    );
    v_count := v_count + 1;
  END LOOP;

  FOR v_item IN
    SELECT ci.id
    FROM public.closure_items ci
    WHERE ci.org_id = p_org_id
      AND ci.source_type IN ('cash_invoice_overdue','cash_payment_overdue','cash_pop_overdue','po_eta_overdue','cash_closed_unsigned')
      AND ci.status NOT IN ('closed','cancelled')
      AND NOT EXISTS (
        SELECT 1 FROM _cash_candidates c
        WHERE c.fingerprint = ci.source_fingerprint AND c.source_type = ci.source_type
      )
  LOOP
    PERFORM public.close_closure_item(
      p_org_id, v_item.id, 'auto-resolved: condition cleared', 'closed', NULL, NULL
    );
  END LOOP;

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.detect_cash_po_exceptions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_cash_po_exceptions(uuid) TO service_role;
