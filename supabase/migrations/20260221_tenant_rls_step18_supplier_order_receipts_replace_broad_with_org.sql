-- Tenant RLS rollout Step 18 (baby step): supplier_order_receipts only.
-- Replace permissive policies with org-scoped policies.

begin;

-- Remove old permissive policies.
drop policy if exists "Authenticated users can select from supplier_order_receipts" on public.supplier_order_receipts;
drop policy if exists "Authenticated users can insert into supplier_order_receipts" on public.supplier_order_receipts;
drop policy if exists "Authenticated users can update supplier_order_receipts" on public.supplier_order_receipts;
drop policy if exists "Authenticated users can delete from supplier_order_receipts" on public.supplier_order_receipts;

-- Idempotent cleanup for re-runs.
drop policy if exists supplier_order_receipts_select_org_member on public.supplier_order_receipts;
drop policy if exists supplier_order_receipts_insert_org_member on public.supplier_order_receipts;
drop policy if exists supplier_order_receipts_update_org_member on public.supplier_order_receipts;
drop policy if exists supplier_order_receipts_delete_org_member on public.supplier_order_receipts;

-- Tenant-scoped select.
create policy supplier_order_receipts_select_org_member
on public.supplier_order_receipts
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = supplier_order_receipts.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped insert.
create policy supplier_order_receipts_insert_org_member
on public.supplier_order_receipts
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = supplier_order_receipts.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped update.
create policy supplier_order_receipts_update_org_member
on public.supplier_order_receipts
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = supplier_order_receipts.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = supplier_order_receipts.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped delete.
create policy supplier_order_receipts_delete_org_member
on public.supplier_order_receipts
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = supplier_order_receipts.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

commit;
