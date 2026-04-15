# Cutlist-to-Costing Design

**Date**: 2026-04-15
**Status**: Draft
**Scope**: Product-level cutlist layout result → product costing integration

## Problem

The cutlist builder calculates layout results (sheets consumed, edging meters, waste %) but this data is ephemeral — it lives in React state and is lost when the user navigates away. The product costing tab has no awareness of cutlist-derived material costs. Users must manually estimate board and edging costs.

## Goals

1. Persist the cutlist layout result so it survives page navigation
2. Display cutlist-derived material costs (board sheets + edging tape) in the product costing tab
3. Support manual overrides for costing purposes (board usage %, edging padding) — padded cost for pricing
4. Show both "padded" (for pricing) and "actual" (for volume deals) costs side by side
5. Work seamlessly for products that don't use a cutlist (no change to current behavior)

## Out of Scope

- Order-level material assignment and production nesting (separate workstream)
- Configurator → cutlist material flow (the two-tone finish persistence gap)
- Actual cost tracking during production

---

## Design

### 1. Data Model — Cutlist Costing Snapshot

A new table `product_cutlist_costing_snapshots` stores the persisted layout result per product.

```sql
CREATE TABLE product_cutlist_costing_snapshots (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Layout summary
  snapshot_data JSONB NOT NULL,
  -- Hash of the parts data at calculation time (for staleness detection)
  parts_hash TEXT NOT NULL,

  -- Timestamps
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One snapshot per product
  UNIQUE (product_id, org_id)
);
```

**`snapshot_data` JSONB structure:**

```typescript
interface CutlistCostingSnapshot {
  // Per-material board consumption
  boards: {
    material_id: string;
    material_name: string;
    sheet_length_mm: number;
    sheet_width_mm: number;
    sheets_actual: number;       // e.g. 0.691
    board_usage_pct_actual: number; // e.g. 69.1
    board_usage_pct_override: number | null; // e.g. 80 (user override for costing)
  }[];

  // Per-edging-material consumption
  edging: {
    material_id: string;
    material_name: string;
    meters_actual: number;       // e.g. 11.96
    meters_override: number | null;  // fixed meter override (e.g. 13)
    pct_override: number | null;     // percentage padding (e.g. 10 for +10%)
  }[];

  // Backer boards (if lamination with backer is used)
  backer_boards: {
    material_id: string;
    material_name: string;
    sheet_length_mm: number;
    sheet_width_mm: number;
    sheets_actual: number;
  }[] | null;

  // Aggregate stats for reference
  stats: {
    total_parts: number;
    total_pieces: number;
    total_used_area_mm2: number;
    total_waste_area_mm2: number;
    total_cuts: number;
  };
}
```

**Why one row per product (UNIQUE constraint):** A product has one cutlist definition and one costing snapshot. Re-calculating replaces the previous snapshot. Historical tracking is not needed — the cutlist parts themselves are versioned by `updated_at` on `product_cutlist_groups`.

### 2. Parts Hash for Staleness Detection

When the snapshot is saved, a hash is computed from the current cutlist parts data:

```typescript
function computePartsHash(parts: CompactPart[]): string {
  const normalized = parts.map(p => ({
    id: p.id, 
    length_mm: p.length_mm, 
    width_mm: p.width_mm, 
    quantity: p.quantity,
    material_id: p.material_id,
    band_edges: p.band_edges,
    lamination_type: p.lamination_type,
  }));
  return hashString(JSON.stringify(normalized));
}
```

When the costing tab loads, it fetches the snapshot AND the current cutlist groups. It computes the hash of current parts and compares to `parts_hash`. If they differ, the snapshot is stale and a banner is shown.

### 3. Cutlist Builder Changes

#### 3a. Edging Override Controls (Preview Tab)

On the preview tab, below the existing board stats, add edging override fields. For each edging type displayed:

- **Actual meters**: read-only, from layout calculation (e.g. "11.96m")
- **Padding %**: number input, default empty (no padding). When set, the padded value is calculated as `actual × (1 + pct/100)`
- **Fixed override**: number input, default empty. When set, overrides both actual and percentage. Mutually exclusive with padding % — setting one clears the other.
- **Padded meters**: read-only computed display — shows the result of whichever override is active, or actual if none
- **"Reset to auto"**: clears overrides

This follows the same pattern as the existing "Manual %" field for board usage.

#### 3b. Save Flow Enhancement

The existing Save button (top-right) calls `useProductCutlistBuilderAdapter.save()` which POSTs to `/api/products/[productId]/cutlist-groups`. 

Enhanced behavior: when a layout result exists in state at save time, **also persist the costing snapshot** in the same save operation. The save adapter sends both the parts groups AND the snapshot data. The API endpoint handles upserting both.

