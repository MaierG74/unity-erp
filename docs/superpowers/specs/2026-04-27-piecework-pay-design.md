# Piecework Pay — Multi-Tenant Cut & Edge Attribution Design

**Date**: 2026-04-27
**Status**: Draft (plan-review-requested)
**Tenant of record**: QButton (initial); design must remain multi-tenant.

## Problem

QButton pays its cutting team and edging team **piecework**: a fixed rate per piece processed. A typical cabinet has 5 pieces (4 carcass panels + back); at R6.50/piece the cutter earns R32.50 for that cabinet. The edging team is paid the same way but at a different rate, with one critical wrinkle: **two laminated 16mm pieces (`32mm-both` / `with-backer`) are edged as one 32mm bundle**, so they count as 1 edged unit, not 2.

The Unity ERP schema already carries the foundations:

- `staff_piecework_earnings` table (per-staff completion rows with `staff_id`, `completed_quantity`, `piece_rate`, `earned_amount`, `completion_date`)
- `lib/payroll-calc.ts` already computes `finalPay = max(hourlyTotal, pieceworkNet)` — the higher-of-hourly-or-piecework floor is wired
- Lamination is modelled in `PartSpec` (`lib/cutlist/types.ts:24-90`) as `'none' | 'with-backer' | 'same-board' | '32mm-both'` — sufficient to derive bundle counts
- `BandEdges {top,right,bottom,left}` per part — sufficient to know which pieces actually get edged

What is **missing**:

1. No notion of distinct **piecework activities** — today there is one "piecework" bucket with no way to separate the cut team's pay stream from the edge team's.
2. No per-org configuration of which activities a tenant uses or what they pay per piece.
3. No card mechanism that targets the cutting team or edging team distinctly from product/assembly job cards.
4. No supervisor-side flow that records who actually did the work and how many pieces were processed (the existing `staff_piecework_earnings.staff_id` column is unpopulated by any UI).
5. The legacy `job_piecework_rates` table provides job-level rates but does not fit a per-activity, per-org model.

Other tenants may use no piecework at all, or only one stream (just edging, just assembly). The system must therefore make piecework optional per-tenant and additive per-activity, with no impact on tenants that don't use it.

## Goals

1. **Multi-tenant activities.** A tenant defines its own piecework activities (label, rate, target role). A tenant with zero rows has zero piecework.
2. **Cut and edge cards live in the existing work pool**, surfaced in the same Queue / Schedule / Floor tabs. No parallel infrastructure.
3. **Cards generate automatically** when a cutting plan is finalized for an order — with the expected piece count pre-computed from cutting-plan + lamination data.
4. **Supervisor-only completion**, since cutters and edgers work from printed paper cards and never touch the system. Count override and staff-split happen office-side.
5. **Earnings are attributed atomically** at card completion: a row in `staff_piecework_earnings` per staff member with the rate snapshotted onto the row.
6. **Counting logic lives in code** (per-strategy functions); rates and labels live in DB so non-engineering admins can edit them.
7. **Existing tenants and existing flows are unaffected** until they opt in by configuring activities.

## Out of Scope

- **Per-part "include in piecework count" toggle on the cutlist.** Greg flagged that some cutlist parts (e.g. tiny off-cuts, scrap-marker pieces) shouldn't count toward the cutter's pay. Deferred — for now, the supervisor's count-override at completion is the safety valve.
- **Per-staff rate multipliers** (junior cutter at 80%, senior at 110%). All staff doing the same activity get the same rate.
- **Edge-length-weighted or banded-edge-count-weighted pay.** Greg confirmed flat per-bundle for now.
- **Activities beyond cut + edge** (assembly, QC, delivery). The model supports adding them later via new strategies + activity rows; not implemented now.
- **Runtime app→Linear push** (auto-issue creation from runtime events, comments posted by the app, etc). Linear remains a tracker, not a runtime integration target.
- **Mobile / floor-side completion UI.** Cutters and edgers do not interact with the system. All data entry is supervisor-side in the office.
- **Migrating historical hourly-only payroll** to recompute earnings under piecework. Activity goes live forward only.

---

## Design

### 1. New table — `piecework_activities`

Per-org rows. Each row defines one billable activity for that tenant.

