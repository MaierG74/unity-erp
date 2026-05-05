---
issue: POL-94
title: Same-primary nesting across backer/non-backer groups (cutting plan optimization)
status: v2 — post-GPT-5.5-Pro-round-1
date: 2026-05-05
branch: codex/local-cross-backer-nesting (off origin/codex/integration @ 99faea6)
related: POL-92 (cutter cut-list PDF, shipped), POL-93 (Quality dropdown wiring, queued)
review-rounds: round 1 — 1 BLOCKER + 6 MAJORs + 4 MINORs (all integrated)
---

# Cross-color cutting-plan nesting (POL-94)

## What changed in v2 (post round-1)

Round-1 review surfaced 1 BLOCKER + 6 MAJORs + 4 MINORs. All integrated:

| # | Severity | Issue | Where addressed in v2 |
|---|---|---|---|
| 1 | BLOCKER | Work-pool reconciler leaves legacy active rows orphaned on label change | DP4, Phase 5 retire-cleanup, AC7 (seeded regression test), Risks: "Legacy work-pool orphan rows" |
| 2 | MAJOR | `-both` doubled cuts under-specified — verified in code | DP6, Grouping rule §4 (pre-doubled at source verified via test order 401), Phase 1 fixture (e), Risks: `-both` |
| 3 | MAJOR | Backer copy keeping `band_edges` contradicts "no edge banding" | Grouping rule §2 (zeroed band_edges + namespaced id), Phase 1 fixture (d), AC5 |
| 4 | MAJOR | Stale-flag insufficient — v2 UI consumers crash on v1 data | DP2, Phase 3 API-boundary suppression, AC6 (smoke on order 592), Risks: "Legacy v1 plan UI rendering crash" |
| 5 | MAJOR | Client load-state contract for backer-thickness lookup | File-by-file: `useCuttingPlanBuilder.ts` three-state contract |
| 6 | MAJOR | POL-83 per-line override behavior needs a fixture | Phase 1 fixture (c), AC3 |
| 7 | MAJOR | Parser only handles null, not silent-wrong-parses | DP5 sanity-check on known-thickness set, AC10, Risks: "silent-wrong-parse capable" |
| 8 | MINOR | Stale banner wording wrong for version-only invalidation | Type shape: `stale_reason: 'source_changed' \| 'legacy_plan_version'` field; banner copy switches |
| 9 | MINOR | Filename slug can collide on duplicate descriptions | File-by-file: slug includes `${material_id}` |
| 10 | MINOR | TL;DR under-specifies that `kind` is part of group identity | TL;DR clarified to `(kind, sheet_thickness_mm, material_id)` |
| 11 | MINOR | AC1 sheet-saving assertion too broad for heuristic packer | AC1 tightened to fixture-pinned, not general inequality |

Verifications run before integrating (saved to spec body):
- `parseThicknessFromDescription` regex confirmed brittle (`316mm offcut` → 316). Sanity-check set `{3, 6, 9, 12, 16, 18, 25, 32}` added.
- `-both` doubling confirmed pre-encoded in `product_cutlist_groups.parts` (test order 401: 1 visible part × 2 entries → 2 placements on 1 sheet).
- `job_work_pool.status` CHECK enum is `('active', 'cancelled')` only — no DDL needed for retire.
- `band_edges` flows through `CutlistSnapshotPart → AggregatedPart → Placement → cutter PDF`. Zeroing on backer copy is mechanically straightforward.

## TL;DR

