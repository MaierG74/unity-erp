begin;

do $$
declare
  product_tables text[] := array[
    'products',
    'product_prices',
    'billofmaterials',
    'billoflabour',
    'product_overhead_costs',
    'product_cutlist_groups',
    'product_cutlist_costing_snapshots'
  ];
  product_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach product_table in array product_tables loop
      execute format('alter table public.%I replica identity full', product_table);

      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = product_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I', product_table);
      end if;
    end loop;
  end if;
end $$;

commit;
