# Product Swap & Surcharge

> **LOCAL DESKTOP ONLY.** Codex Cloud must not pick up this work — Cloud branches off `main`, this branch lives off `codex/integration` and depends on the post-`main` state. Greg runs Codex on the local desktop; Claude reviews and merges.

**Date:** 2026-04-28
**Status:** Draft pending Codex re-review (incorporates 2026-04-28 review findings; design calls confirmed by Greg).
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

These were resolved with Greg in the 2026-04-28 brainstorm and the 2026-04-28 Codex review feedback pass; Codex must not re-litigate.

- **Two-layer model.** Operational BOM swap (always truthful, drives operations) is separate from commercial surcharge (optional, customer-facing).
- **Three swap targets per BOM row:** *default*, *alternative-in-same-category*, or *removed*.
- **All BOM rows are swappable.** No `is_substitutable` flag gating; `billofmaterials.is_substitutable` may remain in the schema but the UI ignores it.
- **Surcharge is user-controlled.** Field defaults to R0, accepts negative, zero, or positive. Cost delta is shown alongside as a read-only reference. Base line price is never auto-changed by a swap.
- **Customer-facing rendering:** one child line per swap with non-zero surcharge (e.g. `+ White Cover  R15`). Multiple swaps on one line render as multiple children, not rolled up.
- **No lock point.** Swap is editable at every stage of the lifecycle, including after PO sent / work pool generated / job card issued / order shipped. A *warning* is shown and an exception is logged **on the order side only**, when the downstream-state probe returns positive. Quote-side swaps never generate exceptions.
- **Quote and order are independent surfaces.** A swap on the quote does NOT propagate to a related order automatically; the order has its own snapshot. Quote→order conversion copies the snapshot once, after which they diverge.
- **Legacy option-sets system is dormant.** Verified 2026-04-28: 0 quote items, 0 order details, 0 selections in production. UI wiring is removed in this work; tables stay in place for a future cleanup cycle.
- **Exception persistence:** swap-after-downstream exceptions live in a **separate `bom_swap_exceptions` table**, not retrofitted onto `job_work_pool_exceptions` (the existing table's `work_pool_id NOT NULL` and `(work_pool_id, exception_type)` unique index don't fit the per-(order_detail, source_bom) grain).
- **Cutlist on removed components:** the cutlist part has its quantity set to **0** (not a separate `disabled` flag). The cutting-plan finalize, material-assignment, and cutting-plan optimizer paths already filter by `quantity > 0`, so a 0-quantity row is silently excluded.
- **Surcharge persistence:** quote and order each get a `surcharge_total` numeric column (computed by the application from the snapshot whenever the snapshot is mutated). The existing `update_quote_totals()` trigger is updated to sum `(line_total + surcharge_total)`; a new `update_order_totals()` trigger is added so order totals also auto-update when surcharges change. **This introduces order-totals auto-recalculation that does not exist today** — Phase A and Phase B AC must verify nothing downstream breaks (PDF generation, dashboard summaries, reports).

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

`order_details.bom_snapshot` already exists as JSONB (one entry per source BOM line). This spec **extends** the entry shape, **does not replace it**. It also **adds** `bom_snapshot` to `quote_items` so quotes can carry the same model, plus `surcharge_total` numeric columns on both `quote_items` and `order_details` for trigger-driven totals.

## Data Model Changes

### 1. `BomSnapshotEntry` shape extension

Existing fields stay intact (`source_bom_id`, `component_id`, `component_code`, `unit_price`, `quantity_required`, `line_total`, `default_component_id`, `default_component_code`, `is_substituted`, `is_cutlist_item`, `cutlist_category`, `cutlist_group_link`, `note`, `supplier_component_id`, `supplier_name`, `category_id`, `category_name`).

The following fields are **new** or **explicitly defined for the first time**.

