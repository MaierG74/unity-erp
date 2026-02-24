-- Tenant RLS rollout Step 49 (baby step): supplier_pricelists only.
-- Replace broad authenticated policy with org-scoped policies.

begin;

-- Remove old permissive policy.
drop policy if exists "Authenticated users read and write." on public.supplier_pricelists;

-- Idempotent cleanup for re-runs.
drop policy if exists supplier_pricelists_select_org_member on public.supplier_pricelists;
drop policy if exists supplier_pricelists_insert_org_member on public.supplier_pricelists;
drop policy if exists supplier_pricelists_update_org_member on public.supplier_pricelists;
drop policy if exists supplier_pricelists_delete_org_member on public.supplier_pricelists;

-- Tenant-scoped select.
create policy supplier_pricelists_select_org_member
on public.supplier_pricelists
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = supplier_pricelists.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped insert.
create policy supplier_pricelists_insert_org_member
on public.supplier_pricelists
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = supplier_pricelists.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped update.
create policy supplier_pricelists_update_org_member
on public.supplier_pricelists
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = supplier_pricelists.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = supplier_pricelists.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped delete.
create policy supplier_pricelists_delete_org_member
on public.supplier_pricelists
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = supplier_pricelists.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

commit;
