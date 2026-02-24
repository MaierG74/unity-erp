-- Step 66: Enable org-scoped RLS on quote_item_cutlists

ALTER TABLE public.quote_item_cutlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY quote_item_cutlists_select_org_member
ON public.quote_item_cutlists
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = quote_item_cutlists.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY quote_item_cutlists_insert_org_member
ON public.quote_item_cutlists
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = quote_item_cutlists.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY quote_item_cutlists_update_org_member
ON public.quote_item_cutlists
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = quote_item_cutlists.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = quote_item_cutlists.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY quote_item_cutlists_delete_org_member
ON public.quote_item_cutlists
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = quote_item_cutlists.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);
