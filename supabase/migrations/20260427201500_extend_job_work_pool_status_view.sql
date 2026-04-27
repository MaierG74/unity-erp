-- POL-62 follow-up: extend job_work_pool_status view to expose POL-60 columns.
-- The view was created before piecework_foundation (20260427135000) added
-- piecework_activity_id, material_color_label, expected_count, cutting_plan_run_id
-- to job_work_pool. The cutting-plan finalize sync helper SELECTs these columns
-- via the view, which 500'd ('column ... does not exist') without this update.
--
-- Postgres CREATE OR REPLACE VIEW disallows column reordering, so the new
-- columns are appended after the existing ones.

begin;

create or replace view public.job_work_pool_status as
  select
    p.pool_id,
    p.org_id,
    p.order_id,
    p.order_detail_id,
    p.product_id,
    p.job_id,
    p.bol_id,
    p.source,
    p.required_qty,
    p.pay_type,
    p.piece_rate,
    p.hourly_rate_id,
    p.piece_rate_id,
    p.time_per_unit,
    p.status,
    p.created_at,
    p.updated_at,
    coalesce(agg.issued_qty, 0::bigint) as issued_qty,
    coalesce(agg.completed_qty, 0::bigint) as completed_qty,
    p.required_qty - coalesce(agg.issued_qty, 0::bigint) as remaining_qty,
    p.piecework_activity_id,
    p.material_color_label,
    p.expected_count,
    p.cutting_plan_run_id
  from public.job_work_pool p
  left join lateral (
    select
      sum(
        case
          when jci.remainder_action = any (array['return_to_pool'::text, 'follow_up_card'::text])
            then greatest(coalesce(jci.issued_quantity_snapshot, jci.quantity) - coalesce(jci.remainder_qty, 0), 0)
          else coalesce(jci.issued_quantity_snapshot, jci.quantity)
        end
      ) as issued_qty,
      sum(jci.completed_quantity) as completed_qty
    from public.job_card_items jci
    join public.job_cards jc on jc.job_card_id = jci.job_card_id
    where jci.work_pool_id = p.pool_id
      and jc.status <> 'cancelled'::text
      and jci.status <> 'cancelled'::text
  ) agg on true;

commit;
