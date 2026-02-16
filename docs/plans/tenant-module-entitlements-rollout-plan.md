---
title: Tenant Module Entitlements Rollout Plan
status: Planning
owner: Platform Engineering
last_updated: 2026-02-15
---

# Tenant Module Entitlements Rollout Plan

## Executive summary
Unity ERP already has the start of a tenant model (`organizations`, `organization_members`) and admin user tooling, but it does not yet have module licensing/entitlement enforcement. This plan introduces a platform-controlled module access layer so you can sell modules per organization and toggle them on/off centrally, starting with the Furniture Configurator.

## Current baseline (from codebase)
1. Tenant/user scaffolding exists:
- `supabase/migrations/20251215_auth_profiles_orgs.sql` created `organizations`, `organization_members`, `admin_audit_log`, and helper functions (`is_admin`, `is_org_member`).
- Admin user lifecycle routes exist under `app/api/admin/users/*` and org listing under `app/api/admin/orgs/route.ts`.

2. Platform-level super admin concept is not explicit:
- Current admin checks rely on `owner/admin` role claims or membership role in `lib/api/admin.ts`.
- There is no dedicated table for Unity platform operators managing all tenants/modules.

3. Module access control does not exist:
- Sidebar/navigation is static in `components/layout/sidebar.tsx`.
- Product detail shows Configurator and Cutlist actions unconditionally in `app/products/[productId]/page.tsx`.
- Configurator page and related endpoints have no module entitlement checks.

4. Service-role API exposure is broad:
- Many product APIs instantiate service-role clients directly and do not validate user session or org scope (for example `app/api/products/[productId]/cutlist-groups/route.ts`, `app/api/products/route.ts`).

## Decision
Adopt **organizations as tenants** (no new tenant table), and add:
1. A platform operator layer (`platform_admins`) for Unity-level control.
2. A module catalog + per-organization module entitlements.
3. App/API gating based on tenant entitlement, starting with the Furniture Configurator module.

## Target model
### Identity and tenancy
- Keep one Supabase Auth project.
- One user can belong to one or more orgs via `organization_members`.
- Platform operator rights are independent from org role (stored in `platform_admins`).

### Module licensing and access
- `module_catalog`: canonical module keys and metadata.
- `organization_module_entitlements`: enable/disable + billing state per org/module.
- `module_entitlement_audit`: immutable change history for every toggle/update.

### Effective access rule
A user can access module `X` when:
1. They are an active member of org `O`.
2. `organization_module_entitlements` for (`O`, `X`) is enabled and currently active by date/status.
3. (Optional bypass) user is a platform operator for support/debug workflows.

## Phase plan

### Phase 0: Foundation alignment (no user-facing behavior changes)
1. Add database foundation migration (`supabase/migrations/20260214_tenant_module_entitlements.sql`).
2. Seed module catalog and org entitlements (safe defaults; Configurator defaults off).
3. Manually assign initial super admins (`platform_admins`) after owner approval.
4. Add read-only APIs for module catalog and org entitlements.

Exit criteria:
- SQL migration applies cleanly.
- Existing orgs have entitlement rows.
- Admin API can read entitlements for any org.

Implementation slice:
1. PR A (DB only):
- Add migration `supabase/migrations/20260214_tenant_module_entitlements.sql`.
- Validate in staging using `docs/operations/tenant-module-entitlements-runbook.md`.
- No app code changes in this PR.

### Phase 1: MVP module toggle for Furniture Configurator
1. Build platform admin endpoints:
- `GET /api/admin/modules`
- `GET /api/admin/orgs/[orgId]/modules`
- `PUT /api/admin/orgs/[orgId]/modules/[moduleKey]`

2. Build enforcement helpers:
- `resolveUserOrgContext(req)`
- `requireModuleAccess(req, moduleKey, options?)`

3. Enforce Configurator module gate:
- UI: hide "Design with Configurator" button when disabled.
- Page guard: block `/products/[productId]/configurator` when disabled.
- API guard: block `/api/products/[productId]/cutlist-groups` when disabled.

4. Add basic Unity control page:
- `app/admin/modules/page.tsx`: choose org, toggle modules, show status.
- Dependency-aware toggles:
  - block enabling when required `dependency_keys` are disabled
  - block disabling while active dependent modules are still enabled

Exit criteria:
- You can toggle `furniture_configurator` per org.
- Disabled org cannot access page or API.
- Toggle events are auditable.

