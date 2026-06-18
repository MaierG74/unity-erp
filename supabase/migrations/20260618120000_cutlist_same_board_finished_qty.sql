begin;

select pg_advisory_xact_lock(hashtext('20260618120000_cutlist_same_board_finished_qty'));

create table if not exists public.cutlist_same_board_finished_qty_ledger (
  migration_key text primary key,
  applied_at timestamptz not null default now()
);

insert into public.cutlist_same_board_finished_qty_ledger (migration_key)
values ('20260618120000_cutlist_same_board_finished_qty');

create table if not exists public.cutlist_same_board_finished_qty_rollback (
  id bigserial primary key,
  migration_key text not null,
  captured_at timestamptz not null default now(),
  table_name text not null,
  pk text not null,
  json_path text not null,
  old_qty numeric not null,
  new_qty numeric not null,
  old_json jsonb not null,
  new_json jsonb not null
);

create temp table _cutlist_sbqm_affected_orgs (
  org_id uuid primary key
) on commit drop;

create or replace function pg_temp._cutlist_sbqm_is_candidate(part jsonb, board_type text default null)
returns boolean
language sql
immutable
as $$
  select coalesce(part->>'_sbqm', '') <> 'finished-v1'
    and (
      part->>'lamination_type' = 'same-board'
      or (
        (not part ? 'lamination_type' or part->>'lamination_type' is null)
        and coalesce(board_type, '') like '%-both'
      )
    )
$$;

