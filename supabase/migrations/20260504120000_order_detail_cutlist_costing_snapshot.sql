alter table public.order_details
  add column if not exists cutlist_costing_snapshot jsonb;

comment on column public.order_details.cutlist_costing_snapshot is
  'Frozen product_cutlist_costing_snapshots.snapshot_data copied when the product becomes an order line. Product Save to Costing updates templates for future order lines only; existing order lines use this order-owned costing basis unless explicitly refreshed.';
