/*
  Tenant org scoping (expand-only) for purchasing, suppliers, quotes, and staff.

  - Adds nullable org_id columns
  - Sets a temporary default org_id (QButton, or the sole org if only one exists)
  - Backfills existing rows to that org_id
  - Adds NOT VALID foreign keys to organizations(id)
  - Adds org_id indexes

  Safety:
  - No RLS policy changes in this migration
  - No NOT NULL enforcement in this migration
*/

-- 1) Add org_id columns (nullable)
alter table public.purchase_orders add column if not exists org_id uuid;
alter table public.purchase_order_emails add column if not exists org_id uuid;
alter table public.purchase_order_attachments add column if not exists org_id uuid;

alter table public.suppliers add column if not exists org_id uuid;
alter table public.supplier_emails add column if not exists org_id uuid;
alter table public.supplier_pricelists add column if not exists org_id uuid;
alter table public.suppliercomponents add column if not exists org_id uuid;
alter table public.supplier_orders add column if not exists org_id uuid;
alter table public.supplier_order_receipts add column if not exists org_id uuid;
alter table public.supplier_order_returns add column if not exists org_id uuid;
alter table public.supplier_order_customer_orders add column if not exists org_id uuid;
alter table public.supplier_follow_up_responses add column if not exists org_id uuid;

alter table public.quotes add column if not exists org_id uuid;
alter table public.quote_items add column if not exists org_id uuid;
alter table public.quote_attachments add column if not exists org_id uuid;
alter table public.quote_email_log add column if not exists org_id uuid;
alter table public.quote_cluster_lines add column if not exists org_id uuid;
alter table public.quote_item_clusters add column if not exists org_id uuid;
alter table public.quote_item_cutlists add column if not exists org_id uuid;
alter table public.quote_company_settings add column if not exists org_id uuid;

alter table public.staff add column if not exists org_id uuid;
alter table public.staff_hours add column if not exists org_id uuid;
alter table public.staff_weekly_hours add column if not exists org_id uuid;
alter table public.staff_weekly_payroll add column if not exists org_id uuid;

-- 2) Compute a safe default org id and apply defaults + backfill
do $$
declare
  v_default_org_id uuid;
