-- Tenant RLS rollout Step 11 (baby step): product_inventory_transactions only.
-- Replace broad authenticated-all policy with org-scoped policies.

begin;

-- Remove old broad policy if present.
drop policy if exists product_inventory_txn_authenticated_all on public.product_inventory_transactions;

-- Idempotent cleanup for re-runs.
drop policy if exists product_inventory_transactions_select_org_member on public.product_inventory_transactions;
drop policy if exists product_inventory_transactions_insert_org_member on public.product_inventory_transactions;
drop policy if exists product_inventory_transactions_update_org_member on public.product_inventory_transactions;
drop policy if exists product_inventory_transactions_delete_org_member on public.product_inventory_transactions;

-- Tenant-scoped select.
create policy product_inventory_transactions_select_org_member
on public.product_inventory_transactions
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = product_inventory_transactions.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped insert.
create policy product_inventory_transactions_insert_org_member
on public.product_inventory_transactions
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = product_inventory_transactions.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped update.
create policy product_inventory_transactions_update_org_member
on public.product_inventory_transactions
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = product_inventory_transactions.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = product_inventory_transactions.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped delete.
create policy product_inventory_transactions_delete_org_member
on public.product_inventory_transactions
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = product_inventory_transactions.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

commit;

