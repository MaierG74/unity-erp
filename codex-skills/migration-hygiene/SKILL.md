---
name: migration-hygiene
description: Use when creating, applying, or reconciling Supabase migrations. Enforces append-only/versioned migration history and environment ledger sync.
---

# Migration Hygiene Skill

## When To Use
- Any change under `supabase/migrations`
- Any Supabase MCP migration apply/reconcile work
- Any migration history drift investigation

## Required Workflow
1. Treat `supabase/migrations` as append-only and immutable once applied.
2. Never edit an already-applied migration file in place.
3. If behavior changes after apply, create a new follow-up migration file.
4. Migration filenames must be versioned and match Supabase history format:
   - `<version>_<name>.sql`
   - Example: `20260224155131_po_split_allocation_overalloc_guard.sql`
5. Do not add non-versioned helper/ledger files under `supabase/migrations`.
6. Put explanatory context in docs (`docs/operations/migration-status.md`), not extra migration files.

## Apply + Verify Checklist
1. Apply via approved Supabase MCP flow.
2. Verify applied state with Supabase MCP `list_migrations`.
3. Update `docs/operations/migration-status.md` for each touched environment:
   - latest applied version
   - latest applied migration name
   - applied at (UTC)
   - applied by
   - verification notes
4. Before deploy, compare latest repo migration vs latest applied migration for target environment.

## Drift Handling
1. If Supabase history has a version missing locally, add a matching local versioned file.
2. Do not create alternate duplicate filenames for the same migration.
3. If duplicate local files exist for one logical migration, keep the canonical versioned file and remove non-canonical duplicates.

