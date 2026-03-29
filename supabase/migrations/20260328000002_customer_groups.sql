-- Customer groups: named groups for future bulk email sends
-- Schema only for v1 — group sends come in v2 with consent tracking

CREATE TABLE IF NOT EXISTS public.customer_groups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES public.organizations(id),
  name          TEXT NOT NULL,
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, name)
);

ALTER TABLE public.customer_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_groups_select_org_member
ON public.customer_groups FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = customer_groups.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY customer_groups_manage_org_member
ON public.customer_groups FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = customer_groups.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = customer_groups.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY customer_groups_service_role
ON public.customer_groups FOR ALL TO service_role
USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.customer_group_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES public.organizations(id),
  group_id      UUID NOT NULL REFERENCES public.customer_groups(id) ON DELETE CASCADE,
  customer_id   BIGINT NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(group_id, customer_id)
);

CREATE OR REPLACE FUNCTION public.check_customer_group_member_org_consistency()
RETURNS TRIGGER AS $$
DECLARE
  v_group_org_id UUID;
  v_customer_org_id UUID;
BEGIN
  SELECT org_id INTO v_group_org_id FROM public.customer_groups WHERE id = NEW.group_id;
  SELECT org_id INTO v_customer_org_id FROM public.customers WHERE id = NEW.customer_id;

  IF v_group_org_id IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'group org_id (%) does not match member org_id (%)', v_group_org_id, NEW.org_id;
  END IF;

  IF v_customer_org_id IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'customer org_id (%) does not match member org_id (%)', v_customer_org_id, NEW.org_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_customer_group_member_org_check
BEFORE INSERT OR UPDATE ON public.customer_group_members
FOR EACH ROW EXECUTE FUNCTION public.check_customer_group_member_org_consistency();

CREATE INDEX idx_customer_group_members_group_id ON public.customer_group_members(group_id);
CREATE INDEX idx_customer_group_members_customer_id ON public.customer_group_members(customer_id);

ALTER TABLE public.customer_group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_group_members_select_org_member
ON public.customer_group_members FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = customer_group_members.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY customer_group_members_manage_org_member
ON public.customer_group_members FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = customer_group_members.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = customer_group_members.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY customer_group_members_service_role
ON public.customer_group_members FOR ALL TO service_role
USING (true) WITH CHECK (true);

COMMENT ON TABLE public.customer_groups IS 'Named customer groups for bulk email sends. v1 schema only — group sends require consent tracking (v2).';
COMMENT ON TABLE public.customer_group_members IS 'Junction: customers in groups. Org consistency enforced by trigger.';