begin
  -- Prefer the existing single-tenant org name "QButton"
  select id
    into v_default_org_id
  from public.organizations
  where lower(name) = lower('QButton')
  limit 1;

  -- Fallback only when exactly one org exists
  if v_default_org_id is null then
    select case when count(*) = 1 then max(id) else null end
      into v_default_org_id
    from public.organizations;
  end if;

  if v_default_org_id is null then
    raise exception 'Cannot determine default org_id (expected QButton, or a single existing organization).';
  end if;

  -- Defaults (metadata-only)
  execute format('alter table public.purchase_orders alter column org_id set default %L::uuid', v_default_org_id);
  execute format('alter table public.purchase_order_emails alter column org_id set default %L::uuid', v_default_org_id);
  execute format('alter table public.purchase_order_attachments alter column org_id set default %L::uuid', v_default_org_id);

  execute format('alter table public.suppliers alter column org_id set default %L::uuid', v_default_org_id);
  execute format('alter table public.supplier_emails alter column org_id set default %L::uuid', v_default_org_id);
  execute format('alter table public.supplier_pricelists alter column org_id set default %L::uuid', v_default_org_id);
  execute format('alter table public.suppliercomponents alter column org_id set default %L::uuid', v_default_org_id);
  execute format('alter table public.supplier_orders alter column org_id set default %L::uuid', v_default_org_id);
  execute format('alter table public.supplier_order_receipts alter column org_id set default %L::uuid', v_default_org_id);
  execute format('alter table public.supplier_order_returns alter column org_id set default %L::uuid', v_default_org_id);
  execute format('alter table public.supplier_order_customer_orders alter column org_id set default %L::uuid', v_default_org_id);
  execute format('alter table public.supplier_follow_up_responses alter column org_id set default %L::uuid', v_default_org_id);

  execute format('alter table public.quotes alter column org_id set default %L::uuid', v_default_org_id);
  execute format('alter table public.quote_items alter column org_id set default %L::uuid', v_default_org_id);
  execute format('alter table public.quote_attachments alter column org_id set default %L::uuid', v_default_org_id);
  execute format('alter table public.quote_email_log alter column org_id set default %L::uuid', v_default_org_id);
  execute format('alter table public.quote_cluster_lines alter column org_id set default %L::uuid', v_default_org_id);
  execute format('alter table public.quote_item_clusters alter column org_id set default %L::uuid', v_default_org_id);
  execute format('alter table public.quote_item_cutlists alter column org_id set default %L::uuid', v_default_org_id);
  execute format('alter table public.quote_company_settings alter column org_id set default %L::uuid', v_default_org_id);

  execute format('alter table public.staff alter column org_id set default %L::uuid', v_default_org_id);
  execute format('alter table public.staff_hours alter column org_id set default %L::uuid', v_default_org_id);
  execute format('alter table public.staff_weekly_hours alter column org_id set default %L::uuid', v_default_org_id);
  execute format('alter table public.staff_weekly_payroll alter column org_id set default %L::uuid', v_default_org_id);

  -- Backfill existing rows (single-tenant safe)
  update public.purchase_orders set org_id = v_default_org_id where org_id is null;
  update public.purchase_order_emails set org_id = v_default_org_id where org_id is null;
  update public.purchase_order_attachments set org_id = v_default_org_id where org_id is null;

  update public.suppliers set org_id = v_default_org_id where org_id is null;
  update public.supplier_emails set org_id = v_default_org_id where org_id is null;
  update public.supplier_pricelists set org_id = v_default_org_id where org_id is null;
  update public.suppliercomponents set org_id = v_default_org_id where org_id is null;
  update public.supplier_orders set org_id = v_default_org_id where org_id is null;
  update public.supplier_order_receipts set org_id = v_default_org_id where org_id is null;
  update public.supplier_order_returns set org_id = v_default_org_id where org_id is null;
  update public.supplier_order_customer_orders set org_id = v_default_org_id where org_id is null;
  update public.supplier_follow_up_responses set org_id = v_default_org_id where org_id is null;

  update public.quotes set org_id = v_default_org_id where org_id is null;
  update public.quote_items set org_id = v_default_org_id where org_id is null;
  update public.quote_attachments set org_id = v_default_org_id where org_id is null;
  update public.quote_email_log set org_id = v_default_org_id where org_id is null;
  update public.quote_cluster_lines set org_id = v_default_org_id where org_id is null;
  update public.quote_item_clusters set org_id = v_default_org_id where org_id is null;
  update public.quote_item_cutlists set org_id = v_default_org_id where org_id is null;
  update public.quote_company_settings set org_id = v_default_org_id where org_id is null;

  update public.staff set org_id = v_default_org_id where org_id is null;
  update public.staff_hours set org_id = v_default_org_id where org_id is null;
  update public.staff_weekly_hours set org_id = v_default_org_id where org_id is null;
  update public.staff_weekly_payroll set org_id = v_default_org_id where org_id is null;

  -- NOT VALID FKs (enforce later after validation)
  if not exists (select 1 from pg_constraint where conname = 'purchase_orders_org_id_fkey') then
    execute 'alter table public.purchase_orders add constraint purchase_orders_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade not valid';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'purchase_order_emails_org_id_fkey') then
    execute 'alter table public.purchase_order_emails add constraint purchase_order_emails_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade not valid';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'purchase_order_attachments_org_id_fkey') then
    execute 'alter table public.purchase_order_attachments add constraint purchase_order_attachments_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade not valid';
  end if;

  if not exists (select 1 from pg_constraint where conname = 'suppliers_org_id_fkey') then
    execute 'alter table public.suppliers add constraint suppliers_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade not valid';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'supplier_emails_org_id_fkey') then
    execute 'alter table public.supplier_emails add constraint supplier_emails_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade not valid';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'supplier_pricelists_org_id_fkey') then
    execute 'alter table public.supplier_pricelists add constraint supplier_pricelists_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade not valid';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'suppliercomponents_org_id_fkey') then
    execute 'alter table public.suppliercomponents add constraint suppliercomponents_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade not valid';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'supplier_orders_org_id_fkey') then
    execute 'alter table public.supplier_orders add constraint supplier_orders_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade not valid';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'supplier_order_receipts_org_id_fkey') then
    execute 'alter table public.supplier_order_receipts add constraint supplier_order_receipts_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade not valid';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'supplier_order_returns_org_id_fkey') then
    execute 'alter table public.supplier_order_returns add constraint supplier_order_returns_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade not valid';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'supplier_order_customer_orders_org_id_fkey') then
    execute 'alter table public.supplier_order_customer_orders add constraint supplier_order_customer_orders_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade not valid';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'supplier_follow_up_responses_org_id_fkey') then
    execute 'alter table public.supplier_follow_up_responses add constraint supplier_follow_up_responses_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade not valid';
  end if;

  if not exists (select 1 from pg_constraint where conname = 'quotes_org_id_fkey') then
    execute 'alter table public.quotes add constraint quotes_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade not valid';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quote_items_org_id_fkey') then
    execute 'alter table public.quote_items add constraint quote_items_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade not valid';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quote_attachments_org_id_fkey') then
    execute 'alter table public.quote_attachments add constraint quote_attachments_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade not valid';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quote_email_log_org_id_fkey') then
    execute 'alter table public.quote_email_log add constraint quote_email_log_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade not valid';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quote_cluster_lines_org_id_fkey') then
    execute 'alter table public.quote_cluster_lines add constraint quote_cluster_lines_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade not valid';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quote_item_clusters_org_id_fkey') then
    execute 'alter table public.quote_item_clusters add constraint quote_item_clusters_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade not valid';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quote_item_cutlists_org_id_fkey') then
    execute 'alter table public.quote_item_cutlists add constraint quote_item_cutlists_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade not valid';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quote_company_settings_org_id_fkey') then
    execute 'alter table public.quote_company_settings add constraint quote_company_settings_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade not valid';
  end if;

  if not exists (select 1 from pg_constraint where conname = 'staff_org_id_fkey') then
    execute 'alter table public.staff add constraint staff_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade not valid';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'staff_hours_org_id_fkey') then
    execute 'alter table public.staff_hours add constraint staff_hours_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade not valid';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'staff_weekly_hours_org_id_fkey') then
    execute 'alter table public.staff_weekly_hours add constraint staff_weekly_hours_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade not valid';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'staff_weekly_payroll_org_id_fkey') then
    execute 'alter table public.staff_weekly_payroll add constraint staff_weekly_payroll_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade not valid';
  end if;
