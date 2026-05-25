# Internal Orders & Order Completion — Design Spec

- **Date:** 2026-05-25
- **Author:** Greg Maier (Claude Code, local desktop)
- **Status:** Draft, preflight-validated, awaiting GPT-5.5 Pro plan review
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
| `products` | PK `product_id`. `is_stocked boolean NOT NULL DEFAULT false`. `make_strategy text NOT NULL DEFAULT 'phantom'` (**850 rows all = 'phantom'; zero TS consumers**). No `default_section_route`. RLS on. |
| `product_inventory` | `product_inventory_id, product_id, quantity_on_hand numeric NOT NULL DEFAULT 0, location, reorder_level, org_id`. RLS on. |
| `product_inventory_transactions` | PK `id bigint`. `product_id, quantity numeric NOT NULL` (signed delta), `type product_txn_type NOT NULL`, `occurred_at timestamptz NOT NULL DEFAULT now()`, `order_id`, `reference text`, `org_id`. Enum `product_txn_type` values: **`build, ship, return, receive, adjust, consume`**. RLS on. |
| `order_statuses` lookup | `27 New, 28 In Production, 33 In Progress, 29 On Hold, 30 Completed, 1 Ready For Delivery, 31 Cancelled`. No 'Closed' status — Phase 5 reuses `30 Completed` for auto-close. |
| `organizations` | The org table. Holds `week_start_day, ot_threshold_minutes, configurator_defaults jsonb, cutlist_defaults jsonb, payroll_standard_week_hours`. **No `org_settings` table exists.** New per-org numbering settings are added as columns on `organizations`. |
| Existing PO-side `DeliveryNote*` TS types | In `lib/db/purchase-order-attachments.ts`, `app/purchasing/quick-upload/`, `components/features/purchasing/DeliveryNoteUpload.tsx`. These are **supplier delivery notes** (attachments on receiving goods FROM suppliers). **Naming collision risk** — our customer-facing tables/types use `order_delivery_notes` / `OrderDeliveryNote` to avoid confusion. |
| Delivery notes (customer-facing) | **Do not exist.** Orders can sit at "In Production" forever. |
| Stock receipts | **Do not exist** as a first-class concept. |
| Internal orders | **Do not exist.** |
| Inventory transactions page | **Does not exist.** Only the raw transactions table, no UI. |

The interactive walkthrough at `public/internal-orders-design.html` covers the conceptual model in diagram form (uses pre-preflight names in places — the spec above supersedes).

### Preflight advisor findings (must be addressed in Phase 1)

Three ERROR-level RLS gaps on tables this work activates:

- `jobs` — RLS disabled. Catalog; enable RLS with a read-all-to-authenticated policy (no write policies; only seeded via migration).
- `manufacturing_sections` — RLS disabled. Same shape as `jobs`: read-all-to-authenticated, no writes (org configures via product_sections override, not direct writes here).
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
| `customer_id` | Already NULLABLE today. No DDL change needed. |
| `customer_id` CHECK | NEW: `order_type = 'customer' → customer_id IS NOT NULL`. |
| `internal_reason` | NEW: text NULLABLE. Free-text reason on internal orders ("Restock 50 cupboards", "Sample build for client X visit"). NULL on customer orders (enforced via CHECK). |

Existing customer orders auto-default to `order_type='customer'`. View `v_orders_with_customers` and `orders_due_today` use LEFT JOIN on `customer_id` so they're already null-safe.

#### `order_details`

(The actual line-items table in this codebase. Not `order_items`.)