```sql
create table piecework_activities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  code text not null,                     -- 'cut_pieces' | 'edge_bundles' | (future)
  label text not null,                    -- 'Cutting', 'Edging' (org-editable)
  default_rate numeric(10, 2) not null,   -- e.g. 6.50
  unit_label text not null,               -- 'piece', 'bundle' (display only)
  target_role_id uuid references labor_roles(id),
                                          -- which scheduler lane the card lands in
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, code)                   -- one row per activity code per org
);

-- RLS: org-scoped via is_org_member()
alter table piecework_activities enable row level security;
create policy piecework_activities_org_read on piecework_activities
  for select using (is_org_member(org_id));
create policy piecework_activities_org_write on piecework_activities
  for all using (is_org_member(org_id))
  with check (is_org_member(org_id));
```

**Tenant model:** an org "uses piecework" iff it has ≥1 `is_active=true` row. There is no separate `org.piecework_enabled` flag — the presence of rows is the flag.

**`code` values** are an open-ended set, but each one must correspond to a registered counting strategy in code (§4). Initial values: `cut_pieces`, `edge_bundles`. Adding a new code requires both a migration to seed it for the relevant tenant and a code change to register the strategy.

**Seed for QButton (idempotent migration):**
- `(org_id=QButton, code='cut_pieces', label='Cutting', default_rate=6.50, unit_label='piece', target_role_id=<Cut and Edge>)`
- `(org_id=QButton, code='edge_bundles', label='Edging', default_rate=<TBD with Greg>, unit_label='bundle', target_role_id=<Edging>)`

The edge rate is a decision point — Greg has not stated a number.

### 2. Schema extensions to existing tables

#### `job_work_pool`

Per memory and per existing code, this table has a `source` column today with values `'bol' | 'manual'`. Extend:

```sql
-- Migration: extend the source check / enum to include 'cutting_plan'
alter table job_work_pool
  add column cutting_plan_run_id uuid references <cutting_plan_runs>(id),
  add column piecework_activity_id uuid references piecework_activities(id),
  add column expected_count integer,
  add column material_color_label text;
-- (constraint: cutting_plan_run_id and piecework_activity_id are NULL unless source='cutting_plan')
```

(`<cutting_plan_runs>` is the existing table that holds finalized cutting plans for an order; the implementer will resolve the exact name during execution.)

#### `job_cards`

```sql
alter table job_cards
  add column piecework_activity_id uuid references piecework_activities(id),
  add column cutting_plan_run_id uuid references <cutting_plan_runs>(id),
  add column material_color_label text,
  add column expected_count integer,
  add column actual_count integer,
  add column rate_snapshot numeric(10, 2);
-- All nullable. Existing product/assembly cards leave them null.
```

`rate_snapshot` defaults to the activity's `default_rate` when the card is issued. Supervisor can override per-card before completion. The value at completion is what flows into `staff_piecework_earnings.piece_rate`.

#### `staff_piecework_earnings`

Already exists; no schema change. Two semantic clarifications:

- `staff_id` is populated by the completion flow (§7), not by the card itself, so split-attribution can write multiple rows for one card.
- `piece_rate` is the snapshotted rate at completion — historical earnings remain stable when an activity's `default_rate` later changes.

#### New table — `piecework_card_adjustments` (audit log)

```sql
create table piecework_card_adjustments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  job_card_id uuid not null references job_cards(id) on delete cascade,
  old_count integer,
  new_count integer not null,
  reason text,
  adjusted_by uuid not null references auth.users(id),
  adjusted_at timestamptz not null default now()
);
-- RLS: org-scoped read/write
```

One row per supervisor count-edit. Append-only.

### 3. Card granularity (locked in conversation)

| Card type | Activity code | Scope | Target role lane |
|---|---|---|---|
| Cut card | `cut_pieces` | one per (order × cutting plan / color batch) | `Cut and Edge` |
| Edge card | `edge_bundles` | one per (order × cutting plan / color batch) | `Edging` |

A finalized cutting plan for an order with 2 color batches generates 2 cut cards + 2 edge cards (4 work-pool entries).

