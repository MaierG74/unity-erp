# Migration Status (All Environments)

Use this file to track migration rollout state by environment.  
Source of truth for what is actually applied is still Supabase migration history (`supabase_migrations` via MCP `list_migrations`).

## How To Update
1. Apply migration(s) with approved workflow.
2. Run Supabase MCP `list_migrations` for the environment.
3. Record latest applied version and notes below.

## Local
- Environment: Local dev DB
- Latest applied migration version:
- Latest applied migration name:
- Applied at (UTC):
- Applied by:
- Verification notes:

## Staging
- Environment: Staging project
- Project ref: xhlfwnryxsrzasoopoat
- Latest applied migration version:
- Latest applied migration name:
- Applied at (UTC):
- Applied by:
- Verification notes:

## Production
- Environment: Production project
- Project ref: ttlyfhkrsjjrzxiagzpb
- Latest applied migration version: 20260225074503
- Latest applied migration name: timekeeper_trigger_security_definer_fix
- Applied at (UTC): 2026-02-25
- Applied by: Codex via Supabase MCP
- Verification notes:
  1. `timekeeper_anon_read_hotfix_qbutton` (20260225073626): restored limited `anon` read on `public.staff` + `public.time_clock_events` for active Qbutton staff.
  2. `timekeeper_anon_insert_policy_fix` (20260225074120): relaxed `anon` insert policy predicate to work with scanner payload shape.
  3. `timekeeper_anon_policy_uuid_lock_fix` (20260225074246): removed `organizations` table dependency from anon policy checks and locked predicates to Qbutton org UUID.
  4. `timekeeper_trigger_security_definer_fix` (20260225074503): made `update_daily_work_summary` trigger function `SECURITY DEFINER` and propagated `org_id` in summary upserts.
  5. External scanner behavior verified via real anon REST calls:
     - `GET /rest/v1/staff?...` returns `200`.
     - `GET /rest/v1/time_clock_events?...` returns `200`.
     - `POST /rest/v1/time_clock_events` returns `201`.
  6. This is a tactical compatibility path for a non-authenticated scanner integration; long-term target remains authenticated organization-context scanner access.

## Pre-Deploy Migration Checklist
- [ ] Repo checked: latest file in `supabase/migrations`
- [ ] Target env checked: latest applied from MCP `list_migrations`
- [ ] Any pending migrations applied in target env
- [ ] Post-apply verification completed
- [ ] This document updated
