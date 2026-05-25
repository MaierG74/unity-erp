# Review packet — Internal Orders & Order Completion (Round 1)

**For:** GPT-5.5 Pro
**From:** Greg Maier / Claude Code (preflight done, spec filesystem-validated)
**Date:** 2026-05-25
**Trial:** Per [docs/workflow/2026-04-29-trial-gpt-pro-plan-review.md](https://github.com/MaierG74/unity-erp/blob/codex/local-claude-internal-orders-spec/docs/workflow/2026-04-29-trial-gpt-pro-plan-review.md)

---

## 1 · Task summary

Introduce a unified completion model for orders in Unity ERP (Next.js + Supabase ERP for a furniture manufacturer) that:

1. Adds **internal orders** — orders that flow through the same manufacturing pipeline as customer orders but produce finished-goods stock rather than a customer delivery.
2. Adds **customer delivery notes** — the missing closing-the-loop artifact, supporting partial fulfilment and both Unity-generated (PDF) and externally-recorded (Pastel — third-party invoicing system) notes.
3. Activates the half-built `manufacturing_sections` / `order_manufacturing_sections` infrastructure so a "product is ready" event fires when all required sections close for an `order_details` line.
4. Adds an `/inventory/transactions` history page with filters, source-ref links, per-product drilldown, and CSV export.
5. Closes three RLS-disabled ERROR-level advisor findings on tables this work activates.

Out of scope: customer returns flow, multi-warehouse, serial-number tracking, Pastel API sync, replacing the unused `products.make_strategy` column.

## 2 · Current repo context inspected

Preflight was run via Supabase MCP and ripgrep. The findings are baked into §"Background — what exists today" of the spec. Most load-bearing facts:

- **Line-items table is `order_details` (PK `order_detail_id`), not `order_items`** — corrected throughout. Zero `order_items` references in `lib/`, `app/`, `components/`. The brainstorm walkthrough used `order_items` shorthand; the spec uses the real name.
- **`job_card_items` links to `order_details` via `work_pool_id` → `job_work_pool.order_detail_id`** — confirmed by sampling 13 rows (8 with `work_pool_id`, 5 without). The `jobs` table is a global catalog of work types with no `order_detail_id` linkage.
- **`product_inventory_transactions` columns**: `id bigint`, `quantity numeric` (signed delta — not `quantity_delta`), `type product_txn_type`, `occurred_at timestamptz`, `order_id`, `reference text`, `org_id`.
- **`product_txn_type` enum existing values**: `build, ship, return, receive, adjust, consume`. Our mapping uses existing values (no new enum members proposed).
- **No `org_settings` table** — per-org settings on `organizations` directly (matches `week_start_day`, `configurator_defaults jsonb`).
- **`is_org_member(p_org_id uuid)` exists** as STABLE SECURITY DEFINER, `SET search_path TO 'public'`. Already used by `complete_job_card_v2`.
- **Advisor ERROR-level findings on tables this work touches**: `jobs`, `manufacturing_sections`, `order_manufacturing_sections` all have RLS disabled. Phase 1 closes these.
- **Naming collision risk**: `DeliveryNote*` types already exist for supplier-side delivery-note attachments in:
  - `lib/db/purchase-order-attachments.ts`
  - `app/purchasing/quick-upload/page.tsx`
  - `app/purchasing/purchase-orders/[id]/ReceiveItemsModal.tsx`
  - `components/features/purchasing/DeliveryNoteUpload.tsx`
  - `components/features/purchasing/POAttachmentManager.tsx`
  
  → spec uses `order_delivery_notes` table + `OrderDeliveryNote` TS type to avoid collision.

- **`complete_job_card_v2(p_job_card_id integer, p_items jsonb, p_completed_by_user_id uuid, p_completion_date date) RETURNS jsonb`** already enforces `is_org_member(order.org_id)` + payroll-lock guard + duplicate-completion guard + remainder-action validation. Our cascade plugs in at the tail in the same transaction.

- **`products.make_strategy` is NOT NULL DEFAULT 'phantom'** with all 850 rows set to 'phantom' and zero TS consumers. Spec leaves it untouched (dropping would need coordinated migration; not in this scope).

- **Existing FG reservation surface**: `/api/orders/[orderId]/{reserve,release,consume}-fg` + `fg-reservations`. Customer orders already reserve finished stock; this work doesn't change that. Internal-order receipts feed the same `product_inventory` table those reservations read from.

## 3 · Relevant branches and assumed base branch

- **Spec branch:** `codex/local-claude-internal-orders-spec` (pushed)
- **Base for implementation:** `codex/integration` (canonical shared working branch)
- **Spec doc path on GitHub:** [`docs/superpowers/specs/2026-05-25-internal-orders-and-order-completion-design.md`](https://github.com/MaierG74/unity-erp/blob/codex/local-claude-internal-orders-spec/docs/superpowers/specs/2026-05-25-internal-orders-and-order-completion-design.md)
- **Interactive walkthrough (HTML, untracked on disk):** referenced for conceptual orientation only; uses pre-preflight naming in places.

## 4 · Files likely to change (per phase)

The spec phases this work into 8 sub-issues. Approximate file impact:

| Phase | Files (representative, not exhaustive) |
|---|---|
| 1 — Schema + RLS gap-close | New migration files under `supabase/migrations/`. View re-runs for `staff_piecework_earnings`, `v_orders_with_customers`, `orders_due_today`. New TS types in `lib/types/orders.ts`, `lib/types/inventory.ts`. |
| 2 — Section cascade + ready event | New migrations adding `mark_order_details_ready` RPC and the `complete_job_card_v2` extension. Updated `lib/db/job-cards.ts`. Tests under `tests/db/`. |
| 3 — Internal-order CRUD | `app/orders/page.tsx` (segmented toggle), `app/orders/new/page.tsx` (type=internal branch), new `app/orders/new/internal-order-form.tsx`, `app/api/orders/route.ts` POST handler extension. |
| 4 — Stock check-in | `app/api/orders/[orderId]/stock-receipts/route.ts`, `app/api/stock-receipts/[id]/confirm/route.ts`, `app/api/stock-adjustments/route.ts`, components under `components/features/inventory/StockReceipt*.tsx`, `StockAdjustment*.tsx`. |
| 5 — Customer delivery notes | `app/api/orders/[orderId]/delivery-notes/route.ts`, PDF renderer under `components/features/orders/DeliveryNotePDF.tsx` (lazy-imported per project rule), `app/orders/[orderId]/delivery-notes/[deliveryNoteId]/page.tsx`, list page at `app/inventory/deliveries/page.tsx`. |
| 6 — Inventory transactions page | `app/inventory/transactions/page.tsx`, `app/inventory/products/[productId]/transactions/page.tsx`, components for filters / table / chart, `app/api/inventory/transactions/export/route.ts` (CSV). |
| 7 — Settings | `app/admin/settings/numbering/page.tsx` (or wherever existing settings UI lives — plan-write step verifies). |
| 8 — Verification & smoke | No new files; cross-cutting verification PR. |

## 5 · Files / docs consulted

- [CLAUDE.md](https://github.com/MaierG74/unity-erp/blob/codex/local-claude-internal-orders-spec/CLAUDE.md) — multi-tenancy rule, frontend stack versions, verification rules.
- [docs/workflow/2026-04-29-trial-gpt-pro-plan-review.md](https://github.com/MaierG74/unity-erp/blob/codex/local-claude-internal-orders-spec/docs/workflow/2026-04-29-trial-gpt-pro-plan-review.md) — this trial.
- [docs/plans/2026-03-05-work-pool-job-card-issuance.md](https://github.com/MaierG74/unity-erp/blob/codex/local-claude-internal-orders-spec/docs/plans/2026-03-05-work-pool-job-card-issuance.md) — Work Pool + Job Card model this work builds on.
- [docs/superpowers/specs/2026-05-08-order-products-setup-panel-design.md](https://github.com/MaierG74/unity-erp/blob/codex/local-claude-internal-orders-spec/docs/superpowers/specs/2026-05-08-order-products-setup-panel-design.md) — recent spec, used as format template.
- Live schema via `mcp__supabase__execute_sql` for: `information_schema.columns` on all touched tables, `pg_get_functiondef` for `complete_job_card_v2` and `is_org_member`, `pg_views.viewdef` for `staff_piecework_earnings`/`job_work_pool_status`/`v_orders_with_customers`/`orders_due_today`/`factory_floor_status`/`jobs_in_factory`/`inventory_transactions_enriched`/`orders_due_today`, `pg_class.relrowsecurity` for RLS posture, `pg_enum` for `product_txn_type` values, `order_statuses` lookup.
- `mcp__supabase__get_advisors --type security` (238 lints; 3 ERROR-level on tables touched by this work).
- ripgrep across `lib/`, `app/`, `components/`, `types/` for: `order_items` (zero hits), `order_details` (10+ files), `make_strategy` (zero), `order_type|orderType` (zero), `DeliveryNote|delivery_note` (5 hits — all purchasing-side), `StockReceipt|stock_receipt` (zero).

## 6 · Proposed implementation steps

Per the spec §"Phasing (Linear epic shape)" — 8 phases each filed as a Linear sub-issue under a parent epic "Internal Orders & Order Completion" in the Manufacturing project. Each phase ships as a single PR back into `codex/integration` (Phases 3–7 can ship independently; Phases 1, 2, 8 each as one PR).

The spec spells each phase out in detail under §"Phasing". The shape is:

1. **Schema foundation + RLS gap-close** — additive DDL only on existing tables; new tables; enable RLS on 3 advisor-flagged tables; view re-runs; advisors check.
2. **Section cascade + ready event** — `mark_order_details_ready` SECURITY DEFINER function; cascade hook into `complete_job_card_v2`; `order_details AFTER UPDATE OF ready_qty` trigger that maintains draft `stock_receipts` for internal orders.
3. **Internal-order CRUD** — orders page toggle, internal-order create form, list view, suggested replenishment panel.
4. **Stock check-in** — `confirm_stock_receipt`, `create_manual_stock_receipt`, `apply_stock_adjustment` RPCs + UI.
5. **Customer delivery notes** — Unity-generated with PDF, Pastel-recorded path, order auto-close, deliveries list page.
6. **Inventory transactions history page** — list + filters + saved views + per-product drilldown + chart + CSV export.
7. **Settings page** — numbering + letterhead upload.
8. **Verification & smoke pass** — end-to-end smoke, RLS smoke, advisors check.

## 7 · Tenant / RLS considerations

The spec aligns with Unity ERP's existing tenancy posture:

- Every new table (`product_sections`, `order_delivery_notes`, `order_delivery_note_items`, `stock_receipts`, `stock_receipt_items`, `stock_adjustments`) carries `org_id uuid NOT NULL` + RLS policy `is_org_member(org_id)`.
- `manufacturing_sections` is a global lookup (no `org_id` today) — spec adds RLS with `TO authenticated USING (true)` (read-all, no writes). Same for `jobs`. This matches advisor remediation requirements without changing the data model.
- `order_manufacturing_sections` has `order_id` but no direct `org_id` — RLS policy joins through to `orders.org_id`: `USING (EXISTS (SELECT 1 FROM orders o WHERE o.order_id = order_manufacturing_sections.order_id AND public.is_org_member(o.org_id)))`.
- Cross-table invariants that CHECK can't express (e.g. `order_details.delivered_qty > 0 → orders.order_type = 'customer'`) are enforced via triggers reading the parent row, not via FK + CHECK.
- Nested-relation null-safety: any UI shown a Supabase nested select must defensively null-check (memory rule — RLS can make nested objects null).

## 8 · Migration / schema considerations

- All Phase 1 migrations are **additive** — column adds, table creates, RLS enables. No destructive changes (no drops, no type changes on existing columns).
- `products.make_strategy` is preserved despite being unused; dropping it is a coordinated migration out of scope here.
- `complete_job_card_v2` is replaced via `CREATE OR REPLACE FUNCTION`. The cascade tail is additive over the existing body — does not change inputs, return type, or any existing side-effects.
- View re-runs: `staff_piecework_earnings` (reads `job_card_items` — but the new `job_cards.section_id` doesn't appear in this view's select list, so it should compile unchanged; re-run anyway for safety). `v_orders_with_customers` and `orders_due_today` (read `orders` — new `order_type` column is additive; LEFT JOINs against `customers` already null-safe).
- Migration discipline (memory rule): `supabase/migrations/<timestamp>_<name>.sql` + `mcp__supabase__apply_migration` + `mcp__supabase__list_migrations` reconciliation + `docs/operations/migration-status.md` update.
- Numbering sequences (`DN-NNNN`, `SR-NNNN`) are managed by an RPC that locks the `organizations` row (`SELECT ... FOR UPDATE`) — not by Postgres `SEQUENCE` because the starting floor is per-org configurable.
- No DROP / no destructive backfill / no historical-orders touch. Greg's preview-branch policy memory rule (additive DDL safe to apply directly to live) is honoured.

## 9 · Testing and validation plan

Per spec §"Verification" — each phase has its own gate. Cross-cutting:

- **Phase 1:** `mcp__supabase__get_advisors --type security` shows zero new warnings; specifically the three pre-existing ERROR-level RLS gaps on `jobs`, `manufacturing_sections`, `order_manufacturing_sections` are closed. Cross-org-read smoke (member of org A can't see org B's new rows in any new table).
- **Phase 2:** RPC unit tests for `mark_order_details_ready`: cascade on multi-section product, idempotency on re-run, single-section fallback (no `product_sections` row and no `default_section_route`), RLS rejection of cross-org calls, `work_pool_id IS NULL` items don't break the rollup.
- **Phases 3, 4, 5, 6:** browser smoke via Claude Code preview MCP (memory rule: reviewer runs smoke when executor can't). Specifically check `authorizedFetch` vs plain `fetch` on any new UI hitting `/api/...` routes (memory rule from POL-101 smoke fallback).
- **Phase 5 only:** smoke covers both Unity-generated path (PDF generation + sign) and Pastel-recorded path (paste external ref + sign). Verify order auto-close fires for each.
- **Phase 8:** end-to-end. Customer-order full lifecycle (new → in_production → ready → delivered via DN → Completed). Internal-order full lifecycle (new → in_production → ready → received via SR → Completed). Adjustments + reversals appear in transactions page. Both DN paths work.
- `npm run lint` + `npx tsc --noEmit` clean on every PR.
- No synthetic wage data in live DB (memory rule). Tests touching piecework rows must clean up in the same response.
- View-drift check after Phase 1: query each re-run view shape and confirm it still returns rows.

## 10 · Risks and edge cases

Captured in spec §"Risks & open questions". Top-line:

- **`complete_job_card_v2` modification** — load-bearing for piecework. Decision: fail loud (cascade runs in same txn; errors roll back the card completion). Mitigation: tests covering existing happy path is unaffected.
- **Section-route ambiguity** — products with no `product_sections` row and no `default_section_route` treated as single-section silently. Mitigation: warn in the order-creation UI.
- **`work_pool_id IS NULL` job_card_items** — ~38% of current rows. Documented fallback: these don't roll up to ready; manual receive is the safety net.
- **Pastel reconciliation drift** — operators may forget to record Pastel DNs in Unity, leaving items "ready" indefinitely. Out of scope for v1 — future POL ticket for "Ready > 7d" alert.
- **Order-auto-close race** — two concurrent confirmations could both think they're the last one. Mitigation: `check_order_completion` UPDATE uses `WHERE status_id <> 30` filter; second call is a no-op.
- **PDF generator** — `@react-pdf/renderer` must be lazy-imported (project memory rule — causes build timeouts otherwise).
- **Cross-table invariants via trigger** — `order_details.delivered_qty > 0 → orders.order_type = 'customer'` requires reading parent row from a trigger. Slightly slower than CHECK; acceptable. Standard.

## 11 · Questions or uncertainties (deferred to plan-write)

Explicitly flagged in spec §"Open questions (intentionally deferred to plan-write or implementation)":

- Exact placement of "Stock movements" and "Deliveries" inside sidebar relative to existing inventory items — verify against current sidebar structure during plan-write.
- Whether `internal_reason` is pre-filled on suggested-replenishment auto-fill ("Replenishment 2026-05-25" or similar).
- Whether `/inventory/deliveries` cross-order page is in Phase 5 or split as 5b.
- Reorder-level batch heuristic for suggested replenishment ("round to next 10") — confirm with operations during Phase 3.

## 12 · Specific things I'd like you to review

These are where I'd most value GPT Pro's eye, in priority order:

1. **Cross-layer name collisions and surface-area gaps.** Per the first-spec trial finding (the `cutlist_snapshot` TS-property-vs-DB-column shadowing in POL-83 round 1), I want a second pass that goes beyond DB-schema and grep — anywhere in this spec where the *concept* I'm naming or the *behaviour* I'm proposing could shadow or conflict with existing code I haven't inspected. The spec calls out the `DeliveryNote` purchasing collision I found; what else might I have missed?

2. **The `mark_order_details_ready` algorithm correctness** in §"The 'ready' event" — does the rollup using `LEAST(per-section completed_qty)` keyed on `work_pool_id → job_work_pool.order_detail_id` actually compute the right number under all the edge cases?
   - Pool rows with NULL `order_detail_id` (the table allows this — `source='manual'` rows).
   - Multiple pool rows per `(order_id, order_detail_id, product_id)` because qty was split across pool entries (preflight sampled this for order 401: two pool rows for `order_detail_id=49, product=828, required=40` each).
   - Pool rows in `status='cancelled'` (does my rollup correctly exclude them? Spec doesn't say — gap).
   - What happens if `product_sections` for a product is empty and `default_section_route` is also empty AND there's a job card with a `section_id` populated? Should that section_id "count" as a route?

3. **The cross-table-invariant trigger** (`order_details.delivered_qty > 0 → orders.order_type = 'customer'`). Does the proposed shape (`BEFORE UPDATE` trigger on `order_details` reading parent `orders.order_type`) handle the case where the order_type itself is updated to a value that would invalidate an existing counter? Or do I also need an `orders.order_type` UPDATE-blocker trigger?

4. **The auto-draft `stock_receipts` trigger** (§"The 'ready' event" / §"Path A — auto on rollup"). The flow is: `complete_job_card_v2` → `mark_order_details_ready` → `order_details.ready_qty` UPDATE → AFTER UPDATE trigger → INSERT/APPEND into `stock_receipts`. Is there a re-entrancy / recursion / lock-ordering concern with that chain when the same RPC completes a card that touches multiple order_details? Should the trigger be `AFTER UPDATE OF ready_qty FOR EACH ROW DEFERRABLE INITIALLY DEFERRED` or just `AFTER UPDATE FOR EACH ROW`?

5. **Numbering RPC race-safety.** §"Path 1 — Unity-generated" says "Locks the `organizations` row" before computing the next note number. Is `SELECT … FROM organizations WHERE id = ? FOR UPDATE` followed by an INSERT into `order_delivery_notes` with the computed number truly race-safe under concurrent calls? Or do I need a partial-unique index + retry-on-23505 pattern instead?

6. **View drift on `staff_piecework_earnings`** — does adding `job_cards.section_id` actually leave the view untouched, or does the `SELECT … FROM job_cards jc JOIN job_card_items jci …` get expanded by Postgres to include all columns? My read says no (view is explicit-column-list), but worth a verify.

7. **Numerical types.** I've used `numeric(12,3)` for `order_delivery_note_items.quantity` and `stock_receipt_items.quantity` because `product_inventory.quantity_on_hand` is `numeric` and partial-cupboard quantities feel wrong. But `order_details.quantity` is `integer NULLABLE`. Is there a coherence problem if a customer orders 100 (int) and we deliver 25.5 on a note (numeric(12,3))? Probably I should make the delivery/receipt qty integer to match. Worth your view.

8. **Anything about the phasing** — would you split, merge, or reorder?

9. **Spec quality issues** — placeholders, contradictions, ambiguities I missed in self-review.

Severity-grouped findings would be ideal (BLOCKER / MAJOR / MINOR / NIT), as per the trial template.

---

**The spec to review:**
[`docs/superpowers/specs/2026-05-25-internal-orders-and-order-completion-design.md`](https://github.com/MaierG74/unity-erp/blob/codex/local-claude-internal-orders-spec/docs/superpowers/specs/2026-05-25-internal-orders-and-order-completion-design.md) on branch `codex/local-claude-internal-orders-spec`.

Also see the interactive walkthrough at `public/internal-orders-design.html` (in the same branch) for the conceptual model — uses some pre-preflight naming, the spec itself is authoritative.
