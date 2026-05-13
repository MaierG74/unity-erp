# GPT-5.5 Pro Plan Review — Order Panel Phase 2 + Phase 3 (Round 1)

**Date:** 2026-05-12
**Reviewer:** GPT-5.5 Pro (web)
**Pasted by:** Greg
**Spec:** [docs/superpowers/specs/2026-05-12-order-panel-phase-2-3-design.md](../specs/2026-05-12-order-panel-phase-2-3-design.md)
**Branch:** `codex/local-claude-order-panel-phase-2-3-spec` (pushed to origin)
**Related Phase 1 history:** spec + plan + R1/R2 packets on `codex/local-claude-order-products-panel-spec` — final outcome was "Ship the spec" after 2 rounds and 1 prose cleanup, no post-implementation review findings.

---

> **For GPT-5.5 Pro:** This is a follow-up spec covering Phase 2 (UI polish) and Phase 3 (per-component reservation backend) of the Order Line Setup panel. Phase 1 already shipped to `codex/integration`. Both phases land as separate PRs — Phase 2 first because it's independently valuable, then Phase 3 with the backend.
>
> Read the spec at the URL above. Then return findings using the severity-grouped format from the POL-83 trial (BLOCKERs / MAJORs / MINORs). Section 12 lists the specific decisions I want validated.

---

## 1. Task summary

Take the panel from Phase 1's read-only mirror to:
- **Phase 2:** all sections collapsed by default with localStorage persistence, status sentence in the panel header, single-line Component Readiness rows with code + description side-by-side + tabular numbers + per-row action icons (⟳ swap, 🛒 order), ＋ Reserve all button in the section header. **No new backend** — wires into existing APIs and adds one new prop to `OrderComponentsDialog`. ＋ per-row reserve column is **omitted** in Phase 2.
- **Phase 3:** new `reserve_order_component_single` RPC + API route + mutation hook + the ＋ per-row reserve column added back. No schema changes — the `component_reservations` table already has the right shape and RLS.

## 2. Current repo context inspected

