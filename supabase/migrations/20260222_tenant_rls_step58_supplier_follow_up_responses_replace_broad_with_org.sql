-- Step 58: Replace broad supplier_follow_up_responses policy with org-scoped membership policies

DROP POLICY IF EXISTS "Allow all access to supplier_responses"
  ON public.supplier_follow_up_responses;

CREATE POLICY supplier_follow_up_responses_select_org_member
ON public.supplier_follow_up_responses
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = supplier_follow_up_responses.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY supplier_follow_up_responses_insert_org_member
ON public.supplier_follow_up_responses
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = supplier_follow_up_responses.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY supplier_follow_up_responses_update_org_member
ON public.supplier_follow_up_responses
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = supplier_follow_up_responses.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = supplier_follow_up_responses.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY supplier_follow_up_responses_delete_org_member
ON public.supplier_follow_up_responses
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = supplier_follow_up_responses.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);