Implementation slice:
1. PR B (server helpers + admin APIs):
- Add `lib/api/platform.ts`, `lib/api/org-context.ts`, `lib/api/module-access.ts`.
- Add:
  - `app/api/admin/modules/route.ts`
  - `app/api/admin/orgs/[orgId]/modules/route.ts`
  - `app/api/admin/orgs/[orgId]/modules/[moduleKey]/route.ts`
  - `app/api/me/module-access/route.ts`
- Unit/integration tests for auth + entitlement responses.

2. PR C (UI gating + admin page):
- Add module toggle UI at `app/admin/modules/page.tsx`.
- Update product detail/configurator screens to consume module access API.
- Add disabled-state UX messaging (not just hidden actions).

### Phase 2: Harden product/cutlist endpoints with auth + org scope
1. Replace unauthenticated service-role usage with gated pattern:
- Validate session with `getRouteClient`.
- Resolve active org.
- Validate org membership and module entitlement.
- Use anon/RLS client for reads where possible.
- Use service role only after explicit permission checks.

2. Priority targets:
- `app/api/products/[productId]/cutlist-groups/route.ts`
- `app/api/products/[productId]/route.ts`
- `app/api/products/route.ts`
- `app/api/products/[productId]/add-fg/route.ts`

Exit criteria:
- No unauthenticated access to protected product/cutlist data.
- API responses return clear 401/403 reasons.

Implementation slice:
1. PR D (API hardening batch 1):
- Harden `app/api/products/[productId]/cutlist-groups/route.ts`.
- Add org ownership validation for `productId` in every handler.

2. PR E (API hardening batch 2):
- Harden `app/api/products/[productId]/route.ts`.
- Harden `app/api/products/route.ts`.
- Harden `app/api/products/[productId]/add-fg/route.ts`.

Phase 2 implementation notes (2026-02-14):
- `app/api/products/route.ts` now enforces `requireModuleAccess(..., MODULE_KEYS.PRODUCTS_BOM)` for list/create operations.
- `app/api/products/[productId]/route.ts` now enforces the same module gate for get/update/delete and returns explicit 400/401/403/404/500 responses.
- `app/api/products/[productId]/add-fg/route.ts` now enforces module access and validates JSON payload + product existence before inventory mutation.
- Client callers for these routes were switched to `authorizedFetch(...)` so Supabase bearer tokens are forwarded consistently:
  - `components/features/products/product-create-form.tsx`
  - `components/features/products/product-edit-form.tsx`
  - `app/products/[productId]/page.tsx` (Add FG flow)
  - legacy table actions under `src/pages.old/products/*` for delete/duplicate

Phase 2 implementation notes (2026-02-15):
- Product APIs now enforce org-scoped ownership checks using resolved org context from module access:
  - `app/api/products/route.ts` scopes list/create to `org_id`.
  - `app/api/products/[productId]/route.ts` scopes get/update/delete and duplicate checks to `org_id`.
  - `app/api/products/[productId]/add-fg/route.ts` scopes product and inventory mutations to `org_id`.
  - `app/api/products/[productId]/cutlist-groups/route.ts` validates product ownership (`product_id` + `org_id`) before cutlist group operations.
- Order-domain API org-scoping (tenant isolation Stage 3) is also implemented and tracked in:
  - `docs/operations/tenant-data-isolation-zero-downtime-runbook.md`
- Tenant isolation Stage 4 (constraints enforcement) is applied in production on 2026-02-15 via:
  - `supabase/migrations/20260215_tenant_org_scoping_stage4_enforce.sql`
  - Remaining data-isolation work is now focused on staged RLS rollout.
- Tenant isolation Stage 5 (RLS baby-step rollout) started in production on 2026-02-15:
  - `public.products`, `public.customers`, `public.product_inventory`, and `public.product_reservations` now use org-scoped authenticated policies (legacy broad policies removed).
  - `public.orders` and `public.order_details` now have org-scoped policies prepared while remaining `RLS disabled` pending separate enable flip.
  - Next tables are being rolled one-at-a-time with explicit rollback snippets and per-step verification.

### Phase 3: Billing metadata and lifecycle (non-blocking for MVP)
1. Add billing fields usage in admin UI:
- `billing_model`: manual/subscription/paid_in_full/trial/yearly_license
- `status`: active/grace/past_due/canceled
- `starts_at` / `ends_at`

2. Add scheduled checks for expiry/past-due transitions (optional automation).

