-- Tenant RLS rollout Step 9a (baby step): add org-scoped policies for inventory_transactions.
-- Leave the existing broad policy in place for now; Step 9b removes it.

begin;

-- Idempotent cleanup for re-runs.
drop policy if exists inventory_transactions_select_org_member on public.inventory_transactions;
drop policy if exists inventory_transactions_insert_org_member on public.inventory_transactions;
drop policy if exists inventory_transactions_update_org_member on public.inventory_transactions;
drop policy if exists inventory_transactions_delete_org_member on public.inventory_transactions;

-- Tenant-scoped select.
create policy inventory_transactions_select_org_member
on public.inventory_transactions
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = inventory_transactions.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped insert.
create policy inventory_transactions_insert_org_member
on public.inventory_transactions
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = inventory_transactions.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped update.
create policy inventory_transactions_update_org_member
on public.inventory_transactions
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = inventory_transactions.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = inventory_transactions.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped delete.
create policy inventory_transactions_delete_org_member
on public.inventory_transactions
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = inventory_transactions.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

commit;

