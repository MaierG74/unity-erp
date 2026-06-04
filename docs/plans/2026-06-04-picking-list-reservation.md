# Picking List Stock Reservation — Build Spec

- **Status:** Built + applied to production 2026-06-04 (branch `codex/local-picking-reservation`; migration live + functionally smoked, frontend on the branch — not yet merged/deployed). See **Build status (2026-06-04)** at the end.
- **Goal:** Make "picking" stock *reserve* it so picked stock is safe — `available = quantity_on_hand − quantity_reserved`. Issuing draws the reservation **down** (hold → real on-hand deduction, never a double deduction); cancel releases it.
- **Headline scenario:** an order for 16 units → pick reserves 16 (available drops to 0) → issue 4 units × 4 to four different staff in separate batches → each batch deducts 4 from on-hand and releases 4 of the hold → on-hand falls by 16 exactly once and the hold returns to 0.
- **Two-layer model (critical):** the hard pick-hold introduced here (`inventory.quantity_reserved`) is **orthogonal** to the existing *planning earmark* (`component_reservations`, behind the order page's "Reserve Components" button). Do **not** conflate them. UI copy: picking = **"Reserved (held)"**, planning = **"Earmarked"**.
- **Execution:** local desktop only; branch off `origin/codex/integration`. The **live migration apply is gated on Greg** (schema + RLS + behavior change to existing RPCs). See *Edge cases & decision points* for the five product decisions that require sign-off (the big one is **backfill** — whether existing open picking lists should retroactively start holding stock).
- **Related:** complements `docs/plans/2026-03-03-component-stock-reservation.md` (the planning-earmark layer).

---

## Overview & goal

Today, picking stock is a paper artifact with **zero physical effect**. `create_pending_stock_issuance` inserts a `pending_stock_issuances` header plus N `pending_stock_issuance_items` and touches inventory not at all — no availability check, no hold. Two operators can pick the same last 16 units and nothing stops it. `quantity_on_hand` is identical before and after a pick; stock only moves at issue time inside `process_stock_issuance` / `process_manual_stock_issuance`.

The goal: **picking RESERVES stock so picked stock is safe.** Concretely:

- `available = quantity_on_hand − reserved`.
- **Pick** (`create_pending_stock_issuance`) increments the hold and checks availability.
- **Issue** (`complete_pending_stock_issuance` and a new per-batch RPC) draws the hold **down** as it converts to a real `quantity_on_hand` deduction — never a second deduction.
- **Cancel** (`cancel_pending_stock_issuance`) releases the unissued remainder of the hold.
- **Reverse** restores `quantity_on_hand` to the available pool, by design **not** back under a hold.

The headline scenario it must satisfy: pick 16 for an order → available drops 16 → issue 4 each to 4 staff in separate batches → each batch deducts 4 from on-hand and releases 4 of the hold → after the 4th, on-hand has fallen by 16 exactly once and the hold is back to zero.

**Critical pre-existing fact that shapes everything:** there is already a `component_reservations` table in production. It is a **planning-level soft earmark** keyed `UNIQUE(order_id, component_id)`, written by `reserve_order_components` / `reserve_order_component_single` ("Reserve Components" button on the order page), surfaced as `reserved_this_order` / `reserved_by_others` in `get_detailed_component_status`. It is **decoupled from physical movement** — issuance never draws it down, it allows reserving more than physically exists (it only nets out *other* orders' earmarks), and `order_id` is `NOT NULL` so it cannot represent manual (non-order) picks. **This is a fundamentally different concept (soft earmark) from the hard hold the picking feature needs**, and the design must keep them orthogonal rather than overload the one number. User-facing copy: planning layer = **"Earmarked"**, picking layer = **"Reserved (held)"**.

## Recommended data model (pick one approach, justify briefly)

**Chosen: a denormalized `inventory.quantity_reserved` counter (the hard pick-hold), kept in sync exclusively by SECURITY DEFINER RPCs, plus a per-item `quantity_issued` column so a single picking list can be drawn down partially across batches.** The existing `component_reservations` table is **left untouched** as the orthogonal planning/earmark layer.

Alternatives considered and rejected:

- **Derive `reserved = SUM(pending_stock_issuance_items.quantity) WHERE status='pending'`** (no new column). Rejected because (a) it puts a GROUP-BY-over-two-tables on the hottest read path — the picker lists *every* component; (b) partial draw-down breaks it (after issuing 4 of 16 the SUM still says 16 unless you add per-item issued tracking — at which point you've rebuilt a ledger anyway); (c) concurrency: `SELECT SUM(...) FOR UPDATE` can't lock pending rows that don't exist yet during a racing pick, so it can't prevent a double-pick without locking the inventory row regardless.
- **Append-only ledger (`stock_reservations` + `stock_reservation_releases`)**. Rejected as over-engineered for a single-warehouse ERP with no lot/bin tracking; it carries the same hot-path SUM cost unless you *also* cache a balance — i.e. you converge back to the chosen option plus a ledger.

Decisive factors for the chosen approach:

1. **The locking primitive already exists.** Every issuance RPC already does `SELECT ... FROM inventory WHERE component_id = ? FOR UPDATE`. The reserved counter inherits exact-correct concurrency *for free* — the same row lock that serializes on-hand deduction serializes the reserved increment/decrement. The rejected options must lock a row that doesn't yet exist (the pending item) or rebuild a cached balance.
2. **Reads stay O(1) on the hot path.** `lib/db/inventory.ts` already selects the inventory row; `available_quantity` becomes `on_hand − reserved` with no new join.
3. **It composes with, not fights, the existing planning layer.** `quantity_reserved` = physically held by picking lists; `component_reservations` = order-level paper earmark. The order page can show both.
4. **Partial draw-down is a hard requirement** (the 4×4 scenario) and forces per-item issued tracking *regardless* of model — which erases the derived approach's only advantage while keeping its cost.

The one real cost is drift risk on the denormalized counter. It is bounded: all writes go through four SECURITY DEFINER RPCs, and a one-query invariant makes drift detectable and auto-correctable (see Verification + Risks).

### Schema changes

```sql
-- A. The hard-hold counter (the picking "Reserved (held)" quantity)
ALTER TABLE public.inventory
  ADD COLUMN quantity_reserved NUMERIC NOT NULL DEFAULT 0
  CHECK (quantity_reserved >= 0);
-- available = quantity_on_hand - quantity_reserved  (NEVER stored)

-- B. Per-item issued progress, so one picking list can be drawn down in batches.
ALTER TABLE public.pending_stock_issuance_items
  ADD COLUMN quantity_issued NUMERIC NOT NULL DEFAULT 0
  CHECK (quantity_issued >= 0 AND quantity_issued <= quantity);
-- this item's current hold contribution = (quantity - quantity_issued) while parent status in ('pending','partially_issued')

-- C. New lifecycle statuses (partial issuance + expiry)
ALTER TABLE public.pending_stock_issuances
  DROP CONSTRAINT IF EXISTS pending_stock_issuances_status_check;
ALTER TABLE public.pending_stock_issuances
  ADD CONSTRAINT pending_stock_issuances_status_check
  CHECK (status IN ('pending','partially_issued','issued','cancelled','expired'));

-- D. Optional expiry support (stale picks squatting on stock)
ALTER TABLE public.pending_stock_issuances
  ADD COLUMN expires_at TIMESTAMPTZ NULL;

-- E. Link a physical issuance back to its picking item (reversal/audit)
ALTER TABLE public.stock_issuances
  ADD COLUMN pending_item_id INTEGER NULL
  REFERENCES public.pending_stock_issuance_items(item_id);
CREATE INDEX idx_stock_issuances_pending_item ON public.stock_issuances(pending_item_id);
```

**The reservation invariant (reconciliation anchor):** for every component in an org,
`inventory.quantity_reserved == COALESCE(SUM(i.quantity − i.quantity_issued), 0)` over `pending_stock_issuance_items i JOIN pending_stock_issuances p ON p.pending_id = i.pending_id WHERE p.status IN ('pending','partially_issued')`.

**Tables that do NOT change:** `component_reservations` (left as the planning earmark), `pending_stock_issuances`/`pending_stock_issuance_items` schema beyond the additive columns above, and `inventory` beyond `quantity_reserved`.

> **DECISION POINT — manual-pick reservations:** because the hold lives on `inventory.quantity_reserved` (order-agnostic), manual (non-order) picks reserve and draw down identically to order picks. This is the reason we do **not** reuse `component_reservations` for picking (its `order_id NOT NULL` cannot represent manual picks). No "make order_id nullable" change is needed. Recommendation: proceed.

## Backend / DB changes

All RPCs are `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`, re-check `is_org_member(<org_id>)`, and force org from the credential/context (`current_org_id()` where a new row is created) — never trust a passed org for cross-tenant reads. Every new function MUST set `search_path` explicitly (the existing `reserve_order_components` trips a mutable-search-path advisor — do **not** copy that; mirror `reserve_order_component_single`, which sets it correctly).

Atomicity model: every pick/issue/cancel path locks `inventory WHERE component_id = ? AND org_id = ? FOR UPDATE` **before** reading `quantity_reserved` and **before** writing it; batch/complete additionally lock the `pending_stock_issuances` header `FOR UPDATE` and each touched item row `FOR UPDATE`. Each RPC is one statement-group inside the implicit function transaction, so a `RAISE EXCEPTION` rolls back the whole batch.

Indicative file paths (line numbers indicative — real branch is `origin/codex/integration`):

- Live function bodies replaced via the migration in *Migration & docs artifacts*.
- Working-tree reference for `process_stock_issuance`: `supabase/migrations/20250102_process_stock_issuance.sql`.

### create_pending_stock_issuance — create → RESERVE

Inside the existing `for v_comp in ...` loop, after the component-in-org check and **before** inserting the item, lock the inventory row, compute true availability, and increment the hold:

```sql
SELECT i.inventory_id, COALESCE(i.quantity_on_hand,0), COALESCE(i.quantity_reserved,0)
  INTO v_inv_id, v_on_hand, v_reserved
FROM public.inventory i
WHERE i.component_id = v_comp.component_id AND i.org_id = v_org
FOR UPDATE;

IF NOT FOUND THEN  -- mirror process_stock_issuance: auto-create a 0/0 row
  INSERT INTO public.inventory (component_id, quantity_on_hand, quantity_reserved, reorder_level, org_id)
  VALUES (v_comp.component_id, 0, 0, 0, v_org)
  RETURNING inventory_id, quantity_on_hand, quantity_reserved
  INTO v_inv_id, v_on_hand, v_reserved;
END IF;

v_avail := v_on_hand - v_reserved;

IF v_comp.quantity > v_avail THEN
  IF p_allow_overpick THEN
    v_to_reserve := GREATEST(v_avail, 0);  -- reserve what's there, record shortfall in notes
  ELSE
    RAISE EXCEPTION 'PICK_OVER_AVAILABLE: component % (available %, requested %)',
      v_comp.component_id, v_avail, v_comp.quantity;
  END IF;
ELSE
  v_to_reserve := v_comp.quantity;
END IF;

INSERT INTO public.pending_stock_issuance_items
  (pending_id, component_id, quantity, quantity_issued, org_id)
VALUES (v_pending_id, v_comp.component_id, v_comp.quantity, 0, v_org);

UPDATE public.inventory
SET quantity_reserved = quantity_reserved + v_to_reserve
WHERE inventory_id = v_inv_id;
```

**New signature** (append params by name so existing callers still bind):
`create_pending_stock_issuance(p_components text, p_external_reference text DEFAULT NULL, p_issue_category text DEFAULT 'production', p_staff_id integer DEFAULT NULL, p_notes text DEFAULT NULL, p_order_id integer DEFAULT NULL, p_allow_overpick boolean DEFAULT false, p_expires_at timestamptz DEFAULT NULL)`.

Keep the existing `EXCEPTION WHEN OTHERS THEN return query select false, sqlerrm` wrapper so a `PICK_OVER_AVAILABLE` surfaces as `success=false, message=…` to the existing `data[0].success` checks in both tabs — no client change for the happy path.

### complete_pending_stock_issuance — complete → RELEASE + DEDUCT (signature unchanged)

Re-implement the body so it issues the **remaining** quantity of every item to the header `staff_id`, and per item **draws the hold down** instead of issuing "fresh" (which would double-count against a now-reserved row). It is the convenience "issue the whole list to one person" wrapper around the same draw-down core as the batch RPC. Per item, under `inventory ... FOR UPDATE`:

1. physical issue of `(quantity − quantity_issued)` via `process_stock_issuance` (order, 7-arg `p_staff_id` overload) or `process_manual_stock_issuance` (manual);
2. `UPDATE inventory SET quantity_reserved = GREATEST(quantity_reserved − issued_now, 0)`;
3. `UPDATE ... SET quantity_issued = quantity` on the item;
4. `UPDATE stock_issuances SET pending_item_id = <item> WHERE issuance_id = <result>`.

The pre-check should compare against **available for other holds** rather than raw on-hand (the stock was already reserved by this very list, so a raw `on_hand >= qty` check can spuriously fail when on-hand is legitimately committed to this pick). After the loop, set header `status='issued'`, `issued_at=now()`, `issued_by=auth.uid()`.

### issue_pending_items_batch — NEW, the 4×4 mechanism (partial draw-down across staff)

The existing `complete_pending_stock_issuance` issues *all* items to *one* header `staff_id`, all-or-nothing — it **cannot** split a reserved list across multiple staff. This new RPC is the explicit change that allows partial draw-down of a reserved list across staff: one call issues a chosen subset of items at chosen quantities to **one** staff member; call it N times for N staff. Each call locks the header `FOR UPDATE`, validates each line against `quantity − quantity_issued` (can't issue more than picked), issues physical stock via the existing audited RPCs, bumps `quantity_issued`, releases exactly that much hold, then recomputes header status (`issued` when every item is fully issued, else `partially_issued`).

```sql
CREATE OR REPLACE FUNCTION public.issue_pending_items_batch(
  p_pending_id    integer,
  p_staff_id      integer,        -- staff for THIS batch (overrides header)
  p_lines         text,           -- jsonb: [{ "item_id": int, "quantity": numeric }, ...]
  p_notes         text DEFAULT NULL,
  p_issuance_date timestamptz DEFAULT now()
)
RETURNS TABLE(success boolean, message text, issuances_created integer, header_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_pending record; v_line record; v_item record; v_result record;
        v_inv_id integer; v_count integer := 0;
BEGIN
  SELECT * INTO v_pending FROM public.pending_stock_issuances
   WHERE pending_id = p_pending_id FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false,'Picking list not found'::text,0,NULL::text; RETURN; END IF;
  IF NOT is_org_member(v_pending.org_id) THEN
    RETURN QUERY SELECT false,'Picking list belongs to another organization'::text,0,NULL::text; RETURN; END IF;
  IF v_pending.status NOT IN ('pending','partially_issued') THEN
    RETURN QUERY SELECT false, format('Picking list already %s', v_pending.status)::text,0,v_pending.status; RETURN; END IF;

  FOR v_line IN
    SELECT (x.item_id)::int AS item_id, (x.quantity)::numeric AS quantity
    FROM jsonb_to_recordset(p_lines::jsonb) AS x(item_id int, quantity numeric)
  LOOP
    IF v_line.quantity IS NULL OR v_line.quantity <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_item FROM public.pending_stock_issuance_items
     WHERE item_id = v_line.item_id AND pending_id = p_pending_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PICK_BATCH_FAILED: item % not on list %', v_line.item_id, p_pending_id; END IF;

    IF v_line.quantity > (v_item.quantity - v_item.quantity_issued) THEN
      RAISE EXCEPTION 'PICK_BATCH_FAILED: item % over-issue (picked %, issued %, batch %)',
        v_line.item_id, v_item.quantity, v_item.quantity_issued, v_line.quantity; END IF;

    SELECT inventory_id INTO v_inv_id FROM public.inventory
     WHERE component_id = v_item.component_id AND org_id = v_pending.org_id FOR UPDATE;

    IF v_pending.order_id IS NOT NULL THEN
      SELECT * INTO v_result FROM public.process_stock_issuance(
        p_order_id => v_pending.order_id, p_component_id => v_item.component_id,
        p_quantity => v_line.quantity, p_purchase_order_id => null,
        p_notes => COALESCE(p_notes, v_pending.notes),
        p_issuance_date => p_issuance_date, p_staff_id => p_staff_id);
    ELSE
      SELECT * INTO v_result FROM public.process_manual_stock_issuance(
        p_component_id => v_item.component_id, p_quantity => v_line.quantity,
        p_notes => COALESCE(p_notes, v_pending.notes),
        p_external_reference => v_pending.external_reference,
        p_issue_category => v_pending.issue_category,
        p_staff_id => p_staff_id, p_issuance_date => p_issuance_date);
    END IF;
    IF NOT COALESCE(v_result.success, false) THEN
      RAISE EXCEPTION 'PICK_BATCH_FAILED: %', COALESCE(v_result.message,'issue error'); END IF;

    UPDATE public.stock_issuances SET pending_item_id = v_item.item_id
     WHERE issuance_id = v_result.issuance_id;

    UPDATE public.inventory                              -- convert hold -> real deduction
       SET quantity_reserved = GREATEST(quantity_reserved - v_line.quantity, 0)
     WHERE inventory_id = v_inv_id;

    UPDATE public.pending_stock_issuance_items
       SET quantity_issued = quantity_issued + v_line.quantity
     WHERE item_id = v_item.item_id;

    v_count := v_count + 1;
  END LOOP;

  UPDATE public.pending_stock_issuances p
     SET status = CASE
        WHEN NOT EXISTS (SELECT 1 FROM public.pending_stock_issuance_items i
                          WHERE i.pending_id = p.pending_id AND i.quantity_issued < i.quantity)
          THEN 'issued' ELSE 'partially_issued' END,
         issued_at = CASE
        WHEN NOT EXISTS (SELECT 1 FROM public.pending_stock_issuance_items i
                          WHERE i.pending_id = p.pending_id AND i.quantity_issued < i.quantity)
          THEN now() ELSE issued_at END,
         issued_by = auth.uid()
   WHERE p.pending_id = p_pending_id
  RETURNING p.status INTO v_pending.status;

  RETURN QUERY SELECT true, format('Issued %s line(s)', v_count)::text, v_count, v_pending.status;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, replace(sqlerrm,'PICK_BATCH_FAILED: ','')::text, 0, NULL::text;
END;
$$;
```

### cancel_pending_stock_issuance — cancel → RELEASE

After the status guard (widen it to allow cancelling `partially_issued`), release **only the unissued remainder** of each item before flipping status (issued quantities already left the hold via draw-down):

```sql
FOR v_item IN
  SELECT component_id, (quantity - quantity_issued) AS remaining
  FROM public.pending_stock_issuance_items
  WHERE pending_id = p_pending_id AND (quantity - quantity_issued) > 0
LOOP
  UPDATE public.inventory
     SET quantity_reserved = GREATEST(quantity_reserved - v_item.remaining, 0)
   WHERE component_id = v_item.component_id AND org_id = v_pending.org_id;
END LOOP;
-- then: UPDATE ... SET status='cancelled', cancelled_at=now(), cancelled_by=auth.uid()
```

### reverse_stock_issuance — NO CHANGE (by design)

Leaves `quantity_reserved` untouched; restores `quantity_on_hand` only. Correct, because reversed stock returns to the **available** pool, not back under a hold. The picking list's `quantity_issued` is also left as-is (the pick was fulfilled; the reversal is an independent return). "Reversal re-opens the pick" is a deliberate future extension, not default.

### Supporting RPCs

- **`expire_stale_pending_issuances()`** — NEW sweeper (callable by Supabase cron / closure-engine scheduler): for each `pending`/`partially_issued` list past `expires_at`, run the cancel release loop and set `status='expired'`. An expired list is an auto-cancelled one; the distinct status preserves history. Org-scope every statement.
- **`reconcile_inventory_reserved()`** — NEW drift guard: `UPDATE inventory.quantity_reserved` to the invariant's expected value for any component where it diverges. This is the chosen-model safety net.

### reserve_order_component_single / reserve_order_components — DECISION POINT, default NO CHANGE

These compute the *planning earmark* and clamp to `on_hand − SUM(other orders' earmarks)`. They do **not** currently subtract the picking hold. Two coherent positions:

- (Recommended for v1) **Leave them.** The picking hold and the planning earmark are orthogonal layers measuring different things; mixing the picking hold into the earmark clamp conflates "physically locked by a pick" with "spoken for on paper." Keep them independent; the order page shows both columns.
- (Alternative) Subtract `quantity_reserved` from the earmark's available base so the planning layer can't earmark stock already physically held by picks. This is defensible but changes the meaning of the existing button — **stop and ask Greg** before doing this.

### Direct-issue path (no picking list) — NO RPC CHANGE

`IssueStockTab` also issues directly via `process_stock_issuance` (≈ line 867) with no picking list. That is an immediate hand-out with no hold to draw down — leave it as a pure on-hand deduction. Only its *displayed* availability changes (front-end, below) so it shows stock already held by other people's picks.

### THE FULL list of views to extend (view-drift)

Because the recommended model adds `quantity_reserved` to `inventory` (it does **not** live only in a side table), every view/MV reading `inventory.quantity_on_hand` for an "available" or "shortage" purpose must be re-issued with `CREATE OR REPLACE` to expose/subtract the hold. `CREATE OR REPLACE VIEW` does **not** auto-pick up the new base column — this is the recurring view-drift trap. Full list:

1. **`v_inventory_with_components`** (plain view) — currently exposes `quantity_on_hand` raw. Add computed `quantity_available = quantity_on_hand − quantity_reserved` (and surface `quantity_reserved`). This is the view several read-sites lean on.
2. **`v_inventory_shortages`** (plain view) — currently `shortage_qty = GREATEST(reorder_level − quantity_on_hand, 0)`. Change to `GREATEST(reorder_level − (quantity_on_hand − quantity_reserved), 0)` so shortages reflect true available; otherwise it under-reports.
3. **`component_status_mv`** (materialized view) — `in_stock = COALESCE(quantity_on_hand,0)`. Add a `qty_reserved = COALESCE(quantity_reserved,0)` column so `in_stock − qty_reserved` is available globally. **Refresh trigger:** `trigger_refresh_component_views()` already fires on `inventory` INSERT/UPDATE/DELETE — since `quantity_reserved` lives on `inventory`, picking writes (which UPDATE `inventory`) already trigger a refresh; no new trigger source needed. Verify the MV's column list is re-created (drop/recreate MV inside the migration; `CREATE OR REPLACE` is not available for materialized views).
4. **`get_detailed_component_status(p_order_id)`** (function, the central availability surface) — already returns `reserved_this_order` / `reserved_by_others` from `component_reservations` and is correct for the per-order earmark view. Its **`global_apparent_shortfall`** uses raw `in_stock` and must additionally subtract the total picking hold once `quantity_reserved`/`component_status_mv.qty_reserved` exists. The per-order `apparent_shortfall` already nets `reserved_by_others` (earmark) and can stay; confirm whether the global figure should net the picking hold (recommended yes).
5. **`compute_customer_order_shortfalls(p_org_id, p_horizon_days)`** (SECURITY DEFINER RPC, Sam's daily brief) — delegates entirely to `get_detailed_component_status`; inherits the fix from item 4, no direct edit.
6. **`get_all_component_requirements()` / `get_global_component_requirements()`** — use `component_status_mv.in_stock` raw for `global_apparent_shortfall`. Subtract `qty_reserved` for an accurate planning picture (medium priority; bulk-planning views).
7. **`get_order_component_status(p_order_id)`** (legacy) — uses raw `in_stock`, no reservation correction. Superseded by `get_detailed_component_status`; **grep for live callers** — if none, leave it; if any, either repoint them or apply the same `qty_reserved` subtraction.
8. **`get_total_component_requirements()`** — joins an inventory alias `quantity AS in_stock` (note: column name `quantity`, not `quantity_on_hand`); likely stale/dead. **Confirm before touching.**

Views that do **not** change (read `inventory_transactions` / product tables, not `inventory.quantity_on_hand`): `inventory_transactions_enriched`, `product_inventory_transactions_with_balance`, `component_allocation_mv`, `component_requirements_mv`.

## Frontend changes

Legend for read-sites: **MUST** = correctness blocker once picks create holds; **display** = desirable, not blocking; **write** = mutates `quantity_on_hand`, needs a guard.

### The single load-bearing mapping (fixes the most consumers at once)

- **`lib/db/inventory.ts`** (≈ line 15 SELECT, ≈ line 51 mapping) — **MUST.** Add `quantity_reserved` to the `SELECT` string; change `available_quantity: Number(item.quantity_on_hand || 0)` to `available_quantity: Number(item.quantity_on_hand || 0) − Number(item.quantity_reserved || 0)` (floor at the display layer if you want to avoid showing negatives, but keep the raw value available so over-issue shows red). This single change propagates true availability into the shared picker and both tabs.

### Picker (shared)

- **`components/features/shared/StockItemSelectionDialog.tsx`** (`AvailabilityBadge` at ≈ 503; reads at ≈ 189/364/432/475/488) — **MUST**, but fixed transitively by `lib/db/inventory.ts` above. Verify the badge now reflects `on_hand − reserved`.

### Order issue path

- **`components/features/orders/IssueStockTab.tsx`**:
  - `inventoryMap` built from raw `quantity_on_hand` (≈ 283–287) and consumed at ≈ 502/509 (board items) and ≈ 569/579 (component items) — **MUST.** Build the map from `available = on_hand − reserved` (subtracting the picking hold). For the operator's *own* pick, you may subtract only *other* holds so they can still issue against their own reservation — but since this tab's direct-issue is hold-agnostic, the simplest correct behavior is to show `on_hand − reserved` and let the batch-issue path validate against the item's own picked quantity.
  - `reserved_this_order` is **not** universally 0 — it is hard-wired 0 only for (a) manual picker-added components (≈ 329) and (b) cutting-board items (≈ 512, `CuttingBoardIssue`); order-linked BOM components correctly read `Number(comp.reserved_this_order ?? 0)` (≈ 582) from `componentRequirements` → `get_detailed_component_status`. Displayed at ≈ 1167–1171. **Wire reserved_this_order:** today this column maps to the *planning earmark*. When picking holds arrive, relabel: show **Reserved (held)** from the new picking hold and (optionally) keep **Earmarked** from `component_reservations`. **DECISION POINT — copy:** avoid two columns both labeled "Reserved"; settle wording with the order-page owner. Recommendation: "Reserved (held)" for the pick hold, "Earmarked" for the planning value.

### Manual issue path

- **`components/features/inventory/ManualStockIssueTab.tsx`** (≈ 65/349/360) — **MUST** (flows from the picker fix). `createPendingMutation` (≈ 501) gains the `p_allow_overpick` / `p_expires_at` params; `completePendingMutation` (≈ 535) signature unchanged. To expose 4×4 here, add a per-batch issue UI calling `issue_pending_items_batch`.

### Order detail page & readiness (mostly already correct)

- **`app/orders/[orderId]/page.tsx`** (≈ 756–763 and ≈ 1090–1094) — already computes `available = max(0, in_stock − reserved_by_others)`. Once picks feed the holds into the global figure (item 4 above), this stays correct for the earmark path; just ensure it reads `metrics.available`, not raw `in_stock`.
- **`components/features/orders/setup-panel/ComponentReadinessSection.tsx`** (≈ 65/126) — **MUST ensure** `metrics.available` is always populated by the RPC and never falls through to the raw `inStock` fallback.
- `setup-panel/ReadinessRow.tsx` (≈ 96–97/177–178) and `OverviewSection.tsx` (≈ 33) — correct once upstream is fixed.
- **`components/features/orders/OrderSlideOutPanel.tsx`** (≈ 131) — displays `metrics.inStock` raw; switch to `metrics.available`.

### Surface "reserved" to users (display, but the point of the feature)

- **Component detail** — `component-detail/OverviewTab.tsx` (≈ 60), `ComponentSidebar.tsx` (≈ 61), `AnalyticsTab.tsx` (≈ 49): raw on-hand display; add a "Reserved (held)" line and show `available = on_hand − reserved`. `TransactionsTab.tsx` (≈ 478/581) already computes `available = on_hand − totalReserved` and is correct.
- **Inventory list / grid** — `ComponentsTab.tsx` (≈ 86–91) + `DataGrid.tsx` status classification (≈ 296–300): classify against `available`, not raw on-hand (medium). `Details.tsx`, `ReportsOverviewTab.tsx`, `ReportsOrderingTab.tsx`: display, medium priority.
- **Dashboard** — `app/dashboard/LowStockAlerts.tsx` (≈ 27/57), `dashboard-logic.ts` (≈ 34), `DashboardKPICards.tsx` (≈ 66–90): compare `available ≤ reorder_level`. **DECISION POINT:** Sam's `getLowStockSummary` (`lib/assistant/operational.ts` ≈ 1299–1330) intentionally uses raw on-hand (physical low-stock, not available). Keep these two definitions consistent or deliberately divergent — recommendation: dashboard "low stock" should use **available** (operator-facing "can I build?"), while Sam's physical low-stock stays raw; **document the divergence**.

### Write-path guards

- **`components/features/inventory/component-detail/StockAdjustmentDialog.tsx`** (≈ 175) and **`hooks/use-update-inventory.ts`** (≈ 17–50) — **write.** Editing `quantity_on_hand` directly can drop it below `quantity_reserved`, making the hold phantom. Add a guard: warn/block when the new level would be below the current `quantity_reserved`. `DataGrid.tsx` inline edit (≈ 164–176) and `InventoryTab.tsx` (≈ 52–196) carry the same caveat.

### Already correct — do NOT touch

`hooks/use-component-stock-summary.ts` (joins `component_reservations`), `lib/assistant/inventory.ts` (computes `available = on_hand − reserved`), `lib/assistant/demand.ts` (via `get_detailed_component_status`), `app/api/order-details/[detailId]/route.ts` (reads reservations), `TransactionsGroupedTable.tsx` / `PrintView.tsx` (via the hook), FG paths (`product_reservations`, separate table), `app/api/inventory/snapshot/route.ts` (historical ledger replay — no live reservation concept), and `supabase/functions/agent-closure-rpc/index.ts` (wraps `compute_customer_order_shortfalls`; inherits the RPC fix, no code change).

> **NOTE** — `use-component-stock-summary` and `lib/assistant/*` read the *planning* `component_reservations` table, which the picking feature does **not** write to. They will **not** auto-reflect picking holds. If product wants the assistant/summary "reserved" to include picking holds, they must additionally read `inventory.quantity_reserved`. **DECISION POINT — stop and ask Greg** whether the assistant's "reserved" should mean earmark only, hold only, or both. Recommendation: report both as distinct figures.

## Headline scenario: pick 16 → reserved → issue 4×4 to 4 staff

Order #N needs 16 units of component C. `inventory` for C: `quantity_on_hand = 16`, `quantity_reserved = 0` → available 16.

1. **Pick 16.** `create_pending_stock_issuance(p_components=[{C,16}], p_order_id=N, p_staff_id=null)`:
   - locks C's inventory row `FOR UPDATE`; `v_avail = 16 − 0 = 16`; `16 ≤ 16` → `v_to_reserve = 16`;
   - inserts header (status `pending`) + item `(quantity=16, quantity_issued=0)`;
   - `UPDATE inventory SET quantity_reserved = 0 + 16 = 16`.
   - **State:** on_hand 16, reserved 16, **available 0.** No physical movement. The picker and every `available` read now show 0 for C — a second operator cannot pick it.

2. **Issue 4 to staff A.** `issue_pending_items_batch(pending_id, p_staff_id=A, p_lines=[{item_id, 4}])`:
   - locks header `FOR UPDATE` (status `pending` ∈ allowed); locks the item row; `4 ≤ (16 − 0)` OK; locks C's inventory row;
   - `process_stock_issuance(order_id=N, component=C, qty=4, staff=A)` → on_hand `16 − 4 = 12`, writes the negative `inventory_transactions` + `stock_issuances` rows;
   - `UPDATE stock_issuances SET pending_item_id = item`;
   - **draw-down:** `UPDATE inventory SET quantity_reserved = GREATEST(16 − 4, 0) = 12`;
   - `UPDATE item SET quantity_issued = 0 + 4 = 4`;
   - header recompute: item still has `quantity_issued (4) < quantity (16)` → status `partially_issued`.
   - **State:** on_hand 12, reserved 12, **available 0**, issued 4. Crucially the draw-down means the 4 leaving on-hand and the 4 leaving the hold are the *same* 4 — no double count; available stayed 0 throughout (the stock was always spoken for, just now physically gone for A).

3. **Issue 4 to staff B**, then **C**, then **D** — three more identical calls. After B: on_hand 8, reserved 8, issued 8. After C: on_hand 4, reserved 4, issued 12. After **D**:
   - on_hand `4 − 4 = 0`; reserved `GREATEST(4 − 4, 0) = 0`; item `quantity_issued = 16`;
   - header recompute: no item with `quantity_issued < quantity` → status `issued`, `issued_at = now()`.
   - **Final state:** on_hand 0, reserved 0, available 0, four `stock_issuances` rows (4 each to A/B/C/D) each linked via `pending_item_id`. On-hand fell by 16 **exactly once**, distributed across four staff, and the hold cleanly returned to zero.

**The RPC change that makes this possible:** the new `issue_pending_items_batch` is the explicit mechanism for partial draw-down of a reserved list across staff — the pre-existing `complete_pending_stock_issuance` issues all items to the single header `staff_id` all-or-nothing and cannot split. `complete_pending_stock_issuance` remains as the "issue everything remaining to one person" convenience, sharing the same per-item draw-down core (issue remaining → release that much hold → bump `quantity_issued`). Double-issue is impossible across racing batches: header `FOR UPDATE` serializes them, the per-line `batch_qty ≤ quantity − quantity_issued` guard caps total issued at the picked total, and the status guard rejects issuing against `issued`/`cancelled`/`expired` lists.

## Edge cases & decision points

1. **Over-pick beyond available** — default **block** at pick time (`PICK_OVER_AVAILABLE`, surfaced as `success=false`). `p_allow_overpick=true` reserves only what's available and records the shortfall, letting an operator deliberately "pick what we have." Stricter than today (today picking can't fail). *Recommendation: ship block-by-default + opt-in overpick.*
2. **Concurrent picks of the last 16** — serialized by `inventory ... FOR UPDATE`; the second pick sees `reserved=16`, `available=0`, and blocks (or short-reserves under overpick). *Recommendation: as designed — this is the decisive reason for the chosen model.*
3. **Negative stock** — `quantity_on_hand` may still go negative via the order-issuance overload (existing TODO behavior, preserved). `quantity_reserved` has `CHECK (>=0)` and every decrement uses `GREATEST(...,0)`, so the hold never goes negative even if on-hand does; `available` may be negative — surface red, never auto-correct. *Recommendation: preserve, make explicit.*
4. **Manual (non-order) picks** — fully supported because the hold is order-agnostic on `inventory.quantity_reserved`. *Recommendation: proceed (this is why we did not reuse `component_reservations`).*
5. **Reversal restores on-hand, not the hold** — reversed stock returns to available; `quantity_issued` left as-is. *Recommendation: default as designed; "reversal re-opens pick" is a future opt-in.*
6. **Editing a pending list** — no edit RPC exists today (UI recreates lists). *Recommendation (simplest): picking lists are immutable; to change, cancel (releases hold) + re-pick.* If inline edit is wanted, add `adjust_pending_item_quantity(p_item_id, p_new_quantity)` that locks item+inventory, applies `delta = new_remaining − old_remaining` to the hold (validating `delta ≤ available` when positive), and forbids `new_quantity < quantity_issued` — **stop and ask Greg** if inline edit is in scope.
7. **Expiry of stale picks** — `expires_at` + `expire_stale_pending_issuances()` sweeper (reuses cancel-release). *Recommendation: build the column + RPC; wiring a cron is optional for v1.*
8. **Backfill of existing open picking lists** — after adding the columns (default 0), should pre-rollout `pending` lists retroactively start holding stock (set `quantity_reserved` from the invariant CTE), or backfill to 0 and only hold lists created after rollout? **STOP AND ASK GREG** — retroactively holding stock can suddenly show items as unavailable across the app. *Recommendation: backfill from the invariant (truthful state), but confirm because it changes visible availability immediately.*
9. **`reserve_order_component_single` / `reserve_order_components` clamp** — whether the planning earmark should subtract the picking hold from its available base. **STOP AND ASK GREG** (changes the meaning of the existing "Reserve Components" button). *Recommendation v1: leave independent.*
10. **Assistant / summary "reserved" semantics** — `use-component-stock-summary` and `lib/assistant/*` read only the planning `component_reservations`; they will not show picking holds unless extended. **STOP AND ASK GREG** whether "reserved" in those surfaces means earmark, hold, or both. *Recommendation: surface both as distinct figures.*
11. **Dashboard low-stock vs Sam's physical low-stock** — two legitimate definitions (available vs physical). *Recommendation: dashboard uses available; Sam stays physical; document the divergence.*
12. **`component_reservations` INSERT policy gap** — its INSERT policy currently has **no `with_check`**, so any authenticated user can insert a reservation for any org. Not introduced by this feature but in the blast radius. *Recommendation: include a one-line policy fix (`with_check = is_org_member(org_id)`) in this migration, or flag separately.*
13. **Legacy/dead RPCs** (`get_order_component_status`, `get_total_component_requirements`) — *Recommendation: grep for callers; only touch if live.*

## Acceptance criteria

1. After picking N units of a component (order or manual), `inventory.quantity_reserved` for that component increases by N and `quantity_on_hand` is unchanged.
2. Every availability read-site shows `available = quantity_on_hand − quantity_reserved`; picking N drops the displayed available by N everywhere the picker, IssueStockTab, ManualStockIssueTab, and order readiness compute availability.
3. A second pick that would exceed `quantity_on_hand − quantity_reserved` fails with a clear "available X, requested Y" message (default), unless `p_allow_overpick=true`, in which case it reserves only the available amount.
4. Issuing a subset of a picked list to one staff member via `issue_pending_items_batch` deducts exactly that quantity from `quantity_on_hand`, reduces `quantity_reserved` by the same quantity, increments the item's `quantity_issued`, and sets the header to `partially_issued` while any item remains unissued.
5. The headline 4×4 scenario ends with `quantity_on_hand` reduced by 16 exactly once, `quantity_reserved` back to its pre-pick value, the item `quantity_issued = 16`, four `stock_issuances` rows each linked by `pending_item_id`, and header status `issued`.
6. `complete_pending_stock_issuance` issues all remaining quantity to the header staff, draws the hold down to zero for that list, and nets to a single on-hand deduction per item (no double count vs the pick).
7. Cancelling a `pending` or `partially_issued` list releases only the unissued remainder from `quantity_reserved` (already-issued stock stays issued) and sets status `cancelled`.
8. `reverse_stock_issuance` increases `quantity_on_hand` and leaves `quantity_reserved` unchanged.
9. The reservation invariant query (Verification) returns zero rows after each of: a pick, a partial batch, a full completion, a cancel, and a reverse.
10. Concurrent picks of the same last-N stock serialize via `FOR UPDATE`; total reserved across both never exceeds `quantity_on_hand`.
11. `quantity_reserved` never goes negative (DB `CHECK` holds under every lifecycle path, including over-completion attempts).
12. `v_inventory_shortages`, `v_inventory_with_components`, and `component_status_mv` reflect `quantity_on_hand − quantity_reserved`; `get_detailed_component_status` global shortfall nets the picking hold.
13. `get_advisors` returns **zero new** RLS / mutable-search-path warnings attributable to the migration.
14. A stock adjustment / inline edit that would set `quantity_on_hand` below the current `quantity_reserved` is blocked or warned (write-path guard).

## Verification

Run from the repo root on the task branch off `codex/integration`.

**Static / build:**
```bash
npm run lint
npx tsc --noEmit   # if pre-existing unrelated TS errors block a clean run, report them rather than treating the task as unverified
```

**Unit tests (pure helpers; no synthetic wage/earnings rows in the live DB — recurring constraint):**
```bash
npx vitest run components/features/orders          # IssueStockTab availability mapping
npx vitest run lib/db                              # inventory.ts available_quantity = on_hand - reserved
```
(If suites for these paths don't yet exist, add focused unit tests for `available_quantity` math and the batch line-validation guard, mocking the supabase client — and remember mocked-client unit tests do NOT catch base-vs-view column drift, so the SQL smoke below is mandatory.)

**Database — apply, then advisors (guardrail; do not apply to live without Greg):**
```text
mcp__supabase__apply_migration   (file below)
mcp__supabase__get_advisors  type=security      # expect zero NEW findings; specifically no mutable-search-path on new fns
mcp__supabase__get_advisors  type=performance   # confirm idx_stock_issuances_pending_item present
mcp__supabase__list_migrations                  # reconcile recorded version vs filename
```

**SQL functional smoke (run via `execute_sql` against a throwaway component in your own org; clean up after — verify zero residual rows in the same response):**
```sql
-- pick 16 -> reserved 16, on_hand unchanged
SELECT * FROM create_pending_stock_issuance('[{"component_id":<C>,"quantity":16}]', 'SMOKE', 'production', NULL, NULL, <ORDER>);
SELECT quantity_on_hand, quantity_reserved FROM inventory WHERE component_id=<C>;   -- expect on_hand=16, reserved=16
-- batch issue 4 to staff A
SELECT * FROM issue_pending_items_batch(<pending>, <staffA>, '[{"item_id":<item>,"quantity":4}]');
SELECT quantity_on_hand, quantity_reserved FROM inventory WHERE component_id=<C>;   -- expect 12 / 12, header partially_issued
-- ...repeat B,C,D -> 0 / 0, header issued
-- invariant (MUST be empty at every step):
WITH held AS (
  SELECT i.component_id, COALESCE(SUM(i.quantity - i.quantity_issued),0) AS should_be
  FROM pending_stock_issuance_items i
  JOIN pending_stock_issuances p ON p.pending_id = i.pending_id
  WHERE p.status IN ('pending','partially_issued') GROUP BY i.component_id)
SELECT inv.component_id, inv.quantity_reserved, COALESCE(h.should_be,0) AS expected
FROM inventory inv LEFT JOIN held h ON h.component_id = inv.component_id
WHERE inv.quantity_reserved <> COALESCE(h.should_be,0);
-- cancel-release + reverse-no-rehold checks similarly, then DELETE smoke rows and re-select to prove none remain
```

**Browser smoke (preview MCP or Claude in Chrome; auth with the test account testai@qbutton.co.za — creds in MEMORY.md; verify `authorizedFetch` vs plain `fetch` for any new UI hitting `/api/...`):**
- `/orders/[orderId]` → **Issue Stock** tab: pick a component, confirm the available badge drops by the picked qty and "Reserved (held)" shows the value; issue a partial batch to one staff and confirm available/reserved/issued update and status flips to partially_issued. Share a screenshot.
- `/inventory` → **Manual Stock Issue** tab: same pick → batch-issue loop via `issue_pending_items_batch`; confirm picker `available_quantity` reflects holds from other lists. Share a screenshot.
- `/orders/[orderId]` order readiness / setup panel: confirm `available` uses `metrics.available` (not raw `inStock`) and reflects the hold.
- API routes to exercise: `POST /api/orders/[orderId]/reserve-components`, `POST /api/orders/[orderId]/reserve-component/[componentId]`, `DELETE /api/orders/[orderId]/release-components` (planning earmark path — confirm still works and is visibly distinct from the picking hold).

## Migration & docs artifacts

**Migration file:** `supabase/migrations/20260604HHMMSS_picking_list_reservation_wiring.sql` (timestamp local ZA UTC+2; if a same-session hotfix is needed, append a later `..._fix_<desc>.sql` per convention). Contents, in order:
1. `ALTER TABLE` for `inventory.quantity_reserved`, `pending_stock_issuance_items.quantity_issued`, `pending_stock_issuances.status` CHECK + `expires_at`, `stock_issuances.pending_item_id` + its index.
2. `CREATE OR REPLACE` the three lifecycle RPCs (`create_` / `complete_` / `cancel_pending_stock_issuance`), `CREATE` `issue_pending_items_batch`, `expire_stale_pending_issuances`, `reconcile_inventory_reserved` — all `SECURITY DEFINER SET search_path = public`.
3. `CREATE OR REPLACE VIEW v_inventory_with_components`, `v_inventory_shortages`; **DROP + CREATE** `component_status_mv` (MV can't be `CREATE OR REPLACE`d); `CREATE OR REPLACE` `get_detailed_component_status` (+ any of items 6–8 confirmed live).
4. Backfill: set `quantity_reserved` from the invariant CTE for existing open lists **only if Greg approves** (edge case 8); otherwise no backfill (defaults 0).
5. (Optional, if approved) `component_reservations` INSERT-policy `with_check` fix (edge case 12).

**Apply + reconcile (guardrail — migration/RLS/schema touches require Greg before live, per CLAUDE.md):**
```text
mcp__supabase__apply_migration  name=picking_list_reservation_wiring  (project ttlyfhkrsjjrzxiagzpb)
mcp__supabase__list_migrations  -> confirm the new version is recorded; note if Supabase's recorded version differs from the filename timestamp
mcp__supabase__get_advisors type=security / type=performance -> zero new findings
```

**Docs to update (canonical-doc rule):**
- `docs/operations/migration-status.md` — append a numbered entry: applied version (actual Supabase-recorded), functional-smoke summary, `get_advisors` zero-warnings confirmation.
- This doc (`docs/plans/2026-06-04-picking-list-reservation.md`) — keep current as the canonical reference for the **two-layer model**: planning earmark (`component_reservations`) vs picking hard hold (`inventory.quantity_reserved`), the lifecycle RPCs, the invariant, and the `available = on_hand − reserved` definition. Linear should link here.
- Do **not** touch `docs/README.md` or `docs/overview/todo-index.md` unless this introduces a materially new workstream (per CLAUDE.md, shared index docs are not updated per-task).

## Risks & rollback

**Risks:**
- **Denormalized-counter drift** (the model's one real cost). Mitigated by: all writes confined to four SECURITY DEFINER RPCs; the DB `CHECK (quantity_reserved >= 0)`; the invariant query as a scheduled/manual guard; and `reconcile_inventory_reserved()` to auto-correct. Run the invariant after every smoke step.
- **Double-deduction if draw-down is mis-wired** — the classic failure mode is treating pick and issue as independent so issuing 4 deducts 4 from on-hand *and* leaves the hold at 16, double-committing stock. The design explicitly releases the hold by the issued amount in the same locked section; AC #5/#6 and the invariant catch any regression.
- **View-drift** — `CREATE OR REPLACE VIEW` not picking up the new `quantity_reserved` column; the MV needing DROP+CREATE not `CREATE OR REPLACE`. Mitigated by the explicit full view list (items 1–8) and the SQL smoke that reads availability *through the views*, not just the base table.
- **Base-vs-view column filter trap** — any new `.eq('quantity_reserved', …)` style filter must target the base `inventory`, not a view; derived columns (e.g. `component_status_mv.qty_reserved`) live only on the view. Mocked-client unit tests won't catch this — the SQL smoke is the guard.
- **Backfill suddenly hides stock** — retroactively holding existing open lists can flip many items to "unavailable" across the UI in one deploy (edge case 8 — gated on Greg).
- **Concurrency correctness** — depends on every path locking the `inventory` row before reading/writing `quantity_reserved`; a path that forgets the lock reintroduces the double-pick race. Code review must confirm the `FOR UPDATE` in each RPC.
- **Guardrails fire** (per CLAUDE.md): this is migration + RLS + schema + auth-adjacent and touches a `/batch`-sized set of read-sites — **requires Greg's approval before applying to live**, and is a `/batch` candidate if the UI relabel ripples across >10 files.

**Rollback:**
- **Functions:** re-deploy the prior bodies of `create_` / `complete_` / `cancel_pending_stock_issuance` and `get_detailed_component_status`, and `DROP FUNCTION issue_pending_items_batch / expire_stale_pending_issuances / reconcile_inventory_reserved`. The lifecycle reverts to "picking is a paper artifact."
- **Views/MV:** `CREATE OR REPLACE` the prior `v_inventory_with_components` / `v_inventory_shortages`; DROP+CREATE the prior `component_status_mv`.
- **Columns:** additive and low-risk to leave in place (`quantity_reserved` defaults 0 → `available` collapses to on-hand once functions are reverted; `quantity_issued`, `expires_at`, `pending_item_id` are inert without the new functions). Prefer leaving columns rather than dropping under load; drop them only in a later, separate, deliberate migration.
- **Frontend:** revert the `lib/db/inventory.ts` mapping and the IssueStockTab/ManualStockIssueTab/readiness edits; with `quantity_reserved` at 0 everywhere, the availability math is identical to today even if a stale build ships.
- **Backfill undo:** if backfill ran and must be undone, `UPDATE inventory SET quantity_reserved = 0` (safe because the reverted functions no longer read it), then re-run `reconcile_inventory_reserved()` after restoring functions if rolling forward again.

## Build status (2026-06-04, Claude Code)

Built on branch `codex/local-picking-reservation` (off `origin/codex/integration`); migrations `20260604120000_picking_list_reservation_wiring` + `20260604130000_picking_reservation_fix_view_security_invoker` **applied to production** (`ttlyfhkrsjjrzxiagzpb`) and functionally smoked — zero residual, reservation invariant clean after every step (see `docs/operations/migration-status.md`). Decisions and deviations from the spec-as-written:

- **Overpick (resolves the spec's internal AC#3-vs-AC#9 conflict):** the spec snippet inserted the item at the *full requested* quantity while reserving only the available amount — that breaks the invariant and over-releases another list's hold on cancel/issue/expire. The build stores the item at **what was actually reserved** (`v_to_reserve`); the shortfall goes to the header notes; a 0-available line is skipped. The invariant holds under overpick. (UI keeps `p_allow_overpick=false`.)
- **RLS gap (edge case 12) — NOT a gap:** the live `component_reservations` INSERT policy already has a valid `with_check`; the proposed "fix" was dropped.
- **Backfill (edge case 8): omitted** (Greg). Existing open lists do not retroactively hold; `reconcile_inventory_reserved()` is the one-call path to backfill later.
- **Earmark clamp (decision 9): unchanged** (Greg) — `reserve_order_component(s)` stay independent.
- **Assistant "reserved" (decision 10): both figures** (Greg) — `use-component-stock-summary` / `lib/assistant/inventory` surface the picking hold as a distinct figure alongside the earmark; `lib/assistant/operational` low-stock stays raw-physical.
- **Order-readiness + Sam's brief stay earmark-based** (Greg, per the spec's "order detail page" section) — the picking hold surfaces in the picker, global shortfall, component detail, inventory grid, and dashboard; the per-order "Available" reflects the planning earmark.
- **Hardening beyond the spec:** deterministic `component_id` lock ordering (ABBA-deadlock), batch missing-inventory guard, IssueStockTab null-staff guard, and `security_invoker=true` on the two re-issued views (hotfix `20260604130000` — `CREATE OR REPLACE VIEW` had reset them to DEFINER).
- **Dead RPCs** `get_order_component_status` / `get_total_component_requirements` (zero callers; the latter is broken) left untouched.
