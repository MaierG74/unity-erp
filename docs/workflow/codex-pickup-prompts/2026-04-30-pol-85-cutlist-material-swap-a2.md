# Codex Desktop pickup prompt — POL-85 (Phase A2)

**Paste everything below the divider into Codex CLI on Greg's local desktop.**

---

LOCAL DESKTOP ONLY. Do NOT run this in Codex Cloud or any remote agent — Cloud branches off `main`, not `codex/integration`, and produces stale-base divergence (this work depends on the post-POL-84 state on `codex/integration`). If you read this and you are running in a Cloud environment, STOP and tell Greg.

You are picking up Phase A2 of the Cutlist Material Swap & Surcharge feature (Linear POL-85, parent POL-83). Phase A1 (POL-84) merged as `b591da5` on 2026-04-30 — A2 builds on A1's schema. **A1's migration is committed but NOT yet applied to the live DB** (deferred to a maintenance window that runs A1+A2 together). Plan accordingly: A2's migration + tests must work against the not-yet-applied A1 schema.

## Read these first

1. **Linear issue POL-85** — full ACs + scope. Use `mcp__linear__get_issue POL-85`.
2. **Spec** — `docs/superpowers/specs/2026-04-29-cutlist-material-swap-and-surcharge-design.md` on `codex/integration`. Phase A2 ACs are in §"Phase A2 — Surcharge recompute trigger + backfill". Spec is authoritative; this prompt summarises but does not replace it.
3. **POL-84's PR (#52)** — the merged migration `supabase/migrations/20260429190000_cutlist_material_swap_a1_schema.sql` defines the columns A2's trigger references. Read it.
4. **POL-71 spec** at `docs/plans/2026-04-28-product-swap-and-surcharge.md` — POL-71's A2 introduced an order-totals trigger; this work mirrors that pattern.

## Branch + base

- **Base:** fresh fetch from `origin/codex/integration` — `b591da5` or later. Never branch from local `codex/integration`.
- **Work branch:** `codex/local-pol-85-cutlist-a2`
- **Worktree:** `/Users/gregorymaier/developer/unity-erp-pol-85` (separate from existing worktrees)

## Scope (Phase A2 ONLY — do NOT bleed into B/C/D/E/F)

**In scope:**

1. **New migration** at `supabase/migrations/<timestamp>_cutlist_material_swap_a2_trigger.sql` — must sort AFTER A1's `20260429190000_cutlist_material_swap_a1_schema.sql`. Single migration is fine; idempotent (`create or replace`, `drop trigger if exists` etc.) per A1's pattern.

2. **PL/pgSQL helper functions** (both `IMMUTABLE`, both `SET search_path = ''` per the lint-clean rule from POL-84 review):
   - `public.compute_cutlist_surcharge(p_kind text, p_value numeric, p_quantity numeric, p_unit_price numeric) RETURNS numeric` — branches on kind:
     - `'percentage'` → `ROUND(COALESCE(p_unit_price, 0) * COALESCE(p_quantity, 0) * COALESCE(p_value, 0) / 100, 2)`
     - `'fixed'` (or anything else) → `ROUND(COALESCE(p_value, 0) * COALESCE(p_quantity, 0), 2)`
   - `public.compute_bom_snapshot_surcharge_total(p_snapshot jsonb, p_quantity numeric) RETURNS numeric` — sums per-row `surcharge_amount` from JSONB array × quantity. Returns 0 when snapshot is NULL or not an array. See spec §7 for the exact body.

3. **BEFORE INSERT/UPDATE triggers** on both `order_details` and `quote_items`:
   - Trigger function recomputes `NEW.cutlist_surcharge_resolved` and `NEW.surcharge_total` from the row's columns
   - **`UPDATE OF` column list MUST include the output columns themselves** (`surcharge_total, cutlist_surcharge_resolved`) so direct PATCH writes still fire the recompute. Per spec §7 trigger DDL.
   - For `order_details`: column is `quantity`. For `quote_items`: column is `qty`. Two separate trigger functions; same logic; different column references.

