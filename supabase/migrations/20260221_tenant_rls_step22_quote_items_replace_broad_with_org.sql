-- Tenant RLS rollout Step 22 (baby step): quote_items only.
-- Remove duplicate broad policies and replace with org-scoped policies.

begin;

-- Remove old permissive policies.
drop policy if exists allow_all_on_quote_items on public.quote_items;
drop policy if exists "Open select quote_items" on public.quote_items;
drop policy if exists "Open insert quote_items" on public.quote_items;
drop policy if exists "Open update quote_items" on public.quote_items;
drop policy if exists "Open delete quote_items" on public.quote_items;

-- Idempotent cleanup for re-runs.
drop policy if exists quote_items_select_org_member on public.quote_items;
drop policy if exists quote_items_insert_org_member on public.quote_items;
drop policy if exists quote_items_update_org_member on public.quote_items;
drop policy if exists quote_items_delete_org_member on public.quote_items;

-- Tenant-scoped select.
create policy quote_items_select_org_member
on public.quote_items
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = quote_items.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped insert.
create policy quote_items_insert_org_member
on public.quote_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = quote_items.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped update.
create policy quote_items_update_org_member
on public.quote_items
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = quote_items.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = quote_items.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped delete.
create policy quote_items_delete_org_member
on public.quote_items
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = quote_items.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

commit;
