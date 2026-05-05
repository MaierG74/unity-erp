---
issue: POL-94
title: Same-primary nesting across backer/non-backer groups (cutting plan optimization)
status: v1 — pre-review
date: 2026-05-05
branch: codex/local-cross-backer-nesting (off origin/codex/integration @ 99faea6)
related: POL-92 (cutter cut-list PDF, shipped), POL-93 (Quality dropdown wiring, queued)
---

# Cross-color cutting-plan nesting (POL-94)

## TL;DR

Reshape `CuttingPlan.material_groups` so **primary** and **backer** are independent dimensions. One nest per `(sheet_thickness_mm, material_id)` regardless of whether parts are primary cuts or backer cuts. Same-color parts across products in an order pack together into a single nest.

## Background

### Bug observation (Greg, 2026-05-05)

An order with 16mm African Wenge as primary across two product lines — one needing a backer (Super-White Melamine), one not — produces TWO separate primary material groups. Material Breakdown shows:

| Material | Parts | Sheets | Waste |
|---|---|---|---|
| 16mm African Wenge + Super-White Melamine (backer) | 10 | 3 | 40.4% |
| 16mm African Wenge | 30 | 4 | 28.8% |

Total 7 sheets of African Wenge, separately optimised. All 40 parts share the same primary material on the same sheet thickness — they should pack as one African Wenge nest of ~5–6 sheets. The backer (Super-White Melamine) cuts remain ~10 parts on ~2 sheets but are a separate cut on a separate stack of sheets at the saw, which is its own optimisation.

### Root cause

`lib/orders/cutting-plan-aggregate.ts:130` and `lib/orders/material-regroup.ts:54` key groups by:

```ts
`${board_type}|${primary_id}|${backer_id ?? 'none'}`
```

`board_type` carries the lamination suffix (`-backer`, `-both`), so a `16mm` group and a `16mm-backer` group land in different keys *even when their primary material and sheet thickness match*. Each group then runs an independent packing pass.

Second-order issue: a `CuttingPlanMaterialGroup` today carries BOTH `primary_material_id` and `backer_material_id` and BOTH `sheets_required` and `backer_sheets_required`. The packer runs once per group — backer parts are co-packed on the same layout, then the same layout is claimed for both primary and backer sheets. Each backer-bearing part forces its own primary sheet because the layout treats it as if it can't share with a non-backer part of the same material.

### Generalised goal (per Greg, 2026-05-05)

> "We need to group and nest all the same colours together from the different products in an order."

The cutter at the panel saw runs a stack of sheets at a time. Each (sheet thickness × material) combination is one stack and one nest. The fix consolidates all parts of the same `(sheet_thickness, material)` into one nest, *regardless of which product they came from or whether they're a primary cut or a backer cut*.

## Decisions

| DP | Resolution |
|---|---|
| **DP1** — Plan shape | **Option B** — split into independent groups. Primary keyed by `(sheet_thickness_mm, primary_material_id)`. Backer keyed by `(sheet_thickness_mm, backer_material_id)` — no source-primary in the key, so two primaries that share a backer material pack as one backer nest. |
| **DP2** — Migration | No JSONB migration. `CuttingPlan.version` bumps from `1` to `2`. Readers stale-flag any plan with `version !== 2` and surface a re-generate prompt. Existing v1 reader code dropped (only 2 test plans persisted; no production data at risk). |
| **DP3** — UI row treatment | Each group is its own top-level row in Material Breakdown. Backer rows wear a "Backer" badge. No "Backer of: \<primary\>" cross-reference (a backer nest can serve multiple primaries). One Print Cut List button per row. |
| **DP4** — Work pool / piecework | Each group emits its own piecework activity. Backer nest is its own `cut_pieces` card, distinct from the primary cards it backs. Naming change in `batchLabel()`; counting logic unchanged. |
| **DP5** — Backer thickness derivation | Parsed at aggregation time from `components.description` via `parseThicknessFromDescription()` (per `lib/cutlist/boardCalculator.ts`). The `components` table has no dedicated `thickness_mm` column; thickness is heuristic-parsed from descriptions like "16mm Super-White Melamine". Aggregator returns an error result if the parse yields `null`. |
| **DP6** — Out of scope | Different sheet-thicknesses stay separate (16mm Wenge ≠ 32mm Wenge). Different primary materials stay separate (16mm Wenge ≠ 16mm Cherry). POL-93 SA wiring stays orthogonal. `-both` semantics preserved (same-material doubled cuts; parts stay in primary group). |

