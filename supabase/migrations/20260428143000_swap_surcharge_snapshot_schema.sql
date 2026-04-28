begin;

alter table public.quote_items
  add column if not exists product_id integer null,
  add column if not exists bom_snapshot jsonb null default null,
  add column if not exists surcharge_total numeric(12,2) not null default 0;

alter table public.order_details
  add column if not exists surcharge_total numeric(12,2) not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.products'::regclass
      and conname = 'products_product_id_org_id_key'
  ) then
    alter table public.products
      add constraint products_product_id_org_id_key unique (product_id, org_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.quote_items'::regclass
      and conname = 'quote_items_product_org_fk'
  ) then
    alter table public.quote_items
      add constraint quote_items_product_org_fk
      foreign key (product_id, org_id)
      references public.products (product_id, org_id)
      not valid;

    alter table public.quote_items
      validate constraint quote_items_product_org_fk;
  end if;
end $$;

update public.order_details od
set bom_snapshot = (
  select jsonb_agg(
    entry || jsonb_build_object(
      'swap_kind',
        coalesce(
          nullif(entry->>'swap_kind', ''),
          case
            when coalesce((entry->>'is_removed')::boolean, false) then 'removed'
            when coalesce((entry->>'is_substituted')::boolean, false) then 'alternative'
            else 'default'
          end
        ),
      'is_removed', coalesce((entry->>'is_removed')::boolean, false),
      'effective_component_id',
        coalesce((entry->>'effective_component_id')::integer, (entry->>'component_id')::integer),
      'effective_component_code',
        coalesce(nullif(entry->>'effective_component_code', ''), nullif(entry->>'component_code', ''), entry->>'component_id'),
      'effective_quantity_required',
        coalesce(
          (entry->>'effective_quantity_required')::numeric,
          case
            when coalesce((entry->>'is_removed')::boolean, false) then 0
            else coalesce((entry->>'quantity_required')::numeric, 0)
          end
        ),
      'effective_unit_price',
        coalesce(
          (entry->>'effective_unit_price')::numeric,
          case
            when coalesce((entry->>'is_removed')::boolean, false) then 0
            else coalesce((entry->>'unit_price')::numeric, 0)
          end
        ),
      'effective_line_total',
        coalesce(
          (entry->>'effective_line_total')::numeric,
          case
            when coalesce((entry->>'is_removed')::boolean, false) then 0
            else coalesce((entry->>'line_total')::numeric, coalesce((entry->>'unit_price')::numeric, 0) * coalesce((entry->>'quantity_required')::numeric, 0))
          end
        ),
      'default_unit_price',
        coalesce((entry->>'default_unit_price')::numeric, (entry->>'unit_price')::numeric, 0),
      'surcharge_amount', coalesce((entry->>'surcharge_amount')::numeric, 0),
      'surcharge_label', case when nullif(entry->>'surcharge_label', '') is null then null else entry->>'surcharge_label' end
    )
    order by ord
  )
  from jsonb_array_elements(od.bom_snapshot) with ordinality as elem(entry, ord)
)
where od.bom_snapshot is not null
  and jsonb_typeof(od.bom_snapshot) = 'array'
  and jsonb_array_length(od.bom_snapshot) > 0
  and exists (
    select 1
    from jsonb_array_elements(od.bom_snapshot) entry
    where not (entry ? 'swap_kind')
       or not (entry ? 'effective_component_id')
       or not (entry ? 'effective_quantity_required')
       or not (entry ? 'effective_line_total')
       or not (entry ? 'surcharge_amount')
  );

comment on column public.quote_items.product_id is
  'Optional product reference for snapshot-based quote product rows. Tenant-paired by quote_items_product_org_fk.';
comment on column public.quote_items.bom_snapshot is
  'Frozen BOM snapshot for snapshot-based quote product rows; mirrors order_details.bom_snapshot shape.';
comment on column public.quote_items.surcharge_total is
  'Commercial surcharge total for this quote item, derived from bom_snapshot swap entries.';
comment on column public.order_details.surcharge_total is
  'Commercial surcharge total for this order line, derived from bom_snapshot swap entries.';

commit;
