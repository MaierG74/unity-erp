---
date: 2026-04-28
status: draft
owner: greg@apexza.net
linear: (filed at end of brainstorming)
related:
  - app/api/inventory/snapshot/route.ts
  - components/features/inventory/ReportsSnapshotTab.tsx
  - supabase/migrations/20260409110000_inventory_snapshot_and_stock_hardening.sql
  - supabase/migrations/20251107_process_supplier_receipt.sql
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

- **Past-date snapshots use today's `average_cost`.** The snapshot for, say, 2026-02-28 multiplies the as-of-date *quantity* by the *current* `average_cost`. That is not strictly the historical valuation — the average may have moved between then and now. For QButton's month-end use case (snapshot taken close to end-of-month), the drift is minimal in practice. A future enhancement could store the per-receipt rolling average on `inventory_transactions` to enable true historical valuation.
- **Catalog price drift** between order placement and receipt — see receipt-RPC section.

## Design

### Schema additions

```sql
alter table inventory_transactions
  add column unit_cost numeric(18,6) null;

alter table inventory
  add column average_cost numeric(18,6) null;
```

Both columns nullable. `unit_cost` is written only on `PURCHASE` transactions in Piece A; remains null on every other transaction type until Piece B. `average_cost` updates only on receipts; preserved across all other operations.

### Receipt RPC update — `process_supplier_order_receipt`

Located in [supabase/migrations/20251107_process_supplier_receipt.sql](../../../supabase/migrations/20251107_process_supplier_receipt.sql). Two changes inside the existing atomic block:

**Source of unit cost.** `supplier_orders` has no price column; the price lives on `suppliercomponents.price`, joined via `supplier_orders.supplier_component_id → suppliercomponents.supplier_component_id`. The RPC already loads `v_order.supplier_component_id`, so it fetches `sc.price` in the same query. That value is the source of `unit_cost` for the receipt.

> **Known limitation, accepted for Piece A:** `suppliercomponents.price` reflects the *current* catalog list price, not necessarily the price negotiated when the supplier order was placed. If the catalog price drifts between order placement and receipt, the WAC will use the receipt-time list price, not the actual paid price. To address this fully, a future iteration could add `unit_price` to `supplier_orders` (price-at-order-time) or `supplier_order_receipts` (price-actually-paid). Out of scope for Piece A.

**Behavior.** Inside the existing atomic block:

1. When inserting the `inventory_transactions` row, populate `unit_cost` from `suppliercomponents.price` (looked up via `supplier_component_id`). If `suppliercomponents.price` is null or `<= 0`, leave `unit_cost` null and skip step 2.

2. Recompute and write `inventory.average_cost`:

```
new_avg = (old_qty * old_avg + received_qty * received_unit_cost)
          / (old_qty + received_qty)
```

Edge cases (must be implemented explicitly, not implicitly):

| Condition | Behavior |
|-----------|----------|
| `old_qty = 0` or `old_avg IS NULL` | `new_avg = received_unit_cost` |
| `received_unit_cost IS NULL` or `<= 0` | Leave `average_cost` unchanged; `unit_cost` left null on the transaction row |
| `old_qty < 0` (negative on-hand corruption) | Treat as fresh: `new_avg = received_unit_cost`; emit a `RAISE WARNING` for the org admin |
| `received_qty <= 0` | Should not occur for a `PURCHASE`; raise an exception |

The RPC continues to run inside the existing `SECURITY DEFINER` block with row-level lock. No new transaction boundaries.

### Seed strategy

One-shot script: `scripts/seed-inventory-average-cost.ts`. For each component (all orgs):

