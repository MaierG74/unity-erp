# Internal Orders & Order Completion — Design Spec

- **Date:** 2026-05-25
- **Author:** Greg Maier (Claude Code, local desktop)
- **Status:** Round 3 GPT-5.5 Pro feedback integrated (0 BLOCKERs + 4 MAJORs + 6 MINORs + 3 NITs addressed). Reviewer recommended proceeding to `writing-plans` after MAJORs were addressed; one round-4 confirmation packet then implementation plan.
- **Linear:** TBD (file as epic under Manufacturing project; 8 phase sub-issues)
- **Related docs:** [docs/features/orders.md](../../features/orders.md), [docs/plans/2026-03-05-work-pool-job-card-issuance.md](../../plans/2026-03-05-work-pool-job-card-issuance.md), [docs/superpowers/specs/2026-05-08-order-products-setup-panel-design.md](2026-05-08-order-products-setup-panel-design.md), [public/internal-orders-design.html](../../../public/internal-orders-design.html) (interactive walkthrough)

## Goal

Introduce a unified completion model for orders that:

1. Adds **internal orders** — orders that flow through the same manufacturing pipeline as customer orders but produce finished-goods stock rather than a customer delivery.
2. Adds **delivery notes** — the missing closing-the-loop artifact for customer orders, supporting partial fulfilment and both Unity-generated and externally-recorded (Pastel) notes.
3. Adds the **"product is ready" event** by making the half-built section-routing infrastructure load-bearing — populating `order_manufacturing_sections.completed_at` from job-card completion, then cascading to an `order_details.status='ready'` flip when all required sections close.
4. Adds an **inventory transactions history page** so stock movements are descriptive, filterable, and source-linked.

The work also gives Unity ERP a real "order closed" state for the first time. Today an order can sit at "In Production" forever; with this work an order closes when delivered (customer) or received into stock (internal).

## Non-goals

- **No customer returns flow.** Returns from a customer are handled via manual stock adjustment with a reason.
- **No supplier returns of stock components.** Separate, existing flow.
- **No multi-warehouse / multi-location stock.** Single inventory location per org (matches today).
- **No serial-number tracking.** Quantity-only.
- **No automatic Pastel API sync.** Pastel integration is manual paste of the Pastel DN number into Unity; bidirectional sync is a later project.
- **No reservation against internal-order ready stock.** Once an internal order's items are received, they become general stock; if a specific customer order needs the stock, the existing `product_reservations` flow takes over.
- **No reverse-from-ready.** Once an `order_details.status='ready'`, the path back to `'in_production'` is an admin-only "Reopen item" action (not part of v1 UI; only available via direct RPC for support). Cancel + manual stock adjust is the normal workaround.
- **No backfill of historical orders into the section model.** Only new orders created after this lands get section routing instantiated. Backfill is a separate, optional task.
- **No changes to BOM / raw-materials inventory logic.** Internal orders consume raw materials through the existing BOL pipeline; this spec only changes what happens at the *finished* end.
- **No piecework changes.** Piecework computation and earnings stay exactly as they are. Internal orders earn piecework the same way customer orders do.

## Constraints

- Target branch: off `origin/codex/integration`. Phased PRs back into `codex/integration`.
- Multi-tenancy: every new table gets `org_id` + RLS scoped to `is_org_member(org_id)`. No nested-relation assumptions in UI (memory rule: nested relations can be null under RLS).
- Frontend stack: Next.js + Tailwind v4.2 + shadcn 4.0 + tw-animate-css. No v3 syntax. Use the `tailwind-v4` skill for styling work.
- Visual register: Linear-calm. Hairline borders, low-chroma cool neutrals, no shadows on resting surfaces, Workshop Teal accent ≤10% surface, Inter type. No card-on-card.
- Calm-over-density: generous spacing is the default. Operators on 1366×768 monitors are real — but the answer is decomposition (multi-step, side sheet, inline sub-window), not compression.
- List-state persistence: filter state on the transactions page lives in URL search params; scroll position uses Next.js restoration or sessionStorage. Memory rule applies (back-navigation lands the operator exactly where they were).
- PDF rendering: delivery-note PDF MUST use `@react-pdf/renderer` with lazy/dynamic import (memory rule: causes build timeouts otherwise).
- No synthetic wage data in the live DB: piecework is unchanged; smoke tests that touch piecework rows MUST clean up.
- Always verify HEAD before commit (memory rule: multi-session worktrees share `.git`).
- Spec applies the project's standard "verification before completion" rule: every phase ships with `npm run lint`, `npx tsc --noEmit` on touched areas, and (where possible) a browser smoke or RLS smoke.

## Background — what exists today

This section is **filesystem-validated against the live schema** (2026-05-25 preflight). Treat these column names and types as authoritative; the original design walkthrough in `public/internal-orders-design.html` used some shorthand that has been corrected below.

| Piece | State |
|---|---|
| `orders` | PK `order_id`. `customer_id integer NULLABLE` (already nullable today; no CHECK). `org_id uuid NOT NULL` default '99183187-…'. `status_id integer NULLABLE` → `order_statuses`. No `order_type`. RLS on, 4 policies. |
| `order_details` | (The line-items table — NOT `order_items`.) PK `order_detail_id`. `order_id`, `product_id`, `quantity integer NULLABLE`, `unit_price numeric`, `surcharge_total numeric NOT NULL DEFAULT 0`, plus cutlist-snapshot fields. `org_id uuid NOT NULL`. No `status`, no `ready_qty`, no `delivered_qty`, no `received_qty`. RLS on, 4 policies. |
| `job_cards` | PK `job_card_id`. `order_id` (nullable), `staff_id`, `status text NOT NULL DEFAULT 'pending'`, `completion_date`, `due_date`, `completion_type`, `piecework_activity_id`. **No `section_id`.** RLS on, 4 policies. |
| `job_card_items` | PK `item_id`. `job_card_id`, `product_id`, `job_id`, `work_pool_id`, `quantity integer NOT NULL DEFAULT 1`, `completed_quantity integer NOT NULL DEFAULT 0`, `status text NOT NULL DEFAULT 'pending'`, `piece_rate`, remainder fields. Note: **`work_pool_id` is the link back to `order_detail_id` via `job_work_pool.order_detail_id`.** ~38% of current rows have NULL `work_pool_id` (historicals / manual cards). RLS on, 4 policies. |
| `jobs` | Catalog of work types: `job_id, name, description, category_id, role_id, estimated_minutes, time_unit`. **No `order_detail_id` or `order_item_id`.** Global, no `org_id`. **RLS OFF — advisor ERROR.** |
| `job_work_pool` | PK `pool_id`. `org_id NOT NULL`, `order_id NOT NULL`, `order_detail_id NULLABLE`, `product_id NULLABLE`, `job_id`, `bol_id`, `source text NOT NULL` ('bol' \| 'manual'), `required_qty NOT NULL`, `status NOT NULL`. View `job_work_pool_status` adds `issued_qty`, `completed_qty`, `remaining_qty`. **This is the right linkage table for ready-event rollup.** |
| `manufacturing_sections` | Global lookup (`section_id, section_name, section_code, section_icon, description`). **No `org_id`. RLS OFF — advisor ERROR.** |
| `order_manufacturing_sections` | Per-order section progression rows (`order_section_id, order_id, section_id, status_id default 1, started_at, completed_at, assigned_to`). **Nothing populates `completed_at`. RLS OFF — advisor ERROR.** Must be wired up + RLS-enabled in Phase 1. |
| `complete_job_card_v2()` RPC | `(p_job_card_id, p_items jsonb, p_completed_by_user_id uuid, p_completion_date date) RETURNS jsonb`. Already enforces `is_org_member(order.org_id)` + payroll-lock guard + duplicate-completion guard + remainder-action validation. **Does not touch `order_manufacturing_sections` or anything ready-event related.** |
| `is_org_member(p_org_id uuid)` | SQL, STABLE, SECURITY DEFINER, `SET search_path TO 'public'`. Joins through `organization_members`. Already used by `complete_job_card_v2`. Confirmed for our use. |
| `products` | PK `product_id`. `org_id uuid NOT NULL`. `is_stocked boolean NOT NULL DEFAULT false`. `make_strategy text NOT NULL DEFAULT 'phantom'` (**850 rows all = 'phantom'; zero TS consumers**). No `default_section_route`. RLS on. |
| `product_inventory` | `product_inventory_id, product_id, quantity_on_hand numeric NOT NULL DEFAULT 0, location, reorder_level, org_id`. RLS on. |
| `product_inventory_transactions` | PK `id bigint`. `product_id, quantity numeric NOT NULL` (signed delta), `type product_txn_type NOT NULL`, `occurred_at timestamptz NOT NULL DEFAULT now()`, `order_id`, `reference text`, `org_id`. Enum `product_txn_type` values: **`build, ship, return, receive, adjust, consume`**. RLS on. |
| `order_statuses` lookup | `27 New, 28 In Production, 33 In Progress, 29 On Hold, 30 Completed, 1 Ready For Delivery, 31 Cancelled`. No 'Closed' status — Phase 5 reuses `30 Completed` for auto-close. |
| `organizations` | The org table. Holds `week_start_day, ot_threshold_minutes, configurator_defaults jsonb, cutlist_defaults jsonb, payroll_standard_week_hours`. **No `org_settings` table exists.** New per-org numbering settings are added as columns on `organizations`. |
| Existing PO-side `DeliveryNote*` TS types | In `lib/db/purchase-order-attachments.ts`, `app/purchasing/quick-upload/`, `components/features/purchasing/DeliveryNoteUpload.tsx`. These are **supplier delivery notes** (attachments on receiving goods FROM suppliers). **Naming collision risk** — our customer-facing tables/types use `order_delivery_notes` / `OrderDeliveryNote` to avoid confusion. |
| Delivery notes (customer-facing) | **Do not exist.** Orders can sit at "In Production" forever. |
| Stock receipts | **Do not exist** as a first-class concept. |
| Internal orders | **Do not exist.** |
| Inventory transactions page | **No first-class `/inventory/transactions` page exists.** The existing per-product `components/features/products/ProductTransactionsTab.tsx` and the global `ProductsTransactionsTab` query the raw transactions table; Phase 6 promotes/refactors them into dedicated routes with added running balance, filters, drill-downs, chart, and CSV export. |

The interactive walkthrough at `public/internal-orders-design.html` covers the conceptual model in diagram form (uses pre-preflight names in places — the spec above supersedes).

### Preflight advisor findings (must be addressed in Phase 1)

Three ERROR-level RLS gaps on tables this work activates:

- `jobs` — RLS disabled. **NOT read-only** — preflight confirmed the labor module edits `jobs` directly (`jobs-rates-table.tsx:603` does `supabase.from('jobs').delete()`; `jobs-manager.tsx`, `job-detail.tsx`, `create-job-modal.tsx` do INSERT/UPDATE). Enable RLS with SELECT/INSERT/UPDATE/DELETE policies `TO authenticated USING (true)` — preserves existing effective access, just closes the advisor warning. Detailed policy table later in §"RLS policy details" is the authoritative source.
- `manufacturing_sections` — RLS disabled. Read-all-to-authenticated, no writes (org configures via `product_sections` override, not direct writes here; sections seeded via migration).
- `order_manufacturing_sections` — RLS disabled. Per-order rows; enable RLS with org-scoped policy via join to `orders.org_id`.

Other advisor noise unrelated to this work (24 other RLS-disabled tables, 17 SECURITY DEFINER views) is tracked separately. Not in scope here.

### View-drift watch list

