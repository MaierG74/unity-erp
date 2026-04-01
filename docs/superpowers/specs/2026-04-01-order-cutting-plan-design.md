# Order-Level Cutting Plan

**Date:** 2026-04-01
**Status:** Draft (v2 — addresses Codex review findings)
**Depends on:** BOM Snapshot Purchasing Integration (completed 2026-03-31)

## Problem

When an order contains multiple products (e.g., 10 cupboards + 10 tables), the BOM snapshot stores a naive per-product board quantity (e.g., "2 sheets per cupboard × 10 = 20 sheets"). The real quantity depends on how panels from different products nest together on shared sheets. Cross-product nesting routinely saves 15–25% on board costs — the most expensive material in furniture manufacturing.

The cutting optimizer already solves this problem at the product level. But it has no order-level integration: users can't run it across an entire order, and purchasing can't read its output.

## Solution Overview

A new **Cutting Plan** tab on the order page lets the user:
1. Aggregate all cutlist parts across every product on the order
2. Run the existing packing optimizer (fast / balanced / SA quality)
3. Review the result: sheets per material, waste %, savings vs BOM estimate
4. Confirm — persisting optimized quantities so purchasing uses them instead of naive BOM multiplication

The cutting plan becomes the source of truth for all cutlist-derived materials: primary boards, backer boards, and edge banding.

---

## Data Model

### New column: `orders.cutting_plan`

```sql
ALTER TABLE orders
  ADD COLUMN cutting_plan jsonb;

COMMENT ON COLUMN orders.cutting_plan IS
  'Optimized cutting plan from order-level nesting. NULL = no plan generated.
   When present and not stale, purchasing RPCs use component_overrides
   instead of naive BOM quantities for cutlist materials.';
```

### JSONB Shape

```jsonc
{
  "version": 1,
  "generated_at": "2026-04-01T10:00:00Z",
  "optimization_quality": "fast",  // "fast" | "balanced" | "quality"
  "stale": false,                  // true when products change after generation
  "source_revision": "abc123",     // hash of order_details state at generation time

  "material_groups": [
    {
      "board_type": "16mm",
      "primary_material_id": 315,       // component_id
      "primary_material_name": "White Melamine 16mm",
      "backer_material_id": 320,        // nullable — included in grouping key
      "backer_material_name": "Supawood 3mm",

      // Purchasing-relevant quantities:
      "sheets_required": 16,            // primary boards needed
      "backer_sheets_required": 8,      // backer boards needed
      "edging_by_material": [
        {
          "component_id": 401,
          "component_name": "White PVC 16mm",
          "thickness_mm": 16,
          "length_mm": 30000,
          "unit": "mm"
        },
        {
          "component_id": 402,
          "component_name": "White PVC 32mm",
          "thickness_mm": 32,
          "length_mm": 12500,
          "unit": "mm"
        }
      ],

      // Context for review and PDF:
      "total_parts": 52,
      "waste_percent": 11.8,
      "bom_estimate_sheets": 20,        // naive BOM count for comparison
      "bom_estimate_backer_sheets": 10,
      "layouts": [ /* SheetLayout[] — full packing result for diagram */ ],
      "stock_sheet_spec": { "length_mm": 2750, "width_mm": 1830 }
    }
  ],

  // Structured overrides for RPC — NOT a flat component_id → qty map.
  // Each entry carries unit and source so the RPC can safely merge with BOM demand.
  "component_overrides": [
    { "component_id": 315, "quantity": 16,    "unit": "sheets", "source": "cutlist_primary" },
    { "component_id": 320, "quantity": 8,     "unit": "sheets", "source": "cutlist_backer" },
    { "component_id": 401, "quantity": 30000, "unit": "mm",     "source": "cutlist_edging" },
    { "component_id": 402, "quantity": 12500, "unit": "mm",     "source": "cutlist_edging" }
  ]
}
```

### Key Design Decisions (from Codex review)

**Structured overrides, not flat map (P0 fix):** `component_overrides` is an array of objects with `component_id`, `quantity`, `unit`, and `source`. This prevents the dangerous case where the same component ID appears in both the cutting plan (as a board) and the BOM (as hardware) — the RPC can distinguish by source and only override cutlist-sourced demand. The `unit` field prevents mixed-unit ambiguity (sheets vs mm).

