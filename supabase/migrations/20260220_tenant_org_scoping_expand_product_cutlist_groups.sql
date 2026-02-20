/*
  Tenant org scoping (expand-only) for product_cutlist_groups.

  - Adds nullable org_id column
  - Sets temporary default org_id (QButton, or the sole org if only one exists)
  - Backfills existing rows from products.org_id (fallback to default org)
  - Adds NOT VALID foreign key to organizations(id)
  - Adds org_id index

  Safety:
  - No RLS policy changes in this migration
  - No NOT NULL enforcement in this migration
*/

alter table public.product_cutlist_groups
  add column if not exists org_id uuid;

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

  execute format(
    'alter table public.product_cutlist_groups alter column org_id set default %L::uuid',
    v_default_org_id
  );

  -- Primary backfill path: inherit org_id from owning product
  update public.product_cutlist_groups cg
  set org_id = p.org_id
  from public.products p
  where cg.product_id = p.product_id
    and cg.org_id is null
    and p.org_id is not null;

  -- Single-tenant fallback for any orphan/missing-product rows
  update public.product_cutlist_groups
  set org_id = v_default_org_id
  where org_id is null;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'product_cutlist_groups_org_id_fkey'
  ) then
    execute '
      alter table public.product_cutlist_groups
      add constraint product_cutlist_groups_org_id_fkey
      foreign key (org_id) references public.organizations(id)
      on delete cascade
      not valid
    ';
  end if;
end $$;

create index if not exists product_cutlist_groups_org_id_idx
  on public.product_cutlist_groups (org_id);

