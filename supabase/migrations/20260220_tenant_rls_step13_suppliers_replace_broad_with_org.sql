-- Tenant RLS rollout Step 13 (baby step): suppliers only.
-- Replace permissive policies with org-scoped policies.

begin;

-- Remove old permissive policies.
drop policy if exists authenticated_users_all_access on public.suppliers;
drop policy if exists authenticated_users_select_suppliers on public.suppliers;
drop policy if exists authenticated_users_insert_suppliers on public.suppliers;
drop policy if exists authenticated_users_update_suppliers on public.suppliers;
drop policy if exists authenticated_users_delete_suppliers on public.suppliers;

-- Idempotent cleanup for re-runs.
drop policy if exists suppliers_select_org_member on public.suppliers;
drop policy if exists suppliers_insert_org_member on public.suppliers;
drop policy if exists suppliers_update_org_member on public.suppliers;
drop policy if exists suppliers_delete_org_member on public.suppliers;

-- Tenant-scoped select.
create policy suppliers_select_org_member
on public.suppliers
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = suppliers.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped insert.
create policy suppliers_insert_org_member
on public.suppliers
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = suppliers.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped update.
create policy suppliers_update_org_member
on public.suppliers
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = suppliers.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = suppliers.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped delete.
create policy suppliers_delete_org_member
on public.suppliers
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = suppliers.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

commit;
