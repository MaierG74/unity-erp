begin;

create unique index if not exists idx_job_work_pool_cutting_plan_piecework_unique
  on public.job_work_pool(order_id, cutting_plan_run_id, piecework_activity_id, material_color_label)
  where source = 'cutting_plan'
    and status = 'active'
    and cutting_plan_run_id is not null
    and piecework_activity_id is not null
    and material_color_label is not null;

alter table public.job_work_pool_exceptions
  drop constraint if exists job_work_pool_exceptions_exception_type_check;

alter table public.job_work_pool_exceptions
  add constraint job_work_pool_exceptions_exception_type_check
  check (
    exception_type in (
      'over_issued_override',
      'over_issued_after_reconcile',
      'cutting_plan_issued_count_changed'
    )
  );

alter table public.job_work_pool_exceptions
  drop constraint if exists job_work_pool_exceptions_trigger_source_check;

alter table public.job_work_pool_exceptions
  add constraint job_work_pool_exceptions_trigger_source_check
  check (
    trigger_source in (
      'issuance_override',
      'order_quantity_change',
      'pool_reconcile',
      'system',
      'cutting_plan_finalize'
    )
  );

commit;
