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

  -- Full layout snapshot (see JSONB structure below)
  snapshot_data JSONB NOT NULL,
  -- Hash of the full layout input contract at calculation time (for staleness detection)
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
  // Per-sheet layout data (preserves per-sheet billing overrides)
  sheets: {
    sheet_id: string;
    material_id: string;
    material_name: string;
    sheet_length_mm: number;
    sheet_width_mm: number;
    used_area_mm2: number;
    // Per-sheet billing override — mirrors SheetBillingOverride from the calculator
    billing_override: {
      mode: 'auto' | 'full' | 'manual';
      manualPct: number;
    } | null;
  }[];

  // Global billing toggle (charge full sheet for all boards)
  global_full_board: boolean;

  // Per-edging-material consumption
  edging: {
    material_id: string;
    material_name: string;
    thickness_mm: number;
    meters_actual: number;          // e.g. 11.96
    meters_override: number | null; // fixed meter override (e.g. 13)
    pct_override: number | null;    // percentage padding (e.g. 10 for +10%)
    // Resolved price at snapshot time — see section 4b
    unit_price_per_meter: number | null;
    component_id: number | null;
  }[];

  // Per-material board price at snapshot time — see section 4b
  board_prices: {
    material_id: string;
    unit_price_per_sheet: number | null;
    component_id: number | null;
  }[];

  // Backer sheet data (if lamination with backer is used)
  backer_sheets: {
    sheet_id: string;
    material_id: string;
    material_name: string;
    sheet_length_mm: number;
    sheet_width_mm: number;
    used_area_mm2: number;
    billing_override: {
      mode: 'auto' | 'full' | 'manual';
      manualPct: number;
    } | null;
  }[] | null;
  backer_global_full_board: boolean;
  backer_price_per_sheet: number | null;

  // Calculator settings at calculation time (product-scoped snapshot of what was used)
  // These make the snapshot self-contained — no dependency on user-scoped material defaults
  calculator_inputs: {
    primaryBoards: {
      id: string;
      name: string;
      length_mm: number;
      width_mm: number;
      cost: number;
      isDefault: boolean;
      component_id?: number;
    }[];
    backerBoards: {
      id: string;
      name: string;
      length_mm: number;
      width_mm: number;
      cost: number;
      isDefault: boolean;
      component_id?: number;
    }[];
    edging: {
      id: string;
      name: string;
      thickness_mm: number;
      width_mm: number;
      cost_per_meter: number;
      isDefaultForThickness: boolean;
      component_id?: number;
    }[];
    kerf: number;
    optimizationPriority: 'fast' | 'offcut' | 'deep';
  };

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

**Why per-sheet data:** The existing calculator stores billing overrides (`SheetBillingOverride`) per sheet via `sheetOverrides: Record<string, SheetBillingOverride>`. On a multi-sheet material, the user may set sheet 1 to "charge full" and sheet 2 to "manual 80%". Collapsing to a per-material override would lose these inputs. The snapshot preserves the full per-sheet model; the costing tab derives material-level totals by summing across sheets (using `computeSheetCharge` logic).

**Why `calculator_inputs` is stored:** Material settings (boards, edging, kerf) come from `cutlist_material_defaults`, which is **user-scoped** — each user has their own saved defaults. Without storing the inputs that produced this snapshot, two users viewing the same product would see different staleness results depending on their personal defaults, and the snapshot's prices wouldn't be reproducible. Storing `calculator_inputs` makes the snapshot fully self-contained and deterministic.

**Why one row per product (UNIQUE constraint):** A product has one cutlist definition and one costing snapshot. Re-calculating replaces the previous snapshot.

### 2. Staleness Detection

**Problem with hashing all inputs:** The layout result depends on parts, board definitions, edging defaults, kerf, and optimization priority. However, only the parts are product-scoped (persisted in `product_cutlist_groups`). Board/edging/kerf settings come from `cutlist_material_defaults`, which is **user-scoped** — each user has their own saved defaults. If the staleness hash included material settings, two users would see different stale/fresh results for the same product, and even the same user could flip the banner by changing personal defaults.

**Solution:** Staleness detection is narrowed to **product-scoped data only** — the parts stored in `product_cutlist_groups`. The material/settings state that produced the layout is baked into the snapshot via `calculator_inputs` (see section 1), making the snapshot self-contained regardless of who views it.

```typescript
function computePartsHash(parts: CompactPart[]): string {
  const normalized = parts.map(p => ({
    id: p.id,
    length_mm: p.length_mm,
    width_mm: p.width_mm,
    quantity: p.quantity,
    material_id: p.material_id,
    grain: p.grain,
    band_edges: p.band_edges,
    lamination_type: p.lamination_type,
    lamination_group: p.lamination_group,
    edging_material_id: p.edging_material_id,
  }));
  return hashString(JSON.stringify(normalized));
}
```

