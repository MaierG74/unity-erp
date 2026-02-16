-- Tenant RLS rollout Step 5 (prep only): orders policies, keep RLS disabled for now.
-- This prepares safe tenant-scoped policies before the RLS enable flip.

begin;

-- Remove old broad policy if present.
drop policy if exists "All Access Orders" on public.orders;

-- Idempotent cleanup for re-runs.
drop policy if exists orders_select_org_member on public.orders;
drop policy if exists orders_insert_org_member on public.orders;
drop policy if exists orders_update_org_member on public.orders;
drop policy if exists orders_delete_org_member on public.orders;

create policy orders_select_org_member
on public.orders
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = orders.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

create policy orders_insert_org_member
on public.orders
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = orders.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

create policy orders_update_org_member
on public.orders
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = orders.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = orders.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

create policy orders_delete_org_member
on public.orders
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = orders.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

commit;
