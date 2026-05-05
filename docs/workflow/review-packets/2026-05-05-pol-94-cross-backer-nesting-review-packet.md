# GPT-5.5 Pro Review Packet — POL-94 Cross-color cutting-plan nesting

**Spec under review:** [`docs/superpowers/specs/2026-05-05-cross-backer-nesting-design.md`](https://github.com/MaierG74/unity-erp/blob/codex/local-cross-backer-nesting/docs/superpowers/specs/2026-05-05-cross-backer-nesting-design.md)
**Branch:** `codex/local-cross-backer-nesting` (pushed 2026-05-05, 1 commit ahead of base: `f1b96eb`)
**Base:** `codex/integration` at `99faea6`
**Linear:** [POL-94](https://linear.app/polygon-dev/issue/POL-94)
**Author:** Claude Desktop (local), 2026-05-05

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

Reshape `CuttingPlan.material_groups` so **primary** and **backer** are independent dimensions in an order's cutting plan. Today, a `CuttingPlanMaterialGroup` co-locates primary and backer fields and is keyed by `(board_type, primary_id, backer_id)` — so when an order has the same primary material across products with mixed backer requirements (e.g. 16mm African Wenge with one product needing a Super-White backer and one not), the planner produces two separate primary nests instead of one consolidated nest. The fix splits each plan into:

- **Primary groups**, one per `(sheet_thickness_mm, primary_material_id)` — consolidating across products and across primary/backer/`-both` lamination flavors.
- **Backer groups**, one per `(sheet_thickness_mm, backer_material_id)` — aggregating across all primaries that share a backer material.

Each backer-bearing part contributes one placement to its primary group AND one (dimensionally identical) placement to its backer group. Each group runs its own packer pass.

Pure JSONB shape change. No DDL migration. `CuttingPlan.version` bumps `1 → 2`; legacy plans auto-stale on read and the user re-generates.

## Current repo context inspected (filesystem-grounded preflight, 2026-05-05)

The spec author ran these probes; findings are baked into the spec's "Filesystem-grounded preflight findings" section. Re-grounding for your benefit:

### Persisted plan inventory (verified via `mcp__supabase__execute_sql` 2026-05-05)

```
SELECT COUNT(*) FILTER (WHERE cutting_plan IS NOT NULL) → 2
```

Both are test orders:
- Order 401 `TEST-LC-002`: `version: 1`, NULL primary_material_id (legacy snapshot pre-primary resolution); 2 groups, no backer-bearing groups.
- Order 592 `TESTPLDESK`: `version: 1`, primary 385, two groups: `32mm-backer` (10 parts, 3+3 sheets, backer 657) and `16mm` (30 parts, 4 sheets). After applying `parseSheetThickness` from `lib/cutlist/boardCalculator.ts`, both groups reduce to 16mm sheet thickness — i.e. 592 IS the bug-shape order at the sheet-thickness level.

DP2 (no JSONB migration; stale-flag legacy reads) is therefore safe.

### View-drift check (verified 2026-05-05)

Single match for `cutting_plan%` view dependency: `job_work_pool_status`, which already references `cutting_plan_run_id` and `material_color_label` and is cutting-plan-aware. No views read `orders.cutting_plan` JSONB directly. No view drift risk from the shape change.

### `components` schema (verified 2026-05-05)

```
components(component_id, internal_code, description, unit_id, category_id, image_url, org_id, is_active, surcharge_percentage)
```

**No `thickness_mm` column exists.** Thickness is parsed from `description` via `parseThicknessFromDescription()` in `lib/cutlist/boardCalculator.ts` (e.g. matches `16mm` in `"16mm Super-White Melamine"`). DP5 (backer thickness derivation) therefore uses the description parser, not a column read.

### `parseSheetThickness` semantics (verified 2026-05-05)

From `lib/cutlist/boardCalculator.ts`:

- `parseSheetThickness('16mm')` → 16
- `parseSheetThickness('32mm')` → 32
- `parseSheetThickness('32mm-backer')` → 16 *(half of nominal — primary face is 16mm sheet, backer is its own 16mm sheet)*
- `parseSheetThickness('32mm-both')` → 16 *(same-board lamination, 2× 16mm sheets glued)*

The grouping rule MUST use sheet thickness (post-`parseSheetThickness`), not the leading number in `board_type`. A `16mm` group and a `32mm-backer` group both have sheet thickness 16 — they merge.

### Existing surfaces inspected

- **Aggregator (server):** `lib/orders/cutting-plan-aggregate.ts:130` — current grouping key.
- **Regrouper (client, post-assignment):** `lib/orders/material-regroup.ts:54` — same key shape.
- **Plan generator (client):** `hooks/useCuttingPlanBuilder.ts:163-300` — runs packer per group, emits `CuttingPlanMaterialGroup`s with co-located primary/backer fields.
- **Cost computation (server):** `app/api/orders/[orderId]/cutting-plan/route.ts:241-253` — iterates `material_groups`, multiplies primary sheets × primary price + backer sheets × backer price + edging.
- **Allocation (server):** `app/api/orders/[orderId]/cutting-plan/route.ts:256-269` — reads `cutlist_material_snapshot` directly (NOT the new groups). Upstream of grouping; unaffected by this change.
- **Material Breakdown UI:** `components/features/orders/CuttingPlanTab.tsx:184-237`. Print Cut List buttons at lines `:239` (primary) and `:250` (backer, conditional via `hasBackerCutListRun`).
- **Cutter PDF:** `components/features/cutlist/CutterCutListPDF.tsx`. Already has a `runKind: 'primary' | 'backer'` discriminator on `CutterCutListPdfData`; under the new shape this becomes redundant with `data.group.kind` and is dropped.
- **Piecework work pool:** `lib/piecework/cuttingPlanWorkPool.ts:86-124`. `batchLabel(group)` joins primary, backer, board_type into a string. Reconcile path keys by `(piecework_activity_id, material_color_label)`.

## Relevant branches

- **Base:** `codex/integration` at `99faea6` (post-POL-92 cutter PDF polish round 3)
- **Spec branch (this work):** `codex/local-cross-backer-nesting` (1 commit ahead of base: `f1b96eb`, just the spec doc)
- **POL-92 family (shipped):** `15b1924` (initial cutter PDF), `3a2da09` (backer category fix), `966b064`, `d380df7`, `99faea6` (polish rounds 1/2/3)
- **POL-83 family (shipped, foundation):** the per-line cutlist material/edging/surcharge work that this builds on top of

## Files likely to change in implementation (full table in spec §File-by-file changes)

### Phase 1 — Type shape + aggregator
- `lib/orders/cutting-plan-types.ts` — discriminated-union `CuttingPlanMaterialGroup`; bump `CuttingPlan.version` to 2
- `lib/orders/cutting-plan-aggregate.ts` — rewrite `resolveAggregatedGroups` for dual-emit (primary always; backer when `-backer`); add `backerThicknessByComponentId` parameter
- `lib/orders/material-regroup.ts` — same dual-emit on the post-assignment path
- New: tests under `lib/orders/cutting-plan-aggregate.test.ts`, `lib/orders/material-regroup.test.ts`, plus a fresh `tests/cross-backer-nesting.test.ts` covering the worked example and edge cases

### Phase 2 — Plan generator
- `hooks/useCuttingPlanBuilder.ts` — drop `hasBacker` doubling in packing loop; each group packs independently. Build `backerThicknessByComponentId` from `useBackerComponents().data.parsed_thickness_mm` (already loaded; refuse to generate if any null).

### Phase 3 — Persistence + cost
- `app/api/orders/[orderId]/cutting-plan/route.ts` (PUT) — validate `body.version === 2`; cost loop iterates groups uniformly via `priceByComponentId.get(group.material_id)`; drop the `backer_material_id`/`backer_sheets_required` branch
- `app/api/orders/[orderId]/cutting-plan/aggregate/route.ts` — fetch `(component_id, description)` for all referenced backer IDs in one query; apply `parseThicknessFromDescription` server-side; pass the lookup map to `resolveAggregatedGroups`
- `hooks/useOrderCuttingPlan.ts` (or whichever reader hydrates `displayPlan.stale`) — set `stale: true` if `plan.version !== 2`

### Phase 4 — UI surfaces
- `components/features/orders/CuttingPlanTab.tsx` — Material Breakdown row per group; "Backer" badge on backer rows; one Print Cut List button per row (drop the conditional second button)
- `components/features/cutlist/CutterCutListButton.tsx` — drop `runKind` prop (derive from `group.kind`); drop `hasBackerCutListRun` gate
- `components/features/cutlist/CutterCutListPDF.tsx` — backer tag derives from `data.group.kind === 'backer'`
- `components/features/orders/CuttingPlanViewer.tsx` — group selector iterates all groups
- `lib/cutlist/cutter-cut-list-helpers.ts` — drop `hasBackerCutListRun`; update `getCutterCutListFilename(orderNumber, group)` (drop `runKind` parameter); slug includes thickness
- `lib/cutlist/cutter-cut-list-types.ts` — drop `runKind` from `CutterCutListPdfData`

### Phase 5 — Work pool
- `lib/piecework/cuttingPlanWorkPool.ts` — `batchLabel` reads `group.kind` + `material_name`; emit one activity per group; **reconcile-path interaction with stale legacy `material_color_label` rows is the highest-risk surface in this phase** (see Specific things to review §5)

### Phase 6 — Edging + line allocation regression coverage
- `lib/orders/edging-computation.ts` — verify edging only emits on primary groups; backer groups land with `edging_by_material: []`
- `lib/orders/line-allocation.ts` — no structural change; add a regression test pinning `line_allocations` totals on a backer-bearing fixture (snapshot is upstream of grouping, so should be by-construction unchanged)

## Files / docs consulted by the spec author

- **Trial workflow:** `docs/workflow/2026-04-29-trial-gpt-pro-plan-review.md`
- **Linear ticket body:** [POL-94](https://linear.app/polygon-dev/issue/POL-94) (DPs 1-6, original "split groups vs per-placement flag" framing)
- **POL-92 PDF (shipped):** `components/features/cutlist/CutterCutListPDF.tsx`, `CutterCutListButton.tsx`, `lib/cutlist/cutter-cut-list-helpers.ts`, `lib/cutlist/cutter-cut-list-types.ts`
- **Standing rails:** `CLAUDE.md`, `AGENTS.md`
- **Cutlist PDF skill:** `.claude/skills/cutlist-pdf/SKILL.md` (re-confirmed PDF lazy-import pattern at `CutterCutListButton.tsx:71-74`)
- **Tenancy skill:** `unity-erp-tenancy` (no new tables; existing RLS on `components` covers backer thickness lookup)
- **Project memory:** view-drift bug class, partial-index ON CONFLICT, "no synthetic wage data," GPT-Pro-needs-GitHub-push, PL/pgSQL RETURNS TABLE shadowing

## Proposed implementation steps

See spec §Phasing for the 6-phase table and §Acceptance Criteria for AC1-AC10. Phases 1–3 are server-leaning (types, aggregator, persistence/cost); Phases 4–5 are UI/work-pool; Phase 6 is regression coverage. No DDL migration in any phase.

## Tenant / RLS considerations

- No new tables; no new columns. Backer thickness lookup reads `components.description` — already RLS-enabled on `is_org_member(org_id)`. The spec's proposed query already filters by `org_id`.
- `orders.cutting_plan` JSONB column is the same column today; RLS unchanged.
- `mcp__supabase__get_advisors --type security` not needed — no schema change.

## Migration / schema considerations

- No DDL.
- JSONB shape change with `version` field bump from `1` to `2`. Readers stale-flag any `version !== 2` plan. Per preflight, only 2 test plans persisted; no production data at risk. Existing `version: 1` reader code is dropped (not maintained as a fallback).
- View-drift verified clean.

## Testing and validation plan

See spec §Verification Commands and §Acceptance Criteria. Static checks (`npm run lint`, `npx tsc --noEmit`, `npm run build`) are the gating signal. Unit tests cover the new aggregator/regrouper rules with three fixture shapes:

1. **Single-primary mixed-backer** (the bug case) — 16mm Wenge primary across 2 products, one with Super-White backer, one without. Expected: 1 primary nest + 1 backer nest.
2. **Multi-primary shared-backer** — 16mm Wenge + 16mm Cherry, both with Super-White backer. Expected: 2 primary nests + 1 consolidated backer nest.
3. **Multi-thickness same-material** — 16mm Wenge + 32mm-backer Wenge (both effectively 16mm sheet). Expected: 1 consolidated 16mm primary nest. (Different from DP6's "different thicknesses stay separate" — DP6 means different SHEET thicknesses; `32mm-backer` reduces to 16mm sheet.)

Browser smoke is reviewer responsibility per project memory ("browser smoke when Codex CLI cannot"). Test on a real bug-shape order with the preview MCP at `localhost:3000`.

## Risks and edge cases (from spec §Risks)

- **R1 Backer thickness derivation is heuristic.** No `components.thickness_mm` column. Parser yields null for descriptions missing an "Xmm" token. Aggregator must reject the run, not fall back. UI prompt: "fix backer description or pick a different backer."
- **R2 `-both` doubled cuts.** Preserved unchanged. `-both` parts go to primary group only.
- **R3 Per-line backer override.** `material_assignments.backer_default` already resolves at aggregation time; new shape inherits.
- **R4 Edging on backer parts.** Backer parts have no edge banding. New shape enforces `edging_by_material: []` on backer groups.
- **R5 Re-snapshot semantics.** `source_revision` already updates on backer reassignment; plan goes stale; user re-generates. Unchanged.
- **R6 Partial-index ON CONFLICT in work pool insert.** Recurring bug class. Existing reconcile path with benign-23505 swallowing covers; no new ON CONFLICT predicate needed.
- **R7 View drift.** Verified clean.
- **R8 Cost calculation parity.** Mathematically identical for equivalent inputs (sheets × prices); just structured by kind. Pin via unit test.
- **R9 Backer-emit area double-count.** Backer-bearing parts emit two placements (primary + backer). Allocation reads upstream snapshot, not groups, so unaffected. Pin via regression test.

## Questions / uncertainties for GPT Pro

The spec author flagged these as worth your attention:

1. **Reconcile-path interaction with stale legacy work-pool rows** (Phase 5) — Existing `job_work_pool` rows from a previously-finalized v1 plan have `material_color_label` strings like `"African Wenge / Super-White Melamine / 32mm-backer"`. After the new plan finalizes, the new emissions have labels like `"Super-White Melamine / 3mm Backer"`. The reconcile loop in `lib/piecework/cuttingPlanWorkPool.ts:163-211` keys by `(piecework_activity_id, material_color_label)`. Will this leave orphan `active` rows from the old plan that need explicit cleanup, or does some other path retire them? (The spec hand-waves this; please scrutinize.)
2. **`useCuttingPlanBuilder` regroup-path null guard** — `useBackerComponents().data` may be `undefined` mid-load. The current canGenerate gate doesn't account for `parsed_thickness_mm: null`. What's the right user affordance — a disabled Generate button, or a toast on click?
3. **Filename slug uniqueness across kinds** — Two `kind: 'primary'` groups with same material at different sheet thicknesses (e.g. 16mm Wenge + 32mm Wenge) need distinct slugs. Spec says thickness is included; double-check the proposed slug template `cut-list-${order}-${kind}-${thickness}mm-${material}.pdf` actually disambiguates all realistic combinations.
4. **Stale-flag mechanism** — Setting `stale: true` on `version !== 2` plans surfaces the existing yellow banner UI ("Order has changed since this plan was generated. Re-generate for accurate results"). The wording is wrong for this case — the order DIDN'T change, the plan format did. Acceptable for one release, or add a second variant message?
5. **Cross-product part identity** — `AggregatedPart.id` is `${order_detail_id}-${original_id}`. When a backer-bearing part dual-emits to both groups, both copies have the same `id`. The packer's de-duplication (if any) and the cutter PDF's letter-map (`buildLetterMap`) — do they tolerate the same id appearing in two groups? Or do we need to namespace the backer copy as `${order_detail_id}-${original_id}-backer`?
6. **Per-product backer mismatch** — If two products both declare 16mm Wenge primary but one has Super-White backer at 3mm and the other has Super-White at 6mm, do we get one 3mm Super-White backer group AND one 6mm Super-White backer group (correct, by sheet_thickness in the key), or do they collapse incorrectly? Worth scrutiny on the worked example.
7. **`-both` doubling at packing time** — Today, `-both` parts may be already double-emitted somewhere upstream so each part contributes 2 placements to its single group. Or they may not (which would be a pre-existing bug). The spec says "preserved unchanged." Is there a way to verify the pre-existing behavior by reading the code, so the reviewer is confident no regression sneaks in?

## Specific things to review (priority order)

1. **Dual-emit semantics** — every backer-bearing part contributes ONE placement to its primary group AND ONE to its backer group. Read the spec's grouping rule (§Target architecture → Grouping rule) and the worked example. Is the dual-emit unambiguous? Are dimensions truly identical between the primary-side and backer-side placements? (They should be — same physical part, same length × width — but flag if you see a code path that might transform dimensions on emission.)
2. **Backer thickness lookup correctness** — `parseThicknessFromDescription` is heuristic. The spec's failure mode is "aggregator returns error result; UI surfaces fix-prompt." Is this safe? Could a malformed description silently parse to a wrong number (e.g. "316mm component" → "16" or "3" depending on regex greediness)? If you can read `parseThicknessFromDescription` source from `lib/cutlist/boardCalculator.ts` directly, do.
3. **Cost calculation parity** — Spec says costs are numerically identical for equivalent inputs after the shape change. The current loop adds `primary_sheets * primary_price + backer_sheets * backer_price + edging`. The new loop iterates groups uniformly. Confirm the sums must be identical given the same `sheets_required` totals per material.
4. **Edging emission scope** — `lib/orders/edging-computation.ts` emits edging entries per group keyed by `${board_type}|${primary_id}|${backer_id ?? 'none'}` (matches the old key shape). After the rewrite, edging keys must align with the new primary-group key `(sheet_thickness, primary_material_id)`. Will the rewrite correctly skip backer parts (which never carry edges) without dropping legitimate edging entries on primary parts?
5. **Work pool reconcile path under shape change** — Phase 5 swaps `batchLabel` to a new format. Pre-existing `active` rows in `job_work_pool` from a v1 plan have legacy labels. The reconcile inserts new rows with new labels; old rows aren't matched and remain `active` until... what? Is there a cleanup path? See Question §1.
6. **Stale-flag GET reader** — The spec proposes setting `stale: true` on `version !== 2`. Is there a single GET reader to update, or does the stale-flag need to thread through multiple read paths (PDF render, work pool sync, cost recompute)? Spec mentions `useOrderCuttingPlan.ts` — is that the only entry point?
7. **POL-83 surfaces (per-line cutlist material/edging/surcharge)** — POL-83 introduced per-line `cutlist_primary_material_id`, `cutlist_primary_backer_material_id`, `cutlist_part_overrides` columns and threaded `effective_*` fields through snapshots. Does POL-94's new grouping rule interact correctly with these per-line resolutions? Specifically, does the `resolved_primary_material_id` in the grouping rule honor per-line POL-83 overrides? (Spec assumes yes based on existing aggregator behavior at `cutting-plan-aggregate.ts:127`.)
8. **Out-of-scope completeness** — Read spec §Out of scope. Is anything in scope that should be deferred (e.g. POL-93's optimizer wiring), or anything deferred that quietly creeps into Phase 4 UI?

## What you do NOT need to review

- POL-92 (cutter PDF) is shipped and verified working. Don't re-litigate the PDF rendering — POL-94 only affects which group's data the PDF renders, not the rendering itself.
- POL-93 (Quality dropdown wiring of simulated annealing) is filed separately; spec explicitly out-of-scope.
- POL-95 (in-screen viewer + relax pending-plan gate) is filed separately.
- The decision to use Option B over Option A in DP1 — Greg-confirmed in brainstorm.
- Per-component stock sheet sizes (`DEFAULT_STOCK` 2750×1830) — pre-existing TODO in `useCuttingPlanBuilder.ts:24`, not in scope.
- The `-both` lamination rule itself (preserved as-is; not improved, not regressed).
- Workflow process or commit-message style.

## Reply format

Return your findings as markdown. Group by severity (BLOCKER → MAJOR → MINOR). For each finding:

```
### [SEVERITY] Short title
**Spec section:** §X (or "Specific review item §N")
**Issue:** What's wrong.
**Fix shape:** What needs to change (don't write the prose; describe the change).
```

Skip a finding if you can't articulate a concrete fix shape.

If you find no issues at a given severity, say "None" under that heading.

Close with a one-sentence verdict: "Sign off as-is" / "Iterate one more round" / "Multiple rounds needed."
