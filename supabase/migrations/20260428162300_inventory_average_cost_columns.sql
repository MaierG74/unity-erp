-- POL-69 / Piece A: inventory weighted average cost foundation.
-- Add nullable cost-basis columns and extend dependent plain views so the
-- newly-added columns are visible through existing read surfaces.

alter table public.inventory_transactions
  add column if not exists unit_cost numeric(18,6) null;

alter table public.inventory
  add column if not exists average_cost numeric(18,6) null;

comment on column public.inventory_transactions.unit_cost is
  'Receipt-time unit cost for PURCHASE rows. Null for non-receipt movements in WAC Piece A.';

comment on column public.inventory.average_cost is
  'Component-level weighted average cost, updated by supplier receipts and admin recompute.';

create or replace view public.inventory_transactions_enriched
with (security_invoker = true) as
select
  it.transaction_id,
  it.component_id,
  it.quantity,
  it.transaction_date,
  it.order_id,
  it.purchase_order_id,
  it.user_id,
  it.reason,
  it.org_id,
  it.transaction_type_id,
  c.internal_code as component_code,
  c.description as component_description,
  c.category_id,
  cc.categoryname as category_name,
  tt.type_name as transaction_type_name,
  po.q_number as po_number,
  po.supplier_id,
  s.name as supplier_name,
  o.order_number,
  it.transfer_ref,
  c.is_active as component_is_active,
  it.unit_cost
from public.inventory_transactions it
left join public.components c on c.component_id = it.component_id
left join public.component_categories cc on cc.cat_id = c.category_id
left join public.transaction_types tt on tt.transaction_type_id = it.transaction_type_id
left join public.purchase_orders po on po.purchase_order_id = it.purchase_order_id
left join public.suppliers s on s.supplier_id = po.supplier_id
left join public.orders o on o.order_id = it.order_id;

grant select on public.inventory_transactions_enriched to authenticated;

create or replace view public.v_inventory_with_components as
select
  i.inventory_id,
  i.component_id,
  c.internal_code,
  c.description,
  i.location,
  i.quantity_on_hand,
  i.reorder_level,
  i.average_cost
from public.inventory i
join public.components c on c.component_id = i.component_id;

create or replace view public.v_inventory_shortages as
select
  c.component_id,
  c.internal_code,
  c.description,
  i.location,
  i.quantity_on_hand,
  i.reorder_level,
  greatest(i.reorder_level - i.quantity_on_hand, 0::numeric) as shortage_qty,
  i.average_cost
from public.inventory i
join public.components c on c.component_id = i.component_id
where i.reorder_level is not null
  and i.quantity_on_hand < i.reorder_level;
