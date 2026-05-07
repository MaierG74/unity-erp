# Job Card Drawings — Audit Findings Fix


## Purpose / Big Picture


The job-card-drawings feature shipped on `codex/local-job-card-drawings-spec` snapshots a drawing URL into `job_card_items.drawing_url` only when issuance flows through `issue_job_card_from_pool()` and the PDF is rendered through `JobCardPDFDownload` with the explicit `drawingUrl` prop. Phase 1 audit (`docs/audits/2026-05-07-job-card-drawings-audit.md`, commit `0129d92`) found six live coverage gaps that defeat the snapshot or render in real workflows: two issuance fallbacks in the labor-planning board, a stale source-item select, a manual-creation path, the auto-print path on the staff job-card page, and the scheduler queries that omit `drawing_url` from their item shape. After this lands, every observable workflow that creates or prints a job card resolves and renders the drawing — drag-and-drop scheduler issuance, manual job-card creation, the order-page Issue Card button, and both the explicit Download/Print buttons and the auto-print path on the staff page.


## Progress


- [x] Done 2026-05-07T09:21:08+02:00 - Add a Postgres helper `resolve_job_card_drawing(p_order_detail_id BIGINT, p_bol_id INTEGER, p_product_id INTEGER) RETURNS TEXT` that encapsulates the 3-tier resolve order; refactor `issue_job_card_from_pool` to use it (DRY, single source of truth)
- [x] Done 2026-05-07T09:22:03+02:00 - Extend `lib/queries/laborPlanning.ts` types and selects (lines 850, 898) so scheduler item rows carry `drawing_url` and `work_pool_id` end-to-end
- [x] Done 2026-05-07T09:22:30+02:00 - Extend the source-item select inside `components/labor-planning/staff-lane-list.tsx:405` to include `work_pool_id` and `drawing_url` so the "move existing item" branch (line 476) actually preserves a snapshot when one exists
- [x] Done 2026-05-07T09:24:29+02:00 - Fix the scheduler split-fallback insert at `components/labor-planning/staff-lane-list.tsx:456` to call `resolve_job_card_drawing` and include both `work_pool_id` and `drawing_url` in the INSERT
- [x] Done 2026-05-07T09:24:29+02:00 - Fix the scheduler fresh-fallback insert at `components/labor-planning/staff-lane-list.tsx:493` the same way
- [x] Done 2026-05-07T09:25:10+02:00 - Fix the manual new-card creation at `app/staff/job-cards/new/page.tsx:210` to call `resolve_job_card_drawing` for each row and include `drawing_url` in the INSERT (`work_pool_id` stays null — manual cards aren't pool-derived)
- [x] Done 2026-05-07T09:25:31+02:00 - Fix the staff-page auto-print path at `app/staff/job-cards/[id]/page.tsx:556` to forward `drawing_url` per item and `drawingUrl` at the top level into `openJobCardPrintWindow`
- [ ] Blocked 2026-05-07T09:32:45+02:00 - Browser-smoke each affected user path (drag-drop scheduler issuance, manual new card, order-page Issue Card, explicit Download, auto-print) end-to-end and clean up every synthetic test row. Reason: production has no safe remaining configured-drawing pool to issue without overissue, and no synthetic browser mutations were created; targeted question: should Phase 2 create a dedicated disposable order/product/pool fixture for full mutating browser smoke?
- [x] Done 2026-05-07T09:32:45+02:00 - Run `npm run lint` and `npx tsc --noEmit` — no new failures attributable to touched files


## Surprises & Discoveries


- 2026-05-07T09:18:27+02:00 - The `mcp__supabase_unity__` server is still unauthorized in this local session, but the Codex Supabase app connector is authorized for project `ttlyfhkrsjjrzxiagzpb`; DB migration and verification steps use that connector.
- 2026-05-07T09:18:27+02:00 - The manual new-card requirement needs product-only resolution when `p_bol_id` is null, so `resolve_job_card_drawing` includes a product fallback that chooses an eligible BOL row for that product.
- 2026-05-07T09:21:08+02:00 - Production currently has one non-cancelled pool with a configured drawing, but it is fully issued (`pool_id=66`, required 1, issued 1), so rollback-only overissue smoke was attempted instead of creating persistent test rows.
- 2026-05-07T09:22:03+02:00 - This fresh worktree has no installed `node_modules`; `npx tsc --noEmit` resolves to the external `tsc` placeholder and `pnpm exec tsc --noEmit` cannot find `tsc`. Dependency installation is needed before final validation.
- 2026-05-07T09:32:45+02:00 - The fresh worktree also had no `.env.local`; copying the machine-local `.env.local` from the sibling checkout without printing secrets unblocked the local browser smoke.
- 2026-05-07T09:32:45+02:00 - `npx tsc --noEmit` still reports repo-wide pre-existing errors, but after the narrow fixes there are no errors in touched files.


## Decision Log


- 2026-05-07T09:18:27+02:00 - Keep the helper as the single resolver for both pool and manual direct-insert paths; product-only fallback is in SQL, not duplicated in TS.


## Outcomes & Retrospective


Partial but shippable implementation: SQL helper/refactor and all planned code paths are implemented and committed. Lint passes with existing image warnings, the drawing unit tests pass 9/9, SQL helper/RPC sanity checks pass, and browser smoke verified the staff-page auto-print PDF renders the Reference Drawing. Full mutating browser smoke for scheduler drag-drop/order Issue Card/manual new-card creation remains blocked pending a disposable fixture or explicit approval to create and clean production-like test rows.


## Context and Orientation


This work runs in the worktree `/Users/gregorymaier/developer/unity-erp-drawings-audit` on branch `codex/local-job-card-drawings-spec` at commit `0129d92` (the audit commit, on top of the drawings feature commits). **Do not work in the main `unity-erp` checkout** — parallel sessions have been switching its branch and the dev server is unreliable as a result. Do not run `git checkout`, `git switch`, `git rebase`, or `git pull` during this work.

The drawings feature design lives at `docs/superpowers/specs/2026-05-06-bol-job-card-drawings-design.md`. The original implementation ExecPlan at `docs/plans/2026-05-06-bol-job-card-drawings.md`. The Phase 1 audit at `docs/audits/2026-05-07-job-card-drawings-audit.md` enumerates every callsite involved.

**Three-tier resolve, recap.** When a job card is issued, the drawing URL is determined by walking these tiers in order; the first hit wins:

1. **Order-line override** — `order_detail_drawings.drawing_url` for the matching `(order_detail_id, bol_id)`
2. **BOL manual upload** — `billoflabour.drawing_url`
3. **Product configurator drawing** — `products.configurator_drawing_url`, **only if** `billoflabour.use_product_drawing = true`

If all tiers miss, the URL is `NULL` and no Reference Drawing renders on the printed PDF. The resolved URL is **snapshotted** into `job_card_items.drawing_url` at issuance — already-issued cards are pixel-stable even after the underlying source is later edited (UUID storage paths reinforce this).

**Live DB state.** The deployed `issue_job_card_from_pool` (verified via `pg_proc.prosrc`: tier-1 reference present, tier-3 gate present, tier-3 lookup present, INSERT includes both `work_pool_id` and `drawing_url`, body length 4053). Schema migrations `20260506095317 bol_drawing_columns` and `20260506095347 issue_job_card_drawing_resolve` are applied to project `ttlyfhkrsjjrzxiagzpb`. The new helper migration this plan adds will be the third drawings migration.

**Why a SQL helper instead of TS-side resolve in each path.** Two reasons. (a) Single source of truth — three issuance callsites would otherwise duplicate the 3-tier query and risk drift if the spec ever extends the chain. (b) Atomicity — the resolve runs inside the same transaction as the eventual INSERT, so we can't snapshot a URL that disappears mid-operation. Refactoring `issue_job_card_from_pool` to call the helper means one place to update the chain, ever.

**Tenancy.** The resolve queries cross `order_detail_drawings` (org-scoped via `is_org_member(org_id)` RLS), `billoflabour`, and `products`. The helper runs `SECURITY DEFINER` mirroring the existing `issue_job_card_from_pool` security model — it sees data inside the calling user's org because the original RPC already validates org membership before invoking it, and direct callers (manual creation, scheduler fallback) similarly already validate via `requireProductsAccess`/membership_member checks before calling.

**Test framework.** `node:test` + `node:assert/strict` via `npx tsx --test tests/<file>.test.ts`. Existing helpers under `tests/bol-drawings.test.ts`, `tests/capture-product-drawing.test.ts`, `tests/order-detail-drawings.test.ts`. New unit-level coverage should land alongside the helpers it tests; UI coverage is browser-smoke per CLAUDE.md.


## Plan of Work


Six logical phases. Phases 1-2 land the SQL helper and refactor the RPC (no behavior change to existing callers). Phases 3-5 fix each TS callsite in turn, each commit independently testable. Phase 6 is end-to-end browser smoke + lint/tsc + cleanup of any synthetic data inserted during smoke.

**Phase 1 — SQL helper + RPC refactor.** Create migration `supabase/migrations/<timestamp>_resolve_job_card_drawing_helper.sql` adding `resolve_job_card_drawing(p_order_detail_id BIGINT, p_bol_id INTEGER, p_product_id INTEGER) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`. Body walks the 3-tier chain using NULL-safe SQL: tier 1 (order_detail_drawings JOIN), tier 2 (billoflabour.drawing_url where bol_id matches and is non-null), tier 3 (products.configurator_drawing_url gated on billoflabour.use_product_drawing for the same bol_id). Returns the first non-null hit, or NULL. Grant EXECUTE to `authenticated`, REVOKE from `anon`, end with `NOTIFY pgrst, 'reload schema'`. Apply via `mcp__supabase__apply_migration` against project `ttlyfhkrsjjrzxiagzpb`. Then refactor `issue_job_card_from_pool` (in a second migration that does `CREATE OR REPLACE FUNCTION` for the same signature) to delete its inlined resolve query at lines 81-100 and call `resolve_job_card_drawing(v_pool.order_detail_id, v_pool.bol_id, v_pool.product_id)` instead. Behavioral parity with the deployed function: same args list, same INSERT, same exception-handling flow.

**Phase 2 — Scheduler item-row data flow.** In `lib/queries/laborPlanning.ts`, extend the row interface near line 850 (the scheduler `JobCardItemRow` type) to include `drawing_url: string | null` and ensure `work_pool_id: number | null` is also present. Update the supabase select around line 898 to include `drawing_url, work_pool_id`. This is plumbing — no behavior change yet. After this, downstream scheduler code that loads scheduler items has the snapshot field available end-to-end.

**Phase 3 — Scheduler source-item select fix.** In `components/labor-planning/staff-lane-list.tsx`, extend the source-item select at line 405 (`from('job_card_items').select(...)`) to include `work_pool_id` and `drawing_url`. Update the local `SourceItem` type near line 384 with both fields. The "move existing item" branch at line 476 — `update({ job_card_id: jobCardData.job_card_id })` — already preserves whatever fields the row has, so no further change there. The decremented source-item update at lines 451-454 likewise preserves the existing row's drawing.

**Phase 4 — Scheduler fallback inserts.** Both fallback inserts in `staff-lane-list.tsx` (lines 456 and 493) currently insert `job_card_items` with `{ job_card_id, product_id, job_id, quantity, piece_rate, status }`. Resolve the drawing via the new RPC before each INSERT and include both `work_pool_id` and `drawing_url` in the payload.

For the split branch (line 456): if `sourceItem.drawing_url` is set, prefer it (the source row was already snapshotted — keep the same URL on the new split). Otherwise, call `supabase.rpc('resolve_job_card_drawing', { p_order_detail_id, p_bol_id, p_product_id })` with whatever IDs are in scope from `selectedAssignment` and BOL lookup at line 355. Pass `work_pool_id` from `selectedAssignment.poolId` if available (the audit confirmed scheduler item types didn't carry it; Phase 2 fixes that).

For the fresh branch (line 493): always call the resolver. Pass `work_pool_id` from selected-assignment context if non-null.

Both inserts: drawing_url is allowed to be null (resolver returns null when nothing matches) — that's the correct "no drawing configured" outcome and shouldn't error.

**Phase 5 — Manual new-card form + auto-print path.** Two small edits in different files.

In `app/staff/job-cards/new/page.tsx`, between the form-row collection and the bulk INSERT at line 210, call `resolve_job_card_drawing(p_order_detail_id => null, p_bol_id => null, p_product_id => row.product_id)` for each row and attach the resolved URL to the row payload. With no order_detail_id and no bol_id, the resolver will only return a non-null result for products that have BOTH a `use_product_drawing`-flagged BOL row AND a `configurator_drawing_url` — which is rare for manually-created cards but architecturally consistent. Manual cards still don't get `work_pool_id` (they're not pool-derived).

In `app/staff/job-cards/[id]/page.tsx:556`, the auto-print call to `openJobCardPrintWindow` currently maps items at lines 570-578 without `drawing_url` and passes no top-level `drawingUrl`. Mirror the explicit-download mapping at lines 746-758 of the same file: include `drawing_url: item.drawing_url` per item and pass `drawingUrl={items.find((item) => item.drawing_url)?.drawing_url ?? null}`.

**Phase 6 — Verification.** Run lint + tsc + tests, then a Chrome MCP browser smoke covering each affected path. Cleanup is non-negotiable per CLAUDE.md memory — synthetic rows in payroll-relevant tables have leaked into past payroll runs.


## Concrete Steps


1. **Working tree sanity.** Run `git status --short` (expect empty) and `git branch --show-current` (expect `codex/local-job-card-drawings-spec`). If either is wrong, stop. Run `git log --oneline -5` and confirm the top commit is `0129d92 docs(audit): job card drawings — issuance, PDF render, data flow`.
2. **Phase 1 — helper migration.** Create `supabase/migrations/20260507120000_resolve_job_card_drawing_helper.sql` per the contract in Interfaces and Dependencies. Apply via `mcp__supabase__apply_migration({ project_id: "ttlyfhkrsjjrzxiagzpb", name: "resolve_job_card_drawing_helper", query: <SQL> })`. Verify with `mcp__supabase__execute_sql`: a sanity test that `SELECT resolve_job_card_drawing(NULL, <existing_bol_id_with_drawing>, <product_id>)` returns the BOL drawing URL. Commit: `feat(db): add resolve_job_card_drawing helper for 3-tier chain`.
3. **Phase 1 — RPC refactor.** Create `supabase/migrations/20260507121000_issue_job_card_use_resolver.sql` containing a `CREATE OR REPLACE FUNCTION` for `issue_job_card_from_pool` with the same signature `(p_pool_id INTEGER, p_quantity INTEGER, p_staff_id INTEGER DEFAULT NULL, p_allow_overissue BOOLEAN DEFAULT FALSE, p_override_reason TEXT DEFAULT NULL) RETURNS INTEGER`, replacing the inlined resolve at lines 81-100 of the deployed body with a single `v_drawing_url := resolve_job_card_drawing(v_pool.order_detail_id, v_pool.bol_id, v_pool.product_id);` call. Preserve every other line of the function body verbatim — locking, validation, exception generation, INSERTs. Apply via MCP. Verify by issuing one test card from a pool row that has a configured BOL drawing and confirming `job_card_items.drawing_url` is set. Roll back the test card. Commit: `refactor(db): issue_job_card_from_pool delegates resolve to helper`.
4. **Phase 2 — scheduler types & queries.** Modify `lib/queries/laborPlanning.ts` per Plan of Work. Run `npx tsc --noEmit` filtered on touched files; expect no new errors. Commit: `feat(scheduler): include drawing_url and work_pool_id on item rows`.
5. **Phase 3 — source-item select.** Modify `components/labor-planning/staff-lane-list.tsx` source select at line 405 and `SourceItem` type. Run typecheck. Commit: `fix(scheduler): preserve drawing_url and work_pool_id on item move`.
6. **Phase 4 — fallback inserts.** Modify both fallback INSERT branches in `staff-lane-list.tsx`. Each insert includes resolver call, work_pool_id, and drawing_url. Run typecheck. Commit: `fix(scheduler): resolve and snapshot drawings on fallback issuance`.
7. **Phase 5a — manual new-card.** Modify `app/staff/job-cards/new/page.tsx` per Plan of Work. Run typecheck. Commit: `fix(job-cards): resolve drawing on manual new-card creation`.
8. **Phase 5b — staff-page auto-print.** Modify `app/staff/job-cards/[id]/page.tsx:556`. Run typecheck. Commit: `fix(staff-card-pdf): forward drawing through auto-print path`.
9. **Phase 6 — repo-wide checks.** Run `npm run lint` and `npx tsc --noEmit`. Capture full output. Tolerate pre-existing failures unrelated to this work; report any NEW failures and fix them before proceeding.
10. **Phase 6 — browser smoke.** Use the dev server in this worktree. Walk through each path in Validation and Acceptance. Capture screenshots/transcripts. Clean up every synthetic row inserted during smoke — verify zero remain.
11. **Wrap-up.** Run `/simplify` if more than 3 files were modified. Push the branch: `git push origin codex/local-job-card-drawings-spec`. Report status and the appended Progress checklist.


## Validation and Acceptance


All paths use the test account `testai@qbutton.co.za` / `ClaudeTest2026!` / org QButton, on a product with `configurator_drawing_url` populated AND a BOL row whose `Drawing source` is set to *Use product drawing* (or *Upload custom* with a real PNG attached) so the resolver has something to return.

**Path α — RPC + helper sanity (SQL only).** `SELECT resolve_job_card_drawing(NULL, <bol_id>, <product_id>)` returns the BOL drawing URL when `billoflabour.drawing_url` is set; returns the configurator URL when `use_product_drawing = true` and the manual upload is null; returns the override URL when an `order_detail_drawings` row matches. NULL when none match.

**Path β — order-page Issue Card (regression check).** Click Issue Card in the order's Job Cards tab. The new card has `drawing_url` set in `job_card_items`. The explicit Download PDF button on the card detail page renders the Reference Drawing between the items table and the work-log section. *(Existing behavior — must not regress.)*

**Path γ — scheduler drag-and-drop.** On the labor planning board, drag a configured-drawing pool row into a staff lane. The card created via the fallback branch now has `work_pool_id` AND `drawing_url` set. The PDF for that card renders the Reference Drawing.

**Path δ — manual new card.** Open the manual new-card page and create a card for a product whose BOL has a configured drawing. The card's `drawing_url` is set if the resolver returns a hit (typically only when the product has a `use_product_drawing`-flagged BOL row that the resolver can find via product_id). Otherwise NULL, which prints with no drawing — also acceptable.

**Path ε — staff page auto-print.** Open a card via a URL with `?print=1` (or however the auto-print path is triggered). The print preview includes the Reference Drawing.

**Final.** `npm run lint` exits with 0 errors and no new warnings on touched files. `npx tsc --noEmit` exits with no new errors on touched files. Existing tests pass: `npx tsx --test tests/bol-drawings.test.ts tests/capture-product-drawing.test.ts tests/order-detail-drawings.test.ts` reports 9/9 (no new tests added by this plan, but existing must not break). After smoke, `SELECT count(*) FROM order_detail_drawings WHERE uploaded_at > '<smoke_start>'` returns 0 (no synthetic overrides leaked); `SELECT count(*) FROM job_card_items WHERE drawing_url LIKE '%placehold%'` returns 0; any synthetic test cards issued during smoke are deleted.


## Idempotence and Recovery


**Migrations.** Both migrations use `CREATE OR REPLACE FUNCTION` so re-applying is safe. If a migration partially applies and is interrupted, re-running succeeds (DDL is transactional). Rollback for the helper: `DROP FUNCTION resolve_job_card_drawing(BIGINT, INTEGER, INTEGER);` and revert the RPC migration to its prior body via the existing `20260506121000_issue_job_card_drawing_resolve.sql`.

**TS edits.** Each edit is in one file, easy to revert via `git checkout -- <file>`. No cross-file coupling within a phase. The phase-by-phase commits make `git revert <sha>` clean.

**Browser-smoke synthetic data.** Every test row inserted must be deleted in the same session. Recovery for forgotten cleanup: query `job_cards WHERE issue_date::date = CURRENT_DATE AND staff_id = (SELECT staff_id FROM staff WHERE first_name = 'Remember' AND last_name = 'Khoza')` for cards on the test staff member, plus `order_detail_drawings WHERE uploaded_at > '<smoke_start>'` for overrides.

**RPC concurrent issuance.** The `FOR UPDATE` lock on `job_work_pool` is preserved through both migrations. No new race conditions introduced. The new helper is read-only (SELECT only), can be called from within other functions without lock implications.


## Artifacts and Notes


- 2026-05-07T09:18:27+02:00 - Added and applied `supabase/migrations/20260507120000_resolve_job_card_drawing_helper.sql`; SQL sanity check resolved BOL drawing URL for `bol_id=74`, `product_id=860` by both BOL and product-only calls.
- 2026-05-07T09:21:08+02:00 - Added and applied `supabase/migrations/20260507121000_issue_job_card_use_resolver.sql`; `pg_proc` verification shows `issue_job_card_from_pool` now references `resolve_job_card_drawing` before the `job_card_items` INSERT.
- 2026-05-07T09:22:03+02:00 - Updated `lib/queries/laborPlanning.ts` so scheduler `JobCardItemRow` selects and maps `drawing_url` alongside the existing `work_pool_id`.
- 2026-05-07T09:22:30+02:00 - Updated `components/labor-planning/staff-lane-list.tsx` `SourceItem` and source lookup select to include `work_pool_id` and `drawing_url`.
- 2026-05-07T09:24:29+02:00 - Updated scheduler split/fresh fallback inserts to snapshot `drawing_url` through `resolve_job_card_drawing` and insert `work_pool_id` from the source item or parsed pool key.
- 2026-05-07T09:25:10+02:00 - Updated `app/staff/job-cards/new/page.tsx` to resolve `drawing_url` per manual item before bulk inserting `job_card_items`.
- 2026-05-07T09:25:31+02:00 - Updated `app/staff/job-cards/[id]/page.tsx` auto-print mapping to pass `items[].drawing_url` and top-level `drawingUrl` into `openJobCardPrintWindow`.
- 2026-05-07T09:32:45+02:00 - Updated canonical BOL docs in `docs/operations/BOL_SYSTEM.md` to name `resolve_job_card_drawing` as the shared resolver and document direct fallback snapshot behavior.
- 2026-05-07T09:32:45+02:00 - Validation artifacts: `/tmp/job-card-drawings-npm-ci.txt`, `/tmp/job-card-drawings-lint-final.txt`, `/tmp/job-card-drawings-tsc-2.txt`, `/tmp/job-card-drawings-tests.txt`, `/tmp/job-card-drawings-dev-server-2.txt`.
- 2026-05-07T09:39:12+02:00 - Build artifact: `/tmp/job-card-drawings-build.txt`; `npm run build` completed successfully with Next.js production build output.
- 2026-05-07T09:32:45+02:00 - Browser smoke artifacts: `/production` Queue and Schedule tabs loaded, `/staff/job-cards/new` manual form loaded, `/orders/613?tab=job-cards` Job Cards tab loaded, `/staff/job-cards/54` card detail loaded, and `/staff/job-cards/54?print=1` opened a PDF blob whose screenshot showed `REFERENCE DRAWING` between Work Items and Work Log.
- 2026-05-07T09:32:45+02:00 - Cleanup SQL returned `new_order_detail_drawings=0`, `placeholder_drawing_items=0`, and `new_remember_khoza_cards=0` after smoke start.


## Interfaces and Dependencies


**New SQL helper.**

```sql
CREATE OR REPLACE FUNCTION public.resolve_job_card_drawing(
  p_order_detail_id BIGINT,
  p_bol_id INTEGER,
  p_product_id INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT;
BEGIN
  -- Tier 1: order-line override
  IF p_order_detail_id IS NOT NULL AND p_bol_id IS NOT NULL THEN
    SELECT drawing_url INTO v_url
    FROM order_detail_drawings
    WHERE order_detail_id = p_order_detail_id
      AND bol_id = p_bol_id;
    IF v_url IS NOT NULL THEN RETURN v_url; END IF;
  END IF;

  -- Tier 2 + 3: BOL upload, then product configurator (gated by use_product_drawing)
  IF p_bol_id IS NOT NULL THEN
    SELECT
      CASE
        WHEN bl.drawing_url IS NOT NULL THEN bl.drawing_url
        WHEN bl.use_product_drawing AND p_product_id IS NOT NULL THEN p.configurator_drawing_url
        ELSE NULL
      END
    INTO v_url
    FROM billoflabour bl
    LEFT JOIN products p ON p.product_id = p_product_id
    WHERE bl.bol_id = p_bol_id;
  END IF;

  RETURN v_url;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_job_card_drawing(BIGINT, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_job_card_drawing(BIGINT, INTEGER, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';
```

**RPC refactor.** The new `issue_job_card_from_pool` body keeps every existing line except the resolve block (lines 81-100 of the deployed body, the two `SELECT ... INTO v_drawing_url` blocks). Replace those with:

```sql
v_drawing_url := resolve_job_card_drawing(
  v_pool.order_detail_id,
  v_pool.bol_id,
  v_pool.product_id
);
```

Everything else — the FOR UPDATE lock, validation, exception generation, INSERT INTO job_cards, INSERT INTO job_card_items (with `work_pool_id` and `drawing_url`), exception upserts/resolves — stays verbatim. Same signature: `(p_pool_id INTEGER, p_quantity INTEGER, p_staff_id INTEGER DEFAULT NULL, p_allow_overissue BOOLEAN DEFAULT FALSE, p_override_reason TEXT DEFAULT NULL) RETURNS INTEGER`.

**TS type extensions in `lib/queries/laborPlanning.ts`.**

```ts
// JobCardItemRow type extended:
interface JobCardItemRow {
  // ... existing fields ...
  work_pool_id: number | null;   // possibly already present, ensure
  drawing_url: string | null;     // NEW
}
```

Selects against `job_card_items` that feed scheduler item rows must include `work_pool_id, drawing_url` in the column list (or use `*`).

**TS type extensions in `components/labor-planning/staff-lane-list.tsx`.**

```ts
type SourceItem = {
  item_id: number;
  job_card_id: number;
  quantity: number;
  piece_rate: number | null;
  product_id: number | null;
  card_staff_id: number | null;
  work_pool_id: number | null;   // NEW
  drawing_url: string | null;    // NEW
};
```

The select at line 405 must explicitly include both new columns.

**TS resolver call shape.**

In TS code that creates `job_card_items` outside the RPC:

```ts
const { data: drawingUrl } = await supabase.rpc('resolve_job_card_drawing', {
  p_order_detail_id: orderDetailId ?? null,
  p_bol_id: bolId ?? null,
  p_product_id: productId ?? null,
});
// drawingUrl is string | null; pass through to the INSERT payload as `drawing_url: drawingUrl ?? null`
```

For the split branch where a source item has its own `drawing_url`, prefer the source's value rather than re-resolving — this preserves snapshot stability if the underlying source has changed since the source item was created.

**Auto-print mapping shape (mirror of explicit-download mapping at line 746).**

```ts
items={items.map((item) => ({
  item_id: item.item_id,
  product_name: item.products?.name || 'Unknown Product',
  product_code: item.products?.internal_code || '',
  job_name: item.jobs?.name || 'Unknown Job',
  quantity: item.quantity,
  completed_quantity: item.completed_quantity,
  piece_rate: item.piece_rate,
  drawing_url: item.drawing_url,           // ADD
}))}
drawingUrl={items.find((item) => item.drawing_url)?.drawing_url ?? null}   // ADD
```

**Manual new-card insert shape.**

```ts
// Per row, before bulk insert:
const { data: drawingUrl } = await supabase.rpc('resolve_job_card_drawing', {
  p_order_detail_id: null,
  p_bol_id: null,
  p_product_id: row.product_id,
});
// (Tier 3 only resolves when (bol_id, use_product_drawing=true) → product. For pure manual creation
// without a pool/BOL context, this returns null in the common case. Acceptable.)
```

**Out of scope for this plan** (deliberately deferred):

- Scan page (`app/scan/jc/[id]/page.tsx:90` and `:44`) — status-only UI, doesn't render PDFs. Tracked as a follow-up if drawing thumbnails on the scan page become valuable.
- Legacy `JobCardPDF.tsx` wrapper (line 467) — no current callsites, dormant. Delete as a separate cleanup if the team agrees.
- Cosmetic UI cleanup of the BOL editor radio layout and missing Remove button — already tracked as POL-97 (loading spinner) and a Cowork chip (layout density).
- Deployed-RPC body verification — already verified via `pg_proc.prosrc` match on `2026-05-07`.
