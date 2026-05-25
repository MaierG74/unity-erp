-- Add quote-owned internal costing surcharge metadata per quote cluster line.
-- These fields are intentionally separate from quote_items.cutlist_surcharge_*, which are
-- customer-facing and roll into quote totals/PDF child rows. The columns below only explain
-- quote_cluster_lines.unit_cost changes for estimator-side costing/margin review.

alter table public.quote_cluster_lines
  add column if not exists cost_surcharge_kind text null,
  add column if not exists cost_surcharge_value numeric(12, 2) null,
  add column if not exists cost_surcharge_label text null,
  add column if not exists cost_surcharge_resolved numeric(12, 2) null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quote_cluster_lines_cost_surcharge_kind_chk'
  ) then
    alter table public.quote_cluster_lines
      add constraint quote_cluster_lines_cost_surcharge_kind_chk
      check (cost_surcharge_kind is null or cost_surcharge_kind in ('fixed', 'percentage'));
  end if;
end $$;

comment on column public.quote_cluster_lines.cost_surcharge_kind is
  'Internal quote costing surcharge kind for this cost line only; does not affect quote_items customer-facing surcharges.';
comment on column public.quote_cluster_lines.cost_surcharge_value is
  'Estimator-entered internal quote costing surcharge value. Fixed is Rand per costing unit; percentage is percent of source unit cost.';
comment on column public.quote_cluster_lines.cost_surcharge_label is
  'Estimator-facing label explaining the internal quote costing surcharge/discount.';
comment on column public.quote_cluster_lines.cost_surcharge_resolved is
  'Resolved per-unit internal quote costing delta added to the source unit cost. This is not included directly in quote totals/PDF rows.';