| Field | Type | Notes |
|---|---|---|
| `swap_kind` | `'default' \| 'alternative' \| 'removed'` | Replaces the implicit "different component_id" check. Authoritative. |
| `is_removed` | boolean | Convenience flag, equal to `swap_kind === 'removed'`. Operational readers MUST branch on this. |
| `effective_component_id` | integer | The component the operational system uses. Equals `component_id` when not removed; **explicitly equals `default_component_id`** when removed (preserves audit). Operational readers MUST use this **and** check `is_removed` before treating it as demand. |
| `effective_component_code` | text | Denormalized for display. Equals `component_code` when not removed; equals `default_component_code` when removed. |
| `effective_quantity_required` | numeric | Equals `quantity_required` when not removed; **0** when removed. Operational readers MUST use this for demand. |
| `effective_unit_price` | numeric | Equals `unit_price` when not removed; **0** when removed (no operational cost). |
| `effective_line_total` | numeric | `effective_unit_price × effective_quantity_required`. **0** when removed. |
| `default_unit_price` | numeric | Snapshot of the default component's price at swap time. Used for the cost-delta display. |
| `cost_delta` | computed (not stored) | `(effective_unit_price × effective_quantity_required) − (default_unit_price × quantity_required)`. Derived at render time. |
| `surcharge_amount` | numeric | Defaults to 0. Accepts negative, zero, positive. Independent of `cost_delta`. |
| `surcharge_label` | text \| null | Defaults to the swapped-in component's `component_code` (or `'(removed)'` when removed). User can override. Null = use default. |

**`is_substituted` becomes computed.** Set true when `swap_kind !== 'default'`. Existing readers continue to work for non-removed swaps, but **must be updated to handle removal** (see Snapshot consumers section below).

**Removed components keep audit context.** All "default_*" fields stay populated with original BOM data. `effective_*` fields tell operational code what to do today; `default_*` fields tell auditors what was originally costed.

### 2. `quote_items` extensions

Three column additions:

```sql
ALTER TABLE quote_items
  ADD COLUMN product_id integer NULL REFERENCES products(product_id),
  ADD COLUMN bom_snapshot jsonb NULL DEFAULT NULL,
  ADD COLUMN surcharge_total numeric(12,2) NOT NULL DEFAULT 0;
```

- `product_id` is nullable (Manual / Text / Heading rows leave it null).
- `bom_snapshot` mirrors `order_details.bom_snapshot` exactly. Null when the row isn't a product line OR when the user explicitly chose the legacy explode-into-cluster path.
- `surcharge_total` is application-computed — the swap mutation sets it equal to `SUM(bom_snapshot[].surcharge_amount × qty)` in the same UPDATE that mutates `bom_snapshot`. The total trigger reads it.

**Tenant-safety constraint (BLOCKER from 2026-04-28 review):** add a row-level CHECK or BEFORE INSERT/UPDATE trigger ensuring `quote_items.org_id` matches `quotes.org_id` matches `products.org_id` for the referenced row. Composite FK on `(product_id, org_id)` is the strongest enforcement but requires a corresponding UNIQUE constraint on `products(product_id, org_id)` — which already holds because `product_id` is unique. Phase A AC: implement as composite FK with the additional UNIQUE on `products`.

The `Explode BOM into Costing Cluster` checkbox in `AddQuoteItemDialog.tsx` becomes the toggle between **legacy explode-into-cluster** behavior and **new snapshot-based product line** behavior. **Default is the new snapshot path when the product has a BOM.** The checkbox is opt-in for the legacy path.

`selected_options` JSONB on `quote_items` stays in the schema for one cycle as a no-op write target. The UI stops reading or writing it in Phase E.

### 3. `order_details` extensions

```sql
ALTER TABLE order_details
  ADD COLUMN surcharge_total numeric(12,2) NOT NULL DEFAULT 0;
```

`bom_snapshot` already exists; the JSONB schema extension above applies. `surcharge_total` follows the same application-computed pattern as quote_items.

### 4. Totals triggers

Quote-side already has `update_quote_totals()` (verified in `db/migrations/quotes_v2.sql`). Order-side has **no** trigger today.

**Phase A migration must:**

- Update `update_quote_totals()` to sum `(line_total + surcharge_total)` instead of `SUM(line_total)`. Idempotent rewrite.
- Create `update_order_totals()` that mirrors the quote pattern, fires on INSERT/UPDATE/DELETE of `order_details`, and updates `orders.total_amount` (or whatever the canonical "grand total" column on orders is — confirm in migration; Phase A decision point).
- Both triggers must be transaction-safe and idempotent.

**Order-totals introduction is a real behavior change.** Today, editing an `order_details` row does not move the `orders.total_amount`; after Phase A, it does. Phase A AC must include a backfill UPDATE that recomputes existing orders' `total_amount` so live data is consistent with the new trigger.

### 5. New `bom_swap_exceptions` table

Mirrors the structure of `job_work_pool_exceptions` but at a different grain.

