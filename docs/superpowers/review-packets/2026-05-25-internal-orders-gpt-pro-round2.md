# Review packet — Internal Orders & Order Completion (Round 2)

**For:** GPT-5.5 Pro
**Round 1 summary:** 6 BLOCKERs + 14 MAJORs + 6 MINORs + 5 NITs raised, all addressed (one with a partial-pushback — see below).
**Branch tip:** `codex/local-claude-internal-orders-spec` at `412cbb3`.
**Spec on GitHub:** https://github.com/MaierG74/unity-erp/blob/codex/local-claude-internal-orders-spec/docs/superpowers/specs/2026-05-25-internal-orders-and-order-completion-design.md

## What changed since round 1

### BLOCKERs — all integrated

1. **View uses `WITH (security_invoker = true)`** + explicit `REVOKE PUBLIC` / `GRANT authenticated`. See §"View: `product_inventory_transactions_with_balance`". Verification adds cross-org smoke against the view itself.

2. **Section source of truth path defined.** Phase 1B (new) adds `job_work_pool.section_id` snapshotted from BOL at pool generation, copied to `job_cards.section_id` at issuance via updated `issue_job_card_from_pool` and the follow-up branch of `complete_job_card_v2`. NOT NULL enforcement on new `job_cards.section_id` is deferred to Phase 1B (after both insertion paths are updated). See §"Section source on job_work_pool (Phase 1B addition)" and the Phasing table.

3. **`mark_order_details_ready` algorithm corrected** to per-operation clamp + MIN across operations within section + MIN across sections. Full pseudocode in §"The 'ready' event" → "The correct algorithm". Explicitly excludes cancelled pool / card / item rows and NULL `work_pool_id`. Test list (in §"Verification") covers exactly the scary cases you raised.

4. **Route snapshot table `order_detail_required_sections`** added. Snapshot is captured at order_detail creation time from `product_sections` → `products.default_section_route` → fallback, with the `source` enum recorded. `mark_order_details_ready` reads only the snapshot, never live product config. See the new table definition + §"Section routing model" → "Source of truth — at order_detail creation time only".

5. **`product_inventory_transactions` writes fixed.** Internal-order receipts use `type='build'` (existing enum value), column is `reference` (not `source_reference`). Customer-order DN signing writes NO transaction (would double-write with existing `consume-fg` flow for FG reservations). See §"Mapping movements to the existing `product_txn_type` enum" — the table now distinguishes built-to-order vs FG-reservation cases.

6. **Cross-org consistency triggers** added for every new child table (`order_delivery_notes`, `order_delivery_note_items`, `stock_receipts`, `stock_receipt_items`, `stock_adjustments`, `product_sections`, `order_detail_required_sections`, `order_status_events`). See §"Cross-org consistency triggers". Phase 1A explicitly bundles RLS + cross-org triggers + the verification smoke that tests cross-org INSERTs are blocked.

### MAJORs — all integrated

1. **`jobs` RLS is NOT read-only.** Confirmed via grep: `jobs-rates-table.tsx:603` does `supabase.from('jobs').delete()`. Policies: SELECT/INSERT/UPDATE/DELETE `TO authenticated USING (true)`. No effective behaviour change — just closes the advisor warning. Future ticket noted for tightening to `labor_admin`.

2. **`orders.order_type` immutability trigger** added — blocks the type change when dependent rows exist. Paired with the existing detail-level cross-table-invariant trigger. The "flip type after counters > 0" hole is closed.

3. **Partial pushback on Phase 1 customer CHECK.** Preflight queried: **0 of 496 orders have NULL `customer_id`**. The constraint validates immediately. Still applied `NOT VALID` + post-migration `VALIDATE CONSTRAINT` defensively. Reviewer was right to flag the risk class; the specific concern doesn't materialise here.

