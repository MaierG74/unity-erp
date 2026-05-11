# GPT-5.5 Pro Plan Review — Order Products Setup Panel (Round 2)

**Date:** 2026-05-08
**Reviewer:** GPT-5.5 Pro (web)
**Pasted by:** Greg
**Branch:** `codex/local-claude-order-products-panel-spec` (pushed to origin)
**Round 1 packet:** [r1](2026-05-08-order-products-setup-panel-gpt-pro-r1.md)
**Round 1 outcome:** No BLOCKERs; 2 MAJORs + 3 MINORs found; all 5 actioned in commit `efc1897`.

---

> **For GPT-5.5 Pro:** Round 1 produced 5 findings (2 MAJOR + 3 MINOR). All five are now addressed in the spec and plan on the branch above. This round is a targeted re-check — confirm each finding is resolved correctly, and look for anything the round-1 changes might have introduced. The packet body lists each finding, what changed, and where to look. Return findings in the same severity-grouped format; if everything's clean, say **"Ship the spec"** so we can hand off to Codex.

---

## What changed since round 1

| Round 1 finding | Severity | Fix | Where to verify |
|---|---|---|---|
| Material chip uses `boardNameById` instead of snapshot names; null line-primary can be promoted to "configured" via group defaults | MAJOR | Helper rewritten to read names from `effective_board_name` (parts) / `primary_material_name` (groups); `cutlist_primary_material_id == null` is now an unconditional `not-configured` regardless of group defaults; `boardNameById` removed everywhere; 8 tests now (was 6) | Plan Task 3 (lib/orders/material-chip-data.ts + tests); Task 10 (ProductsTableRow drops `boardNameById` prop); Task 11.2 (page.tsx no longer builds the map) |
| "Reserve components" is line-coded but the API reserves the whole order | MAJOR | Action renamed to **Reserve order components** with order-scoped copy in spec Section 4 and plan Task 8; line-state enable logic dropped; always enabled (matches the page's existing Reserve Stock button); spec adds an explicit scope-note paragraph | Spec → "Section 4 — Next actions"; Plan Task 8 (NextActionsSection); Plan Task 9 (OrderLineSetupPanel uses `onReserveOrderComponents`); Plan Task 11.3 (page.tsx wiring) |
| Spec/plan disagree on whether legacy slide-out is reachable in Phase 1 | MINOR | Both spec and plan now consistently say "compiled but intentionally unreachable in Phase 1, retired in Phase 2." Removed the Risks-table suggestion to add a "View product" link. Plan Task 11 carries an explicit note for the implementer. | Spec → Non-goals; Spec → Risks/edge cases table; Plan → Task 11 (note after the ProductsTableRow call site) |
| Row-click propagation guardrail is too thin — could regress edits/delete/quantity inputs | MINOR | `handleRowClick` upgraded from `[data-row-action]` only to the full `event.target.closest('button, a, input, textarea, select, label, [contenteditable=true], [role="button"], [role="combobox"], [data-row-action]')` pattern. Spec adds an acceptance criterion that explicitly tests no-select-on-control-click. | Plan Task 10 (ProductsTableRow file body); Spec acceptance criteria |
| Component Readiness could drift to card-on-card | MINOR | Refactor from per-row `rounded-sm border` boxes to a compact `divide-y divide-border/40` list with hairline separators. Shortfall tint stays. Spec adds an explicit acceptance criterion and a panel-design note. | Plan Task 7 (ComponentReadinessSection JSX); Spec → Section 3; Spec acceptance criteria |

## Additional housekeeping in the round-2 commit

- `handleTabChange` now drops the `line` URL param when leaving the Products tab so other tabs don't inherit a stale selection (closes the round-1 guardrail you flagged in section 12 answer #5).
- Plan Task 11 numbering was tightened (11.2 dropped; 11.3 → 11.3, 11.5 → 11.4, etc.).
- The Reserve note in Plan Task 11.3 explicitly confirms `reserveComponentsMutation` exists at `page.tsx:828` (preflight finding from round 1) so the implementer doesn't search for a variable name that's already verified.

## Specific things to look at this round

1. **Helper correctness.** Walk `resolveMaterialChip` (Plan Task 3 step 3.3) line by line. Does it correctly handle:
   - A line with `cutlist_primary_material_id = 42`, a group whose `primary_material_id = 42` but no `primary_material_name`, parts with no `effective_board_name` → expected: `single`, primary `Material 42` (last-resort id fallback).
   - A line with `cutlist_primary_material_id = 42`, group `primary_material_name = 'Dark Grey MFC'`, part `effective_board_name = 'Oak Veneer'` (per-part override) → expected: `single`, primary `Oak Veneer` (part-level wins).
   - A line with `cutlist_primary_material_id = null`, group with `primary_material_id = 42` and `primary_material_name = 'Dark Grey MFC'` → expected: `not-configured` (line null is authoritative).
   - Two groups, both with the same `effective_board_name = 'Dark Grey MFC'` → expected: `single` (dedupe via Set).
   - Two groups with different effective names → expected: `multiple`.

2. **Spec/plan internal consistency post-edit.** Edits crossed file boundaries (spec + plan + tests). Anywhere they now disagree?

3. **Acceptance criteria coverage.** Round-2 added five new criteria. Does each map to a specific task in the plan?

4. **No unintended regressions.** Renaming `onReserveComponents` → `onReserveOrderComponents` crosses three files (NextActionsSection, OrderLineSetupPanel, page.tsx wiring). Did all three call sites stay in sync?

5. **Helper test coverage.** Tests grew from 6 to 8. Did anything drop off? (Round 1's "fall back to id label when name unknown" test → recheck it still passes given the new no-name fallback path.)

6. **Component Readiness style cleanup.** The new JSX uses `divide-y divide-border/40` with shortfall row tint via `-mx-1 px-2 bg-destructive/5`. Does the negative margin trick correctly bleed the shortfall tint to the section edge without breaking the hairline divider? (Or is there a cleaner pattern I missed?)

## Files / commits to read

- Branch: `codex/local-claude-order-products-panel-spec`
- Round-2 commit: `efc1897` — single commit; full diff vs round-1
- Spec: `docs/superpowers/specs/2026-05-08-order-products-setup-panel-design.md`
- Plan: `docs/superpowers/plans/2026-05-08-order-products-setup-panel.md`
- Canonical types reference: `lib/orders/snapshot-types.ts` (unchanged)
- Round-1 packet for context: `docs/superpowers/review-packets/2026-05-08-order-products-setup-panel-gpt-pro-r1.md`

## What I expect from this round

Per the POL-83 trial pattern: round 2 typically catches half as much as round 1. If you find zero BLOCKERs and zero MAJORs, say **"Ship the spec"** explicitly so I can hand off to Codex. MINORs that don't affect correctness are acceptable to defer to implementation.

If you do find new issues, return them in the same severity-grouped format with: where, what, what to change, why-severity.
