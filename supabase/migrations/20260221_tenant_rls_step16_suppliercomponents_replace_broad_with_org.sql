-- Tenant RLS rollout Step 16 (baby step): suppliercomponents only.
-- Replace permissive policies with org-scoped policies.

begin;

-- Remove old permissive policies.
drop policy if exists authenticated_users_all_access on public.suppliercomponents;

-- Idempotent cleanup for re-runs.
drop policy if exists suppliercomponents_select_org_member on public.suppliercomponents;
drop policy if exists suppliercomponents_insert_org_member on public.suppliercomponents;
drop policy if exists suppliercomponents_update_org_member on public.suppliercomponents;
drop policy if exists suppliercomponents_delete_org_member on public.suppliercomponents;

-- Tenant-scoped select.
create policy suppliercomponents_select_org_member
on public.suppliercomponents
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = suppliercomponents.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped insert.
create policy suppliercomponents_insert_org_member
on public.suppliercomponents
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = suppliercomponents.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped update.
create policy suppliercomponents_update_org_member
on public.suppliercomponents
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = suppliercomponents.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = suppliercomponents.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped delete.
create policy suppliercomponents_delete_org_member
on public.suppliercomponents
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = suppliercomponents.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

commit;
