# Internal Orders & Order Completion — End-to-End Completeness Audit

**Date:** 2026-07-02
**Scope:** `codex/local-internal-orders-audit` = `codex/integration` `e8daaa7f` + three reviewed-but-unmerged slices (lifecycle L2-L4 `20260702120000`, receipts P4 `20260702130000`, delivery-notes P5 `20260702140000`). Live prod (`ttlyfhkrsjjrzxiagzpb`) is source of truth for Phases 1A-5 + Wave-0.
**Method:** Seven adversarial audit dimensions (state-machine, security/RLS, UI completeness, concurrency/idempotency, ledger/costing, spec parity, integration touchpoints), each finding independently re-verified against code (`file:line`) and read-only prod SELECTs before inclusion. Severities below are post-verification (several were corrected in both directions).

---

## 1. Executive Verdict

**The happy path is sound end-to-end.** Create internal order → section snapshot → pool → job cards → `mark_order_details_ready` → auto-draft receipt → confirm → QOH + `build` ledger → auto-complete works, and the customer flow (RFD → DN create/print/sign → complete, with cancel/unwind) works. The three slice migrations are replay-safe and the implementation record is accurate — no false claims found in the impl doc.

**The feature is not shippable as-is.** The failure modes are concentrated at the *edges* of the state machine — corrections, cancellations, line edits, and concurrent writes — where guards that exist on one path were not mirrored onto its siblings:

**Must land before ship (blocker + high):**

1. **F1 (blocker)** — `confirm_stock_receipt` can double-receive: no outstanding-quantity guard and stale drafts are never trimmed after a manual receipt. This defect is **live on prod today** (Phase-4 body), not just in the unmerged P4 slice.
2. **Status-guard symmetry (F2, F9)** — receipt confirm/manual-receive and DN sign/print have no status-30/31 guard; P5 added it only to DN *creation*. Pre-cancel drafts remain fully actionable on cancelled orders.
3. **Lifecycle re-evaluation (F11, F12)** — order-line quantity edits/deletes/adds never re-run `check_order_completion`/`check_order_readiness`, and the raw status dropdown offers Completed/Cancelled to everyone, bypassing `reopen_order` entirely.
4. **DN quantity fidelity (F8)** — the delivery-note UI hardcodes `ready_qty = ordered quantity`, so a full-order DN for zero-produced goods is the one-click default.
5. **Inventory-writer correctness (F14, F15)** — every internal-orders QOH writer does a multi-row `UPDATE product_inventory` (one typed Location in Add FG away from compounding corruption; one writer already live), and the Add FG route bumps QOH with no ledger row, permanently falsifying the new running-balance view.
6. **Ready-engine integrity (F3, F4)** — concurrent job-card completions can regress `ready_qty`, and a mid-work `transfer_assignment` drops `work_pool_id`, permanently breaking readiness for that operation.
7. **Security (F13)** — `issue_stock_receipt_number` still has anon/PUBLIC EXECUTE, the exact twin of the DN-number hole P5 fixed.
8. **Release ops (F17)** — apply the three slice migrations *before* code deploy (Confirm Receipt hard-breaks otherwise) and record them in `migration-status.md`.

**Nice-to-have / fast-follow:** correction-lever UI (void/reopen — currently unreachable, medium), receipts history, internal-order UX gaps (reason display, ready/received columns), draft re-arm after void, diagnostics for unmapped-section ops, concurrency hardening (advisory locks), grants tightening, and the minors in §3.

---

## 2. Confirmed Findings (adversarially verified)

### 2.1 Internal-order flow (create → ready → receipt → completion)

---

#### F1 — `confirm_stock_receipt` has no outstanding-quantity guard and stale drafts are never trimmed: manual-receive + draft-confirm double-receives — **BLOCKER**