If no layout has been calculated (user only edited parts without clicking Calculate Layout), only the parts are saved — no snapshot is created or updated.

### 4. Costing Tab Changes

#### 4a. Data Fetching

The `ProductCosting` component adds a new query to fetch the cutlist costing snapshot:

```typescript
const { data: cutlistSnapshot } = useQuery({
  queryKey: ['cutlist-costing-snapshot', productId],
  queryFn: () => authorizedFetch(`/api/products/${productId}/cutlist-costing-snapshot`).then(r => r.json()),
});
```

It also fetches the current cutlist groups to compute the parts hash for staleness detection.

#### 4b. Price Resolution

The snapshot stores `material_id` references. The costing tab resolves these to prices via the existing `suppliercomponents` table:

- Board material_id → component → supplier component → `price` (price per full sheet)
- Edging material_id → component → supplier component → `price` (price per meter or per roll — depends on how the supplier component is set up)

This uses the same price lookup path that BOM costing already uses.

#### 4c. Materials Section Layout

The Materials section in the costing tab splits into two sub-sections when a cutlist snapshot exists:

**Hardware & Components** (non-cutlist BOM items):
Standard BOM lines costed as today — component × qty × unit price. Items where `is_cutlist_item = true` on the BOM are excluded from this section (they're covered by the cutlist section).

**Cutlist Materials** (from snapshot):

| Material | Actual | Padded | Unit Price | Actual Cost | Padded Cost |
|----------|--------|--------|------------|-------------|-------------|
| 16mm Alegria (sheets) | 0.691 | 0.800 | R720.00 | R497.52 | R576.00 |
| 22mm White Edging (m) | 11.96 | 13.16 | R8.50/m | R101.66 | R111.86 |

- **Actual** column: un-padded values from the nesting result
- **Padded** column: with overrides applied (board % override, edging padding)
- **Actual Cost**: actual × unit price (floor price for volume deals)
- **Padded Cost**: padded × unit price (standard cost for pricing)

The **Total Materials** line at the bottom sums hardware subtotal + cutlist padded subtotal. A secondary line shows the actual total in muted text for reference.

#### 4d. Staleness Banner

When parts hash doesn't match:

> "Cutlist parts have been modified since the last layout calculation. Costs may be outdated. [Open Cutlist Builder →]"

Shown as a warning banner above the Cutlist Materials sub-section.

#### 4e. No Snapshot State

When a product has cutlist groups but no snapshot:

> "This product has cutlist parts but no layout has been calculated yet. [Open Cutlist Builder →]"

Shown as an info banner in the Materials section.

### 5. API Endpoints

#### `GET /api/products/[productId]/cutlist-costing-snapshot`

Returns the snapshot for a product, or `{ snapshot: null }` if none exists.

#### `PUT /api/products/[productId]/cutlist-costing-snapshot`

Upserts the snapshot. Called from the cutlist builder save flow. Body:

```json
{
  "snapshot_data": { ... },
  "parts_hash": "abc123"
}
```

#### Enhanced `POST /api/products/[productId]/cutlist-groups`

The existing endpoint is extended to optionally accept a `costing_snapshot` field in the body. If present, it upserts the snapshot in the same request. This keeps the save atomic — parts and snapshot stay in sync.

### 6. Multi-Tenancy

- `product_cutlist_costing_snapshots` has `org_id` column with org-scoped RLS
- API endpoints use `requireProductsAccess()` for auth (same as cutlist-groups)
- RLS policy: `USING (org_id = (SELECT org_id FROM organization_members WHERE user_id = auth.uid()))`

---

## What Changes, What Doesn't

| Area | Change |
|------|--------|
| `product_cutlist_costing_snapshots` table | **New** — stores persisted layout results |
| Cutlist builder preview tab | **Modified** — adds edging override fields |
| Cutlist builder save flow | **Modified** — also persists costing snapshot |
| Product costing tab | **Modified** — cutlist materials sub-section |
| BOM table | **Unchanged** |
| BOL / Overhead | **Unchanged** |
| Products without cutlist | **Unchanged** |
| Order-level nesting | **Out of scope** |

## Edge Cases

- **Product with cutlist but no materials assigned**: snapshot stores material_id as null/default. Costing tab shows the line but with "No price" indicator. User needs to assign materials in the cutlist builder.
- **Supplier price changes**: costing tab always reads current prices from `suppliercomponents`, not cached prices. So if board price changes, costing updates on next page load.
- **Multiple material groups**: each material gets its own row in the cutlist materials table. A product with white doors + black carcass shows two board lines.
- **Backer boards**: shown as a separate line in cutlist materials if present (lamination with backer).
- **Sub-products**: linked sub-products that have their own cutlists are not aggregated — each product manages its own cutlist costing independently.
