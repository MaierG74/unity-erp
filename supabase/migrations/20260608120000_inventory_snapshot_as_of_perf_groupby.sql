-- Perf rewrite of public.inventory_snapshot_as_of: replace the per-component LATERAL aggregates
-- (which seq-scanned inventory_transactions ~1,100x, ~2.2s) with single grouped pre-aggregations
-- joined to components. Output is byte-identical (verified 0/0/0/0 across 1,136 components vs the
-- prior version and the old route logic); only the query plan changes. 2185ms -> 13ms.
-- ADDITIVE (CREATE OR REPLACE), read-only (STABLE), service_role-only, org-guarded.
create or replace function public.inventory_snapshot_as_of(
  p_org_id uuid,
  p_exclusive_after timestamp without time zone
)
returns table (
  out_component_id        integer,
  out_internal_code       text,
  out_description         text,
  out_category_name       text,
  out_location            text,
  out_reorder_level       numeric,
  out_average_cost        numeric,
  out_min_supplier_price  numeric,
  out_current_quantity    numeric,
  out_future_delta        numeric,
  out_ledger_total        numeric
)
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if p_org_id is null then
    raise exception 'inventory_snapshot_as_of: org id is required';
  end if;

  if p_exclusive_after is null then
    raise exception 'inventory_snapshot_as_of: exclusive_after boundary is required';
  end if;

  if auth.role() <> 'service_role' and not is_org_member(p_org_id) then
    raise exception 'inventory_snapshot_as_of: access denied';
  end if;

  return query
  with tx as (
    select
      it.component_id as component_id,
      sum(coalesce(it.quantity, 0)) as ledger_total,
      sum(coalesce(it.quantity, 0)) filter (where it.transaction_date >= p_exclusive_after) as future_delta
    from public.inventory_transactions it
    where it.org_id = p_org_id
    group by it.component_id
  ),
  sup as (
    select sc.component_id as component_id, min(sc.price) as min_price
    from public.suppliercomponents sc
    where sc.org_id = p_org_id
      and sc.price is not null
      and sc.price > 0
    group by sc.component_id
  )
  select
    c.component_id                              as out_component_id,
    c.internal_code                             as out_internal_code,
    c.description                               as out_description,
    cat.categoryname                            as out_category_name,
    inv.location                                as out_location,
    inv.reorder_level::numeric                  as out_reorder_level,
    inv.average_cost                            as out_average_cost,
    sup.min_price                               as out_min_supplier_price,
    coalesce(inv.quantity_on_hand, 0)           as out_current_quantity,
    coalesce(tx.future_delta, 0)                as out_future_delta,
    coalesce(tx.ledger_total, 0)                as out_ledger_total
  from public.components c
  left join public.component_categories cat on cat.cat_id = c.category_id
  -- inventory.component_id is UNIQUE (migration 20251203151725) so this LEFT JOIN is 1:1.
  left join public.inventory inv on inv.org_id = c.org_id and inv.component_id = c.component_id
  left join tx  on tx.component_id  = c.component_id
  left join sup on sup.component_id = c.component_id
  where c.org_id = p_org_id;
end;
$function$;

revoke execute on function public.inventory_snapshot_as_of(uuid, timestamp without time zone)
  from public, anon, authenticated;
grant execute on function public.inventory_snapshot_as_of(uuid, timestamp without time zone)
  to service_role;