```sql
CREATE TABLE bom_swap_exceptions (
  exception_id BIGSERIAL PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations,
  order_id INTEGER NOT NULL REFERENCES orders,
  order_detail_id INTEGER NOT NULL REFERENCES order_details,
  source_bom_id INTEGER NOT NULL,
  exception_type TEXT NOT NULL CHECK (exception_type IN (
    'bom_swapped_after_downstream_event'
  )),
  status TEXT NOT NULL CHECK (status IN ('open','acknowledged','resolved')),

  -- snapshot of the swap that triggered the exception
  swap_kind_before TEXT NOT NULL,
  swap_kind_after  TEXT NOT NULL,
  effective_component_id_before INTEGER,  -- nullable (could be null in pathological cases; see activity log)
  effective_component_id_after  INTEGER,
  effective_component_code_before TEXT,
  effective_component_code_after  TEXT,
  effective_quantity_before numeric,
  effective_quantity_after  numeric,
  surcharge_amount_before numeric,
  surcharge_amount_after  numeric,

  -- downstream evidence captured at exception-creation time
  downstream_evidence JSONB NOT NULL DEFAULT '{}',  -- shape documented below

  triggered_by UUID REFERENCES auth.users,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_by UUID REFERENCES auth.users,
  acknowledged_at TIMESTAMPTZ,
  resolution_type TEXT CHECK (resolution_type IN (
    'accept_swap_no_action',
    'cancel_or_amend_po',
    'return_old_stock_to_inventory',
    'accept_swap_with_rework'
  )),
  resolution_notes TEXT,
  resolved_by UUID REFERENCES auth.users,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One open/acknowledged exception per (order_detail_id, source_bom_id, exception_type).
-- Follow-up swaps on the same row append to the same exception's activity log.
CREATE UNIQUE INDEX idx_bom_swap_exceptions_open_unique
  ON bom_swap_exceptions (order_detail_id, source_bom_id, exception_type)
  WHERE status IN ('open','acknowledged');

-- Queue index for the production exceptions list
CREATE INDEX idx_bom_swap_exceptions_queue
  ON bom_swap_exceptions (org_id, status, exception_type, triggered_at DESC);
```

**RLS:** mirror `job_work_pool_exceptions` policies — `org_is_member()` for SELECT/INSERT/UPDATE; no DELETE.

**Activity log:** `bom_swap_exception_activity` table mirroring `job_work_pool_exception_activity` (append-only). Captures every swap on a row that has an active exception, plus acknowledgements and resolutions.

**`downstream_evidence` JSONB shape** (captured at exception creation; not updated thereafter — see the activity log for follow-up state):

```jsonc
{
  "supplier_orders": [
    { "supplier_order_id": 1234, "component_id": 56, "ordered_qty": 4, "status": "Sent" }
  ],
  "work_pool_rows": [
    { "work_pool_id": 78, "source": "cutting_plan", "required_qty": 10, "issued_qty": 4 }
  ],
  "job_card_items": [
    { "job_card_item_id": 999, "job_card_id": 412, "issued_qty": 4 }
  ],
  "order_dispatched": false
}
```

### 6. Helper RPC

Mirror `upsert_job_work_pool_exception()`. New RPC `upsert_bom_swap_exception(p_order_detail_id, p_source_bom_id, p_swap_event jsonb, p_downstream_evidence jsonb, p_user uuid)`:

- Locks the unique-index row if one exists.
- If no open/acknowledged exception: INSERT new row with `status = 'open'`, capture before/after fields and downstream_evidence.
- If an open/acknowledged exception already exists: do NOT create a duplicate. Append a row to `bom_swap_exception_activity` with the new swap event; do not modify the exception's primary fields except `updated_at`.
- Returns the `exception_id`.

## Snapshot Consumers (BLOCKER from 2026-04-28 review)

Phase A is incomplete until every reader of `order_details.bom_snapshot` and `quote_items.bom_snapshot` is audited and updated to respect the new fields. The following readers were identified in the codebase audit; Codex must inspect each and either confirm no change is needed or implement the change as part of Phase A.

