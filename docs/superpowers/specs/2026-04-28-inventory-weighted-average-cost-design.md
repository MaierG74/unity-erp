---
date: 2026-04-28
status: draft
owner: greg@apexza.net
linear:
  - POL-69 (Piece A — this spec): https://linear.app/polygon-dev/issue/POL-69
  - POL-70 (Piece B — follow-up): https://linear.app/polygon-dev/issue/POL-70
related:
  - app/api/inventory/snapshot/route.ts
  - components/features/inventory/ReportsSnapshotTab.tsx
  - components/features/purchasing/order-detail.tsx
  - supabase/migrations/20260311141133_fractional_purchase_receipts.sql
  - supabase/migrations/20260409110000_inventory_snapshot_and_stock_hardening.sql
revision_history:
  - 2026-04-28 v1 — initial draft after brainstorming with Greg.
  - 2026-04-28 v2 — Codex review pass; repointed to current receipt RPC, fixed recompute walk, removed manual fallback from scope, tightened tenancy guards, hardened search_path, expanded test plan.
---

# Inventory Weighted Average Cost — Piece A

## Background

Inventory currently has no cost basis. The Inventory Snapshot's "Show estimated value" toggle multiplies on-hand by the cheapest current supplier list price (`Math.min(suppliercomponents.price)` in [app/api/inventory/snapshot/route.ts:100](../../../app/api/inventory/snapshot/route.ts#L100)). That number is not what was paid and drifts whenever a list price changes, which makes it unsafe for any month-end view of inventory value.

Concrete failure: buy 1000 @ R5.00 and 1000 @ R4.00, true WAC is R4.50, total value R9,000. The system today shows `2000 × R4.00 = R8,000` and would re-shift to R7,000 if a supplier later quotes R3.50 — without anything physically changing on the shelves.

## Goals

- Track a real weighted-average cost per component, updated atomically on every priced receipt.
- Make the Inventory Snapshot's "value" column reflect actual cost basis, with an honest fallback for components that have never received priced stock.
- Ship before month-end so QButton's monthly snapshot is meaningful.

## Non-goals (deferred to Piece B)

- Recording `unit_cost` on `ISSUE` / `SALE` / `ADJUSTMENT` / `TRANSFER` transactions.
- Job-card cost reports / COGS attribution.
- Landed cost (freight, duty) decomposition.
- Per-location cost (cost stays at component level; transfers are no-ops on cost).
- FIFO / lot-based cost layering.

## Known limitations (accepted)

- **Past-date snapshots use today's `average_cost`.** The snapshot for, say, 2026-02-28 multiplies the as-of-date *quantity* by the *current* `average_cost`. That is not strictly the historical valuation — the average may have moved between then and now. For QButton's month-end use case (snapshot taken close to end-of-month), the drift is minimal in practice. A future enhancement could store a per-receipt rolling average on `inventory_transactions` to enable true historical valuation.
- **Catalog price drift** between order placement and receipt — see receipt-RPC section.

## Design

### Schema additions

```sql
alter table inventory_transactions
  add column unit_cost numeric(18,6) null;

alter table inventory
  add column average_cost numeric(18,6) null;
```

Both columns nullable. `unit_cost` is written only on `PURCHASE` transactions in Piece A; remains null on every other transaction type until Piece B. `average_cost` is updated only on receipts; preserved across all other operations.

### Receipt RPC update — `process_supplier_order_receipt`

**Target migration**: the current live function lives in [supabase/migrations/20260311141133_fractional_purchase_receipts.sql](../../../supabase/migrations/20260311141133_fractional_purchase_receipts.sql) (the fractional / allocation-aware / gate-rejection version, signature with nine parameters). The WAC migration replaces this function in place — same signature, same return shape — so callers do not change.

**Source of unit cost.** `supplier_orders` has no price column; the price lives on `suppliercomponents.price`, joined via `supplier_orders.supplier_component_id → suppliercomponents.supplier_component_id`. The RPC already loads `v_order.supplier_component_id`, so it fetches `sc.price` in the same query. That value is the source of `unit_cost` for the receipt.

