# Review packet — Internal Orders & Order Completion (Round 4)

**For:** GPT-5.5 Pro
**Round 3 summary:** 0 BLOCKERs + 4 MAJORs + 6 MINORs + 3 NITs, all integrated. You recommended proceeding to `writing-plans` after the MAJORs were addressed; this packet asks for that sign-off plus any final clean-up.
**Branch tip:** `codex/local-claude-internal-orders-spec` at `fdcb1bc`.
**Spec on GitHub:** https://github.com/MaierG74/unity-erp/blob/codex/local-claude-internal-orders-spec/docs/superpowers/specs/2026-05-25-internal-orders-and-order-completion-design.md

## What changed since round 3

### MAJORs — all fixed

1. **Order-level section cascade now finished-good normalised.** The §"Section completion cascade (order-level — not the ready trigger)" prose now uses the same `FLOOR(LEAST(SUM, required_qty) / required_qty_per_finished_good)` per op, then `MIN`, then compare to required finished-good units. The two surfaces (per-line ready event and order-level section badge) can no longer drift.

2. **`required_qty_per_finished_good` hardened.** Column declaration adds `CHECK (required_qty_per_finished_good > 0)`. Backfill is now `COALESCE(required_qty::numeric / NULLIF(order_details.quantity, 0), 1)` — handles NULL/0 historical quantities without violating NOT NULL. Phase 1B migration also asserts `> 0` for every backfilled row.

3. **Manual pool rows multiplier explicit.** "Create manual work-pool entry" UI/RPC accepts `required_qty_per_finished_good` (default 1, helper text *"How many of this operation make one finished product? Most cases = 1. Shelves at 4 per cupboard = 4."*). RPC validates `> 0`. Closes the round-2-blocker re-entry through the manual path.

4. **Stock-receipt trigger "burned number" comment corrected.** Under the current max-scan allocator, no row was inserted on the ON CONFLICT branch — so the number can be reused by the next call. Documented. Future stored-counter allocator would need savepoint/rollback; called out as a known migration constraint.

### MINORs — all fixed

- `set_config(...)` calls clear the GUCs after the status UPDATE so stale context can't leak into a subsequent status update in the same transaction.
- Manual partial-unique predicate uses positive `status='active'` enumeration (future statuses can't silently collide).
- UI placement section uses `ready_qty > allocated_delivery_qty` (was the stale `delivered_qty` comparison).
- Worked examples copied from the round-3 packet into the spec body next to the algorithm pseudocode (door multiplier, over+under split, three-op mixed-multiplier). Reduces implementer regression risk.
- Phase 2 test list explicitly names multiplier cases (=2, =4, over-complete with multiplier > 1, COALESCE backfill).
- Phase 3 status-label acceptance criterion is grep-based — `grep -rn "status_name" app/ components/ lib/ types/` must show no user-facing surface bypassing `getOrderStatusLabel`.

### NITs — all fixed

- `delivered_qty` column description: "signed delivery notes only" (was "non-cancelled" — wrong; allocation is computed separately).
- `current_setting('app.actor_id', true)::uuid` wrapped in `EXCEPTION WHEN invalid_text_representation` with `auth.uid()` fallback. Hardened.
- Section cascade prose explicitly says "finished-good units" in the threshold comparison.

## Questions for round 4

Short list — should be a quick confirmation pass:

1. **Section cascade prose fix.** Re-read §"Section completion cascade" — does the updated pseudocode match the per-line algorithm's normalisation correctly, and is the cross-detail aggregation ("required finished-good units for the order, summed across the order's details that route through this section") expressed correctly? In particular: if order has 10 cupboards (route through Cutting+Edging+Assembly) and 5 chairs (route through Assembly only), the Assembly section's required finished-good units for the order is 15. Confirm.

2. **`set_config(..., '', true)` after UPDATE.** Is setting a GUC to the empty string the right "clear" pattern, or should we use `RESET app.order_status_trigger_source` instead? `current_setting(..., true)` returns the empty string and the `NULLIF(..., '')` idiom converts back. Either works; want your call on idiom.

3. **Worked example C edge case.** In example C, if the multiplier=4 Shelves op has 37 of 40 complete, `FLOOR(37 / 4) = 9`. Is "9 cupboards ready, but 37 shelves of 40 cut" the right operator-facing surface? The 9-cupboard ready figure is correct, but should the UI also surface "you've cut 37 of 40 shelves" so the gap is visible? Out of scope for this spec, but worth a brief opinion before I close.

4. **Anything else stale, contradictory, or unclear** introduced in this final rework pass.

If round 4 returns "Ship the spec" or equivalent, I'll proceed to `writing-plans` (which produces the implementation plan against this spec) and then file the Linear epic + sub-issues.
