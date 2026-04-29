# Codex Desktop pickup prompt — POL-84 (Phase A1)

**Paste everything below the divider into Codex CLI on Greg's local desktop.**

---

LOCAL DESKTOP ONLY. Do NOT run this in Codex Cloud or any remote agent — Cloud branches off `main`, not `codex/integration`, and produces stale-base divergence (this work depends on the post-POL-71 state on `codex/integration`). If you read this and you are running in a Cloud environment, STOP and tell Greg.

You are picking up Phase A1 of the Cutlist Material Swap & Surcharge feature (Linear POL-84, parent POL-83). The spec was just signed off after 4 rounds of GPT-5.5 Pro plan review (7 BLOCKERs / 15 MAJORs / 4 MINORs surfaced and integrated). This phase is sign-off-required because it includes RLS, tenant FKs, a column rename on a hot table, and a multi-source data backfill.

## Read these first

1. **Linear issue POL-84** — full ACs + scope. Use `mcp__linear__get_issue POL-84`.
2. **Spec at canonical location** — `docs/superpowers/specs/2026-04-29-cutlist-material-swap-and-surcharge-design.md` on branch `codex/local-cutlist-material-swap-spec`. Phase A1 ACs are in §"Phase A1 — Schema + snapshot shape + consumers + backfill". The spec is authoritative; this prompt summarises but does not replace it.
3. **POL-71 spec** at `docs/plans/2026-04-28-product-swap-and-surcharge.md` — this work extends POL-71's BOM-swap shape. Do not re-litigate POL-71's design decisions.
4. **AGENTS.md** at the repo root — branch naming, baton state machine, Linear handoff workflow.

## Branch + base

- **Base branch:** `origin/codex/integration` — fetch and check out a fresh worktree from origin, never from local `codex/integration`. Local can have unpushed WIP.
- **Work branch:** `codex/local-pol-84-cutlist-a1`
- **Worktree:** `/Users/gregorymaier/developer/unity-erp-pol-84` (separate from the spec branch worktree at `/Users/gregorymaier/developer/unity-erp`)

## Scope (Phase A1 ONLY — do not bleed into A2/B/C/D/E/F)

**In scope:**

1. Schema migrations (multiple, each named distinctly under `supabase/migrations/`):
   - `quote_items` adds: `cutlist_material_snapshot`, `cutlist_primary_material_id`, `cutlist_primary_backer_material_id`, `cutlist_primary_edging_id`, `cutlist_part_overrides`, `cutlist_surcharge_kind`, `cutlist_surcharge_value`, `cutlist_surcharge_label`, `cutlist_surcharge_resolved`
   - `order_details` renames `cutlist_snapshot` → `cutlist_material_snapshot` AND adds the same new columns (excluding the snapshot column which is being renamed in place)
   - `components` adds `surcharge_percentage NUMERIC(5,2) NULL` (range -100 to 1000) AND `UNIQUE (component_id, org_id)` if not already present
   - 6 composite FKs on `(component_id, org_id) → components` (primary/backer/edging × quote_items + order_details)
   - New table `board_edging_pairs` with `updated_at` BEFORE-UPDATE trigger, 4 RLS policies, `(org_id, board_component_id, thickness_mm)` UNIQUE
2. Extended snapshot shape (`lib/orders/snapshot-types.ts`):
   - `CutlistSnapshotGroup` gains `effective_backer_id`, `effective_backer_name`
   - `CutlistSnapshotPart` gains `effective_board_id`, `effective_board_name`, `effective_thickness_mm`, `effective_edging_id`, `effective_edging_name`, `is_overridden`
3. Builders:
   - `lib/orders/build-cutlist-snapshot.ts` — new signature; populate per-part effective fields from line primary + overrides + pair lookup. Replace the old `materialOverrides`/`removedMaterialIds` parameters.
   - `lib/quotes/build-cutlist-snapshot.ts` — new file, same shape
   - `lib/orders/cutlist-surcharge.ts` — `resolveCutlistSurcharge` helper (preview-only; A2 trigger is authoritative). MUST mirror SQL `compute_cutlist_surcharge` exactly per spec §App-side helper.