Reshape `CuttingPlan.material_groups` so **primary** and **backer** are independent dimensions. One nest per `(kind, sheet_thickness_mm, material_id)` triple — i.e. primary groups consolidate within `kind: 'primary'`, backer groups consolidate within `kind: 'backer'`. Same-color parts across products in an order pack together into a single nest of their kind.

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
| **DP1** — Plan shape | **Option B** — split into independent groups. Primary keyed by `(sheet_thickness_mm, primary_material_id)`. Backer keyed by `(sheet_thickness_mm, backer_material_id)` — no source-primary in the key, so two primaries that share a backer material pack as one backer nest. Full key including discriminator is `(kind, sheet_thickness_mm, material_id)`. |
| **DP2** — Migration | No JSONB migration. `CuttingPlan.version` bumps from `1` to `2`. **At the API/route boundary**, `version !== 2` plans return with `material_groups: []`, `stale: true`, and `stale_reason: 'legacy_plan_version'`; v2-only consumers (Material Breakdown, Print buttons, Viewer, work pool sync) therefore have nothing to render or operate on. The yellow stale banner shows a version-specific message: "This cutting plan uses an older format. Re-generate to update it." Only 2 test plans persisted; no production data at risk. |
| **DP3** — UI row treatment | Each group is its own top-level row in Material Breakdown. Backer rows wear a "Backer" badge. No "Backer of: \<primary\>" cross-reference (a backer nest can serve multiple primaries). One Print Cut List button per row. |
| **DP4** — Work pool / piecework | Each group emits its own piecework activity. Backer nest is its own `cut_pieces` card, distinct from the primary cards it backs. Naming change in `batchLabel()`; counting logic unchanged. **Reconciler retires unmatched legacy active rows** (see Phase 5 below): rows with `issued_qty = 0` get `status = 'cancelled'`; rows with `issued_qty > 0` generate a `cutting_plan_label_changed` exception so dispatched work isn't silently lost. |
| **DP5** — Backer thickness derivation | Parsed at aggregation time from `components.description` via `parseThicknessFromDescription()` (per `lib/cutlist/boardCalculator.ts`). The `components` table has no dedicated `thickness_mm` column. Parser regex (verified) is `(?:^|\s)(\d+(?:\.\d+)?)\s*mm` with an LxWxT pre-pass — which yields a number for *any* description containing a digit-mm token, including misleading ones like `"316mm offcut"`. Aggregator therefore enforces a sanity check: parsed thickness must be in the known backer-thickness set `{3, 6, 9, 12, 16, 18, 25, 32}`. Out-of-set or null parses → error result, surface a "fix backer description" prompt, refuse to generate. |
| **DP6** — Out of scope | Different sheet-thicknesses stay separate (16mm Wenge ≠ 32mm Wenge). Different primary materials stay separate (16mm Wenge ≠ 16mm Cherry). POL-93 SA wiring stays orthogonal. **`-both` is pre-doubled at the source** (`product_cutlist_groups.parts` already contains 2 entries per visible part for `-both` board types — verified via test order 401 which has `32mm-both` 2 parts on 1 sheet). The new aggregator passes parts through 1:1; no special doubling logic needed. |

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

export type CuttingPlanStaleReason = 'source_changed' | 'legacy_plan_version';