| Path | Purpose | Key finding |
|---|---|---|
| [`supabase/migrations/20260303085548_component_reservation_rpcs.sql`](https://github.com/MaierG74/unity-erp/blob/codex/local-claude-order-panel-phase-2-3-spec/supabase/migrations/20260303085548_component_reservation_rpcs.sql) | Existing `reserve_order_components` / `release_order_components` | Delete-then-insert pattern, `RETURNING` rows. New per-component RPC uses upsert-on-conflict instead to coexist. |
| [`supabase/migrations/20260303085534_component_reservations_table.sql`](https://github.com/MaierG74/unity-erp/blob/codex/local-claude-order-panel-phase-2-3-spec/supabase/migrations/20260303085534_component_reservations_table.sql) | Table definition | `UNIQUE (order_id, component_id)` confirmed at line 10. **`CHECK (qty_reserved > 0)` at line 6** — strictly positive. RPC body branches on `v_reservable > 0` to avoid CHECK violations. |
| [`supabase/migrations/20260303151451_component_reservations_rls_and_indexes.sql`](https://github.com/MaierG74/unity-erp/blob/codex/local-claude-order-panel-phase-2-3-spec/supabase/migrations/20260303151451_component_reservations_rls_and_indexes.sql) | Standard `organization_members` RLS pattern | No policy changes needed — new RPC writes under existing INSERT/UPDATE/DELETE policies. |
| [`supabase/migrations/20260303085743_auto_release_component_reservations_trigger.sql`](https://github.com/MaierG74/unity-erp/blob/codex/local-claude-order-panel-phase-2-3-spec/supabase/migrations/20260303085743_auto_release_component_reservations_trigger.sql) | Auto-release on Completed/Cancelled | New RPC inherits automatically. |
| [`app/api/orders/[orderId]/reserve-components/route.ts`](https://github.com/MaierG74/unity-erp/blob/codex/local-claude-order-panel-phase-2-3-spec/app/api/orders/%5BorderId%5D/reserve-components/route.ts) | Existing order-scoped reserve route | Auth via `requireModuleAccess(MODULE_KEYS.ORDERS_FULFILLMENT)`. Phase 3 route mirrors this verbatim. |
| [`components/features/orders/OrderComponentsDialog.tsx`](https://github.com/MaierG74/unity-erp/blob/codex/local-claude-order-panel-phase-2-3-spec/components/features/orders/OrderComponentsDialog.tsx) | Dialog for creating PO drafts | Currently no pre-selected-component prop. Phase 2 adds `initialFocusComponentId?: number` additively. |
| [`docs/domains/orders/orders-master.md`](https://github.com/MaierG74/unity-erp/blob/codex/local-claude-order-panel-phase-2-3-spec/docs/domains/orders/orders-master.md) | Canonical orders doc | L43 confirms unique constraint, L50 confirms auto-release trigger, L69 confirms no-cost-on-Products-tab rule (held). |

## 3. Preflight findings baked into the spec

Per the [2026-04-29 trial preflight checklist](https://github.com/MaierG74/unity-erp/blob/codex/local-claude-order-panel-phase-2-3-spec/docs/workflow/2026-04-29-trial-gpt-pro-plan-review.md):

- ✅ **CHECK constraint gotcha:** `component_reservations.qty_reserved CHECK (qty_reserved > 0)`. RPC body branches on `v_reservable > 0` to upsert, else DELETE the existing row. Avoids the CHECK violation.
- ✅ **Live schema confirmed via `execute_sql`:** `inventory.quantity_on_hand` is `numeric NULL`; `billofmaterials.{component_id, product_id}` are `integer NULL`; `billofmaterials.quantity_required` is `numeric NULL`. RPC's COALESCE handles every nullability case.
- ✅ **Open advisor on existing RPC:** `reserve_order_components` has "role mutable search_path" open. New RPC explicitly sets `SET search_path = public, pg_temp` to avoid inheriting the same warning. Sets a better precedent.
- ✅ **Auto-release trigger inheritance:** verified the trigger body deletes by `order_id` only, not by RPC name — the new RPC's reservations clean up correctly on order completion/cancellation.
- ✅ **RLS pattern:** confirmed `organization_members` standard pattern is in place. No policy changes.
- ✅ **No schema changes:** `(order_id, component_id, qty_reserved, org_id)` is the right shape already.
- ✅ **Phase 1 rules respected:** no cost numbers, no `CutlistMaterialDialog` changes, no snapshot semantics changes, no `slideOutProduct` deletion.

## 4. Relevant branches and assumed base branch

- **Spec branch (this):** `codex/local-claude-order-panel-phase-2-3-spec`. Single commit: spec (`19653f9`).
- **Phase 2 implementation branch (will be created by Codex):** `codex/local-order-panel-phase-2`, cut from `origin/codex/integration` (not from this spec branch).
- **Phase 3 implementation branch:** `codex/local-order-panel-phase-3`, cut from `origin/codex/integration` after Phase 2 merges.
- **PR target:** `codex/integration` for both phases.

## 5. Files likely to change

Listed in detail in the spec under "Files likely touched", split by phase.

**Phase 2** (~400 LOC new, ~250 LOC modified):
- New: `lib/orders/panel-collapse.ts` + tests, `components/features/orders/setup-panel/ReadinessRow.tsx`
- Modified: 4 section components, panel composer, page wiring, `OrderComponentsDialog` (1 new prop)

**Phase 3** (~250 LOC new, ~80 LOC modified):
- New: migration, API route, mutation hook
- Modified: ReadinessRow (add ＋ column), ComponentReadinessSection, panel composer
- Docs: `migration-status.md` append

## 6. Files / docs consulted while writing the spec

- 5 existing reservation-related migrations (table, RPCs, RLS, trigger, ambiguity fix)
- `OrderComponentsDialog.tsx` full file
- `app/api/orders/[orderId]/reserve-components/route.ts` first 50 lines
- `app/orders/[orderId]/page.tsx` (greps for `OrderComponentsDialog`, `componentToOrder`)
- `docs/domains/orders/orders-master.md`
- `docs/superpowers/specs/2026-05-08-order-products-setup-panel-design.md` (Phase 1)
- `docs/superpowers/plans/2026-05-08-order-products-setup-panel.md` (Phase 1)
- Live HTML mockup at `public/order-panel-v4.html` (was the design artifact Greg approved)

## 7. Tenant / RLS considerations

- `component_reservations` already RLS'd under standard `organization_members` pattern.
- New RPC writes through existing INSERT/UPDATE/DELETE policies — no policy changes.
- API route uses `requireModuleAccess(MODULE_KEYS.ORDERS_FULFILLMENT)` middleware (same as the existing reserve-components route). Org is pulled from the access result and passed as `p_org_id` to the RPC.
- No new tenant-scoped data introduced.

## 8. Migration / schema considerations

**Phase 2:** none.

**Phase 3:**
- Single migration: `supabase/migrations/<timestamp>_reserve_order_component_single.sql`
- Contains: one new RPC function (no table changes, no RLS changes, no trigger changes)
- `SET search_path = public, pg_temp` pinned on the function
- Follow the four-step ritual: file at right path + `apply_migration` + `list_migrations` reconciliation + `migration-status.md` update
- Expected `get_advisors --type security` post-apply: zero NEW warnings (the new RPC pins search_path so it doesn't inherit the existing advisory)

## 9. Testing and validation plan

### Unit (vitest)

- `lib/orders/panel-collapse.test.ts`:
  - Default state (no localStorage entry) returns `'open'` or `'closed'` per smart-default for each section
  - User-toggled state persists across calls
  - Invalid JSON in localStorage falls back to default (defensive parsing)
  - SSR-safe (no `window` access at module top level)

### Browser smoke (Phase 2)

- Open an order with 1 shortfall + per-part overrides → panel shows status pill in header
- Click section chevrons → state persists across reload
- Click 🛒 on the shortfall row → OrderComponentsDialog opens with that component pre-checked
- Click ＋ Reserve all → all reservable components get reservations
- Switch to a different line → panel context swaps, collapse state per section persists

### Browser smoke (Phase 3)

- Click per-row ＋ reserve → that component's Reserved value updates; other components untouched
- Reserve all + per-row reserve interplay (see Risks section)
- Per-row reserve on shortfall row → button disabled, tooltip explains "Nothing in stock to reserve — order instead"
- Release_order_components clears everything correctly

### Migration validation (Phase 3)

- `apply_migration` succeeds
- `list_migrations` shows the new entry
- `get_advisors --type security` returns zero NEW warnings
- `execute_sql` test invocation: SELECT existing on_hand → call new RPC → verify Reserved row created → release and verify cleanup

## 10. Risks and edge cases

Detailed in the spec; high-level summary:

| Risk | Mitigation |
|---|---|
| CHECK constraint trips on zero-reservable | RPC branches on `v_reservable > 0` → DELETE instead of INSERT |
| Reserve all + per-row reserve interaction | Reserve all wipes and recomputes; per-row uses upsert. Operator clicking per-row then Reserve all → per-row gets reset. Documented as acceptable. |
| Per-row reserve race (two operators) | No advisory lock. Same behavior as existing RPC. Last write wins. |
| OrderComponentsDialog focus prop on a covered component | Toast "Component covered by stock" and open dialog normally |
| Phase 3 rollback | `DROP FUNCTION reserve_order_component_single`. UI degrades gracefully — per-row 404s, Reserve all still works. |
| Phase 2 ships without ＋ reserve column | Documented release note: "per-row reserve coming in Phase 3" |

## 11. Questions or uncertainties

1. **Phase split into two PRs vs one.** I lean two — Phase 2 ships independently in a day; Phase 3 follows. But a single combined PR is simpler if you think the visual gap (Phase 2 ships without per-row reserve) is more disruptive than the two-PR overhead.

2. **`v_reservable = 0` → DELETE behavior.** When operator clicks ＋ reserve on a component whose stock has been depleted since the page loaded, the RPC deletes any existing reservation for that component on the order. Alternative is to leave the existing reservation untouched and just return `qty_reserved = 0`. I picked DELETE because it keeps the state consistent with the operator's intent ("reserve what we can right now") — but it could surprise an operator who didn't realize their previous reservation got wiped. Worth a sanity check.

3. **`initialFocusComponentId` UX.** Opening OrderComponentsDialog with one row pre-checked may surprise operators expecting the dialog's normal entry state (nothing selected, allocation table visible). The alternative is to scroll-into-view only, no pre-check, and let the operator check themselves. I picked pre-check because the operator just clicked 🛒 specifically intending to order that one component, but it's a behavioral bet.

4. **`SET search_path` precedent.** New RPC pins search_path even though the existing one doesn't. Should we also retroactively fix `reserve_order_components` in the same migration, or leave that as a future cleanup?

5. **localStorage key naming.** I used `unity-erp.order-panel.sections.<sectionId>` — readable but verbose. Any preference for a shorter convention (e.g. `uop.s.<sectionId>`)? Cross-feature consistency would be the reason to pick a shared prefix.

6. **No row-level locking on `component_reservations` in Phase 3.** Matches existing RPC behavior. Is that the right call, or should the new RPC use `SELECT ... FOR UPDATE` on the inventory row to prevent oversubscription under concurrent reserves?

## 12. Specific things I want GPT Pro to review

1. **Phase split (Phase 2 alone first, Phase 3 second).** Yes/no answer plus reasoning.
2. **RPC body correctness.** Walk the SQL: nullability handling, CHECK-constraint branching, COALESCE coverage, ON CONFLICT semantics. Anything missed?
3. **`SET search_path = public, pg_temp` setting.** Right values, right syntax, right precedent? Should the existing RPC be patched in the same migration?
4. **`initialFocusComponentId` UX risk.** Behavioral bet — pre-check or just scroll?
5. **Reserve all + per-row reserve interaction.** Per-row gets wiped when Reserve all runs after it. Acceptable, or should I add idempotency to Reserve all?
6. **Phase 2's omitted ＋ column.** Better than disabled-greyed, or worse than visual inconsistency?
7. **localStorage persistence model.** Smart defaults vs user overrides — described clearly enough for Codex?
8. **Migration discipline.** Four-step ritual called out; any sixth step worth adding?
9. **Acceptance criteria.** Each phase's criteria — do they map to specific files / behaviors? Anything observable that's not measured?
10. **Files-likely-touched completeness.** Anything Codex will need to modify that's not in the list?

---

## Standing rules unchanged

- **LOCAL DESKTOP ONLY** for all Codex execution (Phase 3 applies a migration to live).
- **`delegate=null`** on any Linear ticket filed.
- **Auto-merge** acceptable for Phase 2 (no schema/RLS/migration). Phase 3 requires Greg sign-off on the migration before merge.
- **Browser smoke** is reviewer responsibility if Codex skips.
- **Wage-table safety** — not relevant (no wage tables touched).
- **Migration discipline** — Phase 3 explicitly follows the four-step ritual.

---

## Format note for GPT Pro response

Per POL-83 trial pattern, return findings grouped by severity:

- **BLOCKERs** — would prevent shipping or cause incorrect behavior
- **MAJORs** — significant issues to fix before implementation
- **MINORs** — small improvements, can defer

For each finding: where in the spec / code, what the issue is, what to change, severity rationale.

If the spec is ready to ship to Codex as-is, say **"Ship the spec"** explicitly.

Section 12 lists 10 specific things to validate — please give explicit yes/no answers with brief reasoning, not just "looks fine."
