# Order Products Setup Panel — Design Spec

- **Date:** 2026-05-08
- **Author:** Greg Maier (Claude Code, local desktop)
- **Status:** Draft for plan review
- **Linear:** TBD (file under Manufacturing project)
- **Related docs:** [docs/features/orders.md](../../features/orders.md), [docs/domains/orders/orders-master.md](../../domains/orders/orders-master.md)

## Goal

Turn the order Products tab from a row-table-with-inline-expand into a row-table-plus-side-panel surface. When an operator selects a product line, a sticky right-side **Order Line Setup** panel takes over the detail surface and surfaces readiness, cutlist material identity, component shortfalls, and next actions.

The current row is cramped (BOM expansion, cutlist material button, surcharge child rows, edit/delete actions all crowding a horizontally-scrolling table). The redesign moves detail off the row and into a dedicated panel, leaving the row clean and scannable.

## Non-goals (Phase 1)

- **No cost numbers in the panel.** The existing rule in [orders-master.md](../../domains/orders/orders-master.md) line 69 — *"the Client Order products table intentionally omits material-cost estimates; costing stays on the cutting-plan/costing surfaces"* — stays in force. Cost preview is reopened deliberately in Phase 3 with the docs in the loop.
- **No inline editing of board / backer / edging in the panel.** The existing `CutlistMaterialDialog` is reused unchanged; the panel exposes one **Edit materials** button that opens it.
- **No schema or RLS changes.** All data shown by the panel is already available on `order_details`, `component_requirements`, or already-fetched queries on the order page.
- **No changes to the snapshot rule.** The order line owns its `bom_snapshot`, `cutlist_material_snapshot`, and `cutlist_costing_snapshot`; product edits affect future lines only.
- **No deletion of the existing slide-out** (`setSlideOutProduct`) yet — the state and `OrderSlideOutPanel` component stay compiled but are **intentionally unreachable** in Phase 1 (no row-click trigger, no replacement affordance). Phase 2 retires them after confirming nothing else triggers them. **Do not** add a "View product" link or any other path to re-trigger the slide-out in Phase 1.

## Constraints

- Target branch: off `origin/codex/integration`. Phase 1 is a single PR back into `codex/integration`.
- All currency, quantity, and naming conventions match what's already used elsewhere on the order page.
- Frontend stack: Next.js + Tailwind v4.2 + shadcn 4.0 + tw-animate-css. No v3 syntax.
- Visual register: **product** (Linear-calm). Hairline borders, low-chroma cool neutrals, no shadows on resting surfaces, Workshop Teal accent ≤10% surface, Inter type. No card-on-card.
- Calm-over-density: generous spacing is the default. If a panel section can't fit comfortably, decompose rather than tighten.
- Accessibility: keyboard-navigable selection, focus management when panel opens/closes, ESC-to-close, aria-labelled regions.

## Interaction model

### Selection

- The product row is a click target. Clicking anywhere on the row (outside explicit action buttons — edit, delete, links) selects it.
- Selected row gets a left edge accent (1px Workshop Teal hairline, NOT a thick side stripe) and a subtle background tint at low chroma.
- Clicking a different row swaps panel context to that line.
- Clicking the close button on the panel (or pressing `Esc`) deselects and hides the panel.
- Selection state lives in the URL: `?line=<order_detail_id>`. Honors the [list-state-persistence rule](../../../.claude/projects/-Users-gregorymaier-developer-unity-erp/memory/feedback_list_state_persistence.md) — back-navigation lands the operator on the same line.

### Keyboard

- `↑` / `↓` while the panel is open: move selection to the previous / next product line.
- `Esc`: close panel and deselect.
- `Tab` / `Shift+Tab`: standard focus traversal within the panel.

### Persistence across tab switches

- Panel selection is scoped to the Products tab. Switching to Components / Job Cards / Cutting Plan / Procurement / Documents / Issue Stock does not preserve the panel state — those tabs have their own contexts.
- Coming back to Products restores the previously-selected line (from the URL param) if the line still exists.

## Layout

### Two-column frame (≥1024px viewport)

