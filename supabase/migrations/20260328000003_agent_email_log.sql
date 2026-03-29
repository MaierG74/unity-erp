-- Agent email log: tracks all emails sent by agents via Edge Functions
-- Follows quote_email_log pattern with delivery tracking columns

CREATE TABLE IF NOT EXISTS public.agent_email_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES public.organizations(id),
  agent_id            TEXT NOT NULL,
  recipient_email     TEXT NOT NULL,
  customer_id         BIGINT REFERENCES public.customers(id) ON DELETE SET NULL,
  subject             TEXT NOT NULL,
  flyer_storage_path  TEXT,
  product_name        TEXT,
  resend_message_id   TEXT,
  status              TEXT NOT NULL DEFAULT 'sent',
  error_message       TEXT,
  delivery_status     TEXT DEFAULT 'sent',
  delivered_at        TIMESTAMPTZ,
  bounced_at          TIMESTAMPTZ,
  bounce_reason       TEXT,
  sent_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_email_log_org_id ON public.agent_email_log(org_id);
CREATE INDEX idx_agent_email_log_agent_id ON public.agent_email_log(agent_id);
CREATE INDEX idx_agent_email_log_sent_at ON public.agent_email_log(sent_at DESC);
CREATE INDEX idx_agent_email_log_resend_message_id ON public.agent_email_log(resend_message_id);
CREATE INDEX idx_agent_email_log_status ON public.agent_email_log(status);

ALTER TABLE public.agent_email_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_email_log_select_org_member
ON public.agent_email_log FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = agent_email_log.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY agent_email_log_service_role
ON public.agent_email_log FOR ALL TO service_role
USING (true) WITH CHECK (true);

COMMENT ON TABLE public.agent_email_log IS 'Tracks emails sent by OpenClaw agents via Edge Functions. Delivery status updated by Resend webhooks.';