## Target architecture

### Type shape

```ts
// lib/orders/cutting-plan-types.ts

export type CuttingPlanMaterialGroupKind = 'primary' | 'backer';

export type CuttingPlanMaterialGroup = {
  kind: CuttingPlanMaterialGroupKind;
  /** Sheet thickness. For primary groups: parseSheetThickness(snapshot.board_type).
   *  For backer groups: parseThicknessFromDescription(components.description) for
   *  the resolved backer component (no thickness_mm column exists). */
  sheet_thickness_mm: number;
  material_id: number;
  material_name: string;
  sheets_required: number;
  /** Empty for backer groups — backer parts don't carry edge banding. */
  edging_by_material: CuttingPlanEdgingEntry[];
  total_parts: number;
  waste_percent: number;
  bom_estimate_sheets: number;
  layouts: SheetLayout[];
  stock_sheet_spec: { length_mm: number; width_mm: number };
};

export type CuttingPlan = {
  version: 2;                      // ← bumped
  // ... other fields unchanged
  material_groups: CuttingPlanMaterialGroup[];
};

export type AggregatedPartGroup = {
  kind: CuttingPlanMaterialGroupKind;
  sheet_thickness_mm: number;
  material_id: number;
  material_name: string;
  parts: AggregatedPart[];
};
```

**Removed fields** (no longer co-located):
- `primary_material_id` / `primary_material_name` → `material_id` / `material_name` (typed by `kind`)
- `backer_material_id` / `backer_material_name` → become a separate `kind: 'backer'` group
- `backer_sheets_required` → backer group has its own `sheets_required`
- `bom_estimate_backer_sheets` → backer group has its own `bom_estimate_sheets`
- `board_type` → no longer persisted on groups. Display labels are inlined per usage as `${sheet_thickness_mm}mm ${material_name}` (and a `(Backer)` suffix when `kind === 'backer'`). The legacy `getBoardTypeLabel()` in `lib/cutlist/boardCalculator.ts` keeps operating on the snapshot's source `board_type` string and is not affected.

### Grouping rule

For each part in the snapshot:

1. **Always** emit it to a primary group keyed by `(parseSheetThickness(snapshot_group.board_type), resolved_primary_material_id)`.
2. **If** the snapshot group's `board_type` ends with `-backer`, **also** emit a copy of the part (same dimensions, same band_edges, same grain, but `material_id = resolved_backer_material_id`) to a backer group keyed by `(backer_sheet_thickness_mm, resolved_backer_material_id)`.
   - `backer_sheet_thickness_mm` is parsed from the resolved backer component's `description` via `parseThicknessFromDescription()` (DP5). The aggregate endpoint fetches `(component_id, description)` for all referenced backer IDs in one query and parses on the server.
   - If the parse returns `null` for any referenced backer component, the aggregator returns an error result and the UI surfaces a "fix the backer description or pick a different backer" prompt rather than silently falling back to primary thickness.
3. `-both` board_types remain primary-only — no backer emission. Existing `-both` doubled-cut behavior is preserved (no regression).

This rule produces:
- One primary nest per `(sheet_thickness, primary_material)` — consolidating across products and across primary/backer/both lamination flavors.
- One backer nest per `(sheet_thickness, backer_material)` — consolidating across primaries that share a backer material.

### Worked example

Order with three products:
- Product A: 16mm-backer Wenge primary + Super-White Melamine 3mm backer (10 parts)
- Product B: 16mm Wenge primary, no backer (30 parts)
- Product C: 32mm-backer Cherry primary + Super-White Melamine 3mm backer (5 parts)