create or replace function pg_temp._cutlist_sbqm_new_part(part jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_set(
    jsonb_set(part, '{quantity}', to_jsonb(((part->>'quantity')::numeric / 2)), true),
    '{_sbqm}',
    to_jsonb('finished-v1'::text),
    true
  )
$$;

do $$
declare
  bad_count integer;
begin
  select count(*) into bad_count
  from (
    select 'product_cutlist_groups' as source, p.part
    from public.product_cutlist_groups pcg
    cross join lateral jsonb_array_elements(coalesce(pcg.parts, '[]'::jsonb)) as p(part)
    where pg_temp._cutlist_sbqm_is_candidate(p.part, pcg.board_type)

    union all
    select 'order_details' as source, p.part
    from public.order_details od
    cross join lateral jsonb_array_elements(coalesce(od.cutlist_material_snapshot, '[]'::jsonb)) as g(group_json)
    cross join lateral jsonb_array_elements(coalesce(g.group_json->'parts', '[]'::jsonb)) as p(part)
    where pg_temp._cutlist_sbqm_is_candidate(p.part, g.group_json->>'board_type')

    union all
    select 'quote_items' as source, p.part
    from public.quote_items qi
    cross join lateral jsonb_array_elements(coalesce(qi.cutlist_material_snapshot, '[]'::jsonb)) as g(group_json)
    cross join lateral jsonb_array_elements(coalesce(g.group_json->'parts', '[]'::jsonb)) as p(part)
    where pg_temp._cutlist_sbqm_is_candidate(p.part, g.group_json->>'board_type')

    union all
    select 'quote_item_cutlists' as source, p.part
    from public.quote_item_cutlists qic
    cross join lateral jsonb_array_elements(coalesce(qic.layout_json->'parts', '[]'::jsonb)) as p(part)
    where pg_temp._cutlist_sbqm_is_candidate(p.part, null)
  ) candidates
  where jsonb_typeof(part->'quantity') is distinct from 'number'
     or (part->>'quantity')::numeric <> trunc((part->>'quantity')::numeric)
     or mod((part->>'quantity')::numeric, 2) <> 0;

  if bad_count > 0 then
    raise exception 'cutlist same-board finished quantity migration aborted: % candidate quantities are odd or non-integer', bad_count;
  end if;
end
$$;

with candidates as (
  select
    pcg.id::text as pk,
    pcg.org_id,
    ('{parts,' || (p.ord - 1)::text || '}') as json_path,
    p.part as old_json,
    pg_temp._cutlist_sbqm_new_part(p.part) as new_json,
    (p.part->>'quantity')::numeric as old_qty,
    ((p.part->>'quantity')::numeric / 2) as new_qty
  from public.product_cutlist_groups pcg
  cross join lateral jsonb_array_elements(coalesce(pcg.parts, '[]'::jsonb)) with ordinality as p(part, ord)
  where pg_temp._cutlist_sbqm_is_candidate(p.part, pcg.board_type)
)
insert into public.cutlist_same_board_finished_qty_rollback
  (migration_key, table_name, pk, json_path, old_qty, new_qty, old_json, new_json)
select
  '20260618120000_cutlist_same_board_finished_qty',
  'product_cutlist_groups',
  pk,
  json_path,
  old_qty,
  new_qty,
  old_json,
  new_json
from candidates;

with rebuilt as (
  select
    pcg.id,
    pcg.org_id,
    jsonb_agg(
      case
        when pg_temp._cutlist_sbqm_is_candidate(p.part, pcg.board_type)
          then pg_temp._cutlist_sbqm_new_part(p.part)
        else p.part
      end
      order by p.ord
    ) as parts
  from public.product_cutlist_groups pcg
  cross join lateral jsonb_array_elements(coalesce(pcg.parts, '[]'::jsonb)) with ordinality as p(part, ord)
  group by pcg.id, pcg.org_id
),
updated as (
  update public.product_cutlist_groups pcg
  set parts = rebuilt.parts
  from rebuilt
  where pcg.id = rebuilt.id
    and pcg.parts is distinct from rebuilt.parts
  returning pcg.org_id
)
insert into _cutlist_sbqm_affected_orgs (org_id)
select distinct org_id from updated
on conflict do nothing;

with candidates as (
  select
    od.order_detail_id::text as pk,
    od.org_id,
    ('{cutlist_material_snapshot,' || (g.ord - 1)::text || ',parts,' || (p.ord - 1)::text || '}') as json_path,
    p.part as old_json,
    pg_temp._cutlist_sbqm_new_part(p.part) as new_json,
    (p.part->>'quantity')::numeric as old_qty,
    ((p.part->>'quantity')::numeric / 2) as new_qty
  from public.order_details od
  cross join lateral jsonb_array_elements(coalesce(od.cutlist_material_snapshot, '[]'::jsonb)) with ordinality as g(group_json, ord)
  cross join lateral jsonb_array_elements(coalesce(g.group_json->'parts', '[]'::jsonb)) with ordinality as p(part, ord)
  where pg_temp._cutlist_sbqm_is_candidate(p.part, g.group_json->>'board_type')
)
insert into public.cutlist_same_board_finished_qty_rollback
  (migration_key, table_name, pk, json_path, old_qty, new_qty, old_json, new_json)
select
  '20260618120000_cutlist_same_board_finished_qty',
  'order_details',
  pk,
  json_path,
  old_qty,
  new_qty,
  old_json,
  new_json
from candidates;

with rebuilt_groups as (
  select
    od.order_detail_id,
    od.org_id,
    g.ord as group_ord,
    jsonb_set(
      g.group_json,
      '{parts}',
      coalesce(jsonb_agg(
        case
          when pg_temp._cutlist_sbqm_is_candidate(p.part, g.group_json->>'board_type')
            then pg_temp._cutlist_sbqm_new_part(p.part)
          else p.part
        end
        order by p.ord
      ) filter (where p.part is not null), '[]'::jsonb),
      true
    ) as group_json
  from public.order_details od
  cross join lateral jsonb_array_elements(coalesce(od.cutlist_material_snapshot, '[]'::jsonb)) with ordinality as g(group_json, ord)
  left join lateral jsonb_array_elements(coalesce(g.group_json->'parts', '[]'::jsonb)) with ordinality as p(part, ord) on true
  group by od.order_detail_id, od.org_id, g.ord, g.group_json
),
rebuilt as (
  select
    order_detail_id,
    org_id,
    jsonb_agg(group_json order by group_ord) as snapshot
  from rebuilt_groups
  group by order_detail_id, org_id
),
updated as (
  update public.order_details od
  set cutlist_material_snapshot = rebuilt.snapshot
  from rebuilt
  where od.order_detail_id = rebuilt.order_detail_id
    and od.cutlist_material_snapshot is distinct from rebuilt.snapshot
  returning od.org_id
)
insert into _cutlist_sbqm_affected_orgs (org_id)
select distinct org_id from updated
on conflict do nothing;

with candidates as (
  select
    qi.id::text as pk,
    qi.org_id,
    ('{cutlist_material_snapshot,' || (g.ord - 1)::text || ',parts,' || (p.ord - 1)::text || '}') as json_path,
    p.part as old_json,
    pg_temp._cutlist_sbqm_new_part(p.part) as new_json,
    (p.part->>'quantity')::numeric as old_qty,
    ((p.part->>'quantity')::numeric / 2) as new_qty
  from public.quote_items qi
  cross join lateral jsonb_array_elements(coalesce(qi.cutlist_material_snapshot, '[]'::jsonb)) with ordinality as g(group_json, ord)
  cross join lateral jsonb_array_elements(coalesce(g.group_json->'parts', '[]'::jsonb)) with ordinality as p(part, ord)
  where pg_temp._cutlist_sbqm_is_candidate(p.part, g.group_json->>'board_type')
)
insert into public.cutlist_same_board_finished_qty_rollback
  (migration_key, table_name, pk, json_path, old_qty, new_qty, old_json, new_json)
select
  '20260618120000_cutlist_same_board_finished_qty',
  'quote_items',
  pk,
  json_path,
  old_qty,
  new_qty,
  old_json,
  new_json
from candidates;

with rebuilt_groups as (
  select
    qi.id,
    qi.org_id,
    g.ord as group_ord,
    jsonb_set(
      g.group_json,
      '{parts}',
      coalesce(jsonb_agg(
        case
          when pg_temp._cutlist_sbqm_is_candidate(p.part, g.group_json->>'board_type')
            then pg_temp._cutlist_sbqm_new_part(p.part)
          else p.part
        end
        order by p.ord
      ) filter (where p.part is not null), '[]'::jsonb),
      true
    ) as group_json
  from public.quote_items qi
  cross join lateral jsonb_array_elements(coalesce(qi.cutlist_material_snapshot, '[]'::jsonb)) with ordinality as g(group_json, ord)
  left join lateral jsonb_array_elements(coalesce(g.group_json->'parts', '[]'::jsonb)) with ordinality as p(part, ord) on true
  group by qi.id, qi.org_id, g.ord, g.group_json
),
rebuilt as (
  select id, org_id, jsonb_agg(group_json order by group_ord) as snapshot
  from rebuilt_groups
  group by id, org_id
),
updated as (
  update public.quote_items qi
  set cutlist_material_snapshot = rebuilt.snapshot
  from rebuilt
  where qi.id = rebuilt.id
    and qi.cutlist_material_snapshot is distinct from rebuilt.snapshot
  returning qi.org_id
)
insert into _cutlist_sbqm_affected_orgs (org_id)
select distinct org_id from updated
on conflict do nothing;

with candidates as (
  select
    qic.id::text as pk,
    qic.org_id,
    ('{layout_json,parts,' || (p.ord - 1)::text || '}') as json_path,
    p.part as old_json,
    pg_temp._cutlist_sbqm_new_part(p.part) as new_json,
    (p.part->>'quantity')::numeric as old_qty,
    ((p.part->>'quantity')::numeric / 2) as new_qty
  from public.quote_item_cutlists qic
  cross join lateral jsonb_array_elements(coalesce(qic.layout_json->'parts', '[]'::jsonb)) with ordinality as p(part, ord)
  where pg_temp._cutlist_sbqm_is_candidate(p.part, null)
)
insert into public.cutlist_same_board_finished_qty_rollback
  (migration_key, table_name, pk, json_path, old_qty, new_qty, old_json, new_json)
select
  '20260618120000_cutlist_same_board_finished_qty',
  'quote_item_cutlists',
  pk,
  json_path,
  old_qty,
  new_qty,
  old_json,
  new_json
from candidates;

with rebuilt as (
  select
    qic.id,
    qic.org_id,
    jsonb_set(
      qic.layout_json,
      '{parts}',
      coalesce(jsonb_agg(
        case
          when pg_temp._cutlist_sbqm_is_candidate(p.part, null)
            then pg_temp._cutlist_sbqm_new_part(p.part)
          else p.part
        end
        order by p.ord
      ), '[]'::jsonb),
      true
    ) as layout_json
  from public.quote_item_cutlists qic
  cross join lateral jsonb_array_elements(coalesce(qic.layout_json->'parts', '[]'::jsonb)) with ordinality as p(part, ord)
  group by qic.id, qic.org_id, qic.layout_json
),
updated as (
  update public.quote_item_cutlists qic
  set layout_json = rebuilt.layout_json
  from rebuilt
  where qic.id = rebuilt.id
    and qic.layout_json is distinct from rebuilt.layout_json
  returning qic.org_id
)
insert into _cutlist_sbqm_affected_orgs (org_id)
select distinct org_id from updated
on conflict do nothing;

update public.organizations o
set cutlist_defaults =
  jsonb_set(
    coalesce(o.cutlist_defaults, '{}'::jsonb),
    '{same_board_quantity_model}',
    to_jsonb('finished-v1'::text),
    true
  )
where exists (
  select 1 from _cutlist_sbqm_affected_orgs affected
  where affected.org_id = o.id
);

-- product_cutlist_costing_snapshots.parts_hash intentionally becomes stale
-- where product_cutlist_groups.parts changed. Existing readers treat a hash
-- mismatch as stale and recompute on the next save; this migration does not
-- rewrite snapshot_data or hashes.

-- Verification queries for the live run:
-- 1) Per-table rows captured:
--    select table_name, count(*) rows, sum(old_qty) old_qty, sum(new_qty) new_qty
--    from public.cutlist_same_board_finished_qty_rollback
--    where migration_key = '20260618120000_cutlist_same_board_finished_qty'
--    group by table_name
--    order by table_name;
--
-- 2) Any unmarked same-board candidate left behind should return zero rows:
--    with remaining as (
--      select 'product_cutlist_groups' table_name, pcg.id::text pk
--      from public.product_cutlist_groups pcg,
--        lateral jsonb_array_elements(coalesce(pcg.parts, '[]'::jsonb)) p(part)
--      where pg_temp._cutlist_sbqm_is_candidate(p.part, pcg.board_type)
--      union all
--      select 'order_details', od.order_detail_id::text
--      from public.order_details od,
--        lateral jsonb_array_elements(coalesce(od.cutlist_material_snapshot, '[]'::jsonb)) g(group_json),
--        lateral jsonb_array_elements(coalesce(g.group_json->'parts', '[]'::jsonb)) p(part)
--      where pg_temp._cutlist_sbqm_is_candidate(p.part, g.group_json->>'board_type')
--      union all
--      select 'quote_items', qi.id::text
--      from public.quote_items qi,
--        lateral jsonb_array_elements(coalesce(qi.cutlist_material_snapshot, '[]'::jsonb)) g(group_json),
--        lateral jsonb_array_elements(coalesce(g.group_json->'parts', '[]'::jsonb)) p(part)
--      where pg_temp._cutlist_sbqm_is_candidate(p.part, g.group_json->>'board_type')
--      union all
--      select 'quote_item_cutlists', qic.id::text
--      from public.quote_item_cutlists qic,
--        lateral jsonb_array_elements(coalesce(qic.layout_json->'parts', '[]'::jsonb)) p(part)
--      where pg_temp._cutlist_sbqm_is_candidate(p.part, null)
--    )
--    select table_name, count(*) from remaining group by table_name;
--
-- 3) Affected orgs should have the finished flag:
--    select o.id, o.name, o.cutlist_defaults->>'same_board_quantity_model' model
--    from public.organizations o
--    where exists (
--      select 1
--      from public.cutlist_same_board_finished_qty_rollback r
--      where r.migration_key = '20260618120000_cutlist_same_board_finished_qty'
--        and (
--          (r.table_name = 'product_cutlist_groups' and exists (select 1 from public.product_cutlist_groups pcg where pcg.id::text = r.pk and pcg.org_id = o.id))
--          or (r.table_name = 'order_details' and exists (select 1 from public.order_details od where od.order_detail_id::text = r.pk and od.org_id = o.id))
--          or (r.table_name = 'quote_items' and exists (select 1 from public.quote_items qi where qi.id::text = r.pk and qi.org_id = o.id))
--          or (r.table_name = 'quote_item_cutlists' and exists (select 1 from public.quote_item_cutlists qic where qic.id::text = r.pk and qic.org_id = o.id))
--        )
--    );

commit;
