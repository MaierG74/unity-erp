# Review packet — Internal Orders & Order Completion (Round 3)

**For:** GPT-5.5 Pro
**Round 2 summary:** 1 BLOCKER + 6 MAJORs + 5 MINORs + 4 NITs raised, all integrated.
**Branch tip:** `codex/local-claude-internal-orders-spec` at `ab2ea85`.
**Spec on GitHub:** https://github.com/MaierG74/unity-erp/blob/codex/local-claude-internal-orders-spec/docs/superpowers/specs/2026-05-25-internal-orders-and-order-completion-design.md

## What changed since round 2

### BLOCKER — fixed

**Operation units vs finished-good units.** Verified the bug against `lib/queries/laborPlanning.ts` (line 559: `jobQuantity = bol.quantity * orderQty`; line 786: stale-pool detection uses the same product) and confirmed `billoflabour.quantity integer NOT NULL DEFAULT 1` exists. Fix shipped:

1. Added `job_work_pool.required_qty_per_finished_good numeric NOT NULL DEFAULT 1`, snapshotted at pool generation from `billoflabour.quantity`. Default 1 covers manual rows. Backfill for historical rows derives the multiplier as `required_qty / NULLIF(order_details.quantity, 0)` for `order_detail_id IS NOT NULL` rows.
2. The algorithm's per-operation step is now:
   ```
   clamped_op_units = LEAST(completed_for_op, op.required_qty)
   op_units_in_finished_goods = FLOOR(clamped_op_units / op.required_qty_per_finished_good)
   ```
   Normalisation happens before the per-section `MIN` so cross-section comparisons all happen in finished-good units. See §"The 'ready' event" → "The correct algorithm".

Worked example: order_detail 49 = 10 cupboards, BOL has 2 doors per cupboard, pool `required_qty = 20`. 15 doors complete → `LEAST(15, 20) / 2 = 7` finished-goods worth of door work → section_min limited to 7 → if other sections are at 10 → `MIN(7, 10) = 7` → `ready_qty = 7`. Matches the example in your round-2 note.

### MAJORs — all fixed

1. **Cross-org triggers use `FOR SHARE`** on parent rows whenever they read non-key business columns (org_id, order_type, status). Lock order: orders → notes/receipts → details. See §"Cross-org consistency triggers".
2. **Stock-receipt trigger SELECT-firsts.** Number is only allocated when the SELECT misses. Rare race-loss branch (concurrent trigger insert between our SELECT and INSERT) is documented as known-but-rare; the future enhancement note in the spec covers rollback-on-conflict for the number. See §"The 'ready' event" → trigger pseudocode.
3. **`order_status_events` single-writer rule.** The `BEFORE UPDATE OF status_id ON orders` trigger is the only writer. RPCs use `set_config('app.order_status_trigger_source', ...)` etc. before their UPDATE; trigger reads via `current_setting(..., true)`. Manual status changes default to `trigger_source='user'` with `changed_by=auth.uid()`. See the table definition.
4. **`getOrderStatusLabel(order)` helper** added at `lib/orders/status-label.ts`. Internal orders at `status_id=1` render as "Ready to receive into stock"; customer orders as "Ready For Delivery". Phase 3 includes an explicit audit of every consumer that reads `order_statuses.status_name` directly; the audit list goes in the Phase 3 ticket. Interim behaviour (until audit clears) is documented as acceptable — underlying state is correct, just display might lag in unmigrated surfaces.
5. **`jobs` RLS contradiction removed.** The early "Preflight advisor findings" section now matches the later policy table — RLS enabled, full SELECT/INSERT/UPDATE/DELETE policies for authenticated, no behaviour change.
6. **Pool-row grain invariant.** Documented as load-bearing for the algorithm. Existing BOL partial-unique covers `source='bol'`. New partial-unique `(org_id, order_id, order_detail_id, section_id, job_id) WHERE source='manual' AND status <> 'cancelled'` covers manual. Future split-batch workflow is explicitly out of scope; if needed, batch-splitting shrinks an existing row + adds a sibling with a distinct `job_id` (not duplicates). See §"Pool-row grain invariant".

### MINORs — all fixed