Resulting groups:

| kind | sheet_thickness | material | parts |
|---|---|---|---|
| primary | 16mm | Wenge | 40 (10 from A + 30 from B) |
| primary | 16mm | Cherry | 5 (from C — `parseSheetThickness('32mm-backer') = 16`) |
| backer | 3mm | Super-White Melamine | 15 (10 backer copies of A's parts + 5 backer copies of C's parts) |

Today this would have produced 3 separate primary-bearing groups (A, B, C all distinct) plus their bundled backer counts.

## File-by-file changes

| File | Change |
|---|---|
| `lib/orders/cutting-plan-types.ts` | Discriminated-union `CuttingPlanMaterialGroup`. Bump `CuttingPlan.version` to `2`. Update `AggregatedPartGroup` similarly. |
| `lib/orders/cutting-plan-aggregate.ts` | Rewrite `resolveAggregatedGroups`: emit primary group for every part, plus backer group for every `-backer` part. Add `backerThicknessByComponentId: Map<number, number>` parameter (caller fetches + parses). Return `{ ok: false, error: 'BACKER_THICKNESS_MISSING', missing_component_ids: number[] }` shape if any referenced backer ID is absent or yields a null parse. |
| `lib/orders/material-regroup.ts` | Same dual-emit logic for the post-assignment regroup path. Same `backerThicknessByComponentId` parameter — populated client-side from `useBackerComponents()` data, which already exposes `parsed_thickness_mm`. |
| `app/api/orders/[orderId]/cutting-plan/aggregate/route.ts` | Resolve backer component thicknesses before calling the aggregator. Server collects all `effective_backer_id` and snapshot `backer_material_id` values, queries `SELECT component_id, description FROM components WHERE component_id IN (<ids>) AND org_id = <org>`, applies `parseThicknessFromDescription()` to each, builds the lookup map, then calls the aggregator. The enriched groups (with `sheet_thickness_mm` resolved) are returned in the response — client doesn't need to re-derive primary or snapshot-backer thickness. |
| `hooks/useCuttingPlanBuilder.ts` | Drop `hasBacker` doubling in the packing loop. Each group runs its own pack independently. For the post-assignment regroup, build `backerThicknessByComponentId` from `useBackerComponents().data.parsed_thickness_mm` (already loaded). If any user-assigned backer's `parsed_thickness_mm` is null, surface the same "fix backer description" toast and refuse to generate. |
| `lib/orders/edging-computation.ts` | Edging keys by primary group only (`(sheet_thickness, primary_material_id)`); backer groups receive `edging_by_material: []`. |
| `app/api/orders/[orderId]/cutting-plan/route.ts` | PUT: validate `body.version === 2`. Update cost calculation to iterate independent groups (each contributes `sheets_required × priceByComponentId.get(group.material_id)` plus its own edging). Drop the `backer_material_id`/`backer_sheets_required` branch. Cost should be numerically identical to today for equivalent inputs (same physical sheets, same prices, just structured by kind). |
| `hooks/useOrderCuttingPlan.ts` (and/or whichever reader hydrates `displayPlan.stale`) | On GET, if `plan.version !== 2`, return the plan with `stale: true` regardless of `source_revision`. Existing stale-warning UI in `CuttingPlanTab.tsx:55-64` covers the user affordance. No new banner. |
| `lib/piecework/cuttingPlanWorkPool.ts` | Update `batchLabel` to read `group.kind` + `material_name`. Emit `cut_pieces` activity per group. Naming now distinct: `Wenge / 16mm` (primary) vs `Super-White Melamine / 3mm Backer`. |
| `components/features/orders/CuttingPlanTab.tsx` | Material Breakdown table renders each group as a row. Drop `+ <backer>` badge inside primary rows. Add "Backer" badge to backer rows. One `<CutterCutListButton group={group}>` per row; drop the second conditional `runKind="backer"` button at line 250. |
| `components/features/cutlist/CutterCutListButton.tsx` | `getMaterialName` becomes trivial: just `group.material_name`. Drop the `runKind` prop (now redundant — derived from `group.kind`). Drop `hasBackerCutListRun` gate. One button per group; filename uses `group.kind` directly. |
| `components/features/cutlist/CutterCutListPDF.tsx` | "Backer" tag on cover/sheet header derives from `data.group.kind === 'backer'`. `data.group.material_name` is the resolved material (primary or backer) for this group directly. No structural rendering changes. |
| `components/features/orders/CuttingPlanViewer.tsx` | Group selector iterates all groups; key becomes `${group.kind}-${group.material_id}-${group.sheet_thickness_mm}`. Tab label includes kind ("Wenge 16mm", "Super-White Backer 3mm"). |
| `lib/cutlist/cutter-cut-list-helpers.ts` | Drop `hasBackerCutListRun`. Update `getCutterCutListFilename(orderNumber, group)` (drop the `runKind` parameter) to slug as `cut-list-${order}-${kind}-${thickness}mm-${material}.pdf`. Thickness in slug prevents collisions when two backer groups share a material at different thicknesses. |
| `lib/cutlist/cutter-cut-list-types.ts` | Drop `runKind` from `CutterCutListPdfData` (redundant with `data.group.kind`). Drop the `CutterCutListRunKind` type alias if no remaining consumers; otherwise keep as a re-export of `CuttingPlanMaterialGroupKind`. |
| `lib/orders/line-allocation.ts` | No structural change. Allocation reads `cutlist_material_snapshot` directly per `order_detail` (in `app/api/orders/[orderId]/cutting-plan/route.ts:256-269`), which is upstream of grouping. The dual-emit (primary + backer) happens at grouping time, not at snapshot time, so allocation area is by-construction unaffected. Add a regression test pinning pre-fix line_allocations totals on a backer-bearing fixture. |