- **Left column:** main page content as it exists today — the products table, Stock Reservations card, Component Reservations card, totals footer. Width is fluid.
- **Right column:** sticky `Order Line Setup` panel, fixed width **440px**, scrolls independently of the left column. Sits inside the page scroll context (not a modal overlay).
- When no line is selected, the right column shows the existing `OrderSidebar` widgets (Customer Documents, Order Progress, Quick Actions). When a line **is** selected, those widgets give up the slot to the setup panel. Order Progress is order-level and Customer Documents is order-level, so contextually the line panel is more useful when active.

### Stock Reservations / Component Reservations placement

- Stay where they are today: full-width below the products table, in the left column. Page scrolls under the sticky panel. Rationale: order-level not line-level, and decided in design review with Greg.
- Future option (out of Phase 1): if the panel turns out to use less vertical space than estimated, consider moving these inside the panel for selected lines that have reservations against their components specifically.

### Narrow viewport (<1024px)

- Two-column collapses to single-column.
- Selecting a row opens the panel as a **right-side sheet** that slides over the page content. The sheet has its own scrim and close button. ESC and back-button-style dismiss work the same way.
- Same data, same sections — just a different presentation surface.

## Row design (compact)

The current `ProductsTableRow` shrinks to:

| Column | Content |
|---|---|
| Product | Name (clickable to select; opens panel). Description (1-line truncate). **Material chip** below name. Existing `Shortfall` badge retained. |
| Qty | Edit-in-place stays. |
| Reserved | Stays. |
| To Build | Stays. |
| Unit Price | Edit-in-place stays. |
| Total | Stays. |
| Actions | Edit / Delete stay. |

**Removed from the row:**

- Chevron expand button. The whole inline BOM expand goes away.
- Cutlist material button. Lives in the panel as **Edit materials**.
- Surcharge child rows under the parent line. Surcharges are summarized inside the panel's Cutlist materials section. (Order total at the table footer continues to reflect them via the existing trigger.)

**Added to the row — material chip:**

- A single hairline-bordered chip below the product description, showing the primary board name (resolved via the same `componentName()` helper the dialog uses against `cutlist_primary_material_id`).
- States:
  - **Configured, single board type or same primary across multiple board types:** one chip — e.g. `Dark Grey MFC`, `Oak Veneer Board`, `Super-White Melamine`.
  - **Configured with per-part overrides:** primary chip + a muted suffix `+N override(s)`.
  - **Configured with multiple distinct primaries across board types:** up to two chips, then `+M more`.
  - **Not configured (eligible product):** muted "Not configured" chip in lower contrast.
  - **Product has no cutlist snapshot at all:** no chip.
- Backer and edging are intentionally NOT shown on the row. They're structural and live in the panel.

**Status pill on the row:** explicitly NOT added. The existing `Shortfall` badge plus the material chip (or its absence) communicate enough quietly. A separate status pill would double-signal.

## Panel design

### Frame

- Header: line product name + qty (e.g. `Panel Leg Desk Test, qty 10`), close button (×), section nav anchors (optional, deferred unless content gets long).
- Body: four stacked sections with hairline borders between them. No cards-inside-the-panel; the panel itself is the container. Generous vertical spacing between sections.
- Footer: none in Phase 1. Edit actions live inline next to their section.

### Section 1 — Overview

- To-build qty (large), reserved qty, ordered qty.
- One-line **status sentence** in plain English, derived from the line's state:
  - `Ready to plan` — no shortfalls and materials configured (or not required for this product).
  - `Needs cutlist material` — product has a cutlist snapshot but `cutlist_primary_material_id` is null.
  - `3 components short` — at least one BOM component has `metrics.real > 0`.
  - States compose: priorities are Shortfall > Needs material > Ready.
- **Snapshot-stale detection is intentionally out of Phase 1.** A canonical stale signal for `bom_snapshot` and `cutlist_material_snapshot` does not exist today (the work-pool stale check is a separate concept). If we want this state, Phase 2 adds the detection — for now the row + panel quietly omit it.

### Section 2 — Cutlist materials