4. **Three-step backfill** in the same migration (per spec §Backfill (Phase A2)):
   - **Step 1 — preflight temp tables** `a2_backfill_preflight_orders` and `a2_backfill_preflight_quotes` capturing `(old_surcharge_total, old_cutlist_resolved, new_surcharge_total, new_cutlist_resolved)` per row
   - **Step 2 — drift report**: SELECT count of rows where `ABS(new − old) > 0.01`, plus the worst 20 offenders by absolute drift. **RAISE EXCEPTION if drift > 5% of rows OR any single row drifts > R100** (so the migration aborts and Greg/I can reconcile)
   - **Step 3 — apply**: `UPDATE order_details SET quantity = quantity` and `UPDATE quote_items SET qty = qty` to fire triggers row-by-row
   - **Step 4 — parity check**: post-apply query against the temp tables, RAISE EXCEPTION if any row drifts > R0.01. Zero violations expected.

5. **API-layer defense-in-depth** (per spec §Defense-in-depth at the API layer + round-3 BLOCKER fix):
   - In `app/api/order-details/[detailId]/route.ts` PATCH and any quote-item PATCH route: when the request body contains `surcharge_total` or `cutlist_surcharge_resolved`, **log a warning** with the caller info (e.g. `console.warn('[PATCH] derived field write detected', {field, value, callerInfo})`), then **pass the value through to the DB unchanged**. Do NOT strip — stripping would convert PATCH to "no fields to update" and the existing route returns 400, masking the trigger.
   - The trigger then overwrites it pre-commit. The API layer is observability, not enforcement.
   - Mark `surcharge_total` and `cutlist_surcharge_resolved` as `readonly` in the relevant TypeScript types in `types/orders.ts` (compile-time discouragement; runtime API doesn't reject).

6. **TS helper update**: `lib/orders/cutlist-surcharge.ts` — update `resolveCutlistSurcharge` body to mirror SQL `compute_cutlist_surcharge` exactly. Per spec §App-side helper:
   - COALESCE every input to 0 if null/undefined/empty/NaN
   - Percentage branch: `Math.round((unit_price ?? 0) * (qty ?? 0) * (value ?? 0)) / 100`
   - Fixed branch: `Math.round((value ?? 0) * (qty ?? 0) * 100) / 100`
   - Sign-aware rounding for negatives — match Postgres ROUND default (half-away-from-zero). If the cheap `Math.round(x*100)/100` doesn't match Postgres for negatives, use `Math.sign(x) * Math.round(Math.abs(x) * 100) / 100`.

7. **Tests**:
   - **A1-V1a parity (DB↔TS numeric):** `tests/cutlist-surcharge-parity.test.ts` (new file). For each of the fixtures below, call BOTH the TS helper and the SQL helper via `mcp__supabase__execute_sql` (using a Supabase branch DB or transaction-rolled-back SELECT against the helper) and assert results match to the cent:
     - fixed positive: `(kind='fixed', value=200, qty=3, unit_price=any)` → 600
     - fixed negative: `(kind='fixed', value=-100, qty=2, unit_price=any)` → -200
     - fixed zero: `(kind='fixed', value=0, qty=any, unit_price=any)` → 0
     - percentage 0%: `(kind='percentage', value=0, qty=any, unit_price=any)` → 0
     - percentage 7%: `(kind='percentage', value=7, qty=2, unit_price=1000)` → 140
     - percentage 100%: `(kind='percentage', value=100, qty=2, unit_price=500)` → 1000
     - percentage with unit_price=0: `(kind='percentage', value=15, qty=3, unit_price=0)` → 0
     - percentage with quantity=0: `(kind='percentage', value=15, qty=0, unit_price=2000)` → 0
     - decimal unit_price: `(kind='percentage', value=15, qty=1, unit_price=1234.56)` → 185.18 (round-half-away-from-zero)
     - NULL value: `(kind='percentage', value=NULL, qty=2, unit_price=1000)` → 0
   - **A1-V1b TS/API normalization:**
     - **Layer 1 (TS-only):** TS helper handles `''` (empty string) for `value` → returns 0
     - **Layer 2 (route-level):** integration test that sends `PATCH /api/order-details/[id] { cutlist_surcharge_value: '' }` → asserts route validator coerces to NULL before DB → DB trigger sees NULL, returns 0
   - **A2-V1 trigger fixtures:**
     - INSERT with cutlist surcharge fixed → `cutlist_surcharge_resolved` and `surcharge_total` correct on read-back
     - INSERT with cutlist surcharge percentage → both correct
     - UPDATE qty alone → trigger recomputes both
     - UPDATE unit_price alone → percentage surcharge recomputes
     - UPDATE bom_snapshot to add a per-row surcharge → `surcharge_total` reflects it
     - UPDATE neither qty/unit_price/snapshot/cutlist_surcharge_*/derived → no spurious trigger fires (verify via `pg_stat_user_functions` or explicit no-change observation)
   - **A2-V5 PATCH-bypass test:** integration test sends `PATCH { surcharge_total: 999 }` with no other field changed. Asserts (a) returns 200, (b) trigger fires, (c) response carries the recomputed value (not 999), (d) server log captured a warning. Second test: `PATCH { quantity: 5 }` (no derived field) — no warning logged, trigger fires, recomputes against new qty.

8. **Tests must NOT inject synthetic rows into wage tables.** A2's surface doesn't directly touch piecework, but if you add fixtures to `order_details` or `quote_items`, do it via test-only orgs/orders or transaction-rolled-back fixtures. **Default to pure-helper tests** for the parity check; reserve live-row writes for the trigger smoke. Always cleanup if you wrote anything.

9. **Maintenance-window deployment plan extension** in `docs/operations/migration-status.md`: A2 deploys in the SAME window as A1, ordered second. Document the order. Cascading writes to `orders.total_amount` via POL-71's AFTER trigger are expected for every touched `order_details` row.

**Out of scope (do NOT touch in this phase):**

- Phase B `CutlistMaterialDialog` UI
- Phase C quote-side wiring + PDF
- Phase D downstream-exception probe
- Phase E settings admin
- Phase F `MaterialAssignmentGrid` behaviour switch
- Modifying A1's already-merged migration (A1 is `Done` — A2 is additive)
- Removing or modifying POL-71's order-totals AFTER trigger

## Standing safety rails

1. **Wage-table safety** — see scope item #8.
2. **Migration discipline** — A2 needs all four artifacts: file at `supabase/migrations/<timestamp>_<name>.sql` + `mcp__supabase__apply_migration` (defer to maintenance window if applying locally is blocked) + `mcp__supabase__list_migrations` reconciliation + `docs/operations/migration-status.md` update.
3. **`SET search_path = ''` on every new function** — POL-84 review caught one missing instance and required a fix. Don't repeat.
4. **`is_org_member()` RLS pattern** — A2 doesn't add new tables, but if you add any helper function with row-level access, follow the standard pattern.
5. **Pre-PR self-check** — before opening the PR, run `git diff origin/codex/integration --stat`. Stop and surface if the diff shows broad unrelated deletions (Cloud-stale-base bug class).
6. **Trigger ordering caveat** — POL-71's `order_details_total_update_trigger` is AFTER. A2's `order_details_recompute_surcharge_total` is BEFORE. They run in this order: BEFORE recompute fires first → row write happens with corrected `surcharge_total` → AFTER trigger sums the corrected value into `orders.total_amount`. No conflict. Verify trigger names sort sensibly: BEFORE-trigger names usually need to come alphabetically before the AFTER-trigger names if the same timing existed, but here the timings differ so order doesn't matter.

## Decision Points (STOP and surface to Greg)

- A2 backfill drift report shows > 5% of rows with drift > R0.01, OR any single row drifts > R100. The migration aborts via RAISE EXCEPTION; do not "fix" by lowering the threshold — surface to Greg for reconciliation
- TS↔SQL parity test fails on any fixture (rounding mismatch, NULL handling drift, sign-aware drift). This is a BLOCKER per spec §A1-V1a
- Trigger introduces SECURITY DEFINER concerns (verify via `pg_proc` query that helper functions are SECURITY INVOKER, not DEFINER, since they don't read protected data)
- Application code is discovered that reads the synchronous return of `surcharge_total` after a mutation expecting an app-side increment to have already updated it (semantics change with trigger; per A2-DP2 in spec)
- Any new SECURITY DEFINER function must explicitly justify it AND include `SET search_path = ''`
- Trigger fires in a recursive loop (verify with a stress test)
- Backfill maintenance-window writes overwhelm `orders.total_amount` via POL-71's AFTER trigger — if the cascade looks dangerous on the order count we have, batch the UPDATE or document the expected runtime

## Verification Commands

```bash
# All
npm run lint
npx tsc --noEmit  # filtered as in A1; flag any NEW POL-85 errors

# Migration
mcp__supabase__list_migrations  # reconciles after committing the migration file (whether or not applied locally)

# Unit tests (TS-only paths)
npx vitest run lib/orders/cutlist-surcharge tests/cutlist-surcharge-parity tests/order-detail-patch-derived

# Trigger smoke (requires migration applied to a Supabase branch DB OR local dev DB; defer to maintenance window if local apply is blocked)
mcp__supabase__execute_sql "SELECT compute_cutlist_surcharge('percentage', 7, 2, 1000) AS expect_140"
# expect 140.00

# A1-V1a parity (run all fixtures via mcp__supabase__execute_sql; assert TS helper produces matching numbers)

# Pre-PR diff check
git diff origin/codex/integration --stat
```

If `mcp__supabase__execute_sql` is unauthorized for advisors only (per the POL-84 finding), it's still authorized for `compute_*` function calls. Use `supabase_kinetic` if the default Supabase MCP requires OAuth.

If applying the migration to a Supabase branch DB is blocked, document A1-V1a parity as **deferred to reviewer's maintenance-window pass** — same pattern POL-84 used for advisors. Reviewer (Claude) runs the parity fixtures from Claude Code's HTTP MCP session post-deploy.

Browser smoke for A2-V4 (edit qty via PATCH route, total updates via trigger): **deferred to reviewer's maintenance-window pass**, since the trigger only fires on the deployed DB.

## Rollback / Release Notes

- Migration is reversible: `DROP TRIGGER ... ON order_details`, `DROP TRIGGER ... ON quote_items`, `DROP FUNCTION ...` (each function and trigger has a clean drop path)
- Without the trigger, `surcharge_total` reverts to whatever app-side writers were doing before. POL-84 didn't add app-side writers, so values would silently drift on qty/price changes. Document this in the rollback runbook.
- Backfill is data-only and idempotent. Rolling back A2 doesn't roll back the data corrections — those values stay correct because they were recomputed against the pre-trigger state.

## Documentation Requirements

- `docs/operations/migration-status.md` — add the A2 migration entry; update the maintenance-window runbook to reflect A1+A2 ordered apply
- Don't modify the spec body; if you find spec ambiguity, surface as a decision point

## Closing the loop

When done, post a delivery comment on POL-85 with:
1. PR link
2. Verification command outputs (lint clean, tsc-filtered clean, vitest pass)
3. Any A1-V1a / A2-V4 deferrals if local migration apply was blocked, with explicit "reviewer runs in maintenance window" framing
4. Any STOP-and-ask items that surfaced
5. Any deviations from the spec, justified
6. Move POL-85 → `In Review`

Sign-off is required for A2 (trigger introduction is a behaviour change). Claude reviews diff against `origin/codex/integration`, re-runs verification, posts review on POL-85, pings Greg for approval before merge.

If you hit a guardrail (drift > threshold, parity test fails, RLS advisor concern) — STOP, post the failure to POL-85, and wait. Do not work around guardrails.
