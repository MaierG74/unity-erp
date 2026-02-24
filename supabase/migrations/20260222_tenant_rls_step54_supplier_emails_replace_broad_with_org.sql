-- Step 54: Replace broad supplier_emails RLS policy with org-scoped membership policies

DROP POLICY IF EXISTS authenticated_users_all_access
  ON public.supplier_emails;

CREATE POLICY supplier_emails_select_org_member
ON public.supplier_emails
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = supplier_emails.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY supplier_emails_insert_org_member
ON public.supplier_emails
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = supplier_emails.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY supplier_emails_update_org_member
ON public.supplier_emails
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = supplier_emails.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = supplier_emails.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY supplier_emails_delete_org_member
ON public.supplier_emails
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = supplier_emails.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);