- One row per board-type group from `cutlist_material_snapshot` (e.g. `32mm With Backer · 1 part`, `16mm Single · 3 parts`).
- Each row shows: board-type label, parts count, primary board name, backer name (if any), edging name. Read-only.
- Below the rows: override count summary if any (`2 part overrides`) and surcharge summary if any (`+R 6.09 line surcharge`).
- One **Edit materials** button at the section footer that opens the existing `CutlistMaterialDialog` — same `applying`, `onApply` plumbing. Zero changes to the dialog component itself in Phase 1.

### Section 3 — Component readiness

- Replaces the inline BOM expand entirely.
- **Renders as a compact list with hairline row separators (`divide-y`), not as a stack of per-row card boxes.** The panel itself is the only container; sections inside the panel must NOT introduce nested cards or per-row borders. A subtle background tint on shortfall rows is the only treatment that's allowed to differ between rows.
- Per-component fields: code/description, required, in stock, reserved, available, on order, shortfall.
- Same `computeComponentMetrics(component, productId)` source of truth as today's inline BOM expand. Same swap-action affordance per row (opens the existing swap dialog via `setSwapTarget`).
- If `showGlobalContext` is on, the global shortfall column appears here just as it does on the inline expand today.
- Empty state: "No component requirements" if the product has no BOM.

### Section 4 — Next actions

- A short ordered list of next-step affordances. Each entry is one row with a verb, a one-line "what this does", and a chevron. No icons-and-headings card grid (per design laws).
- The four entries always render (consistent surface, no shape-shifting):
  - **Reserve order components** — calls existing order-scoped `reserve-components` API. **Scope note:** this API earmarks components across the **entire order**, not just the selected line. The action's title and description must reflect that honestly. Always enabled (matches the existing `Reserve Stock` button's behavior on the page today); shows a loading spinner while the mutation is in flight.
  - **Generate cutting plan** — links to the Cutting Plan tab. Always enabled.
  - **Issue stock** — links to the Issue Stock tab. Always enabled.
  - **Create job cards** — links to the Job Cards tab. Always enabled.
- Phase 1 does NOT introduce a line-scoped reservation flow. A genuinely per-line reservation action would require new API surface and is out of scope. If a future phase needs it, that's a deliberate scope expansion with its own spec.

## Data dependencies

### Already available on the page (no new queries)

- `order_details` row (passed as `detail` to `ProductsTableRow` today)
- `coverage` per product (from `coverageByProduct`)
- `bomComponents` per detail (from `componentRequirements`)
- `computeComponentMetrics` helper
- `showGlobalContext` flag
- `cutlist_material_snapshot`, `cutlist_part_overrides`, `cutlist_primary_material_id`, `cutlist_primary_backer_material_id`, `cutlist_primary_edging_id`, `cutlist_surcharge_*` (all on `order_details`)
- Component name resolution via the same `componentName()` helper the dialog uses

### Already on the page but not yet surfaced together

- Order-level job-card / PO / stock-issuance counts already loaded by `OrderSidebar`. The panel reads from the same query if useful for Section 4 copy, but does not introduce a per-line variant in Phase 1.

### Definitely not needed in Phase 1

- New queries
- New API routes
- New columns, migrations, or RLS changes
- Snapshot-stale detection logic
- Per-line variants of order-level counts

## Files likely touched (Phase 1)

| File | Change |
|---|---|
| `app/orders/[orderId]/page.tsx` | Wire panel state (`?line=` URL param), conditionally render panel vs sidebar in the right column, pass selection callbacks to rows. |
| `components/features/orders/ProductsTableRow.tsx` | Strip inline expand, cutlist button, and surcharge child rows. Add row click handler, selection styling, and material chip. |
| `components/features/orders/OrderLineSetupPanel.tsx` | **New.** Top-level panel component with header, four sections, close button. |
| `components/features/orders/setup-panel/OverviewSection.tsx` | **New.** |
| `components/features/orders/setup-panel/CutlistMaterialsSection.tsx` | **New.** Reuses existing `CutlistMaterialDialog` for the edit action. |
| `components/features/orders/setup-panel/ComponentReadinessSection.tsx` | **New.** Refactored from the inline BOM expand JSX in `ProductsTableRow`. |
| `components/features/orders/setup-panel/NextActionsSection.tsx` | **New.** |
| `components/features/orders/setup-panel/MaterialChip.tsx` | **New.** Renders the row's material identity chip. |
| `components/features/orders/OrderSidebar.tsx` | No change to the component itself; the parent decides when to render it. |
| `components/features/shared/CutlistMaterialDialog.tsx` | **No change.** |

