# Internal Orders & Order Completion — Implementation Record

- **Date:** 2026-06-03
- **By:** Claude Code (local desktop), single session, executed against the signed-off spec
  [docs/superpowers/specs/2026-05-25-internal-orders-and-order-completion-design.md](../superpowers/specs/2026-05-25-internal-orders-and-order-completion-design.md).
- **Branch:** `codex/local-internal-orders-impl` (off `origin/codex/integration`).
- **DB:** all migrations applied to Unity **production** (`ttlyfhkrsjjrzxiagzpb`). See
  [docs/operations/migration-status.md](../operations/migration-status.md) for the per-migration log + server versions.

## What shipped

**DB (all applied to prod, validated end-to-end via rollback-only smokes — zero persisted rows):**

- **Phase 1A** — `product_sections`, `order_detail_required_sections`, `order_status_events`,
  `order_delivery_notes(+items)`, `stock_receipts(+items)`, `stock_adjustments` (org-scoped RLS +
  cross-org consistency triggers); `orders.order_type/internal_reason/completed_from_status_id`;
  `order_details.status/ready_qty/delivered_qty/received_qty`; `organizations` numbering columns +
  letterhead; `product_inventory_transactions_with_balance` view (`security_invoker`); RLS enabled on
  `jobs`/`manufacturing_sections`/`order_manufacturing_sections` (closes the 3 ERROR advisors).
- **Phase 1B** — `job_work_pool.section_id` + `required_qty_per_finished_good`; BEFORE INSERT
  derive trigger; `job_cards.section_id`; `issue_job_card_from_pool` + `complete_job_card_v2` copy
  section onto cards; 21 existing pool rows backfilled.
- **Phase 2** — `mark_order_details_ready` (finished-good-normalised per-section MIN), cascade tail in
  `complete_job_card_v2`, auto-draft `stock_receipts` trigger, `check_order_readiness` (→ Ready For
  Delivery), in-production trigger, single-writer `order_status_events` audit.
- **Phase 3 (DB)** — `snapshot_order_detail_sections` + AFTER INSERT trigger (route resolution:
  `product_sections` → BOL-derived → Assembly fallback).
- **Phase 4 (DB)** — `confirm_stock_receipt` (partial-confirm residual re-draft),
  `create_manual_stock_receipt`, `apply_stock_adjustment` + `reverse_stock_adjustment`.
- **Phase 5 (DB)** — `check_order_completion` (→ Completed), `reopen_order`, Unity + Pastel
  delivery-note RPCs, DN allocation guard, allocated-qty helper.

**UI (tsc `--noEmit` clean + eslint 0 errors on all new/touched files):**

- Data layer `lib/db/internalOrders.ts`; status adapter `lib/orders/status-label.ts`.
- Orders page Customer|Internal toggle (`?type=`, URL-persisted), New Internal Order button,
  `ReplenishmentPanel`, section pills hidden for internal; `InternalOrderCreateForm` + `/orders/new-internal`.
- Order detail: `ReadyToReceiveBanner` (internal) + Delivery Notes tab (customer) via `SmartButtonsRow`.
- Stock check-in modals: Confirm receipt, Manual receive, Adjust stock; `ProductSectionRouteEditor` +
  Adjust-stock on the product page.
- Delivery notes: `DeliveryNotesTab`, Create / Record-Pastel modals, lazy `@react-pdf/renderer` DN doc;
  cross-order `/inventory/deliveries` list.
- `/inventory/transactions` (running balance, URL filters, type chips, quick-view pills, CSV export);
  sidebar Stock Movements + Deliveries; `/settings/numbering`.

## Lifecycle L2-L4 slice (2026-07-02)

- **L2:** Added file-only migration `20260702120000_internal_orders_lifecycle_l2_l4.sql` with
  `void_stock_receipt(receipt_id, reason)` for admin-only reversal of confirmed internal stock receipts
  (negative `build` ledger row, QOH decrement, `received_qty` decrement, status `voided`). `reopen_order`
  now keeps counters intact and recomputes detail statuses from those counters.
- **L3:** `create_manual_stock_receipt` now rejects over-receipts before insert/update work with the clear
  outstanding-quantity error instead of falling through to the counter CHECK constraint.
- **L4 + diagnostics:** `mark_order_details_ready` treats required sections with zero matching pool
  operations as non-gating, and records idempotent per-detail/section diagnostics for both zero-op sections
  and over-completed operations. Order product rows show a small amber diagnostic chip when diagnostics
  exist for that detail.
- **Deviations:** SQL was authored as a migration file only and was not applied or smoke-tested locally,
  per the single-production-DB guardrail.

## Receipts P4 slice (2026-07-02)

- `confirm_stock_receipt` now accepts appended `p_notes text DEFAULT NULL` and appends confirmation notes
  to the receipt while keeping existing positional callers compatible.
- `stock_receipts.source` records `draft_confirm` vs `manual`; manual receipt RPC writes `manual`, and both
  global/product transaction ledgers join receipt rows to show a deterministic "Manual receipt" chip.
