begin;

create or replace function public.compute_cutlist_surcharge(
  p_kind text,
  p_value numeric,
  p_quantity numeric,
  p_unit_price numeric
) returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_kind = 'percentage' then round(coalesce(p_unit_price, 0) * coalesce(p_quantity, 0) * coalesce(p_value, 0) / 100, 2)
    else round(coalesce(p_value, 0) * coalesce(p_quantity, 0), 2)
  end;
$$;

create or replace function public.compute_bom_snapshot_surcharge_total(
  p_snapshot jsonb,
  p_quantity numeric
) returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  per_unit numeric := 0;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'array' then
    return 0;
  end if;

  select coalesce(sum(coalesce((entry->>'surcharge_amount')::numeric, 0)), 0)
    into per_unit
  from jsonb_array_elements(p_snapshot) as entry;

  return round(per_unit * coalesce(p_quantity, 0), 2);
end;
$$;

create or replace function public.recompute_order_detail_surcharge_total()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.cutlist_surcharge_resolved := public.compute_cutlist_surcharge(
    new.cutlist_surcharge_kind,
    new.cutlist_surcharge_value,
    new.quantity,
    new.unit_price
  );
  new.surcharge_total :=
    public.compute_bom_snapshot_surcharge_total(new.bom_snapshot, new.quantity)
    + new.cutlist_surcharge_resolved;

  return new;
end;
$$;

create or replace function public.recompute_quote_item_surcharge_total()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.cutlist_surcharge_resolved := public.compute_cutlist_surcharge(
    new.cutlist_surcharge_kind,
    new.cutlist_surcharge_value,
    new.qty,
    new.unit_price
  );
  new.surcharge_total :=
    public.compute_bom_snapshot_surcharge_total(new.bom_snapshot, new.qty)
    + new.cutlist_surcharge_resolved;

  return new;
end;
$$;

drop trigger if exists order_details_recompute_surcharge_total on public.order_details;
create trigger order_details_recompute_surcharge_total
  before insert or update of
    quantity,
    unit_price,
    bom_snapshot,
    cutlist_surcharge_kind,
    cutlist_surcharge_value,
    surcharge_total,
    cutlist_surcharge_resolved
  on public.order_details
  for each row
  execute function public.recompute_order_detail_surcharge_total();

drop trigger if exists quote_items_recompute_surcharge_total on public.quote_items;
create trigger quote_items_recompute_surcharge_total
  before insert or update of
    qty,
    unit_price,
    bom_snapshot,
    cutlist_surcharge_kind,
    cutlist_surcharge_value,
    surcharge_total,
    cutlist_surcharge_resolved
  on public.quote_items
  for each row
  execute function public.recompute_quote_item_surcharge_total();

create temp table a2_backfill_preflight_orders on commit drop as
select
  order_detail_id,
  coalesce(surcharge_total, 0) as old_surcharge_total,
  coalesce(cutlist_surcharge_resolved, 0) as old_cutlist_resolved,
  public.compute_bom_snapshot_surcharge_total(bom_snapshot, quantity)
    + public.compute_cutlist_surcharge(cutlist_surcharge_kind, cutlist_surcharge_value, quantity, unit_price)
    as new_surcharge_total,
  public.compute_cutlist_surcharge(cutlist_surcharge_kind, cutlist_surcharge_value, quantity, unit_price)
    as new_cutlist_resolved
from public.order_details;

create temp table a2_backfill_preflight_quotes on commit drop as
select
  id as quote_item_id,
  coalesce(surcharge_total, 0) as old_surcharge_total,
  coalesce(cutlist_surcharge_resolved, 0) as old_cutlist_resolved,
  public.compute_bom_snapshot_surcharge_total(bom_snapshot, qty)
    + public.compute_cutlist_surcharge(cutlist_surcharge_kind, cutlist_surcharge_value, qty, unit_price)
    as new_surcharge_total,
  public.compute_cutlist_surcharge(cutlist_surcharge_kind, cutlist_surcharge_value, qty, unit_price)
    as new_cutlist_resolved
from public.quote_items;

create temp table a2_backfill_worst_order_drift on commit drop as
select
  order_detail_id,
  old_surcharge_total,
  new_surcharge_total,
  old_cutlist_resolved,
  new_cutlist_resolved,
  abs(new_surcharge_total - old_surcharge_total) as surcharge_total_drift,
  abs(new_cutlist_resolved - old_cutlist_resolved) as cutlist_resolved_drift
from a2_backfill_preflight_orders
where abs(new_surcharge_total - old_surcharge_total) > 0.01
   or abs(new_cutlist_resolved - old_cutlist_resolved) > 0.01
