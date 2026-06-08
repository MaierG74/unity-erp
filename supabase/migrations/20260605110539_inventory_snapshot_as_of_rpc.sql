-- Inventory "Stock Snapshot As Of Date" RPC.
-- Replaces two UNPAGINATED service-role reads in app/api/inventory/snapshot/route.ts
-- (ALL components embed + ALL future inventory_transactions) that silently truncated at the
-- PostgREST 1,000-row cap. Aggregation is done in-DB; ONE ROW PER COMPONENT is returned.
-- ADDITIVE ONLY: new function, no ALTER/DROP, no writes.
--
-- Equivalence proven against live prod (org 99183187-...):
--   * as_of=today (boundary 2026-06-06): 1136 rows, 0 future_delta, 534 stocked, total 144849.90
--     (== live on-hand sum) -> behavior-preserving.
--   * as_of=2025-12-01 (boundary 2025-12-02): 6637 future tx consumed (impossible under 1000 cap),
--     per-component snapshot/current/future_delta drift vs old route logic = 0/0/0.
-- Reconciliation is component-anchored: 19 non-reconciling for this org today (the +1 over the
-- inventory-anchored 18 is component 67: ledger movement but no inventory row). Do NOT "fix" to 18.
--
-- Boundary semantics: p_exclusive_after is timestamp WITHOUT time zone. The route keeps emitting
-- its existing ISO string; PostgREST coerces it to naive timestamp (zone dropped) -> reproduces the
-- old .gte('transaction_date', exclusiveAfter) naive compare EXACTLY. Do NOT use timestamptz; it
-- would rotate by session tz and change which rows count as future.
--
-- KNOWN-DEFERRED: the naive-midnight tz boundary can mis-bucket a transaction stamped near local
-- midnight (UTC+2) by one day in historical snapshots. Preserved intentionally (behaviour parity);
-- fixing it is a separate audit of how transaction_date is written app-wide. Not in scope here.

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
  out_average_cost        numeric,   -- RAW inventory.average_cost (route applies cost precedence)
  out_min_supplier_price  numeric,   -- RAW MIN positive suppliercomponents.price (route applies precedence)
  out_current_quantity    numeric,   -- inventory.quantity_on_hand (0 when no inventory row)
  out_future_delta        numeric,   -- SUM(quantity) WHERE transaction_date >= p_exclusive_after
  out_ledger_total        numeric    -- SUM(all quantity) for the component in the org
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

  -- Driving table is components (one row per component per org) so components with NO inventory
  -- row and NO transactions still return a row -- matching the route, which defaults
  -- current_quantity to 0 via toNumber(undefined). No is_active filter (route has none).
  -- Every column is table-qualified; output names are out_-prefixed so they cannot shadow base
  -- columns (42702 guard). Per-component LATERAL aggregates so suppliers x transactions never
  -- cross-product.
  return query
  select
    c.component_id                                       as out_component_id,
    c.internal_code                                      as out_internal_code,
    c.description                                        as out_description,
    cat.categoryname                                     as out_category_name,
    inv.inv_location                                     as out_location,
    inv.inv_reorder_level                                as out_reorder_level,
    inv.inv_average_cost                                 as out_average_cost,
    msp.msp_min_price                                    as out_min_supplier_price,
    coalesce(inv.inv_quantity_on_hand, 0)                as out_current_quantity,
    coalesce(fut.fut_future_delta, 0)                    as out_future_delta,
    coalesce(led.led_ledger_total, 0)                    as out_ledger_total
  from public.components c
  -- component_categories is a GLOBAL lookup (no org_id column). Joining without an org filter is
  -- correct -- category names are not tenant data. Do NOT add an org filter here.
  left join public.component_categories cat
    on cat.cat_id = c.category_id
  -- inventory is 1:1 per (org, component); LIMIT 1 is a safety net. ORG FILTER on inventory.
  left join lateral (
    select
      i.quantity_on_hand    as inv_quantity_on_hand,
      i.location            as inv_location,
      i.reorder_level::numeric as inv_reorder_level,  -- reorder_level is INTEGER; cast to match RETURNS TABLE numeric
      i.average_cost        as inv_average_cost
    from public.inventory i
    where i.org_id = c.org_id
      and i.component_id = c.component_id
    limit 1
  ) inv on true
  -- Future-delta: reproduces old route's .gte('transaction_date', exclusiveAfter) exactly.
  -- Naive compare, no zone cast. ORG FILTER on inventory_transactions.
  left join lateral (
    select sum(coalesce(it.quantity, 0)) as fut_future_delta
    from public.inventory_transactions it
    where it.org_id = c.org_id
      and it.component_id = c.component_id
      and it.transaction_date >= p_exclusive_after
  ) fut on true
  -- Ledger-total: SUM of ALL signed quantity for the component in the org (reconciliation input).
  -- ORG FILTER on inventory_transactions. coalesce-to-0 happens in the outer select so a
  -- no-history component reports ledger_total=0 (reconciles vs current=0), not NULL.
  left join lateral (
    select sum(coalesce(it.quantity, 0)) as led_ledger_total
    from public.inventory_transactions it
    where it.org_id = c.org_id
      and it.component_id = c.component_id
  ) led on true
  -- Min POSITIVE supplier price (RAW input for the list-price cost fallback). Mirrors
  -- lib/inventory/snapshot.ts minListPrice (price > 0 only; NULL when none). ORG FILTER.
  left join lateral (
    select min(sc.price) as msp_min_price
    from public.suppliercomponents sc
    where sc.org_id = c.org_id
      and sc.component_id = c.component_id
      and sc.price is not null
      and sc.price > 0
  ) msp on true
  where c.org_id = p_org_id;  -- ORG FILTER on driving table -- closes the original truncation bug.
end;
$function$;

revoke execute on function public.inventory_snapshot_as_of(uuid, timestamp without time zone)
  from public, anon, authenticated;

grant execute on function public.inventory_snapshot_as_of(uuid, timestamp without time zone)
  to service_role;
