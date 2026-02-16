-- Tenant RLS rollout Step 1 (baby step): products only.
-- Replaces broad authenticated-all policy with org-scoped policies.

begin;

-- Remove old broad policy if present.
drop policy if exists authenticated_users_all_access on public.products;

-- Idempotent cleanup for re-runs.
drop policy if exists products_select_org_member on public.products;
drop policy if exists products_insert_org_member on public.products;
drop policy if exists products_update_org_member on public.products;
drop policy if exists products_delete_org_member on public.products;

-- Tenant-scoped select.
create policy products_select_org_member
on public.products
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = products.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped insert.
create policy products_insert_org_member
on public.products
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = products.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped update.
create policy products_update_org_member
on public.products
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = products.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = products.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped delete.
create policy products_delete_org_member
on public.products
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = products.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

commit;