end $$;

-- 3) Indexes (small tables, non-concurrent is fine)
create index if not exists purchase_orders_org_id_idx on public.purchase_orders (org_id);
create index if not exists purchase_order_emails_org_id_idx on public.purchase_order_emails (org_id);
create index if not exists purchase_order_attachments_org_id_idx on public.purchase_order_attachments (org_id);

create index if not exists suppliers_org_id_idx on public.suppliers (org_id);
create index if not exists supplier_emails_org_id_idx on public.supplier_emails (org_id);
create index if not exists supplier_pricelists_org_id_idx on public.supplier_pricelists (org_id);
create index if not exists suppliercomponents_org_id_idx on public.suppliercomponents (org_id);
create index if not exists supplier_orders_org_id_idx on public.supplier_orders (org_id);
create index if not exists supplier_order_receipts_org_id_idx on public.supplier_order_receipts (org_id);
create index if not exists supplier_order_returns_org_id_idx on public.supplier_order_returns (org_id);
create index if not exists supplier_order_customer_orders_org_id_idx on public.supplier_order_customer_orders (org_id);
create index if not exists supplier_follow_up_responses_org_id_idx on public.supplier_follow_up_responses (org_id);

create index if not exists quotes_org_id_idx on public.quotes (org_id);
create index if not exists quote_items_org_id_idx on public.quote_items (org_id);
create index if not exists quote_attachments_org_id_idx on public.quote_attachments (org_id);
create index if not exists quote_email_log_org_id_idx on public.quote_email_log (org_id);
create index if not exists quote_cluster_lines_org_id_idx on public.quote_cluster_lines (org_id);
create index if not exists quote_item_clusters_org_id_idx on public.quote_item_clusters (org_id);
create index if not exists quote_item_cutlists_org_id_idx on public.quote_item_cutlists (org_id);
create index if not exists quote_company_settings_org_id_idx on public.quote_company_settings (org_id);

create index if not exists staff_org_id_idx on public.staff (org_id);
create index if not exists staff_hours_org_id_idx on public.staff_hours (org_id);
create index if not exists staff_weekly_hours_org_id_idx on public.staff_weekly_hours (org_id);
create index if not exists staff_weekly_payroll_org_id_idx on public.staff_weekly_payroll (org_id);

