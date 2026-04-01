# Order-Level Cutting Plan

**Date:** 2026-04-01
**Status:** Draft
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
  "optimization_quality": "balanced",  // "fast" | "balanced" | "quality"
  "stale": false,                      // true when products change after generation

  "material_groups": [
    {
      "board_type": "16mm",
      "primary_material_id": 315,       // component_id
      "primary_material_name": "White Melamine 16mm",
      "backer_material_id": 320,        // nullable
      "backer_material_name": "Supawood 3mm",

      // Purchasing-relevant quantities:
      "sheets_required": 16,            // primary boards needed
      "backer_sheets_required": 8,      // backer boards needed
      "edging_by_thickness": [
        { "thickness_mm": 16, "length_mm": 30000, "component_id": 401 },
        { "thickness_mm": 32, "length_mm": 12500, "component_id": 402 }
      ],

      // Context for review and PDF:
      "total_parts": 52,
      "waste_percent": 11.8,
      "bom_estimate_sheets": 20,        // naive BOM count for comparison
      "bom_estimate_backer_sheets": 10,
      "layouts": [ /* SheetLayout[] — full packing result for diagram */ ]
    }
  ],

  // Flat lookup for RPC: component_id (string key) → quantity needed
  "component_overrides": {
    "315": 16,       // primary board sheets
    "320": 8,        // backer board sheets
    "401": 30,       // 16mm edging in meters
    "402": 12.5      // 32mm edging in meters
  }
}
```

### Why order-level, not per-detail

The cutting plan is inherently order-scoped: panels from different products share sheets. Storing it on `orders` rather than `order_details` reflects this — the plan is a single optimization run across all order lines.

---

## Cutting Plan Tab

New tab on the order detail page, positioned between "Job Cards" and "Procurement" in the tab bar.

### Three States

**Empty:** No plan generated yet.
- Centered empty state with "Generate Cutting Plan" button
- Quality picker dropdown: Fast (<1s) / Balanced (~5s) / Quality SA (30-60s)
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

Opens the existing `CutlistCalculator` component in read-only mode with the order's packing data pre-loaded. Reuses the sheet viewer, placement visualization, and all existing UI. No new component needed — just an order-level adapter that loads from `cutting_plan.material_groups[].layouts`.

### PDF Export

Reuses the existing `CuttingDiagramPDF` component. The layouts stored in `cutting_plan` contain the same `SheetLayout[]` structure the PDF renderer already consumes.

---

## Order-Level Cutlist Adapter

New adapter following the existing pattern (`useProductCutlistBuilderAdapter`, `useQuoteCutlistAdapterV2`).

### Load Flow

1. Fetch `order_details` with `cutlist_snapshot` and `quantity` for the order
2. Aggregate parts across all details, multiplying by line quantity
3. Group by `board_type` + `primary_material_id` (same logic as existing `export-cutlist` endpoint)
4. Convert aggregated parts to `CutlistCalculatorData` format (parts, stock sheets, edging materials)
5. Feed to the existing packing algorithms

### Stock Sheet Resolution

The adapter needs to know what stock sheet sizes are available for each material. Source: `suppliercomponents` joined to `components` for board-type components, filtered by the material IDs in the cutlist groups. Falls back to a default sheet size (2750×1830mm) if no supplier sheets are configured.

### Save Flow

1. Packing runs client-side via existing algorithms (guillotine/strip/SA)
2. User reviews the result in the Cutting Plan tab summary
3. User clicks "Confirm" — client builds `cutting_plan` JSONB from the `LayoutResult`:
   - Map each material group to its entry with sheet counts, waste stats, layouts
   - Build `component_overrides` map from material IDs + edging component IDs
   - Compute `bom_estimate_sheets` by summing naive BOM quantities for comparison
4. `PUT /api/orders/[orderId]/cutting-plan` with the full JSONB
5. Invalidate query cache for order components/procurement

---

## Invalidation

### Triggers

Any of these actions mark the cutting plan as stale:
- Product added to or removed from the order
- Order detail quantity changed
- Cutlist snapshot edited (per-line cutlist PATCH)
- Product deleted from the order

### Mechanism

When a trigger fires, the API sets `orders.cutting_plan.stale = true` (JSONB patch). This is a lightweight update — the full plan data is preserved so the user can see what's changed.

### Where to Hook

The existing endpoints that modify order details:
- `POST /api/orders/[orderId]/add-products` — after inserting new details
- `DELETE /api/orders/[orderId]/details/[detailId]` — after removing a detail (if exists)
- `PATCH /api/orders/[orderId]/details/[detailId]` — when quantity changes
- `PATCH /api/orders/[orderId]/details/[detailId]/cutlist` — when cutlist edited

Each adds a one-line check: if `orders.cutting_plan` is not null and not already stale, set `stale = true`.

---

## Purchasing RPC Integration

### `get_detailed_component_status`

The `order_components` CTE currently computes requirements from `bom_snapshot`. With the cutting plan, the logic becomes:

```
For the target order:
  1. Load orders.cutting_plan for this order
  2. If cutting_plan exists AND stale = false:
     - For each component in component_overrides: use the override quantity
     - For all other components: use bom_snapshot calculation (unchanged)
  3. If cutting_plan is null or stale:
     - Use bom_snapshot calculation for everything (current behavior)