export type CuttingPlan = {
  version: 2;                      // ← bumped
  stale: boolean;
  /** Why this plan reads as stale; null when stale=false. Drives the
   *  banner copy in CuttingPlanTab.tsx. */
  stale_reason: CuttingPlanStaleReason | null;
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
2. **If** the snapshot group's `board_type` ends with `-backer`, **also** emit a copy of the part to a backer group keyed by `(backer_sheet_thickness_mm, resolved_backer_material_id)`. The backer copy:
   - has the **same dimensions and grain** as the primary (the backer cut is dimensionally identical — it's the back face of the same physical part)
   - has **`band_edges` zeroed** (`{ top: false, right: false, bottom: false, left: false }`) — backer parts never carry edge banding
   - has **no edging assignment** (the backer copy isn't fed to `edging-computation` at all)
   - has `material_id = resolved_backer_material_id`
   - has a namespaced `id` of `${primary.id}::backer` to keep the cutter PDF's `buildLetterMap` and the packer's de-dupe consistent across groups
3. `backer_sheet_thickness_mm` is parsed from the resolved backer component's `description` via `parseThicknessFromDescription()` (DP5). Server-side: the aggregate endpoint fetches `(component_id, description)` for all referenced backer IDs in one query, parses with `parseThicknessFromDescription`, and validates the result is in the known-backer-thickness set `{3, 6, 9, 12, 16, 18, 25, 32}`. Out-of-set or null → aggregator returns `{ ok: false, error: 'BACKER_THICKNESS_INVALID', missing_or_invalid_component_ids: number[] }`; the UI surfaces a "fix backer description or pick a different backer" prompt and refuses to generate.
4. **`-both` board_types remain primary-only — no backer emission.** The doubled-cut behavior is encoded *upstream* in `product_cutlist_groups.parts`: a `32mm-both` group's `parts` JSONB already contains 2 entries per visible part (front face + back face), so the snapshot, aggregator, and packer naturally produce 2 placements per visible part. POL-94 makes no change here — the 2-entry pattern flows through the new shape unchanged.

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
| `lib/orders/cutting-plan-aggregate.ts` | Rewrite `resolveAggregatedGroups`: emit primary group for every part, plus a band-edges-zeroed backer copy (id `${part.id}::backer`) for every `-backer` part. Add `backerThicknessByComponentId: Map<number, number>` parameter. Return `{ ok: false, error: 'BACKER_THICKNESS_INVALID', missing_or_invalid_component_ids: number[] }` if any referenced backer ID is absent, yields a null parse, OR yields a value outside the known-backer-thickness set. |
| `lib/orders/material-regroup.ts` | Same dual-emit logic with band_edges zeroing on the backer copy and the `::backer` id namespacing for the post-assignment regroup path. Same `backerThicknessByComponentId` parameter — populated client-side from `useBackerComponents()` data. Apply the same known-thickness sanity check on the client side. |
| `app/api/orders/[orderId]/cutting-plan/aggregate/route.ts` | Resolve backer component thicknesses before calling the aggregator. Server collects all `effective_backer_id` and snapshot `backer_material_id` values, queries `SELECT component_id, description FROM components WHERE component_id IN (<ids>) AND org_id = <org>`, applies `parseThicknessFromDescription()` to each, validates against the known-thickness set, then builds the lookup map and calls the aggregator. The enriched groups (with `sheet_thickness_mm` resolved) are returned in the response. |
| `hooks/useCuttingPlanBuilder.ts` | Drop `hasBacker` doubling in the packing loop. Each group runs its own pack independently. **Load-state contract for the backer-thickness lookup:** (1) while `useBackerComponents().data === undefined` OR `useBoardComponents().data === undefined`, the Generate button is disabled (existing `canGenerate` gate already covers `partRoles.length === 0`); (2) on click, if any assigned-or-snapshot backer ID is missing from the loaded components map, surface a toast `"Backer component not found — reload the page or pick a different backer"` and refuse to generate; (3) if a backer ID is present but `parsed_thickness_mm` is null OR outside the known-thickness set, surface a toast `"Backer description '<desc>' has no parseable thickness — fix the description or pick a different backer"` and refuse. The toast distinguishes the three states. |
| `lib/orders/edging-computation.ts` | Edging keys by primary group only (`(sheet_thickness, primary_material_id)`); backer groups receive `edging_by_material: []`. |
| `app/api/orders/[orderId]/cutting-plan/route.ts` | **PUT:** validate `body.version === 2`. Update cost calculation to iterate independent groups (each contributes `sheets_required × priceByComponentId.get(group.material_id)` plus its own edging). Drop the `backer_material_id`/`backer_sheets_required` branch. Cost numerically identical to today for equivalent inputs. **GET (or wherever the API hydrates the plan response):** if persisted `cutting_plan.version !== 2`, return `{ ...plan, version: 2, stale: true, stale_reason: 'legacy_plan_version', material_groups: [], component_overrides: [], total_nested_cost: 0, line_allocations: [] }`. The empty `material_groups` array means no v2-shape consumer can crash on missing `kind`/`material_id`/`sheet_thickness_mm` fields. |
| `hooks/useOrderCuttingPlan.ts` | Type the hook's return as the v2 `CuttingPlan` shape. Stale UI logic switches on `stale_reason`: `'source_changed'` keeps today's "Order has changed since this plan was generated. Re-generate for accurate results." `'legacy_plan_version'` shows "This cutting plan uses an older format. Re-generate to update it." Both surface the same Re-generate button. |
| `lib/piecework/cuttingPlanWorkPool.ts` | Update `batchLabel` to read `group.kind` + `material_name`. Emit `cut_pieces` activity per group. Labels: `Wenge / 16mm` (primary), `Super-White Melamine / 3mm Backer` (backer). **Reconciler retire-cleanup (new behavior in `reconcileCuttingPlanWorkPool`):** after computing `inserts`/`updates`/`exceptions` against the new candidates, walk the `existingByKey` map for any `active` rows that did NOT match a candidate. Two outcomes: (a) `issued_qty === 0` → emit a `retire` action that the route applies as `UPDATE job_work_pool SET status='cancelled' WHERE pool_id=$1`; (b) `issued_qty > 0` → emit a `cutting_plan_label_changed` exception via the existing `upsert_job_work_pool_exception` RPC, preserving dispatched-work visibility. Add `retires: PoolReconcileRetire[]` to `PoolReconcilePlan`; route applies them after inserts/updates. |
| `components/features/orders/CuttingPlanTab.tsx` | Material Breakdown table renders each group as a row. Drop `+ <backer>` badge inside primary rows. Add "Backer" badge to backer rows. One `<CutterCutListButton group={group}>` per row; drop the second conditional `runKind="backer"` button at line 250. |
| `components/features/cutlist/CutterCutListButton.tsx` | `getMaterialName` becomes trivial: just `group.material_name`. Drop the `runKind` prop (now redundant — derived from `group.kind`). Drop `hasBackerCutListRun` gate. One button per group; filename uses `group.kind` directly. |
| `components/features/cutlist/CutterCutListPDF.tsx` | "Backer" tag on cover/sheet header derives from `data.group.kind === 'backer'`. `data.group.material_name` is the resolved material (primary or backer) for this group directly. No structural rendering changes. |
| `components/features/orders/CuttingPlanViewer.tsx` | Group selector iterates all groups; key becomes `${group.kind}-${group.material_id}-${group.sheet_thickness_mm}`. Tab label includes kind ("Wenge 16mm", "Super-White Backer 3mm"). |
| `lib/cutlist/cutter-cut-list-helpers.ts` | Drop `hasBackerCutListRun`. Update `getCutterCutListFilename(orderNumber, group)` (drop the `runKind` parameter) to slug as `cut-list-${order}-${kind}-${thickness}mm-${material_id}-${material}.pdf` — `material_id` makes the slug unique even when two active components share a description. Thickness disambiguates same-material at different thicknesses. |
| `lib/cutlist/cutter-cut-list-types.ts` | Drop `runKind` from `CutterCutListPdfData` (redundant with `data.group.kind`). Drop the `CutterCutListRunKind` type alias if no remaining consumers; otherwise keep as a re-export of `CuttingPlanMaterialGroupKind`. |
| `lib/orders/line-allocation.ts` | No structural change. Allocation reads `cutlist_material_snapshot` directly per `order_detail` (in `app/api/orders/[orderId]/cutting-plan/route.ts:256-269`), which is upstream of grouping. The dual-emit (primary + backer) happens at grouping time, not at snapshot time, so allocation area is by-construction unaffected. Add a regression test pinning pre-fix line_allocations totals on a backer-bearing fixture. |

## Phasing (for Codex execution)

1. **Phase 1 — Type shape + aggregator.** Update `cutting-plan-types.ts` (discriminated union, `version: 2`, `stale_reason` field), `cutting-plan-aggregate.ts`, `material-regroup.ts`. Add backer-thickness lookup with known-thickness sanity check. Unit tests covering: (a) the worked example bug fixture, (b) multi-primary shared-backer, (c) per-line POL-83 override fixture (two lines of the same product resolve to different effective primary materials), (d) band_edges-zeroed assertion on backer copies, (e) `-both` no-op pass-through, (f) parser sanity check (descriptions yielding 316mm, "Super White Backer Board", "5x6 panel" all rejected).
2. **Phase 2 — Plan generator.** Update `useCuttingPlanBuilder.ts` packing loop (independent per-group packs). Implement the load-state contract (Generate disabled while components loading; three-state toast on click). `backer_sheets_required`/`bom_estimate_backer_sheets` removed from the constructed plan.
3. **Phase 3 — Persistence + cost + legacy guard.** Update `app/api/orders/[orderId]/cutting-plan/route.ts` PUT validation and cost recompute. Update `aggregate/route.ts` to resolve+validate backer thicknesses. **API-boundary legacy guard:** GET hydrates `version !== 2` plans with empty `material_groups` and `stale_reason: 'legacy_plan_version'` so v2 consumers can't crash on missing fields. `useOrderCuttingPlan.ts` switches banner copy on `stale_reason`.
4. **Phase 4 — UI surfaces.** `CuttingPlanTab.tsx` Material Breakdown row-per-group, "Backer" badge. `CutterCutListButton` props simplified (drop `runKind`, drop `hasBackerCutListRun`). `CuttingPlanViewer` group selector iterates all groups. Filename slug uses `${material_id}` for uniqueness. Smoke-test the two known v1 persisted plans (orders 401 and 592): Material Breakdown shows nothing, banner shows the legacy-version message, Re-generate button works.
5. **Phase 5 — Work pool.** Update `cuttingPlanWorkPool.ts` `batchLabel` for the new shape. **Add retire-cleanup logic to `reconcileCuttingPlanWorkPool`:** unmatched active rows with `issued_qty=0` get cancelled; with `issued_qty>0` generate a `cutting_plan_label_changed` exception. Extend `PoolReconcilePlan` with `retires: PoolReconcileRetire[]`. Route applies retires after inserts/updates. Add `cutting_plan_label_changed` to the exception_type CHECK or lookup if it isn't already valid. **Regression test:** seed a `job_work_pool` row with a legacy `material_color_label`, finalize a v2 plan, assert the legacy row's status flipped to `cancelled` (issued_qty=0 case) or an exception was raised (issued_qty>0 case).
6. **Phase 6 — Edging + line-allocation regression coverage.** `lib/orders/edging-computation.ts`: confirm edging only emits on primary groups; backer groups have empty `edging_by_material`. `lib/orders/line-allocation.ts`: pin pre-fix line_allocations totals on a backer-bearing fixture (snapshot is upstream of grouping; should be by-construction unchanged). Run lint / tsc / build / browser smoke.

## Acceptance Criteria

1. **Bug-fixture consolidation** — on the named bug fixture (16mm African Wenge primary across one product needing a Super-White backer and one not), the new plan produces exactly one `kind: 'primary'` group for 16mm Wenge containing all 40 parts and exactly one `kind: 'backer'` group for the backer material. The fixture asserts a specific sheet count for the consolidated primary nest (locked to the packer's deterministic output for this input — heuristic packers can occasionally regress on unrelated inputs, so the assertion is fixture-pinned, not a general inequality).
2. **Cross-primary backer aggregation** — an order with two different primary materials sharing the same backer material at the same backer sheet thickness produces a single backer nest covering both, with parts from both primaries in `total_parts`.
3. **Per-line POL-83 override** — a fixture with two order lines of the same product, where line A's `cutlist_primary_material_id` resolves to Wenge and line B's resolves to Cherry, produces two distinct primary groups (Wenge and Cherry), parts correctly partitioned by line. `line_allocations` totals match pre-fix values for this input.
4. **Material Breakdown UI** — each group renders as one row. Backer rows are visually distinct via a "Backer" badge. No `+ <backer>` badges inside primary rows. Filename slug uses `${kind}-${thickness}mm-${material_id}-${material}` and is unique across all groups in the plan.
5. **Cutter PDF backer parts edge-neutral** — for any backer group, the cutter PDF renders no edge-band lines and no edge column entries in the legend. `band_edges` on backer placements is `{ top:false, right:false, bottom:false, left:false }` regardless of what the corresponding primary part carries.
6. **Legacy v1 plan suppression** — fetching the persisted v1 plan on order 592 (`TESTPLDESK`) returns `material_groups: []`, `stale: true`, `stale_reason: 'legacy_plan_version'`. Material Breakdown renders empty, the legacy-version banner shows ("This cutting plan uses an older format. Re-generate to update it."), no TypeError, no render crash, Print buttons absent. After clicking Re-generate, the new shape lands on disk.
7. **Piecework work pool** — generating/finalizing the new plan emits one `cut_pieces` activity per group (primary or backer). Activity labels are unambiguous (`Wenge / 16mm`, `Super-White Melamine / 3mm Backer`). On finalize over a previously-finalized v1 plan, **legacy unmatched active rows with `issued_qty=0` are flipped to `status='cancelled'`**, and rows with `issued_qty>0` raise a `cutting_plan_label_changed` exception. No duplicate active rows remain. (Regression test seeded with a legacy row to verify this branch.)
8. **Edging unchanged** — edging entries appear only on primary groups; backer groups have empty `edging_by_material`. Total edging meters per material match pre-fix values for equivalent inputs.
9. **Line allocation unchanged** — `line_allocations` totals match pre-fix values byte-for-byte on a backer-bearing fixture (allocation reads upstream snapshot, not groups).
10. **Backer thickness sanity check** — aggregator rejects backer components whose description parses to null OR to a value outside the known-thickness set `{3, 6, 9, 12, 16, 18, 25, 32}`. Test cases: `"Super White Backer Board"` (null), `"316mm offcut"` (316, out of set), `"3mm Super-White Melamine"` (3, valid). UI surfaces the fix-prompt for the first two.
11. **Static checks** — `npm run lint`, `npx tsc --noEmit`, `npm run build` all clean.
12. **Browser smoke** — on a real bug-shape order with mixed backer requirements at the same sheet thickness: (a) Material Breakdown shows two rows (one primary, one backer with badge), (b) total primary sheets reduced vs current implementation, (c) Print Cut List on each row produces a single-kind PDF.

## Verification Commands

```sh
# Static
npm run lint
npx tsc --noEmit
npm run build

# Diff scope
git diff origin/codex/integration --stat

# Unit tests
npx vitest run lib/orders/cutting-plan-aggregate.test.ts   # extended for: dual-emit, band_edges zeroed, -both no-op, POL-83 override, parser sanity
npx vitest run lib/orders/material-regroup.test.ts          # same extensions for the post-assignment regroup path
npx vitest run tests/edging-computation.test.ts             # backer groups produce empty edging_by_material
npx vitest run tests/cross-backer-nesting.test.ts           # new fixture: bug-shape, multi-primary shared-backer, line-allocation parity
npx vitest run lib/piecework/cuttingPlanWorkPool.test.ts    # extended: retire-cleanup with seeded legacy active row
```

Browser smoke (reviewer responsibility per workflow rule):

1. Open order 592 (`TESTPLDESK`) — has a persisted v1 plan. Verify Material Breakdown is empty, the legacy-version banner reads "This cutting plan uses an older format. Re-generate to update it.", no console TypeErrors, Print buttons absent.
2. Click Re-generate. New v2 plan persists. Material Breakdown now shows the v2 row split.
3. Create or use an order with: (a) Product X needing 16mm Wenge primary + Super-White backer, (b) Product Y needing 16mm Wenge primary, no backer.
4. Generate cutting plan. Material Breakdown shows two rows: `16mm Wenge — N primary parts` and `3mm Super-White Melamine — M backer parts (Backer badge)`. Total primary sheets ≤ pre-fix value.
5. Print Cut List on each row produces a single-kind PDF; backer PDF cover/header shows "Backer" tag; backer placements have no edge-band lines.
6. (If feasible) seed a legacy `job_work_pool` row with `material_color_label` matching the old v1 label format; finalize the v2 plan; verify the legacy row's `status` is now `'cancelled'` (or an exception was raised if it had `issued_qty > 0`).

## Risks and edge cases

- **Backer thickness derivation is heuristic AND silent-wrong-parse capable.** No `components.thickness_mm` column exists. Parser regex is `(?:^|\s)(\d+(?:\.\d+)?)\s*mm` (with an LxWxT pre-pass). Misleading descriptions produce non-null, wrong values: `"316mm offcut"` → 316, `"5x6 panel 16mm part"` → 16 (might be the wrong layer). Mitigation: aggregator validates parsed thickness is in the known-backer-thickness set `{3, 6, 9, 12, 16, 18, 25, 32}` and rejects out-of-set or null. AC10 pins this with explicit fixture cases.
- **`-both` is pre-doubled at the source.** Verified: `product_cutlist_groups.parts` for a `-both` board_type contains 2 entries per visible part. Test order 401's `32mm-both` group has 2 parts on 1 sheet — consistent with 1 visible part × 2 face cuts. The aggregator passes parts through 1:1 with no special doubling. POL-94 makes no change to `-both` handling.
- **Per-line backer override** — `material_assignments.backer_default` and POL-83's `cutlist_primary_backer_material_id` already resolve at aggregation time via `effective_backer_id`. The new shape inherits this. AC3 pins per-line POL-83 override behavior in a fixture.
- **Edging on backer parts** — backer copies emit with `band_edges: { top:false, right:false, bottom:false, left:false }` and no edging assignment. Edging computation iterates primary groups only. AC5 asserts the cutter PDF renders zero edge-band lines on backer placements.
- **Re-snapshot semantics** — `source_revision` already updates on backer reassignment via `computeSourceRevision`; plan goes stale; user re-generates. Unchanged.
- **Partial-index ON CONFLICT in work pool insert** — recurring bug class noted in memory. The PR's piecework changes go through the existing reconcile path with benign-23505 swallowing; no new ON CONFLICT predicate work is needed.
- **View drift** — preflight confirmed no views read `orders.cutting_plan` directly. `job_work_pool_status` is already cutting-plan-aware. Safe.
- **Cost calculation parity** — `route.ts` PUT iterates `material_groups` and adds `sheets_required × price` per group. With independent backer groups, the backer's price is its own component's price, not the primary's. Update the loop to `priceByComponentId.get(group.material_id)` regardless of kind. Numerically identical to today for equivalent inputs.
- **Backer-emit area double-count** — backer-bearing parts emit one placement to the primary group AND one to the backer group. Allocation reads `cutlist_material_snapshot` directly per `order_detail` (not the new groups), so allocation is unaffected by construction. AC9 pins this with a regression test.
- **Legacy work-pool orphan rows.** Pre-existing `job_work_pool` rows finalized under v1 have legacy labels (`Wenge / Super-White / 32mm-backer`). The new candidate labels (`Wenge / 16mm` + `Super-White Melamine / 3mm Backer`) don't match by `(piecework_activity_id, material_color_label)`. Mitigation: reconciler retire-cleanup (Phase 5) cancels unmatched issued_qty=0 rows and raises a `cutting_plan_label_changed` exception for issued_qty>0 rows. AC7 pins this with a seeded regression test.
- **Legacy v1 plan UI rendering crash.** The existing stale yellow banner is cosmetic; v2-shape consumers (Material Breakdown table, Print buttons, Viewer, work pool sync) still operate on `material_groups` and would TypeError on missing `kind`/`material_id`/`sheet_thickness_mm`. Mitigation: API-boundary suppression (Phase 3) returns v1 plans with `material_groups: []`, so v2 consumers have nothing to render. AC6 pins this on the persisted order 592.

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