Cards target the role lane via `piecework_activities.target_role_id`. The scheduler already places work in role lanes based on `labor_roles` (per `20251207_create_labor_roles.sql`), so this is reused, not new behavior.

### 4. Counting strategies (backend)

A registry pattern keyed by `code`:

```ts
// lib/piecework/strategies/index.ts
export type CountingStrategy = (input: CuttingPlanBatch) => CountResult;

export const STRATEGIES: Record<string, CountingStrategy> = {
  cut_pieces: countCutPieces,
  edge_bundles: countEdgeBundles,
};
```

Per `lib/cutlist/types.ts`, `PartSpec.lamination` is one of `'none' | 'with-backer' | 'same-board' | 'custom'`. The strategies key on this value.

```ts
// lib/piecework/strategies/cutPieces.ts
// Counts physical pieces cut. A 'with-backer' row represents one visible
// product part backed by a separate cut piece — i.e. one row = two cut
// pieces. 'none' is straightforward: one row = one piece. 'same-board' and
// 'custom' have ambiguous representations and are handled per Decision Point #6.
// Future: respect a per-part `include_in_piecework` flag (out of scope today).
export function countCutPieces(batch: CuttingPlanBatch): CountResult {
  let count = 0;
  for (const part of batch.parts) {
    const piecesPerRow =
      part.lamination === 'with-backer' ? 2 : 1; // see DP #6 for same-board / custom
    count += part.quantity * piecesPerRow;
  }
  return { count, breakdown: { /* per-part list */ } };
}
```

```ts
// lib/piecework/strategies/edgeBundles.ts
// Counts edge-bundle units with >=1 banded edge. One PartSpec row represents
// one finished bundle — the cutter may have produced 1 or 2 physical pieces
// for it, but the edger sees a single 32mm-equivalent strip taped around the
// perimeter. Pieces with no banded edges contribute 0.
export function countEdgeBundles(batch: CuttingPlanBatch): CountResult {
  let count = 0;
  for (const part of batch.parts) {
    const hasAnyBandedEdge = part.bandEdges &&
      (part.bandEdges.top || part.bandEdges.right ||
       part.bandEdges.bottom || part.bandEdges.left);
    if (!hasAnyBandedEdge) continue;
    // One PartSpec row = one bundle, regardless of lamination type.
    count += part.quantity;
  }
  return { count, breakdown: { /* per-part list */ } };
}
```

**Worked example — the canonical "two 16mm pieces laminated" case:**

Input: one `PartSpec` row with `lamination='with-backer'`, `quantity=1`, `bandEdges={top:true, right:true, bottom:true, left:true}`.

| Strategy | Per-row | × quantity | = total |
|---|---|---|---|
| `countCutPieces` | `2` (`with-backer` → 2 pieces per row) | `× 1` | **`2` cut pieces** |
| `countEdgeBundles` | `1` (one row = one bundle, has banded edges) | `× 1` | **`1` edged bundle** |

Result: 2 cut, 1 edged. Matches Greg's specification. Both formulas agree on the same denominator (the `PartSpec` row), and the doubling is isolated to the cut strategy — no double-counting is possible across strategies.

**Decision Point #6 covers** the `'same-board'` and `'custom'` lamination types, where the row-to-piece mapping is ambiguous from the schema alone. Codex must inspect the cutting-plan generation path during plan-review and either confirm "row = bundle" semantics (current assumption) or flag a representation that requires inverting the logic. The strategies must not ship until that ambiguity is resolved.

The `CuttingPlanBatch` shape — `parts: { partSpec, quantity }[]` keyed to a single material/color — is derived from existing cutting-plan data structures (`lib/cutlist/types.ts`). Implementer resolves exact field paths during execution.

Strategies are pure functions, fully unit-testable without DB access.

### 5. Card creation trigger

When a cutting plan is **finalized** for an order (the existing "save / lock" action on the cutting plan):

```
for each (material_color_label, parts[]) batch in cuttingPlan:
  for each active piecework_activity in org:
    if activity.target_role_id corresponds to a stage that operates on this batch:
      strategy = STRATEGIES[activity.code]
      expected = strategy(batch).count
      insert into job_work_pool (
        org_id, source='cutting_plan',
        cutting_plan_run_id, piecework_activity_id,
        expected_count, material_color_label, ...
      )
```