| Reader | File | Current behavior | Phase A action |
|---|---|---|---|
| Material cost calculator | [`lib/orders/padded-line-cost.ts:39-41`](../../lib/orders/padded-line-cost.ts) | Filters `is_cutlist_item=false` and sums `line_total`. | **Update** to sum `effective_line_total` instead of `line_total`. Removed lines have `effective_line_total=0` so cost is correct. Add unit test. |
| Component requirements | [`lib/queries/order-components.ts:188-202`](../../lib/queries/order-components.ts) | Maps each entry to `ComponentRequirement` using `component_id` and `quantity_required` — silently treats removed lines as demand for the default component. | **Update** to skip entries where `is_removed=true`, OR map using `effective_component_id` and `effective_quantity_required` (treating qty=0 as a no-op). Add unit test covering a removed line. |
| Material cost API | [`app/api/orders/[orderId]/details/[detailId]/material-cost/route.ts:27,65`](../../app/api/orders/[orderId]/details/[detailId]/material-cost/route.ts) | Pass-through to `computePaddedLineCost`. | No change needed once `padded-line-cost.ts` is updated. |
| Effective BOM API | [`app/api/orders/[orderId]/details/[detailId]/effective-bom/route.ts:22,30`](../../app/api/orders/[orderId]/details/[detailId]/effective-bom/route.ts) | Returns `bom_snapshot` as JSON. | No change needed; consumers must be updated separately. |
| Add-products API | [`app/api/orders/[orderId]/add-products/route.ts:104,185`](../../app/api/orders/[orderId]/add-products/route.ts) | Writes the snapshot. | **Update** snapshot builder to populate the new `effective_*` fields and `swap_kind='default'` on initial creation. |
| Snapshot builder | `lib/orders/build-bom-snapshot.ts` | Builds `BomSnapshotEntry[]`. | **Update** to populate all new fields. |
| Snapshot tests | `tests/padded-line-cost.test.ts` | Test fixtures use the old shape. | **Update** test fixtures to include `effective_*` fields and `swap_kind`. Add test cases for removed lines. |

**Out-of-band readers** (not in the audit, must be flagged if discovered): purchasing scheduler, stock reservation, work pool generation, cutting plan finalize. If Codex finds any reader of `bom_snapshot` not in the table above, the reader must be added to the Phase A AC and updated; do not silently leave it.

## UI Changes

### Shared swap UI component

Build one `SwapComponentDialog` (or popover) used by both quote and order line edit. Inputs:

```
Default:    [White Cover]            R5.00 each   (read-only)
Swap to:    [searchable combobox: components in same category]
            • [None / Remove this component]    (synthetic top-of-list option)
Cost delta: +R3.00                                (read-only, computed)
Surcharge:  R [____]   Label: [White Cover_____]  (user-controlled; label autofills)
[Cancel]  [Apply swap]
```

The combobox shares the existing `/api/components/by-category/[categoryId]/route.ts` endpoint. The "None / Remove" option is a synthetic row at the top of the list, distinct from any component.

### Order line render

On the order detail Products tab, each order line shows its existing summary plus, indented underneath, one child row per `bom_snapshot` entry where `swap_kind !== 'default'` AND `surcharge_amount !== 0`. Removed components with non-zero surcharge render with a `−` prefix.

### Quote line render

Identical visual model on the quote Line Items tab. Quote PDF renders parent line at full price, then child rows with the surcharge label and amount. Quote total = `quotes.subtotal` (auto-computed by the updated trigger that sums `line_total + surcharge_total`) plus the existing tax/shipping/discount path.

### Coexistence rules: snapshot path vs. legacy explode-cluster path

Two paths coexist on quotes only. Orders have no legacy path.

| Operation | Snapshot-path quote item (`product_id IS NOT NULL`, `bom_snapshot IS NOT NULL`) | Legacy cluster item (`product_id IS NULL`, has cluster lines) |
|---|---|---|
| **Add product** | Default; "Explode BOM" checkbox unchecked. Builds `bom_snapshot`, writes `quote_items.product_id` and `bom_snapshot`. No cluster lines. | Opt-in via "Explode BOM" checkbox. Existing path unchanged. |
| **Edit line** | Opens `SwapComponentDialog`; mutates `bom_snapshot`; recomputes `surcharge_total`. | Existing inline cluster-line editing unchanged. |
| **Copy quote** | Clone `bom_snapshot` and `surcharge_total` to the new quote; rebuild `org_id` references. | Clone cluster lines as today. |
| **Convert quote → order** | `order_details.bom_snapshot` = clone of `quote_items.bom_snapshot` (verbatim). `order_details.surcharge_total` = clone. New `cutlist_snapshot` is built from the product's current `product_cutlist_groups` (per the existing 2026-03-29 v2 logic). | Cluster lines convert to one `order_details` row with `bom_snapshot` built from the product's current BOM (treating the cluster as a one-off configuration; users lose any per-cluster-line edits made on the quote). |
| **PDF / email render** | Parent line at base price; child rows for swaps with non-zero surcharge. | Cluster lines flat (existing behavior). |
| **Cutlist** | Quote has no cutlist. Order receives `cutlist_snapshot` at conversion time per existing 2026-03-29 logic; if a snapshot entry has `is_removed=true`, the corresponding cutlist part(s) are written with quantity `0` (see Cutlist interaction section). | Cluster lines have no cutlist coupling. Existing behavior. |

