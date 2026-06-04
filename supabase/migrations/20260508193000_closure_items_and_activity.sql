-- Closure engine — core tables (POL-107)
-- Sub-issue (a) of 5 for POL-100. The other four sub-issues
-- (sla_pauses + escalation_events DDL, RPCs, queue view, bridge from
-- job_work_pool_exceptions) are filed separately and depend on this.
-- See docs/projects/purchasing-agent-implementation-plan.md §3.2

-- =========================================================================
-- closure_items: per-tracked-item state for any agent-watched item.
-- Generalises the job_work_pool_exceptions primitive so any agent
-- (Sam, future Marketing agent, etc.) can register a tracked item and
-- drive it to closure with owner/age/SLA/escalation/closure-note.
-- =========================================================================

CREATE TABLE public.closure_items (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID NOT NULL REFERENCES public.organizations(id),

  -- Source identity (load-bearing for dedup + cross-source linking)
  source_type             TEXT NOT NULL,
  source_id               TEXT NOT NULL,
  source_fingerprint      TEXT NOT NULL,
  capability              TEXT NOT NULL,
  item_type               TEXT NOT NULL,

  -- Display
  title                   TEXT NOT NULL,
  summary                 TEXT,

  -- State
  status                  TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'waiting_external', 'blocked', 'paused', 'closed', 'cancelled')),
  severity                TEXT NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),

  -- Ownership
  owner_user_id           UUID REFERENCES auth.users(id),
  owner_agent_id          TEXT,
  owner_role              TEXT,

  -- Origination
  opened_by_user_id       UUID REFERENCES auth.users(id),
  opened_by_agent_id      TEXT,
  opened_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_seen_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_observed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- SLA & timing
  sla_minutes             INTEGER NOT NULL DEFAULT 480 CHECK (sla_minutes > 0),
  due_at                  TIMESTAMPTZ,
  total_paused_seconds    INTEGER NOT NULL DEFAULT 0 CHECK (total_paused_seconds >= 0),
  paused_at               TIMESTAMPTZ,
  pause_reason_code       TEXT,

  -- Escalation
  escalation_level        INTEGER NOT NULL DEFAULT 0 CHECK (escalation_level >= 0),
  next_escalation_at      TIMESTAMPTZ,
  escalation_policy       JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Notification dedup (considered messaging)
  last_notified_at        TIMESTAMPTZ,
  last_notification_key   TEXT,
  next_notifiable_at      TIMESTAMPTZ,

  -- Closure
  closure_note            TEXT,
  closed_by_user_id       UUID REFERENCES auth.users(id),
  closed_by_agent_id      TEXT,
  closed_at               TIMESTAMPTZ,

  -- Free-form data
  payload                 JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial unique: one open closure_item per source per org. Load-bearing
-- guarantee per plan §3.1 — the dedup primitive that prevents duplicate
-- tracked items for the same underlying business event.
CREATE UNIQUE INDEX closure_items_active_unique_source
  ON public.closure_items (org_id, source_type, source_fingerprint)
  WHERE status NOT IN ('closed', 'cancelled');

-- Queue scan for daily brief and operator views
CREATE INDEX closure_items_queue_idx
  ON public.closure_items (org_id, status, severity, due_at);

-- Owner-scoped queries ("my open items")
CREATE INDEX closure_items_owner_idx
  ON public.closure_items (org_id, owner_user_id, status);

-- Payload search for ad-hoc filtering (e.g. by order_id, component_id)
CREATE INDEX closure_items_payload_gin_idx
  ON public.closure_items USING GIN (payload);

-- Auto-update updated_at on UPDATE
CREATE TRIGGER closure_items_set_updated_at
  BEFORE UPDATE ON public.closure_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.closure_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_read_closure_items" ON public.closure_items
  FOR SELECT USING (public.is_org_member(org_id));

CREATE POLICY "org_insert_closure_items" ON public.closure_items
  FOR INSERT WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "org_update_closure_items" ON public.closure_items
  FOR UPDATE USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "org_delete_closure_items" ON public.closure_items
  FOR DELETE USING (public.is_org_member(org_id));

COMMENT ON TABLE public.closure_items IS
  'Per-tracked-item state for any agent-watched item. Owner/age/SLA/escalation/closure-note primitive that generalises job_work_pool_exceptions. See docs/projects/purchasing-agent-implementation-plan.md §3.2.';

-- =========================================================================
-- closure_item_activity: append-only audit log of state transitions
-- =========================================================================

CREATE TABLE public.closure_item_activity (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID NOT NULL REFERENCES public.organizations(id),
  closure_item_id         UUID NOT NULL REFERENCES public.closure_items(id) ON DELETE CASCADE,
  event_type              TEXT NOT NULL
    CHECK (event_type IN (
      'created',
      'observation_updated',
      'status_changed',
      'owner_assigned',
      'sla_paused',
      'sla_resumed',
      'escalated',
      'message_sent',
      'proposal_created',
      'human_approved',
      'human_rejected',
      'approved_action_executed',
      'duplicate_suppressed',
      'closed',
      'cancelled',
      'error'
    )),
  performed_by_user_id    UUID REFERENCES auth.users(id),
  performed_by_agent_id   TEXT,
  notes                   TEXT,
  payload                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX closure_item_activity_item_idx
  ON public.closure_item_activity (closure_item_id, created_at DESC);

ALTER TABLE public.closure_item_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_read_closure_item_activity" ON public.closure_item_activity
  FOR SELECT USING (public.is_org_member(org_id));

CREATE POLICY "org_insert_closure_item_activity" ON public.closure_item_activity
  FOR INSERT WITH CHECK (public.is_org_member(org_id));

-- closure_item_activity is append-only — no UPDATE or DELETE policies.
-- The audit trail is immutable.

COMMENT ON TABLE public.closure_item_activity IS
  'Append-only audit log of state transitions on closure_items. Immutable — no UPDATE or DELETE policies. See docs/projects/purchasing-agent-implementation-plan.md §3.2.';
