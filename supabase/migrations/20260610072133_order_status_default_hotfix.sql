-- Hotfix: statusless customer orders disappear from component availability RPCs.
--
-- Recent customer orders were being inserted with orders.status_id = NULL, which
-- shows as "Unknown" in the UI and causes component stock status joins to drop
-- the order. Ensure future orders receive the active "New" status even when a
-- client explicitly sends NULL, and repair the two same-day orders reported by
-- the client while leaving older legacy NULL-status rows for a separate review.

do $$
declare
  v_new_status_id integer;
begin
  insert into public.order_statuses (status_name)
  values ('New')
  on conflict (status_name) do nothing;

  select os.status_id
  into v_new_status_id
  from public.order_statuses os
  where os.status_name = 'New'
  order by os.status_id
  limit 1;

  if v_new_status_id is null then
    raise exception 'Unable to resolve customer order status "New"';
  end if;

  execute format('alter table public.orders alter column status_id set default %s', v_new_status_id);

  update public.orders
  set status_id = v_new_status_id
  where status_id is null
    and order_id in (792, 793);
end $$;

create or replace function public.set_default_order_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status_id is null then
    select os.status_id
    into new.status_id
    from public.order_statuses os
    where os.status_name = 'New'
    order by os.status_id
    limit 1;

    if new.status_id is null then
      raise exception 'Unable to resolve customer order status "New"';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_orders_set_default_status on public.orders;

create trigger trg_orders_set_default_status
before insert on public.orders
for each row
execute function public.set_default_order_status();

comment on function public.set_default_order_status() is
  'Ensures newly inserted customer orders have the active New status when clients omit status_id or send NULL.';