### Downstream warning

When the swap dialog is opened on an order line that already has downstream activity (PO sent, work pool finalized, job card issued, or order dispatched), render a yellow banner above the form:

> **Components for this line have already been ordered/scheduled.** Swapping will create a production exception that must be resolved by purchasing or production. Continue?

The user can proceed; the exception is created automatically by the helper RPC. Quote-side never shows this banner and never creates exceptions.

### Legacy option-sets UI removal

`AddQuoteItemDialog.tsx:371-415` (the option-group dropdowns block) is removed entirely in Phase E. The "Explode BOM into Costing Cluster" checkbox stays — it now toggles snapshot-path (default) vs. legacy explode (opt-in). For products without a BOM, neither path applies; the dialog should fall back to manual pricing entry (the existing Manual tab behavior, surfaced as a hint when the product has no BOM rather than rendering an empty options block).

`/app/settings/option-sets/page.tsx` is hidden from the navigation but the page itself is not yet deleted; the cleanup-tracking issue handles that later.

## Cutlist interaction

Quote-side carries only `bom_snapshot`, NOT `cutlist_snapshot`. Cutlist appears for the first time at quote→order conversion.

When a swap is to *removed* and the underlying BOM line is referenced by a `cutlist_snapshot` group's `primary_material_id` or `backer_material_id`, the cutlist part(s) referencing that material have **`quantity` set to 0** in the snapshot. The cutlist group's `primary_material_id` / `backer_material_id` references stay intact for audit; only the part `quantity` changes.

Readers that must respect quantity-0 parts as no-ops:
- Cutting-plan finalize: `lib/piecework/cuttingPlanWorkPool.ts:buildCuttingPlanWorkPoolCandidates` (filters `expected_count > 0`)
- Material assignment grid: `lib/orders/material-assignment-types.ts:buildPartRoles` (filters parts with `quantity > 0`)
- Cutting plan optimizer entry point (any code that aggregates cutlist parts)

If any of these paths does not currently filter quantity > 0 (verify in Phase A), it must be updated as part of Phase A acceptance.

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

## Downstream-state probe

The probe runs only on order-side swaps (quotes never trigger it). It queries exactly four sources and creates an exception if **any** returns positive:

1. **Outstanding supplier orders.** Join `supplier_orders so` to `supplier_order_customer_orders soco` on `soco.supplier_order_id = so.order_id`. Filter `soco.order_id = <this order_id>`, `soco.component_id = <swap's source component_id>`, and `so.status_id NOT IN (cancelled status ids)`. If any row returned, populate `downstream_evidence.supplier_orders[]`.
2. **Work pool rows from cutting plan.** Query `job_work_pool` for rows where `order_id = <this order_id>` AND `source = 'cutting_plan'` AND `status != 'cancelled'`. If any, populate `downstream_evidence.work_pool_rows[]`.
3. **Issued job cards.** Query `job_card_items ji` joined to `job_card jc` on `jc.job_card_id = ji.job_card_id` filtered by `jc.order_id = <this order_id>` AND `ji.status NOT IN ('cancelled')`. If any, populate `downstream_evidence.job_card_items[]`.
4. **Order dispatched.** Query `orders.status` for the order; populate `downstream_evidence.order_dispatched = true` if status indicates dispatched/shipped.

If a fifth source needs to be queried to determine downstream state correctly (e.g. a future allocation or reservation table not visible at spec-writing time), Codex must stop and ask Greg — that signals a domain gap, not a code question.

## Phasing

This spec is implemented across **five Linear issues** under the **Manufacturing** project. Each phase has its own acceptance criteria, verification, and rollback. Codex Desktop picks them up in order; Claude reviews each before the next begins.

| Phase | Linear issue scope | Migration? | Greg sign-off? |
|---|---|---|---|
| **A** | Snapshot extension + `quote_items` snapshot/product/surcharge columns + `order_details.surcharge_total` + totals trigger updates + `bom_swap_exceptions` table + activity table + helper RPC + RLS + ALL snapshot consumer updates | Yes (multiple migrations in one PR) | Yes (migration + RLS + trigger introduction) |
| **B** | Order line swap UI (combobox, surcharge field, child-line render) | No | No |
| **C** | Quote line swap UI + PDF rendering | No | No |
| **D** | Downstream swap exception write path (uses `bom_swap_exceptions` from Phase A) + warning banner + activity log integration | No (table created in Phase A) | Yes (RLS posture re-check on first real writes) |
| **E** | Legacy option-sets UI retirement (separate Linear issue) | No | No |

