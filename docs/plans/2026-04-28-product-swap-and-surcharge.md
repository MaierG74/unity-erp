# Product Swap & Surcharge

> **LOCAL DESKTOP ONLY.** Codex Cloud must not pick up this work — Cloud branches off `main`, this branch lives off `codex/integration` and depends on the post-`main` state. Greg runs Codex on the local desktop; Claude reviews and merges.

**Date:** 2026-04-28
**Status:** Approved spec, ready for phased Linear handoff
**Related specs:**
- [`2026-03-29-bom-substitution-design.md`](../superpowers/specs/2026-03-29-bom-substitution-design.md) — order-side BOM substitution v2 (foundation; this spec extends it)
- [`2026-03-05-work-pool-exception-audit-spec.md`](./2026-03-05-work-pool-exception-audit-spec.md) — exception/audit pattern this spec mirrors
- [`2026-04-01-per-line-material-assignment-design.md`](../superpowers/specs/2026-04-01-per-line-material-assignment-design.md) — per-line refactor that runs alongside

## Purpose

Customers regularly change components from the product's costing default — sometimes at quote time, sometimes when the order is placed, sometimes after the order has triggered downstream activity (PO sent, work pool generated, job card issued). The system must let users:

1. Swap any BOM line on a quote or order line, in either direction (upgrade, downgrade, or remove).
2. Optionally attach a commercial surcharge to the swap that is independent of the underlying cost change.
3. Continue to swap even after downstream events have started, with a visible audit trail and operational warnings.

Swaps captured this way must propagate cleanly through to component ordering, stock issuance, the cutting plan, and the work pool.

## Decision Summary

These were resolved with Greg in the 2026-04-28 brainstorm; Codex must not re-litigate.

- **Two-layer model.** Operational BOM swap (always truthful, drives operations) is separate from commercial surcharge (optional, customer-facing).
- **Three swap targets per BOM row:** *default*, *alternative-in-same-category*, or *removed*.
- **All BOM rows are swappable.** No `is_substitutable` flag gating; `billofmaterials.is_substitutable` may remain in the schema but the UI ignores it.
- **Surcharge is user-controlled.** Field defaults to R0, accepts negative, zero, or positive. Cost delta is shown alongside as a read-only reference. Base line price is never auto-changed by a swap.
- **Customer-facing rendering:** one child line per swap with non-zero surcharge (e.g. `+ White Cover  R15`). Multiple swaps on one line render as multiple children, not rolled up.
- **No lock point.** Swap is editable at every stage of the lifecycle, including after PO sent / work pool generated / job card issued / order shipped. A *warning* is shown and an *exception activity row* is logged when downstream events have already happened — the swap still goes through.
- **Quote and order are independent surfaces.** A swap on the quote does NOT propagate to a related order automatically; the order has its own snapshot. Quote→order conversion copies the snapshot once, after which they diverge.
- **Legacy option-sets system is dormant.** Verified 2026-04-28: 0 quote items, 0 order details, 0 selections in production. UI wiring is removed in this work; tables stay in place for a future cleanup cycle.

## Architecture

### Two-Layer Model

```
Layer 1 — Operational BOM swap          Layer 2 — Commercial surcharge
─────────────────────────────────       ──────────────────────────────────
Replace component on the BOM            Optional R amount on the line
  → drives PO / picking / issuance       → drives quote total / invoice
  → always accurate                      → user decision per swap
  → no R0 / "do nothing" path            → independent of cost delta
```

The two layers are stored together on the snapshot entry (one JSONB row per original BOM line), but they are *conceptually independent* and the UI surfaces them as separate fields. A user removing a R20 component does not automatically change the line price; only an explicit non-zero surcharge does.

### Snapshot Model (extends 2026-03-29)

`order_details.bom_snapshot` already exists as JSONB (one entry per source BOM line). This spec **extends** the entry shape, **does not replace it**. It also **adds** `bom_snapshot` to `quote_items` so quotes can carry the same model.

## Data Model Changes

### 1. `BomSnapshotEntry` shape extension

Add or repurpose the following fields on each snapshot entry. Keep existing fields (`source_bom_id`, `component_id`, `component_code`, `unit_price`, `quantity_required`, `line_total`, `default_component_id`, `default_component_code`, `is_substituted`, `note`) intact.

