-- Replace profiles.org_id RLS policies with standard organization_members pattern,
-- and add missing indexes on order_id, component_id, org_id.

-- Drop old policies
DROP POLICY IF EXISTS "Users can view component reservations in their org" ON public.component_reservations;
DROP POLICY IF EXISTS "Users can manage component reservations in their org" ON public.component_reservations;

-- Standard org-member SELECT policy
CREATE POLICY component_reservations_select_org_member
ON public.component_reservations
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = component_reservations.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

-- Standard org-member INSERT policy
CREATE POLICY component_reservations_insert_org_member
ON public.component_reservations
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = component_reservations.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

-- Standard org-member UPDATE policy
CREATE POLICY component_reservations_update_org_member
ON public.component_reservations
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = component_reservations.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = component_reservations.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

-- Standard org-member DELETE policy
CREATE POLICY component_reservations_delete_org_member
ON public.component_reservations
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = component_reservations.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_component_reservations_order_id ON public.component_reservations(order_id);
CREATE INDEX IF NOT EXISTS idx_component_reservations_component_id ON public.component_reservations(component_id);
CREATE INDEX IF NOT EXISTS idx_component_reservations_org_id ON public.component_reservations(org_id);
