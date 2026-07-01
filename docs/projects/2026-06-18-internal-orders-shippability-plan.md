# Internal Orders & Order Completion — Shippability Plan

- **Date:** 2026-06-18
- **Author:** Claude Code (local desktop), synthesised from a 13-agent assessment + 5-agent deep-dive
- **Status:** ACTIVE. Re-homed into the repo 2026-07-02 during Wave-1 merge reconciliation (recovered from `stash@{3}`; was never committed). Wave 0 ✅ applied to prod 2026-07-01 (`20260701212905` + `20260701213058`, backfilled as migration files in this merge). Wave 1 in progress on `codex/local-internal-orders-merge`.
- **Spec:** `docs/superpowers/specs/2026-05-25-internal-orders-and-order-completion-design.md` (on branch `codex/local-claude-internal-orders-spec`)
- **Implementation record:** `docs/projects/2026-06-03-internal-orders-implementation.md` (this branch)
- **Impl branch:** `codex/local-internal-orders-impl` @ `7e8869d1` (pushed, clean; 8 ahead / 133 behind `codex/integration` as of the 2026-07-02 merge — was 65 behind when this plan was written)

## 0. The situation in one paragraph

The feature was built straight from the signed-off spec, skipping the plan + Linear steps. The **DB layer (Phases 1A–5, 13 migrations) is already applied to production** (`ttlyfhkrsjjrzxiagzpb`) — all 8 tables, the additive columns, and 9 RPCs verified live. The **UI/feature layer is ~half complete**, the spec's headline "order-level section cascade" was deliberately not built (correctly — see §1), there is a **live unauthenticated RPC surface** on prod (§2), and the branch is **unmerged on a stale base** with a known **FK merge-blocker** (§5). The project currently has a **single org** (`total_orgs = 1`), which bounds every "cross-org" risk to "external unauthenticated party only."

## 1. Cascade decision — RATIFY the per-detail model (do NOT build the cascade)

The spec required an order-level section-completion cascade writing `order_manufacturing_sections.completed_at` (per-detail MIN → cap → SUM-across-details). **Recommendation: ratify the implementer's per-detail model; do not build the cascade.** Overdetermined by:

1. The spec's target tables (`manufacturing_sections`, `order_manufacturing_sections`, `section_details`) are **provably dead** — 0 rows live, never written, referenced only by an RLS shim added to clear advisors.
2. The real model is `factory_sections` (6 live lanes: Steel, Cut & Edge, Assembly, QC, Upholstery, Powder Coating) + the populated per-detail `order_detail_required_sections` snapshot.
3. The per-detail ready engine (`mark_order_details_ready`) **already computes the spec's exact arithmetic** and correctly promotes the order to Ready via `check_order_readiness`.
4. **No UI consumer reads an order-level section value** — a cascade would write a column nothing displays.
5. The "SUM-across-details" scenario occurs in **1 of 7 live orders**, and even there per-detail is the more meaningful answer.

GPT Pro's sign-off is not invalidated — the blessed arithmetic exists; only the anchor table changed.

**Action:** update the signed-off spec to retarget the section model to `factory_sections` and record deviations #1/#7 as accepted, so spec and reality stop diverging.

## 2. Security — Wave 0 hotfix (live DB; Claude direct)

Verified via catalog grants + function bodies + a live HTTP 200 probe with the public anon key:

| RPC | Anon-callable | Real impact |
|---|---|---|
| `check_order_completion` | yes (PUBLIC grant) | **State-gated** — only completes an already-fully-delivered/received order. Cannot fabricate completion. |
| `check_order_readiness` | yes | **State-gated** — only advances an order whose details are all already ready. |
| `snapshot_order_sections` / `_detail_sections` | yes | Insert routing rows; guarded by `EXISTS` (no duplication). |
| `order_detail_allocated_delivery_qty` | yes | Read-only; leaks one delivery-qty integer per detail. |
| `mark_delivery_note_printed` | grant present | Body checks `is_org_member` → anon fails closed. Not exploitable, but grant should be removed. |
| `reopen_order`, `cancel_delivery_note` | **no** (authenticated only) | Missing **admin** gate — any `staff` member can reopen / cancel a signed DN. |

