-- POL-73 Phase A2: order totals trigger + surcharge-aware quote totals.
-- Ports the legacy order total trigger into Supabase-managed history, adds
-- surcharge_total to order/quote sums, and backfills current order totals.

create or replace function public.update_order_total()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  order_pk integer;
  items_sum numeric;
begin
  if TG_OP = 'DELETE' then
    order_pk := OLD.order_id;
  else
    order_pk := NEW.order_id;
  end if;

  select coalesce(sum(quantity * unit_price + coalesce(surcharge_total, 0)), 0)
    into items_sum
  from public.order_details
  where order_id = order_pk;

  update public.orders
  set
    total_amount = items_sum,
    updated_at = now()
  where order_id = order_pk;

  return null;
end;
$$;

drop trigger if exists order_details_total_update_trigger on public.order_details;
create trigger order_details_total_update_trigger
  after insert or update of quantity, unit_price, surcharge_total or delete
  on public.order_details
  for each row
  execute function public.update_order_total();

create or replace function public.update_quote_totals()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  quote_uuid uuid;
  items_sum numeric;
  vat_rate numeric;
  vat_amt numeric;
  grand numeric;
begin
  if TG_OP = 'DELETE' then
    quote_uuid := OLD.quote_id;
  else
    quote_uuid := NEW.quote_id;
  end if;

  select coalesce(sum(coalesce(total, 0) + coalesce(surcharge_total, 0)), 0)
    into items_sum
  from public.quote_items
  where quote_id = quote_uuid
    and item_type = 'priced';

  select coalesce(quotes.vat_rate, 15)
    into vat_rate
  from public.quotes
  where id = quote_uuid;

  vat_amt := items_sum * (vat_rate / 100);
  grand := items_sum + vat_amt;

  update public.quotes
  set
    subtotal = items_sum,
    vat_amount = vat_amt,
    grand_total = grand,
    updated_at = now()
  where id = quote_uuid;

  return null;
end;
$$;

drop trigger if exists trg_update_quote_totals on public.quote_items;
drop trigger if exists trigger_update_quote_totals on public.quote_items;
drop trigger if exists quote_items_total_update_trigger on public.quote_items;
drop trigger if exists update_quote_totals_trigger on public.quote_items;
create trigger update_quote_totals_trigger
  after insert or update or delete
  on public.quote_items
  for each row
  execute function public.update_quote_totals();

update public.orders o
set
  total_amount = coalesce((
    select sum(od.quantity * od.unit_price + coalesce(od.surcharge_total, 0))
    from public.order_details od
    where od.order_id = o.order_id
  ), 0),
  updated_at = now();