Phase A is the heaviest and bundles all migrations + table creation + trigger introduction + reader updates. The intent is for Phases B–E to be pure code changes with no further DDL.

## Acceptance Criteria

### Phase A — Snapshot extension and trigger introduction

**Migration discipline (each step is a separate AC line):**
- A1.1 Migration files created at `supabase/migrations/<timestamp>_<name>.sql`. Multiple files acceptable; each named distinctly.
- A1.2 Each migration applied via `mcp__supabase__apply_migration` with the matching name.
- A1.3 `mcp__supabase__list_migrations` reconciles against the local migration directory; output captured in PR.
- A1.4 [`docs/operations/migration-status.md`](../operations/migration-status.md) updated in the same PR.

**Schema:**
- A2.1 `quote_items` gains `product_id INTEGER NULL` (FK with composite `(product_id, org_id)` for tenant safety; requires `UNIQUE (product_id, org_id)` on `products`), `bom_snapshot JSONB NULL DEFAULT NULL`, `surcharge_total NUMERIC(12,2) NOT NULL DEFAULT 0`.
- A2.2 `order_details` gains `surcharge_total NUMERIC(12,2) NOT NULL DEFAULT 0`.
- A2.3 `bom_swap_exceptions` and `bom_swap_exception_activity` tables created with the schema in this spec, plus partial unique index, queue index, and RLS policies.
- A2.4 Helper RPC `upsert_bom_swap_exception()` created and exposed under existing RLS.

**Triggers:**
- A3.1 `update_quote_totals()` rewritten to sum `(line_total + surcharge_total)`; idempotent.
- A3.2 New `update_order_totals()` created on `order_details` INSERT/UPDATE/DELETE; updates `orders.total_amount` (or canonical equivalent — confirm column name in migration).
- A3.3 Backfill UPDATE recomputes `orders.total_amount` for all existing orders so live data is consistent post-trigger-introduction. Backfill captured in PR diff and re-runnable.

**Snapshot shape and builder:**
- A4.1 `BomSnapshotEntry` TypeScript type extended with all new/repurposed fields per the Data Model Changes section. Existing fields preserved.
- A4.2 `lib/orders/build-bom-snapshot.ts` populates the new fields. Default state for a fresh snapshot: `swap_kind='default'`, `is_removed=false`, `effective_*` fields equal their non-effective counterparts, `surcharge_amount=0`, `surcharge_label=null`.
- A4.3 New `lib/quotes/build-bom-snapshot.ts` (or shared helper used by both) builds the same shape for `quote_items`.

**Snapshot consumers (every reader audited and updated; tests cover removed-line case):**
- A5.1 [`lib/orders/padded-line-cost.ts`](../../lib/orders/padded-line-cost.ts) sums `effective_line_total` (not `line_total`). Test added covering a removed line.
- A5.2 [`lib/queries/order-components.ts`](../../lib/queries/order-components.ts) skips `is_removed` entries OR uses `effective_component_id` + `effective_quantity_required` (qty=0 = no-op). Test covers removed line.
- A5.3 If Codex discovers any other reader of `bom_snapshot` not in the audit table in this spec, that reader is added to the AC and updated.

**Cutlist consumers (every quantity > 0 filter audited; failing readers updated):**
- A6.1 `lib/piecework/cuttingPlanWorkPool.ts` confirmed to filter `expected_count > 0`.
- A6.2 `lib/orders/material-assignment-types.ts` confirmed to filter parts with `quantity > 0`.
- A6.3 Any other cutlist aggregator that processes parts is audited; if it doesn't filter quantity > 0, it's updated.

**Verification:**
- A7.1 Unit tests cover: default state, alternative swap, removed swap, surcharge values (negative/zero/positive), label override.
- A7.2 `npm run lint` clean.
- A7.3 `npx tsc --noEmit` clean (or pre-existing failures explicitly enumerated).
- A7.4 `mcp__supabase__get_advisors` (security) returns no new issues.

### Phase B — Order line swap UI

