-- POL-69 / Piece A: service-role-only recompute of inventory average cost.
-- The function definition and EXECUTE restriction are intentionally atomic.

create or replace function public.recompute_inventory_average_cost_from_history(
  p_org_id uuid,
  p_component_id int default null
)
returns int
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_component_id integer;
  v_tx record;
  v_running_qty numeric;
  v_running_avg numeric;
  v_old_qty numeric;
  v_receipt_cost numeric;
  v_updated_count integer := 0;
begin
  if p_org_id is null then
    raise exception 'recompute_inventory_average_cost_from_history: org id is required';
  end if;

  if auth.role() <> 'service_role' and not is_org_member(p_org_id) then
    raise exception 'recompute_inventory_average_cost_from_history: access denied';
  end if;

  for v_component_id in
    select distinct it.component_id
    from public.inventory_transactions it
    where it.org_id = p_org_id
      and it.component_id is not null
      and (p_component_id is null or it.component_id = p_component_id)
    order by it.component_id
  loop
    v_running_qty := 0;
    v_running_avg := null;

    for v_tx in
      select
        it.transaction_id,
        it.supplier_order_id,
        coalesce(it.quantity, 0) as quantity,
        it.unit_cost,
        tt.type_name as transaction_type_name
      from public.inventory_transactions it
      left join public.transaction_types tt
        on tt.transaction_type_id = it.transaction_type_id
      where it.org_id = p_org_id
        and it.component_id = v_component_id
      order by it.transaction_date asc, it.transaction_id asc
    loop
      v_old_qty := v_running_qty;

      if v_tx.transaction_type_name = 'PURCHASE' and v_tx.quantity > 0 then
        v_receipt_cost := v_tx.unit_cost;

        if v_receipt_cost is null or v_receipt_cost <= 0 then
          select sc.price
          into v_receipt_cost
          from public.supplier_order_receipts sor
          join public.supplier_orders so
            on so.order_id = sor.order_id
          join public.suppliercomponents sc
            on sc.supplier_component_id = so.supplier_component_id
          where sor.transaction_id = v_tx.transaction_id
            and so.org_id = p_org_id
            and sc.org_id = p_org_id
          limit 1;
        end if;

        if (v_receipt_cost is null or v_receipt_cost <= 0) and v_tx.supplier_order_id is not null then
          select sc.price
          into v_receipt_cost
          from public.supplier_orders so
          join public.suppliercomponents sc
            on sc.supplier_component_id = so.supplier_component_id
          where so.order_id = v_tx.supplier_order_id
            and so.org_id = p_org_id
            and sc.org_id = p_org_id
          limit 1;
        end if;

        if v_receipt_cost is not null and v_receipt_cost > 0 then
          v_old_qty := greatest(v_old_qty, 0);

          if v_old_qty <= 0 or v_running_avg is null then
            v_running_avg := v_receipt_cost;
          else
            v_running_avg := (
              v_old_qty * v_running_avg
              + v_tx.quantity * v_receipt_cost
            ) / (v_old_qty + v_tx.quantity);
          end if;
        end if;
      end if;

      v_running_qty := v_running_qty + v_tx.quantity;
    end loop;

    if v_running_avg is not null then
      update public.inventory i
      set average_cost = v_running_avg
      where i.org_id = p_org_id
        and i.component_id = v_component_id;

      if found then
        v_updated_count := v_updated_count + 1;
      end if;
    end if;
  end loop;

  return v_updated_count;
end;
$function$;

revoke execute on function public.recompute_inventory_average_cost_from_history(uuid, int)
  from public, anon, authenticated;

grant execute on function public.recompute_inventory_average_cost_from_history(uuid, int)
  to service_role;
