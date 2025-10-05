drop function if exists public.get_product_components(integer, jsonb);

drop function if exists public.get_product_components(integer);

create function public.get_product_components(
    p_product_id integer,
    p_selected_options jsonb default '{}'::jsonb
)
returns table (
    component_id integer,
    quantity numeric,
    supplier_component_id integer,
    configuration_scope text,
    option_group_code text,
    option_value_code text,
    quantity_source text,
    notes text,
    is_cutlist_item boolean,
    cutlist_category text,
    cutlist_dimensions jsonb,
    attributes jsonb,
    component_description text,
    supplier_price numeric
)
language plpgsql
set search_path = public
as $function$
declare
    has_overrides boolean := coalesce(to_regclass('public.bom_option_overrides') is not null, false);
    has_option_groups boolean := coalesce(to_regclass('public.product_option_groups') is not null, false);
    has_option_values boolean := coalesce(to_regclass('public.product_option_values') is not null, false);
    has_option_sets boolean := coalesce(to_regclass('public.option_set_values') is not null, false);
    option_sql text;
begin
    if has_overrides and ( (has_option_groups and has_option_values) or has_option_sets ) then
        option_sql := $$with base as (
                select
                    b.component_id,
                    b.quantity_required as quantity,
                    b.supplier_component_id,
                    'base'::text as configuration_scope,
                    null::text as option_group_code,
                    null::text as option_value_code,
                    'billofmaterials'::text as quantity_source,
                    null::text as notes,
                    b.is_cutlist_item,
                    b.cutlist_category,
                    b.cutlist_dimensions,
                    b.attributes,
                    c.description as component_description,
                    sc.price as supplier_price
                from public.billofmaterials b
                left join public.components c on c.component_id = b.component_id
                left join public.suppliercomponents sc on sc.supplier_component_id = b.supplier_component_id
                where b.product_id = $1
            )$$;

        if has_option_groups and has_option_values then
            option_sql := option_sql || $$,
            product_overrides as (
                select
                    coalesce(o.replace_component_id, b.component_id) as component_id,
                    case
                        when o.replace_component_id is null then b.quantity_required + coalesce(o.quantity_delta, 0)
                        else coalesce(o.quantity_delta, b.quantity_required)
                    end as quantity,
                    coalesce(o.replace_supplier_component_id, b.supplier_component_id) as supplier_component_id,
                    'option'::text as configuration_scope,
                    g.code as option_group_code,
                    v.code as option_value_code,
                    'override'::text as quantity_source,
                    o.notes,
                    coalesce(o.is_cutlist_item, b.is_cutlist_item) as is_cutlist_item,
                    coalesce(o.cutlist_category, b.cutlist_category) as cutlist_category,
                    coalesce(o.cutlist_dimensions, b.cutlist_dimensions) as cutlist_dimensions,
                    coalesce(o.attributes, b.attributes) as attributes,
                    coalesce(rc.description, c.description) as component_description,
                    coalesce(rsc.price, sc.price) as supplier_price
                from public.bom_option_overrides o
                join public.billofmaterials b on b.bom_id = o.bom_id
                join public.product_option_values v on v.option_value_id = o.option_value_id
                join public.product_option_groups g on g.option_group_id = v.option_group_id
                left join public.components c on c.component_id = b.component_id
                left join public.components rc on rc.component_id = o.replace_component_id
                left join public.suppliercomponents sc on sc.supplier_component_id = b.supplier_component_id
                left join public.suppliercomponents rsc on rsc.supplier_component_id = o.replace_supplier_component_id
                where b.product_id = $1
                  and ( $2 ->> g.code ) = v.code
            )$$;
        end if;

        if has_option_sets then
            option_sql := option_sql || $$,
            set_overrides as (
                select
                    coalesce(o.replace_component_id, b.component_id) as component_id,
                    case
                        when o.replace_component_id is null then b.quantity_required + coalesce(o.quantity_delta, 0)
                        else coalesce(o.quantity_delta, b.quantity_required)
                    end as quantity,
                    coalesce(o.replace_supplier_component_id, b.supplier_component_id) as supplier_component_id,
                    'option'::text as configuration_scope,
                    sg.code as option_group_code,
                    sv.code as option_value_code,
                    'override'::text as quantity_source,
                    o.notes,
                    coalesce(o.is_cutlist_item, b.is_cutlist_item) as is_cutlist_item,
                    coalesce(o.cutlist_category, b.cutlist_category) as cutlist_category,
                    coalesce(o.cutlist_dimensions, b.cutlist_dimensions) as cutlist_dimensions,
                    coalesce(o.attributes, b.attributes) as attributes,
                    coalesce(rc.description, c.description) as component_description,
                    coalesce(rsc.price, sc.price) as supplier_price
                from public.bom_option_overrides o
                join public.billofmaterials b on b.bom_id = o.bom_id
                join public.option_set_values sv on sv.option_set_value_id = o.option_set_value_id
                join public.option_set_groups sg on sg.option_set_group_id = sv.option_set_group_id
                join public.product_option_set_links l on l.option_set_id = sg.option_set_id and l.product_id = b.product_id
                left join public.product_option_group_overlays g_ol
                  on g_ol.link_id = l.link_id and g_ol.option_set_group_id = sg.option_set_group_id
                left join public.product_option_value_overlays v_ol
                  on v_ol.link_id = l.link_id and v_ol.option_set_value_id = sv.option_set_value_id
                left join public.components c on c.component_id = b.component_id
                left join public.components rc on rc.component_id = o.replace_component_id
                left join public.suppliercomponents sc on sc.supplier_component_id = b.supplier_component_id
                left join public.suppliercomponents rsc on rsc.supplier_component_id = o.replace_supplier_component_id
                where b.product_id = $1
                  and coalesce(g_ol.hide, false) = false
                  and coalesce(v_ol.hide, false) = false
                  and ( $2 ->> sg.code ) = sv.code
            )$$;
        end if;

        option_sql := option_sql || $$
            select * from base$$;

        if has_option_groups and has_option_values then
            option_sql := option_sql || $$
            union all
            select * from product_overrides$$;
        end if;

        if has_option_sets then
            option_sql := option_sql || $$
            union all
            select * from set_overrides$$;
        end if;

        return query execute option_sql using p_product_id, p_selected_options;
    else
        return query
        select
            b.component_id,
            b.quantity_required as quantity,
            b.supplier_component_id,
            'base'::text as configuration_scope,
            null::text as option_group_code,
            null::text as option_value_code,
            'billofmaterials'::text as quantity_source,
            null::text as notes,
            b.is_cutlist_item,
            b.cutlist_category,
            b.cutlist_dimensions,
            b.attributes,
            c.description as component_description,
            sc.price as supplier_price
        from public.billofmaterials b
        left join public.components c on c.component_id = b.component_id
        left join public.suppliercomponents sc on sc.supplier_component_id = b.supplier_component_id
        where b.product_id = p_product_id;
    end if;
end;
$function$;

comment on function public.get_product_components(integer, jsonb)
    is 'Resolve a product''s BOM, optionally applying selected option values when supporting tables are present.';