**MVP join rule:** if the org has an active `cut_pieces` activity, every cutting-plan batch generates one cut work-pool row. If the org has an active `edge_bundles` activity, every batch with at least one banded part generates one edge work-pool row (batches with `expected_count = 0` are skipped to avoid empty cards in the queue). Future activities (e.g. `assembly_units` per product) will need a different join key — left as an extension point.

If the org has zero `piecework_activities` rows: no work-pool rows are created, cutting plan flow is unchanged. Tenants without piecework see no behavior change.

### 6. Issuance, scheduling, printing

Once in the work pool, cut/edge cards follow the **existing** issuance flow: `issue_job_card_from_pool()` RPC, drag-to-staff-lane in the swimlane scheduler, `assigned_staff_id` populated at issuance. No new scheduler code.

The job-card PDF renderer (lazy `@react-pdf/renderer` per CLAUDE.md) gains a card-type-aware variant: cut and edge cards print with the order ref, color/material label, expected piece count, assigned staff name, and blank space for hand-noted exceptions. The cutting-diagram PDF (existing, in `components/features/cutlist/primitives/CuttingDiagramButton.tsx`) is **not** the same as the job card PDF; the job card is a separate one-page document handed to the team.

### 7. Completion flow (supervisor-only)

The supervisor opens a card from the office to mark it complete. The dialog:

1. Shows `expected_count` and `actual_count` (defaults to expected). Editable. Edits write to `piecework_card_adjustments`.
2. Shows the assigned staff member with `count = actual_count` pre-filled. Supervisor can:
   - **Accept** (single attribution, 99% case): writes one `staff_piecework_earnings` row.
   - **Split** (1% case): switches to a multi-row UI where multiple staff IDs share the count. Sum must equal `actual_count`. Writes one `staff_piecework_earnings` row per staff.
3. The rate at write time = `job_cards.rate_snapshot` (snapshotted onto each earnings row).

Earnings write is wrapped in a transaction with the card status update. Idempotent: re-completing a card is rejected unless the card is first reopened.

```sql
-- earnings row shape (unchanged from today):
insert into staff_piecework_earnings (
  staff_id, item_id, job_card_id, order_id, completion_date,
  job_id, product_id, completed_quantity, piece_rate, earned_amount
) values (...);
```

For cut/edge cards, `item_id`, `job_id`, `product_id` may be null (since the card is order-batch-scoped, not product-scoped). Confirm column nullability during execution; relax NOT NULLs if necessary.

### 8. Payroll-review presentation

`lib/queries/payrollReview.ts:fetchWeeklyPiecework()` already aggregates piecework per staff per week. Extend the aggregation grouping to also group by activity, and extend the `PayrollRow` shape to expose `pieceworkByActivity: { activityCode: string; activityLabel: string; total: number }[]`.

Render in payroll review as a per-row breakdown ("Cut: R280 · Edge: R150 · Total piecework: R430"). The existing `finalPay = max(hourlyTotal, pieceworkNet)` formula in `lib/payroll-calc.ts` is unchanged.

### 9. Settings UI — manage activities

A new admin page (or section on the existing org settings page) allows org admins to:

- View list of `piecework_activities` for the org
- Add a new activity (pick `code` from a registered list, set label, rate, unit label, target role)
- Edit label / rate / unit / target role / is_active
- Soft-deactivate (sets `is_active=false`; existing earnings unaffected)

`code` is selectable only from the registered code list — not free-text — to prevent activity rows that no strategy can count.

### 10. Cleanup — `job_piecework_rates`

Inspect existing data:
- If empty across all orgs: drop the table outright.
- If non-empty: migrate each row's rate into a per-card `rate_snapshot` if the relevant card still exists, else discard. Drop the table.

This runs **after** the completion flow (§7) is live and verified; it's a separate phase.

---

## Acceptance Criteria

The full feature is acceptable when, in production:

