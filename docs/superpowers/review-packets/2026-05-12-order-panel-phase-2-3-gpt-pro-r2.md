# GPT-5.5 Pro Plan Review — Order Panel Phase 2 + Phase 3 (Round 2)

**Date:** 2026-05-12
**Reviewer:** GPT-5.5 Pro (web)
**Pasted by:** Greg
**Branch:** `codex/local-claude-order-panel-phase-2-3-spec` (pushed to origin)
**Round 1 packet:** [r1](2026-05-12-order-panel-phase-2-3-gpt-pro-r1.md)
**Round 1 outcome:** 2 BLOCKERs + 4 MAJORs + 3 MINORs. All 9 actioned in commit `55d9bf3`. No "Ship the spec" yet — this round is a targeted re-check.

---

> **For GPT-5.5 Pro:** Round 1 produced 9 findings. All are now addressed in the spec on the branch above. This round is a targeted re-check — confirm each finding is resolved correctly, and look for anything the round-1 changes might have introduced. Return findings in the same severity-grouped format. If clean, say **"Ship the spec"** so we can move to plan / handoff.

---

## What changed since round 1

| Round 1 finding | Severity | Fix | Where to verify |
|---|---|---|---|
| Phase 3 RPC not snapshot/effective/cutting-plan aware | **BLOCKER** | Rewrote the demand CTE to mirror the latest `reserve_order_components` from `20260428143200_snapshot_effective_field_rpcs.sql`. Reads `bom_snapshot.effective_component_id` / `effective_quantity_required` / `is_cutlist_item`, includes fresh `orders.cutting_plan.component_overrides`, falls back to live BOM only when no snapshot. Filter to `p_component_id` at the end. | Spec → "Phase 3 — New RPC: `reserve_order_component_single`" — full SQL body |
| Route lacks order-ownership validation; DELETE not org-scoped | **BLOCKER** | API route section now lists explicit 6-step implementation that mirrors the existing reserve-components route — `select order from orders where order_id = $1 and org_id = $auth.orgId`, 404 on miss. RPC `DELETE` filtered on `org_id = p_org_id`. `INSERT ... ON CONFLICT` now sets `org_id = EXCLUDED.org_id` for defense in depth. | Spec → "Phase 3 — New API route" and RPC body's `ELSE DELETE ...` branch |
| Enablement predicate stuck at `available > 0 && reserved < required` (no-op enabled state) | MAJOR | Both Reserve all visibility and per-row reserve enable use a shared helper at `lib/orders/reservation-predicate.ts` exporting `targetReservable(required, available)` and `canReserveMore(required, available, reservedThisOrder)`. New test file required. Spec says the helper is the single source of truth. | Spec → "Reserve all button (Phase 2)", "Phase 3 UI wiring", Files-touched list |
| No observable feedback for Phase 3 reserve (no Reserved column in row) | MAJOR | Added `RES` column to the row layout — REQ / RES / AVAIL / SHORT. Grid is `90px 1fr 32px 38px 50px 32px 22px 22px` in Phase 2 (no ＋), `... 22px 22px 22px` in Phase 3 (with ＋). AVAIL semantics kept aligned with the existing `get_detailed_component_status` (`max(0, in_stock - reserved_by_others)`) — does NOT drop when this order reserves. Phase 3 acceptance adds "RES column updates in real time" check. | Spec → "Component Readiness — single-line rows" |
| `initialFocusComponentId` could pre-check a "For Stock" row | MAJOR | Dialog pre-checks ONLY when `component.shortfall > 0`. When row exists with `shortfall <= 0` (covered for this order, present only because of global shortfall), open without pre-checking + toast: "Component covered by stock for this order — opened the procurement view in case you want to top up stock anyway." Also: focus state clears on dialog close so next manual open doesn't inherit stale focus. | Spec → "OrderComponentsDialog — new prop" |
| Collapse defaults internally inconsistent | MAJOR | Removed all "smart defaults" wording. Spec now reads: first visit = `'closed'` for every section, period. localStorage override wins once toggled. Helper returns `'closed'` for any section with no entry. Test plan expects all four to default `'closed'`. | Spec → "Section collapse model" |
| Migration advisor expectation said "zero warnings" | MINOR | Changed to "zero NEW warnings expected" with note that the pre-existing `reserve_order_components` search_path advisor may remain (out of scope to patch). | Spec → "Migration discipline checklist" item 5 |
| Zebra opacity inconsistency (3% vs `bg-black/12`) | MINOR | Consolidated to `bg-black/[0.03]` for zebra; `bg-destructive/[0.05]` for shortfall tint. | Spec → "Component Readiness — single-line rows" and "Visual treatment" |
| RPC name inconsistency (phasing summary said `reserve_order_component`) | MINOR | Phasing summary now says `reserve_order_component_single` matching SQL + route + hook everywhere. | Spec → "Phasing summary" table |

