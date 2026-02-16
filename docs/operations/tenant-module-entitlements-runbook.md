# Tenant Module Entitlements Runbook

## Purpose
Execution checklist for rolling out tenant-level module entitlements, starting with the Furniture Configurator module toggle.

## Scope for this runbook
1. Apply schema foundation migration.
2. Verify data shape and seed state.
3. Validate module toggling behavior in staging.
4. Provide rollback playbook.

## Related artifacts
1. Plan: `docs/plans/tenant-module-entitlements-rollout-plan.md`
2. Migration: `supabase/migrations/20260214_tenant_module_entitlements.sql`

## Preflight checklist
1. Confirm target environment (`staging` first, then `production`).
2. Confirm at least one user is approved to become Unity super admin (`platform_admins`).
3. Export current schema/data snapshot (Supabase backup or pg dump).
4. Confirm no in-flight production deployment touching auth/org tables.

## Apply migration
### Option A: Supabase SQL Editor (recommended here)
1. Open Supabase project SQL editor.
2. Paste `supabase/migrations/20260214_tenant_module_entitlements.sql`.
3. Execute once.

### Option B: Supabase CLI (if configured)
1. `supabase db push`

## Post-migration verification SQL
Run each query and confirm expected output.

1. Tables exist:
```sql
select tablename
from pg_tables
where schemaname = 'public'
  and tablename in (
    'platform_admins',
    'module_catalog',
    'organization_module_entitlements',
    'module_entitlement_audit'
  )
order by tablename;
```

2. Module catalog seeded:
```sql
select module_key, module_name, dependency_keys
from public.module_catalog
order by module_key;
```
Expected: 11 rows including `furniture_configurator`.

3. Entitlements seeded for all org/module pairs:
```sql
select
  count(*) as entitlement_rows,
  (select count(*) from public.organizations) as org_count,
  (select count(*) from public.module_catalog) as module_count
from public.organization_module_entitlements;
```
Expected: `entitlement_rows = org_count * module_count` (unless pre-existing rows existed).

4. Configurator default state:
```sql
select o.name, e.enabled, e.status, e.billing_model
from public.organization_module_entitlements e
join public.organizations o on o.id = e.org_id
where e.module_key = 'furniture_configurator'
order by o.name;
```
Expected: `enabled = false` for seeded rows.

5. Platform admin bootstrap:
```sql
select p.user_id, p.platform_role, p.is_active
from public.platform_admins p
order by p.inserted_at;
```
Expected: may be empty immediately after migration.

6. Insert first super admin manually (case-by-case):
```sql
insert into public.platform_admins (user_id, platform_role, is_active, notes)
select u.id, 'platform_owner', true, 'Manual bootstrap approved by owner'
from auth.users u
where lower(u.email) = lower('<SUPER_ADMIN_EMAIL>')
on conflict (user_id) do update
set platform_role = excluded.platform_role,
    is_active = excluded.is_active,
    notes = excluded.notes;
```
Expected: 1 row affected for approved email.

Approved first super admin for this rollout:
```sql
insert into public.platform_admins (user_id, platform_role, is_active, notes)
select u.id, 'platform_owner', true, 'Initial Unity super admin bootstrap'
from auth.users u
where lower(u.email) = lower('greg@apexza.net')
on conflict (user_id) do update
set platform_role = excluded.platform_role,
    is_active = excluded.is_active,
    notes = excluded.notes;
```

7. Function sanity checks (run as authenticated user in SQL console where possible):
```sql
select public.is_platform_admin();
select public.current_org_id();
select public.has_module_access('furniture_configurator');
```

## Staging smoke test (after app code for gating is merged)
1. In staging, pick test org A and org B.
2. For org A, enable module:
```sql
update public.organization_module_entitlements
set enabled = true,
    status = 'active',
    billing_model = 'manual',
    source = 'runbook-smoke',
    notes = 'staging smoke test',
    updated_by = null
where org_id = '<ORG_A_UUID>'
  and module_key = 'furniture_configurator';
```

3. For org B, keep disabled:
```sql
update public.organization_module_entitlements
set enabled = false,
    source = 'runbook-smoke',
    notes = 'staging smoke test'
where org_id = '<ORG_B_UUID>'
  and module_key = 'furniture_configurator';
```

4. Validate behavior:
- Org A user sees Configurator action and can save via API.
- Org B user does not see Configurator action.
- Org B direct route/API attempt returns 403.
- `module_entitlement_audit` contains update rows.
- Dependency validation works:
  - enabling a module with disabled dependencies returns 409 + `missing_dependencies`
  - disabling a module while active dependents exist returns 409 + `dependent_modules`

5. Audit verification:
```sql
select
  created_at,
  org_id,
  module_key,
  enabled_before,
  enabled_after,
  change_reason,
  metadata
from public.module_entitlement_audit
where module_key = 'furniture_configurator'
order by created_at desc
limit 50;
```

## Rollback playbook
### Soft rollback (preferred)
1. Re-enable module for affected organizations:
```sql
update public.organization_module_entitlements
set enabled = true,
    status = 'active',
    source = 'rollback',
    notes = 'temporary rollback'
where module_key = 'furniture_configurator';
```

2. Re-run smoke checks.

### Code rollback
1. Revert entitlement gate code deployment while leaving schema in place.
2. Confirm critical product/cutlist routes recover.

### Hard rollback (only if explicitly required)
Do not drop new tables until data is exported. If needed:
```sql
-- export data first
-- then drop in reverse dependency order

drop trigger if exists organization_module_entitlements_audit on public.organization_module_entitlements;
drop function if exists public.log_org_module_entitlement_change();
drop function if exists public.has_module_access(text, uuid);
drop function if exists public.current_org_id();
drop function if exists public.is_platform_admin();

drop table if exists public.module_entitlement_audit;
drop table if exists public.organization_module_entitlements;
drop table if exists public.module_catalog;
drop table if exists public.platform_admins;
```

## Application validation commands (post-code implementation)
Run locally before merge:
1. `pnpm lint`
2. `pnpm build`
3. `node --test --import tsx tests/module-access.test.ts`
4. `pnpm exec eslint 'app/api/products/[productId]/route.ts' 'app/api/products/[productId]/add-fg/route.ts'`

## Phase 2 API smoke checks (products endpoints)
After deploying Phase 2 hardening, verify:
1. `POST /api/products`, `GET /api/products`, `GET|PUT|DELETE /api/products/:id`, and `POST /api/products/:id/add-fg` return `401` when no bearer token is supplied.
2. The same endpoints return `403` with module reason metadata when the user lacks `products_bom`.
3. Authorized + entitled users can still create/update/delete products and add FG successfully.

## Release gates
1. Migration applied successfully in staging.
2. Staging smoke tests pass for enabled/disabled orgs.
3. Audit logs captured for entitlement changes.
4. Code review approved for API-level enforcement.
5. Production rollout window approved.
