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
- Latest applied migration version: 20260222145908
- Latest applied migration name: tenant_rls_step66_quote_item_cutlists_enable_org
- Applied at (UTC): 2026-02-22
- Applied by: Codex via Supabase MCP
- Verification notes: Confirmed via `supabase_migrations.schema_migrations` and Supabase MCP checks; Steps 61-66 completed for quote helper tables (`quote_cluster_lines`, `quote_item_clusters`, `quote_item_cutlists`) with `org_id` FK validation + `NOT NULL` enforcement and org-scoped RLS policies enabled. Normal-user smoke tests (`testai@qbutton.co.za`) on `/quotes` and quote detail succeeded with no new access/runtime regressions.

## Pre-Deploy Migration Checklist
- [ ] Repo checked: latest file in `supabase/migrations`
- [ ] Target env checked: latest applied from MCP `list_migrations`
- [ ] Any pending migrations applied in target env
- [ ] Post-apply verification completed
- [ ] This document updated
