# Product Swap & Surcharge

> **LOCAL DESKTOP ONLY.** Codex Cloud must not pick up this work — Cloud branches off `main`, this branch lives off `codex/integration` and depends on the post-`main` state. Greg runs Codex on the local desktop; Claude reviews and merges.

**Date:** 2026-04-28
**Status:** Draft pending Codex re-review (round-3 candidate; round 2 findings integrated 2026-04-28).
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

These were resolved with Greg in the 2026-04-28 brainstorm and the 2026-04-28 Codex review feedback passes; Codex must not re-litigate.

- **Two-layer model.** Operational BOM swap (always truthful, drives operations) is separate from commercial surcharge (optional, customer-facing).
- **Three swap targets per BOM row:** *default*, *alternative-in-same-category*, or *removed*.
- **All BOM rows are swappable.** No `is_substitutable` flag gating; `billofmaterials.is_substitutable` may remain in the schema but the UI ignores it.
- **Surcharge is user-controlled.** Field defaults to R0, accepts negative, zero, or positive. Cost delta is shown alongside as a read-only reference. Base line price is never auto-changed by a swap.
- **Customer-facing rendering:** one child line per swap with non-zero surcharge (e.g. `+ White Cover  R15`). Multiple swaps on one line render as multiple children, not rolled up.
- **No lock point.** Swap is editable at every stage of the lifecycle, including after PO sent / work pool generated / job card issued / order shipped. A *warning* is shown and an exception is logged **on the order side only**, when the downstream-state probe returns positive. Quote-side swaps never generate exceptions.
- **Quote and order are independent surfaces.** A swap on the quote does NOT propagate to a related order automatically. Quote→order conversion copies the snapshot once, after which they diverge.
- **Legacy option-sets system is dormant.** Verified 2026-04-28: 0 quote items, 0 order details, 0 selections in production. UI wiring is removed in this work; tables stay in place for a future cleanup cycle.
- **Exception persistence:** swap-after-downstream exceptions live in a **separate `bom_swap_exceptions` table**, not retrofitted onto `job_work_pool_exceptions`.
- **Cutlist on removed components:** the cutlist part has its quantity set to **0**.
- **Surcharge persistence:** quote and order each get a `surcharge_total` numeric column (computed by the application from the snapshot in the same UPDATE that mutates `bom_snapshot`).
- **Phase A is split into A1 and A2** to isolate the totals-trigger introduction from the snapshot/schema/reader work. A2 depends on A1 landing first because A2 removes application-side total writers and only the trigger keeps totals correct after that.

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

The two layers are stored together on the snapshot entry (one JSONB row per original BOM line), but they are *conceptually independent* and the UI surfaces them as separate fields.

### Snapshot Model (extends 2026-03-29)

`order_details.bom_snapshot` already exists as JSONB (one entry per source BOM line). This spec **extends** the entry shape, **does not replace it**. It also **adds** `bom_snapshot` to `quote_items` so quotes can carry the same model, plus `surcharge_total` numeric columns on both `quote_items` and `order_details`.

## Data Model Changes

### 1. `BomSnapshotEntry` shape extension

Existing fields stay intact (`source_bom_id`, `component_id`, `component_code`, `unit_price`, `quantity_required`, `line_total`, `default_component_id`, `default_component_code`, `is_substituted`, `is_cutlist_item`, `cutlist_category`, `cutlist_group_link`, `note`, `supplier_component_id`, `supplier_name`, `category_id`, `category_name`).

The following fields are **new** or **explicitly defined for the first time**.

| Field | Type | Notes |
|---|---|---|
| `swap_kind` | `'default' \| 'alternative' \| 'removed'` | Replaces the implicit "different component_id" check. Authoritative. |
| `is_removed` | boolean | Convenience flag, equal to `swap_kind === 'removed'`. Operational readers MUST branch on this. |
| `effective_component_id` | integer | The component the operational system uses. Equals `component_id` when not removed; **explicitly equals `default_component_id`** when removed (preserves audit). |
| `effective_component_code` | text | Denormalized for display. |
| `effective_quantity_required` | numeric | Equals `quantity_required` when not removed; **0** when removed. |
| `effective_unit_price` | numeric | Equals `unit_price` when not removed; **0** when removed. |
| `effective_line_total` | numeric | `effective_unit_price × effective_quantity_required`. **0** when removed. |
| `default_unit_price` | numeric | Snapshot of the default component's price at swap time. |
| `cost_delta` | computed (not stored) | `(effective_unit_price × effective_quantity_required) − (default_unit_price × quantity_required)`. Derived at render time. |
| `surcharge_amount` | numeric | Defaults to 0. Accepts negative, zero, positive. Independent of `cost_delta`. |
| `surcharge_label` | text \| null | Defaults to the swapped-in component's `component_code` (or `'(removed)'` when removed). User can override. Null = use default. |

