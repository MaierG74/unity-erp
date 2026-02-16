-- Tenant RLS rollout Step 6 (prep only): order_details policies, keep RLS disabled for now.

begin;

drop policy if exists order_details_select_org_member on public.order_details;
drop policy if exists order_details_insert_org_member on public.order_details;
drop policy if exists order_details_update_org_member on public.order_details;
drop policy if exists order_details_delete_org_member on public.order_details;

create policy order_details_select_org_member
on public.order_details
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = order_details.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

create policy order_details_insert_org_member
on public.order_details
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = order_details.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

create policy order_details_update_org_member
on public.order_details
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = order_details.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = order_details.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

create policy order_details_delete_org_member
on public.order_details
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = order_details.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

commit;