- B1 New `SwapComponentDialog` component opens from each order line's BOM panel.
- B2 Combobox lists components in the BOM row's category, with "None / Remove" pinned to the top.
- B3 Cost delta updates live as the user changes the swap target.
- B4 Surcharge field accepts numeric input including negative; label autofills from the swapped component (or `'(removed)'`); user can override.
- B5 Apply persists to `order_details.bom_snapshot` AND `order_details.surcharge_total` in the same UPDATE; the order-totals trigger fires and `orders.total_amount` reflects the change.
- B6 Order line render shows one child row per swap with non-zero surcharge.
- B7 The order PDF / print template renders the child rows in the same hierarchy.
- B8 **Isolated browser smoke** (preview MCP): create a new order with Panel Leg Desk Test (product 856), open swap dialog on one BOM row, swap to alternative, set surcharge, save, reload, confirm child row + total update. No PO, no work pool, no job cards required.
- B9 Lint + tsc clean.

### Phase C — Quote line swap UI

- C1 `AddQuoteItemDialog` Product tab uses snapshot path by default when product has BOM. "Explode BOM" checkbox toggles legacy path. Products without BOM fall back to manual entry.
- C2 Same `SwapComponentDialog` wires into the quote line edit flow.
- C3 Quote PDF renders parent + child rows identically to the order PDF.
- C4 Quote total auto-recalculates via `update_quote_totals()` (already handled in Phase A).
- C5 **Isolated browser smoke**: new quote with Panel Leg Desk Test, swap a component, change surcharge, regenerate PDF, view PDF, confirm child row visible. No order needed.
- C6 Lint + tsc clean.

### Phase D — Downstream swap exception write path

- D1 Order-side swap mutation calls the downstream-state probe (the four sources defined in this spec) and, if positive, calls `upsert_bom_swap_exception()` with the swap event and `downstream_evidence` JSONB.
- D2 Activity log entry written in the same transaction with the full payload (see "Activity log payload contract" below).
- D3 First swap on a row creates the exception with `status='open'`. Follow-up swaps on the same `(order_detail_id, source_bom_id)` append to the activity log without creating duplicate exceptions.
- D4 Order detail page shows the warning banner above the swap dialog when downstream activity is detected.
- D5 Production exceptions queue (existing UI) renders the new exception type alongside `over_issued_*` types, with a clear visual distinction (separate icon/color is acceptable).
- D6 **Isolated browser smoke**: create order, generate BOL or finalize cutting plan (whichever produces a work pool row faster), swap a component, confirm exception is created with `downstream_evidence.work_pool_rows[]` populated. Resolve the exception with `accept_swap_no_action`; confirm status moves to `resolved`.
- D7 Lint + tsc clean.

### Phase E — Legacy option-sets UI retirement

- E1 `AddQuoteItemDialog.tsx` no longer reads `fetchProductOptionGroups` or renders option dropdowns. The "No configurable options" message disappears.
- E2 `quote_items.selected_options` is no longer written by any active code path (legacy reads tolerated for historical data).
- E3 `app/settings/option-sets/page.tsx` is unlinked from the settings navigation (the page file remains; the cleanup-tracking issue handles deletion later).
- E4 The 2 products linked to Handle Library (DH003 product_id=55, MP002 product_id=44) keep their `product_option_set_links` rows. **Browser smoke** confirms they render normally in the new dialog (no error, no empty options block, no broken state).
- E5 Cleanup-tracking Linear issue (`Retire legacy option-sets tables`) referenced from this PR's description.

## Activity log payload contract

`bom_swap_exception_activity` rows carry the full payload of each swap event so downstream auditors can replay the timeline without joining other tables.

```jsonc
{
  "event_type": "swap_applied",        // or 'acknowledged', 'resolution_selected', 'resolved', 'auto_resolved'
  "performed_by": "<auth.users uuid>",
  "performed_at": "2026-04-29T10:30:00Z",
  "order_detail_id": 1234,
  "source_bom_id": 56,
  "swap_kind_before": "default",
  "swap_kind_after": "alternative",
  "effective_component_id_before": 78,
  "effective_component_id_after":  79,
  "effective_component_code_before": "BLACK-COVER",
  "effective_component_code_after":  "WHITE-COVER",
  "effective_quantity_before": 1,
  "effective_quantity_after":  1,
  "surcharge_amount_before": 0,
  "surcharge_amount_after":  15,
  "surcharge_label_before": null,
  "surcharge_label_after":  "White Cover",
  "downstream_evidence_at_event": { /* same shape as the exception row's downstream_evidence */ }
}
```

For the **first** swap on a row (creating the exception), `downstream_evidence_at_event` is the canonical evidence stored on the exception row. For **follow-up** swaps that append to an existing exception, `downstream_evidence_at_event` is captured fresh at the time of the follow-up swap.

## Verification Commands

Codex must run these before declaring any phase complete. Claude re-runs them independently before approving.

