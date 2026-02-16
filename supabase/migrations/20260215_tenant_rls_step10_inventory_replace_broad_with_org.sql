-- Tenant RLS rollout Step 10 (baby step): inventory only.
-- Replace broad policies (including anon read) with org-scoped policies.

begin;

-- Remove old broad policies.
drop policy if exists "Allow anon read inventory" on public.inventory;
drop policy if exists "Allow authenticated read inventory" on public.inventory;
drop policy if exists "Allow authenticated insert inventory" on public.inventory;
drop policy if exists "Allow authenticated update inventory" on public.inventory;
drop policy if exists "Allow authenticated delete inventory" on public.inventory;

-- Idempotent cleanup for re-runs.
drop policy if exists inventory_select_org_member on public.inventory;
drop policy if exists inventory_insert_org_member on public.inventory;
drop policy if exists inventory_update_org_member on public.inventory;
drop policy if exists inventory_delete_org_member on public.inventory;

-- Tenant-scoped select.
create policy inventory_select_org_member
on public.inventory
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = inventory.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped insert.
create policy inventory_insert_org_member
on public.inventory
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = inventory.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped update.
create policy inventory_update_org_member
on public.inventory
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = inventory.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = inventory.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped delete.
create policy inventory_delete_org_member
on public.inventory
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = inventory.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

commit;