Exit criteria:
- Module toggles have billing context.
- Expired modules are blocked by policy automatically.

### Phase 4: Multi-org user experience and platform console maturity
1. Add active-org switcher for users with multiple org memberships.
2. Add full platform console routes (`/admin/tenants`, `/admin/modules`, `/admin/billing`).
3. Add module dependency warnings (for example, module requires `products_bom`).

Exit criteria:
- User can switch org context safely.
- Platform admin can manage all tenants from one console.

Implementation slice:
1. PR F:
- Active org switcher (session + JWT claim refresh strategy).
- Platform admin console IA cleanup (`/admin/tenants`, `/admin/modules`, `/admin/billing`).
- Dependency warning UX.

## API contracts (MVP)
### `GET /api/admin/modules`
- Auth: platform admin required.
- Response:
```json
{
  "modules": [
    {
      "module_key": "furniture_configurator",
      "module_name": "Furniture Configurator",
      "description": "Parametric furniture builder with generated cutlist output.",
      "dependency_keys": ["products_bom", "cutlist_optimizer"],
      "is_core": false
    }
  ]
}
```

### `GET /api/admin/orgs/:orgId/modules`
- Auth: platform admin required.
- Response:
```json
{
  "org_id": "uuid",
  "entitlements": [
    {
      "module_key": "furniture_configurator",
      "enabled": false,
      "billing_model": "manual",
      "status": "active",
      "starts_at": "2026-02-14T00:00:00Z",
      "ends_at": null
    }
  ]
}
```

### `PUT /api/admin/orgs/:orgId/modules/:moduleKey`
- Auth: platform admin required.
- Request:
```json
{
  "enabled": true,
  "billing_model": "subscription",
  "status": "active",
  "starts_at": "2026-02-15T00:00:00Z",
  "ends_at": null,
  "notes": "Client subscribed to Configurator module"
}
```
- Response:
```json
{
  "success": true,
  "entitlement": {
    "org_id": "uuid",
    "module_key": "furniture_configurator",
    "enabled": true,
    "billing_model": "subscription",
    "status": "active"
  }
}
```

### `GET /api/me/module-access?module=furniture_configurator`
- Auth: authenticated user.
- Response:
```json
{
  "module_key": "furniture_configurator",
  "org_id": "uuid",
  "allowed": true,
  "reason": "enabled"
}
```

## File-level execution checklist (MVP)
1. Data layer:
- `/Users/gregorymaier/Developer/unity-erp/supabase/migrations/20260214_tenant_module_entitlements.sql` (already drafted).

2. Shared API helpers:
- `/Users/gregorymaier/Developer/unity-erp/lib/api/platform.ts`
- `/Users/gregorymaier/Developer/unity-erp/lib/api/org-context.ts`
- `/Users/gregorymaier/Developer/unity-erp/lib/api/module-access.ts`

3. Admin APIs:
- `/Users/gregorymaier/Developer/unity-erp/app/api/admin/modules/route.ts`
- `/Users/gregorymaier/Developer/unity-erp/app/api/admin/orgs/[orgId]/modules/route.ts`
- `/Users/gregorymaier/Developer/unity-erp/app/api/admin/orgs/[orgId]/modules/[moduleKey]/route.ts`

4. User/API guards:
- `/Users/gregorymaier/Developer/unity-erp/app/api/me/module-access/route.ts`
- `/Users/gregorymaier/Developer/unity-erp/app/api/products/[productId]/cutlist-groups/route.ts`

5. UI gates:
- `/Users/gregorymaier/Developer/unity-erp/app/products/[productId]/page.tsx`
- `/Users/gregorymaier/Developer/unity-erp/app/products/[productId]/configurator/page.tsx`
- `/Users/gregorymaier/Developer/unity-erp/components/features/configurator/FurnitureConfigurator.tsx`
- `/Users/gregorymaier/Developer/unity-erp/app/admin/modules/page.tsx`

6. Optional nav gating follow-up:
- `/Users/gregorymaier/Developer/unity-erp/components/layout/sidebar.tsx`

## PR strategy and merge order
1. PR A: migration + runbook docs.
2. PR B: helper layer + admin entitlement APIs.
3. PR C: module admin UI + product/configurator UI gating.
4. PR D: API enforcement on cutlist-groups route.
5. PR E: remaining product endpoint hardening.

Rule: every PR after A must include at least one integration test covering 401/403/200.

## Data model details
The migration file `supabase/migrations/20260214_tenant_module_entitlements.sql` introduces:
1. `platform_admins`
- Tracks Unity platform operators.