**Backer in grouping key (P0 fix):** Material groups are keyed by `board_type + primary_material_id + backer_material_id`. Two groups with the same primary board but different backers (e.g., Supawood 3mm vs MDF 6mm) pack separately and generate separate backer overrides.

**Source revision for confirm safety (P0 fix):** The `aggregate` endpoint returns a `source_revision` — a hash of the order details state (detail IDs + quantities + cutlist snapshot hashes). The `PUT` confirm endpoint rejects the save if the current revision doesn't match, preventing stale data from being marked fresh.

**NUMERIC columns in RPCs (P0 fix):** The `get_detailed_component_status` RPC must use NUMERIC for `order_required` and `total_required` columns (currently INT). Edging quantities are fractional; truncating to INT would distort shortfall calculations. This is a migration change.

### Why order-level, not per-detail

The cutting plan is inherently order-scoped: panels from different products share sheets. Storing it on `orders` rather than `order_details` reflects this — the plan is a single optimization run across all order lines.

---

## Cutting Plan Tab

New tab on the order detail page, positioned between "Job Cards" and "Procurement" in the tab bar.

### Four States

**Hidden:** Order has no cutlist items (pure hardware order). Tab is not shown.

**Empty:** Order has cutlist items but no plan generated yet.
- Centered empty state with "Generate Cutting Plan" button
- Quality picker dropdown: Fast (<1s) / Balanced (~5s) / Quality SA (variable)
- Brief explanation: "Optimize board usage across all products on this order"

**Stale:** Products changed since last generation.
- Orange warning banner: "Cutting Plan Outdated — Products have changed since this plan was generated. Re-generate to update material requirements."
- Previous results shown dimmed below the banner
- "Re-generate" button in the banner
- Purchasing falls back to naive BOM quantities while stale

**Fresh:** Optimization complete and current.
- Summary cards: Total Sheets (with BOM comparison), Waste %, Total Parts, Quality/Time
- Material breakdown table per group:
  - Material name, type (primary/backer), parts count
  - **Sheets** (optimized) vs **BOM Est.** (naive, struck through)
  - **Saving** column (e.g., "−4 sheets")
  - Waste %, edging meters
- Actions: Export PDF, View Sheet Layouts, Re-optimize (with quality picker)
- Footer: generation timestamp, quality used, confirmation status

### View Sheet Layouts

Built from the existing `SheetLayoutGrid` and `CuttingDiagramPDF` primitives as a purpose-built read-only viewer. The `CutlistCalculator` component does not support a read-only mode and includes editing controls (materials, parts, import, recalc, billing) that are not appropriate here. The viewer renders the `SheetLayout[]` from the saved cutting plan with color-coded panels, placement labels, and waste visualization.

### PDF Export

Reuses the existing `CuttingDiagramPDF` component. The layouts stored in `cutting_plan` contain the same `SheetLayout[]` structure the PDF renderer already consumes.

---

## Order-Level Cutlist Adapter

New adapter following the existing pattern (`useProductCutlistBuilderAdapter`, `useQuoteCutlistAdapterV2`).

### Load Flow

1. Fetch `order_details` with `cutlist_snapshot` and `quantity` for the order
2. Aggregate parts across all details, multiplying by line quantity
3. **Namespace part IDs** by prefixing with `${order_detail_id}-` to prevent collisions when the same product appears on multiple order lines. Preserve the original part ID as metadata for traceability.
4. Group by `board_type + primary_material_id + backer_material_id` (three-part key, not two)
5. Convert aggregated parts to `CutlistCalculatorData` format using the **full effective part model** — including `edging_material_id`, `lamination_config`, `material_thickness`, and all fields the calculator depends on (not just the minimal snapshot shape)
6. Feed to the existing packing algorithms

### Stock Sheet Resolution

The adapter needs to know what stock sheet sizes are available for each material. Source: `suppliercomponents` joined to `components` for board-type components, filtered by the material IDs in the cutlist groups. Falls back to a default sheet size (2750×1830mm) if no supplier sheets are configured.

**Stock quantity cap:** The current calculator defaults to `qty: 10` for stock sheets, which limits large orders. The order-level adapter must set stock sheet quantity to a reasonable upper bound based on the naive BOM estimate (e.g., `bom_estimate_sheets × 1.5`, minimum 20) so the packer doesn't emit false unplaced-part errors.