`is_substituted` becomes computed (true when `swap_kind !== 'default'`).

### 2. `quote_items` extensions

```sql
ALTER TABLE quote_items
  ADD COLUMN product_id integer NULL,
  ADD COLUMN bom_snapshot jsonb NULL DEFAULT NULL,
  ADD COLUMN surcharge_total numeric(12,2) NOT NULL DEFAULT 0;
```

**Tenant-safety:** add `UNIQUE (product_id, org_id)` on `products` (intentional belt-and-braces; `product_id` is already globally unique, but the composite UNIQUE is the prerequisite for the composite FK below). Then:

```sql
ALTER TABLE quote_items
  ADD CONSTRAINT quote_items_product_org_fk
  FOREIGN KEY (product_id, org_id) REFERENCES products (product_id, org_id);
```

This enforces that the quote item's `org_id` matches the referenced product's `org_id`, closing the cross-tenant FK gap Codex flagged.

The `Explode BOM into Costing Cluster` checkbox in `AddQuoteItemDialog.tsx` becomes the toggle between **legacy explode-into-cluster** behavior and **new snapshot-based product line** behavior. **Default is the new snapshot path when the product has a BOM.** The checkbox is opt-in for the legacy path.

`selected_options` JSONB on `quote_items` stays in the schema for one cycle as a no-op write target.

### 3. `order_details` extensions

```sql
ALTER TABLE order_details
  ADD COLUMN surcharge_total numeric(12,2) NOT NULL DEFAULT 0;
```

`bom_snapshot` already exists; the JSONB shape extension above applies.

### 4. Order-totals trigger introduction (deferred to Phase A2)

**Existing state (verified 2026-04-28):**

- A trigger function `update_order_total()` and trigger `order_details_total_update_trigger` are defined in [`migrations/20250116_order_totals_triggers.sql`](../../migrations/20250116_order_totals_triggers.sql), but this file lives in the legacy `/migrations/` root directory, **not** in `/supabase/migrations/`, and is therefore **NOT applied** to the live database.
- Three application-side writers of `orders.total_amount` exist:

| Writer | File | Behavior | Phase A2 action |
|---|---|---|---|
| Add-products endpoint | [`app/api/orders/[orderId]/add-products/route.ts:208-237`](../../app/api/orders/[orderId]/add-products/route.ts) | Increments `orders.total_amount` after inserting new `order_details` rows. | **Remove** entire total-amount block. Trigger replaces it. |
| `addProductsToOrder` library | [`lib/queries/order-queries.ts:263-293`](../../lib/queries/order-queries.ts) | Increments same way (mirror of above). | **Remove** entire total-amount block. |
| `from-quote` endpoint | [`app/api/orders/from-quote/route.ts:107`](../../app/api/orders/from-quote/route.ts) | Sets `total_amount` once at order creation from `quote.grand_total`. | **Keep** — initialization is harmless; trigger will re-correct on the first detail mutation. |

**Phase A2 migration must:**

- Port the existing `update_order_total()` function and `order_details_total_update_trigger` from `/migrations/20250116_order_totals_triggers.sql` into a fresh Supabase-managed migration under `supabase/migrations/<timestamp>_apply_order_totals_trigger.sql`. Function body is preserved (sums `quantity * unit_price`); add `+ surcharge_total` to the SUM so swaps update the total.
- The trigger fires on INSERT/UPDATE/DELETE of `order_details` (existing behavior + add `surcharge_total` to the watched columns).
- `update_quote_totals()` (already applied in `db/migrations/quotes_v2.sql`) is updated to sum `(line_total + surcharge_total)` instead of `SUM(line_total)`. Idempotent rewrite.
- **Backfill UPDATE** recomputes `orders.total_amount` for all existing orders. Captured in PR diff. Re-runnable. **Stop-and-ask if backfill produces large diffs vs current values** (signals app/trigger drift that needs separate reconciliation).
- **Remove** application-side writers in `add-products` and `order-queries.ts` in the same PR. Application code that depends on the synchronous return of an updated total may need to re-fetch after the mutation.

### 5. New `bom_swap_exceptions` table (Phase A1)

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

  swap_kind_before TEXT NOT NULL,
  swap_kind_after  TEXT NOT NULL,
  effective_component_id_before INTEGER,
  effective_component_id_after  INTEGER,
  effective_component_code_before TEXT,
  effective_component_code_after  TEXT,
  effective_quantity_before numeric,
  effective_quantity_after  numeric,
  surcharge_amount_before numeric,
  surcharge_amount_after  numeric,

  downstream_evidence JSONB NOT NULL DEFAULT '{}',

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

