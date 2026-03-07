# Unity ERP Agent Notes

This repository is being actively migrated to **multi-tenant** (organization/tenant) data isolation in Supabase using `org_id` + RLS.

## Execution Checklist (every tenant-scoped change)
1. Read `docs/README.md` and locate the canonical area docs for the feature.
2. Check `docs/overview/todo-index.md` for active tasks and source docs.
3. Apply organization scoping (`org_id`) and verify access behavior under RLS.
4. Update the canonical feature/domain docs before marking the work done.

## Branch Workflow
- `main` is release-only. Do not use it as the default branch for ongoing feature work.
- Use a dedicated short-lived branch for each task.
- If local work, cloud Codex, and cloud Claude are running at the same time, each must use a different branch.
- Branch names should use the `codex/` prefix and clearly describe the worker and task, for example:
  - `codex/local-purchasing-fix`
  - `codex/cloud-codex-assistant-routing`
  - `codex/cloud-claude-docs-purchasing`
- Treat anything going to `main` as a release slice: only move reviewed, production-safe changes.

## Documentation Update Rules
- Always update the canonical doc for the feature or domain you changed.
- Do not update shared summary/index docs such as `docs/README.md` or `docs/overview/todo-index.md` unless one of these is true:
  - the task status materially changed
  - a new workstream or source doc was introduced
  - you are doing release or migration reconciliation
- Prefer release-time reconciliation for shared index docs when multiple branches are active, to reduce merge conflicts.

## Canonical Docs (start here)
- Documentation index: `docs/README.md`
- Tenant module entitlements (feature toggles per org): `docs/operations/tenant-module-entitlements-runbook.md`
- Tenant data isolation (zero-downtime staged plan): `docs/operations/tenant-data-isolation-zero-downtime-runbook.md`
- Consolidated TODO tracker: `docs/overview/todo-index.md`

## Operational Notes
- Prefer Supabase MCP for migrations/SQL/storage/edge functions and doc lookups; avoid ad-hoc SQL scripts when MCP coverage exists.
- For MCP setup or troubleshooting, use `docs/technical/mcp-setup.md`.
- Fast validation commands: `npm run lint`, `npm run build`, and `npm run schema` when schema-level changes are involved.
- Non-obvious guardrails: staff attendance payroll rules rely on `time_clock_events`; keep `@react-pdf/renderer` lazily/dynamically imported to avoid build timeouts.

## Migration Tracking (All Features)
- For migration create/apply/reconcile work, use `codex-skills/migration-hygiene/SKILL.md`.
- Keep `docs/operations/migration-status.md` synced to Supabase MCP `list_migrations` after each apply.

## Tenancy Vocabulary
- Use **organization** (aka **tenant**) consistently.

## Tenancy Rules Of Thumb (for new code)
1. If a feature stores **customer/org-specific data**, it must be scoped by `org_id` (eventually `NOT NULL` + FK + RLS).
2. A user must have a row in `public.organization_members` to see tenant-scoped tables under RLS.
3. Supabase nested selects can return `null` for related rows that are blocked by RLS. UI code should treat nested relations as nullable.
4. Prefer enforcing access in server routes via the shared module/org utilities (see `lib/api/module-access.ts` + `lib/api/org-context.ts`) rather than ad-hoc checks.
5. If a task touches multi-tenant behavior, use `codex-skills/unity-erp-tenancy/SKILL.md`.

## Production State Notes
This evolves. Do not assume everything is fully tenant-enforced yet. Always check the runbook and verify RLS/policies on the tables you touch.
If docs and code disagree, verify the current schema and active RLS policies first, then update docs to match verified behavior.
