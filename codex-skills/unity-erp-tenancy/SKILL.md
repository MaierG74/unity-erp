---
name: unity-erp-tenancy
description: Use when implementing or modifying multi-tenant (organization/org_id) behavior in Unity ERP. Covers the staged rollout approach, verification queries, and common pitfalls like missing org membership causing null nested relations.
---

# Unity ERP Tenancy Skill

## Start Here (docs)
- `docs/README.md`
- `docs/operations/tenant-data-isolation-zero-downtime-runbook.md`
- `docs/operations/tenant-module-entitlements-runbook.md`

## Default Approach (safe for live systems)
1. **Expand-only first**: add `org_id` nullable + backfill + defaults + indexes + `NOT VALID` FKs.
2. Verify data consistency (`org_id` filled, parent/child match).
3. Enforce constraints later (validate FK, then `NOT NULL`).
4. Roll out RLS in **baby steps** (one table at a time) with explicit go/no-go checks.

## Must-Run Checks (before tightening RLS)
Read `docs/operations/tenant-data-isolation-zero-downtime-runbook.md` and use the queries in:
- Stage 0 (preflight)
- 0.2b (users missing `organization_members`)

## Common Pitfall: Partial RLS = Null Relations
If one table is tenant-locked but a related table is not (or a user has no org membership), Supabase nested selects can return `null` for embedded objects.

UI must treat nested relations as nullable and avoid direct dereferences like:
`row.supplier_component.component.internal_code`

## References
For current production state and next steps, see:
- `docs/overview/todo-index.md`