4. TS consumer updates (13 sites — full table in spec §Snapshot Consumers; high-leverage ones below):
   - `lib/piecework/cuttingPlanWorkPool.ts` — read per-part `effective_board_id`
   - `lib/orders/material-assignment-types.ts:buildPartRoles` — prefer per-part effective fields
   - `lib/orders/edging-computation.ts` — prefer per-part `effective_edging_id`
   - `lib/cutlist/groupsToCutlistRows.ts` — same
   - `app/api/orders/[orderId]/cutting-plan/route.ts` and `aggregate/route.ts`
   - `lib/orders/material-regroup.ts`
   - `app/api/orders/from-quote/route.ts` — clone cutlist data on conversion (note: this is the cloning path; the actual quote-side dialog is Phase C)
   - `app/api/orders/[orderId]/add-products/route.ts` — seed line primary from product
   - `app/api/orders/[orderId]/export-cutlist/route.ts` — group by per-part `effective_board_id`
   - `app/api/orders/[orderId]/details/[detailId]/cutlist/route.ts` raw PATCH — **delete by default** (alternative: gate behind `?force=true` admin-only with logging; pick delete unless you find a consumer)
   - `app/api/order-details/[detailId]/route.ts` PATCH — accept new cutlist columns (the A2 trigger doesn't exist yet at A1 time, so don't write `surcharge_total` from the new fields here; that's A2's job)
   - `lib/orders/cutting-plan-utils.ts:computeSourceRevision` — extend to hash new line-level columns; commercial fields (`cutlist_surcharge_*`) are explicitly EXCLUDED from the hash per spec §Cutting-plan source revision hash extension
5. SQL/RPC audit (A1-CS1) — re-confirm via `grep -rn "cutlist_snapshot" supabase/migrations/ db/migrations/ migrations/` and `pg_proc` query that zero readers exist. Document in PR. STOP and add ACs if any reader has been introduced since spec sign-off.
6. Backfill of `orders.material_assignments` per-line entries → new line-level columns. Six-step deterministic rule per spec §A1-BF1. Edging-loss validation across **all legacy orders with assignments** (not just orders with cutting plans).
7. Maintenance-window deployment (A1-D5) — runbook in `docs/operations/migration-status.md`. Apply migration → regenerate Supabase types → build+deploy app → `NOTIFY pgrst, 'reload schema'` → smoke. Greg coordinates the window.

**Out of scope (do NOT touch in this phase):**

- A2 surcharge-recompute trigger (separate phase POL-85). The trigger relies on A1's columns existing first.
- Phase B `CutlistMaterialDialog`. The UI consumes the schema A1 lays down; A1 is purely DB + types + consumer migration.
- Phase D downstream-exception probe.
- Phase E settings admin UI.
- Phase F `MaterialAssignmentGrid` behaviour switch.

## Standing safety rails

1. **Wage-table safety** — A1's TS consumer updates touch `lib/piecework/cuttingPlanWorkPool.ts` which feeds piecework. Default to pure-helper unit tests; if you must inject into wage-flowing tables (`staff_piecework_earnings`, `staff_piecework_earning_entries`, `billoflabour pay_type='piece'`), prove cleanup in the same response with a verification query showing zero synthetic rows remain. Greg's payroll runs weekly on the live DB.
2. **Migration discipline** — every DDL change needs all four artifacts: file at `supabase/migrations/<timestamp>_<name>.sql` + `mcp__supabase__apply_migration` with matching name + `mcp__supabase__list_migrations` reconciliation + `docs/operations/migration-status.md` update.
3. **View drift check** — confirmed for this work: only `jobs_in_factory` and `factory_floor_status` read `order_details`, both with explicit-column SELECTs that don't reference `cutlist_snapshot` or any of the new columns. Re-verify via the spec's preflight findings if you change scope.
4. **`is_org_member()` RLS pattern** — `board_edging_pairs` follows the standard 4-policy posture (SELECT/INSERT/UPDATE/DELETE all gated on `is_org_member(org_id)`). Composite FKs on `(component_id, org_id)` close cross-tenant leakage at the schema layer.
5. **Pre-PR self-check** — before opening the PR, run `git diff origin/codex/integration --stat`. Stop and surface if the diff shows broad unrelated deletions or files outside the expected surface area (this is the Cloud-stale-base bug class).