| Field | Type | Notes |
|---|---|---|
| `swap_kind` | `'default' \| 'alternative' \| 'removed'` | Explicit. Replaces the implicit "different component_id" check. |
| `is_removed` | boolean | Convenience flag, equivalent to `swap_kind === 'removed'`. Render and operational paths key off this. |
| `effective_quantity_required` | numeric | Equals `quantity_required` when not removed; **0** when removed. |
| `effective_line_total` | numeric | Equals `unit_price * effective_quantity_required`. **0** when removed. |
| `default_unit_price` | numeric | Snapshot of the default component's price at swap time. Used for the cost-delta display. |
| `cost_delta` | computed | `(unit_price × effective_quantity_required) − (default_unit_price × quantity_required)`. Not stored — derived from the other fields at render time. Shown in the swap dialog and on snapshot detail views. |
| `surcharge_amount` | numeric | Defaults to 0. Accepts negative, zero, positive. Independent of `cost_delta`. |
| `surcharge_label` | text \| null | Defaults to the swapped-in component's `component_code` (or `'(removed)'` when removed). User can override. Null/empty = use default. |

**`is_substituted` becomes computed.** Set true when `swap_kind !== 'default'`. Existing readers continue to work.

**Removed components** must still serialize the original BOM context (`source_bom_id`, `default_component_id`, `default_component_code`, `quantity_required`) so the audit trail is intact. `component_id` is set to `default_component_id` when removed (operational code branches on `is_removed`, not on `component_id`).

### 2. `quote_items.bom_snapshot`

`quote_items` does not currently have a `product_id` column; the existing flow either explodes the BOM into individual cluster lines (`explode=true`) or treats the product as opaque (`explode=false`, partially implemented). For swap support, introduce a third path:

