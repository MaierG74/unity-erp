# GPT-5.5 Pro Review Packet — Cutlist Material Swap & Surcharge

**Spec under review:** [`docs/superpowers/specs/2026-04-29-cutlist-material-swap-and-surcharge-design.md`](https://github.com/MaierG74/unity-erp/blob/codex/local-cutlist-material-swap-spec/docs/superpowers/specs/2026-04-29-cutlist-material-swap-and-surcharge-design.md)
**Branch:** `codex/local-cutlist-material-swap-spec` (pushed 2026-04-29)
**Base:** `codex/integration` at `37afb78`
**Author:** Claude Desktop (local), 2026-04-29

> Paste everything below this line into GPT-5.5 Pro's web UI. The packet is self-contained — GPT Pro can read the spec and any referenced files directly from `MaierG74/unity-erp` on GitHub.

---

## Role

You are GPT-5.5 Pro acting as plan-quality reviewer for a software spec on the `unity-erp` repo (Next.js + Supabase, multi-tenant ERP for a furniture manufacturer). You're replacing OpenAI Codex Desktop in the plan-review loop for this trial. The spec author (Claude Desktop) has already done the brainstorm, filesystem-grounded preflight probe, and consumer audit. Your job is to find what they missed, contradict themselves on, or under-specified — not to rewrite the design.

## Output you should produce

A concise findings list grouped by severity:

- **BLOCKER** — would cause data loss, schema corruption, RLS breach, scope drift that breaks adjacent features, or implementation that can't proceed without revision
- **MAJOR** — significant gap (missing AC, ambiguous requirement, untested edge case, unclear migration semantics) that would slow Codex implementation but not block it
- **MINOR** — wording, organization, naming, or convention nit

For each finding, cite the spec section and (where possible) the file path + line number you'd want changed. Do not propose full rewrites — describe the gap and the fix shape.

## Task summary

Extend the per-line BOM swap + surcharge model that POL-71 shipped (now in `Verifying`) to **cutlist materials and edging** on quote lines and order lines. Greg's mental model:

- Each quote/order line picks a **primary cutlist material** that drives all parts by default.
- Optional **per-part overrides** for two-tone configurations (e.g. white carcass + cherry doors).
- An **edging picker** that auto-fills from a learned `(board, thickness)` → edging association table; user-overridable per part.
- A **per-line surcharge** as a fixed R amount or % of unit price, with an admin-set hint per board (`components.surcharge_percentage`).
- Quote-side and order-side both ship in this work. Quote→order conversion clones the cutlist data.
- Downstream-state probe + exception extension (reusing POL-71's `bom_swap_exceptions` table with a widened CHECK constraint).
- The existing `MaterialAssignmentGrid` on the cutting plan tab stays as a workshop-side fine-tuning tool; its writes get redirected from `orders.material_assignments` JSONB to per-line `cutlist_part_overrides` columns in Phase F.

The spec is six phases (A1, B, C, D, E, F) following POL-71's structure but adapted to cutlist data.

## Current repo context inspected (filesystem-grounded preflight, 2026-04-29)

The spec author ran these probes; findings are baked into the spec's "Filesystem-grounded Preflight Findings" table at the top. Re-grounding for your benefit:

### Schema state (verified via `information_schema` 2026-04-29)

- `quote_items` has `bom_snapshot`, `surcharge_total`, `product_id` (POL-71). NO `cutlist_snapshot`.
- `order_details` has `bom_snapshot`, `cutlist_snapshot`, `surcharge_total`. Spec extends `cutlist_snapshot` JSONB shape.
- `components` columns: `component_id, internal_code, description, unit_id, category_id, image_url, org_id, is_active`. No surcharge column. RLS enabled.
- All target tables (`quote_items`, `order_details`, `orders`, `components`, `product_cutlist_groups`, `organization_members`) RLS-enabled with 4 policies each (SELECT/INSERT/UPDATE/DELETE on `is_org_member(org_id)`).

### View-drift check (verified 2026-04-29)

Two views read `order_details`:
- `jobs_in_factory` — references `od.surcharge_total` only
- `factory_floor_status` — references `od.surcharge_total` only

Neither reads `cutlist_snapshot` or any of the proposed new columns. Adding `cutlist_primary_material_id`, `cutlist_primary_edging_id`, `cutlist_part_overrides`, `cutlist_surcharge_kind`, `cutlist_surcharge_value`, `cutlist_surcharge_label` to `order_details` will not break the views.

### SQL/RPC consumer audit (verified 2026-04-29)

- `grep -rn "cutlist_snapshot" supabase/migrations/ db/migrations/ migrations/` → 0 results
- `pg_proc` filter for `public` functions whose body references `cutlist_snapshot` → 0 rows

A1-CS1 is documented as a no-op. Any RPC introduced between sign-off and execution must be added to AC.

### Existing bridge code

`lib/orders/snapshot-utils.ts:deriveCutlistSwapEffectsFromBomSnapshot` already translates BOM swaps on `is_cutlist_item=true` rows to cutlist `materialOverrides` / `removedMaterialIds`. This bridge stays for backwards compat; the new line-level UX is the canonical entry point.

### Cutlist data state

- 400 BOM rows total; 6 are `is_cutlist_item=true`. Of those, 3 are stranded on a legacy product (NULL `component_id`); 3 are on product 55 (DH003) with `cutlist_category` populated.
- Most `product_cutlist_groups.primary_material_id` are NULL. The "default cutlist material" comes from order-time assignment via `MaterialAssignmentGrid`, not from product setup.
- `product_cutlist_groups.board_type` values seen in production: `'16mm'`, `'32mm-both'`, `'32mm-backer'`. Spec STOPs on unknown values.
- `32mm-backer` groups carry single-part `lamination_type='with-backer'` records (verified 2026-04-29). Edging treats the assembly as one 32mm exposed edge — NOT a split front/back edging emission. The spec was corrected during self-review to reflect this.

## Relevant branches

- **Base:** `codex/integration` at `37afb78` (post-POL-77 + post-trial-doc-merge)
- **Spec branch (this work):** `codex/local-cutlist-material-swap-spec` (1 commit ahead of base, just the spec doc)
- **POL-71 family** (Verifying status, foundation for this spec): merged into `codex/integration` at commits `ac7410c` (POL-72), `66bc198` (POL-73), `4c58b71` (POL-74), `c097aa4` (POL-75), `4931d16` (POL-76), `6d4196b` (POL-77)

## Files likely to change in implementation (full list in spec §Snapshot Consumers)

### A1 (schema + builders + consumers)
- New migrations: `supabase/migrations/<ts>_quote_items_cutlist_columns.sql`, `<ts>_order_details_cutlist_columns.sql`, `<ts>_components_surcharge_percentage.sql`, `<ts>_board_edging_pairs.sql`, `<ts>_cutlist_backfill_from_material_assignments.sql`
- `lib/orders/snapshot-types.ts` — extend `CutlistSnapshotPart` with `effective_*` fields
- `lib/orders/build-cutlist-snapshot.ts` — replace `materialOverrides`/`removedMaterialIds` params with `(linePrimary, lineEdging, partOverrides, pairLookup)`; populate per-part effective fields
- `lib/quotes/build-cutlist-snapshot.ts` — new file
- `lib/orders/cutlist-surcharge.ts` — new file with `resolveCutlistSurcharge`
- `lib/piecework/cuttingPlanWorkPool.ts` — switch to per-part `effective_board_id`
- `lib/orders/material-assignment-types.ts` — `buildPartRoles` prefers per-part effective fields
- `lib/orders/edging-computation.ts` — prefers per-part `effective_edging_id`
- `lib/cutlist/groupsToCutlistRows.ts` — same
- `app/api/orders/[orderId]/cutting-plan/route.ts` and `aggregate/route.ts`
- `lib/orders/material-regroup.ts`
- `components/features/orders/CuttingPlanViewer.tsx`
- `app/api/orders/from-quote/route.ts` — clone cutlist data on conversion
- `app/api/orders/[orderId]/add-products/route.ts` — seed line primary from product
- Test files: `tests/edging-computation.test.ts`, `tests/cutting-plan-aggregate.test.ts`, `lib/piecework/__tests__/cuttingPlanWorkPool.test.ts` and `.integration.test.ts`, `lib/piecework/__tests__/productCosting.test.ts`, `lib/orders/cutting-plan-aggregate.test.ts`, `lib/cutlist/productCutlistLoader.ts` tests

### B (order UI)
- New: `components/features/shared/CutlistMaterialDialog.tsx`
- `components/features/orders/ProductsTableRow.tsx` — add cutlist surcharge child row + open-dialog button
- Order line save mutation extended

### C (quote UI + PDF)
- `components/features/quotes/AddQuoteItemDialog.tsx` — render dialog card
- `components/features/quotes/EditQuoteItemDialog.tsx` (or wherever line edit lives)
- New: `lib/quotes/render-cutlist-summary.ts`
- Quote PDF renderer (per `react-pdf-pagination` skill rules)

### D (downstream exception)
- New migration: `<ts>_widen_bom_swap_exceptions_check.sql`
- `lib/orders/downstream-swap-exceptions.ts` — add `probeForCutlistSwap` entry point
- Order-side cutlist swap mutation hooks the probe
- Activity log payload extension

### E (settings)
- New: `app/settings/board-edging-pairs/page.tsx`
- Components edit page gains `surcharge_percentage` field

### F (grid behaviour switch)
- `components/features/orders/MaterialAssignmentGrid.tsx` — read union, write to per-line columns

## Files / docs consulted by the spec author

- POL-71 spec: `docs/plans/2026-04-28-product-swap-and-surcharge.md` (foundation)
- BOM substitution v2: `docs/superpowers/specs/2026-03-29-bom-substitution-design.md`
- Edging computation: `docs/superpowers/specs/2026-04-01-edging-computation-design.md`
- Order cutlist costing: `docs/superpowers/specs/2026-04-20-order-cutlist-costing-design.md`
- Cutlist→costing flow: `docs/superpowers/specs/2026-04-15-cutlist-to-costing-design.md`
- Trial workflow: `docs/workflow/2026-04-29-trial-gpt-pro-plan-review.md`
- Standing rails: `CLAUDE.md`, `AGENTS.md`

## Proposed implementation steps

See spec §Phasing for the six-phase table and §Acceptance Criteria for per-phase ACs (A1-D1..D4, A1-S1..S7, A1-B1..B4, A1-CT1..CT9, A1-CS1, A1-BF1..BF4, A1-V1..V6, B1..B11, C1..C9, D1..D9, E1..E7, F1..F7).

## Tenant / RLS considerations

- All target tables already RLS-enabled. New `board_edging_pairs` table follows the same pattern: 4 policies on `is_org_member(org_id)`. Spec §4.
- Composite FKs `(component_id, org_id)` for primary material and edging foreign keys, mirroring POL-71's `quote_items_product_org_fk` pattern. Spec §1, §2.
- Phase D RLS recheck after CHECK widen on `bom_swap_exceptions`.
- `mcp__supabase__get_advisors --type security` clean expected post-A1 and post-D.

## Migration / schema considerations

- Multiple migrations in A1, each named distinctly per migration discipline rule.
- A1 migrations are reversible: drop columns, drop tables, restore prior types.
- Backfill is data-only and re-runnable. Stop-and-ask if drift exceeds 5% of orders with >30% override-count percentage (signals misclassified primary).
- Phase D widens `bom_swap_exceptions_exception_type_check`. Reversible by dropping/re-adding original constraint, modulo existing rows of the new type.
- The COALESCE fallback pattern (POL-71) is reused for any consumer that prefers per-part `effective_*` fields but tolerates old snapshots — though for cutlist we're not back-populating old `cutlist_snapshot` rows, so the fallback applies for orders not yet re-saved through the new UX.

## Testing and validation plan

See spec §Verification Commands and per-phase AC verification lines (A1-V1..V6, B10/B11, C7/C8/C9, D7/D8/D9, E6/E7, F6/F7).

Browser smokes for B/C/D/E/F use the preview MCP (per project memory: reviewer must run browser smoke when Codex CLI cannot). Test product: Panel Leg Desk Test (product 856).

## Risks and edge cases (from spec §Risks)

- R1 Cutlist consumer drift — High; mitigated by audit + per-part shape extension. Audit verified 0 SQL/RPC readers exist today.
- R2 Backfill misclassification of line primary — Medium; mitigated by stop-and-ask threshold.
- R3 Auto-pair confirmation prompt feels intrusive — Low; first-time silent, only conflicts prompt.
- R4 Composite FK breach — Mitigated by POL-71-pattern adoption.
- R5 View drift — Verified low.
- R6 Multi-board PDF rendering messy — Capped at 3 child lines.
- R7 Lamination-aware lookup wrong for `32mm-backer` — Resolved during self-review (single 32mm lookup, not split).

## Questions / uncertainties for GPT Pro

The spec author flagged these as worth your attention:

1. **Surcharge × quantity rule** (spec Decision Summary, last bullet): Both fixed and percentage scale with qty. Worth scrutiny — is there a salesperson workflow where the user expects "R200 flat" to mean R200 regardless of qty=3?
2. **Phase F's grid behaviour switch** for legacy orders: the read-union strategy (line primaries + line overrides + legacy `material_assignments` for orders not yet re-saved) — is this safe for orders mid-cutting-plan-stale?
3. **Auto-pair conflict prompt** — is the proposed UI flow (single confirmation listing all conflicts, choose Update default vs Just this line) clear enough for a busy salesperson clicking through 30 quotes a day?
4. **Backfill primary heuristic** — most-common board by part-quantity-weighted count, ties broken by ascending `component_id`. Is part-quantity-weighting the right tie-breaker, or should it be cost-weighted (i.e. the most expensive board becomes the primary so the upgrade direction reads naturally)?
5. **`32mm-backer` thickness derivation** — spec resolves to 32mm uniformly. Is there a real-world scenario where the back face's 16mm should drive a different edging? (Spec author's read of code + sample data says no.)
6. **No A2 phase** — POL-71 had A2 for the order-totals trigger. This spec relies on POL-71's existing trigger and inserts cutlist surcharge into the existing `surcharge_total` column at app-layer save time. Worth scrutiny — is there a trigger-side change we're missing?

## Specific things to review (priority order)

1. **Snapshot consumer audit completeness.** Spec lists 13 TS readers. Is there a category of reader (e.g. piecework cost computation, work pool dispatch, BOL generation, job card rendering) that the audit missed?
2. **Backfill semantics.** Is the proposed `orders.material_assignments` → per-line `cutlist_part_overrides` translation correct? Specifically: does the per-line scoping (via `order_detail_id` in the existing fingerprint) survive the translation cleanly?
3. **Composite FK `(component_id, org_id)` on `components`.** The spec says "STOP and ask if conflicts" — but please scrutinize whether `components` already has a different UNIQUE that would block this addition. If you can read `db/migrations/` or `supabase/migrations/` for prior `components` constraints, do.
4. **`32mm-backer` thickness handling.** Is the single-32mm-lookup model correct? Cross-reference with `lib/orders/edging-computation.ts` and the cutting plan PDF logic.
5. **Phase D CHECK constraint widen.** `ALTER TABLE bom_swap_exceptions DROP CONSTRAINT … ADD CONSTRAINT …` — is this safe if existing exception rows are present? Are there any RPCs that ENUM-check this column body?
6. **Quote PDF rendering edge case.** The spec caps at 3 child lines and rolls residual into "+ other variations." Is the surcharge distribution rule clearly enough specified? Could a salesperson disagree with the rendered breakdown?
7. **MaterialAssignmentGrid coexistence (Phase F).** The grid stays as a workshop tool but writes redirect. Is there an order-level operation (regenerate cutting plan, mid-production part swap, BOL refresh) that depends on the grid being authoritative and would break if it's mirroring?
8. **Out-of-scope completeness.** Read spec §Out of Scope. Is anything in scope that should be deferred, or vice versa?

## What you do NOT need to review

- POL-71's design is already shipped and verified working. Don't re-litigate the BOM-swap surcharge model — this spec extends it for cutlist materials, not replaces it.
- Don't propose alternate phase orderings — A1→B/C→D/E/F was Greg-confirmed.
- Don't propose new approaches to the primary+overrides UX — Approach A was Greg-selected; Approach C is filed as POL-82 polish.
- Don't quibble about commit message style or branch naming.
- Don't propose changes to the auto-pair confirmation UI's word choice unless it affects correctness.

## Reply format

Return your findings as markdown. Group by severity (BLOCKER → MAJOR → MINOR). For each finding:

```
### [SEVERITY] Short title
**Spec section:** §X
**Issue:** What's wrong.
**Fix shape:** What needs to change (don't write the prose; describe the change).
```

Skip a finding if you can't articulate a concrete fix shape.
