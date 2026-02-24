-- Step 62: Enable org-scoped RLS on quote_cluster_lines

ALTER TABLE public.quote_cluster_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY quote_cluster_lines_select_org_member
ON public.quote_cluster_lines
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = quote_cluster_lines.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY quote_cluster_lines_insert_org_member
ON public.quote_cluster_lines
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = quote_cluster_lines.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY quote_cluster_lines_update_org_member
ON public.quote_cluster_lines
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = quote_cluster_lines.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = quote_cluster_lines.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY quote_cluster_lines_delete_org_member
ON public.quote_cluster_lines
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = quote_cluster_lines.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);
