-- Tenant RLS rollout Step 4 (baby step): product_reservations only.
-- Replaces broad authenticated-all policy with org-scoped policies.

begin;

-- Remove old broad policy if present.
drop policy if exists product_reservations_authenticated_all on public.product_reservations;

-- Idempotent cleanup for re-runs.
drop policy if exists product_reservations_select_org_member on public.product_reservations;
drop policy if exists product_reservations_insert_org_member on public.product_reservations;
drop policy if exists product_reservations_update_org_member on public.product_reservations;
drop policy if exists product_reservations_delete_org_member on public.product_reservations;

create policy product_reservations_select_org_member
on public.product_reservations
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = product_reservations.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

create policy product_reservations_insert_org_member
on public.product_reservations
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = product_reservations.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

create policy product_reservations_update_org_member
on public.product_reservations
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = product_reservations.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = product_reservations.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

create policy product_reservations_delete_org_member
on public.product_reservations
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = product_reservations.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

commit;