### Save Flow

1. Packing runs client-side via existing algorithms (guillotine/strip/SA)
2. User reviews the result in the Cutting Plan tab summary
3. User clicks "Confirm" — client builds `cutting_plan` JSONB from **both** the `LayoutResult` and the full calculator state:
   - `LayoutResult` provides: sheets, placements, waste stats, unplaced parts
   - Calculator state provides: per-material edging totals (by material, not just thickness), edging component IDs, stock sheet specs used
   - Build structured `component_overrides` array with unit and source tags
   - Compute `bom_estimate_sheets` by summing naive BOM quantities for comparison
   - Include `source_revision` from the aggregate response
4. `PUT /api/orders/[orderId]/cutting-plan` with the full JSONB
5. Server validates `source_revision` matches current state; rejects if stale
6. Invalidate query cache for order components/procurement

---

## Invalidation

### Triggers

Any mutation that changes order composition, `bom_snapshot`, or `cutlist_snapshot`:
- Product added to or removed from the order
- Order detail quantity changed
- Cutlist snapshot edited (per-line cutlist PATCH)
- BOM substitution changed (re-configuration of a product)

### Mechanism

When a trigger fires, the API sets `orders.cutting_plan.stale = true` (JSONB patch via `jsonb_set()`). The full plan data is preserved so the user can see what changed.

### Centralized Helper

Rather than hooking individual routes (which are spread across different files and may be missed), implement a shared helper:

```typescript
// lib/orders/cutting-plan-utils.ts
export async function markCuttingPlanStale(orderId: number, supabase: SupabaseClient) {
  await supabase.rpc('mark_cutting_plan_stale', { p_order_id: orderId });
}
```

Backed by a Postgres function:

```sql
CREATE OR REPLACE FUNCTION mark_cutting_plan_stale(p_order_id INT)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE orders
  SET cutting_plan = jsonb_set(cutting_plan, '{stale}', 'true'::jsonb)
  WHERE order_id = p_order_id
    AND cutting_plan IS NOT NULL
    AND (cutting_plan->>'stale')::boolean IS DISTINCT FROM true;
END;
$$;
```

This avoids race conditions (the `IS DISTINCT FROM` guard is idempotent) and provides a single point of truth for the staleness rule.

### Mutation Surfaces to Hook

- `POST /api/orders/[orderId]/add-products` — after inserting new details
- `DELETE` and `PATCH` in `app/api/order-details/[detailId]/route.ts` — the actual route for quantity changes and deletions
- `PATCH /api/orders/[orderId]/details/[detailId]/cutlist` — cutlist snapshot edits
- Any future endpoint that modifies `order_details` rows for an order

---

## Purchasing RPC Integration

### Splitting Cutlist vs Non-Cutlist Demand