The DB column is renamed from `parts_hash` to `parts_hash` to reflect this scope.

**When the costing tab loads:** It fetches the snapshot and the current `product_cutlist_groups`. It reconstructs `CompactPart[]` from the groups (using `flattenGroupsToCompactParts`), computes the parts hash, and compares to `parts_hash`. If they differ → "parts have changed" stale banner.

**Material drift detection (secondary, non-blocking):** The costing tab can also compare the snapshot's `calculator_inputs` board/edging prices against current `suppliercomponents` prices (via the stored `component_id`). If prices have changed, show a subtle "prices may have changed since last calculation" note — but this is informational, not a staleness gate.

### 3. Cutlist Builder Changes

#### 3a. Edging Override Controls (Preview Tab)

On the preview tab, below the existing board stats, add edging override fields. For each edging material in the `edgingByMaterial` summary:

- **Actual meters**: read-only, from layout calculation (e.g. "11.96m")
- **Padding %**: number input, default empty (no padding). When set, the padded value is calculated as `actual × (1 + pct/100)`
- **Fixed override**: number input, default empty. When set, overrides both actual and percentage. Mutually exclusive with padding % — setting one clears the other.
- **Padded meters**: read-only computed display — shows the result of whichever override is active, or actual if none
- **"Reset to auto"**: clears overrides

This follows the same pattern as the existing per-sheet "Manual %" and "Charge full sheet" controls in `SheetLayoutGrid.tsx`.

Edging overrides are stored in component state (like `sheetOverrides`) and included in the snapshot on save.

#### 3b. Save Flow — Explicit Snapshot Persistence

**Current behavior:** The product cutlist builder page auto-saves parts on every edit via `debouncedSave` (2s debounce in `cutlist-builder/page.tsx:72`). This save only persists parts groups — it does not include any layout result.

**New behavior:** The costing snapshot is persisted **only via an explicit action**, not via the autosave debounce. Two triggers:

1. **Save button** (top-right): when a layout result exists in state, the save includes the snapshot alongside the parts groups.
2. **"Save to Costing" button** (new, on the preview tab): explicitly persists the current layout + overrides as the costing snapshot without re-saving parts. Available only after Calculate Layout has been run.

**Why separate from autosave:** The autosave fires on every keystroke (debounced). Parts-only autosave is fine — the parts are the source of truth and cheap to write. But the snapshot represents a calculated+reviewed layout with billing overrides. It should only be persisted when the user has intentionally calculated and reviewed the result. Autosaving a stale or mid-edit snapshot would create confusion in costing.