4. **Full 4-way CHECK on orders** added: `(order_type='customer' AND customer_id IS NOT NULL AND internal_reason IS NULL) OR (order_type='internal' AND customer_id IS NULL AND length(trim(coalesce(internal_reason,''))) > 0)`.

5. **TS types update is explicit Phase 1A scope** — `lib/types/orders.ts`, `lib/types/inventory.ts`. New shape ships with the schema.

6. **Auto-draft receipt trigger uses partial-unique upsert.** Indexes: `UNIQUE (org_id, order_id) WHERE status='draft'` on `stock_receipts`, `UNIQUE (stock_receipt_id, order_detail_id)` on items. Trigger body shown in pseudocode in §"The 'ready' event". (You corrected me on DEFERRABLE — confirmed: regular triggers can't be; only constraint triggers. The plain `AFTER UPDATE FOR EACH ROW` with idempotent upsert is the right shape.)

7. **Partial confirmation residual flow.** If operator confirms 4 of a 6-unit draft, the RPC creates a new draft with 2 units so nothing is stranded. See §"Path A" → "Partial confirmation".

8. **DN allocation is allocation-aware.** `allocated_delivery_qty` = sum across `draft+printed+signed`. Modal default = `ready_qty - allocated_delivery_qty`. UI never offers what DB will reject. See §"Allocation accounting".

9. **Numbering RPC hardened.** Row-lock on `organizations` + prefix-aware max + INSERT + 23505-retry-up-to-3. Partial-unique index `(org_id, note_number) WHERE note_number IS NOT NULL` as belt-and-braces. Prefix-aware so changing the prefix doesn't jump the next number.

10. **Quantities are integer.** `order_delivery_note_items.quantity` and `stock_receipt_items.quantity` both `integer NOT NULL`. Matches `order_details.quantity` + counters. Future move to fractional finished goods would migrate all four columns together.

11. **Transactions page reframed as refactor.** `components/features/products/ProductTransactionsTab.tsx` exists today. Phase 6 promotes it to first-class routes + adds running-balance/filters/quick-view pills/source-ref drilldowns/QOH chart/CSV export, then retires `/products?tab=transactions`. See §"Inventory transactions history page".

12. **Route configuration is in Phase 3** alongside internal-order CRUD (was missing from the phasing entirely). Phase 3 includes the route editor UI + snapshot logic + default seeding for known products.

13. **`Ready For Delivery` (status_id=1) integrated** as Stage 1 of a two-stage closure. `check_order_readiness` promotes when all non-cancelled lines reach `'ready'`; `check_order_completion` promotes to `30 Completed` when fully delivered/received. See §"Order auto-close & Ready For Delivery intermediate".

14. **Prior-status capture for reopen.** New `order_status_events` append-only log + `orders.completed_from_status_id` column. `reopen_order` RPC restores from either source. Cancelling a signed DN in admin mode auto-fires reopen with `trigger_source='reopen'`.

### MINORs + NITs — all integrated

- Order-level section cascade now uses the same eligibility filters as the ready rollup (no skew possible).
- `mark_order_details_ready` hardened: `SET search_path = public, pg_temp`, `REVOKE anon/public`, `GRANT authenticated`, `is_org_member` check.
- `stock_receipts.created_by` is NULLABLE so trigger-created drafts work in system context.
- Phase 2 test list expanded to cover the full overcounting/concurrency/snapshot/cancellation surface you listed.
- `completed_qty` → `completed_quantity` in cascade prose.
- "saved views" → "quick-view pills" (matches the page layout's actual implementation).
- "dropped `make_strategy`" → "legacy `make_strategy`".
- The `order_delivery_notes` table description had a typo ("NOT `order_delivery_notes`" instead of "NOT `delivery_notes`") — fixed.

### Phasing reordered

| Old | New |
|---|---|
| 1: Schema foundation | **1A: Schema safety + RLS** (no behaviour change) |
| (n/a) | **1B: Section source of truth** (must precede Phase 2; updates both job-card insertion paths) |
| 2: Section cascade + ready event | 2 (unchanged conceptually; now correctly depends on 1B) |
| 3: Internal-order CRUD | **3: Route configuration + internal-order CRUD** (route editor added) |
| 6: Inventory transactions | **6: Inventory transactions (refactor)** — explicitly reframes as ProductTransactionsTab promotion |

Hard dependencies stated: Phase 2 depends on 1B; Phases 4 and 5 depend on Phase 2.

## Open items deferred to plan-write

These are intentional — the spec calls them out as plan-write decisions, not unresolved questions:

- Does `consume-fg` write `type='ship'` or `type='consume'`? (Either way, DN signing stays out of inventory mutation; spec is correct.)
- Which `manufacturing_sections` row is the fallback Assembly? (`section_code='ASM'` match vs new `organizations.default_assembly_section_id` column.)
- Does `billoflabour` already have a `section_id`? Preflight didn't find one. Plan-write verifies and adjusts Phase 1B.
- Sidebar placement of "Stock movements" / "Deliveries" — read current sidebar structure during plan-write.
- Whether `/inventory/deliveries` cross-order page is Phase 5 or split as 5b.

## Specific things I'd like you to verify in round 2

In priority order:

1. **Did my fix to `mark_order_details_ready` actually solve the overcounting?** Re-read the pseudocode against the BLOCKER #3 cases (multi-pool per section, cancellation, NULL routes). Especially the `LEAST(completed_for_op, op.required_qty)` clamp — does that cover the case where one operation is over-completed (e.g. user marked 45 done on a 40-required op) while another in the same section is under-completed (e.g. 30 done on a 40-required op)? My intent: clamp the over to 40, take min(40, 30) = 30 → ready_qty = 30. Want a second eye.

2. **Cross-org consistency triggers — do the parent-existence checks introduce a race?** The trigger does `SELECT org_id FROM orders WHERE order_id = NEW.order_id` and compares. If `orders` is being concurrently updated, could the trigger see a stale or NULL? Need an outer FOR SHARE / FOR KEY SHARE lock, or is the FK already sufficient?

3. **Auto-draft receipt trigger pseudocode** — is the `ON CONFLICT (org_id, order_id) WHERE status = 'draft' DO NOTHING RETURNING` idiom correct? Postgres allows DO NOTHING with RETURNING but the RETURNING is empty on conflict, which is why the code re-SELECTs after. Cleaner alternative?

4. **Two-stage closure on internal orders** — `check_order_readiness` promotes to `Ready For Delivery (1)` for both order types. The status name is customer-facing; does using it for internal orders cause UI confusion? Spec proposes UI labels it "Ready to receive into stock" on internal orders, but the underlying `status_id` is shared. Acceptable?

5. **`order_status_events` granularity.** Trigger writes one row per `orders.status_id` change. If `check_order_readiness` fires then `check_order_completion` fires in the same transaction (which would happen on a single-line internal order whose ready and received both reach quantity in the same RPC), we get two events. Correct? Or should we batch?

6. **Partial pushback verification.** Spec uses `NOT VALID` + `VALIDATE CONSTRAINT` for the customer CHECK on the basis that 0 of 496 orders need cleanup. The validate step is post-migration. Anything else you'd want this defensive pattern to guard against, given the actual data state?

7. **The `LEAST(completed_for_op, op.required_qty)` clamp behaviour when the operator over-completes is currently silent.** Should we surface a warning or exception when an over-complete is detected (could indicate scrap-and-retry that should be recorded somewhere)? Or is silent clamp + accept the data correct? I lean silent-clamp for v1 with a future "exception when over-issued" enhancement.

8. **Spec quality** — anything I missed, contradictions I introduced in the rework, places where the new Phase 1A/1B/3 structure conflicts with anything else in the spec.

Severity-grouped (BLOCKER/MAJOR/MINOR/NIT) reply please. The spec on GitHub at the URL above is the authoritative target.