```

The `component_overrides` values are **order-level totals** (e.g., 16 sheets for the whole order), not per-product quantities. The RPC uses them as absolute values, not multiplied by `order_detail.quantity`.

The `global_requirements` CTE applies the same logic across all open orders — each order's cutting plan (if fresh) overrides its cutlist component quantities.

### `reserve_order_components`

Same pattern: check `cutting_plan.component_overrides` first, fall back to BOM snapshot.

### Component Classification

The RPC doesn't need to know which components are "cutlist items" — it simply checks: "is this `component_id` a key in `component_overrides`?" If yes, use the override. If no, use the BOM calculation. This naturally handles:

- **Hardware** (handles, gas lifts, screws): never in overrides → BOM snapshot
- **Primary boards**: in overrides → optimized sheet count
- **Backer boards**: in overrides → optimized sheet count
- **Edge banding**: in overrides → optimized linear meters

---

## API Endpoints

### New

**`GET /api/orders/[orderId]/cutting-plan/aggregate`**
- Aggregates cutlist snapshots across all order details (extends existing `export-cutlist` logic)
- Returns `CutlistCalculatorData`-compatible format: parts grouped by material, stock sheet specs, edging definitions
- The client uses this data to run the packer in-browser (all optimization happens client-side, consistent with existing CutlistCalculator)

**`PUT /api/orders/[orderId]/cutting-plan`**
- Persists the cutting plan to `orders.cutting_plan`
- Body: the full `cutting_plan` JSONB built client-side from the `LayoutResult`
- Sets `stale = false`

**`DELETE /api/orders/[orderId]/cutting-plan`**
- Clears the cutting plan (sets column to null)
- Purchasing reverts to BOM quantities

### Why Client-Side Packing

The packing algorithms (especially SA) run in Web Workers for responsiveness. The existing `CutlistCalculator` handles all optimization client-side with progress feedback. Running server-side would duplicate the engine and lose the interactive SA progress UI. The server's role is data aggregation and persistence only.

### Modified

Existing order detail mutation endpoints gain a one-line staleness check (see Invalidation section).

---

## Scope Boundaries

**In scope:**
- `cutting_plan` JSONB column on orders
- Cutting Plan tab with three states (empty, stale, fresh)
- Order-level cutlist adapter (aggregate → pack → save)
- Quality picker (fast/balanced/SA)
- Material breakdown table with BOM comparison
- PDF export using existing CuttingDiagramPDF
- View Sheet Layouts using existing CutlistCalculator (read-only)
- Invalidation on product/quantity/cutlist changes
- RPC integration for purchasing (component_overrides)
- Reservation integration (same override pattern)

**Out of scope (future enhancements):**
- **Offcut inventory reuse** — Track offcuts as inventory items and feed them as available stock sheets to the packer for future orders. The packer already calculates `SheetOffcutSummary` per sheet but doesn't persist it. This would require changes to the packer's input model to accept partial sheets alongside full boards.
- **Automatic re-generation** — Background re-pack when products change (currently manual)
- **Per-material quality selection** — Different optimization quality per material group
- **Cutting plan templates** — Save/reuse optimization settings across orders
- **Multi-order batching** — Combine cutting plans across multiple orders for shared material purchasing