## Decision Points (STOP and surface to Greg)

- `components` already has a UNIQUE that conflicts with the new `(component_id, org_id)` constraint
- Out-of-band consumer of `cutlist_snapshot` (TS or SQL) not in spec §Snapshot Consumers
- Backfill drift > 5% of orders with > 30% override-count percentage (signals misclassified primary heuristic)
- Unknown `board_type` value in `product_cutlist_groups.board_type` not in `{'16mm', '32mm-both', '32mm-backer'}`
- Composite FK addition fails on existing data (duplicate `(component_id, org_id)` rows)
- Edging-loss validation returns any rows (no edged part with a board assignment may lose its effective edging across the backfill)
- A consumer not in the audit table is discovered during implementation

## Verification Commands

```bash
# All
npm run lint
npx tsc --noEmit

# Migration discipline
mcp__supabase__list_migrations  # reconciles against supabase/migrations/

# Security advisors
mcp__supabase__get_advisors --type security  # must be clean

# Unit tests for the touched lib code
npx vitest run lib/orders/build-cutlist-snapshot lib/orders/edging-computation lib/orders/cutlist-surcharge lib/piecework/cuttingPlanWorkPool

# Backfill parity (sample)
mcp__supabase__execute_sql "
WITH sample AS (
  SELECT order_id FROM orders ORDER BY created_at DESC LIMIT 10
)
SELECT
  s.order_id,
  (SELECT COUNT(*) FROM order_details od WHERE od.order_id = s.order_id AND od.cutlist_primary_material_id IS NOT NULL) AS lines_with_primary,
  (SELECT COUNT(*) FROM order_details od WHERE od.order_id = s.order_id AND jsonb_array_length(od.cutlist_part_overrides) > 0) AS lines_with_overrides
FROM sample s
"

# Edging-loss validation (per spec §A1-BF1a, run after backfill)
# Should return zero rows.
```

Browser smoke is **not** required for A1 — A1 is schema + consumer migration with no new UI surface. The reviewer (Claude) will run a regression smoke on existing flows (open an existing order's cutting plan tab, confirm 200 + correct render after the rename) as part of PR review.

## Rollback / Release Notes

- Migrations reversible: drop new columns, drop new tables, restore prior types/builders from migration history
- Column rename `cutlist_snapshot` → `cutlist_material_snapshot` is reversible by `ALTER TABLE order_details RENAME COLUMN cutlist_material_snapshot TO cutlist_snapshot` IF the app deployment that depends on the new name has been rolled back first
- COALESCE fallback in consumers means existing snapshots without `effective_*` continue working
- Backfill is data-only and re-runnable. Rolling back the schema also rolls back the backfill.

## Documentation Requirements

- `docs/operations/migration-status.md` — update with the A1 migration files + maintenance-window runbook (per A1-D5)
- `docs/superpowers/specs/2026-04-29-cutlist-material-swap-and-surcharge-design.md` — do NOT modify the spec body during implementation; if you find spec ambiguity, surface it as a decision point and ask Greg

## Closing the loop

When done, post a delivery comment on POL-84 in Linear:
- Link to the PR
- Summary of what landed
- Verification command outputs (lint clean, tsc clean, advisors clean, migration list reconciled, backfill drift report)
- Anything that surfaced as STOP-and-ask, with how Greg resolved it
- Any deviations from the spec, justified

Then move POL-84 status from `In Progress` → `In Review`. Claude reviews the diff against `origin/codex/integration`, re-runs the verification commands, runs a regression smoke, and merges if no guardrail trips. Sign-off is required for A1 (RLS + tenant FKs + backfill + column rename), so Claude pings Greg for the final approval before merge.

If you hit a guardrail (migration breaks, backfill drift surfaces, RLS advisor fires) — STOP, post the failure to POL-84, and wait. Do not work around guardrails.
