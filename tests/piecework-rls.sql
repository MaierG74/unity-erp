-- POL-60 manual RLS verification script.
-- Run against a disposable/test database or inside a rollback-only transaction.
-- The UUIDs below are fixed fixtures so the result is easy to compare with the
-- Linear delivery evidence.

begin;

insert into public.organizations (id, name)
values ('00000000-0000-4000-8000-00000000000a', 'POL60 Org A Test'),
       ('00000000-0000-4000-8000-00000000000b', 'POL60 Org B Test');

insert into public.organization_members (user_id, org_id, role, is_active)
values ('2d239689-3305-4a96-9559-1bcfb4a794ac', '00000000-0000-4000-8000-00000000000a', 'admin', true);

insert into public.piecework_activities (org_id, code, label, default_rate, unit_label)
values ('00000000-0000-4000-8000-00000000000b', 'cut_pieces', 'Org B Cutting', 1.00, 'piece');

create temp table pol60_rls_results (check_name text, passed boolean, detail text);
grant all on table pol60_rls_results to authenticated;

select set_config('request.jwt.claim.sub', '2d239689-3305-4a96-9559-1bcfb4a794ac', true);
set local role authenticated;

insert into pol60_rls_results
select 'select org-b piecework_activities hidden', count(*) = 0, 'visible=' || count(*)::text
from public.piecework_activities
where org_id = '00000000-0000-4000-8000-00000000000b';

insert into pol60_rls_results
select 'select org-b piecework_card_adjustments hidden', count(*) = 0, 'visible=' || count(*)::text
from public.piecework_card_adjustments
where org_id = '00000000-0000-4000-8000-00000000000b';

do $$
begin
  insert into public.piecework_activities (org_id, code, label, default_rate, unit_label)
  values ('00000000-0000-4000-8000-00000000000b', 'edge_bundles', 'Forbidden', 1.00, 'bundle');
  insert into pol60_rls_results values ('insert org-b piecework_activities rejected', false, 'insert unexpectedly succeeded');
exception when insufficient_privilege then
  insert into pol60_rls_results values ('insert org-b piecework_activities rejected', true, sqlerrm);
when others then
  insert into pol60_rls_results values ('insert org-b piecework_activities rejected', sqlstate in ('42501'), sqlstate || ': ' || sqlerrm);
end $$;

do $$
begin
  update public.piecework_activities
  set label = 'Forbidden'
  where org_id = '00000000-0000-4000-8000-00000000000b';
  insert into pol60_rls_results values ('update org-b piecework_activities affects zero rows', true, 'hidden rows make update a no-op');
exception when others then
  insert into pol60_rls_results values ('update org-b piecework_activities affects zero rows', false, sqlstate || ': ' || sqlerrm);
end $$;

do $$
begin
  delete from public.piecework_activities
  where org_id = '00000000-0000-4000-8000-00000000000b';
  insert into pol60_rls_results values ('delete org-b piecework_activities affects zero rows', true, 'hidden rows make delete a no-op');
exception when others then
  insert into pol60_rls_results values ('delete org-b piecework_activities affects zero rows', false, sqlstate || ': ' || sqlerrm);
end $$;

do $$
begin
  insert into public.piecework_card_adjustments (org_id, job_card_id, old_count, new_count, reason, adjusted_by)
  values ('00000000-0000-4000-8000-00000000000b', 1, null, 1, 'Forbidden', '2d239689-3305-4a96-9559-1bcfb4a794ac');
  insert into pol60_rls_results values ('insert org-b piecework_card_adjustments rejected', false, 'insert unexpectedly succeeded');
exception when insufficient_privilege then
  insert into pol60_rls_results values ('insert org-b piecework_card_adjustments rejected', true, sqlerrm);
when others then
  insert into pol60_rls_results values ('insert org-b piecework_card_adjustments rejected', sqlstate in ('42501'), sqlstate || ': ' || sqlerrm);
end $$;

select * from pol60_rls_results order by check_name;

rollback;