**Invalidation rule:** When parts are autosaved without a snapshot (user edited parts but didn't recalculate), the existing snapshot becomes stale. The staleness is detected via the `parts_hash` mismatch — no explicit invalidation write is needed. The costing tab simply shows the stale banner.

#### 3c. Write Path — Dedicated Endpoint with Upsert

The snapshot is written via a dedicated `PUT /api/products/[productId]/cutlist-costing-snapshot` endpoint (see section 5). This is a simple upsert (INSERT ON CONFLICT UPDATE) — no delete-then-insert, no transaction needed. The existing cutlist-groups route (`POST /api/products/[productId]/cutlist-groups`) is unchanged.

The "atomic save" (parts + snapshot together) from the Save button is implemented as two sequential API calls from the client: first save groups, then upsert snapshot. If the snapshot upsert fails, the parts are still saved (acceptable — the user can retry the snapshot save). This avoids the need to wrap the existing delete-then-insert groups route in a transaction or migrate it to an RPC.

### 4. Costing Tab Changes

#### 4a. Data Fetching

The `ProductCosting` component adds a new query to fetch the cutlist costing snapshot:

```typescript
const { data: cutlistSnapshot } = useQuery({
  queryKey: ['cutlist-costing-snapshot', productId],
  queryFn: () => authorizedFetch(`/api/products/${productId}/cutlist-costing-snapshot`).then(r => r.json()),
});
```

It also fetches the current `product_cutlist_groups` to reconstruct parts and recompute the parts hash for staleness detection (see section 2).

#### 4b. Price Resolution

The snapshot stores **resolved prices at snapshot time** for each board material (`unit_price_per_sheet`) and edging material (`unit_price_per_meter`), along with `component_id` references. This matches how the existing costing tab works — `product-costing.tsx:123` fetches BOM rows with their explicit `supplierComponent.price`, not a generic component-to-supplier lookup.

**At snapshot creation time:** The cutlist builder already has board prices (`BoardMaterial.cost`) and edging prices (`EdgingMaterial.cost_per_meter`) loaded from the materials panel (which resolves them from `suppliercomponents` via `component_id`). These are written into the snapshot.

**At costing display time:** The costing tab uses the snapshot's stored prices as the **default** but can optionally re-resolve from `suppliercomponents` using the stored `component_id` to check for price changes. If the current supplier price differs from the snapshot price, a subtle indicator shows that prices have changed since the last calculation.

**Why persist prices:** Without stored prices, the costing tab would need to reverse-resolve `material_id` → `component_id` → `suppliercomponents.price`, which is ambiguous (a component can have multiple supplier links at different prices). The cutlist builder already knows which price it used — persisting it removes ambiguity and keeps costing consistent with what the user saw in the builder.

#### 4c. Materials Section Layout

The Materials section in the costing tab splits into two sub-sections when a cutlist snapshot exists:

**Hardware & Components** (non-cutlist BOM items):
Standard BOM lines costed as today — component × qty × unit price. Items where `is_cutlist_item = true` on the BOM are excluded from this section (they're covered by the cutlist section).

**Cutlist Materials** (derived from snapshot, aggregated per material):

| Material | Actual | Padded | Unit Price | Actual Cost | Padded Cost |
|----------|--------|--------|------------|-------------|-------------|
| 16mm Alegria (sheets) | 0.691 | 0.800 | R720.00 | R497.52 | R576.00 |
| 22mm White Edging (m) | 11.96 | 13.16 | R8.50/m | R101.66 | R111.86 |

- **Actual** column: un-padded values derived from per-sheet `used_area_mm2 / sheet_area`, summed per material
- **Padded** column: derived from per-sheet billing overrides (auto/full/manual), summed per material — this replicates the `computeSheetCharge` / `computeMaterialSheetRollups` logic from `CutlistCalculator.tsx:365-431`
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

Returns the snapshot for a product, or `{ snapshot: null }` if none exists. Uses `requireProductsAccess()` for auth.

#### `PUT /api/products/[productId]/cutlist-costing-snapshot`

Upserts the snapshot. Uses `INSERT ... ON CONFLICT (product_id, org_id) DO UPDATE`. Body:

```json
{
  "snapshot_data": { ... },
  "parts_hash": "abc123"
}
```

Uses `requireProductsAccess()` for auth. The endpoint validates that the product exists and belongs to the org.

### 6. Multi-Tenancy

- `product_cutlist_costing_snapshots` has `org_id` column with org-scoped RLS
- API endpoints use `requireProductsAccess()` for auth (same as cutlist-groups)
- RLS policies follow the established tenant pattern with active membership and ban checks:

```sql
CREATE POLICY product_cutlist_costing_snapshots_select_org_member
ON public.product_cutlist_costing_snapshots
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = product_cutlist_costing_snapshots.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);
-- INSERT, UPDATE, DELETE policies follow the same pattern
```

This matches the RLS pattern used across the tenant rollout (e.g. `20260222_tenant_rls_step66_quote_item_cutlists_enable_org.sql`).

---

## What Changes, What Doesn't

| Area | Change |
|------|--------|
| `product_cutlist_costing_snapshots` table | **New** — stores persisted layout results with per-sheet overrides |
| Cutlist builder preview tab | **Modified** — adds edging override fields + "Save to Costing" button |
| Cutlist builder save (explicit) | **Modified** — also persists costing snapshot via dedicated endpoint |
| Cutlist builder autosave | **Unchanged** — still saves parts only |
| Product costing tab | **Modified** — cutlist materials sub-section with actual/padded columns |
| `POST cutlist-groups` endpoint | **Unchanged** — not modified |
| BOM table | **Unchanged** |
| BOL / Overhead | **Unchanged** |
| Products without cutlist | **Unchanged** |
| Order-level nesting | **Out of scope** |

## Edge Cases

- **Product with cutlist but no materials assigned**: snapshot stores material_id as null/default. Costing tab shows the line but with "No price" indicator. User needs to assign materials in the cutlist builder.
- **Supplier price changes**: snapshot stores the price at calculation time. Costing tab can re-resolve via `component_id` to detect drift and show a "price changed" indicator.
- **Multiple material groups**: each material gets its own aggregated row in the cutlist materials table. A product with white doors + black carcass shows two board lines, each derived from their respective per-sheet data.
- **Backer boards**: shown as a separate line in cutlist materials if present (lamination with backer). Per-sheet overrides also apply to backer sheets.
- **Sub-products**: linked sub-products that have their own cutlists are not aggregated — each product manages its own cutlist costing independently.
- **Autosave after edit without recalculate**: parts are saved, snapshot goes stale (detected by parts hash mismatch), costing tab shows warning banner. No data loss.
- **Multiple sheets with different overrides for same material**: per-sheet overrides are preserved in the snapshot. Costing tab sums the per-sheet billable fractions to get the material total — same logic as `computeMaterialSheetRollups` in the calculator.
