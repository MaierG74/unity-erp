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
  - 2026-04-28 v3 — Codex round 2; switched inventory write to INSERT ... ON CONFLICT DO UPDATE (race-free missing-row), stamped org_id on every receipt insert/upsert, added v_good_quantity = 0 short-circuit, fixed snapshot helper to use getRelationRecord, admin route now combines requireAdmin + resolveUserOrgContext, dropped seed/recompute parity claim.
  - 2026-04-28 v4 — Codex round 3; admin route now asserts owner/admin role in the *target* org (not just any org), receipt RPC writes unit_cost NULL when v_good_quantity <= 0, recompute walk skips PURCHASE rows with quantity <= 0 (defense-in-depth against the same poisoning), separate-read fallback for v_qty_on_hand under full rejection, documented full-rejection RETURN-ledger asymmetry as known pre-existing snapshot-quantity issue.
  - 2026-04-28 v5 — Codex round 4; closed direct-RPC privilege escalation by restricting EXECUTE on recompute_inventory_average_cost_from_history to service_role only (REVOKE FROM authenticated/anon). Route invokes via supabaseAdmin client. Internal is_org_member guard kept as defense-in-depth. Test 12 expanded with EXECUTE-level denial assertion as the load-bearing case.
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
- **Full-rejection RETURN-ledger asymmetry (pre-existing).** When a receipt is fully rejected (`v_good_quantity = 0`), the existing receipt RPC inserts a `PURCHASE` `inventory_transactions` row with `quantity = 0` AND a `RETURN` row with `quantity = -p_rejected_quantity`, while leaving `inventory.quantity_on_hand` unchanged. This means the inverse-replay snapshot logic (`snapshot_quantity = current_qoh − sum(transactions after as_of_date)`) over-counts on-hand by `p_rejected_quantity` for any snapshot date earlier than the rejection. This bug pre-dates the WAC work, affects only quantity replay (not WAC), and is out of scope for Piece A. A separate Linear issue should track fixing the RETURN-row insert (e.g., skip when `v_good_quantity = 0`, or write a paired PURCHASE that nets to zero).

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

2. Adjust the `inventory_transactions` PURCHASE insert (line 218-235) to populate `org_id = v_order.org_id` (the current insert relies on a column DEFAULT for `org_id`; we make it explicit since we are touching the statement) and populate `unit_cost` with the following logic:

   ```sql
   unit_cost = case
     when v_good_quantity > 0 and v_unit_cost is not null and v_unit_cost > 0
       then v_unit_cost
     else null
   end
   ```

   The `v_good_quantity > 0` guard is **load-bearing for recompute correctness**, not just cosmetic. Without it, a full-rejection receipt would write a zero-quantity PURCHASE row with `unit_cost = v_unit_cost`. The recompute replay (which walks `inventory_transactions` and applies the WAC formula on PURCHASE rows) would treat that row as evidence of a priced receipt — and on a fresh component (running_qty = 0) the WAC formula falls into the "old_qty <= 0 → new_avg = received_unit_cost" branch, setting the historical average to a price for stock that never entered inventory. The receipt-RPC fix here is one half; the recompute walk's quantity guard (described below) is the other half. Both together close the hole.

   When this case fires, the WAC update at step 4 also falls back to "preserve current average" because `v_unit_cost` is treated as effectively null in that path.

3. Adjust the rejection-branch RETURN insert (line 263-282): also explicitly stamp `org_id = v_order.org_id`. Leave `unit_cost` null (Piece A only writes `unit_cost` on PURCHASE rows).

