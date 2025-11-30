---
title: Permissions & Logging Plan
status: Planning
last_updated: 2025-11-08
---

# Permissions & Logging Plan

## Purpose
- Establish a consistent role- and permission-management model for Unity ERP.
- Deliver an admin surface that controls read/write/delete access for critical resources.
- Integrate application-level permissions with database RLS and audit logging so transactions are traceable.

## Background
Recent reviews highlighted gaps:
- `inventory_transactions` and related tables lack user attribution, metadata columns, or RLS (`schema.txt` snapshot).
- API routes such as `app/api/inventory/components/[componentId]/route.ts` run with the service-role client without validating user permissions.
- Client-side components (e.g., `app/inventory/page.tsx`) still call Supabase directly for destructive actions.
- The [User Activity Logging plan](../operations/user-logging.md) defines the audit posture, but no schema/utilities exist yet.

This plan unifies permissions and logging work so both ship together.

## Goals & Success Criteria
- **Role definition**: Canonical list of ERP roles (e.g., admin, purchasing_clerk, inventory_manager, auditor) documented and queryable.
- **Permission matrix**: Resource × action grid stored in Postgres with APIs/UI to manage it.
- **RLS alignment**: Database policies derive from the permission tables; direct SQL obeys the same rules.
- **Audit coverage**: Every write path resolves the actor, enforces permissions, and produces a durable log entry.
- **Operator workflow**: Admins can grant/revoke access without redeploying code.

## Non-Goals
- OAuth provider changes or external identity management.
- Historical backfill of legacy data beyond basic attribution defaults.
- Building advanced SIEM integrations (tracked separately in logging open questions).

## Target Architecture
```
[Admin UI permissions page]
        │
        ▼
[Next.js API /api/admin/permissions]
        │ (service-role Supabase client, schema validation, session checks)
        ▼
[Postgres permission tables]
    ├─ profile_roles (profile_id uuid, role text, granted_at timestamptz)
    ├─ roles (role text PK, description)
    └─ role_permissions (role text, resource text, can_read bool, can_write bool, can_delete bool)

[Permission resolver]
        │
        ├─ Applies to API routes/server actions (middleware/HOF)
        └─ Emits context to logUserActivity helper

[RLS policies]
        └─ Reference role_permissions via auth.uid() → profiles → profile_roles chain
```

## Implementation Phases
1. **Design & Schema**
   - Finalize role taxonomy with stakeholders; document in `docs/overview/auth.md`.
   - Ship migrations for `roles`, `profile_roles`, `role_permissions`, and metadata columns on `inventory_transactions`.
   - Seed initial roles/resources and add views/helpers for policy checks.
2. **Policy Layer**
   - Enable RLS on `inventory`, `inventory_transactions`, `supplier_order_receipts` (and other critical tables).
   - Author GRANT/POLICY scripts that consult `role_permissions`.
   - Provide SQL helper (`refresh_role_policies`) that regenerates policies when permission records change.
3. **Application Enforcement**
   - Create permission resolver utilities (`requirePermission({ resource, action })`) for server routes.
   - Refactor existing mutation routes (inventory delete, purchasing receipt RPC callers, etc.) to use the resolver.
   - Replace client-side Supabase mutations with server actions that enforce permissions.
4. **Permissions Admin UI**
   - Build `app/admin/permissions/page.tsx` feature flagged for admins.
   - Implement matrix component with optimistic toggles and toast feedback.
   - Add API endpoints (`GET/PUT /api/admin/permissions`) to query and update role permissions.
5. **Logging Integration**
   - Implement `lib/logging.ts` helper and request context middleware (`libs/server/request-context.ts` TBD).
   - Ensure every resolver call logs success/failure via `user_activity_logs`.
   - Add DB triggers for direct SQL paths to capture actor metadata and log events.
6. **Verification & Rollout**
   - Unit tests for permission resolution and logging helpers.
   - Integration tests covering API flows and RLS enforcement.
   - Playwright/Smoke scripts verifying admin UI toggles persist.
   - Documentation updates and stakeholder training.

## Deliverables
- SQL migrations (`migrations/` + `schema.txt` refresh).
- Type-safe Supabase helpers for roles/permissions.
- Admin permissions page UI.
- Logging utilities and middleware.
- Updated docs: auth overview, operations logging, module docs referencing new flows.

## Dependencies & Coordination
- Requires Supabase environment variables (`SUPABASE_SERVICE_ROLE_KEY`) configured for new server routes.
- Coordinate with Ops for initial role assignments and rollout messaging.
- Align with planned AI Assistant access controls (`docs/overview/AI Assistant.md`).

## Testing Strategy
- **Unit**: Permission resolver, logging helper, role assignment utilities.
- **Integration**: Supabase RLS tests using service-role seeds, API route permission checks, logging writes.
- **E2E**: Playwright script toggling permissions and validating blocked operations.

## Risks & Mitigations
- **Policy drift**: Address via `refresh_role_policies` helper and CI checks executing it.
- **Performance**: Cache permission lookups per request; consider edge caching for read-heavy flows.
- **Operational errors**: Provide undo history (audit logs) and require confirmation for destructive toggles in UI.

## Open Questions
- Do we need environment-specific role seeds (dev vs prod)?
- Should permissions support scoped resources (e.g., per location or supplier) now or later?
- How will non-authenticated automation (cron jobs, integrations) authenticate? Service accounts or dedicated roles?
- What is the retention/rotation policy for permission change logs?

## Next Steps
1. Validate role list and resource taxonomy with stakeholders.
2. Draft migrations for `roles`, `profile_roles`, `role_permissions`, and share for review.
3. Prototype permission resolver API and add initial unit tests.
