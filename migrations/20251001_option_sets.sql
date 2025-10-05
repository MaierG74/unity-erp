begin;

-- Global option sets
create table if not exists public.option_sets (
  option_set_id bigserial primary key,
  code text not null,
  name text not null,
  description text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists option_sets_code_unique_idx
  on public.option_sets (lower(code));

create table if not exists public.option_set_groups (
  option_set_group_id bigserial primary key,
  option_set_id bigint not null references public.option_sets(option_set_id) on delete cascade,
  code text not null,
  label text not null,
  display_order integer not null default 0,
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists option_set_groups_code_unique_idx
  on public.option_set_groups (option_set_id, lower(code));

create table if not exists public.option_set_values (
  option_set_value_id bigserial primary key,
  option_set_group_id bigint not null references public.option_set_groups(option_set_group_id) on delete cascade,
  code text not null,
  label text not null,
  is_default boolean not null default false,
  display_order integer not null default 0,
  attributes jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists option_set_values_code_unique_idx
  on public.option_set_values (option_set_group_id, lower(code));

create unique index if not exists option_set_values_single_default_idx
  on public.option_set_values(option_set_group_id)
  where is_default;

-- Product links to global sets
create table if not exists public.product_option_set_links (
  link_id bigserial primary key,
  product_id integer not null references public.products(product_id) on delete cascade,
  option_set_id bigint not null references public.option_sets(option_set_id) on delete cascade,
  display_order integer not null default 0,
  alias_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, option_set_id)
);

create table if not exists public.product_option_group_overlays (
  overlay_id bigserial primary key,
  link_id bigint not null references public.product_option_set_links(link_id) on delete cascade,
  option_set_group_id bigint not null references public.option_set_groups(option_set_group_id) on delete cascade,
  alias_label text,
  is_required boolean,
  hide boolean not null default false,
  display_order integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(link_id, option_set_group_id)
);

create table if not exists public.product_option_value_overlays (
  overlay_id bigserial primary key,
  link_id bigint not null references public.product_option_set_links(link_id) on delete cascade,
  option_set_value_id bigint not null references public.option_set_values(option_set_value_id) on delete cascade,
  alias_label text,
  is_default boolean,
  hide boolean not null default false,
  display_order integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(link_id, option_set_value_id)
);

-- Allow both global set values and legacy product-specific values in overrides
alter table public.bom_option_overrides
  add column if not exists option_set_value_id bigint references public.option_set_values(option_set_value_id);

-- ensure exactly one of option_value_id or option_set_value_id is populated
alter table public.bom_option_overrides
  drop constraint if exists bom_option_overrides_bom_id_option_value_id_key,
  drop constraint if exists bom_option_overrides_value_presence;

alter table public.bom_option_overrides
  add constraint bom_option_overrides_value_presence
    check ( (option_value_id is not null)::int + (option_set_value_id is not null)::int = 1 );

create unique index if not exists bom_option_overrides_unique_product_value
  on public.bom_option_overrides (bom_id, option_value_id)
  where option_value_id is not null;

create unique index if not exists bom_option_overrides_unique_set_value
  on public.bom_option_overrides (bom_id, option_set_value_id)
  where option_set_value_id is not null;

-- Unified view for option values (legacy + set-based)
create or replace view public.option_value_catalog as
select
  'product'::text as source,
  g.product_id,
  null::bigint as option_set_id,
  g.option_group_id,
  null::bigint as option_set_group_id,
  v.option_value_id,
  null::bigint as option_set_value_id,
  g.code as group_code,
  v.code as value_code,
  v.label,
  v.is_default,
  v.display_order,
  v.attributes
from public.product_option_groups g
join public.product_option_values v on v.option_group_id = g.option_group_id
union all
select
  'set'::text as source,
  null::integer as product_id,
  sg.option_set_id,
  null::integer as option_group_id,
  sg.option_set_group_id,
  null::bigint as option_value_id,
  sv.option_set_value_id,
  sg.code as group_code,
  sv.code as value_code,
  sv.label,
  sv.is_default,
  sv.display_order,
  sv.attributes
from public.option_set_groups sg
join public.option_set_values sv on sv.option_set_group_id = sg.option_set_group_id;

comment on view public.option_value_catalog is 'Unified catalog of option values across global sets and product-specific groups.';

commit;
