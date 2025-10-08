begin;

alter table public.option_set_values
  add column if not exists default_component_id integer references public.components(component_id),
  add column if not exists default_supplier_component_id integer references public.suppliercomponents(supplier_component_id),
  add column if not exists default_quantity_delta numeric,
  add column if not exists default_notes text,
  add column if not exists default_is_cutlist boolean,
  add column if not exists default_cutlist_category text,
  add column if not exists default_cutlist_dimensions jsonb;

create index if not exists option_set_values_default_component_idx
  on public.option_set_values(default_component_id)
  where default_component_id is not null;

create index if not exists option_set_values_default_supplier_component_idx
  on public.option_set_values(default_supplier_component_id)
  where default_supplier_component_id is not null;

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
  v.attributes,
  null::integer as default_component_id,
  null::integer as default_supplier_component_id,
  null::numeric as default_quantity_delta,
  null::text as default_notes,
  null::boolean as default_is_cutlist,
  null::text as default_cutlist_category,
  null::jsonb as default_cutlist_dimensions
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
  sv.attributes,
  sv.default_component_id,
  sv.default_supplier_component_id,
  sv.default_quantity_delta,
  sv.default_notes,
  sv.default_is_cutlist,
  sv.default_cutlist_category,
  sv.default_cutlist_dimensions
from public.option_set_groups sg
join public.option_set_values sv on sv.option_set_group_id = sg.option_set_group_id;

comment on view public.option_value_catalog is 'Unified catalog of option values across global sets and product-specific groups, including default component metadata.';

commit;
