# GPT-5.5 Pro Plan Review — Order Products Setup Panel (Round 1)

**Date:** 2026-05-08
**Reviewer:** GPT-5.5 Pro (web)
**Pasted by:** Greg
**Spec:** [docs/superpowers/specs/2026-05-08-order-products-setup-panel-design.md](../specs/2026-05-08-order-products-setup-panel-design.md)
**Plan:** [docs/superpowers/plans/2026-05-08-order-products-setup-panel.md](../plans/2026-05-08-order-products-setup-panel.md)
**Branch:** `codex/local-claude-order-products-panel-spec` (pushed to origin)

---

> **For GPT-5.5 Pro:** This is a frontend refactor of the Unity ERP order Products tab. Phase 1 only — read-only panel + row strip-down + URL state. No schema, no migrations, no new queries. Both the spec and the plan live on the branch above. Read them first, then this packet, then return your review using the severity-grouped format used in the POL-83 trial (BLOCKERs / MAJORs / MINORs).

---

## 1. Task summary

Replace the inline-expand BOM table on the order detail page's Products tab with a sticky right-side **Order Line Setup** panel that opens when an operator clicks a product line. The panel composes four read-only sections — Overview, Cutlist Materials, Component Readiness, Next Actions — and reuses the existing `CutlistMaterialDialog` unchanged for material editing.

The current row is cramped (chevron expand, inline cutlist material button, surcharge child rows, edit/delete in one horizontally-scrolling table). The redesign:

- Strips the row to: product name + description + **material identity chip** + qty / reserved / to-build / unit-price / total / actions.
- Moves all detail (BOM table, cutlist material summary, surcharges, next actions) into the panel.
- Preserves the existing snapshot principle: order line owns its `bom_snapshot`, `cutlist_material_snapshot`, `cutlist_costing_snapshot`; product edits affect future lines only.

**Out of scope for Phase 1:** cost preview (the mockup proposed `Material estimate R 1,247.80 / Change vs defaults -R 6.09` — held out per `docs/domains/orders/orders-master.md` line 69), inline editing of board/backer/edging in the panel, snapshot-stale detection, schema changes, RLS changes, new queries.

## 2. Current repo context inspected