1. An org admin at QButton can navigate to org settings and see the seeded `cut_pieces` and `edge_bundles` activities with editable label, rate, and target role.
2. Finalizing a cutting plan for a QButton order with N material/color batches creates 2N work-pool rows (N cut, N edge) with `expected_count` populated by the correct strategy and `material_color_label` set.
3. The Production → Queue / Schedule tabs show those work-pool rows alongside existing jobs. Dragging into a staff lane in the `Cut and Edge` or `Edging` role issues a job card with `assigned_staff_id` and `rate_snapshot` set.
4. Marking a card complete in the supervisor dialog writes one `staff_piecework_earnings` row (or multiple, if split) with the correct `staff_id`, `completed_quantity`, `piece_rate`, and `earned_amount = qty × rate`.
5. Editing the count at completion writes a `piecework_card_adjustments` row capturing old/new/reason/adjusted_by/adjusted_at.
6. The payroll review page shows per-activity breakdown for any staff member with piecework earnings in the period.
7. An org with zero `piecework_activities` rows has zero behavior change in cutting plans, work pool, scheduler, or payroll.
8. `job_piecework_rates` is dropped after migration; no code references remain.
9. `mcp__supabase__get_advisors --type=security` reports no missing-RLS warnings on the new tables.
10. Edge cases verified:
    - Order batch with zero banded parts → no edge work-pool row created (skipped).
    - Laminated pair (`32mm-both` or `with-backer`) → counts as 2 cut pieces, 1 edge bundle.
    - Cutter splits work between two staff → two earnings rows summing to `actual_count`.
    - Activity rate change after card issuance, before completion → completion uses `rate_snapshot` from issuance, not the new default.
    - Card completed, then reopened, then re-completed → original earnings rows are reversed (not duplicated) before new ones are written.

## Verification Commands

To be re-run by Claude as reviewer of any sub-issue's PR, and by Codex as part of self-review:

```bash
npm run lint
npx tsc --noEmit
# Supabase advisors run against live DB after migration apply:
mcp__supabase__get_advisors --type=security
mcp__supabase__get_advisors --type=performance
# Unit tests for counting strategies:
npm test -- lib/piecework/strategies
# E2E sanity: finalize a cutting plan, expect work-pool rows:
npm run schema  # confirm migrations applied
```

Counting strategy unit tests must cover:
- Plain pieces with no banding (cut counts; edge skips)
- Plain pieces with all-edges banded (cut and edge each count 1)
- Laminated pair `32mm-both` (cut counts 2, edge counts 1)
- `with-backer` lamination (cut counts 2, edge counts 1)
- Mixed batch (combination of all above)

## Decision Points (stop and ask Greg)

1. **Edge piecework rate for QButton.** Greg has not stated a number; the seed migration cannot run without one.
2. **Migration of `job_piecework_rates`.** Whether to keep historical rows by attaching them as `rate_snapshot` values, or to discard. Decide once we've inspected the data.
3. **`item_id` / `job_id` / `product_id` nullability on `staff_piecework_earnings`.** Cut/edge cards are not product-scoped. If those columns are NOT NULL today, decide whether to relax them (preferred) or to attach a synthetic placeholder (rejected — pollutes historical reporting).
4. **Activity↔batch join logic.** The MVP rule "every cut activity applies to every batch" is correct for QButton today. If a future tenant has a `cut_pieces` activity but only wants it to apply to certain materials, this needs a new mapping layer — flag if the constraint surfaces during implementation.
5. **`piecework_activities.code` registry location.** Whether the registered list lives in code (typed enum) or DB (separate `piecework_activity_codes` table). Recommendation: code-side enum, since each code is bound to a strategy function; DB row would just duplicate.

6. **`PartSpec` representation of laminated pairs.** Strategies in §4 assume one `PartSpec` row with `lamination='32mm-both'` represents one bundle = two physical pieces. If the cutting-plan data path actually emits two separate `PartSpec` rows for the pair, both counting strategies invert their lamination logic. Verify by reading `lib/cutlist/types.ts` and the cutting-plan generation path before strategies are written.

7. **Card reopen / un-complete semantics.** AC #10 calls for reversal-on-reopen, but the existing job-card flow may not have a "reopen" path today. Decide whether to (a) build a supervisor reopen action that reverses earnings, or (b) require admin SQL to correct mistakes. Recommendation: (a), but scope it carefully — it touches `staff_piecework_earnings` audit semantics.