## Specific things to look at this round

1. **RPC demand parity with `reserve_order_components`.** Walk the SQL CTE — does it exactly mirror the canonical RPC's logic, then filter to `p_component_id`? Anywhere the per-component branch could produce a quantity that disagrees with Reserve all on the same component?
2. **Route ownership pattern correctness.** Verify the new route's 6-step recipe matches the existing reserve-components route line for line (auth → parse → ownership → RPC → response). Anything missed (e.g. the `orderError` 500 case)?
3. **`targetReservable` / `canReserveMore` definitions.** The spec says `targetReservable = Math.max(0, Math.min(required, available))` and `canReserveMore = targetReservable > reservedThisOrder`. Are those exactly what Reserve all visibility and per-row reserve enable should check?
4. **AVAIL semantics.** The row now shows RES + AVAIL with AVAIL = `max(0, in_stock - reserved_by_others)` (unchanged from existing semantics). Phase 3 smoke verifies RES updates while AVAIL stays (since this-order reservations move into RES, not out of AVAIL). Is this the right model, or should AVAIL be redefined as "free unreserved stock from this order's perspective"?
5. **`initialFocusComponentId` pre-check guard.** Pre-check iff `component.shortfall > 0`. When `shortfall <= 0` and `global_real_shortfall > 0`, dialog opens without pre-checking + toasts. Right behavior, or should we just skip opening entirely?
6. **No "smart defaults" anywhere.** Did I miss any spot in the spec that still implies state-driven defaults?
7. **Tenant smoke as Phase 3 acceptance.** Cross-org call must return 404 and create/delete nothing. Is the smoke specified concretely enough that Codex will actually run it?
8. **Demand parity smoke for swapped BOM.** Phase 3 acceptance includes a smoke that proves the new RPC reads from snapshot, not live BOM. Is the smoke specified concretely enough?

## Files / commits to read

- Branch: `codex/local-claude-order-panel-phase-2-3-spec`
- Round-2 commit: `55d9bf3` — single commit; full diff vs round-1 (+181 / −65 lines on the spec)
- Spec: `docs/superpowers/specs/2026-05-12-order-panel-phase-2-3-design.md`
- Round-1 packet for context: `docs/superpowers/review-packets/2026-05-12-order-panel-phase-2-3-gpt-pro-r1.md`
- Canonical existing RPC for comparison: `supabase/migrations/20260428143200_snapshot_effective_field_rpcs.sql`
- Canonical existing route for comparison: `app/api/orders/[orderId]/reserve-components/route.ts`

## What I expect from this round

Per the Phase 1 trial pattern: round 2 typically catches half as much as round 1. If you find zero BLOCKERs / MAJORs, say **"Ship the spec"** explicitly so we can hand off to Codex. MINORs that don't affect correctness are acceptable to defer to implementation.

If you do find new issues, return them in the same severity-grouped format with: where, what, what to change, why-severity.
