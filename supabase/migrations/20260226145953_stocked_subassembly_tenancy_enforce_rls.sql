-- Enforce + RLS phase: org-safe access for stocked sub-assembly tables
-- Scope: public.product_bom_links, public.billoflabour, public.billofmaterials

BEGIN;

ALTER TABLE public.product_bom_links
  VALIDATE CONSTRAINT product_bom_links_org_id_fkey;

ALTER TABLE public.billoflabour
  VALIDATE CONSTRAINT billoflabour_org_id_fkey;

ALTER TABLE public.product_bom_links
  ADD CONSTRAINT product_bom_links_org_id_not_null
  CHECK (org_id IS NOT NULL) NOT VALID;

ALTER TABLE public.product_bom_links
  VALIDATE CONSTRAINT product_bom_links_org_id_not_null;

ALTER TABLE public.product_bom_links
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.billoflabour
  ADD CONSTRAINT billoflabour_org_id_not_null
  CHECK (org_id IS NOT NULL) NOT VALID;

ALTER TABLE public.billoflabour
  VALIDATE CONSTRAINT billoflabour_org_id_not_null;

ALTER TABLE public.billoflabour
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.product_bom_links
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.billoflabour
  ENABLE ROW LEVEL SECURITY;

-- product_bom_links policies
DROP POLICY IF EXISTS product_bom_links_select_org_member ON public.product_bom_links;
DROP POLICY IF EXISTS product_bom_links_insert_org_member ON public.product_bom_links;
DROP POLICY IF EXISTS product_bom_links_update_org_member ON public.product_bom_links;
DROP POLICY IF EXISTS product_bom_links_delete_org_member ON public.product_bom_links;

CREATE POLICY product_bom_links_select_org_member
ON public.product_bom_links
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = product_bom_links.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY product_bom_links_insert_org_member
ON public.product_bom_links
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = product_bom_links.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
  AND EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.product_id = product_bom_links.product_id
      AND p.org_id = product_bom_links.org_id
  )
  AND EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.product_id = product_bom_links.sub_product_id
      AND p.org_id = product_bom_links.org_id
  )
);

CREATE POLICY product_bom_links_update_org_member
ON public.product_bom_links
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = product_bom_links.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = product_bom_links.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
  AND EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.product_id = product_bom_links.product_id
      AND p.org_id = product_bom_links.org_id
  )
  AND EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.product_id = product_bom_links.sub_product_id
      AND p.org_id = product_bom_links.org_id
  )
);

CREATE POLICY product_bom_links_delete_org_member
ON public.product_bom_links
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = product_bom_links.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

-- billoflabour policies
DROP POLICY IF EXISTS billoflabour_select_org_member ON public.billoflabour;
DROP POLICY IF EXISTS billoflabour_insert_org_member ON public.billoflabour;
DROP POLICY IF EXISTS billoflabour_update_org_member ON public.billoflabour;
DROP POLICY IF EXISTS billoflabour_delete_org_member ON public.billoflabour;

CREATE POLICY billoflabour_select_org_member
ON public.billoflabour
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = billoflabour.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY billoflabour_insert_org_member
ON public.billoflabour
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = billoflabour.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
  AND EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.product_id = billoflabour.product_id
      AND p.org_id = billoflabour.org_id
  )
);

CREATE POLICY billoflabour_update_org_member
ON public.billoflabour
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = billoflabour.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = billoflabour.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
  AND EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.product_id = billoflabour.product_id
      AND p.org_id = billoflabour.org_id
  )
);

CREATE POLICY billoflabour_delete_org_member
ON public.billoflabour
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = billoflabour.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

-- Tighten billofmaterials from broad access to org-member access via parent product.
DROP POLICY IF EXISTS "Auth Users All Access" ON public.billofmaterials;
DROP POLICY IF EXISTS authenticated_users_all_access ON public.billofmaterials;
DROP POLICY IF EXISTS billofmaterials_select_org_member ON public.billofmaterials;
DROP POLICY IF EXISTS billofmaterials_insert_org_member ON public.billofmaterials;
DROP POLICY IF EXISTS billofmaterials_update_org_member ON public.billofmaterials;
DROP POLICY IF EXISTS billofmaterials_delete_org_member ON public.billofmaterials;

CREATE POLICY billofmaterials_select_org_member
ON public.billofmaterials
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.products p
    JOIN public.organization_members m
      ON m.org_id = p.org_id
    WHERE p.product_id = billofmaterials.product_id
      AND m.user_id = auth.uid()
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY billofmaterials_insert_org_member
ON public.billofmaterials
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.products p
    JOIN public.organization_members m
      ON m.org_id = p.org_id
    WHERE p.product_id = billofmaterials.product_id
      AND m.user_id = auth.uid()
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY billofmaterials_update_org_member
ON public.billofmaterials
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.products p
    JOIN public.organization_members m
      ON m.org_id = p.org_id
    WHERE p.product_id = billofmaterials.product_id
      AND m.user_id = auth.uid()
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.products p
    JOIN public.organization_members m
      ON m.org_id = p.org_id
    WHERE p.product_id = billofmaterials.product_id
      AND m.user_id = auth.uid()
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY billofmaterials_delete_org_member
ON public.billofmaterials
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.products p
    JOIN public.organization_members m
      ON m.org_id = p.org_id
    WHERE p.product_id = billofmaterials.product_id
      AND m.user_id = auth.uid()
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

COMMIT;