- Over-completion produces a non-blocking diagnostic (`record_overcompletion_diagnostic(...)`) in the algorithm pseudocode. v1 logs server-side + UI chip on the pool row; future ticket routes into `job_work_pool_exceptions`.
- `products.org_id` added to the background-table description.
- Manual-receive rule explicit: internal orders, `received_qty >= quantity` AND `status NOT IN ('cancelled','received')` → `status='received'`, regardless of prior non-terminal state. See §"Path B — manual receive" → "Line-status rule for non-ready lines".
- Phase 5 test list now includes the consume-fg / DN-signing no-duplicate assertion.
- NOT VALID assertion shipped as a `DO $$ ... RAISE EXCEPTION IF EXISTS ... $$;` block before the VALIDATE step.

### NITs — all fixed

- `order_detail_required_sections` uses surrogate PK + `UNIQUE (order_detail_id, section_id)`. No more double-PK.
- Partial unique indexes (`order_delivery_notes_org_number_uq`, `one_draft_stock_receipt_per_order`, etc.) moved out of `CREATE TABLE` blocks into separate `CREATE UNIQUE INDEX` statements. Migration plan must not copy the in-table shorthand verbatim.
- Background prose for the inventory transactions page now acknowledges existing `ProductTransactionsTab` / `ProductsTransactionsTab` and the promote/refactor framing.
- `trigger_source` enum split into `auto_ready` (Stage 1, status_id=1) and `auto_completed` (Stage 2, status_id=30). Audit reads cleanly.

## Specific things I'd like you to verify in round 3

In priority order:

1. **Algorithm with worked examples.** Re-walk the corrected algorithm against (a) my BLOCKER example above; (b) the over-completion + under-completion split you flagged in round 1 (op A 45/40, op B 30/40, multiplier 1 → ready_qty = 30; multiplier 2 with ordered_qty=20 → `MIN(40, 30)/2 = 15`); (c) a 3-operation section where one op has multiplier=4 (e.g. shelves per cupboard) and others have multiplier=1. Does anything still mis-count?

2. **Single-writer `set_config` pattern.** Is the `current_setting(name, missing_ok=true)` idiom robust across nested function calls in the same transaction? Specifically: if `complete_job_card_v2` calls `mark_order_details_ready` calls `check_order_readiness` and that's where the UPDATE happens, will the GUCs set by `check_order_readiness` (the immediate parent of the UPDATE) be the ones the trigger reads? My understanding is `local=true` GUCs live until the end of the surrounding transaction; the trigger fires before the UPDATE returns, so the GUCs are in scope. Confirm?

3. **Pool-row grain partial-unique on manual.** Is the index predicate `WHERE source='manual' AND status <> 'cancelled'` indexable in Postgres? `<>` against a text equality should be fine but worth confirming. Also: would a manual row in `status='draft'` (the spec doesn't define one for `job_work_pool`, but if it ever existed) collide with an active one and surprise an operator? Currently `job_work_pool.status` values from preflight: I didn't enumerate; the existing values are 'active' and 'cancelled' per the migration. Confirm the predicate set covers the right state machine.

4. **Trigger-allocated number rollback path.** If the trigger calls `issue_stock_receipt_number(...)` then loses the ON CONFLICT race, the number is burned. I documented it as known-but-rare. Should round 3 spec the explicit rollback path (e.g. SAVEPOINT around the number alloc + RELEASE on success / ROLLBACK on conflict)? Or is "rare, document, no-fix-in-v1" defensible?

5. **Status label adapter scope.** I audited types/orders/order-statuses references generally but the Phase 3 ticket carries the full audit list as a deliverable rather than baking it into this spec. Is that defensible — or should the spec itemise the consumers now? My read: the consumers are at "minor PR" scale, not "spec amendment" scale, and the audit will be guided by `grep -rn "status_name" lib/ app/ components/`.

6. **Anything stale or contradictory I introduced in the rework.** Especially across the early background section, the RLS posture section, and the phasing table — three sections that have absorbed multiple iterations.

Severity-grouped (BLOCKER/MAJOR/MINOR/NIT) reply please. If round 3 surfaces no BLOCKERs we proceed to `writing-plans` for the implementation plan.
