-- Stage 4 enforcement for tenant org scoping.
-- 1) Validate org_id foreign keys created as NOT VALID in expand phase.
-- 2) Add and validate org_id IS NOT NULL check constraints.
-- 3) Enforce org_id column NOT NULL on scoped tables.

do $$
declare
  tbl text;
  constraint_name text;
begin
  -- Validate existing org_id foreign keys.
  for tbl, constraint_name in
    values
      ('customers', 'customers_org_id_fkey'),
      ('products', 'products_org_id_fkey'),
      ('components', 'components_org_id_fkey'),
      ('orders', 'orders_org_id_fkey'),
      ('order_details', 'order_details_org_id_fkey'),
      ('inventory', 'inventory_org_id_fkey'),
      ('inventory_transactions', 'inventory_transactions_org_id_fkey'),
      ('product_inventory', 'product_inventory_org_id_fkey'),
      ('product_inventory_transactions', 'product_inventory_transactions_org_id_fkey'),
      ('product_reservations', 'product_reservations_org_id_fkey')
  loop
    if to_regclass(format('public.%I', tbl)) is not null
       and exists (
         select 1
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
         where n.nspname = 'public'
           and t.relname = tbl
           and c.conname = constraint_name
       ) then
      execute format('alter table public.%I validate constraint %I', tbl, constraint_name);
    end if;
  end loop;

  -- Add NOT VALID org_id-not-null check constraints where missing.
  for tbl, constraint_name in
    values
      ('customers', 'customers_org_id_not_null'),
      ('products', 'products_org_id_not_null'),
      ('components', 'components_org_id_not_null'),
      ('orders', 'orders_org_id_not_null'),
      ('order_details', 'order_details_org_id_not_null'),
      ('inventory', 'inventory_org_id_not_null'),
      ('inventory_transactions', 'inventory_transactions_org_id_not_null'),
      ('product_inventory', 'product_inventory_org_id_not_null'),
      ('product_inventory_transactions', 'product_inventory_transactions_org_id_not_null'),
      ('product_reservations', 'product_reservations_org_id_not_null')
  loop
    if to_regclass(format('public.%I', tbl)) is not null
       and not exists (
         select 1
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
         where n.nspname = 'public'
           and t.relname = tbl
           and c.conname = constraint_name
       ) then
      execute format(
        'alter table public.%I add constraint %I check (org_id is not null) not valid',
        tbl,
        constraint_name
      );
    end if;
  end loop;

  -- Validate org_id-not-null check constraints.
  for tbl, constraint_name in
    values
      ('customers', 'customers_org_id_not_null'),
      ('products', 'products_org_id_not_null'),
      ('components', 'components_org_id_not_null'),
      ('orders', 'orders_org_id_not_null'),
      ('order_details', 'order_details_org_id_not_null'),
      ('inventory', 'inventory_org_id_not_null'),
      ('inventory_transactions', 'inventory_transactions_org_id_not_null'),
      ('product_inventory', 'product_inventory_org_id_not_null'),
      ('product_inventory_transactions', 'product_inventory_transactions_org_id_not_null'),
      ('product_reservations', 'product_reservations_org_id_not_null')
  loop
    if to_regclass(format('public.%I', tbl)) is not null
       and exists (
         select 1
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
         where n.nspname = 'public'
           and t.relname = tbl
           and c.conname = constraint_name
       ) then
      execute format('alter table public.%I validate constraint %I', tbl, constraint_name);
    end if;
  end loop;

  -- Finally enforce org_id NOT NULL.
  for tbl in
    values
      ('customers'),
      ('products'),
      ('components'),
      ('orders'),
      ('order_details'),
      ('inventory'),
      ('inventory_transactions'),
      ('product_inventory'),
      ('product_inventory_transactions'),
      ('product_reservations')
  loop
    if to_regclass(format('public.%I', tbl)) is not null then
      execute format('alter table public.%I alter column org_id set not null', tbl);
    end if;
  end loop;
end $$;
