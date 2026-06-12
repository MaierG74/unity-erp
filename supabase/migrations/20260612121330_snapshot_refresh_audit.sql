alter table quote_items
  add column if not exists snapshot_refreshed_at timestamptz,
  add column if not exists snapshot_refreshed_by uuid;

alter table order_details
  add column if not exists snapshot_refreshed_at timestamptz,
  add column if not exists snapshot_refreshed_by uuid;
