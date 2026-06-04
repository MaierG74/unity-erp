-- Agent runtime support tables (POL-112)
-- Cross-cutting infrastructure for OpenClaw agents (Sam and future agents).
-- Sibling to POL-100 closure engine: closure_items handles per-tracked-item
-- state; this migration handles per-agent audit log, dedup state, per-org
-- feature flags, Telegram identity mapping, host-level events, and heartbeats.
-- See docs/projects/purchasing-agent-implementation-plan.md §2.2 + §7.3.

-- =========================================================================
-- agent_action_log: append-only operational audit. Every meaningful agent
-- step (read, reason, proposal, message, write attempt, error) writes one
-- row. The partial-unique on idempotency_key is load-bearing — Edge Function
-- wrappers use it to make approved-write actions idempotent.
-- =========================================================================

CREATE TABLE public.agent_action_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES public.organizations(id),
  agent_id            TEXT NOT NULL,
  run_id              UUID NOT NULL DEFAULT gen_random_uuid(),
  capability          TEXT NOT NULL,
  action_kind         TEXT NOT NULL
    CHECK (action_kind IN (
      'read',
      'reason',
      'proposal',
      'message',
      'approved_write',
      'rejected_write',
      'error',
      'dry_run',
      'observation'
    )),
  target_type         TEXT,
  target_id           TEXT,
  closure_item_id     UUID REFERENCES public.closure_items(id) ON DELETE SET NULL,
  model               TEXT,
  input_tokens        INTEGER,
  output_tokens       INTEGER,
  idempotency_key     TEXT,
  request_summary     TEXT,
  request_payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_status       TEXT NOT NULL DEFAULT 'ok'
    CHECK (result_status IN ('ok', 'skipped', 'failed', 'blocked')),
  result_summary      TEXT,
  result_payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  approved_by         UUID REFERENCES auth.users(id),
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX agent_action_log_org_created_idx
  ON public.agent_action_log (org_id, created_at DESC);

CREATE INDEX agent_action_log_run_idx
  ON public.agent_action_log (run_id);

CREATE INDEX agent_action_log_capability_idx
  ON public.agent_action_log (org_id, agent_id, capability, created_at DESC);

CREATE INDEX agent_action_log_closure_item_idx
  ON public.agent_action_log (closure_item_id)
  WHERE closure_item_id IS NOT NULL;

CREATE UNIQUE INDEX agent_action_log_idempotency_unique
  ON public.agent_action_log (org_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.agent_action_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_read_agent_action_log" ON public.agent_action_log
  FOR SELECT USING (public.is_org_member(org_id));

-- Append-only — no INSERT/UPDATE/DELETE policies for authenticated users.
-- Writes go via service_role through Edge Functions / RPCs.

COMMENT ON TABLE public.agent_action_log IS
  'Append-only operational audit for every meaningful agent step. Idempotency_key partial-unique is load-bearing for Edge Function wrappers. See docs/projects/purchasing-agent-implementation-plan.md §2.2.';

-- =========================================================================
-- agent_watched_items: dedup + considered-messaging state per
-- (org × agent × capability × source_fingerprint). The unique key prevents
-- duplicate watchers on the same business event; state drives the OCR
-- re-shoot loop and notification cadence.
-- =========================================================================

CREATE TABLE public.agent_watched_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES public.organizations(id),
  agent_id              TEXT NOT NULL,
  capability            TEXT NOT NULL,
  source_type           TEXT NOT NULL,
  source_id             TEXT NOT NULL,
  source_fingerprint    TEXT NOT NULL,
  last_payload_hash     TEXT,
  closure_item_id       UUID REFERENCES public.closure_items(id) ON DELETE SET NULL,
  first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_evaluated_at     TIMESTAMPTZ,
  next_evaluate_at      TIMESTAMPTZ,
  last_notified_at      TIMESTAMPTZ,
  last_notification_key TEXT,
  silence_until         TIMESTAMPTZ,
  state                 TEXT NOT NULL DEFAULT 'watching'
    CHECK (state IN (
      'watching',
      'linked_to_closure',
      'ignored',
      'closed',
      'awaiting_better_photo'
    )),
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dedup primitive — one watcher per (org × agent × capability × source).
CREATE UNIQUE INDEX agent_watched_items_unique_source
  ON public.agent_watched_items (org_id, agent_id, capability, source_fingerprint);

-- Cron driver — find rows due for re-evaluation among non-terminal states.
CREATE INDEX agent_watched_items_due_idx
  ON public.agent_watched_items (org_id, next_evaluate_at)
  WHERE state IN ('watching', 'linked_to_closure', 'awaiting_better_photo');

-- Back-reference for "all watchers linked to this closure item".
CREATE INDEX agent_watched_items_closure_item_idx
  ON public.agent_watched_items (closure_item_id)
  WHERE closure_item_id IS NOT NULL;

CREATE TRIGGER agent_watched_items_set_updated_at
  BEFORE UPDATE ON public.agent_watched_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.agent_watched_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_read_agent_watched_items" ON public.agent_watched_items
  FOR SELECT USING (public.is_org_member(org_id));

-- Writes via service_role through Edge Functions / RPCs.

COMMENT ON TABLE public.agent_watched_items IS
  'Dedup + considered-messaging state per (org, agent, capability, source_fingerprint). State awaiting_better_photo routes pending OCR re-shoots. See docs/projects/purchasing-agent-implementation-plan.md §2.2.';

-- =========================================================================
-- agent_org_config: per-org × per-agent × per-capability feature flag.
-- Mode drives the staged-rollout discipline (off → shadow → dry_run →
-- closure_only → proposal_writes → live_approved_writes). config jsonb
-- carries per-capability runtime knobs (LLM endpoint URL, scheduling cron,
-- num_predict floors, etc.).
-- =========================================================================

CREATE TABLE public.agent_org_config (
  org_id              UUID NOT NULL REFERENCES public.organizations(id),
  agent_id            TEXT NOT NULL,
  capability          TEXT NOT NULL,
  mode                TEXT NOT NULL DEFAULT 'off'
    CHECK (mode IN (
      'off',
      'shadow',
      'dry_run',
      'closure_only',
      'proposal_writes',
      'live_approved_writes'
    )),
  telegram_chat_id    TEXT,
  daily_brief_time    TIME NOT NULL DEFAULT '07:05',
  timezone            TEXT NOT NULL DEFAULT 'Africa/Johannesburg',
  config              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, agent_id, capability)
);