**Severity: Medium.** Real live unauthenticated write/read surface, but: mutators are state-gated (no fabricated state), single tenant (no cross-org dimension today), and only a trivial integer leaks. Not actively-exploited-grade; should be closed promptly.

**Wave-0 migration (small, non-breaking):**
1. `REVOKE EXECUTE … FROM anon, public` on `check_order_completion`, `check_order_readiness`, `snapshot_order_sections`, `snapshot_order_detail_sections`, `mark_delivery_note_printed`, `order_detail_allocated_delivery_qty`. (Safe — they are only `PERFORM`'d inside gated RPCs/triggers, which ignore EXECUTE grants on inner functions.)
2. Add `IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin role required'; END IF;` to `reopen_order` and `cancel_delivery_note` (helper already exists; `organization_members.role` + JWT `app_metadata.role` kept in sync by `app/api/admin/users/[id]/role/route.ts`).
3. **L1 fix:** `check_order_completion` early-returns only on status 30 — add status **31** (cancelled) guard so a cancelled order can't be resurrected to Completed.

**Verify:** `get_advisors(security)` clean for these objects; re-run the anon probe and confirm 401/403; `has_function_privilege('anon', …) = false` on the six functions.

## 3. Lifecycle correctness (DB) — fleet slice "lifecycle"

- **L2 (Medium):** `reopen_order` resets only `orders.status_id`, not detail counters, and there is no internal void-receipt RPC → the next stock op re-completes the order and a received qty can't be corrected. Add a `void_stock_receipt` RPC + reset counters on reopen.
- **L3 (Medium):** `create_manual_stock_receipt` has no over-receive cap (relies on the raw `*_qty_chk`). Add a `received + new <= ordered` guard that errors cleanly.
- **L4 (Medium):** a required section with zero pool operations pins a detail below Ready forever. Treat zero-op sections as non-gating (or emit a diagnostic).
- **L5 (Low, deviation #5):** customer fulfilment (DN sign / `consume_finished_goods`) writes no `product_inventory_transactions` row → ledger/QOH diverge. Emit a consume transaction at reservation-consumption time.
- **Over-completion diagnostic** (spec Phase 2): `record_overcompletion_diagnostic` + UI chip when `completed_for_op > required_qty` — currently silently clamped. Build it.

## 4. Feature-completion punch-list (fleet slices)

**Slice "labels" (P3):** `getOrderStatusLabel` has **zero call sites** — wire it through every status render site (`OrderHeaderStripe`, `app/orders/page.tsx` StatusBadge/InlineStatusDropdown, customer page) so internal orders read "Ready to receive into stock". Add the `source=fallback` route warning badge on the order_detail row.

**Slice "receipts" (P4):** "Manual receipt" chip in the transactions ledger; adjustment **reverse** UI + history list on the product page (RPC `reverse_stock_adjustment` exists, no caller); make confirm-receipt **notes** functional (add `notes` param to `confirm_stock_receipt`, un-`readOnly` the textarea).

**Slice "delivery-notes" (P5):** 23505 retry loop in `issue_unity_delivery_note_number`; reject create-RPCs when `status_id = 30`; add customer + date-range filters to `/inventory/deliveries`; fix letterhead source (read `organizations.delivery_note_pdf_letterhead_url`, not `company_logo_path`); add the `/orders/[orderId]/delivery-notes/[id]` preview route.

**Slice "fg-transactions" (P6, largest):** first-class route `/inventory/products/[productId]/transactions`; per-product QOH line chart; clickable source-ref drilldowns; filter bar (product/type/date/user/source); colour-coded type chips incl. Reversal + Manual receipt; retire `/products?tab=transactions` and reconcile outbound links.

**Slice "settings" (P7):** Documents = real file upload to a per-org storage bucket (currently URL text input only); wire `delivery_note_pdf_letterhead_url` into the delivery-note PDF (currently inert end-to-end — ties to P5 letterhead fix).

**Slice "misc-ui":** manual pool-entry multiplier input (`required_qty_per_finished_good`, default 1, validate > 0) in `JobCardsTab`.

**Frontend house-rules (fold into the slices that touch the files):**
- **F1 (High):** `resolveDeliveryNoteCompanyInfo` uses plain `fetch` to `/api/settings` → `authorizedFetch` (lib/client/auth-fetch).
- **F2 (High):** deliveries list keeps `statusFilter`/`search` in `useState` → move to URL search params (list-state-persistence rule); transactions list `FETCH_CAP=500` client fetch → server-paginate/server-count (client memory budget).
- `@react-pdf/renderer` must stay lazy/dynamically imported (verify `DeliveryNotePDFDocument` importers).

## 5. Merge reconciliation (Claude live-ops; guardrail — needs Greg's go for the integration merge)

**Order: do this BEFORE the fleet builds**, so all slices branch off one current base instead of re-conflicting at the end.

1. Work in `/Users/gregorymaier/developer/unity-erp-internal-orders` (don't disturb main worktree HEAD). `git merge codex/integration` into impl.
2. **FK BLOCKER:** impl's `…1a_order_columns.sql` re-adds `orders_completed_from_status_fk` — the duplicate FK that caused the 2026-06-04 order-embed outage. The drop hotfix (`20260604065824`) is live but on neither impl nor integration (it lives on `codex/local-orders-status-embed-hint-fix`). **Remove the `ADD CONSTRAINT`** (keep the column + `DROP IF EXISTS`); carry the embed-hint code so any replay can't re-add it.
3. Resolve 3 conflicts: `app/orders/page.tsx` (hard — re-layer impl's `order_type` tab/filter onto integration's paginated `fetchOrders`), `app/products/[productId]/page.tsx` (accept both additive blocks), `docs/operations/migration-status.md` (keep both).
4. Change impl's bare `CREATE VIEW product_inventory_transactions_with_balance` → `CREATE OR REPLACE … WITH (security_invoker = true)` for rebuild safety.
5. **Do NOT re-apply any internal-orders migration to live** — all 13 are already recorded on prod under versions `20260603154310–161341`; the FK is already dropped live. Treat live as source of truth; never `db reset` the shared project. Reconcile recorded versions in `migration-status.md`.
6. Verify: `tsc --noEmit`, `npm run lint`, `get_advisors`, browser smoke of `/orders` (both tabs), `/orders/[id]`, `/products/[id]`.

## 6. Execution model

- **Claude direct (live-ops):** Wave-0 security hotfix; Wave-1 merge reconciliation; final integration merge; all `apply_migration` calls.
- **CMUX fleet (`dcx fanout`, one `dcx/<slug>` worktree per slice, spawned with `--ignore-user-config`):** the §3 lifecycle slice and the §4 feature slices. One `dcx wait` per agent (run_in_background) → review each pane on completion → integrate or send fixes.
- Slices touching the same files (orders page, delivery UI, migrations) are sequenced, not run blind-parallel, to avoid re-merge pain.

## 7. Wave sequence

- **Wave 0** (me): security hotfix migration + L1. ✅ **DONE 2026-07-01** — applied to prod as `security_harden_order_lifecycle_rpcs` + `security_revoke_anon_snapshot_trigger_fn`; anon probe now 401; files backfilled into `supabase/migrations/` during Wave 1.
- **Wave 1** (me): merge reconciliation onto current `codex/integration` (FK neutralize + conflicts + view) → verify. **IN PROGRESS 2026-07-02** on `codex/local-internal-orders-merge`. ← integration merge needs Greg's go (guardrail).
- **Wave 2** (fleet): lifecycle slice → label/receipt/delivery/settings/misc slices → fg-transactions slice. Review each.
- **Wave 3** (me): full verification (advisors, tsc/lint, browser smoke of both order types end-to-end, RLS-against-the-view smoke) → hand to Greg to ship.

## 8. Open decisions for Greg

1. **Hotfix timing** (§2) — apply now as a standalone migration (recommended) vs fold into the merge.
2. **Cascade ratify** (§1) — confirm; I'll update the spec accordingly.
3. **Linear** — file the epic + per-area sub-issues to track this (currently `Linear: TBD` in the spec)? Linear MCP needs an OAuth re-auth this session.
4. **Scope confirmation** — you asked for full-spec shippable; §4 P6 (FG transactions redesign) and P7 (file-upload letterhead) are the largest slices. Confirm they're in this pass and not a fast-follow.
