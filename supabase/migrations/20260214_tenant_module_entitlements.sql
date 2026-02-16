-- Migration: Tenant module entitlements foundation
-- Date: 2026-02-14
-- Purpose:
--   1) Introduce platform-level module catalog and per-organization module access control.
--   2) Add audit logging for module entitlement changes.
--   3) Provide helper functions for app/API entitlement checks.
--
-- IMPORTANT:
--   - Review seed defaults before production apply.
--   - Platform admins are intentionally NOT auto-seeded from org owner roles.
--   - This migration intentionally seeds furniture_configurator as disabled for all orgs.

create extension if not exists "pgcrypto";

-- Shared updated_at trigger helper
create or replace function public.set_current_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Platform admins (Unity-level operators)
-- -----------------------------------------------------------------------------
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  platform_role text not null default 'platform_owner' check (platform_role in ('platform_owner', 'platform_ops', 'platform_support')),
  is_active boolean not null default true,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  notes text
);

create index if not exists idx_platform_admins_active on public.platform_admins (is_active);

-- -----------------------------------------------------------------------------
-- Module catalog
-- -----------------------------------------------------------------------------
create table if not exists public.module_catalog (
  module_key text primary key,
  module_name text not null,
  description text,
  dependency_keys text[] not null default '{}',
  is_core boolean not null default false,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_module_catalog_core on public.module_catalog (is_core);

-- -----------------------------------------------------------------------------
-- Per-org module entitlement state
-- -----------------------------------------------------------------------------
create table if not exists public.organization_module_entitlements (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  module_key text not null references public.module_catalog(module_key) on delete cascade,
  enabled boolean not null default false,
  billing_model text not null default 'manual' check (billing_model in ('manual', 'subscription', 'paid_in_full', 'trial', 'yearly_license')),
  status text not null default 'active' check (status in ('active', 'grace', 'past_due', 'canceled', 'inactive')),
  starts_at timestamptz,
  ends_at timestamptz,
  source text not null default 'admin',
  notes text,
  updated_by uuid references auth.users(id) on delete set null,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, module_key)
);

create index if not exists idx_org_module_entitlements_org on public.organization_module_entitlements (org_id);
create index if not exists idx_org_module_entitlements_module on public.organization_module_entitlements (module_key);
create index if not exists idx_org_module_entitlements_enabled on public.organization_module_entitlements (enabled);
create index if not exists idx_org_module_entitlements_status on public.organization_module_entitlements (status);

-- -----------------------------------------------------------------------------
-- Entitlement audit log
-- -----------------------------------------------------------------------------
create table if not exists public.module_entitlement_audit (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  module_key text not null references public.module_catalog(module_key) on delete cascade,
  enabled_before boolean,
  enabled_after boolean,
  billing_model_before text,
  billing_model_after text,
  status_before text,
  status_after text,
  starts_at_before timestamptz,
  starts_at_after timestamptz,
  ends_at_before timestamptz,
  ends_at_after timestamptz,
  changed_by uuid references auth.users(id) on delete set null,
  change_reason text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_module_entitlement_audit_org on public.module_entitlement_audit (org_id);
create index if not exists idx_module_entitlement_audit_module on public.module_entitlement_audit (module_key);
create index if not exists idx_module_entitlement_audit_created_at on public.module_entitlement_audit (created_at desc);

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------
drop trigger if exists platform_admins_set_updated_at on public.platform_admins;
create trigger platform_admins_set_updated_at
before update on public.platform_admins
for each row execute function public.set_current_timestamp();

drop trigger if exists module_catalog_set_updated_at on public.module_catalog;
create trigger module_catalog_set_updated_at
before update on public.module_catalog
for each row execute function public.set_current_timestamp();

drop trigger if exists organization_module_entitlements_set_updated_at on public.organization_module_entitlements;
create trigger organization_module_entitlements_set_updated_at
before update on public.organization_module_entitlements
for each row execute function public.set_current_timestamp();

-- -----------------------------------------------------------------------------
-- Helper functions
-- -----------------------------------------------------------------------------
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_admins p
    where p.user_id = auth.uid()
      and p.is_active = true
  );