```bash
# All phases
npm run lint
npx tsc --noEmit

# Phase A specific
npm run schema                                                  # confirm migrations applied
mcp__supabase__list_migrations                                  # capture in PR
mcp__supabase__get_advisors --type security                     # no new RLS gaps
npx vitest run lib/orders/build-bom-snapshot 2>/dev/null \
  || echo "(vitest path may differ — confirm and update verification)"
npx vitest run lib/orders/padded-line-cost
npx vitest run lib/queries/order-components

# Phase B/C/D/E browser smokes (preview MCP)
# Each phase's smoke uses isolated test data — see B8/C5/D6/E4 above.
# Greg may run them in any order; reviewer (Claude) re-runs before approval.
```

`mcp__supabase__get_advisors` must be clean for Phase A and Phase D. Any new RLS gap blocks the merge.

## Decision Points (Codex must stop and ask Greg)

- **Order-totals canonical column.** The spec assumes `orders.total_amount` is the canonical grand-total column. If the order table uses different columns (`subtotal`, `grand_total`, `tax_total`, etc.) like quotes do, Codex must STOP at Phase A and ask Greg which column(s) the trigger should write before applying the migration. Backfill scope changes accordingly.
- **Composite FK requirement.** The tenant-safety constraint requires `UNIQUE (product_id, org_id)` on `products`. If the existing `products` schema has a constraint conflict (already has a different unique index that overlaps), STOP and confirm before adding.
- **Cutlist quantity-zero filter audit.** If any cutlist aggregator does NOT currently filter `quantity > 0` (Phase A AC items A6.1–A6.3), STOP and surface — that's a hidden seam that may break in non-obvious ways.
- **Out-of-band snapshot reader.** If Phase A discovers a reader of `bom_snapshot` not in the audit table in this spec, STOP and add it to the AC; do not silently update.
- **Downstream probe gap.** If Phase D needs a fifth downstream source (beyond the four listed), STOP and ask Greg before adding it.
- **Legacy retirement scope.** If Phase E reveals any non-`AddQuoteItemDialog` reader of `selected_options` or `product_option_set_links` not surfaced in the 2026-04-28 reconnaissance, STOP and report.
- **Order-totals backfill side effects.** If the Phase A backfill UPDATE produces large diffs in `orders.total_amount` for existing orders, STOP and surface examples — this could indicate the existing application-side total computation drifted from the trigger logic and needs reconciliation before live data is updated.

## Rollback / Release Notes

### Phase A (migration-bearing)

- Migrations are reversible: each new column can be dropped, each new table can be dropped, each trigger can be reverted to its previous body.
- The `update_order_totals()` trigger can be dropped without data loss; `orders.total_amount` reverts to being application-managed (existing rows keep their last computed value).
- Forward backfill must be safe to re-run if rolled forward then back then forward again.
- If the forward migration fails on a specific row, the migration aborts in a transaction and rolls back; do not skip rows.

### Phase D (no migration)

- Standard PR revert restores prior behavior. No data is destroyed.

### Phases B, C, E (no migration)

- Standard PR revert. No data destroyed.

## Documentation Requirements

- Update [`docs/superpowers/specs/2026-03-29-bom-substitution-design.md`](../superpowers/specs/2026-03-29-bom-substitution-design.md) with a "v3 — extended for swap-on-quote, surcharge, removal target, and downstream exception" header and a back-link to this spec.
- Update [`docs/features/cutlist-calculator.md`](../features/cutlist-calculator.md) with the quantity-0 removed-component rule.
- Update [`docs/operations/migration-status.md`](../operations/migration-status.md) in each migration-bearing PR (Phase A only — Phase D is no-migration).
- Add a short "Swap and surcharge" section to the order detail and quote detail user docs (under `docs/features/`).
- Phase E updates the relevant settings docs to remove references to option sets.

## Out of Scope

- Bulk swap (apply same swap across multiple lines/orders at once).
- Customer self-service swap (only internal users).
- Per-row "allowed swap targets" curation (free pick within category remains the rule).
- Currency or tax handling on the surcharge (uses the line's existing currency/tax model).
- Migrating the 2 existing `product_option_set_links` rows. They become inert when Phase E lands; the cleanup-tracking issue addresses them later.
- Quote-side cutlist visualization (cutlist appears at quote→order conversion only).
- Mid-order partial PO cancellation logic (Phase D's `cancel_or_amend_po` resolution captures the user's *intent*; the actual PO amendment is a separate purchasing workflow).

## Open Questions

None. All resolved 2026-04-28.
