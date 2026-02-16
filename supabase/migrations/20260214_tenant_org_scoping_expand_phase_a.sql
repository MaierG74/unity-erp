-- Tenant data isolation (Phase A, expand-only)
-- Purpose:
-- 1) Add org_id columns to core live-domain tables (orders/products/stock + related masters)
-- 2) Set safe temporary defaults for legacy write paths
-- 3) Add NOT VALID foreign keys to organizations
-- 4) Add org_id indexes
--
-- Notes:
-- - This migration is additive/backward-compatible.
-- - It does NOT enforce NOT NULL or enable RLS on these domain tables yet.
-- - It prefers org named 'Qbutton' for default stamping; if missing, it falls back only when exactly one org exists.

-- 1) Add org_id columns (nullable)
alter table public.customers add column if not exists org_id uuid;
alter table public.products add column if not exists org_id uuid;
alter table public.components add column if not exists org_id uuid;
alter table public.orders add column if not exists org_id uuid;
alter table public.order_details add column if not exists org_id uuid;
alter table public.inventory add column if not exists org_id uuid;
alter table public.inventory_transactions add column if not exists org_id uuid;

do $$
begin
  if to_regclass('public.product_inventory') is not null then
    execute 'alter table public.product_inventory add column if not exists org_id uuid';
  end if;

  if to_regclass('public.product_inventory_transactions') is not null then
    execute 'alter table public.product_inventory_transactions add column if not exists org_id uuid';
  end if;

  if to_regclass('public.product_reservations') is not null then
    execute 'alter table public.product_reservations add column if not exists org_id uuid';
  end if;
end $$;

-- 2) Set temporary defaults so legacy inserts remain tenant-stamped during cutover.
do $$
declare
  v_default_org_id uuid;
  v_org_count integer;
begin
  select o.id
    into v_default_org_id
  from public.organizations o
  where lower(o.name) = lower('Qbutton')
  order by o.created_at asc
  limit 1;

  if v_default_org_id is null then
    select count(*) into v_org_count from public.organizations;

    if v_org_count = 1 then
      select id into v_default_org_id from public.organizations limit 1;
    else
      raise exception
        'Unable to resolve default org_id. Expected org named "Qbutton" or exactly one org row. Found % org rows.',
        v_org_count;
    end if;
  end if;

  execute format('alter table public.customers alter column org_id set default %L::uuid', v_default_org_id);
  execute format('alter table public.products alter column org_id set default %L::uuid', v_default_org_id);
  execute format('alter table public.components alter column org_id set default %L::uuid', v_default_org_id);
  execute format('alter table public.orders alter column org_id set default %L::uuid', v_default_org_id);
  execute format('alter table public.order_details alter column org_id set default %L::uuid', v_default_org_id);
  execute format('alter table public.inventory alter column org_id set default %L::uuid', v_default_org_id);
  execute format('alter table public.inventory_transactions alter column org_id set default %L::uuid', v_default_org_id);

  if to_regclass('public.product_inventory') is not null then
    execute format('alter table public.product_inventory alter column org_id set default %L::uuid', v_default_org_id);
  end if;

  if to_regclass('public.product_inventory_transactions') is not null then
    execute format(
      'alter table public.product_inventory_transactions alter column org_id set default %L::uuid',
      v_default_org_id
    );
  end if;

  if to_regclass('public.product_reservations') is not null then
    execute format('alter table public.product_reservations alter column org_id set default %L::uuid', v_default_org_id);
  end if;
end $$;

-- 3) Add NOT VALID FKs to organizations (idempotent)
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'customers_org_id_fkey'
      and conrelid = 'public.customers'::regclass
  ) then
    alter table public.customers
      add constraint customers_org_id_fkey
      foreign key (org_id) references public.organizations(id) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_org_id_fkey'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_org_id_fkey
      foreign key (org_id) references public.organizations(id) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'components_org_id_fkey'
      and conrelid = 'public.components'::regclass
  ) then
    alter table public.components
      add constraint components_org_id_fkey
      foreign key (org_id) references public.organizations(id) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_org_id_fkey'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_org_id_fkey
      foreign key (org_id) references public.organizations(id) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'order_details_org_id_fkey'
      and conrelid = 'public.order_details'::regclass
  ) then
    alter table public.order_details
      add constraint order_details_org_id_fkey
      foreign key (org_id) references public.organizations(id) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'inventory_org_id_fkey'
      and conrelid = 'public.inventory'::regclass
  ) then
    alter table public.inventory
      add constraint inventory_org_id_fkey
      foreign key (org_id) references public.organizations(id) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'inventory_transactions_org_id_fkey'
      and conrelid = 'public.inventory_transactions'::regclass
  ) then
    alter table public.inventory_transactions
      add constraint inventory_transactions_org_id_fkey
      foreign key (org_id) references public.organizations(id) not valid;
  end if;

  if to_regclass('public.product_inventory') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'product_inventory_org_id_fkey'
        and conrelid = 'public.product_inventory'::regclass
    ) then
    execute '
      alter table public.product_inventory
      add constraint product_inventory_org_id_fkey
      foreign key (org_id) references public.organizations(id) not valid
    ';
  end if;

  if to_regclass('public.product_inventory_transactions') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'product_inventory_transactions_org_id_fkey'
        and conrelid = 'public.product_inventory_transactions'::regclass
    ) then
    execute '
      alter table public.product_inventory_transactions
      add constraint product_inventory_transactions_org_id_fkey
      foreign key (org_id) references public.organizations(id) not valid
    ';
  end if;

  if to_regclass('public.product_reservations') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'product_reservations_org_id_fkey'
        and conrelid = 'public.product_reservations'::regclass
    ) then
    execute '
      alter table public.product_reservations
      add constraint product_reservations_org_id_fkey
      foreign key (org_id) references public.organizations(id) not valid
    ';
  end if;
end $$;

-- 4) Add indexes on org_id (idempotent)
create index if not exists idx_customers_org_id on public.customers(org_id);
create index if not exists idx_products_org_id on public.products(org_id);
create index if not exists idx_components_org_id on public.components(org_id);
create index if not exists idx_orders_org_id on public.orders(org_id);
create index if not exists idx_order_details_org_id on public.order_details(org_id);
create index if not exists idx_inventory_org_id on public.inventory(org_id);
create index if not exists idx_inventory_transactions_org_id on public.inventory_transactions(org_id);

do $$
begin
  if to_regclass('public.product_inventory') is not null then
    execute 'create index if not exists idx_product_inventory_org_id on public.product_inventory(org_id)';
  end if;

  if to_regclass('public.product_inventory_transactions') is not null then
    execute '
      create index if not exists idx_product_inventory_transactions_org_id
      on public.product_inventory_transactions(org_id)
    ';
  end if;

  if to_regclass('public.product_reservations') is not null then
    execute 'create index if not exists idx_product_reservations_org_id on public.product_reservations(org_id)';
  end if;
end $$;
