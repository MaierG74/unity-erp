-- Agent credentials: per-agent API keys bound to an org
-- Used by Edge Functions to authenticate agent requests and derive tenant context

CREATE TABLE IF NOT EXISTS public.agent_credentials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      TEXT NOT NULL,
  org_id        UUID NOT NULL REFERENCES public.organizations(id),
  api_key_hash  TEXT NOT NULL,
  label         TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_id, org_id)
);

CREATE INDEX idx_agent_credentials_api_key_hash ON public.agent_credentials(api_key_hash);

ALTER TABLE public.agent_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_credentials_service_role_select
ON public.agent_credentials FOR SELECT TO service_role
USING (true);

CREATE POLICY agent_credentials_service_role_all
ON public.agent_credentials FOR ALL TO service_role
USING (true) WITH CHECK (true);

COMMENT ON TABLE public.agent_credentials IS 'Per-agent API keys for Edge Function authentication. Key is hashed; org_id derived from credential on each request.';
