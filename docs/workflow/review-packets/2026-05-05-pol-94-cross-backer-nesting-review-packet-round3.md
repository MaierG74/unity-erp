# GPT-5.5 Pro Review Packet — POL-94 Cross-color cutting-plan nesting (round 3)

**Spec under review:** [`docs/superpowers/specs/2026-05-05-cross-backer-nesting-design.md`](https://github.com/MaierG74/unity-erp/blob/codex/local-cross-backer-nesting/docs/superpowers/specs/2026-05-05-cross-backer-nesting-design.md) — v3 at commit `e4d45d2`
**Branch:** `codex/local-cross-backer-nesting` (5 commits ahead of base)
**Base:** `codex/integration` at `99faea6`
**Round 2 packet:** [`...-review-packet-round2.md`](https://github.com/MaierG74/unity-erp/blob/codex/local-cross-backer-nesting/docs/workflow/review-packets/2026-05-05-pol-94-cross-backer-nesting-review-packet-round2.md)
**Author:** Claude Desktop (local), 2026-05-05

> Paste below into GPT-5.5 Pro. The spec's new "What changed in v3" section enumerates how each round-2 finding was addressed.

---

## Role

You're GPT-5.5 Pro continuing as plan-quality reviewer for POL-94. Round 2 returned 2 BLOCKERs + 5 MAJORs + 2 MINORs; the spec author integrated them into v3 with two DB verifications baked in. Round 3 is a final-pass check — confirm v3 integrations don't introduce new gaps and decide whether the spec is implementation-ready.

## What changed v2 → v3

See spec §What changed in v3 for the integration table. Salient deltas:

- **BLOCKER 1 (retire race):** SQL-side race guard `WHERE pool_id=$1 AND org_id=$2 AND source='cutting_plan' AND status='active' AND issued_qty=0`. `rowCount=0` falls through to refetch + exception path, never silently cancels dispatched work.
- **BLOCKER 2 (exception_type):** DB query confirmed CHECK constraint is closed-set (`'over_issued_override','over_issued_after_reconcile','cutting_plan_issued_count_changed'`). Spec reuses `cutting_plan_issued_count_changed` with `trigger_context.legacy_label_orphan: true` + `previous_label`. NO DDL.
- **MAJOR 1 (legacy GET):** Replaced fake-zero v2 coercion with a `DisplayPlanState = { kind: 'none' } | { kind: 'legacy', persistedVersion, ... } | { kind: 'current', plan }` discriminated union. v1 JSONB stays untouched on disk. UI consumers gate on `state.kind === 'current'`.
- **MAJOR 2 (thickness set):** Replaced magic-number set with plausibility check: `category_id ∈ BACKER_CATEGORY_IDS` + non-null parse + `0.5 ≤ thickness ≤ 50` mm. Grounded in DB inventory audit (production has {1.6, 3, 16, 22, 30}; only 16mm currently used).
- **MAJOR 3 (cost AC):** New AC11 pins formula correctness on bug + multi-primary fixtures.
- **MAJOR 4 (`::backer` display):** `getBasePartName()` in `lib/cutlist/colorAssignment.ts` strips `::<suffix>` namespacing.
- **MAJOR 5 (load contract):** Validation explicitly runs after `flushAssignments()` + aggregate refetch. New "change backer → immediately generate" fixture.
- **MINOR 2 (`-both` AC):** New AC12 pins `-both` placement + sheet count parity.

## Output you should produce

Same severity grouping (BLOCKER → MAJOR → MINOR) and reply format as round 1/2.

If you find no blockers and the architecture is implementation-ready, close with: **"Sign off as-is — Codex implementation can proceed."** Otherwise: "Iterate one more round" with severity-grouped findings.

## Specific things to verify in v3

### 1. DisplayPlanState consumer audit

Spec section: §Type shape; §File-by-file → `app/api/orders/[orderId]/cutting-plan/route.ts`, `hooks/useOrderCuttingPlan.ts`; AC6.

The spec switches from "API returns a coerced v2 plan" to "API returns a discriminated union; consumers switch on `kind`." Verify:

- **All v2-shape consumers must gate on `kind === 'current'`.** The spec lists the gate at the UI level (CuttingPlanTab, CuttingPlanViewer, CutterCutListButton). Are there server-side consumers that read `cutting_plan` JSONB AND would now need to handle the legacy state distinctly? E.g. `syncCuttingPlanWorkPool` runs at PUT time on a freshly-built v2 plan — safe by construction. But are there cron jobs, edge functions, exports, or RPCs that read persisted `cutting_plan` and would break?
- **Type-level enforcement.** Is the union discriminator strong enough that a consumer accessing `state.plan` without first checking `kind === 'current'` would be a TypeScript error? Or does the spec rely on convention?
- **PUT path with legacy state.** The spec says "no PUT trigger on legacy state" — is this enforced (e.g. UI omits the action) or is there a route-level guard against mutating a legacy plan?

### 2. Retire race-guard atomicity

Spec section: §DP4; §File-by-file → `lib/piecework/cuttingPlanWorkPool.ts`; §Phasing Phase 5; AC7.

The race-guarded UPDATE is a single SQL statement: `UPDATE ... WHERE pool_id=$1 AND org_id=$2 AND source='cutting_plan' AND status='active' AND issued_qty=0`. PostgreSQL row-level locks during UPDATE prevent two transactions cancelling the same row. `rowCount=0` triggers refetch.

Verify:

- **Refetch read-modify-write loop:** spec says on `rowCount=0`, "refetch the row; if `status='cancelled'` already, no-op (concurrent finalize won); if `issued_qty > 0`, fall through to the exception path." Is the refetch+exception path itself race-safe? E.g. if two finalizers BOTH see `rowCount=0`, both refetch, both see `issued_qty>0`, both call `upsert_job_work_pool_exception` — does the RPC's existing idempotency (which today handles the count-change case) cover this?
- **Cross-finalize ordering:** is there any guarantee that a single PUT request's reconcile→retire sequence is atomic, or could a partial retire + partial insert leave the work pool in a temporarily inconsistent state? (Spec doesn't claim transactional atomicity over the entire reconcile; should it?)
- **Exception type semantics:** `cutting_plan_issued_count_changed` is being reused with `trigger_context.legacy_label_orphan: true`. Is there a downstream consumer of `job_work_pool_exceptions` (UI, reports, alerts) that filters or labels exceptions by `exception_type` only and would lump label-orphans together with count-changes in confusing ways?

### 3. `getBasePartName` strip — safe for all callers?

Spec section: Grouping rule §2; §Phasing Phase 4.

The change strips `::<suffix>` from any part_id passed to `getBasePartName`. Verify:

- **Existing callers** (search `getBasePartName` usages in `unity-erp` repo): does any caller pass a part_id that legitimately contains `::` for non-namespacing reasons? E.g. is `::` used elsewhere as a delimiter? Check `lib/cutlist/colorAssignment.ts` and grep for callers.
- **Non-backer namespacing in future:** the spec uses `::<suffix>` as a general namespace pattern. If a future ticket adds another suffix (`::offcut`, `::rotated`), would `getBasePartName` need to know about each one, or is "strip the LAST `::<word>` segment" a stable contract?

### 4. Plausibility-range completeness for backer thickness

Spec section: DP5; AC10.

Range `0.5 ≤ thickness ≤ 50` mm with category check. Verify:

- **0.5 lower bound** — is 0.5mm a real thickness for any conceivable backer (e.g. paper-thin laminates)? Production inventory shows 1.6mm as the smallest. Is 0.5 too generous?
- **50 upper bound** — production has 30mm MDF Plain. 50mm is a comfortable buffer, but is there a production scenario where a 32mm or 36mm sheet is legitimately a backer? (The spec preserves `-backer` lamination at the source; backer thickness is sheet thickness, so a 32mm backer would be unusual but not impossible.)
- **Decimal handling** — `parseThicknessFromDescription` returns floats (`1.6`, `0.6`). The validation accepts these. Confirm AC10's test fixtures cover decimal inputs.

### 5. AC coverage final check

Spec has 14 ACs (1 bug-fixture, 2 multi-primary, 3 POL-83, 4 UI shape, 5 backer-edge-neutral PDF, 6 legacy v1 suppression, 7 work-pool retire, 8 edging unchanged, 9 line allocation unchanged, 10 backer thickness validation, 11 cost calculation, 12 `-both` regression, 13 static checks, 14 browser smoke).

Verify:

- **Anything still missing?** Specifically: re-snapshot semantics (a backer reassignment changes `source_revision` and stale-flags the plan) is in Risks but no AC. Is this worth pinning, or trusted by virtue of `computeSourceRevision` existing?
- **Implementation-readiness:** would Codex be able to start Phase 1 and produce code that passes all 14 ACs without further clarification, or is there a remaining ambiguity?

## Questions for round 3

1. Is `DisplayPlanState` the right contract, or would a simpler `plan: CuttingPlan & { legacy?: true }` field work equally well with less typing churn?
2. Is the plausibility range `0.5..50` mm tight enough, or should the spec also bound by `parsed_thickness ≤ primary_thickness` for backer-of-primary semantics? (i.e. backers should never be thicker than the primary they back.)
3. Should the `-both` AC fixture also assert `total_nested_cost` parity, or is placement/sheet count sufficient?

## What you do NOT need to re-review

- DPs 1, 3, 6 (resolved in earlier rounds, unchanged in v3)
- POL-92, POL-93, POL-95 (separate tickets)
- The decision to reuse `cutting_plan_issued_count_changed` over adding a new exception_type — DB-verified that adding requires DDL, which we don't want
- The decision to use plausibility range over magic-number set — round-2 finding directly addressed
- `-both` upstream pre-doubling — round-1 verification

## Reply format

Same as rounds 1 + 2. Group by severity. Each finding: spec section, issue, fix shape. If no issues at a severity, say "None" under that heading.

Close with: **"Sign off as-is — Codex implementation can proceed"** OR "Iterate one more round" OR "Multiple rounds needed."