2. `module_catalog`
- Canonical module definitions and dependency list.

3. `organization_module_entitlements`
- Per-org module state and billing lifecycle metadata.

4. `module_entitlement_audit`
- Every entitlement change captured with before/after values.

5. Helper functions
- `is_platform_admin()`
- `current_org_id()`
- `has_module_access(module_key, org_id)`

6. RLS policies
- Read by org members where relevant.
- Write by platform admins only.

## API and app change map (implementation-ready)
### New server utilities
1. `lib/api/platform.ts`
- `requirePlatformAdmin(req)`
- `recordPlatformAudit(...)`

2. `lib/api/org-context.ts`
- `resolveUserOrgContext(req)`

3. `lib/api/module-access.ts`
- `requireModuleAccess(req, moduleKey, opts)`

### New API routes
1. `app/api/admin/modules/route.ts`
2. `app/api/admin/orgs/[orgId]/modules/route.ts`
3. `app/api/admin/orgs/[orgId]/modules/[moduleKey]/route.ts`
4. `app/api/me/module-access/route.ts`

### Existing routes/components to update first
1. `app/api/products/[productId]/cutlist-groups/route.ts`
2. `app/products/[productId]/configurator/page.tsx`
3. `components/features/configurator/FurnitureConfigurator.tsx`
4. `app/products/[productId]/page.tsx`
5. `components/layout/sidebar.tsx` (later phase for full module-aware nav)

## Guardrail policy
Every paid module must be enforced in three places:
1. UI gate (hide/disable actions).
2. Route gate (block direct URL access).
3. API gate (hard deny server-side, authoritative).

## Testing strategy
### Unit
1. `current_org_id()` behavior with/without JWT org claim.
2. `has_module_access()` across enabled/disabled/expired statuses.
3. Access helper behavior for platform admin vs org member.

### Integration
1. API 401 when missing token.
2. API 403 when org member lacks entitlement.
3. API 200 when entitlement enabled.
4. Audit row created for every entitlement mutation.

### E2E
1. Platform admin toggles Configurator off for org A.
2. Org A user no longer sees button and gets blocked on direct route/API.
3. Org B user remains unaffected.

## Rollout and rollback
### Rollout
1. Apply migration in staging.
2. Enable gates for Configurator only.
3. Smoke test org A (enabled) and org B (disabled).
4. Promote migration and code together.

### Rollback
1. Soft rollback: re-enable module for affected orgs.
2. Code rollback: disable entitlement checks behind temporary env guard if critical.
3. DB rollback: do not drop core tables immediately; preserve audit/history.

## Risks and mitigations
1. Risk: Service-role endpoints bypass RLS and leak cross-tenant data.
- Mitigation: enforce user session and org scope before every service-role action.

2. Risk: Incorrect org resolution for multi-org users.
- Mitigation: add explicit active-org selection and deterministic fallback.

3. Risk: Breaking existing customers by default-off entitlements.
- Mitigation: seed all current modules enabled except `furniture_configurator`; review before production apply.

4. Risk: Inconsistent gates (UI hidden but API open).
- Mitigation: API gate is mandatory; UI gate treated as convenience only.

## Decisions recorded (2026-02-14)
1. Super admin model approved:
- Keep organization `admin` for tenant-local user management.
- Add separate Unity-level super admin via `platform_admins`.

2. Promotion policy approved:
- Do not auto-promote `owner` users from JWT/org role.
- Super admins are assigned manually, case-by-case, with your approval.
- First approved super admin bootstrap: `greg@apexza.net`.

3. Seed behavior approved for now:
- `furniture_configurator`: disabled by default.
- Existing modules in catalog: enabled for current orgs to avoid disruption.
- Future module rollout policy: decide and set entitlement per org at release time.

4. Billing model decision deferred:
- Keep schema support for `manual`, `subscription`, `paid_in_full`, `trial`, `yearly_license`.
- Operational default until finalized pricing policy: use `manual`.

## Immediate next action when you return
1. Review this plan and migration file.
2. Confirm first super admin user(s) to insert.
3. Approve implementation start (Phase 1 first, then Phase 2 hardening).

## Related runbooks
1. `docs/operations/tenant-module-entitlements-runbook.md` for module entitlement rollout.
2. `docs/operations/tenant-data-isolation-zero-downtime-runbook.md` for staged `org_id` scoping of live domain data (`orders/products/stock`).