| Column | Change |
|---|---|
| `status` | NEW: text NOT NULL DEFAULT `'pending'` with CHECK `status IN ('pending','in_production','ready','delivered','received','cancelled')`. |
| `ready_qty` | NEW: integer NOT NULL DEFAULT 0. Cumulative qty that has flipped to ready. |
| `delivered_qty` | NEW: integer NOT NULL DEFAULT 0. Cumulative qty on signed/printed delivery notes. |
| `received_qty` | NEW: integer NOT NULL DEFAULT 0. Cumulative qty confirmed into stock receipts. |
| CHECK constraint | NEW: `ready_qty <= COALESCE(quantity, 0) AND delivered_qty <= COALESCE(quantity, 0) AND received_qty <= COALESCE(quantity, 0)`. (`quantity` is currently NULLABLE on this table; spec preserves that — if Phase 1 wants to additionally NOT NULL it, that's a separate decision.) |
| Cross-table invariant | Enforced via trigger reading parent `orders.order_type` (CHECK can't reference a parent row): `delivered_qty > 0 → order_type = 'customer'`, `received_qty > 0 → order_type = 'internal'`. |

Status transitions:

```
   pending → in_production → ready → (delivered | received) → terminal
                          └→ cancelled (from any non-terminal state)
```

- `pending` → `in_production`: fires when the first `job_card_items` row referencing this `order_detail_id` is created (i.e. a job card has been issued against the item). Implemented as an `AFTER INSERT` trigger on `job_card_items`.
- `in_production` → `ready`: fires when `mark_order_details_ready` increments `ready_qty` to equal `quantity` (see §"The 'ready' event").
- `ready` → `delivered`: fires from `check_order_completion` when the order auto-closes and the order is `order_type='customer'`. Per-line, only when that line's `delivered_qty = quantity`.
- `ready` → `received`: same as above, `order_type='internal'`, when `received_qty = quantity`.
- → `cancelled`: explicit user action via the order detail page. Cancelling an item zeroes its required counters in the order-auto-close check (it doesn't have to be delivered/received to allow closure).

#### `job_cards`

| Column | Change |
|---|---|
| `section_id` | NEW: integer FK → `manufacturing_sections.section_id` NULLABLE (for historicals). |
| CHECK / trigger | NEW: new job cards created after this lands MUST have `section_id` populated. Enforced in app layer + a trigger that rejects NULL on INSERT unless a migration-flag column is set. |

#### `products`

| Column | Change |
|---|---|
| `default_section_route` | NEW: integer[] NULLABLE. Ordered array of `manufacturing_sections.section_id`. The canonical route for this product when no per-org override exists in `product_sections`. |
| `make_strategy` | **Untouched in this work.** It's `NOT NULL DEFAULT 'phantom'` with all 850 rows set to 'phantom' and zero TS consumers. Dropping it would require a coordinated migration that's out of scope here. Documented as legacy. A future ticket can replace it with a proper make-to-stock vs make-to-order field. |

### New tables

#### `product_sections`

Per-org override of the section route per product. If no row exists for a (product, org), `products.default_section_route` is used.

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

#### `order_delivery_notes`

(Named `order_delivery_notes` — NOT `order_delivery_notes` — to avoid collision with the existing supplier-side `DeliveryNote*` TS types in `lib/db/purchase-order-attachments.ts` and `components/features/purchasing/*`. The TS type is `OrderDeliveryNote`.)

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
UNIQUE (org_id, note_number) WHERE note_number IS NOT NULL
INDEX  (org_id, order_id)
INDEX  (org_id, status, delivery_date DESC)
```

`note_number` is assigned by an RPC reading the per-org `organizations.delivery_note_starting_number` floor and the current max existing `note_number` for the org. Format: `<delivery_note_prefix><NNNN>` zero-padded to 4 digits, both configurable on the `organizations` row.

RLS: `is_org_member(org_id)`.

#### `order_delivery_note_items`

```
order_delivery_note_item_id  bigint PK
org_id                       uuid NOT NULL FK → organizations(id)
order_delivery_note_id       bigint NOT NULL FK → order_delivery_notes(order_delivery_note_id) ON DELETE CASCADE
order_detail_id              integer NOT NULL FK → order_details(order_detail_id)
quantity                     numeric(12,3) NOT NULL CHECK (quantity > 0)
created_at                   timestamptz NOT NULL DEFAULT now()

INDEX (org_id, order_delivery_note_id)
INDEX (org_id, order_detail_id)
```

Trigger enforces: ∑ `quantity` per `order_detail_id` across rows where the parent `order_delivery_notes.status IN ('printed','signed','draft')` ≤ `order_details.quantity`. Cancelled notes don't count.

RLS: `is_org_member(org_id)`.

#### `stock_receipts`

```
stock_receipt_id        bigint PK
org_id                  uuid NOT NULL FK → organizations(id)
order_id                integer NOT NULL FK → orders(order_id)
                                              -- must be an internal order; enforced via trigger
receipt_number          text NOT NULL        -- 'SR-NNNN'
status                  text NOT NULL CHECK (status IN ('draft','confirmed','cancelled'))
received_at             timestamptz NULLABLE -- set when status flips to 'confirmed'
received_by             uuid NULLABLE FK → auth.users(id)
notes                   text NULLABLE
created_by              uuid NOT NULL FK → auth.users(id)
created_at              timestamptz NOT NULL DEFAULT now()
updated_at              timestamptz NOT NULL DEFAULT now()

UNIQUE (org_id, receipt_number)
INDEX  (org_id, order_id)
INDEX  (org_id, status, received_at DESC)
```

Auto-numbered same scheme as delivery notes (`organizations.stock_receipt_starting_number` + `organizations.stock_receipt_prefix`). Auto path creates `status='draft'` rows that aggregate ready items until confirmed.

RLS: `is_org_member(org_id)`.

#### `stock_receipt_items`

```
stock_receipt_item_id   bigint PK
org_id                  uuid NOT NULL FK → organizations(id)
stock_receipt_id        bigint NOT NULL FK → stock_receipts(stock_receipt_id) ON DELETE CASCADE
order_detail_id           integer NOT NULL FK → order_details(order_detail_id)
product_id              integer NOT NULL FK → products(product_id)
quantity                numeric(12,3) NOT NULL CHECK (quantity > 0)
created_at              timestamptz NOT NULL DEFAULT now()

INDEX (org_id, stock_receipt_id)
INDEX (org_id, order_detail_id)
INDEX (org_id, product_id)
```

When the parent `stock_receipts.status` flips to `'confirmed'`, a Postgres function writes one `product_inventory_transactions` row per stock_receipt_item with type `'receipt'` and source reference back to the receipt. Same function bumps `product_inventory.quantity_on_hand` and `order_details.received_qty`.

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

```sql
CREATE VIEW product_inventory_transactions_with_balance AS
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
```

The view is the data source for the `/inventory/transactions` page. Ordering by `(occurred_at, id)` gives a deterministic tiebreaker. The view inherits RLS from the underlying table.

The existing `product_txn_type` enum (`build, ship, return, receive, adjust, consume`) is the type field. This work's mapping:

| Movement | Enum value | Notes |
|---|---|---|
| Internal-order stock receipt confirmed (auto path) | `build` | Manufactured into stock. Distinguishable from `receive` (supplier-side) and from manual-receipt-with-notes by the `reference` field pointing at `stock_receipts:<id>` and the receipt's `notes`. |
| Internal-order manual receipt confirmed | `build` | Same type as auto; distinguish in UI by the receipt row having `notes` populated and a "Manual receipt" chip. |
| Customer-order delivery note signed | `ship` | Send to customer. `reference` points at `order_delivery_notes:<id>`. |
| Stock adjustment | `adjust` | `reference` points at `stock_adjustments:<id>`. |
| Stock adjustment reversal | `adjust` | Same row type; the reversed status is encoded on `stock_adjustments.reverses_adjustment_id`, surfaced in the UI. |
| Customer return (out of scope v1) | `return` | Via manual adjustment for now. |
| Raw consumption (existing) | `consume` | Already used; not touched by this work. |
| Supplier receipt (existing) | `receive` | Already used by purchase flow; not touched by this work. |

## Section routing model

Per-product configuration of which manufacturing sections a product traverses, in order.

### Source of truth

1. `product_sections` (per-org override) is checked first. If rows exist for `(org_id, product_id)`, that's the route in `sequence_order`.
2. Otherwise fall back to `products.default_section_route` (a `manufacturing_sections.section_id[]` on the product).
3. If both are NULL/empty, the product is treated as **single-section** (Assembly) — the ready event fires on completion of the one and only job card.

### Instantiation on order creation

When an order is created (customer or internal), for every distinct `section_id` referenced across all `order_details`' resolved routes, one `order_manufacturing_sections` row is created linked to the order. (Distinct per order — not per item — to match the existing table grain.)

For finer-grained "this cupboard has finished Cutting" tracking we'd need a per-item table; this spec deliberately does NOT introduce one because the rollup in §"The ready event" works at the item level by reading `job_card_items` directly. The `order_manufacturing_sections` rows are for **order-level** section visibility (UI badges, reports), not for the ready trigger itself.

### Section completion cascade

`complete_job_card_v2()` is extended:

1. (Existing behaviour) Marks card + items completed, handles remainder disposition.
2. (NEW) If the card has `section_id` populated, recompute that section's completion state across the order: ∑ `job_card_items.completed_qty` per `(order_id, section_id)`. If that ≥ required qty for the section, write `now()` into `order_manufacturing_sections.completed_at` for that `(order_id, section_id)` pair (idempotent — only fills NULL).
3. (NEW) Invoke `mark_order_details_ready(p_job_card_id)`.

The cascade is wrapped in the same transaction as the card-completion update. If `mark_order_details_ready` fails, the card completion rolls back — better to fail loudly than half-update.

## The "ready" event

`mark_order_details_ready(p_job_card_id)` is an idempotent `SECURITY DEFINER` Postgres function. Returns a `SETOF order_detail_id` of the items that newly became ready (for the caller to use in notifications / UI invalidation).

Algorithm (uses the actual linkage path confirmed by preflight: `job_card_items.work_pool_id → job_work_pool.pool_id → job_work_pool.order_detail_id`. The `jobs` table is a global catalog and has no `order_detail_id`):

1. Look up all `order_detail_id` values touched by this card by joining `job_card_items.work_pool_id → job_work_pool.order_detail_id`. Skip items where `work_pool_id IS NULL` — those are pre-Work-Pool historicals or pool-less manual cards that don't participate in the ready rollup. (Fallback for manual cards handled below.)
2. For each `order_detail_id`:
   - Resolve the product's required section route (from §"Section routing model").
   - For each required section: `SUM(jci.completed_quantity)` across all `job_card_items` whose `(jci.job_card_id JOIN jc.section_id) = section_X` AND whose `jci.work_pool_id JOIN jwp.order_detail_id = this_detail_id`.
   - `new_ready_qty = LEAST(completed qty per required section)` — the item is only ready up to the slowest stage.
   - If `new_ready_qty > order_details.ready_qty`, update `ready_qty = new_ready_qty`.
   - If `ready_qty >= COALESCE(order_details.quantity, 0)` AND `status <> 'cancelled'`, set `status='ready'`.
   - Return the `order_detail_id` if it newly became ready (for the trigger that maintains draft stock receipts to consume).

Multiple lines of the same product on the same order are tracked independently because pool rows are per `order_detail_id`, and the rollup is keyed to `order_detail_id`.

**Fallback for `work_pool_id IS NULL` job cards.** Two cases:
1. Historicals before Work Pool launched — these stay status=`pending`/`in_production` indefinitely unless someone uses the manual receive path. Acceptable; the manual receive path is the safety net.
2. Manual job cards intentionally created outside Work Pool (rare, used for one-off work) — same answer; the manual receive path handles them. UI surfaces a "this card doesn't roll up to ready — use Manual receive when the work is done" hint on the card detail.

Idempotency: the function only ever monotonically increases `ready_qty`. Re-running it for the same card is a no-op.

For internal orders, after the function returns, a trigger on `order_details` `AFTER UPDATE OF ready_qty` checks: if the parent `orders.order_type='internal'`, ensure there's an open `stock_receipts.status='draft'` for the order. If yes, append `stock_receipt_items` for the newly-ready quantities. If no, create a new draft receipt and append items.

**This trigger is the only place that creates draft receipts on the auto path.** Manual receipts (§"Stock check-in flows") go through a separate RPC.

## Stock check-in flows

Three paths to land items in `product_inventory`. All three go through `stock_receipts` so the audit trail is uniform.

### Path A — auto on rollup (happy path)

1. Job card finishes → `complete_job_card_v2()` → `mark_order_details_ready()` flips items to ready → `AFTER UPDATE` trigger appends to (or creates) a draft `stock_receipts` row for the order.
2. On the internal order detail page, a banner appears: "Ready to receive: N items across X products. **Confirm receipt →**".
3. User clicks → modal shows the draft receipt items with editable qty (default = full), an optional notes field, and a **Confirm** button.
4. On confirm: RPC `confirm_stock_receipt(p_stock_receipt_id, p_actor_id)` flips the receipt to `'confirmed'`, writes `received_at=now()`, `received_by=p_actor_id`, then for each `stock_receipt_items` row writes a `product_inventory_transactions` row (`type='receipt'`, `source_reference='stock_receipts:<id>'`), bumps `product_inventory.quantity_on_hand`, and increments `order_details.received_qty`.

### Path B — manual receive (safety net)

For when job cards go wrong, or stock arrives outside the card flow (rework, found-extras).

1. On any internal order, a "Receive manually" button is always available alongside the auto banner.
2. Modal: select items (from the order's lines that still have `quantity > received_qty`), enter quantities, **mandatory notes field** ("Reworked outside the card flow", "Physical count showed 2 extra").
3. On submit: RPC `create_manual_stock_receipt(p_order_id, p_items[], p_notes, p_actor_id)`. Creates a `stock_receipts` row in `'confirmed'` status directly (skips draft), writes children, writes inventory transactions, bumps QOH, increments `received_qty`. Tagged in transactions history with a distinctive chip (`Manual receipt` vs auto `Receipt`).

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

1. On a customer order detail page with at least one item having `ready_qty > delivered_qty`, "Create delivery note" button.
2. Modal: pick items, pick quantities (default = `ready_qty - delivered_qty` per item), optional notes, delivery date (defaults to today). "Generate" button.
3. On submit: RPC `create_unity_delivery_note(p_order_id, p_items[], p_delivery_date, p_notes, p_actor_id)`:
   - Locks the `organizations` row for the org (so concurrent note creation can't race the number).
   - Computes next note number: `max(suffix of note_number) over (org_id) + 1`, floored to `delivery_note_starting_number`. Format with `delivery_note_prefix` and zero-pad to 4 digits.
   - Writes `order_delivery_notes` row with `source='unity'`, `note_number=<computed>`, `status='draft'`, children.
   - Returns the order_delivery_note_id.
4. The UI navigates to `/orders/[orderId]/delivery-notes/[deliveryNoteId]` which renders a printable preview. "Print PDF" → triggers dynamic import of the PDF renderer module + opens the print dialog.
5. PDF layout: org letterhead (from `delivery_note_pdf_letterhead_url`), customer block, order ref, line items (product code, name, quantity), notes section, signature line with name + date, delivery-note number footer.
6. On "Print" confirmation: RPC `mark_delivery_note_printed(p_order_delivery_note_id, p_actor_id)` flips status to `'printed'`.
7. When the customer signs (or staff records the signature): "Mark as signed" → `mark_delivery_note_signed(p_order_delivery_note_id, p_signed_by_text, p_signed_at, p_actor_id)` flips status to `'signed'`, increments `order_details.delivered_qty`, runs the order-auto-close check.

### Path 2 — record Pastel DN

For when Pastel generated the DN, not Unity.

1. On the same order, "Record external delivery" button.
2. Modal: Pastel DN number (text), pick items + quantities, delivery date.
3. On submit: RPC `record_external_delivery_note(p_order_id, p_external_ref, p_items[], p_delivery_date, p_actor_id)`:
   - Writes `order_delivery_notes` row with `source='pastel'`, `external_reference=<Pastel DN>`, `note_number=NULL`, `status='signed'` (assumed signed; Pastel-issued is fact of delivery), children.
   - Increments `delivered_qty` immediately.
   - Runs order-auto-close check.
4. No PDF generation. No print step. The Pastel reference is shown in the order's delivery-notes list as "External (Pastel: <ref>)".

### Constraint enforcement

A DB trigger validates that ∑ `order_delivery_note_items.quantity` per `order_detail_id` across delivery notes where the parent `status IN ('draft','printed','signed')` cannot exceed `order_details.quantity`. Cancelled notes don't count.

### Cancellation

- **Draft or printed Unity note:** "Cancel note" → status flips to `'cancelled'`. `delivered_qty` does NOT change (it only increments at sign time). The note number is burned, not freed — gaps in the sequence are acceptable and preserved for audit.
- **Signed Unity note:** requires admin permission. Status flips to `'cancelled'`, `delivered_qty` decrements by the note's per-item qty, and an audit-log entry records who did it and why (mandatory reason field on cancel for signed notes). Order auto-close is rechecked (and may flip the order back from `'Closed'` to its prior status — the same admin reopen path applies).
- **Pastel note:** same flow as a signed Unity note (admin gate + audit). `delivered_qty` decrements.

## Order auto-close

Implemented as a Postgres function `check_order_completion(p_order_id)` called from delivery-note signing, stock-receipt confirmation, and the manual-receive RPC.

Algorithm:

1. Look up parent order's `order_type`.
2. If `order_type='customer'`: complete = every `order_details.delivered_qty = order_details.quantity` (excluding cancelled items).
3. If `order_type='internal'`: complete = every `order_details.received_qty = order_details.quantity` (excluding cancelled items).
4. If complete, set `orders.status_id = 30` (the existing `Completed` row in `order_statuses` — no new status added; `order_statuses` has no `Closed` value and adding one would proliferate states unnecessarily). Write an order-history event row.
5. Also flips each `order_details.status` from `'ready'` to `'delivered'` (customer) or `'received'` (internal) as appropriate.

Closing locks the order against further delivery notes / stock receipts (the create-RPCs check `orders.status_id` first — reject if = 30). A "Reopen order" admin action exists for corrections, gated by permission; it reverts `status_id` to whatever the order was at before completion.

## Inventory transactions history page

New page at `/inventory/transactions`.

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

- "Create delivery note" + "Record external delivery" buttons on customer order detail when at least one item has `ready_qty > delivered_qty`.
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
- **Phase 1 (schema):** Supabase MCP `get_advisors` shows zero new warnings. Migration applied to live and verified with a cross-org-read smoke (member of org A cannot see org B's rows).
- **Phase 2 (cascade):** RPC unit tests in `tests/db/` covering: cascade on multi-section product, idempotency of `mark_order_details_ready`, single-section fallback, RLS rejection of cross-org calls.
- **Phase 3 (internal CRUD):** Browser smoke creates an internal order, sees it in the list, sees it doesn't appear in the customer filter.
- **Phase 4 (stock check-in):** Browser smoke runs the auto path (complete a job card, see banner, click confirm, see QOH bump) and the manual path (manual receive, see transaction with notes).
- **Phase 5 (delivery notes):** Browser smoke creates a Unity delivery note, generates PDF, marks signed, sees order close. Repeats with a Pastel record path.
- **Phase 6 (transactions page):** Browser smoke loads page with mixed transaction types, filter by type works, click source ref drills correctly, CSV export downloads a non-empty file.
- **Phase 7 (settings):** Change starting number, create a new delivery note, see numbering honour the floor.

Memory rule reminder: do NOT insert synthetic wage data into the live DB. Smokes that touch piecework (Phase 2 if it involves piecework cards) must clean up.

Memory rule reminder: when Codex executes, reviewer (Claude) runs the browser smoke via preview MCP rather than punting to Greg. Check `authorizedFetch` vs plain `fetch` on any new UI hitting `/api/...` routes.

## Phasing (Linear epic shape)

Each phase becomes a sub-issue under the parent epic "Internal Orders & Order Completion" in the Manufacturing project.

| Phase | Title | Output |
|---|---|---|
| 1 | Schema foundation + RLS gap-close | All migrations: `orders.order_type` + `internal_reason` + CHECK, `order_details.status` + counters + cross-table-invariant trigger, `job_cards.section_id`, `products.default_section_route`, `organizations` numbering columns. Create new tables: `product_sections`, `order_delivery_notes` + items, `stock_receipts` + items, `stock_adjustments`. Enable RLS on the three advisor-flagged tables: `jobs`, `manufacturing_sections`, `order_manufacturing_sections`. RLS policies for all new tables (org-scoped via `is_org_member`). Create the `product_inventory_transactions_with_balance` view. Re-run view definitions for `staff_piecework_earnings`, `v_orders_with_customers`, `orders_due_today` after schema changes (view-drift safety). Verify with `get_advisors --type security` — zero new warnings. |
| 2 | Section cascade + ready event | Extend `complete_job_card_v2`, add `mark_order_details_ready`, add the `order_details.AFTER UPDATE` trigger that maintains draft `stock_receipts` for internal orders. Tests. |
| 3 | Internal-order CRUD | Orders page toggle, internal-order create form, list view, suggested replenishment panel. |
| 4 | Stock check-in flows | "Confirm receipt" + "Receive manually" + "Adjust stock" UI + RPCs. |
| 5 | Customer delivery notes | Unity-generated path with PDF, Pastel-recorded path, order auto-close, deliveries list page. |
| 6 | Inventory transactions page | List + filters + saved views + per-product drilldown + chart + CSV export. |
| 7 | Settings additions | Numbering + letterhead upload. |
| 8 | Verification & smoke pass | End-to-end smoke covering both order types, both delivery-note paths, both stock-receipt paths, transactions page coverage. RLS smoke. Advisors check. Sign-off. |

Phases 3–7 can ship as separate PRs back into `codex/integration`; Phases 1, 2, 8 should each be a single PR.

## Risks & open questions

### Risks

- **`complete_job_card_v2()` modification.** This RPC is load-bearing for piecework today. Any error in the cascade fails card completion. Decision: **fail loud** — the cascade runs in the same transaction; if it errors, the card completion rolls back so the operator sees the error rather than a silently half-updated state. Mitigation against false-failures: comprehensive unit tests covering the existing piecework happy path is unaffected (Phase 2), plus the cascade is purely additive logic over read-only joins until the final `UPDATE` statements.
- **Section route ambiguity.** If a product has neither a `product_sections` row nor a `default_section_route`, we treat it as single-section. This is silent-default behaviour that could mask configuration mistakes. Mitigation: warn in the order-creation UI when a line resolves to single-section (one-line "This product has no section routing configured — ready event will fire on the single assembly card").
- **Pastel reconciliation drift.** Operators may forget to record a Pastel DN in Unity, leaving items "ready" indefinitely. Mitigation: surface a "Ready items pending delivery > 7 days" alert on the customer-orders list. Out of scope for v1 but worth filing as a follow-up POL ticket.
- **Order-auto-close race.** Two concurrent confirmations could both think they're the last one. Mitigation: `check_order_completion` runs inside the same transaction as the triggering action; the order's `status_id` update uses an UPDATE...WHERE NOT closed filter; second one is a no-op. Standard.

### Open questions (intentionally deferred to plan-write or implementation)

- Exact placement of "Stock movements" and "Deliveries" inside the sidebar relative to existing inventory items — will be decided by reading the current sidebar structure during plan-write.
- Whether to surface `internal_reason` on the suggested-replenishment auto-fill (pre-fill with "Replenishment 2026-05-25" or similar). Plan-write decision.
- Whether the cross-order `/inventory/deliveries` page is in Phase 5 or split out as a 5b. Plan-write decision.
- Reorder-level batch heuristic for suggested replenishment ("round to next 10" — confirm with operations during Phase 3).

## Out of scope but worth future tickets

- Multi-warehouse / location.
- Real Pastel bidirectional sync.
- Make-to-stock vs make-to-order policy on products (replacement for the dropped `make_strategy` column).
- Customer-returns flow integrated with delivery notes.
- Lot / batch tracking on inventory.
- A "scheduled internal orders" auto-creation cron (e.g. weekly restock runs).
- Approval workflow on internal orders > N units (currently anyone can create any size).