CREATE TRIGGER agent_org_config_set_updated_at
  BEFORE UPDATE ON public.agent_org_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.agent_org_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_read_agent_org_config" ON public.agent_org_config
  FOR SELECT USING (public.is_org_member(org_id));

-- Writes via service_role through Edge Functions / RPCs.

COMMENT ON TABLE public.agent_org_config IS
  'Per-org × per-agent × per-capability feature flag. Mode drives staged rollout. config jsonb carries runtime knobs. See docs/projects/purchasing-agent-implementation-plan.md §2.2.';

-- =========================================================================
-- telegram_user_bindings: Telegram user → Unity user mapping.
-- Per-user threads + approval identity. allowed_actions text[] is a
-- coarse capability gate enforced by Edge Functions (Sam runtime work).
-- =========================================================================

CREATE TABLE public.telegram_user_bindings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES public.organizations(id),
  user_id             UUID REFERENCES auth.users(id),
  telegram_user_id    TEXT NOT NULL,
  telegram_chat_id    TEXT NOT NULL,
  display_name        TEXT,
  role                TEXT NOT NULL DEFAULT 'operator',
  allowed_actions     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, telegram_user_id)
);

CREATE INDEX telegram_user_bindings_chat_idx
  ON public.telegram_user_bindings (telegram_chat_id);

CREATE INDEX telegram_user_bindings_user_idx
  ON public.telegram_user_bindings (user_id)
  WHERE user_id IS NOT NULL;

CREATE TRIGGER telegram_user_bindings_set_updated_at
  BEFORE UPDATE ON public.telegram_user_bindings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.telegram_user_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_read_telegram_user_bindings" ON public.telegram_user_bindings
  FOR SELECT USING (public.is_org_member(org_id));

-- Writes via service_role through Edge Functions / RPCs.

COMMENT ON TABLE public.telegram_user_bindings IS
  'Telegram user → Unity user mapping for per-user threads and approval identity. See docs/projects/purchasing-agent-implementation-plan.md §2.2.';

-- =========================================================================
-- agent_runtime_events: host-level event log. org_id is nullable for
-- host-wide events (process start, panic, restart) that don't belong to
-- any one tenant. is_org_member(NULL) returns false → host-level rows are
-- only visible to service_role / postgres.
-- =========================================================================

CREATE TABLE public.agent_runtime_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID REFERENCES public.organizations(id),
  agent_id        TEXT NOT NULL,
  host_id         TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  severity        TEXT NOT NULL DEFAULT 'info'
    CHECK (severity IN ('debug', 'info', 'warn', 'error', 'critical')),
  message         TEXT,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX agent_runtime_events_agent_created_idx
  ON public.agent_runtime_events (agent_id, created_at DESC);

CREATE INDEX agent_runtime_events_org_created_idx
  ON public.agent_runtime_events (org_id, created_at DESC)
  WHERE org_id IS NOT NULL;

CREATE INDEX agent_runtime_events_severity_idx
  ON public.agent_runtime_events (severity, created_at DESC)
  WHERE severity IN ('error', 'critical');

ALTER TABLE public.agent_runtime_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_read_agent_runtime_events" ON public.agent_runtime_events
  FOR SELECT USING (public.is_org_member(org_id));

-- Writes via service_role.

COMMENT ON TABLE public.agent_runtime_events IS
  'Host-level event log for OpenClaw agents. Nullable org_id for host-wide events. See docs/projects/purchasing-agent-implementation-plan.md §7.3.';

-- =========================================================================
-- agent_heartbeats: one row per agent_id, last_seen heartbeat. Cron job
-- (separate Sam runtime ticket) updates last_seen_at; observability tooling
-- alerts on stale heartbeats.
-- =========================================================================

CREATE TABLE public.agent_heartbeats (
  agent_id        TEXT PRIMARY KEY,
  host_id         TEXT NOT NULL,
  org_id          UUID REFERENCES public.organizations(id),
  status          TEXT NOT NULL,
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_run_id     UUID,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX agent_heartbeats_host_idx
  ON public.agent_heartbeats (host_id);

CREATE INDEX agent_heartbeats_last_seen_idx
  ON public.agent_heartbeats (last_seen_at);

ALTER TABLE public.agent_heartbeats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_read_agent_heartbeats" ON public.agent_heartbeats
  FOR SELECT USING (public.is_org_member(org_id));

-- Writes via service_role.

COMMENT ON TABLE public.agent_heartbeats IS
  'One row per agent_id with last-seen heartbeat. Cron updates last_seen_at; observability alerts on staleness. See docs/projects/purchasing-agent-implementation-plan.md §7.3.';