1. The `suppliercomponents.price` of the supplier component referenced by the **most recent received** `supplier_orders` row for that component (i.e., the last receipt's catalog price). Found by joining `inventory_transactions` (PURCHASE) → `supplier_order_receipts` → `supplier_orders` → `suppliercomponents`, ordered by `transaction_date DESC`.
2. Else, `min(suppliercomponents.price)` across all active supplier components for the component, where `price > 0`.
3. Else, leave `inventory.average_cost = NULL`.

Idempotent: running the script twice produces identical state. Only updates rows where `inventory.average_cost IS NULL` so it never clobbers organically-grown averages from receipts that happened post-deploy.

Run order at deploy: migrations → seed script → app code. The seed must run before app code so the snapshot UI does not briefly show NULLs everywhere.

### Recompute admin function

```sql
create function recompute_inventory_average_cost_from_history(
  p_org_id uuid,
  p_component_id int default null
) returns int
```

Returns the number of components updated. Logic:

- For each component (or just `p_component_id`): walk `inventory_transactions` filtered to `org_id = p_org_id` in `transaction_date ASC, transaction_id ASC` order.
- Track `running_qty`, `running_avg`.
- On `PURCHASE` rows, apply WAC formula using `inventory_transactions.unit_cost` if not null. If null (historical receipts from before Piece A), fall back to `suppliercomponents.price` reached via `supplier_order_receipts.transaction_id → supplier_orders.supplier_component_id → suppliercomponents.price`. If still null or `<= 0`, skip the row (do not move the running average).
- Skip non-`PURCHASE` types (they don't move WAC).
- Write final `running_avg` to `inventory.average_cost`. Skip components with no priced receipts (don't overwrite with NULL).

Exposed via `POST /api/admin/inventory/recompute-wac` (org-scoped, gated by `requireModuleAccess`). Optional `component_id` body param.

UI: a button on the Snapshot tab labeled "Recompute average cost from history" with a confirm dialog. Visible only to admins. Result toast shows count.

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
- Add admin-gated button "Recompute average cost from history" (calls the new API route).

**CSV** ([lib/inventory/snapshot.ts](../../../lib/inventory/snapshot.ts)): add `unit_cost` and `cost_source` columns to the export so a downloaded snapshot tells the same story as the on-screen view.

## Tests

Five tests, no infrastructure changes (matches existing Vitest setup):

1. **WAC math unit tests** — pure helper `computeNewAverageCost(oldQty, oldAvg, recQty, recCost)`. Table-driven cases:
   - Canonical: `(1000, 5, 1000, 4) → 4.5`
   - Fresh component: `(0, null, 100, 5) → 5`
   - Null received cost: `(100, 5, 50, null) → 5` (unchanged)
   - Zero received cost: `(100, 5, 50, 0) → 5` (unchanged)
   - Negative on-hand: `(-10, 5, 100, 4) → 4` (fresh-start semantics)

2. **Receipt RPC integration test** — receive 1000@R5, receive 1000@R4 against the same component, assert `inventory.average_cost = 4.5` and both transaction rows have populated `unit_cost`.

3. **Non-receipt invariance** — receive 1000@R5, then run an `ADJUSTMENT` (-10), an `ISSUE` (-100), and a `TRANSFER` (-50) in sequence. Assert `average_cost` is still `5.000000` after each.

4. **Snapshot API contract** — three components: one with `average_cost`, one with no avg but a list price, one with neither. Assert response rows have correct `cost_source` and `estimated_value_current_cost`.

5. **Multi-tenancy** — recompute function and seed script touch only the requested `org_id`; rows in other orgs are unchanged.

## Migration & rollout order

1. **Migration A1**: add `inventory_transactions.unit_cost` and `inventory.average_cost` columns (nullable, no defaults).
2. **Migration A2**: replace `process_supplier_order_receipt` with the WAC-aware version. Verify with a single-org receipt locally before applying to live.
3. **Migration A3**: create `recompute_inventory_average_cost_from_history` function.
4. **Seed script**: `npx tsx scripts/seed-inventory-average-cost.ts`. Idempotent; safe to re-run.
5. **App code**: snapshot API change, UI relabel, recompute button, tests. Land in one PR.
6. **Verification on live**: open the Snapshot tab, confirm values look sensible, spot-check a high-value component against the seed source. Run recompute on one component and compare.

Rollback path: drop the columns. The receipt RPC keeps working (writes to a now-missing column would be removed in the rollback migration); the snapshot falls back to list-price valuation, which is the pre-deploy state.

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
| Per-location cost | Not tracked; component-level only |
| Piece B (COGS on issuance) | Deferred to follow-up Linear issue |

## Acceptance criteria

- [ ] `inventory.average_cost` populated for components with receipt history after seed runs (verified by spot-check).
- [ ] Two consecutive receipts at different prices produce the correct WAC in the live DB (canonical R5/R4 → R4.50 case).
- [ ] Snapshot UI shows WAC values; rows with no WAC show list price with `est.` badge; rows with neither show `—`.
- [ ] Adjustment / issue / transfer leave `average_cost` unchanged.
- [ ] Recompute admin button updates `average_cost` from `inventory_transactions` history; result matches the seed for a freshly-seeded component (proves the historical replay matches the seed strategy).
- [ ] CSV export includes `unit_cost` and `cost_source`.
- [ ] `npm run lint` and `npx tsc --noEmit` pass for the touched area.
- [ ] All five tests in the test plan pass.

## Rollback / release notes

- All schema changes are additive (nullable columns, new function) — receipts continue to work if either column is dropped.
- Seed script is idempotent and only fills `NULL` rows, so a re-deploy doesn't clobber organic averages.
- If the snapshot UI looks wrong on live after deploy, the immediate mitigation is to flip the "Show inventory value" toggle off (it's user-controlled) — the on-hand quantities are unaffected.

## Docs to update

- [docs/domains/components/inventory-transactions.md](../../../docs/domains/components/inventory-transactions.md) — add `unit_cost` column and the WAC update behavior on receipts.
- [docs/README.md](../../../docs/README.md) — only if a new domain doc is created (Piece A doesn't require one).