- Product detail finished-goods inventory now shows recent `stock_adjustments` for the product and exposes an
  admin-visible Reverse action backed by the existing `reverse_stock_adjustment` RPC.

## Deviations from the signed-off spec (and why)

1. **Section model = `factory_sections`, NOT `manufacturing_sections`.** Live verification: the spec's
   `manufacturing_sections` / `order_manufacturing_sections` / `section_details` tables are EMPTY with
   ZERO code/view/function references — a dead, abandoned design. The real operator-facing section model
   is `factory_sections` (6 lanes, routed from `job_categories`). Greg chose `factory_sections`. All
   `section_id` FKs target it. (RLS still enabled on the dead tables to clear advisors.)
2. **`section_id` is NULLABLE; NO NOT-NULL enforcement.** Live data has job categories (e.g. "Woodworking
   Finishing", cat 16) that map to NO `factory_section`. Forcing NOT NULL would break job-card issuance —
   the exact failure the spec's round-1 reviewer flagged. Unmapped rows simply don't roll up to ready.
3. **Pool section derivation is a DB trigger, not per-insert-path edits.** BOL pool rows are generated
   CLIENT-SIDE (`JobCardsTab.tsx`), not via an RPC. A BEFORE INSERT trigger on `job_work_pool` derives
   `section_id` + `required_qty_per_finished_good` for every insert path at once (`job→category→
   COALESCE(parent,self)→factory_sections`; `cutting_plan`→Cut&Edge; multiplier from `billoflabour.quantity`).
4. **`job_work_pool.source` includes `cutting_plan`** (11 of 21 live rows), which the spec assumed was only
   `bol|manual`. Cutting-plan rows have NULL `order_detail_id` → correctly excluded from per-detail ready
   rollup (spec-consistent); their `section_id` defaults to Cut & Edge for display.
5. **`consume_finished_goods` writes NO `product_inventory_transactions` row.** The spec assumed it already
   writes a `ship`/`consume` row, so DN-sign must not double-write. Verified: it writes nothing (only
   decrements QOH + deletes reservations). DN-sign correctly writes no ledger row. **Known pre-existing gap:
   FG-reservation fulfilment is not reflected in the transactions ledger** — out of scope here; candidate
   for a follow-up so the transactions page reconciles with QOH for reservation-consumed products.
6. **Section route default is BOL-derived**, not a hand-maintained `products.default_section_route` array
   (which was therefore not added). Resolution: `product_sections` override → distinct `factory_sections`
   of the product's BOL operations → Assembly fallback. Works out-of-the-box for existing products.
7. **Order-level section-completion cascade not built.** The spec wrote `order_manufacturing_sections.completed_at`;
   that table is dead. The load-bearing per-detail ready rollup IS built (with correct per-detail logic).
   Order-level section progress can be computed on demand in the UI later. (The round-4 MAJOR fix concerned
   that order-level cascade specifically; it is moot under this model.)
8. **No historical backfill** of existing open orders into the section/ready model (spec non-goal). Only
   order_details created after this lands get a route snapshot (via the AFTER INSERT trigger) and thus
   participate in ready/completion. `snapshot_order_sections(order_id)` exists for an optional manual backfill.

## Verification performed

- `get_advisors` (security): 3 target ERROR gaps closed; 8 new tables RLS-on; `_with_balance` view not a
  security-definer view; new functions' search_path pinned. No new ERRORs.
- Cross-org guard smoke (rollback): stock-receipt-on-customer rejected, wrong-org DN rejected, correct-org DN
  allowed, cross-order DN item rejected.
- Ready engine smoke (rollback): multiplier-2 partial → ready 7; full → ready 10 + status ready + order RFD +
  draft receipt 10; idempotent re-run stays 10; **regression: no-snapshot completion unaffected**; E2E internal
  completion through `complete_job_card_v2`.
- Full E2E smoke (rollback): internal partial-confirm → residual re-draft → full → Completed + 2 `build` txns +
  QOH bump; customer ready → RFD → DN-0001 → print → sign (delivered, Completed, 0 inventory txns) → cancel
  signed → reopen to RFD.
- UI: `npx tsc --noEmit` and `npx eslint` clean on every new + touched file.

## Follow-ups (not blocking)

- **Browser smoke** of the UI flows with the dev server + test login (auth-gated; not run this session).
- **status-label adapter** (`getOrderStatusLabel`) wired into the delivery/receive surfaces; the full
  audit of every `status_name` render site (orders list status dropdown, `OrderHeaderStripe`, `StatusBadge`,
  customer page) should be routed through it so internal orders show "Ready to receive into stock" everywhere.
  Interim-acceptable per spec (underlying state is correct).
- Consider logging FG-reservation consumption to `product_inventory_transactions` (deviation #5) so the
  transactions ledger fully reconciles with QOH.
- `factory_sections` / `section_details` / `section_statuses` RLS still disabled (pre-existing; out of this
  scope) — close in a tenancy follow-up.
- Optional historical backfill of open orders via `snapshot_order_sections`.