8. **Destructive changes to existing tables — flag for explicit Greg approval before execution.**
   - **Drop `job_piecework_rates`** (§10 cleanup). Per-job rate overrides become per-card `rate_snapshot` overrides under the new model. Codex must (a) audit live data first (`select count(*) from job_piecework_rates` per org), (b) confirm whether rows are actively referenced by current code paths, (c) propose a data-preservation migration if non-trivial data exists, and (d) wait for explicit Greg sign-off before executing the drop. The drop is its own gated sub-issue and must not be bundled with other changes.
   - **Schema additions to `job_cards` and `job_work_pool`** are additive (nullable columns, new enum value `'cutting_plan'` on `job_work_pool.source`) — not destructive. Migrations must be reverse-script-friendly so a `revert` is clean.
   - **No other existing tables are renamed, dropped, or have columns removed.** New tables (`piecework_activities`, `piecework_card_adjustments`) are net-additive.

9. **Existence and column shape of `job_work_pool.source`.** This spec assumes the column exists with values `'bol' | 'manual'` per memory; the new value `'cutting_plan'` is added via `ALTER TYPE` if it's a Postgres enum, or by widening a CHECK constraint if it's a text column. Codex must verify the actual column type and write the migration accordingly.

10. **Existence and exact name of the cutting-plan-runs table.** This spec references `<cutting_plan_runs>` as a placeholder for the table that holds finalized cutting plans. Codex must resolve the exact table name and primary-key shape during plan-review and update the spec/migration accordingly.

## Rollback / Release Notes

- All schema changes are additive (new columns nullable, new tables, no destructive ops on existing data) until the `job_piecework_rates` cleanup phase, which is its own gated sub-issue.
- Rollback per phase: `revert` the migration (each migration must be idempotent reverse-script-friendly), then `revert` the merge commit on `codex/integration`.
- The `job_piecework_rates` drop must be preceded by a full live-data audit (`select count(*) from job_piecework_rates`) and a backup snapshot.
- Live release runs only when all sub-issues are merged to `codex/integration` and Greg approves a release slice to `main`. Live data behavior is fenced behind "org has at least one `piecework_activities` row" — no tenant other than QButton sees behavior changes until they are explicitly seeded.
- No edge function deployments. No changes to auth, payment, or admin endpoints.

## Documentation Requirements

- **`docs/domains/payroll/piecework.md`** *(NEW)* — canonical operator-facing description of the feature: how to add activities, how cards flow through the work pool, how completion attribution works, what the supervisor sees.
- **`docs/plans/2026-04-27-piecework-pay-implementation.md`** *(may be created during planning)* — phased implementation notes if Codex's plan-review surfaces enough complexity to warrant an extended plan separate from this design doc.
- **`CLAUDE.md`** — short note under "Architecture" pointing at the new domain doc.
- **No update** to `docs/README.md` or `docs/overview/todo-index.md` per CLAUDE.md guidance (only updated on materially new workstreams or release reconciliation).

---

## Phasing (proposed; pending Codex plan-review feedback)

To be expanded into Linear sub-issues after Codex's plan-review feedback lands and Greg confirms.

| # | Sub-issue (working title) | Approx scope |
|---|---|---|
| 1 | `piecework_activities` schema + RLS + QButton seed + Settings admin UI | Foundation; unblocks rate config |
| 2 | Extend `job_cards` + `job_work_pool.source='cutting_plan'` schema | Pure migration; no behavior change |
| 3 | Counting strategies (`cut_pieces`, `edge_bundles`) in `lib/piecework/strategies/` | Pure functions, independently testable |
| 4 | Auto-create work-pool rows on cutting plan finalize | Wires #3 into the existing flow |
| 5 | Supervisor completion dialog: count adjust + staff split + earnings write + audit log | The pay-attribution moment |
| 6 | Per-activity breakdown in payroll review | Read-side enhancement |
| 7 | Printable cut/edge job card PDF | Reuses `@react-pdf/renderer` infra |
| 8 | Migrate + drop `job_piecework_rates` | Runs after #5 is live |

Each sub-issue carries its own 6-section contract (Scope / Acceptance Criteria / Verification Commands / Decision Points / Rollback / Documentation Requirements), is delegated to `@Codex`, and is reviewed by Claude before merge to `codex/integration`.
