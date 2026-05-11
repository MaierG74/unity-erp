-- Closure engine — pause history + escalation event log (POL-108)
-- Sub-issue (b) of 5 for POL-100. Depends on POL-107 (closure_items must exist
-- for the FK references). The remaining sub-issues (RPCs, queue view, bridge)
-- are filed separately.
-- See docs/projects/purchasing-agent-implementation-plan.md §3.2 (DDL),
-- §3.5 (pause semantics), §3.6 (escalation policy as JSONB + structured columns).

-- =========================================================================
-- closure_item_sla_pauses: pause-history records for SLA clock management.
-- Each row represents one pause window (started_at → ended_at). When
-- pause_ended_at is NULL, the pause is currently active. The total paused
-- seconds is rolled up onto closure_items.total_paused_seconds by the
-- resume_closure_sla RPC (POL-109).
-- =========================================================================

CREATE TABLE public.closure_item_sla_pauses (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID NOT NULL REFERENCES public.organizations(id),
  closure_item_id         UUID NOT NULL REFERENCES public.closure_items(id) ON DELETE CASCADE,

  pause_started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pause_ended_at          TIMESTAMPTZ,
  reason_code             TEXT NOT NULL,
  notes                   TEXT,

  paused_by_user_id       UUID REFERENCES auth.users(id),
  paused_by_agent_id      TEXT,
  resumed_by_user_id      UUID REFERENCES auth.users(id),
  resumed_by_agent_id     TEXT,

  -- Defensive: an ended pause must have an end >= start
  CONSTRAINT closure_item_sla_pauses_end_after_start
    CHECK (pause_ended_at IS NULL OR pause_ended_at >= pause_started_at)
);

-- Find the currently-open pause for a closure_item (one row at a time normally,
-- but the schema allows for the rare case of overlapping pause attempts so the
-- RPC layer can defend against duplicate pauses).
CREATE INDEX closure_item_sla_pauses_open_idx
  ON public.closure_item_sla_pauses (org_id, closure_item_id)
  WHERE pause_ended_at IS NULL;

-- Pause history for a given closure_item (closed + open).
CREATE INDEX closure_item_sla_pauses_history_idx
  ON public.closure_item_sla_pauses (closure_item_id, pause_started_at DESC);

ALTER TABLE public.closure_item_sla_pauses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_read_closure_item_sla_pauses" ON public.closure_item_sla_pauses
  FOR SELECT USING (public.is_org_member(org_id));

CREATE POLICY "org_insert_closure_item_sla_pauses" ON public.closure_item_sla_pauses
  FOR INSERT WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "org_update_closure_item_sla_pauses" ON public.closure_item_sla_pauses
  FOR UPDATE USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

-- No DELETE policy — pauses are append-and-close, never deleted directly.
-- They cascade away when the parent closure_item is deleted.

COMMENT ON TABLE public.closure_item_sla_pauses IS
  'Pause-history records for closure_items SLA clock. One row per pause window. NULL pause_ended_at = currently paused. See docs/projects/purchasing-agent-implementation-plan.md §3.5.';

-- =========================================================================
-- closure_escalation_events: append-only log of escalation firings.
-- Written by the escalate_due_closure_items RPC (POL-109) when a tracked
-- item ages past its next_escalation_at threshold.
-- =========================================================================

CREATE TABLE public.closure_escalation_events (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID NOT NULL REFERENCES public.organizations(id),
  closure_item_id         UUID NOT NULL REFERENCES public.closure_items(id) ON DELETE CASCADE,

  escalation_level        INTEGER NOT NULL CHECK (escalation_level >= 0),
  target_type             TEXT NOT NULL
    CHECK (target_type IN ('owner', 'supervisor', 'daily_brief', 'weekly_digest')),
  target_user_id          UUID REFERENCES auth.users(id),
  target_role             TEXT,
  message_key             TEXT,

  fired_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload                 JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Escalation history for a closure_item (audit trail)
CREATE INDEX closure_escalation_events_item_idx
  ON public.closure_escalation_events (closure_item_id, fired_at DESC);

-- Org-wide recent-escalations queries (e.g. daily brief, supervisor digest)
CREATE INDEX closure_escalation_events_org_recent_idx
  ON public.closure_escalation_events (org_id, fired_at DESC);

ALTER TABLE public.closure_escalation_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_read_closure_escalation_events" ON public.closure_escalation_events
  FOR SELECT USING (public.is_org_member(org_id));

CREATE POLICY "org_insert_closure_escalation_events" ON public.closure_escalation_events
  FOR INSERT WITH CHECK (public.is_org_member(org_id));

-- closure_escalation_events is append-only — no UPDATE or DELETE policies.
-- The escalation history is immutable. Cascade-delete with parent closure_item.

COMMENT ON TABLE public.closure_escalation_events IS
  'Append-only audit log of escalation firings on closure_items. Immutable — no UPDATE or DELETE policies. Written by escalate_due_closure_items (POL-109). See docs/projects/purchasing-agent-implementation-plan.md §3.6.';
