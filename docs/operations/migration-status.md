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
- Latest applied migration version: 20260220192517
- Latest applied migration name: tenant_org_scoping_expand_product_cutlist_groups
- Applied at (UTC): Verified 2026-02-20 (exact apply time not recorded here)
- Applied by: Previously applied (see Supabase migration history)
- Verification notes: Confirmed via Supabase MCP `list_migrations` on 2026-02-20.

## Pre-Deploy Migration Checklist
- [ ] Repo checked: latest file in `supabase/migrations`
- [ ] Target env checked: latest applied from MCP `list_migrations`
- [ ] Any pending migrations applied in target env
- [ ] Post-apply verification completed
- [ ] This document updated