CREATE UNIQUE INDEX idx_bom_swap_exceptions_open_unique
  ON bom_swap_exceptions (order_detail_id, source_bom_id, exception_type)
  WHERE status IN ('open','acknowledged');

CREATE INDEX idx_bom_swap_exceptions_queue
  ON bom_swap_exceptions (org_id, status, exception_type, triggered_at DESC);

ALTER TABLE bom_swap_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY bom_swap_exceptions_org_select ON bom_swap_exceptions
  FOR SELECT USING (is_org_member(org_id));
CREATE POLICY bom_swap_exceptions_org_insert ON bom_swap_exceptions
  FOR INSERT WITH CHECK (is_org_member(org_id));
CREATE POLICY bom_swap_exceptions_org_update ON bom_swap_exceptions
  FOR UPDATE USING (is_org_member(org_id));
-- No DELETE policy: exceptions are not deleted, only resolved.
```

### 6. New `bom_swap_exception_activity` table (Phase A1)

Append-only audit log mirroring `job_work_pool_exception_activity`.

```sql
CREATE TABLE bom_swap_exception_activity (
  activity_id BIGSERIAL PRIMARY KEY,
  exception_id BIGINT NOT NULL REFERENCES bom_swap_exceptions ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'created',
    'swap_applied',           -- follow-up swap on a row with an existing exception
    'acknowledged',
    'resolution_selected',
    'resolved',
    'auto_resolved'
  )),
  performed_by UUID REFERENCES auth.users,
  notes TEXT,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bom_swap_exception_activity_lookup
  ON bom_swap_exception_activity (exception_id, created_at DESC);

ALTER TABLE bom_swap_exception_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY bom_swap_exception_activity_org_select ON bom_swap_exception_activity
  FOR SELECT USING (is_org_member(org_id));
CREATE POLICY bom_swap_exception_activity_org_insert ON bom_swap_exception_activity
  FOR INSERT WITH CHECK (is_org_member(org_id));