Approximate line count: ~600 LOC of new component code, ~150 LOC of changes to existing files.

## Visual treatment

The panel is a Phase-1 read-only-mostly surface. It should be **functional and calm now, beautiful in Phase 2**. Phase 1 wiring decisions that the impeccable Phase 2 pass needs to inherit cleanly:

- Panel is a flat surface. Sections separated by hairline borders, not nested cards.
- No shadows on resting surfaces.
- Status sentence is text, not a pill or badge.
- Selected row indicator is a 1px left edge in a low-chroma teal, not a thick stripe.
- Material chip is a hairline-bordered, lowercase / sentence-case label — not a pill with a colored background.
- Spacing follows the existing form-dialog convention (`space-y-1.5` / `space-y-4` rhythm) so Phase 2 polish is a refinement pass, not a rewrite.

## Phasing

| Phase | Scope | Reviewer | Branch |
|---|---|---|---|
| **0 (this doc)** | Spec written, committed, pushed to origin. | GPT-5.5 Pro plan review | `codex/local-claude-order-products-panel-spec` |
| **1** | Interaction model, panel frame, four read-only sections, material chip, row strip-down. | Codex code review + Greg | `codex/local-order-products-setup-panel` (or similar; created by implementer) |
| **2** | `impeccable shape` → `craft` polish: type rhythm, hairline tuning, motion, status sentence aesthetic, panel transitions. | impeccable critique → Codex | continuation branch |
| **3** | Cost preview decision (revisit `orders-master.md:69` rule) — if approved, surface material estimate + change-vs-default inside Section 1 or 2. Update the docs. | Greg + GPT-5.5 Pro | new task branch |
| **4** | Inline editing in panel: board / backer / edging dropdowns auto-save; `CutlistMaterialDialog` reduces to per-part overrides only. | Codex + Greg | new task branch |

## Risks / edge cases

| Risk | Mitigation |
|---|---|
| Removing the inline BOM expand may surprise operators who use it as a quick scan. | Panel opens in one click; Component Readiness section is structurally identical to the old expand, just in a different location. The compact row makes the table easier to scan in the first place — testing during Phase 1 review will validate. |
| `?line=<order_detail_id>` URL state could conflict with the existing `tab=<id>` param. | They compose. `?tab=products&line=44` is the canonical form. Switching tabs preserves `tab` and drops `line` if not on Products. |
| Operator opens an order with the panel pre-selected (deep link), but the line was deleted. | Panel falls back to no-selection state; existing sidebar widgets render in the right column. No error toast. |
| Mobile / narrow-viewport sheet animation might feel heavy. | Use the existing slide-over pattern from the order sidebar's mobile mode if one exists, or a simple translateX + ease-out-quart per design laws. No bounce. |
| Material chip with very long board names (`Super-White Premium Melamine 16mm 2440x1830`) wraps awkwardly. | Truncate at ~28 characters with title attribute for full name on hover; tooltip via the existing TooltipProvider. |
| Selection animation between rows could feel laggy on slow devices when the panel re-fetches per-line data. | Panel reads only data already cached at the page level; section components are pure props. No new queries on selection change. |
| Removing surcharge child rows under the parent line removes a visual cue for "this line has surcharges". | Surcharge summary appears inside the panel's Cutlist Materials section. Order total in the footer still reflects them. If the loss is felt during Phase 1 review, add a `+R x` micro-suffix to the row's Total cell rather than reintroducing the child row. |
| `slideOutProduct` stale interaction: `onProductClick` currently opens a slide-out. | Phase 1 repurposes the click to select the line. The legacy slide-out state and `OrderSlideOutPanel` component remain compiled but **intentionally unreachable** in Phase 1 — no replacement affordance, no "View product" link. Phase 2 retires them after confirming nothing else triggers them. |
| Org context: panel must respect `is_org_member()` filtering on any nested data it surfaces. | All data sources are already org-filtered upstream (existing queries). Panel adds no new fetches. |