$$;

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  with jwt_claim as (
    select
      case
        when (auth.jwt()->>'org_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (auth.jwt()->>'org_id')::uuid
        else null
      end as org_id
  ),
  membership as (
    select m.org_id
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.is_active = true
      and (m.banned_until is null or m.banned_until > timezone('utc', now()))
    order by m.inserted_at asc
    limit 1
  )
  select coalesce((select org_id from jwt_claim), (select org_id from membership));
$$;

create or replace function public.has_module_access(p_module_key text, p_org_id uuid default null)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  if public.is_platform_admin() then
    return true;
  end if;

  v_org_id := coalesce(p_org_id, public.current_org_id());

  if v_org_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.organization_module_entitlements e
    join public.organization_members m
      on m.org_id = e.org_id
     and m.user_id = auth.uid()
    where e.org_id = v_org_id
      and e.module_key = p_module_key
      and e.enabled = true
      and e.status in ('active', 'grace')
      and (e.starts_at is null or e.starts_at <= timezone('utc', now()))
      and (e.ends_at is null or e.ends_at > timezone('utc', now()))
      and m.is_active = true
      and (m.banned_until is null or m.banned_until > timezone('utc', now()))
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Entitlement audit trigger
-- -----------------------------------------------------------------------------
create or replace function public.log_org_module_entitlement_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  v_actor := auth.uid();

  if tg_op = 'INSERT' then
    insert into public.module_entitlement_audit (
      org_id,
      module_key,
      enabled_before,
      enabled_after,
      billing_model_before,
      billing_model_after,
      status_before,
      status_after,
      starts_at_before,
      starts_at_after,
      ends_at_before,
      ends_at_after,
      changed_by,
      change_reason,
      metadata
    )
    values (
      new.org_id,
      new.module_key,
      null,
      new.enabled,
      null,
      new.billing_model,
      null,
      new.status,
      null,
      new.starts_at,
      null,
      new.ends_at,
      v_actor,
      'insert',
      jsonb_build_object('source', new.source, 'notes', new.notes)
    );
    return new;
  elsif tg_op = 'UPDATE' then
    if row(
      new.enabled,
      new.billing_model,
      new.status,
      new.starts_at,
      new.ends_at,
      new.notes
    ) is not distinct from row(
      old.enabled,
      old.billing_model,
      old.status,
      old.starts_at,
      old.ends_at,
      old.notes
    ) then
      return new;
    end if;

    insert into public.module_entitlement_audit (
      org_id,
      module_key,
      enabled_before,
      enabled_after,
      billing_model_before,
      billing_model_after,
      status_before,
      status_after,
      starts_at_before,
      starts_at_after,
      ends_at_before,
      ends_at_after,
      changed_by,
      change_reason,
      metadata
    )
    values (
      new.org_id,
      new.module_key,
      old.enabled,
      new.enabled,
      old.billing_model,
      new.billing_model,
      old.status,
      new.status,
      old.starts_at,
      new.starts_at,
      old.ends_at,
      new.ends_at,
      coalesce(v_actor, new.updated_by),
      'update',
      jsonb_build_object('source', new.source, 'notes_before', old.notes, 'notes_after', new.notes)
    );
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.module_entitlement_audit (
      org_id,
      module_key,
      enabled_before,
      enabled_after,
      billing_model_before,
      billing_model_after,
      status_before,
      status_after,
      starts_at_before,
      starts_at_after,
      ends_at_before,
      ends_at_after,
      changed_by,
      change_reason,
      metadata
    )
    values (
      old.org_id,
      old.module_key,
      old.enabled,
      null,
      old.billing_model,
      null,
      old.status,
      null,
      old.starts_at,
      null,
      old.ends_at,
      null,
      v_actor,
      'delete',
      jsonb_build_object('source', old.source, 'notes', old.notes)
    );
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists organization_module_entitlements_audit on public.organization_module_entitlements;
create trigger organization_module_entitlements_audit
after insert or update or delete on public.organization_module_entitlements
for each row execute function public.log_org_module_entitlement_change();

-- -----------------------------------------------------------------------------
-- RLS policies
-- -----------------------------------------------------------------------------
alter table public.platform_admins enable row level security;
alter table public.module_catalog enable row level security;
alter table public.organization_module_entitlements enable row level security;
alter table public.module_entitlement_audit enable row level security;

drop policy if exists "platform_admins_read_platform" on public.platform_admins;
create policy "platform_admins_read_platform" on public.platform_admins
for select using (public.is_platform_admin());

drop policy if exists "platform_admins_write_platform" on public.platform_admins;
create policy "platform_admins_write_platform" on public.platform_admins
for all using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "module_catalog_read_authenticated" on public.module_catalog;
create policy "module_catalog_read_authenticated" on public.module_catalog
for select to authenticated using (true);

drop policy if exists "module_catalog_write_platform" on public.module_catalog;
create policy "module_catalog_write_platform" on public.module_catalog
for all using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "org_module_entitlements_read_member_or_platform" on public.organization_module_entitlements;
create policy "org_module_entitlements_read_member_or_platform" on public.organization_module_entitlements
for select using (
  public.is_platform_admin()
  or exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = organization_module_entitlements.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until > timezone('utc', now()))
  )
);