The core safety requirement: the RPC must **not** blindly replace all demand for a component ID that appears in `component_overrides`. The same component could appear as both a cutlist item (board material) and a non-cutlist item (e.g., used as a shelf material in a different product's hardware BOM).

**Approach:** The BOM snapshot already contains `is_cutlist_item: boolean` per entry. The RPC splits demand into two streams:

1. **Cutlist demand** — BOM entries where `is_cutlist_item = true`. If cutting plan exists and is fresh, these are entirely replaced by `component_overrides`.
2. **Non-cutlist demand** — BOM entries where `is_cutlist_item = false`. Always calculated from BOM snapshot, never overridden.

Final requirement per component = cutlist override (if available) + non-cutlist BOM demand.

### `get_detailed_component_status` Changes

The `order_components` CTE becomes:

```
For the target order:
  1. Load orders.cutting_plan
  2. Calculate non-cutlist demand from bom_snapshot (WHERE is_cutlist_item = false)
  3. If cutting_plan exists AND stale = false:
     - For cutlist components: use component_overrides quantities
  4. Else:
     - For cutlist components: use bom_snapshot quantities (WHERE is_cutlist_item = true)
  5. Sum both streams per component_id
```

### Column Type Change

`order_required` and `total_required` must be changed from `INT` to `NUMERIC` to support fractional edging quantities. This is a breaking change to the RPC signature — the TypeScript layer already handles these as `Number()` so no client changes needed.

### `reserve_order_components`

Same split pattern: non-cutlist demand always from BOM, cutlist demand from cutting plan when available.

---

## API Endpoints

### New

**`GET /api/orders/[orderId]/cutting-plan/aggregate`**
- Aggregates cutlist snapshots across all order details
- Groups by `board_type + primary_material_id + backer_material_id`
- Namespaces part IDs by `order_detail_id`
- Carries the **full effective part model** (including `edging_material_id`, `lamination_config`)
- Returns `CutlistCalculatorData`-compatible format plus `source_revision` hash
- The client uses this data to run the packer in-browser

**`PUT /api/orders/[orderId]/cutting-plan`**
- Persists the cutting plan to `orders.cutting_plan`
- Body: the full `cutting_plan` JSONB built client-side
- **Validates `source_revision`** against current order state; returns 409 Conflict if stale
- Sets `stale = false`

**`DELETE /api/orders/[orderId]/cutting-plan`**
- Clears the cutting plan (sets column to null)
- Purchasing reverts to BOM quantities

### Why Client-Side Packing

The packing algorithms (especially SA) run in Web Workers for responsiveness. The existing `CutlistCalculator` handles all optimization client-side with progress feedback. Running server-side would duplicate the engine and lose the interactive SA progress UI. The server's role is data aggregation and persistence only.

### Modified

Existing order detail mutation endpoints call `markCuttingPlanStale()` (see Invalidation section).

---

## Components Tab Integration

The Components tab (`fetchOrderComponentRequirements()`) currently rebuilds per-line quantities directly from `bom_snapshot` and never reads `orders.cutting_plan`. After this feature, it must show **effective requirements** that reflect the cutting plan:

- For cutlist components with a fresh cutting plan: show the optimized quantity
- For all other components: show the BOM snapshot quantity (current behavior)

This avoids confusion where the Components tab shows "20 sheets needed" while Procurement shows "16 sheets needed" because only the RPC reads the cutting plan.

Implementation: `fetchOrderComponentRequirements()` fetches `orders.cutting_plan` alongside order details and applies the same override logic client-side.

---

## Quote-Created Orders

Orders created via `/api/orders/from-quote` currently bypass the `add-products` flow and insert `order_details` with only `product_id`, `quantity`, and `unit_price` — no `bom_snapshot` or `cutlist_snapshot`.

**v1 scope:** Quote-created orders are excluded from the cutting plan feature. The Cutting Plan tab shows a message: "Snapshots required — products on this order were added from a quote without BOM/cutlist snapshots. Re-add products via Add Products to enable cutting plan optimization."

**Future:** Route quote conversion through the snapshot builders so all orders have snapshots.

---

## Scope Boundaries

**In scope:**
- `cutting_plan` JSONB column on orders
- Cutting Plan tab with four states (hidden, empty, stale, fresh)
- Order-level cutlist adapter (aggregate → pack → save)
- Quality picker (fast/balanced/quality)
- Material breakdown table with BOM comparison
- Sheet layout viewer (purpose-built from SheetLayoutGrid primitives)
- PDF export using existing CuttingDiagramPDF
- Source revision validation on confirm
- Centralized invalidation helper (Postgres function + TS wrapper)
- RPC integration with cutlist/non-cutlist demand split
- RPC column type change (INT → NUMERIC)
- Components tab effective-requirements integration
- Reservation integration (same override pattern)
- Quote-created order exclusion with explanatory message

**Out of scope (future enhancements):**
- **Offcut inventory reuse** — Track offcuts as inventory items and feed them as available stock sheets to the packer for future orders. The packer already calculates `SheetOffcutSummary` per sheet but doesn't persist it. This would require changes to the packer's input model to accept partial sheets alongside full boards.
- **Quote conversion with snapshots** — Route `/api/orders/from-quote` through snapshot builders
- **Automatic re-generation** — Background re-pack when products change (currently manual)
- **Per-material quality selection** — Different optimization quality per material group
- **SA time budgeting** — Budget SA optimization time per-order rather than per-material-group to keep total time predictable for large orders
- **Cutting plan templates** — Save/reuse optimization settings across orders
- **Multi-order batching** — Combine cutting plans across multiple orders for shared material purchasing