- **Evidence:** `supabase/migrations/20260702130000_internal_orders_receipts_p4.sql:52-90` — the confirm loop validates only `v_confirm <= stock_receipt_items.quantity` (`:60`), then increments `order_details.received_qty` unconditionally (`:73-77`) with no read of ordered/received and no `FOR UPDATE` on `order_details`. **The identical gap exists in the LIVE Phase-4 baseline** (`20260603130100_internal_orders_4_stock_checkin_rpcs.sql:21-57`), so prod is exposed today. `maintain_draft_stock_receipt` only reacts to `ready_qty` *increases* (`20260603120000_internal_orders_2_ready_engine.sql:187-188`); nothing trims draft `stock_receipt_items` when `received_qty` rises via `create_manual_stock_receipt` or after a void. UI keeps the stale draft armed: `components/features/inventory/ReadyToReceiveBanner.tsx:41` shows the banner whenever a draft with items exists (no outstanding check, rendered for internal orders regardless of status incl. 30 — `app/orders/[orderId]/page.tsx:1363-1377`); `ConfirmReceiptModal.tsx:55-65` pre-fills the full stale quantity. `check_order_completion` early-returns at status 30 (`20260603130200:14`), so nothing flags it.
- **Scenario:** Line ordered 10, all ready → draft SR-0001 qty 10. Storeman A uses Manual Receive for 10 (L3 guard passes: 0+10 ≤ 10); line received, order auto-completes. Banner still shows "Ready to receive: 10 items". Storeman B clicks Confirm → `received_qty=20` on a 10-qty line, +10 phantom QOH, two `build` ledger rows for one production run. The concurrent variant is identical (confirm takes no `order_details` lock, so manual's `FOR UPDATE` cannot detect it). Silent — the completion check no-ops.
- **Smallest fix:** In confirm's item loop, `SELECT quantity, received_qty FROM order_details WHERE ... FOR UPDATE` and RAISE/clamp when `received_qty + v_confirm > quantity`; trim/delete draft `stock_receipt_items` for a detail whenever `received_qty` rises (in `create_manual_stock_receipt` and `void_stock_receipt`). **Must also patch the live Phase-4 function, not just the P4 slice.**
- **Owner:** new slice **receipts-integrity** (see punch-list #1).

---

#### F2 — `confirm_stock_receipt` / `create_manual_stock_receipt` have no cancelled/completed-order guard (asymmetric with P5's DN-create guards) — **HIGH**

- **Evidence:** confirm validates only existence/org/draft — no `orders.status_id` check — in both the unmerged P4 body (`20260702130000:44-50`) and the live body (`20260603130100:15-19`); manual receipt checks org/type/over-receive only (`20260702130000:131-137`, `20260702120000:186-192`). Contrast P5, which blocks DN creation on 30/31 (`20260702140000_internal_orders_delivery_p5.sql:47-48,93-94`). `ReadyToReceiveBanner` is gated only on `order_type` (`app/orders/[orderId]/page.tsx:1363`), so Confirm and "Receive manually" stay clickable on a cancelled order. Wave-0's `check_order_completion` returns early on 31 (`20260701212905:25`), so the received quantities are stranded in a state no screen explains.
- **Scenario:** Internal order cancelled at status 31 while a 5-unit draft exists. Storeman still sees the banner and confirms: QOH rises, a `build` ledger row is written, `received_qty` rises — against a cancelled order that stays at 31. Aggravator: on a status-30 order completed via manual receive with an armed draft, confirming double-counts inventory (same root as F1).
- **Smallest fix:** Read `orders.status_id` in the initial lookup of both RPCs; RAISE on 31 (and 30 for confirm), mirroring the P5 wording. Hide/disable the banner actions client-side on 30/31.
- **Owner:** new slice **lifecycle-guards**.

---

#### F3 — `mark_order_details_ready` is not monotonic under concurrent job-card completions: a lower `ready_qty` can overwrite a higher committed one — **HIGH**

- **Evidence:** `20260702120000_internal_orders_lifecycle_l2_l4.sql:404-421` (same in live `20260603120000:139-155`) — `old_ready` is read in the loop SELECT without `FOR UPDATE`, the monotonic check `IF v_new > rec.old_ready` runs in plpgsql, and the UPDATE's WHERE has no `ready_qty` qual, so under READ COMMITTED a stale lower value overwrites the committed higher one (both via EvalPlanQual after a lock wait and via plain snapshot staleness with no blocking at all). `complete_job_card_v2` locks only its own job-card row (`20260603120100:34`), never `order_details` or `job_work_pool`; each transaction's completed-quantity SUM excludes the other's uncommitted `job_card_items`, so both compute partial totals.
- **Scenario:** Two workers' cards feed the same line (base 0). A completes +3 and commits; B computed `v_new=2` from its snapshot and writes `ready_qty=2` — regressing the committed 3, under the true 5. `maintain_draft_stock_receipt` sees delta −1 and skips → draft stays at 3 while `ready_qty` says 2 (drift); if these were the last cards the order silently stalls short of Ready/receipt with no recompute path.
- **Smallest fix:** At the top of `mark_order_details_ready`, `PERFORM 1 FROM order_details WHERE order_detail_id IN (touched) ORDER BY order_detail_id FOR UPDATE` (serialises tails so the fresh statement snapshot sees the other's committed items); belt-and-braces `AND ready_qty < v_new` in the UPDATE's WHERE.
- **Owner:** new slice **ready-engine-hardening**.

---

#### F4 — Mid-work `transfer_assignment` drops `work_pool_id` on the remainder card, permanently breaking the readiness chain for that operation — **HIGH**

- **Evidence:** Prod `pg_proc`: both `transfer_assignment` overloads (CASE B mid-work split) insert remainder `job_card_items` without `work_pool_id`/`section_id`, and neither calls `complete_job_card_v2`/`mark_order_details_ready` when force-completing the old card. Live UI path: `hooks/use-job-actions.ts:115` (transfer dialog, `components/factory-floor/transfer-job-dialog.tsx`, explicitly supports mid-work splits). The readiness tail gates on `jci.work_pool_id IS NOT NULL` (`20260702120000:366-370`), and `work_pool_id` is written only by `issue_job_card_from_pool`.
- **Scenario:** 10-unit line; staff A completes 4, supervisor transfers to staff B. A's card is force-completed without the tail firing; B's card items have no `work_pool_id`. B finishes 6 and completes normally — the tail finds zero pool-linked items and no-ops. `ready_qty` is stuck at ≤4, the draft receipt never fills, the internal order never auto-completes (customer orders never reach RFD). Silent; only workaround is an L3 manual receipt.
- **Smallest fix:** Copy `work_pool_id` (and `section_id` on the new card) in the item-copy loop of both overloads; `PERFORM public.mark_order_details_ready(v_job_card_id)` after completing the old card.
- **Owner:** **ready-engine-hardening**.

---

#### F5 — The L2 correction levers are unusable end-to-end: `void_stock_receipt` and `reopen_order` have zero UI callers, and no receipts surface exists to host them — **MEDIUM**

- **Evidence:** `rg` across all `.ts/.tsx`: `void_stock_receipt` appears only in `20260702120000:38` (no lib wrapper, no component); `lib/db/internalOrders.ts:235` defines `reopenOrder` with zero callers; `fetchStockReceipts` (`lib/db/internalOrders.ts:119`) also has zero consumers, so confirmed/voided receipts are visible nowhere and there is no place a Void button could live; `StockReceiptStatus` (`lib/db/internalOrders.ts:8`) still lacks `'voided'`. `reverse_stock_adjustment`'s wrapper (`:163`) is similarly uncalled. The plan's L2 (`docs/projects/2026-06-18-internal-orders-shippability-plan.md` §3, line 52) explicitly justified these RPCs as the fix for "a received qty can't be corrected" — the DB half shipped without its UI half. Only reachable reopen is `cancel_delivery_note`'s auto-reopen (customer orders, signed DNs only).
- **Scenario:** Storeman confirms a wrong-but-in-bounds receipt (goods damaged/miscounted/premature); order auto-completes. The documented correction (void → auto-reopen) cannot be performed anywhere in the app — the admin must run SQL/RPC by hand. Note: the "fat-finger 100 instead of 10" variant is blocked server-side (see Refuted §4.3); the surviving scenario is in-bounds wrong confirms.
- **Smallest fix:** `voidStockReceipt()` wrapper + `'voided'` in `StockReceiptStatus`; a Receipts card on the internal-order detail page listing `fetchStockReceipts` output (status chips, notes, source, received_by) hosting an admin-gated Void action; an admin Reopen action on status-30 orders calling the existing `reopenOrder`.
- **Owner:** new slice **corrections-ui**.

---

#### F6 — Pool ops with NULL section (unmapped job category) have no diagnostic kind: the amber chip never fires for the one readiness blind spot already proven to exist in prod — **MEDIUM**

- **Evidence:** Derive trigger leaves `section_id` NULL for unmapped categories (`20260603110000_internal_orders_1b_pool_section_source.sql:43-60`, documented at `:11-14`). L4 excludes NULL-section ops from the readiness op CTE (`20260702120000:384`) **and** from both diagnostics CTEs (`:317`, `:344`); the snapshot can never contain the unmapped section (`20260603130000:30-36`). Live prod rows hit the shape today: pool 51 (order 592) and pool 68 (order 610), job "Drill Grommits", category "Woodworking Finishing", `section_id` NULL.
- **Scenario:** New internal order for a product mixing mapped Assembly jobs + an unmapped "Drill Grommits" job. Snapshot = {Assembly}; the grommit op derives section NULL. Assembly completes → detail ready, receipt confirmable, order completes — while the grommits are still open in the Work Pool, and **no amber chip fires** because there is no diagnostic kind for NULL-section ops. Important framing: the non-gating semantics themselves are the ratified Phase-1B design (see Refuted §4.4) — the defect is strictly that the new L4 diagnostics pass, built precisely to surface readiness blind spots, omits this known-in-prod case.
- **Smallest fix:** Add an `unmapped_section_op` diagnostic kind in the guarded diagnostics block of `mark_order_details_ready` (surfaces on the existing chip), and/or map "Woodworking Finishing" to a `factory_section` in prod data before ship.
- **Owner:** **ready-engine-hardening**.

---

#### F7 — `order_details.status='cancelled'` has no writer anywhere, and line deletion is FK-blocked with a raw 500 once receipt/DN items exist — **MEDIUM**

- **Evidence:** The state is declared (`20260603100100_internal_orders_1a_order_columns.sql:46`) and excluded by every readiness/completion query, but repo-wide grep finds zero writers (prod: `count(*)=0`); no `cancel_order_detail` RPC or UI action exists (PO lines have cancel-line; order lines don't). Deletion is blocked by `ORDER_DETAIL_HAS_ISSUED_JOB_CARDS` with `can_clear_generated_work=false` (`lib/orders/order-detail-delete-guard.ts:102-112`) and, even without work, by plain NO ACTION FKs from `stock_receipt_items.order_detail_id` (`20260603100000:140`) and `order_delivery_note_items.order_detail_id` (`:102`), which surface as a raw 23503 500 (`app/api/order-details/[detailId]/route.ts:845-853` — only the pool-clear step maps to 409).
- **Scenario:** 10 ordered, ops stops at 6 received. The line can't be cancelled (no action exists) and can't be deleted (job-card work + receipt-item FK). Workaround exists — the line editor permits trimming quantity down to `received_qty` (`route.ts:495,519`; the counters CHECK blocks going below), after which a subsequent event completes the order properly — hence medium, not high. A work-free line with receipt/DN items deleted from the UI still hits the raw FK 500.
- **Smallest fix:** Ship a `cancel_order_detail` RPC (sets `status='cancelled'`, zeroes the line's draft-receipt items, cancels its pool entries, calls the readiness/completion checks); add `stock_receipt_items`/`order_delivery_note_items` to the delete preflight so the FK error becomes a clean 409.
- **Owner:** **lifecycle-guards** (RPC) + **corrections-ui** (action).

---

### 2.2 Customer / delivery-note flow

---

#### F8 — Delivery-note quantity caps use ordered qty, not real `ready_qty` — the UI hardcodes `ready_qty = quantity` and pre-fills a full-order DN — **HIGH**

- **Evidence:** `components/features/orders/delivery/DeliveryNotesTab.tsx:155-165` builds `DeliveryOrderDetail` with `ready_qty: row.quantity` (comment admits "no separate production-ready view exists yet"); `fetchOrderDetailRows` (`:85-103`) never selects `ready_qty`/`delivered_qty`; preview page same (`app/orders/[orderId]/delivery-notes/[deliveryNoteId]/page.tsx:82`). `CreateDeliveryNoteModal.tsx:151-153` caps at `ready_qty − allocated`, degenerating to ordered − allocated — and the dialog **pre-selects every line and pre-fills the full quantity on open** (`:175-192`). No server backstop: the item trigger guards only vs ordered (`20260603130200:98`), `mark_delivery_note_signed` increments `delivered_qty` unconditionally, and P5 contains zero "ready" checks. Meanwhile `mark_order_details_ready` **does** maintain `ready_qty` for customer orders (order-type agnostic; verified live via `pg_get_functiondef` and `20260702120000:280-425`) — the UI contradicts a real maintained column. Prod: 11 customer details with `ready_qty < quantity`, 0 with `ready_qty > 0`.
- **Scenario:** Order for 50 chairs, 0 produced. Dispatch opens Create Delivery Note; every line reads "Available to deliver: 50". Generate + sign → `delivered_qty=50 > ready_qty=0`, `check_order_completion` sets status 30. Order Completed with nothing manufactured, behind a false availability figure. Recoverable via admin `cancel_delivery_note`, hence high not blocker.
- **Smallest fix:** Select `ready_qty`/`delivered_qty` in `fetchOrderDetailRows` and the preview fetch and pass real values. **Load-bearing nuance:** a strict ready-cap would zero availability for all 11 existing prod customer details and for lines with no pool-op linkage (the ready engine requires `gating_section_count > 0`) — a legacy/stock-delivery fallback (warning + override) is required, not optional.
- **Owner:** **lifecycle-guards** (or a small **dn-fidelity** sub-slice).

---

#### F9 — `mark_delivery_note_signed` / `mark_delivery_note_printed` have no cancelled/completed-order guard: a pre-cancel draft DN can be signed after the order is cancelled — **HIGH**

- **Evidence:** P5 added 30/31 guards only to the two *create* RPCs (`20260702140000:47-48,93-94`) despite its header claiming "closed-order guards"; sign/print check only org membership and note status (`20260603130200_internal_orders_5_completion_and_delivery_rpcs.sql:141-176`); no later migration redefines them (Wave-0 `20260701212905` only revokes anon EXECUTE on printed). `DeliveryNotesTab` receives only `orderId`+`orderType`; the sign button is gated only on note status (`DeliveryNotesTab.tsx:201,336`). Order cancel is a bare `orders.status_id` UPDATE (`lib/queries/order-queries.ts:238-243`) with no DN cascade, so pre-cancel drafts persist as signable.
- **Scenario:** Draft DN for 8 chairs exists; order set to 31 via the dropdown. Clerk marks the note signed from the printed paperwork: `delivered_qty` recorded against a cancelled order (even on cancelled details), goods leave the building; `check_order_completion` no-ops on 31 so the order silently stays Cancelled with delivered lines. If later un-cancelled, the phantom `delivered_qty` can auto-complete it.
- **Smallest fix:** Mirror the P5 30/31 status check into `mark_delivery_note_signed` (and `mark_delivery_note_printed`) after locking the note. (Auto-cancelling DNs on order cancel would touch the ratified no-cascade decision — the guard alone is the correct minimal fix.)
- **Owner:** **lifecycle-guards**.

---

#### F10 — `record_external_delivery_note` TOCTOU on the allocation trigger: worst committed outcome is a stuck over-allocated unity draft, not over-delivery — **LOW**

- **Evidence:** `record_external_delivery_note` takes only `FOR SHARE` on orders and no per-detail lock (`20260702140000:79-115`); `enforce_dn_item_allocation` SUMs only committed siblings (`20260603130200:91-108`); the unity path's org `FOR UPDATE` never serialises against the external path. **However** `order_details_qty_counters_chk` (`20260603100100:48-53`, verified live) aborts any transaction that would push `delivered_qty` past ordered — the second concurrent full-quantity recording fails loudly on the CHECK (see Refuted §4.1). The only concurrency-only committed bad state is external vs unity-*draft* over-allocation (drafts don't increment `delivered_qty`): signing the draft later fails on the CHECK, leaving a stuck draft that `cancel_delivery_note` cleans up.
- **Scenario:** Two clerks record overlapping externals while a unity draft exists → one clean success, one raw CHECK error or a stuck draft. Papercut, ms-scale window, single org.
- **Smallest fix (cheap hardening):** `PERFORM 1 FROM order_details WHERE order_detail_id IN (payload) ORDER BY order_detail_id FOR UPDATE` at the top of `record_external_delivery_note` (and defensively in `create_unity_delivery_note` before item inserts) — converts the ugly CHECK failure into the trigger's clean message.
- **Owner:** **ready-engine-hardening** (fold into the lock-ordering work).

---

### 2.3 Shared / lifecycle infrastructure

---

#### F11 — Order-line mutations (quantity edit, add line, delete line) never re-run `check_order_readiness` / `check_order_completion` — orders get stuck open or stay wrongly Completed — **HIGH**

- **Evidence:** PATCH accepts quantity changes with no lifecycle recompute (`app/api/order-details/[detailId]/route.ts:495,598-608`); DELETE likewise (`:845-860`); the add-products route has no status-30 guard. Zero call sites of either check in app/lib/components. Live prod `pg_trigger` on `order_details` (read-only SELECT) shows only surcharge/total/view-refresh/draft-maintenance(UPDATE OF ready_qty)/snapshot(INSERT)/counter-type triggers — nothing status-reactive on quantity/insert/delete. The checks fire only from receipt/DN RPCs (`20260603130100:76,120`; `20260603130200:173,201`), and `check_order_completion` early-returns at status 30.
- **Scenario:** (a) Line qty 10, received 6; ops trims to 6 (the natural trim — the counters CHECK blocks going lower). `received_qty = quantity` but no event ever fires again → order stays In Production; the only escape is the raw dropdown, which skips `completed_from_status_id` and detail statuses. (b) Reverse: completed order, Greg raises a line 10→12 or adds a line — order silently remains Completed with outstanding units; for customer orders the new units are then *undeliverable* (`create_unity_delivery_note` rejects status 30) until an admin reopen.
- **Smallest fix:** Call `check_order_completion(order_id)` (+ `check_order_readiness`) after quantity PATCH and detail DELETE in the API route — or better, a statement trigger on `order_details` covering future write paths; block or explicitly reopen when lines are added/raised on a status-30 order.
- **Owner:** **lifecycle-guards**.

---

#### F12 — The raw status dropdown offers Completed/Cancelled to any org member, bypassing `reopen_order` and silently producing wrong state — **HIGH**

- **Evidence:** `OrderHeaderStripe.tsx:106-133` renders an unfiltered status dropdown (`fetchOrderStatuses`, unfiltered — `app/orders/[orderId]/page.tsx:863-872`; the orders-list `InlineStatusDropdown` same, `app/orders/page.tsx:944-963,1910-1913`); `handleStatusChange` → `updateOrderStatus` (`lib/queries/order-queries.ts:238-244`), a raw client-side `orders.status_id` UPDATE. Live RLS (`orders_update_org_member`) permits it for any active member; the only triggers on `orders` are logging-only. `reopen_order` (`20260702120000:135-176`) — admin gate, `completed_from_status_id` restore + clear, detail-status recompute — is what the dropdown skips (and has no UI caller, F5).
- **Scenario:** User "reopens" a Completed internal order via the dropdown → status flips but details remain `received` with `received_qty=quantity` and `completed_from_status_id` stays stale; the next receipt/DN event instantly re-completes it. Conversely anyone can hand-set status 30 with zero stock received, or 31 with live work (F16). Nothing is admin-gated.
- **Smallest fix:** Filter/guard statuses 30 and 31 out of both raw dropdowns (completion only via `check_order_completion`; reopen via an admin-gated button calling `reopenOrder`; cancel via a dedicated action). Pairs with F5's UI work.
- **Owner:** **lifecycle-guards** + **corrections-ui**.

---

#### F13 — `issue_stock_receipt_number` has live anon/PUBLIC EXECUTE — the un-fixed twin of the delivery-note-number hole P5 closed — **HIGH (security)**

- **Evidence:** Live `pg_proc.proacl` for `public.issue_stock_receipt_number(uuid)` = `{=X/postgres,postgres=X,anon=X,authenticated=X,service_role=X}`; `prosecdef=true`; body runs `SELECT ... FROM public.organizations WHERE id=p_org_id FOR UPDATE` (`20260603120000:6-23`). Zero `REVOKE` anywhere in migrations (incl. the three slices); Wave-0 revoked six other helpers but not this one; P5 fixed the identical sibling `issue_unity_delivery_note_number` (`20260702140000:116-117`) with the comment "must not be unauthenticated-callable". All real call sites are inside other SECURITY DEFINER functions executing as owner, so the revoke breaks no legitimate caller.
- **Scenario:** Unauthenticated attacker with the public anon key POSTs `/rest/v1/rpc/issue_stock_receipt_number` with the org UUID (not a secret): RLS bypassed, next SR-#### leaked (business volume disclosure), repeatable write locks on the organizations row — the exact posture the team already ruled a defect for the DN issuer.
- **Smallest fix:** `REVOKE EXECUTE ON FUNCTION public.issue_stock_receipt_number(uuid) FROM anon, PUBLIC; GRANT EXECUTE ... TO authenticated;` — fold into a slice migration or apply as live-ops with the P4/P5 applies.
- **Owner:** new **security-grants** live-ops item.

---

#### F14 — Multi-row `product_inventory` (per-location) makes every internal-orders QOH writer multiply stock: the UPDATEs hit all rows per product — **HIGH**

- **Evidence:** `confirm_stock_receipt` and `create_manual_stock_receipt` (`20260702130000:68-72,194-198`), `void_stock_receipt` (`20260702120000:85-93`), and `apply_stock_adjustment` (`20260603130100:140-144` — **already live on prod**) all do `UPDATE product_inventory SET quantity_on_hand = quantity_on_hand + N WHERE product_id = X AND org_id = Y` — unqualified multi-row updates. Live catalog: **no unique constraint on `(org_id, product_id)`** (only the PK). Multi-row-per-product is user-reachable today: the Add Stock form exposes an optional Location input (`app/products/[productId]/page.tsx:853`), `app/api/products/[productId]/add-fg/route.ts:91-133` inserts a NEW row per distinct location, and live `consume_finished_goods`/`auto_consume_on_add` iterate per-location rows targeting single `product_inventory_id`s — the rest of the system honors the multi-row model; these writers don't. Currently 0 multi-row products in prod, so the defect is latent with no existing corruption.
- **Scenario:** Storeman types "Rack A" into Add Stock for product P (2nd row created). Every subsequent receipt/void/adjustment for P applies its delta to **both** rows while writing one ledger entry — QOH rises 2× the ledger, compounds on every transaction, and a later void doubles the damage in reverse. Silent forever.
- **Smallest fix:** Target one row: `AND location IS NULL`-style single-row targeting + a partial unique index on `(org_id, product_id) WHERE location IS NULL`, using `INSERT ... ON CONFLICT` instead of UPDATE-then-INSERT (also closes the concurrent-insert duplicate-row race). Apply to all four writers, including the live `apply_stock_adjustment`.
- **Owner:** **receipts-integrity**.

---

#### F15 — Add FG mutates QOH with no `product_inventory_transactions` row — the new running-balance ledger lies after first use — **HIGH**

- **Evidence:** `app/api/products/[productId]/add-fg/route.ts:109-133` updates/inserts `product_inventory.quantity_on_hand` directly with zero ledger insert (live UI: `app/products/[productId]/page.tsx:499`). Live `pg_get_functiondef`: `auto_consume_on_add` (invoked from this same route when `fg_auto_consume_on_add` is set) also decrements QOH with no ledger row — and is **not** covered by planned item 5's wording (DN sign / `consume_finished_goods`). Live cross-check of all QOH writers: only the receipt/adjustment RPCs (+ pending void) write ledger rows. No trigger on `product_inventory` exists (live `pg_trigger` = []), so nothing ever repairs the gap. The reconciliation surface ships with this feature: `product_inventory_transactions_with_balance` (Phase 1A, live) + `StockMovementsView` render `running_balance`.
- **Scenario:** Operator books 20 units via Add FG. QOH = 20; Stock Movements and the product transactions tab show no movement and `running_balance` 0. The flagship "ledger reconciles with QOH" promise is silently false for that product from then on, permanently.
- **Smallest fix:** Have the route insert the ledger row alongside the QOH write (or add a `location` param to `apply_stock_adjustment` and route through it — as-is it would drop location targeting, see F14); have `auto_consume_on_add` insert a `consume` ledger row (`product_txn_type` already has the value). The `consume_finished_goods` half stays with planned item 5.
- **Owner:** **receipts-integrity**.

---

#### F16 — Order cancel (status 31) residue: pre-cancel work stays actionable — *headline cascade is ratified out of scope (planned item 7); this is the uncovered residue only* — **MEDIUM**

- **Evidence:** The only path to 31 is the bare client UPDATE (`app/orders/page.tsx:1910-1913`); no trigger cascades on 31 (live `pg_trigger`: only `auto_release_component_reservations` is status-reactive); `maintain_draft_stock_receipt` checks only `order_type` (`20260603120000:190-192`); `issue_job_card_from_pool` guards only the pool entry's own status; `JobCardsTab` on the order page has no status gate. **Mitigations verified:** the labor-planning scheduler filters cancelled orders entirely (`lib/queries/laborPlanning.ts:70,126-129` — no *new* cards issued), Wave-0 makes completion a no-op on 31, and P5 blocks new DN creation on 31.
- **Scenario (residue):** Job cards issued *before* cancel can still be completed, raising `ready_qty` and growing/re-opening a draft receipt on the cancelled order; that draft is confirmable (F2), a pre-cancel draft DN is signable (F9), and the order page's pool-issuance UI is not disabled. All visible on-screen (Cancelled badge) and reversible via admin paths — hence medium.
- **Smallest fix:** F2 + F9 close the confirm/sign legs; additionally disable pool-issuance/JobCardsTab actions on cancelled orders. Do **not** build the order-level cascade — ratified decision.
- **Owner:** **lifecycle-guards**. `already_planned` (item 7) for the cascade headline; residue guards are new.

---

#### F17 — UI hard-depends on the 3 unapplied slice migrations; `migration-status.md` has no pending-apply entries — **MEDIUM (release hygiene)**

- **Evidence:** `lib/db/internalOrders.ts:129-137` always passes `p_notes`; live prod `confirm_stock_receipt` is 3-arg (no `p_notes`, verified via `pg_proc`); `stock_receipts.source` and `order_detail_section_diagnostics` absent; no `void_stock_receipt` in prod. `20260702130000` drops the 3-arg overload and creates the 4-arg. `docs/operations/migration-status.md` ends at `20260701221529` with zero mention of the three `20260702*` files, despite in-doc precedent for tracking staged-not-applied migrations, and its Pre-Deploy checklist shows stale all-checked boxes. Note: migrate-then-deploy *is* the documented flow (plan §6-§7 assigns `apply_migration` to Claude live-ops before ship), so this is loud-failure release hygiene, not silent corruption — hence medium.
- **Scenario:** Code merges/deploys before the applies: Confirm Receipt dies with PGRST202 (core receive flow down until the DB catches up); manual-receipt chips and diagnostics silently degrade (error-guarded lookups).
- **Smallest fix:** Apply `20260702120000`, `130000`, `140000` via Supabase MCP **before** code deploy; verify confirm is 4-arg and `stock_receipts.source` exists; add the three entries (and the pending state) to `migration-status.md`.
- **Owner:** **release-ops** checklist.

---

## 3. Unverified Minors Worth a Look

Plausible, evidence-anchored, but not adversarially re-verified. Deduplicated (draft-regen-after-void and the duplicate-version item each appeared 2-3 times across dimensions).

| # | Area | Issue | Sev | Evidence anchor | Suggested owner |
|---|------|-------|-----|-----------------|-----------------|
| M1 | Receipts interplay | Manual receipt never trims the auto-draft → later confirm of a stale draft fails with raw 23514 (`order_details_qty_counters_chk`), or partial-confirm spawns a permanently-unconfirmable residual draft haunting the banner. Same root as F1 — fix together. | med | `20260702130000:60-79,169-205`; `20260603120000:186-210`; `ConfirmReceiptModal.tsx:56-63` | receipts-integrity |
| M2 | Void | `void_stock_receipt` never re-arms the draft (`maintain_draft_stock_receipt` fires only on `ready_qty` increase); re-receive is possible only via Manual Receive, stamping `source='manual'` on a normal flow. | med | `20260603120000:187-188,215-217`; `20260702120000:76-120`; `ReadyToReceiveBanner.tsx:101-105` | receipts-integrity |
| M3 | Reopen | `reopen_order` has no status-30 precondition (called on an open order it rewrites status from stale restore data); the de-facto dropdown "reopen" leaves `completed_from_status_id` stale and detail statuses unrecomputed. | med | `20260702120000:141-172`; `app/orders/page.tsx:1910-1913` | lifecycle-guards |
| M4 | Ready engine | Job-card cancel/reopen after completion never lowers `ready_qty` or trims the draft (monotonic by design, no compensating path) — QC-reopen leaves an inflated confirmable draft. | med | `20260702120000:413-418`; `app/staff/job-cards/[id]/page.tsx:278,372` | ready-engine-hardening |
| M5 | Concurrency | Lock-order inversion family: confirm/void go receipts→details while the completion cascade goes details→orders(FOR SHARE)→receipts; plus FOR SHARE→exclusive upgrade cycles at `check_order_completion`/`reopen_order`. 40P01 kills a job-card completion under load. Fix: per-order `pg_advisory_xact_lock` in all seven order-mutating RPCs + `ORDER BY order_detail_id` in every multi-row loop. | med | `20260702130000:47,73-77`; `20260603120000:190-194`; `20260603100200:34` | ready-engine-hardening |
| M6 | Concurrency | Auto-reopen/completion decisions read `orders.status_id` unlocked — a cancel-signed-DN racing a signing transaction can strand an order Completed with an undelivered line (or skip the reopen). Fixed for free by M5's advisory lock. | med | `20260702120000:115-120`; `20260701212905:22-24,109-112` | ready-engine-hardening |
| M7 | Security | Actor-spoofing: all lifecycle RPCs accept `p_actor` and record `COALESCE(p_actor, auth.uid())` — attribution (not authorization) is forgeable by any authenticated caller. App always passes null. | med | `20260702130000:41,128,170,227`; `20260603130200:46,121,209`; `lib/db/internalOrders.ts:132…236` | security-grants |
| M8 | Security | `check_order_completion`, `check_order_readiness`, `snapshot_order_sections`, `snapshot_order_detail_sections`, `order_detail_allocated_delivery_qty` are SECURITY DEFINER, GRANTed to authenticated, with no `is_org_member` gate — latent cross-tenant write once a second org exists (violates the tenancy house rule; benign at total_orgs=1). | med | `20260701212905:14-50`; `20260603130000:67-77`; `20260603130200:108-115`; live proacl | security-grants |
| M9 | Security | Ledger/receipt tables directly writable (UPDATE/DELETE) by any org member via PostgREST — the audit ledger is not append-only and the receipt state machine is not table-enforced. | med | `20260603100000:170-186`; live grants/policies | security-grants |
| M10 | Security | `apply_stock_adjustment`/`reverse_stock_adjustment` have no admin gate — any staff member can arbitrarily rewrite QOH — asymmetric with void/cancel/reopen. Decide + document, or gate. | low | `20260603130100:125-173` | security-grants |
| M11 | Void | Void (and adjustment reversal) can drive `quantity_on_hand` negative with no guard or warning (even INSERTs a fresh negative row); no CHECK on the column. | med | `20260702120000:85-93`; `20260603130100:167-171` | receipts-integrity |
| M12 | UI | No per-line Ready/Received progress or required-sections view on the order page; `fetchOrderDetailRequiredSections` (`lib/db/internalOrders.ts:276`) is dead code. Also the natural home for the planned source=fallback badge (item 1). | med | `ProductsTableRow.tsx`; rg `ready_qty` in orders UI = 0 render sites | corrections-ui / labels |
| M13 | UI | `internal_reason` is written once and displayed nowhere (list shows Customer "N/A"; header shows a customer picker instead). | med | `InternalOrderCreateForm.tsx:142`; `app/orders/page.tsx:2487-2489` | corrections-ui |
| M14 | UI | Customer picker renders on internal orders; selecting one always fails with the raw `orders_type_customer_reason_chk` violation toast. | med | `OrderHeaderStripe.tsx:150-193`; `page.tsx:494-499`; `20260603100100:20-22` | corrections-ui |
| M15 | UI | Printing an existing DN from the list/preview never calls `mark_delivery_note_printed` — only the post-create modal does; 'draft' stops meaning "never left the office". | low | `DeliveryNotesTab.tsx:175-186`; preview `page.tsx:119-131`; `CreateDeliveryNoteModal.tsx:274` | corrections-ui |
| M16 | UI | DN sign/cancel don't invalidate the `['order', orderId]` query — header shows a stale status after the server completes/reopens the order. | low | `DeliveryNotesTab.tsx:170-173` | corrections-ui |
| M17 | UI | `ConfirmReceiptModal` has no client-side max — over-typed quantities fail server-side with a raw error (ManualReceiveModal has the full pattern). | low | `ConfirmReceiptModal.tsx:164-178` | receipts-integrity |
| M18 | Plan F2 | Global `/inventory/transactions` still client-fetches `FETCH_CAP=500` with client-side filtering — plan §4 marks F2 **High**; the deliveries half was done, this half was not, and P6 as scoped doesn't cover it. | med | `StockMovementsView.tsx:91,243,318+`; plan `:74`; contrast `app/inventory/deliveries/page.tsx:109-162` | fg-transactions-P6 (extend scope) |
| M19 | L4 semantics | A detail whose required sections ALL have zero pool ops (`gating_section_count=0`) is skipped entirely — `ready_qty` can never rise; order can never auto-complete (chip does fire; manual receipt is the workaround). Decide the all-zero-op semantics explicitly. | med | `20260702120000:400-410` | ready-engine-hardening |
| M20 | Diagnostics | Diagnostics rows are insert-once (`ON CONFLICT DO NOTHING`, no delete path) — the amber chip can never clear even after the condition is fixed; operators will learn to ignore it. | low | `20260702120000:16-17,329,358`; `page.tsx:241-249` | ready-engine-hardening |
| M21 | Cutlist | Cut & Edge can never gate readiness: cutting-plan pool rows carry no `order_detail_id` (prod: 11/11 NULL), Cut & Edge has `category_id` NULL (never in a snapshot), and `complete_piecework_assignment` bypasses the readiness tail entirely. An order can complete with the cutting plan 20% cut, no chip. Decide + document, or add an unfinished-cutting-plan warning on confirm. | med | `lib/piecework/cuttingPlanWorkPool.ts:18-29,182-193`; impl doc `:84-86`; prod prosrc | ready-engine-hardening (decision) |
| M22 | Multipliers | BOL re-generate/stale-sync updates `required_qty` but never `required_qty_per_finished_good` (derive trigger is BEFORE INSERT only) — after a BOL qty edit the normaliser reads sections complete at half the work (or never complete). | med | `JobCardsTab.tsx:1535,1543-1556`; `20260603110000:35-40,65-68` | ready-engine-hardening |
| M23 | Multipliers | `product_bom_links` scale is baked into pool `required_qty` but not the multiplier — linked sub-product details go ready at 1/scale of the work. Latent (prod: 0 link rows) but the UI ships the feature. | med | `lib/labor/order-effective-bol.ts:102`; `20260603110000:35-37` | ready-engine-hardening |
| M24 | **Planned item 4 mis-scope** | The planned misc-ui multiplier input is insufficient: manual pool rows are inserted with `order_detail_id: null` (`JobCardsTab.tsx:1378-1390`), so they can never gate or advance readiness regardless of multiplier. The dialog also needs an optional order-line picker; keep detail-less rows explicitly non-gating. | med | `JobCardsTab.tsx:1378-1390`; `20260702120000:369-382`; grain index `20260603110000:99-101` | **misc-ui (extend scope)** |
| M25 | Agents/assistant | `compute_customer_order_shortfalls` (Sam), the assistant order tools, and dashboard counters have zero `order_type` awareness — internal orders present as customer orders with blank customers. | low | prod prosrc; `lib/assistant/operational.ts:660-690`; `DashboardStats.tsx:29-33` | new small slice or fold into labels |
| M26 | Completion paths | Legacy `complete_assignment_with_card` v1 remains executable (no readiness tail, no repo callers) — a stale bundle/script reproduces the F4 stuck-order state. Drop, revoke, or add the tail. | low | prod pg_proc; `complete-job-dialog.tsx:176` | ready-engine-hardening |
| M27 | Migrations | Second exact duplicate version beyond the known pair: `20260618120000` (absence_report_calendar vs cutlist_same_board_finished_qty) — not on the known-issues list; plus 60+ date-only version clusters. | low | `supabase/migrations/` listing | release-ops |
| M28 | Migrations | Prod has `20260702084544 cash_po_detection_escalation` applied live with no source file in this tree (lives on the cash-supplier branch) — backfill/reconcile at release; our three files sort after it, so apply order is safe. | low | live `schema_migrations`; migrations folder | release-ops |
| M29 | Lifecycle polish | Per-line `delivered` status only authored at whole-order completion (asymmetric with the immediate per-line `received` flip); events log misses INSERT-time status and NULL-clears; void ledger rows render as green "Build" chips (`:void` suffix parsed away); `fg_auto_consume_on_add` fires only on Add FG, never on receipt confirm; FG `build` ledger is quantity-only (no valuation) and the bypass of POL-69 WAC is undocumented in the plan. | low | `20260603130200:169-171`; `20260603120000:32,45-48`; `StockMovementsView.tsx:97,139-150`; `20260702130000`; plan doc grep | assorted / docs |
| M30 | Concurrency | `snapshot_order_sections` re-derive has an EXISTS-guard TOCTOU → raw 23505 toast on a double-fire; state correct, retry no-op. `ON CONFLICT DO NOTHING`. | low | `20260603130000:15,53-57,67-77` | ready-engine-hardening |

---

## 4. Refuted Claims (do not re-report)

1. **"Concurrent external DN recordings drive `delivered_qty` to 2× ordered / phantom Completed"** — refuted: `order_details_qty_counters_chk` (`20260603100100:48-53`, verified live) aborts the second transaction's whole write after the row-lock wait; delivered can never exceed ordered. Only residue is a stuck over-allocated unity *draft* (F10, low).
2. **"Cancelling an order leaves the scheduler issuing new job cards"** — refuted: labor planning filters cancelled orders out entirely (`lib/queries/laborPlanning.ts:70,126-129`); only *pre-issued* cards remain completable (F16 residue).
3. **"Storeman fat-fingers 100 instead of 10 on confirm"** — refuted: `confirm_stock_receipt` rejects any qty above the draft item quantity (`20260702130000:60-62`); quantities can only be reduced. The void-UI gap (F5) survives via wrong-but-in-bounds confirms.
4. **"L4 turned the unmapped-section deadlock into silent premature readiness"** — refuted: pre-L4 behavior was identical (NULL-section ops fell out at the `sec` join in `20260603120000:106-141`); the non-gating semantics for unmapped rows are the ratified, documented Phase-1B design (`20260603110000:11-14`; impl doc `:77-79`). Only the diagnostics omission survives (F6).
5. **"The live NULL-section pool rows (orders 592/610) can hit premature readiness today"** — refuted: those details have no section snapshot (pre-Phase-3 orders; backfill deliberately not run), so `mark_order_details_ready` skips them entirely; both are also customer orders.
6. **"Nothing in the tree sequences the slice-migration apply"** — refuted: plan §6-§7 explicitly assigns all `apply_migration` calls to Claude live-ops with Wave-3 verification before ship; pending is the expected state of unmerged slices. The `migration-status.md` entry gap survives (F17, medium).
7. **"A trimmed line leaves the order stuck open *forever* / hand-completed state is corrupting"** — partially refuted: the counters CHECK blocks trims below `received_qty`, manual dropdown + admin paths recover, and `reopen_order` coalesces a NULL `completed_from_status_id` to 28. The silent non-recompute itself stands (F11, high).
8. **"No-cascade-on-cancel is a new high-severity finding"** — the cascade's absence is the ratified planned item 7; only the narrow guard residue is reportable (F16, medium).

---

## 5. Coverage Appendix — flows walked per dimension

**State-machine:** create → snapshot trigger (all three sources) → pool → issuance → `complete_job_card_v2` tail → ready engine (L4 gating/diagnostics) → draft maintenance → confirm (full/partial/zero-line/residual) → manual receipt on every order status → void → reopen (Wave-0 vs L2 bodies, restore precedence) → completion; customer RFD → DN create (unity 23505 retry / external) → allocation trigger → print → sign → cancel (draft/signed, auto-reopen); cancel-31 authorship + non-interactions; `status='cancelled'` writer hunt (repo grep + prod: 0 rows); line PATCH/DELETE/add vs recompute (live trigger catalog on orders/order_details); event-log coverage; wrapper-vs-callsite wiring audit; prod SELECT verification (status ids, zero internal orders/receipts yet, `void_stock_receipt` absent live).

**Security/RLS:** proacl sweep of all ~26 feature functions + `is_org_member`/`is_admin` vs every REVOKE/GRANT in all migrations incl. slices; RLS posture of all 8 feature tables + diagnostics table + running-balance view (`security_invoker` confirmed); SECURITY DEFINER body inspection for org gates (present in all mutating RPCs; missing in 5 helpers); admin-gate audit on destructive transitions; actor-spoofing trace; `search_path` pinning verified; trigger-function reachability (Wave-0 revokes confirmed live).

**UI completeness:** new-internal create form → detail page → ReadyToReceiveBanner/Confirm/Manual modals → deliveries list → DN tab/modals/preview route → `/inventory/transactions` + product transactions tab → `/settings/numbering`; dead-RPC sweep (all RPCs have UI callers except `void_stock_receipt`, `reopenOrder`; `getOrderStatusLabel` and `fetchOrderDetailRequiredSections` dead).

**Concurrency/idempotency:** every pairwise interleaving on receipts (confirm×confirm, confirm×trigger, trigger×trigger, manual×manual/confirm), ready-engine monotonicity sequential vs concurrent, DN pairings (external×external, external×unity, unity×unity, sign-after-complete), full lock-ordering graph across all RPCs/triggers, numbering serialisation, snapshot TOCTOU, UI double-submit audit (all buttons pending-disabled), GUC set/reset leakage (none), prod overshoot probes (all zero).

**Ledger/costing:** all six live `product_inventory` writers classified for ledger coverage via `pg_get_functiondef` scan; ready→draft→confirm→ledger→completion; manual/void/adjust/reverse; Add FG + auto-consume + consume-fg; running-balance view consumers; POL-69 component WAC vs FG quantity-only ledger; `pending_stock_issuances` non-collision; live reconciliation SELECTs (0 txn rows — clean slate); table grants/policies on ledger tables.

**Spec parity:** plan §3 L2/L3/L4/L5 line-by-line vs the slice migrations (incl. the documented reopen counters-kept deviation — judged sufficient); §4 P4/P5 bullet-by-bullet (notes end-to-end, manual chip, 23505 retry, 30/31 create guards, deliveries pagination, letterhead read, preview route, DN-number revoke); P3/P6/P7/misc-ui confirmed still open (planned items 1-4); F1 done / F2 half-done; replay-safety of all three slice files (pass); version-uniqueness scan; live migration history cross-check; impl-record accuracy (no false claims).

**Integration touchpoints:** every job-completion path in prod `pg_proc` checked for the readiness tail (v2 paths have it; v1, piecework, transfer do not); section derivation for all three pool sources + prod `factory_sections` mapping audit; cutting-plan pipeline; multiplier normalisation vs BOL regen and phantom links; Sam/assistant/dashboard order surfaces; customer-DN guards; migration replay hygiene.

---

## 6. Punch-List (ordered, actionable)

### Must land before ship

| # | Item | Findings | Slice |
|---|------|----------|-------|
| 1 | Outstanding-quantity guard + `FOR UPDATE` on `order_details` in `confirm_stock_receipt` (patch **live** Phase-4 fn *and* P4 slice); trim draft `stock_receipt_items` whenever `received_qty` rises (manual receipt, void); void re-arms draft capped at `ready_qty − received_qty`; client max in ConfirmReceiptModal | F1, M1, M2, M17 | **new: receipts-integrity** |
| 2 | Single-row `product_inventory` targeting (`location IS NULL` + partial unique index + `ON CONFLICT`) in all four QOH writers incl. live `apply_stock_adjustment`; negative-QOH guard/warning in void/reverse | F14, M11 | receipts-integrity |
| 3 | Ledger row on Add FG (and `consume` row in `auto_consume_on_add`) | F15 | receipts-integrity |
| 4 | Status-30/31 guards: `confirm_stock_receipt`, `create_manual_stock_receipt`, `mark_delivery_note_signed`, `mark_delivery_note_printed`; hide banner/DN-sign actions client-side on closed orders; disable pool issuance on cancelled orders | F2, F9, F16 | **new: lifecycle-guards** |
| 5 | Re-run `check_order_completion`/`check_order_readiness` after line PATCH/DELETE (statement trigger preferred); guard/reopen on add/raise against status-30 orders | F11 | lifecycle-guards |
| 6 | Remove statuses 30/31 from both raw status dropdowns (`OrderHeaderStripe`, `InlineStatusDropdown`); status-30 precondition in `reopen_order`; clear `completed_from_status_id` when status leaves 30 by any writer | F12, M3 | lifecycle-guards |
| 7 | Real `ready_qty`/`delivered_qty` in DN fetches + availability caps, with the legacy/stock-delivery fallback + warning override (load-bearing: all 11 prod customer details have `ready_qty=0`) | F8 | lifecycle-guards |
| 8 | Ordered `FOR UPDATE` on touched details at the top of `mark_order_details_ready` + `AND ready_qty < v_new`; carry `work_pool_id` in `transfer_assignment` item copies + fire the readiness tail on the force-completed card | F3, F4 | **new: ready-engine-hardening** |
| 9 | `REVOKE EXECUTE ... issue_stock_receipt_number FROM anon, PUBLIC` (live-ops, mirrors the P5 DN fix) | F13 | **new: security-grants** (live-ops) |
| 10 | Release sequence: apply `20260702120000/130000/140000` via MCP **before** code deploy; verify 4-arg confirm + `stock_receipts.source`; add pending/applied entries to `docs/operations/migration-status.md`; run Wave-3 browser smoke (planned item 6) | F17 | **release-ops** |

### Should land soon after (fast-follow)

| # | Item | Findings | Slice |
|---|------|----------|-------|
| 11 | Corrections UI: `voidStockReceipt` wrapper + `'voided'` status, per-order Receipts card (`fetchStockReceipts`), admin Void + Reopen actions; `cancel_order_detail` RPC + receipt/DN-item FKs in the delete preflight (clean 409) | F5, F7 | **new: corrections-ui** |
| 12 | Internal-order UX: show `internal_reason` (list column + header), hide customer picker on internal, Ready/Received columns + sections popover (`fetchOrderDetailRequiredSections`) — natural home for the planned source=fallback badge | M12-M14 | corrections-ui + **labels** (item 1) |
| 13 | `unmapped_section_op` diagnostic kind (+ map "Woodworking Finishing" in prod data); diagnostics `ON CONFLICT DO UPDATE` + clear-when-resolved; decide all-zero-op and Cut & Edge gating semantics and document in the plan; BOL-regen + phantom-link multiplier sync; drop/revoke legacy v1 completion RPC | F6, M19-M23, M26 | ready-engine-hardening |
| 14 | Per-order advisory lock in the seven order-mutating RPCs + `ORDER BY order_detail_id` in multi-row loops (also fixes the unlocked status-read races and the external-DN TOCTOU); snapshot `ON CONFLICT DO NOTHING` | M5, M6, F10, M30 | ready-engine-hardening |
| 15 | Grants tightening: reject spoofed `p_actor` for end-user sessions; org-gate or de-grant the five definer helpers; decide/gate raw stock-adjustment RPCs; revoke direct UPDATE/DELETE on ledger/receipt tables | M7-M10 | security-grants |
| 16 | Extend **fg-transactions-P6** scope to include server-paginating the global `/inventory/transactions` (plan F2 High — currently half-shipped); `:void` reference → distinct "Void" chip | M18, M29 | fg-transactions-P6 |
| 17 | Extend **misc-ui** (planned item 4 is mis-scoped): manual pool-entry dialog needs an optional order-line picker in addition to the multiplier input, else manual rows can never gate readiness | M24 | misc-ui |
| 18 | Housekeeping: rename duplicate versions `20260603120000_pending_stock_issuances` (item 8) **and** `20260618120000_cutlist_same_board_finished_qty`; backfill `20260702084544` at reconciliation; mark-printed on list/preview print; invalidate `['order', orderId]` after DN sign/cancel; per-line `delivered` flip; event-log INSERT coverage; `order_type` in Sam/assistant/dashboard; document the FG-valuation (quantity-only) decision in the plan | M15, M16, M25, M27-M29 | release-ops / assorted |

### Already planned, confirmed still open (no new action beyond scope notes above)

Items 1-6 of the planned list were re-verified as accurately scoped except item 4 (see punch-list #17). Item 5 (L5 no-ledger on customer fulfilment) confirmed deferred; note `auto_consume_on_add` is *not* covered by its wording (handled in punch-list #3). Item 7 (no order-level cancel cascade) is ratified and respected — only the guard residue (punch-list #4) is new work.