drop policy if exists "org_module_entitlements_write_platform" on public.organization_module_entitlements;
create policy "org_module_entitlements_write_platform" on public.organization_module_entitlements
for all using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "module_entitlement_audit_read_platform" on public.module_entitlement_audit;
create policy "module_entitlement_audit_read_platform" on public.module_entitlement_audit
for select using (public.is_platform_admin());

drop policy if exists "module_entitlement_audit_insert_platform" on public.module_entitlement_audit;
create policy "module_entitlement_audit_insert_platform" on public.module_entitlement_audit
for insert with check (public.is_platform_admin());

-- -----------------------------------------------------------------------------
-- Seed module catalog
-- -----------------------------------------------------------------------------
insert into public.module_catalog (module_key, module_name, description, dependency_keys, is_core)
values
  ('staff_time_analysis', 'Staff Time Analysis', 'Time tracking, attendance, and payroll support.', '{}', false),
  ('inventory_stock_control', 'Inventory & Stock Control', 'Inventory catalog, stock movement, and supplier component mapping.', '{}', false),
  ('quoting_proposals', 'Quoting & Proposals', 'Quote drafting, pricing, attachments, and email workflows.', '{}', false),
  ('purchasing_purchase_orders', 'Purchasing & Purchase Orders', 'Purchase ordering, approvals, receiving, and supplier communications.', '{suppliers_management}', false),
  ('suppliers_management', 'Supplier Management', 'Supplier profiles, pricing references, and purchasing support.', '{}', false),
  ('products_bom', 'Products & Bill of Materials', 'Product catalog, BOM, options, and product costing.', '{}', false),
  ('orders_fulfillment', 'Orders & Fulfillment', 'Sales orders, fulfillment, and production demand planning.', '{products_bom}', false),
  ('customers_management', 'Customers Management', 'Customer records, contact data, and account history.', '{}', false),
  ('cutlist_optimizer', 'Cutlist & Material Optimization', 'Sheet nesting and cutlist optimization workflows.', '{products_bom}', false),
  ('user_control_access', 'User Control & Access Management', 'Role/permission management and audit controls.', '{}', false),
  ('furniture_configurator', 'Furniture Configurator', 'Parametric furniture builder with generated cutlist output.', '{products_bom,cutlist_optimizer}', false)
on conflict (module_key) do update
set
  module_name = excluded.module_name,
  description = excluded.description,
  dependency_keys = excluded.dependency_keys,
  is_core = excluded.is_core,
  updated_at = timezone('utc', now());

-- Platform admins are assigned manually (case-by-case) after migration.

-- Seed per-org entitlements for existing organizations.
-- Default behavior:
--   - furniture_configurator = disabled
--   - all other modules = enabled
insert into public.organization_module_entitlements (
  org_id,
  module_key,
  enabled,
  billing_model,
  status,
  starts_at,
  ends_at,
  source,
  notes
)
select
  o.id,
  m.module_key,
  case when m.module_key = 'furniture_configurator' then false else true end as enabled,
  'manual' as billing_model,
  'active' as status,
  timezone('utc', now()) as starts_at,
  null::timestamptz as ends_at,
  'migration-seed' as source,
  'Initial seed row from tenant module entitlement migration' as notes
from public.organizations o
cross join public.module_catalog m
on conflict (org_id, module_key) do nothing;
