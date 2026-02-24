-- Step 64: Enable org-scoped RLS on quote_item_clusters

ALTER TABLE public.quote_item_clusters ENABLE ROW LEVEL SECURITY;

CREATE POLICY quote_item_clusters_select_org_member
ON public.quote_item_clusters
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = quote_item_clusters.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY quote_item_clusters_insert_org_member
ON public.quote_item_clusters
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = quote_item_clusters.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY quote_item_clusters_update_org_member
ON public.quote_item_clusters
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = quote_item_clusters.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = quote_item_clusters.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY quote_item_clusters_delete_org_member
ON public.quote_item_clusters
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = quote_item_clusters.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);