## Phasing (for Codex execution)

1. **Phase 1 — Type shape + aggregator.** Update `cutting-plan-types.ts`, `cutting-plan-aggregate.ts`, `material-regroup.ts`. Add backer-thickness lookup. Unit tests covering the worked example + edge cases. No UI changes yet.
2. **Phase 2 — Plan generator.** Update `useCuttingPlanBuilder.ts` packing loop. Each group packs independently. `BACKER_SHEETS_REQUIRED`/`bom_estimate_backer_sheets` removed.
3. **Phase 3 — Persistence + cost.** Update `app/api/orders/[orderId]/cutting-plan/route.ts` PUT validation and cost recompute. Update `aggregate/route.ts` to resolve backer thicknesses. Stale-flag `version !== 2` on read.
4. **Phase 4 — UI surfaces.** `CuttingPlanTab.tsx` Material Breakdown rendering, `CutterCutListButton`, `CuttingPlanViewer`. Drop `hasBackerCutListRun`.
5. **Phase 5 — Work pool.** Update `cuttingPlanWorkPool.ts` `batchLabel` and per-group emission. Verify reconciliation works against new labels.
6. **Phase 6 — Tests + browser smoke.** Verify with a real bug-shape order. Verify total sheets reduced. Verify Material Breakdown renders correctly. Run lint / tsc / build.

## Acceptance Criteria