-- No UPDATE or DELETE: append-only.
```

`payload` JSONB shape (per event):

```jsonc
{
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

For the `created` event, `payload` carries the initial exception state. For `swap_applied` follow-ups, it carries the new swap event with fresh downstream evidence captured at follow-up time.

### 7. Helper RPC

`upsert_bom_swap_exception(p_order_detail_id, p_source_bom_id, p_swap_event jsonb, p_downstream_evidence jsonb, p_user uuid)`:

- Locks the unique-index row if one exists.
- If no open/acknowledged exception: INSERT new row with `status = 'open'`, populate before/after fields and downstream_evidence. Append a `created` activity row.
- If an open/acknowledged exception already exists: do NOT create a duplicate. Append a `swap_applied` activity row only; bump exception `updated_at`.
- Returns the `exception_id`.

## Snapshot Consumers — full audit (BLOCKER from round 2)

Phase A1 is incomplete until **every** reader of `order_details.bom_snapshot` and `quote_items.bom_snapshot` is audited and updated. Round 2 surfaced four SQL/RPC readers that were missed in round 1.

### TypeScript / application readers

| Reader | File | Current behavior | Phase A1 action |
|---|---|---|---|
| Material cost calculator | [`lib/orders/padded-line-cost.ts:39-41`](../../lib/orders/padded-line-cost.ts) | Filters `is_cutlist_item=false` and sums `line_total`. | **Update** to sum `effective_line_total`. Removed lines have `effective_line_total=0` so cost is correct. Add unit test. |
| Component requirements | [`lib/queries/order-components.ts:188-202`](../../lib/queries/order-components.ts) | Maps each entry to `ComponentRequirement` using `component_id` / `quantity_required` — silently treats removed lines as demand for the default component. | **Update** to skip `is_removed=true` entries OR map using `effective_component_id` + `effective_quantity_required` (qty=0 = no-op). Add unit test covering a removed line. |
| Material cost API | `app/api/orders/[orderId]/details/[detailId]/material-cost/route.ts` | Pass-through to `computePaddedLineCost`. | No change once `padded-line-cost.ts` is updated. |
| Effective BOM API | `app/api/orders/[orderId]/details/[detailId]/effective-bom/route.ts` | Returns `bom_snapshot` as JSON. | No change. |
| Add-products API | `app/api/orders/[orderId]/add-products/route.ts:104,185` | Writes the snapshot. | **Update** snapshot builder to populate `effective_*` and `swap_kind='default'` on initial creation. |
| Snapshot builder | `lib/orders/build-bom-snapshot.ts` | Builds `BomSnapshotEntry[]`. | **Update** to populate all new fields. |
| Quote snapshot builder | `lib/quotes/build-bom-snapshot.ts` (new file or shared helper) | N/A — created in Phase A1. | **Create** with same shape as orders. |
| Snapshot tests | `tests/padded-line-cost.test.ts` and adjacent | Test fixtures use the old shape. | **Update** fixtures + add removed-line cases. |

### SQL/RPC readers (round 2 BLOCKER — these were missed in round 1)

These RPCs read `entry->>'component_id'` and `entry->>'quantity_required'` directly from `bom_snapshot` and currently have **no removal guard**. Removed swaps would produce phantom reservations and inflated shortfall numbers.

| RPC | Migration | Reads | Risk if not updated |
|---|---|---|---|
| `get_detailed_component_status(p_order_id INT)` | [`supabase/migrations/20260331000000_snapshot_aware_component_rpcs.sql`](../../supabase/migrations/20260331000000_snapshot_aware_component_rpcs.sql) lines 12–226 | `entry->>'component_id'`, `entry->>'quantity_required'` | Removed swap leaks into per-order shortfall and cross-order demand summaries. |
| `reserve_order_components(p_order_id INT, p_org_id UUID)` | Same migration, lines 233–297 | Same fields | Removed swap creates phantom reservations against inventory; depletes stock for components the customer no longer wants. |
| `get_detailed_component_status(p_order_id INT)` (revised) | [`supabase/migrations/20260401000001_cutting_plan_aware_rpcs.sql`](../../supabase/migrations/20260401000001_cutting_plan_aware_rpcs.sql) lines 9–314 | `entry->>'component_id'`, `entry->>'quantity_required'`, `entry->>'is_cutlist_item'` | Same; the cutting-plan-aware branching does not protect against removed swaps in the snapshot fallback. |
| `reserve_order_components(p_order_id INT, p_org_id UUID)` (revised) | Same migration, lines 321–414 | Same fields | Same — phantom reservations even when the cutting plan is fresh. |

**Phase A1 must:**

- Create a new migration `supabase/migrations/<timestamp>_snapshot_effective_field_rpcs.sql` that supersedes both `get_detailed_component_status` and `reserve_order_components` with versions that read `effective_component_id` and `effective_quantity_required` instead of `component_id` and `quantity_required`. Use COALESCE to fall back to the old fields for backward compatibility on snapshots that pre-date the migration:
  ```sql
  COALESCE((entry->>'effective_component_id')::int, (entry->>'component_id')::int) AS comp_id,
  COALESCE((entry->>'effective_quantity_required')::numeric, (entry->>'quantity_required')::numeric) AS qty_req
  ```
  Old snapshots: `effective_*` is null → falls back to `component_id` / `quantity_required` (existing behavior preserved). New snapshots: `effective_*` is populated → removed lines have `effective_quantity_required=0` and naturally drop out of demand SUMs.
- Add SQL test cases for: (a) snapshot with no swaps (parity with existing behavior), (b) snapshot with one alternative swap (effective_component_id differs), (c) snapshot with one removed line (effective_quantity_required=0 → no demand contribution).

### Out-of-band readers

If Codex finds any reader of `bom_snapshot` not in the tables above (TS or SQL), it must be added to Phase A1 AC and updated. Stop-and-ask if the reader is in a non-obvious location.

## UI Changes

### Shared swap UI component

Build one `SwapComponentDialog` used by both quote and order line edit. Inputs:

```
Default:    [White Cover]            R5.00 each   (read-only)
Swap to:    [searchable combobox: components in same category]
            • [None / Remove this component]    (synthetic top-of-list option)
Cost delta: +R3.00                                (read-only, computed)
Surcharge:  R [____]   Label: [White Cover_____]  (user-controlled; label autofills)
[Cancel]  [Apply swap]
```

The combobox shares the existing `/api/components/by-category/[categoryId]/route.ts` endpoint.

### Order line render

Each order line shows its existing summary plus, indented underneath, one child row per `bom_snapshot` entry where `swap_kind !== 'default'` AND `surcharge_amount !== 0`. Removed components with non-zero surcharge render with a `−` prefix.

### Quote line render

Identical visual model on the quote Line Items tab. Quote PDF renders parent + children. Quote total = `quotes.subtotal` (auto-computed by the updated `update_quote_totals()` trigger that sums `line_total + surcharge_total`).

### Coexistence rules: snapshot path vs. legacy explode-cluster path

Two paths coexist on quotes only. Orders have no legacy path.

| Operation | Snapshot-path quote item (`product_id IS NOT NULL`, `bom_snapshot IS NOT NULL`) | Legacy cluster item |
|---|---|---|
| **Add product** | Default path; "Explode BOM" unchecked. Builds `bom_snapshot`, writes `quote_items.product_id` and `bom_snapshot`. | Opt-in via "Explode BOM". Existing path unchanged. |
| **Edit line** | `SwapComponentDialog` mutates `bom_snapshot` and `surcharge_total`. | Existing inline cluster-line editing unchanged. |
| **Copy quote** | Clone `bom_snapshot` + `surcharge_total`. | Clone cluster lines as today. |
| **Convert quote → order** | `order_details.bom_snapshot` = clone of `quote_items.bom_snapshot`; `surcharge_total` = clone. New `cutlist_snapshot` built from the product's current `product_cutlist_groups`. | Cluster lines convert to one `order_details` row with `bom_snapshot` built from product BOM. Per-cluster-line edits made on the quote are lost. |
| **PDF / email render** | Parent at base price; child rows for swaps with non-zero surcharge. | Cluster lines flat. |
| **Cutlist** | Quote has no cutlist. Order receives `cutlist_snapshot` per existing 2026-03-29 logic; removed components → cutlist part `quantity = 0`. | No cutlist coupling. |

### Downstream warning

When the swap dialog is opened on an order line that already has downstream activity, render a yellow banner above the form:

> **Components for this line have already been ordered/scheduled.** Swapping will create a production exception that must be resolved by purchasing or production. Continue?

Quote-side never shows this banner.

### Legacy option-sets UI removal

`AddQuoteItemDialog.tsx:371-415` is removed in Phase E. The "Explode BOM" checkbox stays — it now toggles snapshot-path (default) vs. legacy explode (opt-in). For products without a BOM, the dialog falls back to manual pricing entry (the existing Manual tab behavior, surfaced as a hint).

## Cutlist interaction

Quote-side carries only `bom_snapshot`, NOT `cutlist_snapshot`. Cutlist appears at quote→order conversion.

When a swap is to *removed* and the underlying BOM line is referenced by a `cutlist_snapshot` group's `primary_material_id` or `backer_material_id`, the cutlist part(s) referencing that material have **`quantity` set to 0**. Group-level `primary_material_id` / `backer_material_id` references stay intact.

Readers that must respect quantity-0 parts as no-ops (verify in Phase A1):
- `lib/piecework/cuttingPlanWorkPool.ts:buildCuttingPlanWorkPoolCandidates`
- `lib/orders/material-assignment-types.ts:buildPartRoles`
- Any other cutlist aggregator that processes parts

If any does NOT currently filter `quantity > 0`, it must be updated as part of Phase A1.

## Lifecycle & Lock Behavior

| Stage | Swap allowed? | Warning shown? | Exception logged? |
|---|---|---|---|
| Quote draft / sent | Yes | No | No |
| Order placed, no PO yet | Yes | No | No |
| PO drafted | Yes | No | No |
| PO sent to supplier | Yes | Yes | Yes |
| Cutting plan finalized | Yes | Yes | Yes |
| Job card issued | Yes | Yes | Yes |
| Order dispatched | Yes | Yes | Yes |

The system never blocks a swap.

## Downstream-state probe

Order-side only. Queries exactly four sources; creates an exception if any returns positive:

1. **Outstanding supplier orders.** Join `supplier_orders so` to `supplier_order_customer_orders soco` on `soco.supplier_order_id = so.order_id`. Filter `soco.order_id = <this order_id>`, `soco.component_id = <swap source component_id>`, `so.status_id NOT IN (cancelled status ids)`. Populate `downstream_evidence.supplier_orders[]`.
2. **Work pool rows from cutting plan.** Query `job_work_pool` for rows where `order_id = <this order_id>` AND `source = 'cutting_plan'` AND `status != 'cancelled'`. Populate `downstream_evidence.work_pool_rows[]`.
3. **Issued job cards.** Query `job_card_items ji` joined to `job_card jc` on `jc.job_card_id = ji.job_card_id` filtered by `jc.order_id = <this order_id>` AND `ji.status NOT IN ('cancelled')`. Populate `downstream_evidence.job_card_items[]`.
4. **Order dispatched.** Query `orders.status` for the order; populate `downstream_evidence.order_dispatched = true` if dispatched/shipped.

Fifth source needed → STOP and ask Greg.

## Phasing

Five Linear issues under the **Manufacturing** project (six counting the cleanup tracker for option-sets). Codex picks them up in order; Claude reviews each before the next begins.

| Phase | Linear issue scope | Migration? | Greg sign-off? |
|---|---|---|---|
| **A1** | Snapshot extension + `quote_items` columns + `order_details.surcharge_total` + composite FK + `bom_swap_exceptions` + activity table + helper RPC + RLS + ALL snapshot consumer updates (TS + SQL/RPC) + cutlist quantity-0 audit | Yes (multiple migrations in one PR) | Yes (migration + RLS + tenant-FK) |
| **A2** | Order-totals trigger introduction (port `update_order_total` from `/migrations/20250116`, add `surcharge_total` term) + update `update_quote_totals` + remove direct `orders.total_amount` writers in add-products + order-queries + backfill orders | Yes | Yes (trigger introduction is a behavior change) |
| **B** | Order line swap UI (combobox, surcharge field, child-line render) | No | No |
| **C** | Quote line swap UI + PDF rendering | No | No |
| **D** | Downstream swap exception write path + warning banner + activity log integration | No (tables in A1) | Yes (RLS posture re-check on first real writes) |
| **E** | Legacy option-sets UI retirement (separate Linear issue) | No | No |

Phase A2 must land **after** Phase A1. Phases B, C, D, E may proceed in parallel after A2 lands, but D depends on B (the swap mutation hooks the probe).

## Acceptance Criteria

### Phase A1 — Snapshot extension, exceptions, RPC reader updates

**Migration discipline (each step is a separate AC line):**
- A1-D1 Migration files created at `supabase/migrations/<timestamp>_<name>.sql`. Multiple files acceptable; each named distinctly.
- A1-D2 Each migration applied via `mcp__supabase__apply_migration`.
- A1-D3 `mcp__supabase__list_migrations` reconciles against the local migration directory; output captured in PR.
- A1-D4 [`docs/operations/migration-status.md`](../operations/migration-status.md) updated in the same PR.

**Schema:**
- A1-S1 `quote_items` gains `product_id`, `bom_snapshot`, `surcharge_total` per spec.
- A1-S2 `order_details` gains `surcharge_total` per spec.
- A1-S3 `UNIQUE (product_id, org_id)` added to `products`.
- A1-S4 Composite FK `quote_items_product_org_fk` added.
- A1-S5 `bom_swap_exceptions` table + indexes + RLS per spec DDL.
- A1-S6 `bom_swap_exception_activity` table + indexes + RLS per spec DDL.
- A1-S7 Helper RPC `upsert_bom_swap_exception()` created.

**Snapshot shape and builder:**
- A1-B1 `BomSnapshotEntry` TypeScript type extended with all new/repurposed fields.
- A1-B2 `lib/orders/build-bom-snapshot.ts` populates all new fields. Default state: `swap_kind='default'`, `is_removed=false`, `effective_*` equal their non-effective counterparts, `surcharge_amount=0`, `surcharge_label=null`.
- A1-B3 `lib/quotes/build-bom-snapshot.ts` (or shared helper) builds the same shape for `quote_items`.

**Snapshot consumer updates (TS):**
- A1-CT1 `lib/orders/padded-line-cost.ts` sums `effective_line_total`. Test added.
- A1-CT2 `lib/queries/order-components.ts` skips `is_removed` OR uses `effective_*` fields. Test added.
- A1-CT3 If any other TS reader is discovered, it's added to AC and updated.

**Snapshot consumer updates (SQL/RPC) — BLOCKER from round 2:**
- A1-CS1 New migration supersedes `get_detailed_component_status` (both versions) with effective-field-aware version using COALESCE fallback.
- A1-CS2 New migration supersedes `reserve_order_components` (both versions) the same way.
- A1-CS3 SQL test cases for parity (no-swap snapshot), alternative-swap, removed-swap.
- A1-CS4 If any other SQL function reading `bom_snapshot` is discovered, it's added to AC and updated.

**Cutlist consumers:**
- A1-CC1 `cuttingPlanWorkPool.ts` confirmed to filter `expected_count > 0`.
- A1-CC2 `material-assignment-types.ts` confirmed to filter parts with `quantity > 0`.
- A1-CC3 Any other cutlist aggregator audited; updated if needed.

**Verification:**
- A1-V1 Unit tests: default state, alternative swap, removed swap, surcharge negative/zero/positive, label override.
- A1-V2 SQL tests for the RPC supersession (parity, alternative, removed).
- A1-V3 `npm run lint` clean.
- A1-V4 `npx tsc --noEmit` clean (or pre-existing failures explicitly enumerated).
- A1-V5 `mcp__supabase__get_advisors --type security` returns no new issues.

### Phase A2 — Order-totals trigger introduction + writer cleanup

**Migration discipline (4 separate AC lines as in A1).**

**Trigger:**
- A2-T1 New Supabase migration ports `update_order_total()` and `order_details_total_update_trigger` from `/migrations/20250116_order_totals_triggers.sql`. Function body sums `quantity * unit_price + surcharge_total`. Trigger fires on INSERT/UPDATE/DELETE of `order_details` and on UPDATE of `surcharge_total`.
- A2-T2 `update_quote_totals()` rewritten in the same migration to sum `(line_total + surcharge_total)`. Idempotent.
- A2-T3 Backfill UPDATE recomputes `orders.total_amount` for existing orders. Re-runnable. Captured in PR diff.

**Direct-writer removal (BLOCKER from round 2):**
- A2-W1 Block of code at `app/api/orders/[orderId]/add-products/route.ts:208-237` that increments `orders.total_amount` is **deleted**. Trigger replaces it.
- A2-W2 Block of code at `lib/queries/order-queries.ts:263-293` (`addProductsToOrder` total-amount section) is **deleted**.
- A2-W3 `app/api/orders/from-quote/route.ts:107` initialization-only write is **kept** (trigger corrects on first detail mutation).
- A2-W4 If any other writer of `orders.total_amount` is discovered (grep `orders.total_amount` and `total_amount:` patterns), it's added to AC and removed/gated.

**Stop-and-ask conditions:**
- A2-DP1 If the backfill produces `orders.total_amount` diffs greater than ~5% of rows or large absolute values, STOP and surface examples — this signals app/trigger drift that must be reconciled before live data is updated.
- A2-DP2 If any application code reads the synchronous return of `orders.total_amount` after a mutation and expects the application-side increment to have already updated it, STOP and call out the change in semantics (trigger fires after the row write but the API response may need to re-fetch).

**Verification:**
- A2-V1 Unit/integration tests covering: add product to order updates total via trigger; edit surcharge updates total; delete order detail updates total; quote total includes surcharge.
- A2-V2 `mcp__supabase__get_advisors` clean.
- A2-V3 Browser smoke (preview MCP): create order, add product, observe `orders.total_amount` updated. Edit a swap surcharge, observe total updated.

### Phase B — Order line swap UI

- B1 New `SwapComponentDialog` component opens from each order line's BOM panel.
- B2 Combobox lists components in the BOM row's category, with "None / Remove" pinned to the top.
- B3 Cost delta updates live.
- B4 Surcharge field accepts numeric input including negative; label autofills; user can override.
- B5 Apply persists to `order_details.bom_snapshot` AND `order_details.surcharge_total` in the same UPDATE; the order-totals trigger from Phase A2 fires.
- B6 Order line render shows one child row per swap with non-zero surcharge.
- B7 Order PDF renders child rows.
- B8 **Isolated browser smoke:** new order with Panel Leg Desk Test (product 856), open swap dialog, swap to alternative, set surcharge, save, reload, confirm child row + total update. No PO, no work pool, no job cards required.
- B9 Lint + tsc clean.

### Phase C — Quote line swap UI

- C1 `AddQuoteItemDialog` Product tab uses snapshot path by default. "Explode BOM" toggles legacy. No-BOM products fall back to manual entry.
- C2 Same `SwapComponentDialog` wires into the quote line edit flow.
- C3 Quote PDF renders parent + children.
- C4 Quote total auto-recalculates via the updated `update_quote_totals()` from Phase A2.
- C5 **Isolated browser smoke:** new quote with Panel Leg Desk Test, swap a component, set surcharge, regenerate PDF, view PDF.
- C6 Lint + tsc clean.

### Phase D — Downstream swap exception write path

- D1 Order-side swap mutation calls the downstream-state probe and, if positive, calls `upsert_bom_swap_exception()`.
- D2 Activity log entry written in the same transaction.
- D3 First swap creates the exception with `status='open'`; follow-ups append activity without duplicating the exception.
- D4 Order detail page shows the warning banner when downstream activity is detected.
- D5 Production exceptions queue (existing UI) renders the new exception type with a clear visual distinction.
- D6 **Isolated browser smoke:** create order, generate BOL/finalize cutting plan, swap a component, confirm exception with `downstream_evidence.work_pool_rows[]` populated. Resolve with `accept_swap_no_action`; status moves to `resolved`.
- D7 Lint + tsc clean.

### Phase E — Legacy option-sets UI retirement

- E1 `AddQuoteItemDialog.tsx` no longer reads `fetchProductOptionGroups` or renders option dropdowns.
- E2 `quote_items.selected_options` no longer written.
- E3 `app/settings/option-sets/page.tsx` unlinked from settings nav.
- E4 The 2 Handle Library products (DH003 product_id=55, MP002 product_id=44) keep their `product_option_set_links` rows. Browser smoke confirms normal render.
- E5 Cleanup-tracking Linear issue (`Retire legacy option-sets tables`) referenced from this PR.

## Verification Commands

```bash
# All phases
npm run lint
npx tsc --noEmit

# Phase A1
npm run schema
mcp__supabase__list_migrations
mcp__supabase__get_advisors --type security
npx vitest run lib/orders/build-bom-snapshot lib/orders/padded-line-cost lib/queries/order-components

# Phase A2
mcp__supabase__list_migrations
# verify triggers applied:
mcp__supabase__execute_sql "SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE tgname IN ('order_details_total_update_trigger', 'update_quote_totals_trigger')"
# backfill smoke:
mcp__supabase__execute_sql "SELECT COUNT(*) AS drift_count FROM orders o WHERE o.total_amount != (SELECT COALESCE(SUM(quantity * unit_price + surcharge_total), 0) FROM order_details WHERE order_id = o.order_id)"

# Phases B / C / D / E browser smokes — see B8 / C5 / D6 / E4 above.
```

## Decision Points (Codex must stop and ask Greg)

- **Order-totals canonical column.** The spec assumes `orders.total_amount` is the canonical grand-total column. If the order table uses different columns (`subtotal`, `grand_total`, `tax_total`, etc.) like quotes do, STOP at A2 before applying the migration.
- **Composite FK conflict.** If the existing `products` schema already has a UNIQUE that conflicts with the new `(product_id, org_id)` UNIQUE, STOP and confirm before adding.
- **Cutlist quantity-zero filter audit.** If any cutlist aggregator does NOT currently filter `quantity > 0`, STOP.
- **Out-of-band snapshot reader.** If any reader of `bom_snapshot` (TS or SQL) not in this spec is discovered, STOP and add it to AC.
- **Out-of-band `orders.total_amount` writer.** If any writer not in this spec is discovered, STOP and add it to A2 AC.
- **Backfill drift.** If the A2 backfill produces large diffs in `orders.total_amount` for existing orders, STOP and surface examples.
- **Legacy retirement scope.** If Phase E reveals any non-`AddQuoteItemDialog` reader of `selected_options` or `product_option_set_links` not surfaced in the 2026-04-28 reconnaissance, STOP and report.
- **Downstream probe gap.** If Phase D needs a fifth downstream source beyond the four listed, STOP.

## Rollback / Release Notes

### Phase A1 (migration-bearing)

- Migrations reversible: drop new columns, drop new tables, restore prior RPC versions from migration history.
- The COALESCE fallback in the new RPCs means existing snapshots without `effective_*` continue to work.
- If forward migration fails on a row, abort in transaction and roll back; do not skip rows.

### Phase A2 (migration-bearing)

- Trigger drop is reversible. Without the trigger, `orders.total_amount` reverts to being managed by the (now-restored) application-side writers — A2 rollback must restore the deleted code blocks in `add-products` and `order-queries.ts`.
- The backfill is data-only; `orders.total_amount` values can be recomputed from the previous code path if needed.
- A2 rollback without restoring the application writers leaves `orders.total_amount` static — explicitly call this out in the rollback runbook.

### Phases B, C, D, E

- Standard PR revert.

## Documentation Requirements

- Update [`docs/superpowers/specs/2026-03-29-bom-substitution-design.md`](../superpowers/specs/2026-03-29-bom-substitution-design.md) with a "v3 — extended for swap-on-quote, surcharge, removal target, and downstream exception" header and back-link.
- Update [`docs/features/cutlist-calculator.md`](../features/cutlist-calculator.md) with the quantity-0 removed-component rule.
- Update [`docs/operations/migration-status.md`](../operations/migration-status.md) in each migration-bearing PR (A1 and A2).
- Add a short "Swap and surcharge" section to the order detail and quote detail user docs (under `docs/features/`).
- Phase E updates settings docs to remove option-sets references.

## Out of Scope

- Bulk swap.
- Customer self-service swap.
- Per-row "allowed swap targets" curation.
- Currency or tax handling on the surcharge.
- Migrating the 2 existing `product_option_set_links` rows. They become inert when Phase E lands.
- Quote-side cutlist visualization.
- Mid-order partial PO cancellation logic (D's `cancel_or_amend_po` resolution captures intent; the actual PO amendment is a separate purchasing workflow).
- Removing `/migrations/20250116_order_totals_triggers.sql` after A2 ports it (handled in a follow-up cleanup PR).

## Open Questions

None. All resolved 2026-04-28.