order by greatest(
  abs(new_surcharge_total - old_surcharge_total),
  abs(new_cutlist_resolved - old_cutlist_resolved)
) desc
limit 20;

create temp table a2_backfill_worst_quote_drift on commit drop as
select
  quote_item_id,
  old_surcharge_total,
  new_surcharge_total,
  old_cutlist_resolved,
  new_cutlist_resolved,
  abs(new_surcharge_total - old_surcharge_total) as surcharge_total_drift,
  abs(new_cutlist_resolved - old_cutlist_resolved) as cutlist_resolved_drift
from a2_backfill_preflight_quotes
where abs(new_surcharge_total - old_surcharge_total) > 0.01
   or abs(new_cutlist_resolved - old_cutlist_resolved) > 0.01
order by greatest(
  abs(new_surcharge_total - old_surcharge_total),
  abs(new_cutlist_resolved - old_cutlist_resolved)
) desc
limit 20;

do $$
declare
  order_total_rows integer;
  order_drift_rows integer;
  order_drift_pct numeric;
  order_max_drift numeric;
  quote_total_rows integer;
  quote_drift_rows integer;
  quote_drift_pct numeric;
  quote_max_drift numeric;
begin
  select
    count(*),
    count(*) filter (
      where abs(new_surcharge_total - old_surcharge_total) > 0.01
         or abs(new_cutlist_resolved - old_cutlist_resolved) > 0.01
    ),
    round(100.0 * count(*) filter (
      where abs(new_surcharge_total - old_surcharge_total) > 0.01
         or abs(new_cutlist_resolved - old_cutlist_resolved) > 0.01
    ) / nullif(count(*), 0), 2),
    coalesce(max(greatest(
      abs(new_surcharge_total - old_surcharge_total),
      abs(new_cutlist_resolved - old_cutlist_resolved)
    )), 0)
  into order_total_rows, order_drift_rows, order_drift_pct, order_max_drift
  from a2_backfill_preflight_orders;

  select
    count(*),
    count(*) filter (
      where abs(new_surcharge_total - old_surcharge_total) > 0.01
         or abs(new_cutlist_resolved - old_cutlist_resolved) > 0.01
    ),
    round(100.0 * count(*) filter (
      where abs(new_surcharge_total - old_surcharge_total) > 0.01
         or abs(new_cutlist_resolved - old_cutlist_resolved) > 0.01
    ) / nullif(count(*), 0), 2),
    coalesce(max(greatest(
      abs(new_surcharge_total - old_surcharge_total),
      abs(new_cutlist_resolved - old_cutlist_resolved)
    )), 0)
  into quote_total_rows, quote_drift_rows, quote_drift_pct, quote_max_drift
  from a2_backfill_preflight_quotes;

  raise notice 'POL-85 A2 order_details drift: %/% rows (% percent), max drift R%',
    order_drift_rows, order_total_rows, coalesce(order_drift_pct, 0), order_max_drift;
  raise notice 'POL-85 A2 quote_items drift: %/% rows (% percent), max drift R%',
    quote_drift_rows, quote_total_rows, coalesce(quote_drift_pct, 0), quote_max_drift;

  if coalesce(order_drift_pct, 0) > 5 or coalesce(quote_drift_pct, 0) > 5 then
    raise exception 'POL-85 A2 backfill drift exceeds 5%% threshold';
  end if;

  if order_max_drift > 100 or quote_max_drift > 100 then
    raise exception 'POL-85 A2 backfill drift exceeds R100 single-row threshold';
  end if;
end $$;

update public.order_details
set quantity = quantity;

update public.quote_items
set qty = qty;

do $$
declare
  order_violations integer;
  quote_violations integer;
begin
  select count(*)
    into order_violations
  from public.order_details od
  join a2_backfill_preflight_orders p on p.order_detail_id = od.order_detail_id
  where abs(coalesce(od.surcharge_total, 0) - p.new_surcharge_total) > 0.01
     or abs(coalesce(od.cutlist_surcharge_resolved, 0) - p.new_cutlist_resolved) > 0.01;

  select count(*)
    into quote_violations
  from public.quote_items qi
  join a2_backfill_preflight_quotes p on p.quote_item_id = qi.id
  where abs(coalesce(qi.surcharge_total, 0) - p.new_surcharge_total) > 0.01
     or abs(coalesce(qi.cutlist_surcharge_resolved, 0) - p.new_cutlist_resolved) > 0.01;

  if order_violations > 0 or quote_violations > 0 then
    raise exception 'POL-85 A2 post-apply parity failed: % order_details rows, % quote_items rows',
      order_violations, quote_violations;
  end if;
end $$;

commit;