1. **Same-color consolidation** — generating a plan on an order with mixed backer/non-backer products of the same primary material at the same sheet thickness produces a single primary nest. Sheets ≤ sum of pre-fix split nests for inputs of >6 parts (typical 1–2 sheet saving).
2. **Cross-primary backer aggregation** — an order with two different primary materials sharing the same backer material at the same backer sheet thickness produces a single backer nest covering both.
3. **Material Breakdown UI** — each group renders as one row. Backer rows are visually distinct via a "Backer" badge. No `+ <backer>` badges inside primary rows.
4. **Cutter PDF** — one PDF per group via Print Cut List button. Backer PDFs identified as backer in the cover/header.
5. **Stale-flag legacy plans** — any persisted plan with `version !== 2` automatically reads as `stale: true`; the existing stale-warning UI surfaces a regenerate prompt. No TypeError or render crash on legacy plans.
6. **Piecework work pool** — generating/finalizing the new plan emits one `cut_pieces` activity per group (primary or backer). Activity labels are unambiguous (`Wenge / 16mm`, `Super-White Melamine / 3mm Backer`). No duplicate or orphan activities.
7. **Edging unchanged** — edging entries appear only on primary groups; backer groups have empty `edging_by_material`. Edging totals match pre-fix values.
8. **Line allocation unchanged** — `line_allocations` totals match pre-fix values for the same input data. (Allocation reads source snapshot, so backer-emit duplication does not double-count area.)
9. **Static checks** — `npm run lint`, `npx tsc --noEmit`, `npm run build` all clean.
10. **Browser smoke** — on a multi-product order with mixed backer requirements at the same sheet thickness, total primary sheets reduced vs current implementation; Material Breakdown shows correct row split.

## Verification Commands

```sh
# Static
npm run lint
npx tsc --noEmit
npm run build

# Diff scope
git diff origin/codex/integration --stat

# Unit tests
npx vitest run lib/orders/cutting-plan-aggregate.test.ts
npx vitest run lib/orders/material-regroup.test.ts
npx vitest run tests/edging-computation.test.ts
npx vitest run tests/cross-backer-nesting.test.ts  # new fixture file
```

Browser smoke (reviewer responsibility per workflow rule):

1. Create or use an order with: (a) Product X needing 16mm Wenge primary + Super-White backer, (b) Product Y needing 16mm Wenge primary, no backer.
2. Generate cutting plan.
3. Material Breakdown shows two rows: `16mm Wenge — N primary parts` and `3mm Super-White Melamine — M backer parts (Backer badge)`.
4. Total primary sheets ≤ pre-fix value.
5. Print Cut List on each row produces a single-kind PDF.

## Risks and edge cases

- **Backer thickness derivation is heuristic** — there is no `components.thickness_mm` column. Thickness is parsed from `components.description` via `parseThicknessFromDescription()`. A description that omits a parseable "Xmm" token (e.g. `"Super White Backer Board"`) yields `null` and the aggregator must reject the run rather than silently falling back. UI surfaces "Backer component description is missing a thickness ('3mm', '6mm', etc.) — fix the description or pick a different backer." Don't fall back to primary thickness (could pack onto wrong sheet stack).
- **`-both` doubled cuts** — preserved behavior. `-both` parts go to the primary group only. Existing under-count or correct-count behavior (whichever the codebase has today) is not changed by this ticket.
- **Per-line backer override** — `material_assignments.backer_default` already resolves at aggregation time. The new shape inherits this without change.
- **Edging on backer parts** — backer parts have no edge banding. New shape enforces this with `edging_by_material: []` on backer groups. Edging computation should not emit entries for backer parts even if a stale snapshot has them.
- **Re-snapshot semantics** — if a product's backer assignment changes from Super-White to Grey, `source_revision` already updates (via `computeSourceRevision`); plan goes stale; user re-generates. Unchanged.
- **Partial-index ON CONFLICT in work pool insert** — recurring bug class noted in memory. The PR's piecework changes go through the existing reconcile path with benign-23505 swallowing, so no new ON CONFLICT predicate work is needed.
- **View drift** — preflight confirmed no views read `orders.cutting_plan` directly. `job_work_pool_status` is already cutting-plan-aware. Safe.
- **Cost calculation parity** — `route.ts` PUT iterates `material_groups` and adds `sheets_required × price` per group. With independent backer groups, the backer's price is its own component's price, not the primary's. Update the loop to `priceByComponentId.get(group.material_id)` regardless of kind. Confirm via a unit test that mixed-shape orders cost the same as before for equivalent inputs (backer cost was already separately computed; the new structure makes this more explicit, not different).
- **Backer-emit area double-count** — backer-bearing parts emit one placement to the primary group AND one to the backer group. Allocation reads `cutlist_material_snapshot` directly per `order_detail` (not the new groups), so allocation is unaffected. Verify with a regression test that line allocations match pre-fix totals on the same input data.

