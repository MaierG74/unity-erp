DROP FUNCTION IF EXISTS public.get_product_components(integer, jsonb);

CREATE FUNCTION public.get_product_components(
    _product_id integer,
    _selected_options jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
    bom_id integer,
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
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
    has_overrides boolean := coalesce(to_regclass('public.bom_option_overrides') IS NOT NULL, false);
    has_option_groups boolean := coalesce(to_regclass('public.product_option_groups') IS NOT NULL, false);
    has_option_values boolean := coalesce(to_regclass('public.product_option_values') IS NOT NULL, false);
    has_option_sets boolean := coalesce(to_regclass('public.option_set_values') IS NOT NULL, false);
BEGIN
    IF has_overrides AND (has_option_groups OR has_option_sets) THEN
        RETURN QUERY
        WITH triggered_option_overrides AS (
            SELECT DISTINCT b.bom_id AS override_bom_id
            FROM public.bom_option_overrides o
            JOIN public.billofmaterials b ON b.bom_id = o.bom_id
            JOIN public.product_option_values v ON v.option_value_id = o.option_value_id
            JOIN public.product_option_groups g ON g.option_group_id = v.option_group_id
            WHERE b.product_id = _product_id
              AND o.option_value_id IS NOT NULL
              AND _selected_options ->> g.code = v.code
        ),
        triggered_set_overrides AS (
            SELECT DISTINCT b.bom_id AS override_bom_id
            FROM public.bom_option_overrides o
            JOIN public.billofmaterials b ON b.bom_id = o.bom_id
            JOIN public.option_set_values sv ON sv.option_set_value_id = o.option_set_value_id
            JOIN public.option_set_groups sg ON sg.option_set_group_id = sv.option_set_group_id
            WHERE b.product_id = _product_id
              AND o.option_set_value_id IS NOT NULL
              AND _selected_options ->> sg.code = sv.code
        ),
        triggered_overrides AS (
            SELECT override_bom_id FROM triggered_option_overrides
            UNION
            SELECT override_bom_id FROM triggered_set_overrides
        ),
        base AS (
            SELECT
                b.bom_id,
                b.component_id,
                b.quantity_required AS quantity,
                b.supplier_component_id,
                'base'::text AS configuration_scope,
                NULL::text AS option_group_code,
                NULL::text AS option_value_code,
                'billofmaterials'::text AS quantity_source,
                NULL::text AS notes,
                b.is_cutlist_item,
                b.cutlist_category,
                b.cutlist_dimensions,
                b.attributes,
                c.description AS component_description,
                sc.price AS supplier_price
            FROM public.billofmaterials b
            LEFT JOIN public.components c ON c.component_id = b.component_id
            LEFT JOIN public.suppliercomponents sc ON sc.supplier_component_id = b.supplier_component_id
            LEFT JOIN triggered_overrides tovr ON tovr.override_bom_id = b.bom_id
            WHERE b.product_id = _product_id
              AND tovr.bom_id IS NULL
        ),
        applied_product_overrides AS (
            SELECT
                b.bom_id,
                coalesce(o.replace_component_id, b.component_id) AS component_id,
                CASE
                    WHEN o.replace_component_id IS NULL THEN b.quantity_required + coalesce(o.quantity_delta, 0)
                    ELSE coalesce(o.quantity_delta, b.quantity_required)
                END AS quantity,
                coalesce(o.replace_supplier_component_id, b.supplier_component_id) AS supplier_component_id,
                'option'::text AS configuration_scope,
                g.code AS option_group_code,
                v.code AS option_value_code,
                'override'::text AS quantity_source,
                o.notes,
                coalesce(o.is_cutlist_item, b.is_cutlist_item) AS is_cutlist_item,
                coalesce(o.cutlist_category, b.cutlist_category) AS cutlist_category,
                coalesce(o.cutlist_dimensions, b.cutlist_dimensions) AS cutlist_dimensions,
                coalesce(o.attributes, b.attributes) AS attributes,
                coalesce(rc.description, c.description) AS component_description,
                coalesce(rsc.price, sc.price) AS supplier_price
            FROM public.bom_option_overrides o
            JOIN public.billofmaterials b ON b.bom_id = o.bom_id
            JOIN public.product_option_values v ON v.option_value_id = o.option_value_id
            JOIN public.product_option_groups g ON g.option_group_id = v.option_group_id
            LEFT JOIN public.components c ON c.component_id = b.component_id
            LEFT JOIN public.components rc ON rc.component_id = o.replace_component_id
            LEFT JOIN public.suppliercomponents sc ON sc.supplier_component_id = b.supplier_component_id
            LEFT JOIN public.suppliercomponents rsc ON rsc.supplier_component_id = o.replace_supplier_component_id
            WHERE b.product_id = _product_id
              AND o.option_value_id IS NOT NULL
              AND _selected_options ->> g.code = v.code
        ),
        applied_set_overrides AS (
            SELECT
                b.bom_id,
                coalesce(o.replace_component_id, b.component_id) AS component_id,
                CASE
                    WHEN o.replace_component_id IS NULL THEN b.quantity_required + coalesce(o.quantity_delta, 0)
                    ELSE coalesce(o.quantity_delta, b.quantity_required)
                END AS quantity,
                coalesce(o.replace_supplier_component_id, b.supplier_component_id) AS supplier_component_id,
                'option_set'::text AS configuration_scope,
                sg.code AS option_group_code,
                sv.code AS option_value_code,
                'override'::text AS quantity_source,
                o.notes,
                coalesce(o.is_cutlist_item, b.is_cutlist_item) AS is_cutlist_item,
                coalesce(o.cutlist_category, b.cutlist_category) AS cutlist_category,
                coalesce(o.cutlist_dimensions, b.cutlist_dimensions) AS cutlist_dimensions,
                coalesce(o.attributes, b.attributes) AS attributes,
                coalesce(rc.description, c.description) AS component_description,
                coalesce(rsc.price, sc.price) AS supplier_price
            FROM public.bom_option_overrides o
            JOIN public.billofmaterials b ON b.bom_id = o.bom_id
            JOIN public.option_set_values sv ON sv.option_set_value_id = o.option_set_value_id
            JOIN public.option_set_groups sg ON sg.option_set_group_id = sv.option_set_group_id
            LEFT JOIN public.components c ON c.component_id = b.component_id
            LEFT JOIN public.components rc ON rc.component_id = o.replace_component_id
            LEFT JOIN public.suppliercomponents sc ON sc.supplier_component_id = b.supplier_component_id
            LEFT JOIN public.suppliercomponents rsc ON rsc.supplier_component_id = o.replace_supplier_component_id
            WHERE b.product_id = _product_id
              AND o.option_set_value_id IS NOT NULL
              AND _selected_options ->> sg.code = sv.code
        )
        SELECT * FROM base
        UNION ALL
        SELECT * FROM applied_product_overrides
        UNION ALL
        SELECT * FROM applied_set_overrides;
    ELSE
        RETURN QUERY
        SELECT
            b.bom_id,
            b.component_id,
            b.quantity_required AS quantity,
            b.supplier_component_id,
            'base'::text AS configuration_scope,
            NULL::text AS option_group_code,
            NULL::text AS option_value_code,
            'billofmaterials'::text AS quantity_source,
            NULL::text AS notes,
            b.is_cutlist_item,
            b.cutlist_category,
            b.cutlist_dimensions,
            b.attributes,
            c.description AS component_description,
            sc.price AS supplier_price
        FROM public.billofmaterials b
        LEFT JOIN public.components c ON c.component_id = b.component_id
        LEFT JOIN public.suppliercomponents sc ON sc.supplier_component_id = b.supplier_component_id
        WHERE b.product_id = _product_id;
    END IF;
END;
$function$;

COMMENT ON FUNCTION public.get_product_components(integer, jsonb)
    IS 'Resolve a product''s BOM, applying option and option-set overrides when selections are provided.';
