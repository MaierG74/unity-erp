-- Tenant RLS rollout Step 12 (baby step): components only.
-- Replace permissive policies with org-scoped policies.

begin;

-- Remove old permissive policies.
drop policy if exists "Read and Write Auth Users" on public.components;
drop policy if exists authenticated_users_all_access on public.components;
drop policy if exists authenticated_users_select_components on public.components;
drop policy if exists authenticated_users_insert_components on public.components;
drop policy if exists authenticated_users_update_components on public.components;
drop policy if exists authenticated_users_delete_components on public.components;

-- Idempotent cleanup for re-runs.
drop policy if exists components_select_org_member on public.components;
drop policy if exists components_insert_org_member on public.components;
drop policy if exists components_update_org_member on public.components;
drop policy if exists components_delete_org_member on public.components;

-- Tenant-scoped select.
create policy components_select_org_member
on public.components
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = components.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped insert.
create policy components_insert_org_member
on public.components
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = components.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped update.
create policy components_update_org_member
on public.components
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = components.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = components.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped delete.
create policy components_delete_org_member
on public.components
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = components.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

commit;

