begin;

alter table public.quote_items
  add column if not exists cutlist_material_snapshot jsonb,
  add column if not exists cutlist_primary_material_id integer,
  add column if not exists cutlist_primary_backer_material_id integer,
  add column if not exists cutlist_primary_edging_id integer,
  add column if not exists cutlist_part_overrides jsonb not null default '[]'::jsonb,
  add column if not exists cutlist_surcharge_kind text not null default 'fixed',
  add column if not exists cutlist_surcharge_value numeric(12,2) not null default 0,
  add column if not exists cutlist_surcharge_label text,
  add column if not exists cutlist_surcharge_resolved numeric(12,2) not null default 0;

alter table public.order_details
  rename column cutlist_snapshot to cutlist_material_snapshot;

alter table public.order_details
  add column if not exists cutlist_primary_material_id integer,
  add column if not exists cutlist_primary_backer_material_id integer,
  add column if not exists cutlist_primary_edging_id integer,
  add column if not exists cutlist_part_overrides jsonb not null default '[]'::jsonb,
  add column if not exists cutlist_surcharge_kind text not null default 'fixed',
  add column if not exists cutlist_surcharge_value numeric(12,2) not null default 0,
  add column if not exists cutlist_surcharge_label text,
  add column if not exists cutlist_surcharge_resolved numeric(12,2) not null default 0;

