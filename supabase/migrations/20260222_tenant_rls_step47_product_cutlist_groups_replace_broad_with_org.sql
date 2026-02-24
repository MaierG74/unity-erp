-- Tenant RLS rollout Step 47 (baby step): product_cutlist_groups only.
-- Replace broad authenticated policies with org-scoped policies.

begin;

-- Remove old permissive policies.
drop policy if exists "Allow authenticated users to view cutlist groups" on public.product_cutlist_groups;
drop policy if exists "Allow authenticated users to insert cutlist groups" on public.product_cutlist_groups;
drop policy if exists "Allow authenticated users to update cutlist groups" on public.product_cutlist_groups;
drop policy if exists "Allow authenticated users to delete cutlist groups" on public.product_cutlist_groups;

-- Idempotent cleanup for re-runs.
drop policy if exists product_cutlist_groups_select_org_member on public.product_cutlist_groups;
drop policy if exists product_cutlist_groups_insert_org_member on public.product_cutlist_groups;
drop policy if exists product_cutlist_groups_update_org_member on public.product_cutlist_groups;
drop policy if exists product_cutlist_groups_delete_org_member on public.product_cutlist_groups;

-- Tenant-scoped select.
create policy product_cutlist_groups_select_org_member
on public.product_cutlist_groups
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = product_cutlist_groups.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped insert.
create policy product_cutlist_groups_insert_org_member
on public.product_cutlist_groups
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = product_cutlist_groups.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped update.
create policy product_cutlist_groups_update_org_member
on public.product_cutlist_groups
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = product_cutlist_groups.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = product_cutlist_groups.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped delete.
create policy product_cutlist_groups_delete_org_member
on public.product_cutlist_groups
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = product_cutlist_groups.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

commit;
