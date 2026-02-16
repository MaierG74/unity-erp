# Unity ERP Agent Notes

This repository is being actively migrated to **multi-tenant** (organization/tenant) data isolation in Supabase using `org_id` + RLS.

## Canonical Docs (start here)
- Documentation index: `docs/README.md`
- Tenant module entitlements (feature toggles per org): `docs/operations/tenant-module-entitlements-runbook.md`
- Tenant data isolation (zero-downtime staged plan): `docs/operations/tenant-data-isolation-zero-downtime-runbook.md`
- Consolidated TODO tracker: `docs/overview/todo-index.md`

## Tenancy Vocabulary
- Use **organization** (aka **tenant**) consistently.

## Tenancy Rules Of Thumb (for new code)
1. If a feature stores **customer/org-specific data**, it must be scoped by `org_id` (eventually `NOT NULL` + FK + RLS).
2. A user must have a row in `public.organization_members` to see tenant-scoped tables under RLS.
3. Supabase nested selects can return `null` for related rows that are blocked by RLS. UI code should treat nested relations as nullable.
4. Prefer enforcing access in server routes via the shared module/org utilities (see `lib/api/module-access.ts` + `lib/api/org-context.ts`) rather than ad-hoc checks.

## Production State Notes
This evolves. Do not assume everything is fully tenant-enforced yet. Always check the runbook and verify RLS/policies on the tables you touch.

