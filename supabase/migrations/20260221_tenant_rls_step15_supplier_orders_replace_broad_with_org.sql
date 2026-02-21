-- Tenant RLS rollout Step 15 (baby step): supplier_orders only.
-- Replace permissive policies with org-scoped policies.

begin;

-- Remove old permissive policies.
drop policy if exists "Allow authenticated users full access" on public.supplier_orders;
drop policy if exists authenticated_users_all_access on public.supplier_orders;

-- Idempotent cleanup for re-runs.
drop policy if exists supplier_orders_select_org_member on public.supplier_orders;
drop policy if exists supplier_orders_insert_org_member on public.supplier_orders;
drop policy if exists supplier_orders_update_org_member on public.supplier_orders;
drop policy if exists supplier_orders_delete_org_member on public.supplier_orders;

-- Tenant-scoped select.
create policy supplier_orders_select_org_member
on public.supplier_orders
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = supplier_orders.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped insert.
create policy supplier_orders_insert_org_member
on public.supplier_orders
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = supplier_orders.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped update.
create policy supplier_orders_update_org_member
on public.supplier_orders
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = supplier_orders.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = supplier_orders.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped delete.
create policy supplier_orders_delete_org_member
on public.supplier_orders
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = supplier_orders.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

commit;
