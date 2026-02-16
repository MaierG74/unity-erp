-- Tenant RLS rollout Step 2 (baby step): customers only.
-- Replaces broad authenticated policies with org-scoped policies.

begin;

-- Remove old broad policies if present.
drop policy if exists "All Access Customers" on public.customers;
drop policy if exists "Authenticated users can delete customers" on public.customers;
drop policy if exists "Authenticated users can insert customers" on public.customers;
drop policy if exists "Authenticated users can select customers" on public.customers;
drop policy if exists "Authenticated users can update customers" on public.customers;

-- Idempotent cleanup for re-runs.
drop policy if exists customers_select_org_member on public.customers;
drop policy if exists customers_insert_org_member on public.customers;
drop policy if exists customers_update_org_member on public.customers;
drop policy if exists customers_delete_org_member on public.customers;

-- Tenant-scoped select.
create policy customers_select_org_member
on public.customers
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = customers.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped insert.
create policy customers_insert_org_member
on public.customers
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = customers.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped update.
create policy customers_update_org_member
on public.customers
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = customers.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = customers.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped delete.
create policy customers_delete_org_member
on public.customers
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = customers.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

commit;