4. **Replace the existing `update inventory ...` (line 417) AND the missing-row insert (line 422-426) with a single race-free `INSERT ... ON CONFLICT (component_id) DO UPDATE` statement.** The codebase already has this pattern at [supabase/migrations/20260326000000_inventory_cleanup_tools.sql:127-135](../../../supabase/migrations/20260326000000_inventory_cleanup_tools.sql#L127):

```sql
if v_good_quantity > 0 then
  insert into public.inventory (
    component_id,
    quantity_on_hand,
    location,
    reorder_level,
    org_id,
    average_cost
  )
  values (
    v_comp_id,
    v_good_quantity,
    null,
    0,
    v_order.org_id,
    case when v_unit_cost is not null and v_unit_cost > 0 then v_unit_cost else null end
  )
  on conflict (component_id) do update
  set
    quantity_on_hand = coalesce(public.inventory.quantity_on_hand, 0) + excluded.quantity_on_hand,
    average_cost = case
      when v_unit_cost is null or v_unit_cost <= 0 then public.inventory.average_cost
      when coalesce(public.inventory.quantity_on_hand, 0) <= 0
        or public.inventory.average_cost is null then v_unit_cost
      else (
        coalesce(public.inventory.quantity_on_hand, 0) * public.inventory.average_cost
        + excluded.quantity_on_hand * v_unit_cost
      ) / (coalesce(public.inventory.quantity_on_hand, 0) + excluded.quantity_on_hand)
    end
  returning public.inventory.quantity_on_hand into v_qty_on_hand;
end if;
```

Key points:
- **Single statement** removes the read-then-write race window in v2's two-step `UPDATE ... IF NOT FOUND THEN INSERT`. Two concurrent first-ever receipts cannot both miss the row and then conflict on insert; ON CONFLICT serializes the contested key.
- **`if v_good_quantity > 0`** guard short-circuits the entire inventory write when the receipt is a full rejection (`v_good_quantity = 0`). The RPC's existing `if v_good_quantity < 0` check at [line 146](../../../supabase/migrations/20260311141133_fractional_purchase_receipts.sql#L146) does NOT cover the equality case, so without this guard a full-rejection receipt would create or update an inventory row with no real stock and (in v2) potentially write `average_cost = unit_cost` for a brand-new component. The explicit short-circuit is the only safe behavior — Piece A does not change inventory state on full-rejection receipts.
- **`org_id` is stamped explicitly** on the INSERT branch; the DO UPDATE branch does not need to re-stamp `org_id` because it does not change ownership of the row. (If a multi-tenant collision occurred — same `component_id` exists under a different `org_id` — that would be a pre-existing data-integrity bug, not a Piece A concern.)
- **`v_unit_cost` is read once** at the top of the block and used in the same SQL statement, so no race between supplier-component price and the WAC computation.

5. **Post-rejection `v_qty_on_hand` fallback.** When `v_good_quantity = 0` the upsert is skipped, so `v_qty_on_hand` is never assigned by the upsert's `RETURNING`. Add a read-only fallback so the return shape is preserved:

   ```sql
   if v_good_quantity = 0 then
     select coalesce((
       select quantity_on_hand
       from public.inventory
       where component_id = v_comp_id
     ), 0)
     into v_qty_on_hand;
   end if;
   ```

   `coalesce(..., 0)` covers the case where no inventory row exists (full rejection of a brand-new component); returning `0` is more defensible than null. Current callers appear to read only `return_id` and `goods_return_number`, not `quantity_on_hand`, but preserving the return contract is cheap insurance.

6. The replacement function definition includes `set search_path = public` (the current version omits it — fix while we're touching it). All other behavior — the rejection-return insert, allocation logic, status updates, return shape, grants — is preserved verbatim.

**Edge cases (called out for clarity):**

| Condition | Behavior |
|-----------|----------|
| `old_qty <= 0` or `old_avg IS NULL` | `new_avg = v_unit_cost` (when `v_unit_cost > 0`) |
| `v_unit_cost IS NULL` or `<= 0` | Leave `average_cost` unchanged; `unit_cost` left null on the transaction row |
| `v_good_quantity = 0` (full rejection) | Inventory row not touched; RETURN transaction still inserted by the existing rejection branch |
| `v_good_quantity < 0` | The RPC already raises ([line 146-149](../../../supabase/migrations/20260311141133_fractional_purchase_receipts.sql#L146)); no change needed |
| Two concurrent first-ever receipts | ON CONFLICT serializes; only one INSERT wins, the other follows the DO UPDATE branch |

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

**Privilege boundary — service_role only.**

The recompute RPC is **not** a regular user-callable function. EXECUTE is granted only to `service_role`; `authenticated` and `anon` are explicitly denied. The route is the sole entry point and calls the RPC via the service-role client (`supabaseAdmin` from [lib/supabase-admin.ts](../../../lib/supabase-admin.ts)) — *not* the user's session client. This is the canonical Supabase pattern for SECURITY DEFINER admin RPCs and matches what `lib/api/admin.ts` already imports for other admin-only writes.

```sql
-- After the function definition, replace the default authenticated grant:
revoke execute on function public.recompute_inventory_average_cost_from_history(uuid, int)
  from public, anon, authenticated;

grant execute on function public.recompute_inventory_average_cost_from_history(uuid, int)
  to service_role;
```

This closes the direct-RPC privilege escalation: a plain organization member who is not an admin cannot call `supabase.rpc('recompute_inventory_average_cost_from_history', ...)` from their session client at all — they get a permission-denied error from the EXECUTE check, before the function body even runs. The role-in-target-org check enforced at the route layer becomes the *only* path to admin-gated invocation.

**Authorization guard at function entry (defense-in-depth):**

```sql
if auth.role() <> 'service_role' and not is_org_member(p_org_id) then
  raise exception 'recompute_inventory_average_cost_from_history: access denied';
end if;
```

With EXECUTE restricted to `service_role`, the `auth.role() <> 'service_role'` branch is effectively unreachable in production — the EXECUTE grant gates it first. The check is kept as defense-in-depth in case a future migration accidentally grants EXECUTE back to `authenticated`. The pattern matches the receipt RPC's existing org guard ([line 168](../../../supabase/migrations/20260311141133_fractional_purchase_receipts.sql#L168)) but the EXECUTE grant is the load-bearing privilege boundary.

**Replay algorithm (per component):**

For each component (or only `p_component_id` if provided):

- Walk `inventory_transactions` filtered to that `component_id` and `org_id = p_org_id`, ordered by `transaction_date ASC, transaction_id ASC`.
- Track `running_qty numeric` (starts at 0) and `running_avg numeric` (starts at NULL).
- For **every** row, regardless of type, update `running_qty := running_qty + quantity` (signed; transactions store negative quantities for issues, returns, transfers-out, etc.).
- For `PURCHASE` rows where **`quantity > 0`** only, update `running_avg`:
  - **Skip rows where `quantity <= 0`.** Defense-in-depth alongside the receipt RPC's "write `unit_cost = NULL` when `v_good_quantity <= 0`" rule. Even if a historical zero-quantity PURCHASE row somehow has a non-null `unit_cost` (pre-Piece-A data, or a future bug), the recompute walk refuses to weight WAC by it.
  - Use `inventory_transactions.unit_cost` if not null.
  - Else fall back to `suppliercomponents.price` reached via `supplier_order_receipts.transaction_id → supplier_orders.supplier_component_id → suppliercomponents.price` (best-effort for pre-Piece-A receipts).
  - If still null or `<= 0`, leave `running_avg` unchanged for this purchase.
  - Apply the WAC formula using `old_qty = max(running_qty_before_this_row, 0)` (the value before adding this purchase's signed quantity); rationale below.
- After the walk, write `running_avg` to `inventory.average_cost` for that component. Skip components where `running_avg` ended up null (do not overwrite an existing value with NULL).

**Why the running_qty matters even on non-`PURCHASE` rows:** WAC weights new receipts against the *current* on-hand. If issuance/adjustment rows are skipped, later purchases would be weighted against stock that no longer exists. Concrete case the test plan covers: receive 100 @ R5, issue 90, receive 100 @ R4 → WAC must be `(10 × 5 + 100 × 4) / 110 ≈ 4.0909`, not `4.5`.

**Why `max(running_qty_before, 0)`:** if running_qty went negative (over-issued in the data, a corruption case), treat it as zero for WAC weighting so the next receipt sets `running_avg = received_unit_cost` rather than producing a non-meaningful weighted blend with negative quantity.

Returns the count of components whose `average_cost` was updated.

**API route**: `POST /api/admin/inventory/recompute-wac`, body `{ component_id?: number }`. Three-step gate (the third step is the one Codex round 3 flagged):

1. `requireAdmin(req)` from [lib/api/admin.ts:23](../../../lib/api/admin.ts#L23) — verifies the caller has `owner` or `admin` role in *some* organization (returns `{ user, accessToken }`; **does NOT include `orgId`** and **does NOT prove admin in any specific org**). Returns 403 if the caller is not an admin/owner anywhere.

2. `resolveUserOrgContext({ supabase, userId: adminCheck.user.id, ... })` from [lib/api/org-context.ts:85](../../../lib/api/org-context.ts#L85) — resolves the active `orgId` for this request via JWT / header / preferred-org fallback. The result type ([line 22-29](../../../lib/api/org-context.ts#L22)) includes `role: string | null` (looked up from `organization_members` for that user × org). Returns 400 if no orgId can be resolved.

3. **Assert role-in-target-org**: `if (orgContext.role !== 'owner' && orgContext.role !== 'admin') return 403`. This is the load-bearing check. Without it, a user who is admin in `org_a` but only a member (not admin) in `org_b` could trigger a recompute against `org_b` because step 1 passed (admin somewhere) and step 2 passed (member of org_b). The role check closes that hole at the API layer.

The route then calls the RPC **via the service-role client** (`supabaseAdmin.rpc('recompute_inventory_average_cost_from_history', { p_org_id: orgContext.orgId, p_component_id: body.component_id ?? null })`) — *not* via the user's session client (`ctx.supabase`). This matches the EXECUTE grant: the user's JWT cannot run the function, only the service role can.

Two layers gate access:
- **Route layer** (the only path to invocation): `requireAdmin` + `resolveUserOrgContext` + `orgContext.role in ('owner','admin')` together ensure the caller is an admin/owner of the resolved target org.
- **Database layer** (privilege boundary): `EXECUTE` is granted only to `service_role`, so a direct `supabase.rpc(...)` call from a user's session client returns a permission-denied error regardless of the user's org role.

The RPC's internal `is_org_member` check is defense-in-depth in case the EXECUTE grant is later restored to `authenticated`. With the EXECUTE restriction in place, the only realistic invocation paths are (a) the admin route running `supabaseAdmin.rpc(...)` (where `auth.role() = 'service_role'`, so the OR-clause short-circuits) or (b) a future SQL migration / manual psql session connecting as the service role.

Returns `{ updated: number, org_id: string }`. Including `org_id` in the response makes the scope of the operation auditable.

Note: the spec is intentionally NOT introducing a new `requireAdminInOrg(req, orgId)` helper — that would be a worthwhile refactor but expands scope. Piece A composes the existing helpers and adds an inline role check.

UI: a button on the Snapshot tab labeled "Recompute average cost from history" with a confirm dialog. Visible only when `requireAdmin` would pass for the current user (use the existing admin-detection pattern that gates other admin-only buttons in the app). Result toast shows the count.

### Snapshot API + UI

**API change** ([app/api/inventory/snapshot/route.ts](../../../app/api/inventory/snapshot/route.ts)):

- Replace `getEstimatedUnitCostCurrent` with:

```ts
function getEstimatedUnitCost(row: ComponentSnapshotRow): {
  value: number | null;
  source: 'wac' | 'list_price' | 'none';
} {
  // The Supabase nested `inventory` relation may come back as a single object
  // OR an array, depending on the join shape. Always normalize via
  // getRelationRecord — array indexing here will silently miss WAC values
  // when the relation is returned as a single object (which is the current
  // shape per the inventory-master refactor).
  const inventory = getRelationRecord(row.inventory);
  const wac = toNumber(inventory?.average_cost);
  if (Number.isFinite(wac) && wac > 0) {
    return { value: wac, source: 'wac' };
  }
  const list = minListPrice(row.suppliercomponents);
  if (list != null) {
    return { value: list, source: 'list_price' };
  }
  return { value: null, source: 'none' };
}
```

- Add `average_cost` to the `inventory` relation type in `ComponentSnapshotRow` (alongside `quantity_on_hand`, etc.).
- Add `cost_source: 'wac' | 'list_price' | 'none'` to each `InventorySnapshotRow` so the UI and CSV can show provenance.
- Estimated-value calculation already multiplies by `snapshotQuantity`; that math is unchanged.

**UI change** ([components/features/inventory/ReportsSnapshotTab.tsx](../../../components/features/inventory/ReportsSnapshotTab.tsx)):

- Toggle relabeled: **"Show inventory value — Weighted average cost (with list-price fallback)"**.
- New column when toggle is on: `Unit Cost`, formatted, with a small `est.` badge for `cost_source = 'list_price'` rows so users can see which lines are real WAC vs. fallback.
- Drop the "Total Quantity" KPI (it sums mixed UoMs and is meaningless — flagged in the prior audit).
- Add admin-gated button "Recompute average cost from history" (calls the new API route). Hidden for non-admins.

**CSV** ([lib/inventory/snapshot.ts](../../../lib/inventory/snapshot.ts)): add `unit_cost` and `cost_source` columns to the export so a downloaded snapshot tells the same story as the on-screen view.

## Tests

Fourteen tests, no infrastructure changes (matches existing Vitest setup):

1. **WAC math unit tests** — pure helper `computeNewAverageCost(oldQty, oldAvg, recQty, recCost)`. Table-driven cases:
   - Canonical: `(1000, 5, 1000, 4) → 4.5`
   - Fresh component: `(0, null, 100, 5) → 5`
   - Null received cost: `(100, 5, 50, null) → 5` (unchanged)
   - Zero received cost: `(100, 5, 50, 0) → 5` (unchanged)
   - Negative on-hand: `(-10, 5, 100, 4) → 4` (fresh-start semantics)

2. **Receipt RPC happy path** — receive 1000@R5, receive 1000@R4 against the same component, assert `inventory.average_cost = 4.5` and both transaction rows have populated `unit_cost` AND `org_id`.

3. **Receipt RPC depletion-then-receive** — receive 100@R5, issue 90 (separate path; live RPC uses ISSUE), receive 100@R4. Assert final `average_cost ≈ 4.0909` ((10×5 + 100×4) / 110). Proves the WAC update reads on-hand at lock time, not a pre-issue snapshot.

4. **Receipt RPC partial rejection** — call with `p_quantity = 100`, `p_rejected_quantity = 10`. Assert WAC uses `v_good_quantity = 90`, not the gross 100. Inventory `average_cost` reflects 90 weight. RETURN inventory_transaction row exists with `quantity = -10`, `unit_cost = NULL`, `org_id` stamped.

5. **Receipt RPC full rejection** — call with `p_quantity = 100`, `p_rejected_quantity = 100`. Assert: PURCHASE inventory_transaction row inserted with `quantity = 0` (preserved current behavior), inventory row NOT created if it didn't exist before, existing inventory row NOT modified (`quantity_on_hand` and `average_cost` unchanged), RETURN inventory_transaction row inserted normally.

6. **Receipt RPC missing-inventory-row** — for a component with no existing `inventory` row, receive 50@R3. Assert the new `inventory` row is created with `quantity_on_hand = 50`, `average_cost = 3`, AND `org_id = supplier_orders.org_id`.

7. **Receipt RPC concurrent first-receipt** — two transactions both receive against the same brand-new component (no `inventory` row yet). Assert: no unique-violation error, final `quantity_on_hand` equals the sum of both `v_good_quantity` values, final `average_cost` equals the WAC of the two receipts. (This proves the `INSERT ... ON CONFLICT (component_id) DO UPDATE` is race-safe.)

8. **Non-receipt invariance** — receive 1000@R5, then run an `ADJUSTMENT` (-10), an `ISSUE` (-100), and a `TRANSFER` (-50) in sequence. Assert `average_cost` is still `5.000000` after each.

9. **Snapshot API relation shape** — request the snapshot endpoint against a component whose `inventory` relation comes back as a single object (current Supabase behavior post-master-refactor). Assert `cost_source = 'wac'` is correctly detected when `average_cost` is set on the object. (Regression guard for the `getRelationRecord` vs array-indexing trap.)

10. **Snapshot API contract** — three components: one with `average_cost`, one with no avg but a list price, one with neither. Assert response rows have correct `cost_source` and `estimated_value_current_cost`.

11. **Recompute replay correctness** — same scenario as Test 3, but call recompute after to rebuild from history. Assert recompute produces the same `average_cost` as live receipts did. Includes a multi-purchase-and-issuance sequence to exercise the running_qty bookkeeping. **Note: this test does NOT compare recompute output to seed output**; the two use different algorithms (recompute = full historical replay; seed = latest catalog price). They are not expected to agree on a freshly-seeded component.

12. **Admin route org resolution + tenant security**:
    - **Non-admin** caller hitting the route: returns 403 (from `requireAdmin`).
    - **Admin in org A, no orgId resolvable** for the request: route returns 400.
    - **Admin in org A** with orgId resolved to org A: route succeeds, RPC operates on org A only, response includes `org_id: A`. Spot-check that no rows in org B were touched.
    - **Admin in org A but only a non-admin member of org B**, with `orgId` resolved to org B: route returns 403 (from the role-in-target-org check).
    - **Direct RPC call from a user session client** (bypassing the route) — even an admin in their own org calling `supabase.rpc('recompute_inventory_average_cost_from_history', { p_org_id: own_org, ... })` from the regular `authenticated` JWT: assert the call returns a permission-denied / function-does-not-exist style error (the EXECUTE grant denies it; the function body never runs). This is the load-bearing privilege check.
    - **Direct RPC call from a non-member, non-service-role context** (synthetic for the test, e.g., manually granting EXECUTE temporarily then revoking, or simulating a misconfigured grant): the function-body `is_org_member(p_org_id)` guard raises `access denied`. This is the defense-in-depth check.
    - **Seed script** with `--org-id <other_org>` run by a service-role-less context: refuses or only operates on the specified org's rows.

13. **Recompute skips zero-quantity PURCHASE rows** — pre-seed `inventory_transactions` with a zero-qty PURCHASE row that has a stale non-null `unit_cost = 99` (simulating either pre-Piece-A data or a future bug bypassing the receipt RPC). Then add a normal 100@R5 receipt. Run recompute and assert final `average_cost = 5`, not 99 — the walk must skip the zero-qty row even though its `unit_cost` is not null.

14. **Receipt RPC writes `unit_cost = NULL` on full rejection** — call with `p_quantity = 100`, `p_rejected_quantity = 100` (so `v_good_quantity = 0`). Assert the resulting PURCHASE `inventory_transactions` row has `quantity = 0` AND `unit_cost IS NULL`. Combined with Test 13, this confirms both halves of the zero-quantity PURCHASE poisoning fix are in place.

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
| Receipt with full rejection (`v_good_quantity = 0`) | Inventory row not touched; only the RETURN transaction is written |
| Inventory write form | `INSERT ... ON CONFLICT (component_id) DO UPDATE` (single statement; race-free for concurrent first-ever receipts; matches `transfer_component_stock` pattern) |
| `org_id` on receipt-RPC inserts | Explicitly stamped from `v_order.org_id` on PURCHASE inventory_transaction, RETURN inventory_transaction, and inventory upsert (no DEFAULT reliance) |
| Per-location cost | Not tracked; component-level only |
| Manual receipt fallback in `order-detail.tsx` | Removed in Piece A |
| Admin gate for recompute | `requireAdmin` (role check anywhere) + `resolveUserOrgContext` (orgId resolution AND target-org role) + inline assertion `orgContext.role in ('owner','admin')`; composed in the route, not a single helper |
| `unit_cost` on zero-quantity PURCHASE rows | NULL — the receipt RPC suppresses `unit_cost` when `v_good_quantity <= 0` to avoid poisoning recompute. Recompute also skips PURCHASE rows where `quantity <= 0` for defense-in-depth. |
| `v_qty_on_hand` after full-rejection receipt | Read-only fallback: `select coalesce((select quantity_on_hand from inventory where component_id = v_comp_id), 0)`. No no-op upsert. |
| Full-rejection RETURN-ledger asymmetry | Pre-existing snapshot-quantity bug; documented in Known Limitations; out of scope for Piece A; track separately. |
| Tenancy guard inside SECURITY DEFINER recompute | `auth.role() = 'service_role' OR is_org_member(p_org_id)` (defense-in-depth only; primary boundary is the EXECUTE grant) |
| EXECUTE permission on `recompute_inventory_average_cost_from_history` | `service_role` only; explicitly REVOKE from `public, anon, authenticated`. Closes the direct-RPC privilege escalation path. |
| Recompute invocation from the route | `supabaseAdmin.rpc(...)` (service-role client), not the user's session client |
| `search_path` on new + replaced functions | Explicitly `set search_path = public` |
| Snapshot helper relation access | `getRelationRecord(row.inventory)?.average_cost`, not `row.inventory[0]?.average_cost` (the relation may be a single object) |
| Recompute vs seed parity | Recompute and seed use different algorithms; outputs are NOT expected to match for freshly-seeded components |
| Piece B (COGS on issuance) | Deferred to follow-up Linear issue |

## Acceptance criteria

- [ ] `inventory.average_cost` populated for components with receipt history after seed runs (verified by spot-check).
- [ ] Two consecutive receipts at different prices produce the correct WAC in the live DB (canonical R5/R4 → R4.50 case).
- [ ] Depletion-then-receive: receive 100@5, issue 90, receive 100@4 → `average_cost ≈ 4.0909`.
- [ ] Receipt with partial rejection (`p_rejected_quantity > 0` but less than total) uses `v_good_quantity` for WAC weighting; the RETURN transaction row leaves `unit_cost` null and does not move `average_cost`.
- [ ] Receipt with full rejection (`p_rejected_quantity = p_quantity`, `v_good_quantity = 0`) does NOT touch the inventory row (no insert, no update); only the RETURN transaction is recorded; the resulting zero-quantity PURCHASE inventory_transactions row has `unit_cost IS NULL`; `v_qty_on_hand` in the response equals the existing on-hand (or 0 if no row).
- [ ] Recompute skips PURCHASE rows where `quantity <= 0`, even when `unit_cost` is non-null on the row.
- [ ] Admin route returns 403 for users who are admin in some org but not admin/owner in the resolved target org (the `orgContext.role` check fires).
- [ ] First-ever receipt for a component creates the `inventory` row with `average_cost = unit_cost` AND `org_id = supplier_orders.org_id`.
- [ ] Two concurrent first-ever receipts against the same brand-new component succeed without unique-violation errors; final state matches WAC of both.
- [ ] All `inventory_transactions` rows written by the receipt RPC (PURCHASE and rejection RETURN) carry `org_id = supplier_orders.org_id` explicitly (not via column DEFAULT).
- [ ] Snapshot UI shows WAC values; rows with no WAC show list price with `est.` badge; rows with neither show `—`. Verified end-to-end with the `inventory` relation returned as a single object (the current Supabase shape).
- [ ] Adjustment / issue / transfer leave `average_cost` unchanged.
- [ ] Recompute admin function: replay matches live receipts for the depletion-then-receive scenario. (Recompute is NOT expected to match the seed for freshly-seeded components — they use different algorithms; this is documented as an accepted divergence.)
- [ ] EXECUTE on `recompute_inventory_average_cost_from_history` is restricted to `service_role` only; `authenticated` and `anon` cannot call it directly via `supabase.rpc(...)` even for their own org. Verified in tests by a direct-RPC attempt from a user session client returning permission-denied without the function body running.
- [ ] Recompute function's internal `is_org_member` guard still raises `access denied` if EXECUTE were ever (mis)granted to authenticated — i.e., defense-in-depth holds.
- [ ] Admin route invokes the recompute RPC via the service-role client (`supabaseAdmin`), not the user's session client.
- [ ] Admin route returns 403 for non-admin callers and 400 for admin callers with no resolvable orgId; on success the response includes `org_id` for auditability.
- [ ] Manual fallback in `order-detail.tsx` removed; RPC failure surfaces a clean error toast.
- [ ] CSV export includes `unit_cost` and `cost_source`.
- [ ] `npm run lint` and `npx tsc --noEmit` pass for the touched area.
- [ ] All fourteen tests in the test plan pass.

## Rollback / release notes

- All schema changes are additive (nullable columns, new function). The columns are safe to leave in place if app + RPC are reverted.
- Rollback order is **non-trivial**: see "Migration & rollout order > Rollback path" above. Reverting the receipt RPC must precede dropping the columns; otherwise receipts break.
- Seed script is idempotent and only fills NULL rows, so re-deploys don't clobber organic averages.
- If the snapshot UI looks wrong on live after deploy, the immediate user-side mitigation is to flip the "Show inventory value" toggle off — on-hand quantities are unaffected.
- The manual-fallback removal in `order-detail.tsx` changes user-visible failure behavior: RPC errors now surface as toasts instead of silent partial writes. This is intentional — silent partial writes were a tenancy/data-integrity hole.

## Docs to update

- [docs/domains/components/inventory-transactions.md](../../../docs/domains/components/inventory-transactions.md) — add `unit_cost` column and the WAC update behavior on receipts.
- [docs/README.md](../../../docs/README.md) — only if a new domain doc is created (Piece A doesn't require one).