| Path | Purpose | Key lines / facts |
|---|---|---|
| [`app/orders/[orderId]/page.tsx`](https://github.com/MaierG74/unity-erp/blob/codex/local-claude-order-products-panel-spec/app/orders/%5BorderId%5D/page.tsx) | Order detail page; renders products table + tabs | 1994 lines. `useRouter` / `useSearchParams` already used for `tab=` param at line 134–140. `coverageByProduct` defined at L657. `componentRequirements` query result at L862. `reserveComponentsMutation` at L828, `releaseComponentsMutation` at L844. `ProductsTableRow` rendered at L1301–1327. `slideOutProduct` legacy state at L154 set via `onProductClick={() => setSlideOutProduct(detail)}`. |
| [`components/features/orders/ProductsTableRow.tsx`](https://github.com/MaierG74/unity-erp/blob/codex/local-claude-order-products-panel-spec/components/features/orders/ProductsTableRow.tsx) | Current row component | 452 lines. Currently renders chevron expand, inline cutlist material popover, surcharge child rows, BOM grid (L313–438). Will be stripped. |
| [`components/features/shared/CutlistMaterialDialog.tsx`](https://github.com/MaierG74/unity-erp/blob/codex/local-claude-order-products-panel-spec/components/features/shared/CutlistMaterialDialog.tsx) | Existing material editor | 811 lines. Phase 1 reuses it unchanged. Owns board/backer/edging selection, surcharge, per-part overrides, board-edging pair conflict resolution. |
| [`components/features/orders/OrderSidebar.tsx`](https://github.com/MaierG74/unity-erp/blob/codex/local-claude-order-products-panel-spec/components/features/orders/OrderSidebar.tsx) | Right-column widgets when no line selected | Customer Documents / Order Progress / Quick Actions. Stays as-is; renders only when no line selected. |
| [`lib/orders/snapshot-types.ts`](https://github.com/MaierG74/unity-erp/blob/codex/local-claude-order-products-panel-spec/lib/orders/snapshot-types.ts) | Canonical snapshot type definitions | `CutlistSnapshotGroup` has `primary_material_id/_name`, `backer_material_id/_name`, `effective_backer_id/_name`, `parts: CutlistSnapshotPart[]`. `CutlistSnapshotPart` has `effective_board_name`, `effective_edging_name` (NO `effective_backer_name` on parts). Edging is per-part, not group-level. |
| [`docs/domains/orders/orders-master.md`](https://github.com/MaierG74/unity-erp/blob/codex/local-claude-order-products-panel-spec/docs/domains/orders/orders-master.md) | Canonical orders domain doc | L69 holds the "Products tab intentionally omits material-cost estimates" rule. Plan honors it; defers cost-preview decision to Phase 3. |
| [`docs/features/orders.md`](https://github.com/MaierG74/unity-erp/blob/codex/local-claude-order-products-panel-spec/docs/features/orders.md) | Feature notes including snapshot model and swap/surcharge | Confirms `cutlist_surcharge_resolved` is computed by trigger; `surcharge_total` is rollup. |

### Preflight probe findings already baked into the plan

Per the [GPT-5.5 Pro plan-review trial doc](https://github.com/MaierG74/unity-erp/blob/codex/local-claude-order-products-panel-spec/docs/workflow/2026-04-29-trial-gpt-pro-plan-review.md) the Claude reviewer ran the preflight checklist before producing this packet:

- ✅ `reserveComponentsMutation` confirmed at exact name (page.tsx:828).
- ✅ `cutlist_material_snapshot` shape verified against `lib/orders/snapshot-types.ts`. **Caught a bug in v1 of the plan**: Task 6's `namesFromGroup` helper used `firstPart?.effective_backer_name` and `group?.primary_backer_material_name` / `group?.primary_edging_name`. None of those fields exist. Fixed in plan commit `0b57c09`: backer reads from `group.effective_backer_name ?? group.backer_material_name`; edging reads from `firstPart.effective_edging_name` only.
- ✅ `cutlist_surcharge_resolved` exists on `order_details` (set by DB trigger, also accepted by `app/api/order-details/[detailId]/route.ts` L508).
- ✅ `coverageByProduct` (page.tsx:657) and `componentRequirements` (page.tsx:862) both already in scope at the call site.
- ✅ Frontend stack: Tailwind v4.2 + shadcn 4.0 — plan uses correct v4 syntax (no `tailwind.config.ts`; uses `bg-(--var)` not `bg-[--var]`; uses `shadow-xs` not `shadow`).
- ✅ No new queries introduced — panel reads only data already loaded by the page.
- ✅ Snapshot principle preserved: panel does not write to product templates; only to `order_details`.

## 3. Relevant branches and assumed base branch

- **Spec / plan branch:** `codex/local-claude-order-products-panel-spec` (this branch). Two commits: spec (`c1dc95f`), plan (`5797c4e`), preflight fix (`0b57c09`).
- **Implementation branch (will be created by Codex):** `codex/local-order-products-setup-panel`, cut from `origin/codex/integration` — **not** from this spec branch. The spec / plan live in this branch only as documentation and don't get merged into integration via this branch.
- **Eventual target:** PR from the implementation branch into `codex/integration`.
- **Production target:** `main`, after a release slice from `codex/integration`.

## 4. Files likely to change (Phase 1 only)

### New

- `lib/orders/line-status.ts` — pure helper for the panel's status sentence
- `lib/orders/line-status.test.ts` — vitest tests
- `lib/orders/material-chip-data.ts` — pure helper for the row's material chip
- `lib/orders/material-chip-data.test.ts` — vitest tests
- `components/features/orders/setup-panel/MaterialChip.tsx`
- `components/features/orders/setup-panel/OverviewSection.tsx`
- `components/features/orders/setup-panel/CutlistMaterialsSection.tsx`
- `components/features/orders/setup-panel/ComponentReadinessSection.tsx`
- `components/features/orders/setup-panel/NextActionsSection.tsx`
- `components/features/orders/OrderLineSetupPanel.tsx`

### Modified

- `components/features/orders/ProductsTableRow.tsx` — strip inline expand, cutlist button, surcharge child rows; add row click, selection styling, MaterialChip slot
- `app/orders/[orderId]/page.tsx` — wire `?line=` URL param, render panel vs sidebar conditionally, keyboard navigation, narrow-viewport sheet behavior

### Untouched (intentionally)

- `components/features/shared/CutlistMaterialDialog.tsx` — reused unchanged
- `components/features/orders/OrderSidebar.tsx` — rendered conditionally only
- All API routes, all `lib/db/`, all `lib/queries/`, all migrations
- The legacy `slideOutProduct` consumers — Phase 2 retires them; Phase 1 just stops triggering them on row click

## 5. Files / docs consulted while writing the spec + plan

- `app/orders/[orderId]/page.tsx` (read up to line 1359; greps for relevant patterns)
- `components/features/orders/ProductsTableRow.tsx` (full file)
- `components/features/shared/CutlistMaterialDialog.tsx` (full file)
- `components/features/orders/OrderSidebar.tsx` (full file)
- `lib/orders/snapshot-types.ts` (full file)
- `docs/features/orders.md`
- `docs/domains/orders/orders-master.md`
- `docs/workflow/2026-04-29-trial-gpt-pro-plan-review.md` (this very trial)
- `MEMORY.md` entries: calm-over-density rule, list-state-persistence rule, form-dialog styling, numeric-input pattern, view-drift rule (n/a here since no schema)

## 6. Proposed implementation steps (15 tasks, all in Phase 1)

| Task | Summary |
|---|---|
| 1 | Cut `codex/local-order-products-setup-panel` from `origin/codex/integration` |
| 2 | TDD `lib/orders/line-status.ts` — pure helper, 5 vitest tests |
| 3 | TDD `lib/orders/material-chip-data.ts` — pure helper, 6 vitest tests |
| 4 | `MaterialChip.tsx` component — hairline chip with truncation + tooltip |
| 5 | `OverviewSection.tsx` — to-build / reserved / ordered + status sentence |
| 6 | `CutlistMaterialsSection.tsx` — board-type group rows + Edit button (opens existing dialog) |
| 7 | `ComponentReadinessSection.tsx` — refactor of inline BOM expand JSX into a per-line section |
| 8 | `NextActionsSection.tsx` — four action rows, enable/disable from already-loaded data |
| 9 | `OrderLineSetupPanel.tsx` — composer; supports `asSheet` for narrow viewports |
| 10 | Strip `ProductsTableRow` — remove chevron expand, cutlist button, surcharge child rows; add row click handler, selection styling, MaterialChip slot |
| 11 | Wire `?line=` URL state in `app/orders/[orderId]/page.tsx`; conditionally render panel vs `OrderSidebar` |
| 12 | Keyboard nav (`↑` / `↓` / `Esc`) at page level |
| 13 | Narrow-viewport sheet behavior (`<1024px`) |
| 14 | Browser smoke via preview MCP — walk every acceptance criterion, screenshot for PR |
| 15 | Final `npm run lint`, `npx tsc --noEmit`, `npx vitest run` for both helpers, push, open PR |

Each task in the plan has bite-sized steps with exact code, exact paths, exact verification commands. No placeholders.

## 7. Tenant / RLS considerations

**No new RLS or tenancy work.** The panel reads only data already loaded by the page-level queries that respect existing org-scoped RLS via `is_org_member()` and the composite-FK pattern documented in [`docs/projects/2026-04-19-multi-tenancy-master.md`](https://github.com/MaierG74/unity-erp/blob/codex/local-claude-order-products-panel-spec/docs/projects/2026-04-19-multi-tenancy-master.md).

Specifically:
- `coverageByProduct` and `componentRequirements` are computed from already-fetched, RLS-filtered data.
- `cutlist_material_snapshot` lives on `order_details`, which is already org-scoped.
- `MaterialChip`'s `boardNameById` map is computed from `componentRequirements` (RLS-filtered) — no new fetches.

## 8. Migration / schema considerations

**None.** No schema changes, no migrations, no view updates, no RLS policy changes, no new columns. Plan explicitly forbids them.

The recurring view-drift bug class (every PR adding columns must also extend reading views) does not apply here because no columns are added.

## 9. Testing and validation plan

### Unit (vitest)

- `npx vitest run lib/orders/line-status.test.ts` — 5 tests
- `npx vitest run lib/orders/material-chip-data.test.ts` — 6 tests
- Pure-helper tests follow the existing pattern in `lib/orders/*.test.ts` (Node `assert/strict` + `declare const test`).

### Type / lint

- `npx tsc --noEmit` — clean for new files; pre-existing failures elsewhere reported in PR description per CLAUDE.md verification rule.
- `npm run lint` — clean for new files.

### Browser smoke (preview MCP, with the test account `testai@qbutton.co.za`)

1. Open an order with multiple lines: one configured, one not configured, one with shortfall.
2. Click each line — verify panel context swaps; URL updates.
3. Press `Esc` — verify deselection; sidebar widgets reappear.
4. Reload page with `?line=...` in the URL — verify selection restores.
5. Click Edit materials — verify existing `CutlistMaterialDialog` opens with correct line data and saves correctly.
6. Resize viewport to <1024px — verify sheet behavior.
7. Verify keyboard nav: `↑` / `↓` step between lines; `Esc` closes.
8. Restore any modified test data per the [restore-test-data feedback rule](https://github.com/MaierG74/unity-erp/blob/codex/local-claude-order-products-panel-spec/.claude/projects/-Users-gregorymaier-developer-unity-erp/memory/feedback_restore_test_data.md).

### Acceptance criteria

The full criteria checklist is in the spec at `## Acceptance criteria (Phase 1)`. Each criterion maps to a specific task in the self-review section of the plan.

## 10. Risks and edge cases

| Risk | Mitigation |
|---|---|
| Removing inline BOM expand may surprise operators using it as a quick scan | Component Readiness section is structurally identical, just in the panel. Compact row makes the table scannable in the first place. |
| `?line=` could conflict with `?tab=` | They compose: `?tab=products&line=44`. Switching tabs preserves `tab` and drops `line` if leaving Products. |
| Selection persists via URL but the line gets deleted (deep link to a deleted line) | Falls back to no-selection state; `OrderSidebar` renders. No error toast. |
| Long board names wrap awkwardly in MaterialChip | Truncate at 28 chars (single) / 18 chars (multi) with tooltip showing full name. |
| Page-level keydown listener could conflict with other shortcuts | Listener runs only when `selectedLineId != null`. Excludes events whose target is INPUT / TEXTAREA / contentEditable. Handles only `Escape` / `ArrowUp` / `ArrowDown`. |
| Removing surcharge child rows hides the per-line "this line has surcharges" cue | Surcharge summary lives in panel's CutlistMaterialsSection. Order total in footer still reflects them. If the visual cue is missed during smoke, add a `+R x` micro-suffix to the row's Total cell rather than restoring the child rows. |
| Codex implementer may not realize `slideOutProduct` should remain compiled but unused | Plan explicitly notes this in Out-of-scope reminders and Task 11; Codex preserves the state and consumers, just stops triggering them on row click. |
| Worktree drift between sessions (recurring per MEMORY) | The spec / plan / packet are all on origin. Codex implementer cuts from `origin/codex/integration` cleanly — they do not need this branch. |

## 11. Questions or uncertainties

1. **Is the "no cost preview in Phase 1" decision the right one?** The mockup explicitly shows a `Material estimate R 1,247.80 / Change vs defaults -R 6.09` block. The plan defers it to Phase 3 to honor `orders-master.md` L69. The user (Greg) preferred Option A in design review. Phase 3 gates the decision behind a doc update and a deliberate revisit. Want a sanity check that this is the right discipline.

2. **Will the four-section panel layout work at 1280×800?** The panel is fixed at 440px wide. The left column gets ~840px on a 1280-wide viewport (with 16px gutters). Component Readiness is the densest section; it could be hot at 1280. Might need a "compact mode" or might be fine — review the section JSX in the plan and judge.

3. **Is the `boardNameById` map construction correct?** Plan task 11 step 2 builds it from `componentRequirements` data using `description || internal_code || 'Material {id}'`. The chip's primary may be a board that's NOT in the BOM (it lives in `cutlist_material_snapshot` and is selected through the dialog, which fetches its own `BOARD_CATEGORY_IDS = [75, 3, 14]`). In that case `boardNameById` won't have a name and we fall back to `Material {id}`. Acceptable for Phase 1?

4. **The chevron-expand removal: is there a backwards-compatibility concern?** The current row's `expandedRows` state in `page.tsx` survives Phase 1 (it's used elsewhere — there are similar expanders for components / job cards). Task 11 step 3 instructs the implementer to remove `expandedRows[expandKey]` only from the products-table loop, leaving other usages alone. Anything in the wider page that depended on `expandedRows` being keyed by `order_detail_id`?

5. **Keyboard listener at the page level vs. panel level:** plan attaches `keydown` to `window` for global capture but scopes execution to `selectedLineId != null`. Alternative would be panel-local with a focus trap. Page-level is simpler but slightly more global. Does GPT Pro prefer the simpler page-level approach for Phase 1, or panel-local from the start?

6. **`onProductClick` repurposing:** today this opens `slideOutProduct`. Phase 1 changes it to set the selection (panel). The legacy slideout's data path is preserved but unreachable from this row. Is "preserve but unreach" worth a deprecation comment in the code or just a note in the plan / spec? (Currently a plan-level note only.)

## 12. Specific things I want GPT Pro to review

1. **Phasing decision.** Phase 1 = interaction model + read-only mirror of today's data. Phase 2 = impeccable polish. Phase 3 = cost-preview decision. Phase 4 = inline editing. Right cut, or is something blocked by something else (e.g. should impeccable polish wait for inline editing because re-polishing twice wastes effort)?

2. **The panel composition.** Four sections in one tall vertical scroll. Is that the right answer for 1280×800 or should we tab the panel content?

3. **Field-shape correctness.** The preflight caught one bug. Are there other shape assumptions in the plan that don't match the canonical types in `lib/orders/snapshot-types.ts` or the reality of `cutlist_material_snapshot` rows in production?

4. **The "no new queries" claim.** Walk Task 11's `boardNameById` construction, the panel's `bomComponents` selector, and Section 4's enable/disable logic. Does anything actually require a fetch that doesn't already happen on page load?

5. **The selection URL state.** `?line=<order_detail_id>` composing with `?tab=<id>`. Is there any existing param the new one collides with? Anywhere else on this page that reads `searchParams.get('line')`?

6. **Test coverage.** Two pure helpers get vitest unit tests. Section components get only browser smoke. Is that the right balance, or should one of the section components get its own test (e.g. `MaterialChip` rendering states)?

7. **Out-of-scope discipline.** The plan repeatedly says "do not modify `CutlistMaterialDialog`," "do not surface cost numbers," "do not delete `slideOutProduct`." Are there any other guardrails the plan should put in writing for the implementer?

8. **Stylistic alignment.** The plan uses Tailwind v4 syntax throughout (`shadow-xs`, `bg-(--var)`, `rounded-sm`, no `bg-opacity-*`, hairline borders not side stripes, no card-on-card). Anywhere it slipped to v3 syntax or to a banned pattern?

---

## Standing rules unchanged by this trial (per [trial doc](https://github.com/MaierG74/unity-erp/blob/codex/local-claude-order-products-panel-spec/docs/workflow/2026-04-29-trial-gpt-pro-plan-review.md))

- **LOCAL DESKTOP ONLY** for Codex execution. Implementation branch will be created by Codex Desktop; Codex Cloud's Linear integration remains revoked.
- **`delegate=null`** on the eventual Linear ticket.
- **Auto-merge** is acceptable for this PR if verification is clean — no migration / RLS / schema / auth touched.
- **Browser smoke** is reviewer responsibility if Codex skips it (port collision etc.).
- **No synthetic wage data** — n/a here, no wage flow touched.

---

## Format note for GPT Pro response

Per the POL-83 trial pattern, please return findings grouped by severity:

- **BLOCKERs** — would prevent shipping or cause incorrect behavior
- **MAJORs** — significant issues that should be fixed before implementation
- **MINORs** — nice-to-haves or small improvements

For each finding include: where in the spec / plan / code the issue lives, what the issue is, what to change, and severity rationale. If the spec / plan looks ready to ship as-is, say so explicitly so we can move directly to Codex handoff.
