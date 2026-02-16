-- Tenant RLS rollout Step 3 (baby step): product_inventory only.
-- Replaces broad authenticated-all policy with org-scoped policies.

begin;

-- Remove old broad policy if present.
drop policy if exists product_inventory_authenticated_all on public.product_inventory;

-- Idempotent cleanup for re-runs.
drop policy if exists product_inventory_select_org_member on public.product_inventory;
drop policy if exists product_inventory_insert_org_member on public.product_inventory;
drop policy if exists product_inventory_update_org_member on public.product_inventory;
drop policy if exists product_inventory_delete_org_member on public.product_inventory;

create policy product_inventory_select_org_member
on public.product_inventory
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = product_inventory.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

create policy product_inventory_insert_org_member
on public.product_inventory
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = product_inventory.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

create policy product_inventory_update_org_member
on public.product_inventory
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = product_inventory.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = product_inventory.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

create policy product_inventory_delete_org_member
on public.product_inventory
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = product_inventory.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

commit;
