begin;

alter table public.billofmaterials
  add column if not exists is_cutlist_item boolean not null default false,
  add column if not exists cutlist_category text,
  add column if not exists cutlist_dimensions jsonb,
  add column if not exists attributes jsonb;

create table if not exists public.product_option_groups (
  option_group_id bigserial primary key,
  product_id integer not null references public.products(product_id) on delete cascade,
  code text not null,
  label text not null,
  display_order integer not null default 0,
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists product_option_groups_product_code_idx
  on public.product_option_groups (product_id, lower(code));

create table if not exists public.product_option_values (
  option_value_id bigserial primary key,
  option_group_id integer not null references public.product_option_groups(option_group_id) on delete cascade,
  code text not null,
  label text not null,
  is_default boolean not null default false,
  display_order integer not null default 0,
  attributes jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists product_option_values_group_code_idx
  on public.product_option_values (option_group_id, lower(code));

create unique index if not exists product_option_values_single_default_idx
  on public.product_option_values(option_group_id)
  where is_default;

create table if not exists public.product_option_presets (
  preset_id bigserial primary key,
  product_id integer not null references public.products(product_id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists product_option_presets_product_name_idx
  on public.product_option_presets (product_id, lower(name));

create table if not exists public.product_option_preset_values (
  preset_value_id bigserial primary key,
  preset_id integer not null references public.product_option_presets(preset_id) on delete cascade,
  option_group_id integer not null references public.product_option_groups(option_group_id) on delete cascade,
  option_value_id integer not null references public.product_option_values(option_value_id) on delete cascade,
  unique(preset_id, option_group_id)
);

create table if not exists public.bom_option_overrides (
  override_id bigserial primary key,
  bom_id integer not null references public.billofmaterials(bom_id) on delete cascade,
  option_value_id integer not null references public.product_option_values(option_value_id) on delete cascade,
  replace_component_id integer references public.components(component_id),
  replace_supplier_component_id integer references public.suppliercomponents(supplier_component_id),
  quantity_delta numeric,
  notes text,
  is_cutlist_item boolean,
  cutlist_category text,
  cutlist_dimensions jsonb,
  attributes jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(bom_id, option_value_id)
);

comment on column public.billofmaterials.is_cutlist_item is 'Flag rows that should feed the cutlist processor.';
comment on column public.billofmaterials.cutlist_dimensions is 'JSON payload for cutlist dimensions (length, width, thickness, grain, edge flags).';
comment on column public.billofmaterials.attributes is 'Additional configuration metadata stored per BOM row.';
comment on table public.product_option_groups is 'Configurable option groups per product.';
comment on table public.product_option_values is 'Option values for a product option group.';
comment on table public.bom_option_overrides is 'Adjustments to BOM rows when a specific option value is selected.';

commit;
