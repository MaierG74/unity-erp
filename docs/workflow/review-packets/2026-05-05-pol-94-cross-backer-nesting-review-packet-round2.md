# GPT-5.5 Pro Review Packet — POL-94 Cross-color cutting-plan nesting (round 2)

**Spec under review:** [`docs/superpowers/specs/2026-05-05-cross-backer-nesting-design.md`](https://github.com/MaierG74/unity-erp/blob/codex/local-cross-backer-nesting/docs/superpowers/specs/2026-05-05-cross-backer-nesting-design.md) — v2 at commit `523a580`
**Branch:** `codex/local-cross-backer-nesting` (3 commits ahead of base)
**Base:** `codex/integration` at `99faea6`
**Round 1 packet:** [`2026-05-05-pol-94-cross-backer-nesting-review-packet.md`](https://github.com/MaierG74/unity-erp/blob/codex/local-cross-backer-nesting/docs/workflow/review-packets/2026-05-05-pol-94-cross-backer-nesting-review-packet.md)
**Author:** Claude Desktop (local), 2026-05-05

> Paste below into GPT-5.5 Pro. The spec's new "What changed in v2" section enumerates how each round-1 finding was addressed.

---

## Role

You're GPT-5.5 Pro continuing as plan-quality reviewer for POL-94 on `unity-erp` (Next.js + Supabase ERP). Round 1 returned 1 BLOCKER + 6 MAJORs + 4 MINORs; the spec author integrated them into v2. Round 2 is a verification pass — confirm the integrations don't introduce *new* gaps and check for issues round 1 missed in adjacent surfaces.

## What changed v1 → v2

See spec §What changed in v2 for the integration table. Salient deltas:

- **Type shape gains `stale_reason: 'source_changed' | 'legacy_plan_version'`** (was just `stale: boolean`).
- **Grouping rule §2** now zeros `band_edges` on backer copies and namespaces the backer copy's `id` as `${primary.id}::backer`.
- **DP5** sanity-checks parsed thickness against `{3, 6, 9, 12, 16, 18, 25, 32}`.
- **API-boundary legacy guard** in `app/api/orders/[orderId]/cutting-plan/route.ts` GET: `version !== 2` plans return `material_groups: []`, `stale_reason: 'legacy_plan_version'`. UI consumers can't crash.
- **Reconciler retire-cleanup** in Phase 5: unmatched legacy active rows with `issued_qty=0` flip to `status='cancelled'`; with `issued_qty>0` raise `cutting_plan_label_changed` exceptions.
- **Three-state load contract** in `useCuttingPlanBuilder.ts`: disabled/missing/null-or-out-of-set.
- **Filename slug** now includes `${material_id}` for uniqueness across same-description components.
- **AC1** tightened to fixture-pinned (heuristic packer caveat).

## Output you should produce

Same severity grouping (BLOCKER → MAJOR → MINOR) and reply format as round 1. For each finding cite spec section + file path/line where applicable. If a finding is "no issue, integration looks clean" for a particular round-1 item, you can mention it briefly in the verdict — but skip the formal entry.

Close with: "Sign off as-is" / "Iterate one more round" / "Multiple rounds needed."

## Specific things to review (round 2)

### 1. Reconciler retire-cleanup correctness

Spec section: §File-by-file → `lib/piecework/cuttingPlanWorkPool.ts`; §Phasing Phase 5; AC7.

The new logic walks `existingByKey` for active rows that didn't match a candidate, then:
- `issued_qty = 0` → emit a `retire` action; route applies `UPDATE job_work_pool SET status='cancelled'`
- `issued_qty > 0` → emit a `cutting_plan_label_changed` exception via the existing `upsert_job_work_pool_exception` RPC

Things to scrutinize:
- **Concurrency:** is there a race between two finalize calls where both see the legacy row as unmatched and both try to retire it? The existing reconcile path already swallows benign 23505 — does that pattern apply here, or does a `cancelled` row get re-set to `active` if the second finalize wins? Spec says nothing.
- **Exception type validity:** is `cutting_plan_label_changed` an existing `exception_type`, or does the spec need to extend the `exception_type` CHECK constraint or lookup table? Spec hand-waves this with "if it isn't already valid."
- **Scope of "unmatched":** the existing reconcile loop only considers rows where `status === 'active'` (filter at `cuttingPlanWorkPool.ts:169`). Confirm the retire walk uses the same filter (i.e. doesn't accidentally re-touch already-cancelled rows).
- **Multiple legacy rows for the same activity:** if a single v1 plan emitted multiple distinct labels for the same `piecework_activity_id` (e.g. one for primary cuts, one for backer cuts under the old combined label), are all of them retired? Or does the walk stop at the first?

### 2. API-boundary legacy guard completeness

Spec section: §DP2; §File-by-file → `app/api/orders/[orderId]/cutting-plan/route.ts`; §Phasing Phase 3; AC6.

The spec says GET returns `version: 2, material_groups: [], stale_reason: 'legacy_plan_version'` for v1 plans. Things to scrutinize:

- **Is GET the only entry point?** Does any other route, RPC, or server-side reader fetch `orders.cutting_plan` JSONB and pass it into a v2 consumer without going through the API hydration layer? Specifically: server-side rendering, work-pool sync at finalize time (which runs INSIDE the PUT), and any analytics/reporting query that touches `orders.cutting_plan`.
- **`syncCuttingPlanWorkPool` re-entry:** if a user finalizes a v2 plan but the row's persisted `cutting_plan` is still v1 (race condition between PUT and the reload), what does the work-pool sync see? PUT writes `planToSave` (v2) and immediately calls `syncCuttingPlanWorkPool(orderId, access.orgId, planToSave)` — the in-memory `planToSave` is v2. Safe. But what if a separate process reads `orders.cutting_plan` from the DB while a v1 plan is still persisted?
- **`useOrderCuttingPlan.ts` hydration vs API hydration:** spec says the type updates to v2 shape, banner switches on `stale_reason`. But if the API returns `material_groups: []`, the hook hands an empty groups array to consumers — is there ANY consumer that special-cases "empty groups" differently from "no plan exists"? E.g. `displayPlan && displayPlan.material_groups.length > 0` is the gate in `CuttingPlanTab.tsx`. Confirm by inspection.

### 3. Backer copy id namespacing knock-on effects

Spec section: §Target architecture → Grouping rule §2.

The backer copy's `id` is `${primary.id}::backer`. Things to scrutinize:

- **Filename slug:** does any other code path use `placement.part_id` to derive a filename, label, or DB key? If so, the `::` characters could break (slugs assume alphanumeric or already get sanitized — check).
- **`buildLetterMap`** in `CutterCutListPDF.tsx:191` calls `getBasePartName(placement.part_id)` to deduplicate part labels. Confirm `getBasePartName` strips namespace suffixes (or that backer cuts going through their own PDF means the namespace never appears alongside a non-namespaced primary in the same letter map).
- **`AggregatedPart.id` format:** today is `${order_detail_id}-${original_id}`. Backer copy becomes `${order_detail_id}-${original_id}::backer`. If any code splits on `-` to extract `order_detail_id`, the trailing `::backer` survives untouched, so safe. But if any code splits on `::`, double-check.

### 4. Parser sanity-check set completeness

Spec section: §DP5; AC10.

The set is `{3, 6, 9, 12, 16, 18, 25, 32}`. Things to scrutinize:

- **Is this the complete set of legitimate backer thicknesses in unity-erp?** Greg's furniture domain may include thicknesses outside this set (e.g. 4mm hardboard, 3.2mm, 2.5mm laminates). Spec says "known-backer-thickness set" — is this list filesystem-derivable, or is it a magic-number list that will rot?
- **Should the validation be primary-thickness-aware?** A backer for a 16mm primary is typically ≤ the primary thickness. The spec doesn't enforce this — it just checks set membership. Is there a meaningful safety check from "backer < primary thickness"?
- **Is 32mm a realistic backer thickness?** Backers are typically thin laminates (3-6mm). Allowing 32mm in the validation set might let a misconfigured "32mm Wenge" survive as a backer. Worth tightening?

### 5. Three-state load contract edge case

Spec section: §File-by-file → `hooks/useCuttingPlanBuilder.ts`.

Three states: (1) loading, (2) ID missing from map, (3) parsed_thickness null or out of set. Things to scrutinize:

- **Optimistic update during user backer reassignment:** when the user picks a different backer in `MaterialAssignmentGrid`, the assignment is staged via `useMaterialAssignments` and flushed before generation. Between pick and flush, what does the load-state contract see? Is there a window where `partRoles` is computed from stale assignments and the new backer's thickness lookup hasn't been triggered yet?
- **Per-line backer override (POL-83):** if line A and line B resolve to different backers via per-line override, both backers' thicknesses must be in the lookup. Does `useBackerComponents()` return ALL backer components, or only some? (Likely all that match the BACKER_CATEGORY_IDS filter — confirm.)
- **Toast vs disabled-button preference:** the spec says button disabled while loading, toast on click otherwise. Is "disabled while loading" the right UX, or should "Generating..." spinner with deferred validation be used? (Today's behavior is unclear from spec.)

### 6. AC verification breadth

Spec section: §Acceptance Criteria.

The 12 ACs cover: bug-fixture, multi-primary backer aggregation, POL-83 override, UI shape, backer edge-neutral PDF, legacy v1 suppression, work-pool retire, edging unchanged, line allocation unchanged, parser sanity, static checks, browser smoke. Round 2 question:

- **Is anything still missing?** Specifically: cost calculation parity has a Risks bullet but no AC. Should there be an AC pinning per-fixture cost equality (pre-fix `total_nested_cost` vs post-fix on the same input)?
- **`-both` regression coverage** — Phase 1 fixture (e) covers "no-op pass-through," but no AC explicitly asserts `-both` parts produce the same sheet count and cost as today. If a future change quietly modified `-both` handling, the test wouldn't catch it. Acceptable, or worth tightening?

## Questions for round 2

1. Concurrency on retire vs concurrent finalize — is the existing reconcile pattern (insert-or-23505-swallow + status='active' filter) sufficient to prevent flapping, or does the retire path need its own idempotency guard?
2. Is `cutting_plan_label_changed` a valid `exception_type` already, or does Phase 5 need a CHECK widen (DDL would then be added back to the spec — currently claimed "no DDL")? If DDL is needed, that affects DP6's "no DDL" claim and migration discipline.
3. Are there backer thicknesses outside `{3, 6, 9, 12, 16, 18, 25, 32}` in production unity-erp data?

## What you do NOT need to re-review

- Decisions DP1, DP3 (resolved in round 1, unchanged in v2)
- POL-92 (shipped), POL-93 + POL-95 (separate tickets)
- The `-both` upstream pre-doubling — verified in round 1's verification step (test order 401's snapshot has 2 entries per visible part).
- Workflow process or commit message style.

## Reply format

Same as round 1. Group by severity. Each finding: spec section, issue, fix shape. If you find no new issues at a severity, say "None" under that heading. Close with the verdict.