## Acceptance criteria (Phase 1)

- [ ] Clicking a product row selects it and opens the setup panel on the right.
- [ ] Clicking a different row swaps panel context.
- [ ] Clicking the panel close button (or pressing `Esc`) deselects and shows the existing `OrderSidebar` widgets in the right column.
- [ ] `?line=<order_detail_id>` URL param survives page reload and back-navigation.
- [ ] When a line is selected, the row shows a low-chroma left-edge accent and a subtle background tint.
- [ ] The compact row no longer has a chevron expand, no inline BOM rows, no inline cutlist material button.
- [ ] The compact row shows the material chip with the primary board name when configured, "Not configured" when eligible-but-empty, and nothing when the product has no cutlist snapshot.
- [ ] The panel's Overview section shows to-build / reserved / ordered qty plus a one-line status sentence.
- [ ] The panel's Cutlist Materials section shows one row per board-type group with primary / backer / edging names, plus an Edit materials button that opens the existing `CutlistMaterialDialog` unchanged.
- [ ] The panel's Component Readiness section reproduces the inline BOM data (per-component required / in stock / reserved / available / on order / shortfall) and the swap action.
- [ ] The panel's Next Actions section surfaces **Reserve order components** (honest order-scoped copy), Generate cutting plan, Issue stock, Create job cards.
- [ ] Component Readiness renders as a compact list with hairline row separators — no per-row card-on-card.
- [ ] Row click on any explicit interactive control (button / link / input / textarea / select / `[data-row-action]`) does NOT select the row.
- [ ] The legacy `OrderSlideOutPanel` stays compiled but is unreachable in Phase 1 (no `setSlideOutProduct` call site on row click; no replacement affordance).
- [ ] Leaving the Products tab drops the `?line=` URL param so other tabs don't carry a stale selection.
- [ ] On viewports <1024px, the panel becomes a right-side sheet that slides over the content.
- [ ] Stock Reservations and Component Reservations cards stay where they are today (full-width below the products table).
- [ ] No new queries, no schema or RLS changes.
- [ ] No changes to `CutlistMaterialDialog`.
- [ ] No regression in row edit-in-place, delete, swap, or surcharge behavior.

## Verification commands

- `npm run lint`
- `npx tsc --noEmit` (report unrelated existing failures honestly per CLAUDE.md verification rule)
- Browser smoke (preview MCP):
  - Load an order with multiple product lines, mixed configured / not-configured cutlist material, mixed shortfall states.
  - Click each row, verify panel context swaps, URL updates.
  - Press `Esc`, verify deselection.
  - Reload the page with `?line=...`, verify selection restores.
  - Click Edit materials, verify `CutlistMaterialDialog` opens with current line data and saves correctly.
  - Resize viewport to <1024px, verify sheet behavior.
- Accessibility quick-check: panel opens with focus on close button or first focusable element; `Esc` works; keyboard up/down moves selection.

## Open questions / future decisions

- **Phase 3 cost-preview decision** (revisits `orders-master.md:69`). Defer — not part of this spec.
- **Inline editing in Phase 4** — defer until Phase 1 ships and we see how operators use the panel.
- **`slideOutProduct` retirement** — defer to Phase 2 after confirming nothing else depends on it.
- **Pin a panel** to keep one line's context open while clicking other rows — defer until requested.
- **Linear ticket** — to be filed under Manufacturing project after spec approval.

## Out-of-scope reminders for the implementer

- Do not modify `CutlistMaterialDialog`.
- Do not introduce new queries; everything the panel needs is already on the page.
- Do not surface cost numbers; the rule in `orders-master.md:69` is in force.
- Do not change snapshot semantics on `order_details`.
- Do not touch RLS, migrations, or schema.
- Do not delete the legacy slide-out yet.