> **Known limitation, accepted for Piece A:** `suppliercomponents.price` reflects the *current* catalog list price, not necessarily the price negotiated when the supplier order was placed. If the catalog price drifts between order placement and receipt, the WAC will use the receipt-time list price, not the actual paid price. Future enhancement: add `unit_price` to `supplier_orders` (price-at-order-time) or `supplier_order_receipts` (price-actually-paid). Out of scope for Piece A.

**Quantity used for WAC.** The RPC computes `v_good_quantity := p_quantity - coalesce(p_rejected_quantity, 0)` ([line 132](../../../supabase/migrations/20260311141133_fractional_purchase_receipts.sql#L132)). The `inventory_transactions` row already inserts with `v_good_quantity` ([line 228](../../../supabase/migrations/20260311141133_fractional_purchase_receipts.sql#L228)). **WAC must use `v_good_quantity` as the received quantity** — rejected stock never enters the inventory and must not weight the average. (The rejection branch inserts a separate `RETURN` transaction with negative quantity; that row leaves `unit_cost` null and does not move `average_cost`.)

**Behavior — exact sequence inside the existing atomic block:**

1. After the existing `select sc.component_id ...` lookup, also pull `sc.price` into `v_unit_cost`.

2. Adjust the `inventory_transactions` insert (around line 218-235) to populate `unit_cost = v_unit_cost`. If `v_unit_cost is null or v_unit_cost <= 0`, leave `unit_cost` null on that row and skip the `inventory.average_cost` update in step 3.

3. **Replace the existing `update inventory set quantity_on_hand = ... + v_good_quantity` (line 417) with a single locking update that reads `old_qty` / `old_avg` and writes both columns in one statement:**

```sql
update inventory
set
  quantity_on_hand = coalesce(inventory.quantity_on_hand, 0) + v_good_quantity,
  average_cost = case
    when v_unit_cost is null or v_unit_cost <= 0 then inventory.average_cost
    when coalesce(inventory.quantity_on_hand, 0) <= 0
      or inventory.average_cost is null then v_unit_cost
    else (
      coalesce(inventory.quantity_on_hand, 0) * inventory.average_cost
      + v_good_quantity * v_unit_cost
    ) / (coalesce(inventory.quantity_on_hand, 0) + v_good_quantity)
  end
where inventory.component_id = v_comp_id
returning inventory.quantity_on_hand into v_qty_on_hand;
```

This reads the old `quantity_on_hand` and `average_cost` under the row's UPDATE lock, computes the new average, and writes both columns atomically. No race window between read and write.

4. **Missing-inventory-row branch** (line 422 — `if not found then insert into inventory ...`): if no inventory row existed, insert with `average_cost = v_unit_cost` (or `null` if `v_unit_cost is null`):

```sql
if not found then
  insert into inventory (component_id, quantity_on_hand, location, reorder_level, average_cost)
  values (
    v_comp_id,
    v_good_quantity,
    null,
    0,
    case when v_unit_cost > 0 then v_unit_cost else null end
  )
  returning inventory.quantity_on_hand into v_qty_on_hand;
end if;
```

5. The replacement function definition includes `set search_path = public` (the current version omits it — fix while we're touching it). All other behavior — the rejection-return insert, allocation logic, status updates, return shape, grants — is preserved verbatim.

**Edge cases (these fall out of the SQL above; called out for clarity):**

| Condition | Behavior |
|-----------|----------|
| `old_qty <= 0` or `old_avg IS NULL` | `new_avg = v_unit_cost` |
| `v_unit_cost IS NULL` or `<= 0` | Leave `average_cost` unchanged; `unit_cost` left null on the transaction row |
| `v_good_quantity = 0` (full rejection) | RPC raises before reaching the update branch (rejection insert handles the negative side); inventory row is not touched in this case |
| `received_qty <= 0` | The RPC already raises ([line 138](../../../supabase/migrations/20260311141133_fractional_purchase_receipts.sql#L138)) on `p_quantity <= 0`; no change needed |

The function continues to run with `SECURITY DEFINER`, the existing `is_org_member(v_order.org_id)` guard, and the `for update` lock on `supplier_orders`. No new transaction boundaries.

### Manual fallback removal — `components/features/purchasing/order-detail.tsx`

[components/features/purchasing/order-detail.tsx:178-end-of-fallback-block](../../../components/features/purchasing/order-detail.tsx#L178) currently catches RPC failures and falls back to client-side INSERTs into `inventory_transactions` and direct UPDATE of `inventory.quantity_on_hand`. This path:

- bypasses tenancy (no `org_id` set on the manual `inventory_transactions` insert relies on column default — fragile),
- skips the rejection / allocation / status-update logic the RPC owns, and
- after this spec, would silently bypass the WAC write.

**Action**: remove the fallback. RPC failures bubble up to the user with a toast/error. The RPC is the canonical and only receipt path. Greg approves losing the fallback's "graceful degradation" behavior — it has been a hidden footgun.

### Seed strategy

One-shot script: `scripts/seed-inventory-average-cost.ts`. Iterates **per organization** (loops `select id from organizations`, runs the same logic against each, scoped by `org_id`). For each component within an org:

1. The `suppliercomponents.price` of the supplier component referenced by the **most recent received** `supplier_orders` row for that component within that org. Found by joining `inventory_transactions` (`PURCHASE`, `org_id = $org`) → `supplier_order_receipts` → `supplier_orders` → `suppliercomponents`, ordered by `transaction_date DESC, transaction_id DESC`.
2. Else, `min(suppliercomponents.price)` across all `suppliercomponents` for the component within that org, where `price > 0`.
3. Else, leave `inventory.average_cost = NULL`.

Idempotent: only updates rows where `inventory.average_cost IS NULL` so it never clobbers organically-grown averages from receipts that happened post-deploy. Safe to re-run.

CLI: `npx tsx scripts/seed-inventory-average-cost.ts [--org-id <uuid>]`. Without `--org-id`, iterates every org. With `--org-id`, scopes to one. Uses the service-role Supabase client.

Run order at deploy: migrations → seed script → app code. The seed must run before app code so the snapshot UI does not briefly show NULLs everywhere.

### Recompute admin function

```sql
create function recompute_inventory_average_cost_from_history(
  p_org_id uuid,
  p_component_id int default null
)
returns int
language plpgsql
security definer
set search_path = public
as $function$
...
$function$;
```

**Authorization guard at function entry:**

```sql
if auth.role() <> 'service_role' and not is_org_member(p_org_id) then
  raise exception 'recompute_inventory_average_cost_from_history: access denied';
end if;
```

This blocks cross-tenant recomputes even if the API gate is misconfigured. The pattern matches the receipt RPC's existing org guard ([line 168](../../../supabase/migrations/20260311141133_fractional_purchase_receipts.sql#L168)).

**Replay algorithm (per component):**

For each component (or only `p_component_id` if provided):

- Walk `inventory_transactions` filtered to that `component_id` and `org_id = p_org_id`, ordered by `transaction_date ASC, transaction_id ASC`.
- Track `running_qty numeric` (starts at 0) and `running_avg numeric` (starts at NULL).
- For **every** row, regardless of type, update `running_qty := running_qty + quantity` (signed; transactions store negative quantities for issues, returns, transfers-out, etc.).
- For `PURCHASE` rows only, update `running_avg`:
  - Use `inventory_transactions.unit_cost` if not null.
  - Else fall back to `suppliercomponents.price` reached via `supplier_order_receipts.transaction_id → supplier_orders.supplier_component_id → suppliercomponents.price` (best-effort for pre-Piece-A receipts).
  - If still null or `<= 0`, leave `running_avg` unchanged for this purchase.
  - Apply the WAC formula using `old_qty = max(running_qty_before_this_row, 0)` (the value before adding this purchase's signed quantity); rationale below.
- After the walk, write `running_avg` to `inventory.average_cost` for that component. Skip components where `running_avg` ended up null (do not overwrite an existing value with NULL).

**Why the running_qty matters even on non-`PURCHASE` rows:** WAC weights new receipts against the *current* on-hand. If issuance/adjustment rows are skipped, later purchases would be weighted against stock that no longer exists. Concrete case the test plan covers: receive 100 @ R5, issue 90, receive 100 @ R4 → WAC must be `(10 × 5 + 100 × 4) / 110 ≈ 4.0909`, not `4.5`.

**Why `max(running_qty_before, 0)`:** if running_qty went negative (over-issued in the data, a corruption case), treat it as zero for WAC weighting so the next receipt sets `running_avg = received_unit_cost` rather than producing a non-meaningful weighted blend with negative quantity.

Returns the count of components whose `average_cost` was updated.

**API route**: `POST /api/admin/inventory/recompute-wac`, body `{ component_id?: number }`. Gated by `requireAdmin` from [lib/api/admin.ts](../../../lib/api/admin.ts) — `requireModuleAccess` is *not* an admin gate; it only proves module entitlement and org context. Calls the RPC with `p_org_id = adminCheck.orgId` and the optional `component_id`. Returns `{ updated: number }`.

UI: a button on the Snapshot tab labeled "Recompute average cost from history" with a confirm dialog. Visible only when `requireAdmin` would pass for the current user (use the existing admin-detection pattern that gates other admin-only buttons in the app). Result toast shows the count.

### Snapshot API + UI

**API change** ([app/api/inventory/snapshot/route.ts](../../../app/api/inventory/snapshot/route.ts)):

- Replace `getEstimatedUnitCostCurrent` with:

```ts
function getEstimatedUnitCost(row): { value: number | null; source: 'wac' | 'list_price' | 'none' } {
  const wac = toNumber(row.inventory[0]?.average_cost);
  if (Number.isFinite(wac) && wac > 0) return { value: wac, source: 'wac' };
  const list = minListPrice(row.suppliercomponents);
  if (list != null) return { value: list, source: 'list_price' };
  return { value: null, source: 'none' };
}
```

- Add `cost_source: 'wac' | 'list_price' | 'none'` to each `InventorySnapshotRow` so the UI and CSV can show provenance.
- Estimated-value calculation already multiplies by `snapshotQuantity`; that math is unchanged.

**UI change** ([components/features/inventory/ReportsSnapshotTab.tsx](../../../components/features/inventory/ReportsSnapshotTab.tsx)):

- Toggle relabeled: **"Show inventory value — Weighted average cost (with list-price fallback)"**.
- New column when toggle is on: `Unit Cost`, formatted, with a small `est.` badge for `cost_source = 'list_price'` rows so users can see which lines are real WAC vs. fallback.
- Drop the "Total Quantity" KPI (it sums mixed UoMs and is meaningless — flagged in the prior audit).
- Add admin-gated button "Recompute average cost from history" (calls the new API route). Hidden for non-admins.

**CSV** ([lib/inventory/snapshot.ts](../../../lib/inventory/snapshot.ts)): add `unit_cost` and `cost_source` columns to the export so a downloaded snapshot tells the same story as the on-screen view.

## Tests

Nine tests, no infrastructure changes (matches existing Vitest setup):

1. **WAC math unit tests** — pure helper `computeNewAverageCost(oldQty, oldAvg, recQty, recCost)`. Table-driven cases:
   - Canonical: `(1000, 5, 1000, 4) → 4.5`
   - Fresh component: `(0, null, 100, 5) → 5`
   - Null received cost: `(100, 5, 50, null) → 5` (unchanged)
   - Zero received cost: `(100, 5, 50, 0) → 5` (unchanged)
   - Negative on-hand: `(-10, 5, 100, 4) → 4` (fresh-start semantics)

2. **Receipt RPC happy path** — receive 1000@R5, receive 1000@R4 against the same component, assert `inventory.average_cost = 4.5` and both transaction rows have populated `unit_cost`.

3. **Receipt RPC depletion-then-receive** — receive 100@R5, issue 90 (separate path; live RPC uses ISSUE), receive 100@R4. Assert final `average_cost ≈ 4.0909` ((10×5 + 100×4) / 110). Proves the WAC update reads on-hand at lock time, not a pre-issue snapshot.

4. **Receipt RPC rejection** — call with `p_quantity = 100`, `p_rejected_quantity = 10`. Assert WAC uses `v_good_quantity = 90`, not the gross 100. Inventory `average_cost` reflects 90 weight.

5. **Receipt RPC missing-inventory-row** — for a component with no existing `inventory` row, receive 50@R3. Assert the new `inventory` row is created with `quantity_on_hand = 50` and `average_cost = 3`.

6. **Non-receipt invariance** — receive 1000@R5, then run an `ADJUSTMENT` (-10), an `ISSUE` (-100), and a `TRANSFER` (-50) in sequence. Assert `average_cost` is still `5.000000` after each.

7. **Snapshot API contract** — three components: one with `average_cost`, one with no avg but a list price, one with neither. Assert response rows have correct `cost_source` and `estimated_value_current_cost`.

8. **Recompute replay correctness** — same scenario as Test 3, but call recompute after to rebuild from history. Assert recompute produces the same `average_cost` as live receipts did. Includes a multi-purchase-and-issuance sequence to exercise the running_qty bookkeeping.

9. **Tenant security** — call `recompute_inventory_average_cost_from_history(other_org_id, ...)` as a user that is a member of `org_a` but not `other_org_id`. Assert the function raises `access denied`. Also assert the seed script with `--org-id` flag refuses to write to a different org's rows.

## Migration & rollout order

1. **Migration A1**: add `inventory_transactions.unit_cost` and `inventory.average_cost` columns (nullable, no defaults).
2. **Migration A2**: replace `process_supplier_order_receipt` with the WAC-aware version (signature unchanged; same nine parameters; `set search_path = public` added). Verify with a single-org receipt locally before applying to live.
3. **Migration A3**: create `recompute_inventory_average_cost_from_history` function with the `is_org_member` guard and `set search_path = public`.
4. **App code part 1 — fallback removal**: remove the manual fallback in [components/features/purchasing/order-detail.tsx:178](../../../components/features/purchasing/order-detail.tsx#L178). Replace with a clean error toast on RPC failure. Land in the same PR as the rest of the app changes.
5. **Seed script**: `npx tsx scripts/seed-inventory-average-cost.ts` (defaults to all orgs). Idempotent; safe to re-run.
6. **App code part 2**: snapshot API change, UI relabel and `Unit Cost` column, recompute button (admin-gated), tests.
7. **Verification on live**: open the Snapshot tab, confirm values look sensible, spot-check a high-value component against the seed source. Run recompute on one component and compare.

**Rollback path (explicit, ordered):**

1. Revert app code (snapshot API, UI, fallback removal, recompute button) — leaves the DB columns + RPC in place but harmless.
2. Replace the receipt RPC with the pre-WAC version (original [20260311141133](../../../supabase/migrations/20260311141133_fractional_purchase_receipts.sql) function body, restored verbatim) — receipts stop reading/writing the new columns.
3. Drop `recompute_inventory_average_cost_from_history`.
4. (Optional) Drop `inventory.average_cost` and `inventory_transactions.unit_cost` columns. Skipping this leaves harmless null columns, which is the safer default for an emergency rollback.

Reverse order matters: dropping the columns *before* reverting the RPC will break receipts (the function references columns that no longer exist). The migration files implementing the rollback should be added in a follow-up if needed; the spec's job is to document the order.

## Verification commands

```
# Local smoke
npm run lint
npx tsc --noEmit
npx vitest run tests/inventory-wac.test.ts

# Live verification
# (open /inventory?tab=reports&snapshot subtab; toggle on; confirm values
#  and check a few rows against seed source — expect WAC for items with
#  recent receipts, list-price fallback otherwise)
```

## Decision points (locked)

| Decision | Locked value |
|---|---|
| Backfill strategy | Hybrid (Option C): seed at "now" using latest receipt price, with admin-triggered recompute-from-history available |
| Cost method | Pure WAC (no FIFO, no lot layers) |
| Landed cost | Out of scope; `unit_cost` sourced from `suppliercomponents.price` at receipt time |
| Negotiated price vs catalog price drift | Known limitation; using catalog price at receipt time. Adding `unit_price` to `supplier_orders` or `supplier_order_receipts` is a future enhancement. |
| Adjustment / Issue / Return / Transfer effect on `avg_cost` | None — `avg_cost` only changes on `PURCHASE` |
| Receipt quantity used for WAC | `v_good_quantity = p_quantity - p_rejected_quantity` (post-rejection) |
| Per-location cost | Not tracked; component-level only |
| Manual receipt fallback in `order-detail.tsx` | Removed in Piece A |
| Admin gate for recompute | `requireAdmin` (not `requireModuleAccess`) |
| Tenancy guard inside SECURITY DEFINER recompute | `auth.role() = 'service_role' OR is_org_member(p_org_id)` |
| `search_path` on new + replaced functions | Explicitly `set search_path = public` |
| Piece B (COGS on issuance) | Deferred to follow-up Linear issue |

## Acceptance criteria

- [ ] `inventory.average_cost` populated for components with receipt history after seed runs (verified by spot-check).
- [ ] Two consecutive receipts at different prices produce the correct WAC in the live DB (canonical R5/R4 → R4.50 case).
- [ ] Depletion-then-receive: receive 100@5, issue 90, receive 100@4 → `average_cost ≈ 4.0909`.
- [ ] Receipt with rejection (`p_rejected_quantity > 0`) uses `v_good_quantity` for WAC weighting; the RETURN transaction row leaves `unit_cost` null and does not move `average_cost`.
- [ ] First-ever receipt for a component creates the `inventory` row with `average_cost = unit_cost`.
- [ ] Snapshot UI shows WAC values; rows with no WAC show list price with `est.` badge; rows with neither show `—`.
- [ ] Adjustment / issue / transfer leave `average_cost` unchanged.
- [ ] Recompute admin button updates `average_cost` from `inventory_transactions` history; replay matches live values for a freshly-seeded component AND for the depletion-then-receive scenario.
- [ ] Recompute function rejects calls from non-org-members with `access denied`.
- [ ] Manual fallback in `order-detail.tsx` removed; RPC failure surfaces a clean error toast.
- [ ] CSV export includes `unit_cost` and `cost_source`.
- [ ] `npm run lint` and `npx tsc --noEmit` pass for the touched area.
- [ ] All nine tests in the test plan pass.

## Rollback / release notes

- All schema changes are additive (nullable columns, new function). The columns are safe to leave in place if app + RPC are reverted.
- Rollback order is **non-trivial**: see "Migration & rollout order > Rollback path" above. Reverting the receipt RPC must precede dropping the columns; otherwise receipts break.
- Seed script is idempotent and only fills NULL rows, so re-deploys don't clobber organic averages.
- If the snapshot UI looks wrong on live after deploy, the immediate user-side mitigation is to flip the "Show inventory value" toggle off — on-hand quantities are unaffected.
- The manual-fallback removal in `order-detail.tsx` changes user-visible failure behavior: RPC errors now surface as toasts instead of silent partial writes. This is intentional — silent partial writes were a tenancy/data-integrity hole.

## Docs to update

- [docs/domains/components/inventory-transactions.md](../../../docs/domains/components/inventory-transactions.md) — add `unit_cost` column and the WAC update behavior on receipts.
- [docs/README.md](../../../docs/README.md) — only if a new domain doc is created (Piece A doesn't require one).