alter table public.components
  add column if not exists surcharge_percentage numeric(5,2);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'components_surcharge_percentage_range_chk'
  ) then
    alter table public.components
      add constraint components_surcharge_percentage_range_chk
      check (surcharge_percentage is null or (surcharge_percentage >= -100 and surcharge_percentage <= 1000));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'components_component_id_org_id_key'
  ) then
    alter table public.components
      add constraint components_component_id_org_id_key unique (component_id, org_id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'quote_items_cutlist_surcharge_kind_chk') then
    alter table public.quote_items
      add constraint quote_items_cutlist_surcharge_kind_chk
      check (cutlist_surcharge_kind in ('fixed', 'percentage'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'order_details_cutlist_surcharge_kind_chk') then
    alter table public.order_details
      add constraint order_details_cutlist_surcharge_kind_chk
      check (cutlist_surcharge_kind in ('fixed', 'percentage'));
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quote_items_cutlist_primary_material_org_fk') then
    alter table public.quote_items
      add constraint quote_items_cutlist_primary_material_org_fk
      foreign key (cutlist_primary_material_id, org_id) references public.components(component_id, org_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quote_items_cutlist_primary_backer_org_fk') then
    alter table public.quote_items
      add constraint quote_items_cutlist_primary_backer_org_fk
      foreign key (cutlist_primary_backer_material_id, org_id) references public.components(component_id, org_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quote_items_cutlist_primary_edging_org_fk') then
    alter table public.quote_items
      add constraint quote_items_cutlist_primary_edging_org_fk
      foreign key (cutlist_primary_edging_id, org_id) references public.components(component_id, org_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'order_details_cutlist_primary_material_org_fk') then
    alter table public.order_details
      add constraint order_details_cutlist_primary_material_org_fk
      foreign key (cutlist_primary_material_id, org_id) references public.components(component_id, org_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'order_details_cutlist_primary_backer_org_fk') then
    alter table public.order_details
      add constraint order_details_cutlist_primary_backer_org_fk
      foreign key (cutlist_primary_backer_material_id, org_id) references public.components(component_id, org_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'order_details_cutlist_primary_edging_org_fk') then
    alter table public.order_details
      add constraint order_details_cutlist_primary_edging_org_fk
      foreign key (cutlist_primary_edging_id, org_id) references public.components(component_id, org_id);
  end if;
end $$;

create table if not exists public.board_edging_pairs (
  id bigserial primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  board_component_id integer not null,
  thickness_mm numeric(8,2) not null,
  edging_component_id integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint board_edging_pairs_board_org_fk foreign key (board_component_id, org_id)
    references public.components(component_id, org_id),
  constraint board_edging_pairs_edging_org_fk foreign key (edging_component_id, org_id)
    references public.components(component_id, org_id),
  constraint board_edging_pairs_unique unique (org_id, board_component_id, thickness_mm)
);

create index if not exists idx_board_edging_pairs_lookup
  on public.board_edging_pairs (org_id, board_component_id, thickness_mm);

create or replace function public.update_board_edging_pairs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists board_edging_pairs_updated_at on public.board_edging_pairs;
create trigger board_edging_pairs_updated_at
before update on public.board_edging_pairs
for each row execute function public.update_board_edging_pairs_updated_at();

alter table public.board_edging_pairs enable row level security;

drop policy if exists board_edging_pairs_select_org_member on public.board_edging_pairs;
create policy board_edging_pairs_select_org_member on public.board_edging_pairs
  for select using (public.is_org_member(org_id));

drop policy if exists board_edging_pairs_insert_org_member on public.board_edging_pairs;
create policy board_edging_pairs_insert_org_member on public.board_edging_pairs
  for insert with check (public.is_org_member(org_id));

drop policy if exists board_edging_pairs_update_org_member on public.board_edging_pairs;
create policy board_edging_pairs_update_org_member on public.board_edging_pairs
  for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

drop policy if exists board_edging_pairs_delete_org_member on public.board_edging_pairs;
create policy board_edging_pairs_delete_org_member on public.board_edging_pairs
  for delete using (public.is_org_member(org_id));

create temp table a1_cutlist_backfill_part_roles on commit drop as
with details as (
  select
    od.order_detail_id,
    od.order_id,
    od.product_id,
    od.org_id,
    coalesce(od.quantity, 1)::numeric as line_quantity,
    o.material_assignments
  from public.order_details od
  join public.orders o on o.order_id = od.order_id
  where o.material_assignments is not null
    and o.material_assignments <> '{}'::jsonb
    and jsonb_typeof(o.material_assignments->'assignments') = 'array'
),
group_parts as (
  select
    d.order_detail_id,
    d.order_id,
    d.product_id,
    d.org_id,
    d.line_quantity,
    d.material_assignments,
    pcg.board_type,
    pcg.primary_material_id as nominal_board_component_id,
    pcg.backer_material_id as nominal_backer_component_id,
    part.value as part_json,
    part.value->>'id' as part_id,
    part.value->>'name' as part_name,
    nullif(part.value->>'length_mm', '')::numeric as length_mm,
    nullif(part.value->>'width_mm', '')::numeric as width_mm,
    coalesce(nullif(part.value->>'quantity', '')::numeric, 1) as part_quantity,
    coalesce(
      nullif(part.value->>'material_thickness', '')::numeric,
      case when pcg.board_type in ('32mm-both', '32mm-backer') then 32 else 16 end
    ) as thickness_mm,
    coalesce((part.value->'band_edges'->>'top')::boolean, false)
      or coalesce((part.value->'band_edges'->>'bottom')::boolean, false)
      or coalesce((part.value->'band_edges'->>'left')::boolean, false)
      or coalesce((part.value->'band_edges'->>'right')::boolean, false) as has_edges
  from details d
  join public.product_cutlist_groups pcg
    on pcg.product_id = d.product_id
   and pcg.org_id = d.org_id
  cross join lateral jsonb_array_elements(coalesce(pcg.parts, '[]'::jsonb)) as part(value)
),
assignment_rows as (
  select
    gp.*,
    nullif(assign.value->>'component_id', '')::integer as assigned_board_component_id,
    assign.value->>'component_name' as assigned_board_component_name
  from group_parts gp
  left join lateral (
    select a.value
    from jsonb_array_elements(coalesce(gp.material_assignments->'assignments', '[]'::jsonb)) as a(value)
    where nullif(a.value->>'order_detail_id', '')::integer = gp.order_detail_id
      and a.value->>'board_type' = gp.board_type
      and a.value->>'part_name' = gp.part_name
      and nullif(a.value->>'length_mm', '')::numeric = gp.length_mm
      and nullif(a.value->>'width_mm', '')::numeric = gp.width_mm
    limit 1
  ) assign on true
),
edge_defaults as (
  select
    d.order_id,
    nullif(ed.value->>'board_component_id', '')::integer as board_component_id,
    nullif(ed.value->>'edging_component_id', '')::integer as edging_component_id,
    ed.value->>'edging_component_name' as edging_component_name
  from details d
  cross join lateral jsonb_array_elements(coalesce(d.material_assignments->'edging_defaults', '[]'::jsonb)) ed(value)
),
edge_overrides as (
  select
    d.order_id,
    nullif(eo.value->>'order_detail_id', '')::integer as order_detail_id,
    eo.value->>'board_type' as board_type,
    eo.value->>'part_name' as part_name,
    nullif(eo.value->>'length_mm', '')::numeric as length_mm,
    nullif(eo.value->>'width_mm', '')::numeric as width_mm,
    nullif(eo.value->>'edging_component_id', '')::integer as edging_component_id,
    eo.value->>'edging_component_name' as edging_component_name
  from details d
  cross join lateral jsonb_array_elements(coalesce(d.material_assignments->'edging_overrides', '[]'::jsonb)) eo(value)
)
select
  ar.*,
  coalesce(ar.assigned_board_component_id, ar.nominal_board_component_id) as effective_board_component_id,
  eo.edging_component_id as override_edging_component_id,
  eo.edging_component_name as override_edging_component_name,
  ed.edging_component_id as default_edging_component_id,
  ed.edging_component_name as default_edging_component_name,
  coalesce(eo.edging_component_id, ed.edging_component_id) as effective_edging_component_id,
  coalesce(eo.edging_component_name, ed.edging_component_name) as effective_edging_component_name
from assignment_rows ar
left join edge_defaults ed
  on ed.order_id = ar.order_id
 and ed.board_component_id = coalesce(ar.assigned_board_component_id, ar.nominal_board_component_id)
left join edge_overrides eo
  on eo.order_id = ar.order_id
 and eo.order_detail_id = ar.order_detail_id
 and eo.board_type = ar.board_type
 and eo.part_name = ar.part_name
 and eo.length_mm = ar.length_mm
 and eo.width_mm = ar.width_mm;

create temp table a1_cutlist_backfill_line_primary on commit drop as
with counts as (
  select
    order_detail_id,
    effective_board_component_id as board_component_id,
    sum(part_quantity * line_quantity) as weighted_count
  from a1_cutlist_backfill_part_roles
  where effective_board_component_id is not null
  group by order_detail_id, effective_board_component_id
),
ranked as (
  select
    *,
    row_number() over (
      partition by order_detail_id
      order by weighted_count desc, board_component_id asc
    ) as rn
  from counts
)
select order_detail_id, board_component_id as primary_board_component_id
from ranked
where rn = 1;

create temp table a1_cutlist_backfill_line_primary_thickness on commit drop as
with counts as (
  select
    pr.order_detail_id,
    p.thickness_mm,
    sum(p.part_quantity * p.line_quantity) as weighted_count
  from a1_cutlist_backfill_line_primary pr
  join a1_cutlist_backfill_part_roles p
    on p.order_detail_id = pr.order_detail_id
   and p.effective_board_component_id = pr.primary_board_component_id
  where p.thickness_mm is not null
  group by pr.order_detail_id, p.thickness_mm
),
ranked as (
  select
    *,
    row_number() over (
      partition by order_detail_id
      order by weighted_count desc, thickness_mm asc
    ) as rn
  from counts
)
select order_detail_id, thickness_mm
from ranked
where rn = 1;

create temp table a1_cutlist_backfill_line_primary_edging on commit drop as
with primary_edges as (
  select distinct
    pr.order_detail_id,
    p.thickness_mm,
    p.default_edging_component_id as edging_component_id
  from a1_cutlist_backfill_line_primary pr
  join a1_cutlist_backfill_part_roles p
    on p.order_detail_id = pr.order_detail_id
   and p.effective_board_component_id = pr.primary_board_component_id
  where p.default_edging_component_id is not null
),
edge_counts as (
  select
    order_detail_id,
    count(distinct edging_component_id) as edge_count,
    min(edging_component_id) as only_edging_component_id
  from primary_edges
  group by order_detail_id
)
select
  ec.order_detail_id,
  case
    when ec.edge_count = 1 then ec.only_edging_component_id
    else pe.edging_component_id
  end as primary_edging_component_id
from edge_counts ec
left join a1_cutlist_backfill_line_primary_thickness pt
  on pt.order_detail_id = ec.order_detail_id
left join primary_edges pe
  on pe.order_detail_id = ec.order_detail_id
 and pe.thickness_mm = pt.thickness_mm;

create temp table a1_cutlist_backfill_overrides on commit drop as
select
  p.order_detail_id,
  jsonb_agg(
    jsonb_strip_nulls(
      jsonb_build_object(
        'part_id', p.part_id,
        'part_name', p.part_name,
        'board_type', p.board_type,
        'length_mm', p.length_mm,
        'width_mm', p.width_mm,
        'board_component_id',
          case when p.effective_board_component_id is distinct from pr.primary_board_component_id
            then p.effective_board_component_id
            else null
          end,
        'board_component_name',
          case when p.effective_board_component_id is distinct from pr.primary_board_component_id
            then p.assigned_board_component_name
            else null
          end,
        'edging_component_id',
          case when p.effective_edging_component_id is distinct from pe.primary_edging_component_id
            then p.effective_edging_component_id
            else null
          end,
        'edging_component_name',
          case when p.effective_edging_component_id is distinct from pe.primary_edging_component_id
            then p.effective_edging_component_name
            else null
          end
      )
    )
    order by p.board_type, p.part_name, p.length_mm, p.width_mm, p.part_id
  ) filter (
    where p.effective_board_component_id is distinct from pr.primary_board_component_id
       or p.effective_edging_component_id is distinct from pe.primary_edging_component_id
  ) as part_overrides
from a1_cutlist_backfill_part_roles p
join a1_cutlist_backfill_line_primary pr
  on pr.order_detail_id = p.order_detail_id
left join a1_cutlist_backfill_line_primary_edging pe
  on pe.order_detail_id = p.order_detail_id
group by p.order_detail_id;

update public.order_details od
set
  cutlist_primary_material_id = pr.primary_board_component_id,
  cutlist_primary_backer_material_id = case
    when exists (
      select 1
      from a1_cutlist_backfill_part_roles p
      where p.order_detail_id = od.order_detail_id
        and p.nominal_backer_component_id is not null
    )
    then nullif(od_order.material_assignments->'backer_default'->>'component_id', '')::integer
    else null
  end,
  cutlist_primary_edging_id = pe.primary_edging_component_id,
  cutlist_part_overrides = coalesce(o.part_overrides, '[]'::jsonb)
from public.orders od_order
join a1_cutlist_backfill_line_primary pr on true
left join a1_cutlist_backfill_line_primary_edging pe on pe.order_detail_id = pr.order_detail_id
left join a1_cutlist_backfill_overrides o on o.order_detail_id = pr.order_detail_id
where od_order.order_id = od.order_id
  and pr.order_detail_id = od.order_detail_id;

insert into public.board_edging_pairs (org_id, board_component_id, thickness_mm, edging_component_id, created_at, updated_at)
select distinct on (org_id, effective_board_component_id, thickness_mm)
  org_id,
  effective_board_component_id,
  thickness_mm,
  effective_edging_component_id,
  now(),
  now()
from a1_cutlist_backfill_part_roles
where effective_board_component_id is not null
  and thickness_mm is not null
  and effective_edging_component_id is not null
order by org_id, effective_board_component_id, thickness_mm, effective_edging_component_id
on conflict on constraint board_edging_pairs_unique do nothing;

do $$
declare
  high_override_orders integer;
  total_backfilled_orders integer;
  loss_count integer;
begin
  with per_order as (
    select
      p.order_id,
      count(*) filter (
        where p.effective_board_component_id is distinct from pr.primary_board_component_id
      ) as override_count,
      count(*) as part_count
    from a1_cutlist_backfill_part_roles p
    join a1_cutlist_backfill_line_primary pr on pr.order_detail_id = p.order_detail_id
    group by p.order_id
  )
  select
    count(*) filter (where part_count > 0 and override_count::numeric / part_count > 0.30),
    count(*)
  into high_override_orders, total_backfilled_orders
  from per_order;

  if total_backfilled_orders > 0
     and high_override_orders::numeric / total_backfilled_orders > 0.05 then
    raise exception
      'POL-84 backfill override drift exceeded threshold: % of % orders have >30%% overrides',
      high_override_orders,
      total_backfilled_orders;
  end if;

  select count(*)
  into loss_count
  from a1_cutlist_backfill_part_roles p
  join public.order_details od on od.order_detail_id = p.order_detail_id
  left join a1_cutlist_backfill_line_primary_edging pe on pe.order_detail_id = p.order_detail_id
  where p.has_edges
    and p.effective_board_component_id is not null
    and p.effective_edging_component_id is not null
    and pe.primary_edging_component_id is null
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(od.cutlist_part_overrides, '[]'::jsonb)) ov(value)
      where ov.value->>'board_type' = p.board_type
        and ov.value->>'part_name' = p.part_name
        and nullif(ov.value->>'length_mm', '')::numeric = p.length_mm
        and nullif(ov.value->>'width_mm', '')::numeric = p.width_mm
        and nullif(ov.value->>'edging_component_id', '')::integer = p.effective_edging_component_id
    );

  if loss_count > 0 then
    raise exception
      'POL-84 edging-loss validation failed: % edged part roles with legacy edging would lose effective edging',
      loss_count;
  end if;
end $$;

commit;
