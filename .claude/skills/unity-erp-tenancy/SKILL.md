---
name: unity-erp-tenancy
description: Unity ERP multi-tenancy (organizations) workflow. Use when adding org_id, backfilling data, tightening RLS, debugging "null nested relation" issues, or implementing tenant-scoped module access.
argument-hint: "[table/feature to change or debug]"
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# Unity ERP Tenancy (Organizations)

Scope: **$ARGUMENTS**

## Canonical Docs (start here)
- `docs/README.md`
- `docs/operations/tenant-data-isolation-zero-downtime-runbook.md`
- `docs/operations/tenant-module-entitlements-runbook.md`
- `docs/operations/tenant-rollout-status.md`
- `docs/overview/todo-index.md`

## Vocabulary
- Use **organization** consistently in UI/code/docs.
- "Tenant" is acceptable as a synonym in technical discussion.

## Default Approach (safe for live systems)
Follow the staged plan in the runbook. The intent is **zero downtime** and easy rollback:
1. **Expand-only first**: add `org_id` as nullable + default/backfill + indexes + `NOT VALID` FK.
2. Verify data consistency:
   - No `org_id IS NULL` rows for the tables you touched.
   - Parent/child org alignment is correct.
   - No users missing `public.organization_members`.
3. **Tighten RLS in baby steps**:
   - One table at a time.
   - Add org-scoped policies while leaving existing permissive policies in place.
   - Verify with a normal user.
   - Only then remove permissive policies.
4. **Enforce constraints later**:
   - `VALIDATE CONSTRAINT` on FKs once stable.
   - Only then consider `SET NOT NULL` on `org_id`.

## Common Pitfall: "Nested relation is null"
Supabase nested selects can return `null` for embedded objects when:
- the user is missing an org membership row, or
- one related table is RLS-locked while the other is not, or
- the join row exists but is blocked by RLS.

UI code must treat nested relations as nullable and avoid direct dereferences like:
`row.supplier_component.component.internal_code`

## Server-Side Patterns (prefer these)
- Org resolution + membership:
  - `lib/api/org-context.ts`
- Module entitlement checks:
  - `lib/api/module-access.ts`

## Guard Rails
- Never tighten RLS in production without running the "users missing membership" check in the runbook.
- When debugging a "works for super admin but not normal user" issue, suspect:
  - missing `organization_members` row, or
  - RLS blocking a nested relation.