## Out of scope

- Cross-thickness primary consolidation (16mm Wenge primary group and 32mm Wenge primary group stay separate — different stacks at the saw).
- Cross-material primary consolidation (16mm Wenge ≠ 16mm Cherry — different sheet stacks).
- POL-93 (Quality dropdown wiring of simulated annealing) — applies inside whichever groups exist post-this-change.
- POL-95 (in-screen viewer + relax pending-plan gate) — sibling polish, separate ticket.
- `-both` lamination semantics. Not regressed; not improved.
- Per-component stock sheet sizes (`DEFAULT_STOCK` is still 2750×1830 for all materials — separate TODO at `useCuttingPlanBuilder.ts:24`).

## Branch and Workflow

- Branch: `codex/local-cross-backer-nesting` off `origin/codex/integration` (HEAD `99faea6`).
- Workflow: GPT-5.5 Pro plan-review trial per `docs/workflow/2026-04-29-trial-gpt-pro-plan-review.md`.
  - Plan-review: spec → packet → GPT-5.5 Pro round 1 → integrate → iterate to sign-off.
  - Implementation: Codex Desktop. **Local desktop only** — Cloud branches off `main` and produces stale-base divergence.
  - Linear `delegate` stays `null` until plan-review sign-off.
- Pre-PR self-check: `git diff origin/codex/integration --stat` to surface any unrelated file changes (Cloud-stale-base bug surfaces here).
- Tenant scoping: no new tables or columns. Backer thickness lookup reads `components.description` (already org-scoped via existing RLS) and applies a pure parser.
- Wage-table safety: this ticket does not touch wage tables. If scoping drifts there, stop.
- Migration discipline: NO DDL migration. Pure JSONB shape change + version bump.

## Filesystem-grounded preflight findings (baked into this spec)

Conducted 2026-05-05 against `origin/codex/integration` @ `99faea6`:

- **Persisted plans:** 2 in production. Both test orders. Order 401 (`TEST-LC-002`) has NULL primary_material_id (legacy snapshot pre-primary resolution); order 592 (`TESTPLDESK`) has the `32mm-backer` + `16mm` shape with the same primary 385 — which exhibits the bug at the sheet-thickness level (both effectively 16mm sheets) once `parseSheetThickness` is taken into account.
- **View drift:** Clean. Only `job_work_pool_status` references `cutting_plan_*` fields and is already cutting-plan-aware.
- **Recent migrations:** `20260427152000_cutting_plan_piecework_pool_idempotency.sql` is the most recent cutting-plan migration. No DDL needed for POL-94.
- **`board_type` semantics:** `parseSheetThickness('32mm-backer') = 16` and `parseSheetThickness('32mm-both') = 16` per `lib/cutlist/boardCalculator.ts`. Sheet thickness ≠ nominal board thickness — the new grouping rule MUST use sheet thickness, not the leading number in `board_type`.
- **PDF discriminator:** `CutterCutListPdfData.runKind: 'primary' | 'backer'` exists today and is threaded through `CutterCutListPDF.tsx` for the cover/header tag. Under the new shape this is redundant with `data.group.kind` and is dropped from the type.
- **Print button surface:** `components/features/orders/CuttingPlanTab.tsx:239` (Primary) and `:250` (Backer, conditional via `hasBackerCutListRun`). Under the new shape, one button per row, no conditional.
- **Backer thickness gap:** `cutlist_material_snapshot` JSONB does not include backer thickness. The `components` table has no `thickness_mm` column either. DP5 resolves via parsing `components.description` with `parseThicknessFromDescription()` from `lib/cutlist/boardCalculator.ts`.
- **Component schema (verified):** `components` columns are `(component_id, internal_code, description, unit_id, category_id, image_url, org_id, is_active, surcharge_percentage)`. No thickness column exists. Description parsing is the only viable path without a schema change (which is out of scope for this ticket).
