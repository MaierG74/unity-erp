-- Tenant RLS rollout Step 14 (baby step): purchase_orders only.
-- Replace permissive policies with org-scoped policies.

begin;

-- Remove old permissive policies.
drop policy if exists authenticated_users_all_access on public.purchase_orders;
drop policy if exists "Authenticated users can select from purchase_orders" on public.purchase_orders;
drop policy if exists "Authenticated users can insert into purchase_orders" on public.purchase_orders;
drop policy if exists "Authenticated users can update purchase_orders" on public.purchase_orders;
drop policy if exists "Authenticated users can delete from purchase_orders" on public.purchase_orders;

-- Idempotent cleanup for re-runs.
drop policy if exists purchase_orders_select_org_member on public.purchase_orders;
drop policy if exists purchase_orders_insert_org_member on public.purchase_orders;
drop policy if exists purchase_orders_update_org_member on public.purchase_orders;
drop policy if exists purchase_orders_delete_org_member on public.purchase_orders;

-- Tenant-scoped select.
create policy purchase_orders_select_org_member
on public.purchase_orders
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = purchase_orders.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped insert.
create policy purchase_orders_insert_org_member
on public.purchase_orders
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = purchase_orders.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped update.
create policy purchase_orders_update_org_member
on public.purchase_orders
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = purchase_orders.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = purchase_orders.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped delete.
create policy purchase_orders_delete_org_member
on public.purchase_orders
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = purchase_orders.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

commit;