Views that read from tables this work changes — must verify still compile after migrations (memory rule: `CREATE OR REPLACE VIEW` doesn't auto-pick up new columns; re-run definitions):

- `staff_piecework_earnings` — reads `job_cards`, `job_card_items`, `orders`. Phase 1 adds `job_cards.section_id` (additive; doesn't break view) and `order_details.status/ready_qty/delivered_qty/received_qty` (also additive). Re-run anyway to be safe.
- `job_work_pool_status` — reads `job_work_pool` (unchanged) and `job_card_items` (unchanged). Likely fine.
- `v_orders_with_customers`, `orders_due_today` — read `orders`. Both use LEFT JOINs against `customers`; the existing `customer_id NULLABLE` semantics are unchanged, so adding `order_type` doesn't break either. Re-run anyway.

## Architecture overview

One pipeline, two destinations.

```
   Customer order ─┐
                   ├─► BOL ─► Work Pool ─► Job Cards ─► Piecework ─► order_details.status = 'ready'
   Internal order ─┘                                                       │
                                                                           ├─► (customer)  Delivery note → order auto-closes when ∑ delivered = ordered
                                                                           └─► (internal)  Stock receipt   → product_inventory +qty, order auto-closes when ∑ received = ordered
```

Three new building blocks make this work:

1. **Section routing model** — per-product configuration of which manufacturing sections a product must traverse, plus the completion cascade that populates `order_manufacturing_sections.completed_at` when job cards close.
2. **The "ready" event** — an idempotent function `mark_order_details_ready(p_job_card_id)` invoked from the tail of `complete_job_card_v2()`. Rolls up per-item completion across all required sections, increments `order_details.ready_qty`, flips item status to `'ready'` when ready_qty hits ordered qty.
3. **Fulfilment & receipt notes** — `order_delivery_notes` (customer-facing, Unity-generated or Pastel-recorded) and `stock_receipts` (internal-only). Both partial-fulfilment-aware. Both feed the same order-auto-close logic via their respective counter columns.

Plus: a new `/inventory/transactions` page surfacing every stock movement.

## Data model

### Changes to existing tables

#### `orders`

| Column | Change |
|---|---|
| `order_type` | NEW: text NOT NULL DEFAULT `'customer'` with CHECK `order_type IN ('customer','internal')`. (Plain text + CHECK rather than a native enum — matches existing pattern of `job_cards.status text` and `job_work_pool.source text`; cheaper to extend later.) |
| `customer_id` | Already NULLABLE today. No DDL change needed. Preflight: 0 of 496 existing orders have NULL customer_id, so the new CHECK below validates immediately. Still applied via `NOT VALID` + explicit `DO $$ ... RAISE EXCEPTION IF ... $$;` assertion (round 2 MINOR #5 — clearer migration failure than a bare `VALIDATE CONSTRAINT` error) + post-migration `VALIDATE CONSTRAINT`. The assertion: `IF EXISTS (SELECT 1 FROM orders WHERE customer_id IS NULL AND COALESCE(order_type, 'customer') = 'customer') THEN RAISE EXCEPTION 'Cannot validate customer-CHECK: customer orders with NULL customer_id exist'`. |
| `internal_reason` | NEW: text NULLABLE. Free-text reason on internal orders ("Restock 50 cupboards", "Sample build for client X visit"). NULL on customer orders (enforced via combined CHECK). |
| `completed_from_status_id` | NEW: integer NULLABLE FK → `order_statuses(status_id)`. Captures the order's status immediately before auto-close so a "Reopen order" admin action knows where to put it back. NULL while order is open. |
| Combined CHECK | NEW (single CHECK covering all four cases): `(order_type = 'customer' AND customer_id IS NOT NULL AND internal_reason IS NULL) OR (order_type = 'internal' AND customer_id IS NULL AND length(trim(coalesce(internal_reason, ''))) > 0)`. |
| Immutability trigger | NEW `BEFORE UPDATE OF order_type` trigger: rejects the change if the order has any `order_details`, `job_cards`, `order_delivery_notes`, `stock_receipts`, or `product_inventory_transactions` rows linked to it. Effectively makes `order_type` immutable after creation. |

Existing customer orders auto-default to `order_type='customer'`. View `v_orders_with_customers` and `orders_due_today` use LEFT JOIN on `customer_id` so they're already null-safe and don't break when internal orders enter (their customer_id is NULL).

#### `order_details`

(The actual line-items table in this codebase. Not `order_items`.)

| Column | Change |
|---|---|
| `status` | NEW: text NOT NULL DEFAULT `'pending'` with CHECK `status IN ('pending','in_production','ready','delivered','received','cancelled')`. |
| `ready_qty` | NEW: integer NOT NULL DEFAULT 0. Cumulative qty that has flipped to ready. |
| `delivered_qty` | NEW: integer NOT NULL DEFAULT 0. Cumulative qty on **signed** delivery notes only (drives auto-close). Draft/printed allocations are tracked separately via the computed `allocated_delivery_qty` helper (see §"Allocation accounting"). |
| `received_qty` | NEW: integer NOT NULL DEFAULT 0. Cumulative qty confirmed into stock receipts. |
| CHECK constraint | NEW: `ready_qty <= COALESCE(quantity, 0) AND delivered_qty <= COALESCE(quantity, 0) AND received_qty <= COALESCE(quantity, 0)`. (`quantity` is currently NULLABLE on this table; spec preserves that — Phase 1A does not force NOT NULL.) |
| Cross-table invariant | Enforced via `BEFORE UPDATE OF delivered_qty, received_qty` trigger reading parent `orders.order_type` (CHECK can't reference a parent row): `delivered_qty > 0 → order_type = 'customer'`, `received_qty > 0 → order_type = 'internal'`. Paired with the `orders.order_type` immutability trigger above — together they prevent the "flip type after counters > 0" hole. |

Status transitions:

```
   pending → in_production → ready → (delivered | received) → terminal
                          └→ cancelled (from any non-terminal state)
```

- `pending` → `in_production`: fires when the first `job_card_items` row referencing this `order_detail_id` (resolved via `work_pool_id → job_work_pool.order_detail_id`) is created. Implemented as an `AFTER INSERT` trigger on `job_card_items`.
- `in_production` → `ready`: fires when `mark_order_details_ready` increments `ready_qty` to equal `quantity` (see §"The 'ready' event").
- `ready` → `delivered`: fires from `check_order_completion` when the order auto-closes and the order is `order_type='customer'`. Per-line, only when that line's `delivered_qty = quantity`.
- `ready` → `received`: same as above, `order_type='internal'`, when `received_qty = quantity`.
- → `cancelled`: explicit user action via the order detail page. Cancelling an item zeroes its required counters in the order-auto-close check (it doesn't have to be delivered/received to allow closure).

#### `job_cards`

| Column | Change |
|---|---|
| `section_id` | NEW: integer FK → `manufacturing_sections.section_id` NULLABLE (for historicals — see Phase 1B below). |

**Important: `section_id` enforcement is deferred to Phase 1B.** Phase 1A adds the column NULLABLE only. Phase 1B updates `issue_job_card_from_pool()` and the follow-up-card branch of `complete_job_card_v2()` to populate `section_id` from `job_work_pool.section_id` (new — see below), and only then adds the NOT-NULL-on-insert trigger. Reviewer round 1 caught that enforcing NOT NULL in Phase 1A would break both issuance paths immediately.

#### `job_work_pool`

| Column | Change |
|---|---|
| `section_id` | NEW: integer FK → `manufacturing_sections.section_id` NULLABLE. **This is the canonical source of truth for "which section does this work belong to" in the ready-event cascade.** Populated at pool generation time from the BOL line (see §"Section routing model"). NULL only for historical pool rows; new pool rows must populate. |
| `required_qty_per_finished_good` | NEW: numeric NOT NULL DEFAULT 1 CHECK (`required_qty_per_finished_good > 0`). **Round 2 BLOCKER fix.** The per-finished-good multiplier for this operation (e.g. 2 doors per cupboard → `2`). Snapshotted at pool generation from `billoflabour.quantity` (integer NOT NULL DEFAULT 1) for BOL-sourced rows; manual rows accept the multiplier via the "Create manual work-pool entry" form with default 1 + helper text. Used by `mark_order_details_ready` and the order-level section cascade to normalise operation completions back to finished-good units before the per-section MIN. |

Justification: a pool row represents "the demand for one operation against one order_detail" (e.g. "edge 40 sides for the 10 cupboards in order_detail 49" — that's 40 sides not 40 cupboards). The existing code already computes `required_qty = bol.quantity * order_detail.quantity` in `lib/queries/laborPlanning.ts` (line 559 `normalizeDetailJobs`, line 786 stale-pool detection). Without the multiplier snapshot on the pool row, the ready algorithm would treat 40 completed sides as "40 cupboards ready" instead of "20 cupboards ready" (40 / 2 sides per cupboard). Tagging the pool row with `section_id` AND `required_qty_per_finished_good` is the cleanest source. `job_cards.section_id` is then just a denormalised copy at issuance time, which keeps the existing card → pool → detail chain unchanged.

Backfill: historical pool rows get `required_qty_per_finished_good = COALESCE(required_qty::numeric / NULLIF(order_details.quantity, 0), 1)` where `order_detail_id IS NOT NULL` (round 3 MAJOR #2 null-safe). The `COALESCE(..., 1)` covers rows where the linked `order_details.quantity` is NULL or 0 — those degenerate to a 1:1 mapping which is correct for a degenerate "10 cupboards / 0 ordered" case (the line wouldn't make ready anyway because `ordered_qty=0` short-circuits in the algorithm). The Phase 1B migration also asserts `required_qty_per_finished_good > 0` for every backfilled row (cheap defensive check before the NOT NULL + CHECK constraints are added). Rows with NULL `order_detail_id` keep the default 1 (they don't participate in ready rollup).

**Manual pool rows multiplier (round 3 MAJOR #3).** The default of 1 is only safe when manual rows linked to an `order_detail_id` are expressed in finished-good units. To avoid reintroducing the round-2 blocker through the manual path, the "Create manual work-pool entry" UI/RPC MUST accept `required_qty_per_finished_good` (default 1, with helper text: *"How many of this operation make one finished product? Most cases = 1. Shelves at 4 per cupboard = 4."*). The RPC validates `> 0` and rejects on bad input.

#### `products`

| Column | Change |
|---|---|
| `default_section_route` | NEW: integer[] NULLABLE. Ordered array of `manufacturing_sections.section_id`. The canonical route for this product when no per-org override exists in `product_sections`. **Used only at order_detail creation time to populate the per-detail snapshot (see `order_detail_required_sections` below) — never read by `mark_order_details_ready` directly.** |
| `make_strategy` | **Untouched in this work.** It's `NOT NULL DEFAULT 'phantom'` with all 850 rows set to 'phantom' and zero TS consumers. Dropping it would require a coordinated migration that's out of scope here. Documented as legacy. A future ticket can replace it with a proper make-to-stock vs make-to-order field. |

### New tables

#### `product_sections`

Per-org override of the section route per product. **Read at order_detail creation time only** to populate `order_detail_required_sections`. After creation, the per-detail snapshot is authoritative — changing `product_sections` does not affect in-flight orders.

```
product_section_id      bigint PK
org_id                  uuid NOT NULL FK → organizations(id)
product_id              integer NOT NULL FK → products(product_id)
section_id              integer NOT NULL FK → manufacturing_sections(section_id)
sequence_order          integer NOT NULL
created_at              timestamptz NOT NULL DEFAULT now()
updated_at              timestamptz NOT NULL DEFAULT now()

UNIQUE (org_id, product_id, section_id)
UNIQUE (org_id, product_id, sequence_order)
INDEX  (org_id, product_id)
```

RLS: `is_org_member(org_id)`.

#### `order_detail_required_sections` (NEW from round 1 — addresses route-drift hazard)

Per-`order_detail` snapshot of the required section route, captured at order-detail creation time. `mark_order_details_ready` reads this table, **not** `product_sections` or `products.default_section_route`. Changing a product's route after an order_detail is created has no effect on that detail's readiness criteria.

```
order_detail_section_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY
org_id                   uuid NOT NULL FK → organizations(id)
order_detail_id          integer NOT NULL FK → order_details(order_detail_id) ON DELETE CASCADE
section_id               integer NOT NULL FK → manufacturing_sections(section_id)
sequence_order           integer NOT NULL
source                   text NOT NULL CHECK (source IN ('product_sections','default_route','fallback'))
created_at               timestamptz NOT NULL DEFAULT now()

UNIQUE (order_detail_id, section_id)
UNIQUE (order_detail_id, sequence_order)
INDEX (org_id, order_detail_id)
```

(Surrogate PK + business-key UNIQUE constraint — matches the rest of the spec's table conventions. Round-2 NIT fix; the earlier sketch had both a surrogate PK and a composite PK declared.)

Resolution order at order_detail creation:
1. If `product_sections` rows exist for `(org_id, product_id)` → snapshot those with `source='product_sections'`.
2. Else if `products.default_section_route` is non-empty → snapshot with `source='default_route'`.
3. Else single-section fallback (org's Assembly section by convention or admin-configurable; per §"Section routing model") with `source='fallback'`.

RLS: `is_org_member(org_id)`.

#### `order_status_events` (NEW from round 1 — supports reopen)

Append-only log of order-level status changes. Powers the "Reopen order" admin action — the most recent non-Completed event before close is the restore target. Also useful for audit and reporting.

```
order_status_event_id    bigint PK
org_id                   uuid NOT NULL FK → organizations(id)
order_id                 integer NOT NULL FK → orders(order_id) ON DELETE CASCADE
from_status_id           integer NULLABLE FK → order_statuses(status_id)
to_status_id             integer NOT NULL FK → order_statuses(status_id)
changed_by               uuid NULLABLE FK → auth.users(id)  -- nullable for system transitions
changed_at               timestamptz NOT NULL DEFAULT now()
reason                   text NULLABLE
trigger_source           text NOT NULL CHECK (trigger_source IN ('user','auto_ready','auto_completed','reopen','system'))

INDEX (org_id, order_id, changed_at DESC)
```

RLS: `is_org_member(org_id)`.

**Single-writer rule (round 2 MAJOR #3).** The `BEFORE UPDATE OF status_id ON orders` trigger is the **only** writer to `order_status_events`. RPCs (`check_order_readiness`, `check_order_completion`, `reopen_order`, the DN cancellation flow) MUST NOT INSERT directly — they set transaction-local context via `set_config(...)` immediately before the `UPDATE orders SET status_id = ...`, then clear it after (round 3 MINOR #1 hygiene — prevents stale context if the same function does another status update):

```sql
PERFORM set_config('app.order_status_trigger_source', 'auto_ready', true);
PERFORM set_config('app.order_status_reason', 'all lines ready', true);
PERFORM set_config('app.actor_id', COALESCE(p_actor_id::text, ''), true);

UPDATE public.orders
   SET status_id = 1
 WHERE order_id = p_order_id AND status_id <> 1;

-- Clear context so any subsequent UPDATE in this transaction
-- that forgets to set it defaults to 'user'/auth.uid() rather
-- than inheriting stale auto_ready context.
PERFORM set_config('app.order_status_trigger_source', '', true);
PERFORM set_config('app.order_status_reason', '', true);
PERFORM set_config('app.actor_id', '', true);
```

Trigger reads (with round 3 NIT #2 hardening — malformed UUID falls back to `auth.uid()`):

```sql
v_source := NULLIF(current_setting('app.order_status_trigger_source', true), '');
v_reason := NULLIF(current_setting('app.order_status_reason', true), '');
BEGIN
  v_actor := NULLIF(current_setting('app.actor_id', true), '')::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  v_actor := auth.uid();
END;
IF v_source IS NULL THEN v_source := 'user'; END IF;  -- manual UI/SQL changes
IF v_actor IS NULL  THEN v_actor  := auth.uid(); END IF;
```

This catches manual status changes too (they default to `trigger_source='user'` with `changed_by=auth.uid()`), and no event is ever double-written.

Existing manual status changes start producing events from migration day forward — no historical backfill.

#### `order_delivery_notes`

(Named `order_delivery_notes` — NOT `delivery_notes` — to avoid collision with the existing supplier-side `DeliveryNote*` TS types in `lib/db/purchase-order-attachments.ts` and `components/features/purchasing/*`. The TS type is `OrderDeliveryNote`.)

```
order_delivery_note_id  bigint PK
org_id                  uuid NOT NULL FK → organizations(id)
order_id                integer NOT NULL FK → orders(order_id)
note_number             text NULLABLE        -- populated when source='unity'
source                  text NOT NULL CHECK (source IN ('unity','pastel'))
external_reference      text NULLABLE        -- Pastel DN number, populated when source='pastel'
delivery_date           date NOT NULL
status                  text NOT NULL CHECK (status IN ('draft','printed','signed','cancelled'))
                                              -- pastel rows start at 'signed' (record of fact)
signed_by               text NULLABLE
signed_at               timestamptz NULLABLE
notes                   text NULLABLE
created_by              uuid NOT NULL FK → auth.users(id)
created_at              timestamptz NOT NULL DEFAULT now()
updated_at              timestamptz NOT NULL DEFAULT now()

CHECK (source='unity'  AND note_number IS NOT NULL AND external_reference IS NULL)
   OR (source='pastel' AND external_reference IS NOT NULL AND note_number IS NULL)
```

Plus separate-statement indexes (round 2 NIT — partial unique indexes can't live inside `CREATE TABLE`):

```sql
CREATE UNIQUE INDEX order_delivery_notes_org_number_uq
  ON order_delivery_notes (org_id, note_number)
  WHERE note_number IS NOT NULL;
CREATE INDEX order_delivery_notes_org_order_idx
  ON order_delivery_notes (org_id, order_id);
CREATE INDEX order_delivery_notes_org_status_date_idx
  ON order_delivery_notes (org_id, status, delivery_date DESC);
```

`note_number` is assigned by the `issue_unity_delivery_note_number(p_org_id uuid)` RPC inside the same transaction as the INSERT:

1. `SELECT … FROM organizations WHERE id = p_org_id FOR UPDATE` (row lock).
2. Compute `next_seq = max(suffix of note_number where prefix matches current org prefix) + 1`, floored to `delivery_note_starting_number`. Sequence parsing is **prefix-aware** — only notes with `note_number LIKE <current_prefix>%` participate in the max, so prefix changes don't cause jumps.
3. INSERT with that number. On `23505` (race against another writer or admin tooling that bypassed the lock), retry up to 3 times with the recomputed number.

The unique partial index `(org_id, note_number) WHERE note_number IS NOT NULL` is the belt-and-braces guarantee. The lock is the optimistic path.

RLS: `is_org_member(org_id)`.

#### `order_delivery_note_items`

```
order_delivery_note_item_id  bigint PK
org_id                       uuid NOT NULL FK → organizations(id)
order_delivery_note_id       bigint NOT NULL FK → order_delivery_notes(order_delivery_note_id) ON DELETE CASCADE
order_detail_id              integer NOT NULL FK → order_details(order_detail_id)
quantity                     integer NOT NULL CHECK (quantity > 0)
created_at                   timestamptz NOT NULL DEFAULT now()

INDEX (org_id, order_delivery_note_id)
INDEX (org_id, order_detail_id)
```

**Quantity is integer**, matching `order_details.quantity` and the `*_qty` counters. Unity ERP does not deal in fractional finished goods; if that ever changes, it requires a migration of all four columns together.

Trigger enforces: ∑ `quantity` per `order_detail_id` across rows where the parent `order_delivery_notes.status IN ('draft','printed','signed')` ≤ `order_details.quantity`. Cancelled notes don't count.

RLS: `is_org_member(org_id)`.

##### Allocation accounting (round 1 MAJOR #8)

`order_details.delivered_qty` tracks **signed** notes only (so it cleanly drives auto-close). For UI affordances we also need `allocated_delivery_qty` = ∑ quantities across `draft + printed + signed` non-cancelled notes per order_detail.

`allocated_delivery_qty` is computed (not stored) via a SQL helper or view to avoid a fifth counter column and the maintenance burden it brings. The "Create delivery note" modal calls it to default the qty input: `available_to_allocate = ready_qty - allocated_delivery_qty`. The DB trigger above uses the same ≤ rule. UI never offers a quantity the DB will reject.

#### `stock_receipts`

```
stock_receipt_id        bigint PK
org_id                  uuid NOT NULL FK → organizations(id)
order_id                integer NOT NULL FK → orders(order_id)
                                              -- must be an internal order; enforced via trigger
receipt_number          text NOT NULL        -- '<stock_receipt_prefix><NNNN>'
status                  text NOT NULL CHECK (status IN ('draft','confirmed','cancelled'))
received_at             timestamptz NULLABLE -- set when status flips to 'confirmed'
received_by             uuid NULLABLE FK → auth.users(id)
notes                   text NULLABLE
created_by              uuid NULLABLE FK → auth.users(id)
                                              -- nullable for trigger-created draft receipts (system actor)
created_at              timestamptz NOT NULL DEFAULT now()
updated_at              timestamptz NOT NULL DEFAULT now()

UNIQUE (org_id, receipt_number)
```

Plus separate-statement indexes:

```sql
-- Idempotency: at most one draft receipt per order. The auto trigger upserts against this.
CREATE UNIQUE INDEX one_draft_stock_receipt_per_order
  ON stock_receipts (org_id, order_id) WHERE status = 'draft';
CREATE INDEX stock_receipts_org_order_idx
  ON stock_receipts (org_id, order_id);
CREATE INDEX stock_receipts_org_status_date_idx
  ON stock_receipts (org_id, status, received_at DESC);
```

Auto-numbered same scheme as delivery notes (`organizations.stock_receipt_starting_number` + `organizations.stock_receipt_prefix`, prefix-aware sequence parsing, row-lock + 23505 retry). Auto path creates `status='draft'` rows that aggregate ready items until confirmed. The partial-unique index makes the auto-trigger naturally idempotent (one draft per order; subsequent ready-events upsert into it).

`created_by` is nullable specifically so the trigger path (which runs inside `complete_job_card_v2` with `auth.uid()` available but might also run from scheduled / system contexts) can write NULL when no user context exists. Manual receipts always have a `created_by`.

RLS: `is_org_member(org_id)`.

#### `stock_receipt_items`

```
stock_receipt_item_id   bigint PK
org_id                  uuid NOT NULL FK → organizations(id)
stock_receipt_id        bigint NOT NULL FK → stock_receipts(stock_receipt_id) ON DELETE CASCADE
order_detail_id         integer NOT NULL FK → order_details(order_detail_id)
product_id              integer NOT NULL FK → products(product_id)
quantity                integer NOT NULL CHECK (quantity > 0)
created_at              timestamptz NOT NULL DEFAULT now()

UNIQUE (stock_receipt_id, order_detail_id)  -- one row per detail per receipt; trigger upserts
INDEX (org_id, stock_receipt_id)
INDEX (org_id, order_detail_id)
INDEX (org_id, product_id)
```

**Quantity is integer** (matches `order_details.quantity` and counters; same reasoning as `order_delivery_note_items.quantity`).

When the parent `stock_receipts.status` flips to `'confirmed'`, `confirm_stock_receipt(p_stock_receipt_id, p_actor uuid)` writes one `product_inventory_transactions` row per stock_receipt_item with:

- `type = 'build'` (uses the existing `product_txn_type` enum value — manufactured into stock; distinguishable from supplier `receive`)
- `reference = 'stock_receipts:' || p_stock_receipt_id` (column is `reference`, not `source_reference`)
- `order_id` = the internal order's id
- `quantity` = signed positive (per existing convention)

Same function bumps `product_inventory.quantity_on_hand` and `order_details.received_qty`.

RLS: `is_org_member(org_id)`.

#### `stock_adjustments`

```
stock_adjustment_id     bigint PK
org_id                  uuid NOT NULL FK → organizations(id)
product_id              integer NOT NULL FK → products(product_id)
quantity_delta          numeric(12,3) NOT NULL CHECK (quantity_delta <> 0)
reason                  text NOT NULL CHECK (length(trim(reason)) > 0)
reverses_adjustment_id  bigint NULLABLE FK → stock_adjustments(stock_adjustment_id)
adjusted_by             uuid NOT NULL FK → auth.users(id)
adjusted_at             timestamptz NOT NULL DEFAULT now()
created_at              timestamptz NOT NULL DEFAULT now()

INDEX (org_id, product_id, adjusted_at DESC)
INDEX (org_id, adjusted_at DESC)
```

Reason is mandatory and non-empty. Reversals point at the original via `reverses_adjustment_id` — the original row stays. A trigger writes one `product_inventory_transactions` row per adjustment.

RLS: `is_org_member(org_id)`.

### Cross-org consistency triggers (round 1 BLOCKER #6 + round 2 MAJOR #1 — locking added)

`is_org_member(org_id)` RLS protects each row in isolation, but doesn't prevent a malicious or buggy client from inserting a child row that belongs to their org while pointing at a parent from another org. Phase 1A adds `BEFORE INSERT OR UPDATE` triggers that verify parent/child org consistency for every new table.

**Locking rule** (round 2 MAJOR #1): when the trigger reads a non-key business column from the parent (e.g. `orders.org_id`, `orders.order_type`, `order_delivery_notes.status`), it MUST take `FOR SHARE` on the parent row to prevent a TOCTOU race with a concurrent update. `FOR KEY SHARE` blocks deletes and PK changes but not ordinary updates, so it's insufficient when business columns drive the check. Lock order is fixed: **orders → notes/receipts → details** to prevent cross-trigger deadlocks. `products.org_id` is read with `FOR SHARE` as well (products is rarely written, but the pattern stays consistent).

Trigger bodies use this shape:

```sql
SELECT org_id, order_type
INTO v_parent_org, v_parent_type
FROM public.orders
WHERE order_id = NEW.order_id
FOR SHARE;

IF v_parent_org IS NULL THEN
  RAISE EXCEPTION 'Parent order % does not exist', NEW.order_id;
END IF;
IF v_parent_org <> NEW.org_id THEN
  RAISE EXCEPTION 'org_id mismatch between % and its parent order %', TG_TABLE_NAME, NEW.order_id;
END IF;
IF v_parent_type <> '<expected>' THEN
  RAISE EXCEPTION 'Parent order % is not of type %', NEW.order_id, '<expected>';
END IF;
```

Per-table check matrix:

- `order_delivery_notes`: parent `orders` org match + `order_type = 'customer'`.
- `order_delivery_note_items`: parent `order_delivery_notes` org match (FOR SHARE on note) + the linked `order_details.order_id` equals the note's order_id (FOR KEY SHARE on detail — only existence + the FK column matter here).
- `stock_receipts`: parent `orders` org match + `order_type = 'internal'`.
- `stock_receipt_items`: parent `stock_receipts` org match (FOR SHARE on receipt) + the detail's `order_id` equals the receipt's order_id + `NEW.product_id = order_details.product_id`.
- `stock_adjustments`: `NEW.org_id = products.org_id` (FOR SHARE on products row).
- `product_sections`: `NEW.org_id = products.org_id` (FOR SHARE).
- `order_detail_required_sections`: `NEW.org_id = order_details.org_id` (FOR SHARE).
- `order_status_events`: `NEW.org_id = orders.org_id` (FOR SHARE).

These are part of Phase 1A's safety boundary — RLS policies + cross-org consistency triggers ship together. Verified by a cross-org RLS smoke that explicitly tries to insert child rows referencing other-org parents.

### RLS policy details

| Table | RLS posture |
|---|---|
| `product_sections`, `order_detail_required_sections`, `order_delivery_notes`, `order_delivery_note_items`, `stock_receipts`, `stock_receipt_items`, `stock_adjustments`, `order_status_events` | `is_org_member(org_id)` for SELECT/INSERT/UPDATE/DELETE. Standard new-table pattern. |
| `order_manufacturing_sections` (RLS currently OFF) | Enable RLS. Policy joins through to `orders.org_id`: `USING (EXISTS (SELECT 1 FROM orders o WHERE o.order_id = order_manufacturing_sections.order_id AND public.is_org_member(o.org_id)))`. WITH CHECK same. |
| `manufacturing_sections` (RLS currently OFF) | Enable RLS. Read-all-to-authenticated: `FOR SELECT TO authenticated USING (true)`. No write policies in v1 (sections seeded via migration; new sections need an admin migration or a future ticket for in-app admin tooling). |
| `jobs` (RLS currently OFF) | Enable RLS. **NOT read-only.** Confirmed preflight: `components/features/labor/jobs-rates-table.tsx:603` does `supabase.from('jobs').delete()` directly, and the labor module (`jobs-manager.tsx`, `job-detail.tsx`, `create-job-modal.tsx`) edits jobs in-place. Policies: SELECT `TO authenticated USING (true)` (global catalog; no `org_id`). INSERT/UPDATE/DELETE `TO authenticated USING (true)` for v1 — matches today's effective access. A future ticket can scope writes to a `labor_admin` permission once a permissions layer exists. **Critically: this PR does not change the effective write access; it just makes the policy explicit so the advisor warning closes.** |

### Settings (per-org)

No `org_settings` table exists. Per-org settings live on `organizations` directly (matches existing pattern of `week_start_day`, `ot_threshold_minutes`, `configurator_defaults jsonb`, `cutlist_defaults jsonb`). Add as plain columns for typed access:

| Column on `organizations` | Type | Default | Purpose |
|---|---|---|---|
| `delivery_note_starting_number` | integer NOT NULL | 1 | Floor for next `DN-NNNN` issuance. Editable in settings UI. |
| `delivery_note_prefix` | text NOT NULL | `'DN-'` | Prefix override. |
| `stock_receipt_starting_number` | integer NOT NULL | 1 | Floor for next `SR-NNNN`. |
| `stock_receipt_prefix` | text NOT NULL | `'SR-'` | Prefix override. |
| `delivery_note_pdf_letterhead_url` | text NULLABLE | NULL | Org letterhead image URL for the PDF (optional). |

### View: `product_inventory_transactions_with_balance`

Uses the actual column names of `product_inventory_transactions` confirmed by preflight: `id bigint`, `quantity numeric` (signed), `occurred_at timestamptz`, `type product_txn_type`, `order_id`, `reference`, `org_id`.

**Critical:** the view MUST be created `WITH (security_invoker = true)` so org-scoped RLS on the underlying table propagates to the caller. Without it, Postgres treats views as SECURITY DEFINER by default and cross-org leakage becomes possible. This matches the existing project convention (6+ migrations already use this pattern: `staff_piecework_earnings`, `inventory_transactions_enriched`, etc.).

```sql
CREATE VIEW public.product_inventory_transactions_with_balance
WITH (security_invoker = true)
AS
SELECT
  t.id,
  t.org_id,
  t.product_id,
  t.quantity,
  t.type,
  t.occurred_at,
  t.order_id,
  t.reference,
  SUM(t.quantity) OVER (
    PARTITION BY t.org_id, t.product_id
    ORDER BY t.occurred_at, t.id
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS running_balance
FROM public.product_inventory_transactions t;

-- Explicit grants (no broad public access)
REVOKE ALL ON public.product_inventory_transactions_with_balance FROM PUBLIC;
GRANT SELECT ON public.product_inventory_transactions_with_balance TO authenticated;
```

Verification: cross-org smoke runs against the view itself, not just the base table.

Ordering by `(occurred_at, id)` gives a deterministic tiebreaker.

#### Mapping movements to the existing `product_txn_type` enum

| Movement | Enum value | Writes a transaction? | Notes |
|---|---|---|---|
| Internal-order stock receipt confirmed (auto path) | `build` | YES | Manufactured into stock. `reference = 'stock_receipts:<id>'`, `order_id` = the internal order's id. |
| Internal-order manual receipt confirmed | `build` | YES | Same type as auto; distinguish in UI by the receipt row having `notes` populated and a "Manual receipt" chip. |
| **Customer-order delivery note signed — order built to order (no FG reservation)** | — | **NO** | The product was assembled directly for the customer and never sat in `product_inventory`. Writing a `ship` here would create a negative QOH for stock that was never +1'd. **The DN signing flow does NOT call into `product_inventory_transactions` for this case.** |
| **Customer-order delivery note signed — order fulfilled from FG reservation** | `ship` | YES (via existing flow) | The existing `/api/orders/[orderId]/consume-fg` endpoint already writes the `ship` (or `consume` — verify during plan-write) transaction when stock is consumed against the reservation. The DN signing event does NOT double-write. Plan-write step verifies which enum value the existing consume-fg path uses and confirms DN signing stays out of inventory mutation. |
| Stock adjustment | `adjust` | YES | `reference = 'stock_adjustments:<id>'`. |
| Stock adjustment reversal | `adjust` | YES (separate row) | The reversed status is encoded on `stock_adjustments.reverses_adjustment_id`. |
| Customer return (out of scope v1) | `return` | YES (via manual adjustment) | Manual adjust with reason "customer return" for now. |
| Raw consumption (existing) | `consume` | YES (existing) | Already used; not touched by this work. |
| Supplier receipt (existing) | `receive` | YES (existing) | Already used by purchase flow; not touched by this work. |

## Section routing model

Per-product configuration of which manufacturing sections a product traverses, in order. Round 1 BLOCKER #4 made this **snapshot-based**: the source of truth at completion time is `order_detail_required_sections` (the per-detail snapshot), not the live product config.

### Source of truth — at order_detail creation time only

1. `product_sections` (per-org override) is checked first. If rows exist for `(org_id, product_id)`, snapshot those into `order_detail_required_sections` with `source='product_sections'`.
2. Otherwise fall back to `products.default_section_route`. Snapshot with `source='default_route'`.
3. If both are NULL/empty, snapshot a single `org_default_assembly_section_id` row (a new admin-configurable column on `organizations`, defaulting to the section with `section_code='ASM'` or similar — verify-and-pick during plan-write) with `source='fallback'`. The UI also surfaces a warning on the order-detail row when the source is `fallback` so operators can see they're using an inferred route.

After creation, the snapshot is authoritative. Changing `product_sections` or `products.default_section_route` does NOT affect already-created details.

### Section source on job_work_pool (Phase 1B addition)

`job_work_pool.section_id` is populated at pool generation time. Source: the BOL line that drove the pool entry — Phase 1B adds `section_id` to either `billoflabour` directly (preferred, snapshot-style) or derives it via `jobs.section_id` (acceptable only if jobs map 1:1 to sections, which preflight could not confirm — plan-write decides). Manual pool entries get `section_id` from the user-facing "Create manual work-pool entry" form.

`job_cards.section_id` is then a denormalised copy of the pool row's `section_id` at issuance time. `issue_job_card_from_pool` is extended to do this copy. Follow-up cards created by `complete_job_card_v2`'s remainder branch also copy from the source pool row.

### Pool-row grain invariant (round 2 MAJOR #6)

The ready algorithm treats each `job_work_pool` row as a distinct required operation and takes `MIN` across them within a section. **This is correct only if "one pool row = one distinct operation requirement against this order_detail."** Two scenarios break that assumption:

- **Future split-batch workflow** ("split this operation's pool row into two smaller pools for parallel scheduling") would produce two rows with the same `(order_detail_id, section_id, job_id)` and `required_qty` totalling the original. Treating them as separate operations would `MIN(half, half) = half` and undercount.
- **Manual duplicates** entered by an operator who didn't realise an active pool row already existed.

Phase 1B adds the following invariants to make the grain explicit and enforce it:

- **For BOL-sourced rows (`source='bol'`):** the existing partial-unique index `(order_detail_id, bol_id, source='bol')` already enforces one-pool-row per `(detail, BOL line)`. Documented as load-bearing for the ready algorithm.
- **For manual rows (`source='manual'`):** add a partial-unique index `(org_id, order_id, order_detail_id, section_id, job_id) WHERE source='manual' AND status='active'` (round 3 MINOR #2 — predicate uses positive enumeration of the current state machine rather than `<> 'cancelled'`, so a future `'draft'`/`'paused'`/`'archived'` status doesn't silently collide with active rows). Duplicate manual entry against the same operation is rejected at INSERT time with a clear error ("an active pool row already exists for this operation; cancel or edit the existing row instead").
- **For any future split-batch workflow:** must NOT create duplicate pool rows for the same operation. If batch-splitting is needed, the row's `required_qty` shrinks and a new sibling row carries a different `job_id` or an explicit `batch_id` (out of scope for this work; future ticket if requested). The current spec assumes no split-batch path exists yet.

Tests in Phase 2 explicitly cover both unique-index enforcements.

### Instantiation on order creation

When an order is created (customer or internal), for every distinct `section_id` referenced across the snapshotted routes of all the order's `order_details`, one `order_manufacturing_sections` row is created linked to the order. This is for **order-level** section visibility (UI badges, dashboards) — the ready-event trigger does NOT depend on it. The per-detail snapshot in `order_detail_required_sections` is the truth for readiness.

### Section completion cascade (order-level — not the ready trigger)

`complete_job_card_v2()` is extended to also populate `order_manufacturing_sections.completed_at` when the section in question is fully done for the order. **This uses the same eligibility filters as the ready-event rollup** (excludes `job_work_pool.status='cancelled'`, `job_cards.status='cancelled'`, `job_card_items.status='cancelled'`, NULL `work_pool_id`) so the two stay consistent. The cascade fires from the same RPC tail as `mark_order_details_ready`:

1. (Existing behaviour) Marks card + items completed, handles remainder disposition.
2. (NEW) If the card has `section_id` populated, recompute that section's completion state across the order using the **same finished-good-normalised per-operation rules as the ready-event rollup** (round 3 MAJOR #1 — the earlier prose used raw operation units and would mark a section complete too early under multipliers > 1). Per pool row (= operation) in `(order_id, section_id)`:
   ```
   clamped_op_units = LEAST(SUM(jci.completed_quantity), pool.required_qty)
   op_complete_finished_goods = FLOOR(clamped_op_units / pool.required_qty_per_finished_good)
   ```
   Then `section_complete_finished_goods = MIN(op_complete_finished_goods)` across operations. If that MIN ≥ the section's required finished-good units for the order (summed across the order's details that route through this section), write `now()` into `order_manufacturing_sections.completed_at` for that `(order_id, section_id)` pair (idempotent — only fills NULL).
3. (NEW) Invoke `mark_order_details_ready(p_job_card_id)`.

The cascade is wrapped in the same transaction as the card-completion update. If `mark_order_details_ready` fails, the card completion rolls back — better to fail loudly than half-update.

## The "ready" event

`mark_order_details_ready(p_job_card_id)` is an idempotent `SECURITY DEFINER` Postgres function with:

```sql
SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION mark_order_details_ready(integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION mark_order_details_ready(integer) TO authenticated;
```

Function checks `is_org_member` on the touched order's org before mutating. Returns a `SETOF order_detail_id` of the items that newly became ready (for the caller to use in notifications / UI invalidation).

### The correct algorithm (round 1 BLOCKER #3 + round 2 BLOCKER — both fixes integrated)

Two BLOCKER iterations have shaped this section:

- **Round 1** caught that a naive `SUM(completed_quantity)` across a section overcounts when multiple operations exist in the same section. Fix: per-operation, then `MIN` across operations within a section, then `MIN` across sections.
- **Round 2** caught that the per-operation completion is in **operation units** (e.g. doors, sides, shelves) but the per-section `MIN` and the comparison against `order_details.quantity` are in **finished-good units** (cupboards). The existing labor pipeline computes `required_qty = bol.quantity * order_detail.quantity` for BOL-sourced pool rows. Without dividing back by `bol.quantity` (now snapshotted on the pool row as `required_qty_per_finished_good`), the algorithm would mark 10 cupboards ready when only 5 had both their doors done.

Reads from the per-order-detail snapshot table `order_detail_required_sections` (not from live `product_sections` or `products.default_section_route`). Eligibility filters exclude `job_work_pool.status='cancelled'`, `job_cards.status='cancelled'`, `job_card_items.status='cancelled'`, and `job_card_items.work_pool_id IS NULL`.

Pseudocode:

```
for each order_detail_id touched by the card:
  fetch ordered_qty = order_details.quantity (treat NULL as 0; return early if 0)
  fetch required_sections = SELECT section_id FROM order_detail_required_sections
                            WHERE order_detail_id = this_detail_id
                            ORDER BY sequence_order

  if required_sections is empty:
    -- single-section fallback was deliberately not snapshotted
    -- treat this detail as already done by the single section
    -- (this branch shouldn't happen in practice — every detail gets a snapshot row at creation)
    continue

  section_completions_in_finished_good_units = []
  for each required_section in required_sections:
    -- find the set of distinct pool rows (= operations) for this (detail, section)
    operations = SELECT pool_id, required_qty, required_qty_per_finished_good
                 FROM job_work_pool
                 WHERE order_detail_id = this_detail_id
                   AND section_id = required_section
                   AND status <> 'cancelled'

    if operations is empty:
      -- no operations exist yet for this section → not yet started
      section_completions_in_finished_good_units.append(0)
      continue

    operation_completions_in_finished_good_units = []
    for each op in operations:
      -- sum completed_quantity across active job_card_items for this pool row
      -- (units here are OPERATION units — e.g. doors, sides, shelves)
      completed_for_op = SELECT COALESCE(SUM(jci.completed_quantity), 0)
                        FROM job_card_items jci
                        JOIN job_cards jc ON jc.job_card_id = jci.job_card_id
                        WHERE jci.work_pool_id = op.pool_id
                          AND jc.status <> 'cancelled'
                          AND jci.status <> 'cancelled'

      -- clamp the op completion to its required_qty so an over-complete on one op
      -- doesn't paper over an under-complete on another in the same section
      clamped_op_units = LEAST(completed_for_op, op.required_qty)

      -- diagnostic: surface over-completion as a non-blocking signal (round 2 MINOR)
      -- (writes to a domain-event log / production-exception surface; v1 logs server-side
      --  and emits a UI chip on the pool row; future ticket can route into job_work_pool_exceptions)
      if completed_for_op > op.required_qty:
        record_overcompletion_diagnostic(op.pool_id,
                                         completed = completed_for_op,
                                         required = op.required_qty)

      -- NORMALISE to finished-good units (round 2 BLOCKER fix)
      -- floor() because we can't ship a partial cupboard
      op_units_in_finished_goods = FLOOR(clamped_op_units / op.required_qty_per_finished_good)
      operation_completions_in_finished_good_units.append(op_units_in_finished_goods)

    -- this section is "done for N finished goods" when EVERY operation in it
    -- has completed at least N finished-goods-worth of work
    section_completions_in_finished_good_units.append(
      MIN(operation_completions_in_finished_good_units)
    )

  -- the detail is "ready for N finished goods" when EVERY required section is done for ≥ N
  new_ready_qty = LEAST(ordered_qty, MIN(section_completions_in_finished_good_units))

  if new_ready_qty > order_details.ready_qty:
    UPDATE order_details
       SET ready_qty = new_ready_qty,
           status = CASE WHEN new_ready_qty >= ordered_qty AND status <> 'cancelled'
                         THEN 'ready'
                         ELSE status
                    END
     WHERE order_detail_id = this_detail_id
       AND status <> 'cancelled';

    if new state crosses into 'ready':
      yield order_detail_id
```

Multiple lines of the same product on the same order are tracked independently because pool rows are per `order_detail_id`, and the rollup is keyed to `order_detail_id`.

### Worked examples (round 3 MINOR #4)

The corrected algorithm is subtle enough that implementers should have canonical examples next to the pseudocode. Three cases:

**A. Doors multiplier.** `order_detail_id=49`, `ordered_qty=10` cupboards, BOL has 2 doors per cupboard, pool `required_qty=20`. 15 doors complete. `clamped = LEAST(15, 20) = 15` → `op_units_in_finished_goods = FLOOR(15 / 2) = 7`. If other sections are at 10+, `MIN(7, 10) = 7` → `ready_qty = 7`.

**B. Over + under split, single multiplier.** Section has two ops, both `required_qty=40, multiplier=1`. Op A 45 complete, op B 30 complete. `A = FLOOR(LEAST(45, 40) / 1) = 40`, `B = FLOOR(LEAST(30, 40) / 1) = 30`. Section min = 30 → contributes 30 to the cross-section MIN. Over-complete on A surfaces a diagnostic but doesn't paper over B.

Same case with `multiplier=2` and `ordered_qty=20`: `A = FLOOR(40 / 2) = 20`, `B = FLOOR(30 / 2) = 15`. Section min = 15 → `ready_qty = LEAST(20, 15) = 15`.

**C. Three ops with mixed multipliers.** `ordered_qty=10`, section has Shelves (multiplier=4, 37 complete), Frame (multiplier=1, 10 complete), Inspect (multiplier=1, 10 complete). `Shelves = FLOOR(LEAST(37, 40) / 4) = 9`. `Frame = FLOOR(10 / 1) = 10`. `Inspect = FLOOR(10 / 1) = 10`. Section min = 9. If other sections are at 10+, `ready_qty = 9` — held back by the slowest op (Shelves), correctly identified despite over-completion vs section-required units on Frame/Inspect.

### Edge cases explicitly handled

- **Pool rows with NULL `order_detail_id`** (allowed by the schema; `source='manual'` rows often have this) — excluded by the JOIN, so they don't participate in the rollup. Acceptable.
- **Cancelled rows at any layer** — filtered.
- **`work_pool_id IS NULL` job_card_items** — preflight showed ~38% of current `job_card_items` are in this state. Two cases:
  1. Historicals from before Work Pool launched — these stay `pending`/`in_production` indefinitely unless someone uses the manual receive path. Acceptable; the manual receive path is the safety net.
  2. Manual job cards intentionally created outside Work Pool — same answer. UI surfaces a "this card doesn't roll up to ready — use Manual receive when the work is done" hint on the card detail.
- **Empty `order_detail_required_sections`** — shouldn't happen (snapshot is created at order_detail creation), but defensively: the function skips the detail and emits a server-side warning log. A NULL or empty snapshot is a data integrity bug, not a normal-operation case.
- **Snapshot was made with `source='fallback'`** — the single-section fallback row exists; algorithm behaves normally (one section, all operations must complete). UI hint warns about inferred routing.

Idempotency: the function only ever monotonically increases `ready_qty`. Re-running it for the same card is a no-op.

### The `order_details.ready_qty` AFTER UPDATE trigger for auto-draft receipts (round 1 MAJOR #6)

After `mark_order_details_ready` returns, an `AFTER UPDATE OF ready_qty FOR EACH ROW` trigger on `order_details` maintains draft stock receipts for internal orders. Not deferrable (regular triggers can't be; only constraint triggers can). Made naturally idempotent via partial-unique indexes:

- `UNIQUE INDEX (org_id, order_id) WHERE status = 'draft'` on `stock_receipts` (one draft per order).
- `UNIQUE (stock_receipt_id, order_detail_id)` on `stock_receipt_items` (one item row per detail per receipt).

Trigger body (pseudocode) — round 2 MAJOR #2 fix: SELECT-first to avoid burning numbers on the common existing-draft path:

```
if (SELECT order_type FROM orders WHERE order_id = NEW.order_id FOR SHARE) <> 'internal' THEN
  RETURN NEW  -- only internal orders auto-draft
END IF

delta = NEW.ready_qty - OLD.ready_qty
IF delta <= 0 THEN RETURN NEW  -- monotonic; ignore non-positive

-- Try to find an existing draft first (the common case) — no number allocation
SELECT stock_receipt_id INTO v_receipt_id
FROM stock_receipts
WHERE org_id = NEW.org_id AND order_id = NEW.order_id AND status = 'draft'
FOR UPDATE;

IF v_receipt_id IS NULL THEN
  -- Only now allocate a number; INSERT with ON CONFLICT to be race-safe
  -- against a concurrent trigger that just inserted one between our SELECT and INSERT.
  INSERT INTO stock_receipts (org_id, order_id, receipt_number, status, created_by)
  VALUES (NEW.org_id, NEW.order_id, issue_stock_receipt_number(NEW.org_id), 'draft', auth.uid())
  ON CONFLICT (org_id, order_id) WHERE status = 'draft'
  DO NOTHING
  RETURNING stock_receipt_id INTO v_receipt_id;

  IF v_receipt_id IS NULL THEN
    -- Lost the race; another trigger inserted just before us.
    -- Under the current max-scan allocator (no mutation of a stored counter, no
    -- reservation row), no receipt row with this number was inserted — so the
    -- next allocator call can reuse it. The number is NOT permanently burned.
    -- If a future allocator design mutates a stored sequence/counter, wrap the
    -- allocation in a SAVEPOINT and ROLLBACK on conflict, or move allocation
    -- inside the won-the-insert branch.
    SELECT stock_receipt_id INTO v_receipt_id
    FROM stock_receipts
    WHERE org_id = NEW.org_id AND order_id = NEW.order_id AND status = 'draft'
    FOR UPDATE;
  END IF;
END IF;

-- Upsert the item row, increment qty by delta
INSERT INTO stock_receipt_items (org_id, stock_receipt_id, order_detail_id, product_id, quantity)
VALUES (NEW.org_id, v_receipt_id, NEW.order_detail_id, NEW.product_id, delta)
ON CONFLICT (stock_receipt_id, order_detail_id)
DO UPDATE SET quantity = stock_receipt_items.quantity + EXCLUDED.quantity;

RETURN NEW;
```

Two concurrent `complete_job_card_v2` calls that both ready quantity on the same order each take their own row lock on `order_details` and the partial-unique index serialises the receipt creation — no duplicate drafts possible.

**Race-with-confirmation safety**: if a user is confirming the draft while a new ready-event arrives, the confirmation path uses `SELECT … FOR UPDATE` on the draft receipt row before reading its items, then flips status to `'confirmed'`. The AFTER UPDATE trigger's `ON CONFLICT (org_id, order_id) WHERE status = 'draft'` will then miss (because status changed) and create a fresh draft. Newly-ready quantities land in the new draft, not the now-confirmed one. Correct.

**This trigger is the only place that creates draft receipts on the auto path.** Manual receipts (§"Stock check-in flows") go through a separate RPC.

## Stock check-in flows

Three paths to land items in `product_inventory`. All three go through `stock_receipts` so the audit trail is uniform.

### Path A — auto on rollup (happy path)

1. Job card finishes → `complete_job_card_v2()` → `mark_order_details_ready()` flips items to ready → `AFTER UPDATE` trigger appends to (or creates) a draft `stock_receipts` row for the order via the partial-unique upsert pattern documented in §"The 'ready' event".
2. On the internal order detail page, a banner appears: "Ready to receive: N items across X products. **Confirm receipt →**".
3. User clicks → modal shows the draft receipt items with editable qty (default = full), an optional notes field, and a **Confirm** button.
4. On confirm: RPC `confirm_stock_receipt(p_stock_receipt_id, p_actor_id, p_item_quantities jsonb)` takes a `SELECT … FOR UPDATE` on the draft receipt, applies any qty edits, then:
   - For each `stock_receipt_items` row writes a `product_inventory_transactions` row with `type='build'` (the existing enum value — manufactured into stock), `reference='stock_receipts:<id>'`, `order_id=<internal_order_id>`, `quantity` = the (positive) item qty.
   - Bumps `product_inventory.quantity_on_hand` by the same amount.
   - Increments `order_details.received_qty` by the same amount.
   - Flips the receipt's `status='confirmed'`, sets `received_at=now()`, `received_by=p_actor_id`.

#### Partial confirmation (round 1 MAJOR #7)

If the operator reduces a draft line's quantity at confirmation time (e.g. draft had 6, user confirms 4), the remaining 2 units are NOT silently stranded. The RPC handles this by:

1. Confirming the receipt with the reduced quantities.
2. Computing the "residual" per detail = original draft qty − confirmed qty.
3. For any positive residuals: write the residual back into the auto-draft pool — i.e. a NEW draft `stock_receipts` row is created (or upserted into) immediately, with one `stock_receipt_items` row per residual detail. This re-arms the "Ready to receive" banner with the unconfirmed remainder.

This preserves the invariant: `order_details.ready_qty - order_details.received_qty = ∑ (draft + un-confirmed) receipt-items` for that order_detail.

Alternative considered: disallow reducing the draft qty at confirmation (force user to cancel the whole receipt and create a new one for the smaller qty). Rejected because operators routinely confirm partial batches as units physically arrive at the stock area, and the friction would push them to abandon the audit trail.

### Path B — manual receive (safety net)

For when job cards go wrong, or stock arrives outside the card flow (rework, found-extras).

1. On any internal order, a "Receive manually" button is always available alongside the auto banner.
2. Modal: select items (from the order's lines that still have `quantity > received_qty`), enter quantities, **mandatory notes field** ("Reworked outside the card flow", "Physical count showed 2 extra").
3. On submit: RPC `create_manual_stock_receipt(p_order_id, p_items[], p_notes, p_actor_id)`. Creates a `stock_receipts` row in `'confirmed'` status directly (skips draft), writes children, writes inventory transactions, bumps QOH, increments `received_qty`. Tagged in transactions history with a distinctive chip (`Manual receipt` vs auto `Receipt`).

#### Line-status rule for non-ready lines (round 2 MINOR #3)

Manual receive can land stock for an `order_details` line whose current status is `pending` or `in_production` — exactly the safety-net case (historical / pool-less / manual job cards that never roll up to ready).

Explicit rule: **for internal orders, when `received_qty >= quantity` and `status NOT IN ('cancelled', 'received')`, set `order_details.status = 'received'` regardless of prior non-terminal status.** This is applied by `create_manual_stock_receipt` and `confirm_stock_receipt` at the same point they update `received_qty`. Without this rule, manually-received lines would stay visually stuck at `pending`/`in_production` even though they're financially and physically complete.

The `ready` status remains the auto-rollup signal; this rule lets manual receive bypass that signal without leaving lines in an awkward intermediate state.

### Path C — stock adjustment (raw lever)

Not tied to any order. Used for: physical count corrections, damage write-offs, found-in-warehouse, customer returns.

1. On the product page (`/inventory/products/[productId]`), "Adjust stock" button.
2. Modal: signed `quantity_delta`, **mandatory reason** (CHECK at DB level).
3. On submit: RPC `apply_stock_adjustment(p_product_id, p_delta, p_reason, p_actor_id)`. Writes `stock_adjustments` + `product_inventory_transactions` + bumps QOH.
4. Reversal: from the transactions history, an admin can "Reverse this adjustment" → creates a new `stock_adjustments` row with `quantity_delta = -original` and `reverses_adjustment_id = original_id`. Original stays visible.

### Partial receipts

An internal order for 10 cupboards where only 6 are ready creates a draft receipt for 6. Once confirmed, the order shows "4 still in production" and `received_qty=6`. When the next batch becomes ready, the trigger creates a NEW draft receipt (the previous one was confirmed and is now terminal). The order auto-closes when `received_qty = quantity` for every line.

## Delivery notes

Two creation paths, same downstream effect on `delivered_qty` and order auto-close.

### Path 1 — Unity-generated

1. On a customer order detail page with at least one item having `ready_qty > allocated_delivery_qty` (the allocation-aware delta — see §"Allocation accounting" above), "Create delivery note" button.
2. Modal: pick items, pick quantities (default = `ready_qty - allocated_delivery_qty` per item — never offers a quantity the DB trigger will reject), optional notes, delivery date (defaults to today). "Generate" button.
3. On submit: RPC `create_unity_delivery_note(p_order_id, p_items[], p_delivery_date, p_notes, p_actor_id)`:
   - Calls `issue_unity_delivery_note_number(p_org_id)` (row lock on `organizations` + prefix-aware max + 23505 retry, see `order_delivery_notes` table definition).
   - Writes `order_delivery_notes` row with `source='unity'`, `note_number=<computed>`, `status='draft'`, children.
   - Returns the order_delivery_note_id.
4. The UI navigates to `/orders/[orderId]/delivery-notes/[deliveryNoteId]` which renders a printable preview. "Print PDF" → triggers dynamic import of the PDF renderer module + opens the print dialog.
5. PDF layout: org letterhead (from `delivery_note_pdf_letterhead_url`), customer block, order ref, line items (product code, name, quantity), notes section, signature line with name + date, delivery-note number footer.
6. On "Print" confirmation: RPC `mark_delivery_note_printed(p_order_delivery_note_id, p_actor_id)` flips status to `'printed'`.
7. When the customer signs (or staff records the signature): "Mark as signed" → `mark_delivery_note_signed(p_order_delivery_note_id, p_signed_by_text, p_signed_at, p_actor_id)` flips status to `'signed'`, increments `order_details.delivered_qty`, runs the order-auto-close check.

**No `product_inventory_transactions` write on sign** (round 1 BLOCKER #5). Customer orders are built-to-order by default — the product never sits in finished-goods stock. Writing a `ship` movement on DN sign for these would create a negative QOH for stock that was never `+1`'d. If the order is fulfilled from finished-goods reservation instead (via the existing `/api/orders/[orderId]/reserve-fg` and `/consume-fg` flow), the `consume-fg` endpoint already writes the inventory transaction at consumption time. DN signing is purely a tracking + auto-close trigger.

### Path 2 — record Pastel DN

For when Pastel generated the DN, not Unity.

1. On the same order, "Record external delivery" button.
2. Modal: Pastel DN number (text), pick items + quantities (still capped at `ready_qty - allocated_delivery_qty`), delivery date.
3. On submit: RPC `record_external_delivery_note(p_order_id, p_external_ref, p_items[], p_delivery_date, p_actor_id)`:
   - Writes `order_delivery_notes` row with `source='pastel'`, `external_reference=<Pastel DN>`, `note_number=NULL`, `status='signed'` (assumed signed; Pastel-issued is fact of delivery), children.
   - Increments `delivered_qty` immediately.
   - Runs order-auto-close check.
4. No PDF generation. No print step. No `product_inventory_transactions` write (same reasoning as Path 1). The Pastel reference is shown in the order's delivery-notes list as "External (Pastel: <ref>)".

### Constraint enforcement

A DB trigger validates that ∑ `order_delivery_note_items.quantity` per `order_detail_id` across delivery notes where the parent `status IN ('draft','printed','signed')` cannot exceed `order_details.quantity`. Cancelled notes don't count.

### Cancellation

- **Draft or printed Unity note:** "Cancel note" → status flips to `'cancelled'`. `delivered_qty` does NOT change (it only increments at sign time). The note number is burned, not freed — gaps in the sequence are acceptable and preserved for audit.
- **Signed Unity note:** requires admin permission. Status flips to `'cancelled'`, `delivered_qty` decrements by the note's per-item qty, and an `order_status_events` row records who did it and why (mandatory reason field on cancel for signed notes). If the order had auto-closed, the reopen RPC reads `orders.completed_from_status_id` (or the most recent non-Completed `order_status_events.to_status_id` row) to restore the correct prior status.
- **Pastel note:** same flow as a signed Unity note (admin gate + audit). `delivered_qty` decrements.

## Order auto-close & Ready For Delivery intermediate

Two-stage closure model integrating the existing `order_statuses` lookup. Both stages happen automatically; manual status changes still work.

The existing lookup: `27 New`, `28 In Production`, `33 In Progress`, `29 On Hold`, `1 Ready For Delivery`, `30 Completed`, `31 Cancelled`. We use `1 Ready For Delivery` as the intermediate "all lines ready, not yet delivered/received" state, and `30 Completed` as the final auto-close.

### Stage 1 — promote to Ready For Delivery

Implemented as `check_order_readiness(p_order_id)`, called from `mark_order_details_ready` at the tail (after the new `'ready'` items are emitted).

Algorithm:

1. If every non-cancelled `order_details` row for the order has `status = 'ready'`, AND the order is not already at `status_id IN (1, 30, 31)`, set transaction-local context (`trigger_source='auto_ready'`) and `UPDATE orders SET status_id = 1`. The single-writer trigger on `orders.status_id` writes the `order_status_events` row.
2. If not all lines are ready yet, no change.

This applies to both customer and internal orders. Internal-order users see "Ready for delivery" as "Ready to receive into stock" via UI labelling.

### Stage 2 — promote to Completed

Implemented as `check_order_completion(p_order_id)`, called from delivery-note signing, stock-receipt confirmation, manual receive, and the Pastel-record RPC.

Algorithm:

1. Look up parent order's `order_type`.
2. If `order_type='customer'`: complete = every non-cancelled `order_details.delivered_qty = order_details.quantity`.
3. If `order_type='internal'`: complete = every non-cancelled `order_details.received_qty = order_details.quantity`.
4. If complete: capture current `status_id` into `orders.completed_from_status_id` (so reopen knows where to put it back), set transaction-local context (`trigger_source='auto_completed'`), UPDATE `orders.status_id = 30` (existing `Completed`). The single-writer trigger writes the `order_status_events` row.
5. Flip each `order_details.status` from `'ready'` to `'delivered'` (customer) or `'received'` (internal) as appropriate.

Race-safety: the UPDATE uses `WHERE status_id <> 30` so a second concurrent caller is a no-op.

Closing locks the order against further delivery notes / stock receipts (the create-RPCs check `orders.status_id` first — reject if = 30).

### Reopen

`reopen_order(p_order_id, p_reason, p_actor_id)` — admin-gated RPC. Restores `status_id` from `orders.completed_from_status_id` (if non-NULL) or the most recent non-Completed `order_status_events.to_status_id` (fallback). Sets `trigger_source='reopen'` + reason via `set_config`, then UPDATEs `orders.status_id`; the single-writer trigger writes the event. Clears `completed_from_status_id` after the UPDATE.

The "Reopen" path fires automatically when a signed DN is cancelled in admin mode (see Delivery notes §"Cancellation") — same RPC, with a system-generated reason ("auto-reopened: signed delivery note <id> cancelled").

### Status label adapter (round 2 MAJOR #4)

`order_statuses.status_name` for `status_id=1` is `'Ready For Delivery'` — customer-facing. Internal orders also land at `status_id=1` (Stage 1 of closure), and "Ready For Delivery" is misleading for them. The fix is **NOT** to mutate the lookup row; it's a single shared display helper that adapts by `order_type`:

```ts
// lib/orders/status-label.ts (new)
export function getOrderStatusLabel(order: { order_type: 'customer'|'internal'; status_id: number; status_name?: string }): string {
  if (order.status_id === 1) {
    return order.order_type === 'internal' ? 'Ready to receive into stock' : 'Ready For Delivery';
  }
  return order.status_name ?? '';
}
```

**Every consumer that displays a status — list pages, filters, exports, dashboards, the assistant tools, email templates, search results, API responses — calls this helper.** Phase 3 audits every site that today reads `order_statuses.status_name` directly and routes them through the helper. The audit list goes in the Phase 3 ticket. Until that audit is clean, status_id=1 internal orders will display "Ready For Delivery" in any unmigrated surface — acceptable interim because the underlying state is correct, but it's a Phase 3 deliverable to close.

## Inventory transactions history page

**Reframing from round 1 MAJOR #11.** This is NOT greenfield — `components/features/products/ProductTransactionsTab.tsx` already exists and queries `product_inventory_transactions` per-product. There's also a global `ProductsTransactionsTab` mounted somewhere in `/products`. Phase 6 is a **refactor + promotion**:

- Move per-product transaction display from "Products page tab" surface to first-class routes (`/inventory/products/[productId]/transactions`).
- Build the new global page at `/inventory/transactions`.
- Add the running-balance column (new — uses the new `_with_balance` view).
- Add filters, quick-view pills (*Today's receipts*, *Adjustments this month*, *Negative movements > 10*, *My movements*), source-ref drill-downs, CSV export (new).
- Add the QOH chart on the per-product page (new).
- Existing `/products#transactions` tab continues to work during the transition; Phase 6 retires it in the same PR (after the new pages render the same data correctly).
- Route reconciliation: existing routes that link to `/products?tab=transactions` get updated to point at `/inventory/transactions` or `/inventory/products/<id>/transactions` depending on context.

Plan-write step verifies which `app/products/` page mounts `ProductsTransactionsTab` so the migration is mechanical.

### Layout

- Sticky top: filter bar (product combobox, type multi-select chips, date range, user filter, source filter). Filter state in URL params (list-state persistence rule).
- Above filters: quick-view pills — *Today's receipts*, *Adjustments this month*, *Negative movements > 10*, *My movements*. Click sets the matching filter state.
- Main: virtualised table, newest first. Each row:

| Cell | Content |
|---|---|
| Time | Absolute timestamp + relative ("2h ago"), muted |
| Type chip | Colour-coded: green Receipt/Return, rose Delivery/Scrap, amber Adjustment, indigo Reversal, slate Manual receipt |
| Product | Code + name + thumbnail (if `products.thumbnail_url` present) |
| Quantity | Signed (`+5`, `-3`), green/rose |
| QOH after | Running balance from `product_inventory_transactions_with_balance` view |
| Source | Clickable inline ref: `Internal order PO-INT-0042`, `Delivery note DN-0083`, `Manual adjustment by Sue`, `Reversal of TX-1245` |
| Actor | User badge |
| (Expand) | Click row → reveals reason/notes inline |

- Right-side action button per row (where applicable): "Reverse this" for adjustments (admin only).
- Export CSV button — applies current filters, exports the resulting view rows.

### Per-product drilldown

`/inventory/products/[productId]/transactions` — same table filtered to one product, plus a QOH line chart over time at the top with markers for each transaction (hover shows the source ref).

### Data source

`product_inventory_transactions_with_balance` view + joins to `products`, `orders`, `order_delivery_notes`, `stock_receipts`, `stock_adjustments`, `auth.users` for the source-ref labels and actor names. All joined data is org-scoped via RLS on the underlying tables.

## UI placement

### Orders page top-bar toggle

- Inside `/orders`, add a segmented `Customer | Internal` control at the very top of the page (above the title row).
- Switching:
  - Changes URL to `?type=customer` / `?type=internal` (default if absent: `customer`, matching today's behaviour for back-compat).
  - Swaps the table content (filters `orders.order_type`).
  - Swaps the counter strip (totals are per-type).
  - Hides the section-tab filters (Chairs/Wood/Steel/Powdercoating) when type=internal — those tabs are keyword-derived from product descriptions and don't make sense across an internal-only filter.
  - Swaps the "+ New Order" button label to "+ New Internal Order".
- Selection persists across navigations within the orders area.

### Internal order creation

- Reachable via the segmented toggle + "+ New Internal Order" button.
- Form differences from customer order:
  - No customer combobox.
  - **Reason** (free text, required, max 200 chars) replaces the customer block. Examples: "Restock 50 cupboards", "Sample build for client X visit".
  - Same product/quantity/delivery-date fields as today.
- After creation, redirects to `/orders/[orderId]` with `?type=internal` so back navigation honours the toggle state.

### Suggested replenishment panel

- On the internal orders list page (i.e. `/orders?type=internal`), a small panel above the table: "N stocked products are below reorder level".
- Lists 5–10 lowest-stock items (`product_inventory.quantity_on_hand < products.reorder_level`).
- One-click "Create internal order for these" opens the new-order form pre-filled with those products and suggested quantities (`reorder_level - quantity_on_hand`, rounded up to a reasonable batch size — heuristic: round to next 10).

### Stock check-in entry points

- "Ready to receive" banner on internal order detail (when a draft receipt exists).
- "Receive manually" button alongside, always available on internal orders.
- "Adjust stock" on each product page.

### Delivery note entry points

- "Create delivery note" + "Record external delivery" buttons on customer order detail when at least one item has `ready_qty > allocated_delivery_qty` (round 3 MINOR #3 — allocation-aware so the button doesn't appear when all ready quantity is already on a draft/printed note that the DB trigger would reject).
- "Delivery notes" tab on the order detail page listing all notes for the order with status chips.
- Cross-order list at `/inventory/deliveries` for reporting (filterable by customer, date range, status).

### Sidebar

- New "Stock movements" item under inventory → `/inventory/transactions`.
- New "Deliveries" item under inventory → `/inventory/deliveries`.
- Existing inventory entries unchanged.

### Settings page

- New section "Numbering":
  - Number input: "Delivery note starting number" (`delivery_note_starting_number`).
  - Text input: "Delivery note prefix" (`delivery_note_prefix`, default `DN-`).
  - Number input: "Stock receipt starting number" (`stock_receipt_starting_number`).
  - Text input: "Stock receipt prefix" (`stock_receipt_prefix`, default `SR-`).
- Numeric inputs follow the project's UX rule: empty-on-zero, auto-select-on-focus, default-to-existing-value-on-blur.
- New section "Documents":
  - File upload for delivery note letterhead → uploads to a per-org storage bucket, stores URL in `delivery_note_pdf_letterhead_url`.

## Verification

Each phase ships with:

- `npm run lint` clean.
- `npx tsc --noEmit` clean on touched areas (or a clear report of unrelated existing failures per the project's standard rule).
- **Phase 1A (schema safety):** Supabase MCP `get_advisors` shows the three pre-existing ERROR-level RLS gaps closed (`jobs`, `manufacturing_sections`, `order_manufacturing_sections`) and zero NEW warnings. Cross-org RLS smoke includes: (a) member of org A cannot SELECT new-table rows from org B; (b) member of org A cannot INSERT a child row referencing an org-B parent (the cross-org consistency trigger blocks). Smoke runs against the `_with_balance` VIEW (not just the base table) to verify `security_invoker=true` propagates RLS.
- **Phase 1B (section source of truth):** Migration that adds `job_work_pool.section_id` populates correctly from BOL for new pool rows. `issue_job_card_from_pool` end-to-end smoke creates a job card with a populated `section_id`. Follow-up cards created by `complete_job_card_v2`'s remainder branch also have `section_id` populated. NOT NULL constraint on new `job_cards.section_id` (only) does not break existing flows.
- **Phase 2 (cascade + ready event):** RPC unit tests in `tests/db/` covering (round 1 MINOR #6 expanded list):
  - cascade on multi-section product (cupboard with 3 sections)
  - cascade on single-section product (fallback path)
  - idempotency of `mark_order_details_ready` (same card completed twice; ready_qty doesn't double-count)
  - RLS rejection of cross-org calls
  - two pool rows for same `(order_detail_id, product_id, section)` — operations are MIN'd not summed
  - two different operations in same section, one fully complete and one half-complete → ready_qty = the half
  - **multiplier=2 doors case** (worked example A): 15 doors complete for 10-cupboard line → ready_qty=7 (round 3 MINOR #5)
  - **multiplier=4 shelves case** (worked example C): 37 shelves complete for 10-cupboard line → that op contributes 9 → section min reflects the slowest op
  - **over-complete with multiplier > 1**: 45 doors complete on a 20-required multiplier-2 op → clamped to 20 → contributes 10 → diagnostic logged
  - **required_qty_per_finished_good backfill**: historical pool row with `required_qty=80` and `order_details.quantity=20` backfills to multiplier=4; row with NULL `order_detail_id` keeps default 1; row with `quantity=0` backfills to 1 via COALESCE without error
  - cancelled pool row excluded from rollup
  - cancelled job_card excluded
  - cancelled job_card_item excluded
  - follow-up remainder card (from `complete_job_card_v2` partial completion) participates in rollup
  - product route changed AFTER order creation — does not affect in-flight ready_qty (snapshot in effect)
  - `work_pool_id IS NULL` items skipped without error
  - `job_work_pool.order_detail_id IS NULL` (manual pool) excluded
  - concurrent `complete_job_card_v2` calls on two cards both touching the same order — no duplicate draft receipts, partial-unique index serialises
  - confirm-while-new-ready-event-arrives race — confirmation succeeds, new ready landed in new draft
  - existing piecework happy path unaffected (regression coverage)
- **Phase 3 (internal CRUD + route config UI):** Browser smoke creates an internal order, sees it in the list, sees it does NOT appear in the customer filter. Routing-UI smoke: configure a product route, verify the next-created order_detail for that product snapshots the new route. **Status-label-adapter acceptance (round 3 MINOR #6):** `grep -rn "status_name" app/ components/ lib/ types/` shows no user-facing status display bypassing `getOrderStatusLabel(order)`, except explicitly-documented server/query code that doesn't render to a user (filters, joins, internal API serialization).
- **Phase 4 (stock check-in):** Browser smoke runs the auto path (complete a job card, see banner, click confirm, see QOH bump, see `product_inventory_transactions` row with `type='build'` and `reference='stock_receipts:<id>'`). Manual receive smoke: receive with notes, see transaction tagged "Manual receipt". Partial-confirmation smoke: confirm 4 of 6, see residual draft re-armed with 2.
- **Phase 5 (delivery notes):** Browser smoke creates a Unity DN, generates PDF, marks signed, verifies NO `product_inventory_transactions` row was written (only `delivered_qty` incremented). Verify order moved to Ready For Delivery on all-lines-ready, then to Completed on all-delivered. Repeats with Pastel record path. Cancellation smoke: cancel a signed note (admin), verify order reopens via `completed_from_status_id`. **No-duplicate-with-consume-fg test (round 2 MINOR #4):** create a customer order, reserve FG, consume FG, sign the DN; assert exactly one `product_inventory_transactions` row exists for the consumed quantity (catches accidental reintroduction of a DN-side write).
- **Phase 6 (transactions page refactor):** Browser smoke loads new `/inventory/transactions` page with mixed transaction types, filter by type works, click source ref drills correctly into the source record, CSV export downloads a non-empty file. Per-product page renders QOH chart. Verify the old `/products?tab=transactions` is retired without breaking outbound links from other pages.
- **Phase 7 (settings):** Change starting number, create a new delivery note, see numbering honour the floor. Change prefix, verify next number is prefix-aware (doesn't jump to max of old prefix).

Memory rule reminders:
- Do NOT insert synthetic wage data into the live DB. Smokes that touch piecework (Phase 2) must clean up.
- When Codex executes, reviewer (Claude) runs the browser smoke via preview MCP rather than punting to Greg. Check `authorizedFetch` vs plain `fetch` on any new UI hitting `/api/...` routes.

## Phasing (Linear epic shape) — round 1 reorder

Each phase becomes a sub-issue under the parent epic "Internal Orders & Order Completion" in the Manufacturing project. Round 1 split Phase 1 into 1A (schema safety, no behavior change) and 1B (section source-of-truth — must come before Phase 2 can be built), and reordered route configuration earlier.

| Phase | Title | Output |
|---|---|---|
| 1A | Schema safety + RLS gap-close | All Phase 1 migrations EXCEPT the section-source-of-truth + NOT-NULL-on-new-`job_cards.section_id` enforcement. Adds new tables + columns NULLABLE, enables RLS on `jobs`/`manufacturing_sections`/`order_manufacturing_sections` with correct write policies (`jobs` is NOT read-only), adds cross-org consistency triggers, creates the `_with_balance` view with `security_invoker=true`, re-runs view definitions for view-drift safety. Behavior change: zero. Advisor warnings closed. |
| 1B | Section source of truth | Add `job_work_pool.section_id` + populate at pool generation from BOL. Extend `issue_job_card_from_pool` and `complete_job_card_v2`'s follow-up-card branch to copy `section_id` onto new `job_cards`. ONLY THEN add the trigger that enforces `job_cards.section_id NOT NULL` on inserts after migration time. Without this phase, Phase 2 cannot work — there's no source for the section to roll up. |
| 2 | Section cascade + ready event | Extend `complete_job_card_v2` with the cascade tail, add `mark_order_details_ready`, add the `order_details.AFTER UPDATE` trigger that maintains draft `stock_receipts` for internal orders (with the partial-unique upsert pattern). Add `check_order_readiness` (Ready For Delivery promotion). Tests covering the long edge-case list above. |
| 3 | Route configuration + internal-order CRUD | UI to configure `product_sections` per product (route editor on product detail page). Seed `products.default_section_route` for well-known products. Snapshot logic on order_detail creation (writes `order_detail_required_sections`). Orders page toggle (Customer/Internal). Internal-order create form. Internal-order list view. Suggested replenishment panel. |
| 4 | Stock check-in flows | "Confirm receipt" + "Receive manually" + "Adjust stock" UI + RPCs (`confirm_stock_receipt`, `create_manual_stock_receipt`, `apply_stock_adjustment`). Partial-confirmation residual-draft logic. |
| 5 | Customer delivery notes | Unity-generated path with PDF, Pastel-recorded path, `check_order_completion` Completed promotion, reopen flow, deliveries list page at `/inventory/deliveries`. |
| 6 | Inventory transactions page (refactor) | Refactor existing `ProductTransactionsTab` to first-class routes `/inventory/transactions` and `/inventory/products/[productId]/transactions`. Add the running-balance column, filters, quick-view pills, source-ref drilldowns, CSV export, per-product QOH chart. Retire `/products?tab=transactions`. |
| 7 | Settings additions | Numbering columns on `organizations` (starting numbers + prefixes) + letterhead upload. |
| 8 | Verification & smoke pass | End-to-end smoke covering both order types, both delivery-note paths, both stock-receipt paths, transactions page coverage. RLS smoke against the view. Advisors check. Sign-off. |

Phases 3–7 can ship as separate PRs back into `codex/integration`; Phases 1A, 1B, 2, 8 should each be a single PR. **Phase 2 has a hard dependency on 1B; do not start 2 until 1B is merged.** Phases 4 and 5 both depend on 2.

## Risks & open questions

### Risks

- **`complete_job_card_v2()` modification.** This RPC is load-bearing for piecework today. Any error in the cascade fails card completion. Decision: **fail loud** — the cascade runs in the same transaction; if it errors, the card completion rolls back so the operator sees the error rather than a silently half-updated state. Mitigation against false-failures: comprehensive regression test for the existing piecework happy path (Phase 2 test list explicitly includes this), plus the cascade is purely additive logic over read-only joins until the final UPDATE statements.
- **Section-routing fallback masks misconfiguration.** Snapshot resolution with `source='fallback'` is silent at the data layer. Mitigation: UI surfaces a warning on the order_detail line ("Inferred single-section route — configure this product's route to suppress this warning") whenever `order_detail_required_sections.source='fallback'` is read.
- **Pastel reconciliation drift.** Operators may forget to record a Pastel DN in Unity, leaving items at Ready For Delivery indefinitely. Mitigation: out of scope for v1; future "Ready > 7d" alert ticket.
- **Order auto-close race.** Two concurrent confirmations could both think they're the last one. Mitigation: `check_order_completion` UPDATE uses `WHERE status_id <> 30`; second call is a no-op.
- **Section source-of-truth migration (Phase 1B) requires updating both insertion paths in the same PR.** Risk: if `issue_job_card_from_pool` and the follow-up-card branch of `complete_job_card_v2` aren't both updated before the NOT NULL trigger fires, issuance fails. Mitigation: Phase 1B explicitly bundles the column add, both insertion-path updates, AND the NOT NULL enforcement into a single migration. Tests cover both insertion paths.
- **Concurrent auto-draft receipt creation under partial-unique upsert.** If two `complete_job_card_v2` calls run in overlapping transactions and both target the same internal order, the partial-unique index on `stock_receipts (org_id, order_id) WHERE status='draft'` serialises them. One inserts, the other's ON CONFLICT path fetches the existing draft and upserts the item delta. The remaining sliver of risk is a serialisation failure under heavy concurrency — acceptable; Postgres retries naturally with the right isolation level. Document in operations notes.
- **Confirmation reduces qty without realising stranded units would be lost (operator UX).** Round 1 MAJOR #7 mitigation: residual draft is auto-created from the unconfirmed remainder. The operator never has to remember to refire the receipt.
- **Allocation-aware DN qty can confuse operators** who expect "ready" to equal "deliverable". Mitigation: modal label says "Available to deliver: X (Y already allocated to draft/printed notes)" so the math is visible.

### Open questions (intentionally deferred to plan-write or implementation)

- Exact placement of "Stock movements" and "Deliveries" inside the sidebar relative to existing inventory items — decided by reading the current sidebar structure during plan-write.
- Whether to surface `internal_reason` on the suggested-replenishment auto-fill (pre-fill with "Replenishment 2026-05-25" or similar). Plan-write decision.
- Whether the cross-order `/inventory/deliveries` page is in Phase 5 or split out as a 5b. Plan-write decision.
- Reorder-level batch heuristic for suggested replenishment ("round to next 10" — confirm with operations during Phase 3).
- Whether `consume-fg` writes `type='ship'` or `type='consume'` for finished-goods consumption against customer reservations. Plan-write step reads the existing code and documents which; spec text already says "DN signing does NOT double-write", which is correct regardless.
- Which `manufacturing_sections` row is the org's default Assembly (for the fallback snapshot). Either match on `section_code = 'ASM'`/'ASSEMBLY' or add a `default_assembly_section_id` column on `organizations`. Plan-write decides; the column-add is cheaper if there isn't a stable code.
- Whether `billoflabour` already carries a `section_id` we can snapshot into `job_work_pool.section_id`, or whether we need to add it. Preflight did not find one. Plan-write verifies via `information_schema.columns` on `billoflabour` and adjusts Phase 1B accordingly.

## Out of scope but worth future tickets

- Multi-warehouse / location.
- Real Pastel bidirectional sync.
- Make-to-stock vs make-to-order policy on products (proper replacement for the legacy `make_strategy` column).
- Customer-returns flow integrated with delivery notes (today: manual stock adjustment with reason).
- Lot / batch tracking on inventory.
- A "scheduled internal orders" auto-creation cron (e.g. weekly restock runs).
- Approval workflow on internal orders > N units (currently anyone can create any size).
- "Ready items pending delivery > 7 days" alert on the customer-orders list (Pastel-reconciliation drift mitigation).
- Tightening `jobs` write policy to a `labor_admin` permission (currently open to all authenticated, matching today's effective access).