- Add `product_id integer null references products(product_id)` to `quote_items` (nullable; Manual / Text / Heading rows leave it null).
- Add `bom_snapshot jsonb null default null` to `quote_items` (mirrors `order_details.bom_snapshot`; null when the row isn't a product line or when the user explicitly chose not to snapshot).
- The `Explode BOM into Costing Cluster` checkbox in `AddQuoteItemDialog.tsx` becomes the toggle between **legacy explode-into-cluster** behavior and **new snapshot-based product line** behavior. For products that are added via the new path, the cluster is not exploded; the quote line stores the snapshot directly and renders surcharge children inline.

Keep `selected_options` JSONB on `quote_items` in the schema for one cycle as a no-op write target. The UI stops reading or writing it in Phase E (option-sets retirement).

### 3. Downstream swap exceptions

A new exception type captures the situation where a swap happens after a downstream event has begun. Mirror the `job_work_pool_exceptions` pattern.

**Recommended approach:** add **one new exception type** to the existing `job_work_pool_exceptions` table rather than create a parallel table. This keeps the production exception queue unified.

- Type: `bom_swapped_after_downstream_event`
- Initial state: `open` (production has not acknowledged downstream impact).
- Created by: the swap mutation, when it detects any of:
  - a non-cancelled supplier PO line referencing this `order_detail_id` and `default_component_id` (or `effective_component_id` if the swap is consecutive);
  - a `job_work_pool` row with `source = 'cutting_plan'` already finalized for this order;
  - a `job_card_item` already issued from a pool row tied to this order;
  - the order is past its dispatch/shipped status.
- One open exception per `(order_detail_id, source_bom_id)`. If a follow-up swap happens on the same line, append to the existing exception's activity log; do not create a duplicate.
- Resolution types (added to existing resolver enum):
  - `accept_swap_no_action` — current stock or in-flight PO is acceptable; nothing to do.
  - `cancel_or_amend_po` — outstanding PO must be amended/cancelled by purchasing (links to PO id in the activity log).
  - `return_old_stock_to_inventory` — already-received stock is no longer needed for this job; flag as available.
  - `accept_swap_with_rework` — production has started; a rework path was agreed.

Quote-side swaps do not generate exceptions. Quotes are not operational.

## UI Changes

### Shared swap UI component

Build one `SwapComponentDialog` (or popover) used by both quote and order line edit. Inputs:

```
Default:    [White Cover]            R5.00 each   (read-only)
Swap to:    [searchable combobox: components in same category]
            • [None / Remove this component]
Cost delta: +R3.00                                (read-only, computed)
Surcharge:  R [____]   Label: [White Cover_____]  (user-controlled; label autofills)
[Cancel]  [Apply swap]
```

The combobox shares the existing `/api/components/by-category/[categoryId]/route.ts` endpoint (already used by the order-side substitution combobox). The "None / Remove" option is a synthetic row at the top of the list, distinct from any component.

### Order line render

On the order detail Products tab, each order line shows its existing summary plus, indented underneath, one child row per `bom_snapshot` entry where `swap_kind !== 'default'` AND `surcharge_amount !== 0`. Removed components with non-zero surcharge render with a `−` prefix. Removed components with zero surcharge are silent in the UI (the operational change is invisible to the customer-facing total).

### Quote line render

Identical visual model on the quote Line Items tab. The quote PDF renders parent line at full price, then child rows with the surcharge label and amount. Quote total = SUM(parent unit_price × qty) + SUM(surcharge_amount × qty across all children).

### Downstream warning

When the swap dialog is opened on an order line that already has downstream activity, render a yellow banner above the form:

> **Components for this line have already been ordered/scheduled.** Swapping will create a production exception that must be resolved by purchasing or production. Continue?

The user can proceed; the exception is created automatically. Quote-side never shows this banner.

### Legacy option-sets UI removal

`AddQuoteItemDialog.tsx:371-415` (the "No configurable options" / option-group dropdowns block) is removed entirely in Phase E. The "Explode BOM into Costing Cluster" checkbox stays — it now toggles legacy-explode vs new-snapshot behavior. Settings page (`/app/settings/option-sets/page.tsx`) is hidden from the navigation but the page itself is not yet deleted; the cleanup-tracking issue handles that later.

## Lifecycle & Lock Behavior

| Stage | Swap allowed? | Warning shown? | Exception logged? |
|---|---|---|---|
| Quote draft / sent | Yes | No | No |
| Order placed, no PO yet | Yes | No | No |
| PO drafted | Yes | No | No |
| PO sent to supplier | Yes | Yes | Yes (`bom_swapped_after_downstream_event`) |
| Cutting plan finalized | Yes | Yes | Yes |
| Job card issued | Yes | Yes | Yes |
| Order dispatched | Yes | Yes | Yes |

The system never blocks a swap. Greg's directive: "if the customer phones and says 'I want this item changed,' we can't force him to take it. There may be an additional charge, but we have to be able to swap the item out."

## Phasing

This spec is implemented across **five Linear issues** under the **Manufacturing** project. Each phase has its own acceptance criteria, verification, and rollback. Codex Desktop picks them up in order; Claude reviews each before the next begins.

| Phase | Linear issue scope | Migration? | Guardrail review by Greg? |
|---|---|---|---|
| **A** | Snapshot extension + `quote_items` snapshot column + builder/reader updates | Yes | Yes (migration + RLS) |
| **B** | Order line swap UI (combobox, surcharge field, child-line render) | No | No |
| **C** | Quote line swap UI + PDF rendering | No | No |
| **D** | Downstream swap exception type + warning banner + activity log integration | Yes (extends existing exception table) | Yes (RLS on activity rows) |
| **E** | Legacy option-sets UI retirement (separate Linear issue) | No | No |

Phases A and D have schema migrations and require Greg sign-off before merging per the standing guardrail. Phases B, C, E are UI/code-only and Claude can merge after self-verification if no other guardrail trips.

## Acceptance Criteria

### Phase A — Snapshot extension

- Migration adds `quote_items.product_id` (nullable FK) and `quote_items.bom_snapshot` JSONB.
- Migration is idempotent and reversible.
- `BomSnapshotEntry` TypeScript type in `lib/orders/snapshot-types.ts` is extended with the eight new/repurposed fields.
- `lib/orders/build-bom-snapshot.ts` populates the new fields when constructing a snapshot from a product BOM. Default state for a fresh snapshot: `swap_kind='default'`, `is_removed=false`, `surcharge_amount=0`, `surcharge_label=null`.
- A new `lib/quotes/build-bom-snapshot.ts` (or shared helper) builds the same shape for `quote_items`.
- All existing readers (order details API, order PDF, work pool builder) keep working unchanged: behavior on `swap_kind='default'` and zero surcharge must be identical to today.
- Unit tests cover: default state, alternative swap, removed swap, surcharge values (negative/zero/positive), label override.

### Phase B — Order line swap UI

- New `SwapComponentDialog` component opens from each order line's BOM panel.
- The combobox lists components in the BOM row's category, with "None / Remove" pinned to the top.
- Cost delta updates live as the user changes the swap target.
- Surcharge field accepts numeric input including negative; label autofills from the swapped component (or `'(removed)'`); user can override label.
- Apply persists to `order_details.bom_snapshot` via the existing snapshot update API; no new endpoint needed.
- Order line render shows one child row per swap with non-zero surcharge.
- The order PDF (downstream of `app/orders/[orderId]/page.tsx` / its print template) renders the child rows in the same hierarchy.
- Browser smoke (preview MCP) passes for: swap to alternative, swap to removed, change surcharge, change label, swap back to default (clears the child row).

### Phase C — Quote line swap UI

- `AddQuoteItemDialog` Product tab gains the new snapshot-based path when the product has a BOM. Existing legacy explode-into-cluster path remains for products without BOM or when the user explicitly toggles it.
- Same `SwapComponentDialog` wires into the quote line edit flow.
- Quote PDF renders parent + child rows identically to the order PDF.
- Quote total recalculates: `parent.unit_price × qty + SUM(child.surcharge_amount × qty)`.
- Browser smoke covers: add product, swap a component, change surcharge, regenerate PDF, view PDF.

### Phase D — Downstream swap exception

- Migration extends the `job_work_pool_exceptions` exception-type enum with `bom_swapped_after_downstream_event`.
- Migration extends the resolver enum with the four new resolution types.
- Swap mutation on `order_details.bom_snapshot` runs a downstream-state probe (PO, cutting plan, work pool, job card, dispatch) and creates/updates the exception accordingly. One open exception per `(order_detail_id, source_bom_id)`.
- Activity log captures the before/after `swap_kind`, `component_id`, `surcharge_amount`, and the user who initiated the swap.
- Order detail page shows the warning banner above the swap dialog when downstream activity is detected.
- Production exceptions queue (existing) renders the new type alongside the existing types.
- Browser smoke covers the create-exception path on a swap after cutting plan finalize.

### Phase E — Legacy option-sets UI retirement

- `AddQuoteItemDialog.tsx` no longer reads `fetchProductOptionGroups` or renders the option dropdowns / "No configurable options" message.
- `quote_items.selected_options` is no longer written by any active code path (legacy reads remain for historical data).
- `app/settings/option-sets/page.tsx` is unlinked from the settings navigation.
- The 2 products linked to the Handle Library option set (DH003, MP002) keep their `product_option_set_links` rows for now — confirm in browser smoke that they render normally after the change.
- The cleanup-tracking Linear issue (`Retire legacy option-sets tables` — opened alongside this spec, parked in Backlog) is referenced from the Phase E PR description as the follow-up that drops the unused tables in a future cycle.

## Verification Commands

Codex must run these before declaring any phase complete. Claude re-runs them independently before approving.

```bash
# All phases
npm run lint
npx tsc --noEmit

# Phase A
npm run schema                                       # confirm migrations applied cleanly
# unit tests for the snapshot builder (file: lib/orders/build-bom-snapshot.test.ts or equivalent)
npx vitest run lib/orders/build-bom-snapshot 2>/dev/null || echo "(test runner not configured for this path; document the manual smoke instead)"

# Phase B / C / D / E (browser smoke via preview MCP — Claude runs if Codex hits a port collision)
# - Add Panel Leg Desk Test (product 856) to a quote
# - Swap one BOM component to an alternative; set surcharge R15
# - Save; reload; confirm child row persists
# - Generate quote PDF; confirm child row renders
# - Convert quote → order; confirm snapshot copies; swap a different component on the order
# - Run cutting plan finalize; swap again on the order; confirm exception is created
```

`mcp__supabase__get_advisors` (security advisor) must be clean for Phases A and D — any new RLS gap blocks the merge.

`mcp__supabase__list_migrations` must reconcile against the local `supabase/migrations/` directory before Codex hands back. Update [`docs/operations/migration-status.md`](../operations/migration-status.md) in the same PR.

## Decision Points (Codex must stop and ask Greg)

- **Schema-shape disagreement:** if during Phase A Codex thinks the `BomSnapshotEntry` extension is unsafe (e.g. existing readers crash on missing fields), stop and ask. Do not invent a default value silently.
- **Migration backfill:** any existing `order_details.bom_snapshot` rows must be backfilled to the extended shape during the Phase A migration. If the backfill SQL exceeds 100 lines or references >2 derived columns, stop and ask Greg before applying.
- **Quote model change:** if Phase C's snapshot path conflicts with the existing exploded-cluster path in a way that requires touching costing-cluster code, stop. Costing/cluster is out of scope for this spec.
- **Exception probe scope:** the downstream-state probe should query exactly four tables: `purchase_order_items` (or equivalent — confirm in the Purchasing module before Phase D starts), `job_work_pool` (rows with `source = 'cutting_plan'` and not cancelled), `job_card_items` (issued, not cancelled), and `orders` (status indicating dispatched). If a fifth table is needed to capture downstream state correctly, stop and ask Greg — that signals a domain gap, not a coding question.
- **Legacy retirement scope:** if Phase E reveals any non-`AddQuoteItemDialog` reader of `selected_options` or `product_option_set_links` that wasn't surfaced in the 2026-04-28 reconnaissance, stop and report before deleting any code.

## Rollback / Release Notes

### Phase A (migration-bearing)

- Migration is reversible: `quote_items.bom_snapshot` and `quote_items.product_id` can be dropped if the rollout fails.
- Existing `order_details.bom_snapshot` data must be migrated forward, not replaced. If the forward migration fails on a specific row, the migration aborts and rolls back; do not skip rows.
- Rollback path: revert the migration; revert the build-bom-snapshot changes; older readers continue to work because the new fields default to "no swap, no surcharge" semantics.

### Phase D (migration-bearing)

- New exception-type enum value is additive; rollback drops the value (must first delete any exceptions of that type).
- Resolution-type enum extensions are additive; rollback requires unresolving any exceptions that use the new resolutions.

### Phases B, C, E (no migration)

- Standard PR revert restores prior UI behavior.
- No data is destroyed by the legacy retirement (Phase E); the underlying tables and columns remain.

## Documentation Requirements

- Update [`docs/superpowers/specs/2026-03-29-bom-substitution-design.md`](../superpowers/specs/2026-03-29-bom-substitution-design.md) with a "v3 — extended for swap-on-quote, surcharge, removal target, and downstream exception" header and a back-link to this spec.
- Update [`docs/features/cutlist-calculator.md`](../features/cutlist-calculator.md) if cutlist material assignment depends on `effective_component_id` (likely yes — check before merging Phase A).
- Update [`docs/operations/migration-status.md`](../operations/migration-status.md) in each migration-bearing PR (Phases A and D).
- Add a short "Swap and surcharge" section to the order detail and quote detail user docs (under `docs/features/`).
- The legacy option-sets retirement (Phase E) updates the relevant settings docs to remove references to option sets.

## Out of Scope

- Bulk swap (apply same swap across multiple lines/orders at once).
- Customer self-service swap (only internal users).
- Per-row "allowed swap targets" curation (free pick within category remains the rule).
- Currency or tax handling on the surcharge (uses the line's existing currency/tax model).
- Migrating the 2 existing `product_option_set_links` rows. They become inert when Phase E lands; the cleanup-tracking issue addresses them later.

## Cutlist interaction (clarification)

The 2026-03-29 v2 design already specifies that cutlist material fields update when their referenced BOM component is substituted. This spec inherits that behavior on the order side and does **not** introduce a quote-side cutlist snapshot — quotes carry only `bom_snapshot`, not `cutlist_snapshot`. Cutlist appears for the first time when the quote is converted to an order. This keeps Phase C tractable.

When a swap is to *removed* and the underlying BOM line is referenced by a `cutlist_snapshot` group's `primary_material_id` or `backer_material_id`, Codex must:
- not crash;
- leave the cutlist group's `primary_material_id` set to the original (default) material reference, but mark the cutlist line `disabled` (or set quantity to 0) so the cutting plan doesn't generate parts for the removed component.

If this implementation choice creates ambiguity with the existing cutting-plan finalize logic, stop and ask Greg in Phase A — this is a thin seam and might need its own micro-decision.

## Open Questions

None. All resolved 2026-04-28.
