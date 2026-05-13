# Cutlist Calculator

> **Status**: Active development
> **Location**: `/app/cutlist/page.tsx`
> **Last Updated**: 2026-04-28

---

## Overview

The Cutlist Calculator is a tool for planning sheet material cuts. Users enter parts with dimensions, and the calculator optimizes how to cut them from stock boards with minimal waste.

## Canonical Internal Entry Points

The `CutlistCalculator` component is now the canonical cutlist experience inside Unity ERP.

- `/cutlist` remains the standalone calculator for ad-hoc work.
- `/products/[productId]/cutlist-builder` is the canonical product cutlist workspace.
- `/quotes/[id]/cutlist/[itemId]` is the canonical quote cutlist workspace.

Product cutlist builder behavior:
- When saved `product_cutlist_groups` exist, the builder loads those first.
- When no saved groups exist, the builder seeds the calculator from the product's effective BOM cutlist rows so the product Cutlist tab and the builder page start from the same manufacturing data.
- The product Cutlist tab reads the same `product_cutlist_groups` first, falls back to effective BOM cutlist rows only when no saved groups exist, and shows saved layout snapshot stats when available.
- The product Cutlist tab's cutlist action routes into the builder page instead of opening the legacy product-specific calculator dialog, including when the product has no cutlist parts yet.
- The quote cutlist API routes now follow the quoting module/org access pattern before reading or mutating quote cutlist snapshots and costing lines.
- Quote cutlist client requests now send the signed-in session token, and the calculator falls back cleanly when no saved cutlist material defaults row exists yet.
- Duplicating a quote line or an entire quote now copies saved `quote_item_cutlists` snapshots and rewires embedded `lineRefs` to the duplicated costing lines, so copied quote items open with the same cutlist state instead of an empty builder.
- Reusable offcut thresholds are organization-level defaults, so each tenant can decide what counts as a usable leftover piece. The rule is a two-dimensional minimum length and width, with an optional grain-orientation requirement.
- Both active embedded flows now use explicit persistence bridges:
  - quote cutlists use `useQuoteCutlistAdapterV2`
  - product cutlists use `useProductCutlistBuilderAdapter`
- Product cutlist costing snapshots persist the calculated primary and backer layouts inside `snapshot_data` and restore them on load when the row `parts_hash` still matches the current parts. Older snapshots without stored layouts still behave like no saved layout, and parts-hash mismatches show a stale-layout banner until the user recalculates and saves.
- Snapshot costing derives sheet usage from `used_area_mm2` when present and falls back to summed sheet placements for legacy or optimizer outputs that did not populate the field. This keeps primary and backer **Actual** sheet usage in the product Materials tab aligned with the nesting preview's actual parts usage.
- The Product Costing **Cutlist Materials** table warns when a row's padded quantity is lower than actual usage and links back to the Cutlist Builder so the estimator can correct the per-sheet manual percentage.
- Product cutlist saves invalidate the Product Costing cutlist snapshot, cutlist-groups, and computed piecework-labor queries so returning to the Costing Labor tab does not show labor counts from a previously saved cutlist.
- Product cutlist group saves persist the selected board's component id separately from the calculator's temporary board id, so saved groups retain their costable material link after a user applies a newly added board to all parts.
- Product detail pages also listen for product-scoped Supabase Realtime changes on `product_cutlist_groups` and `product_cutlist_costing_snapshots`; when another signed-in user saves a cutlist for the same product, the open product page invalidates its cutlist and costing caches instead of waiting for a hard refresh.
- Order-line BOM swaps can mark a cutlist material as removed. The order cutlist snapshot keeps the group-level material references for audit, but parts for the removed material are serialized with `quantity: 0`; aggregators must skip zero-quantity parts before planning material roles, cutting plans, exports, or piecework counts.
- Order lines with cutlist snapshots now support a per-line primary board, paired edging, fixed/percentage surcharge, and per-part board/edging overrides. Saved order snapshots carry per-part `effective_board_*` and `effective_edging_*` fields, so cutting-plan and export readers consume the resolved material choices directly.

---

## Key Features

### Materials Panel

Located in the **Materials** tab. Three sections with pinning support:

| Section | Purpose | Category Filter |
|---------|---------|-----------------|
| **Primary Boards** | Main sheet materials (melamine, etc.) | Melamine (cat 75) |
| **Backer Boards** | Lamination backing materials | Melamine, MDF, Plywood (cats 75, 3, 14) |
| **Edging** | Edge banding materials | Edging (cat 39) |

#### Pin System
- **Pinned materials** (📌): Saved to database, persist across sessions
- **Unpinned materials**: Session-only, cleared on refresh
- Visual indicator: Unpinned rows show "(session)" label with muted styling

#### Default Selection
Each section has radio buttons to mark the **default** material:
- **Primary Boards**: Default material assigned to new parts
- **Backer Boards**: Default used when parts have "With Backer" lamination
- **Edging**: Default per thickness - e.g., if you have multiple 1mm edgings, the default is used for all 1mm edge banding unless overridden

#### Settings
- **Blade Kerf**: Width of saw blade cut (typically 3mm), added between parts during nesting

---

### Parts Table

Located in the **Parts** tab. Compact table format (~40px per row).

| Column | Description |
|--------|-------------|
| **ID** | Part name/identifier |
| **Material** | Dropdown of primary boards |
| **L** | Length in mm (grain runs along this by default) |
| **W** | Width in mm |
| **Qty** | Quantity of this part |
| **Grain** | Grain direction toggle (click to cycle) |
| **Lam** | Lamination type |
| **Grp** | Lamination group (A, B, C...) |
| **Edge** | Edge banding indicator (clickable) |

#### Grain Direction Toggle

Click the grain icon to cycle through options:

| Icon | Value | Description |
|------|-------|-------------|
| `○` | `any` | No grain preference (solid color material) |
| `↕` | `length` | Grain runs parallel to Length dimension |
| `↔` | `width` | Grain runs parallel to Width dimension |

**Convention:** When entering dimensions, the Length (L) is typically the dimension you want the grain to follow. For a 700mm tall × 600mm wide desk leg with vertical grain, enter L=700, W=600, Grain=`↕` (length).

#### Quick-Add Row
- Empty row at bottom for fast entry
- Type part details and press **Enter** to add
- Row converts to real part only on Enter (not on every keystroke)

#### Lamination Types

Lamination indicates how pieces will be assembled after cutting. It does NOT multiply quantity.

| Type | Description | Edge Thickness |
|------|-------------|----------------|
| **None** | Single layer, no lamination | 16mm |
| **With Backer** | Primary + matching backer (Qty applies to both) | 32mm |
| **Same Board** | Pieces paired during assembly | 32mm |
| **Custom** | Opens modal for 3+ layer configurations | 48mm+ |

#### Lamination Groups

For parts that will be laminated together but need distinct names (e.g., "side#6" and "side#7"), use lamination groups instead of the lamination type dropdown.

**How it works:**
- Assign parts to the same group (A, B, C...) using the **Grp** column
- Parts in the same group are treated as a single laminated assembly
- Edge thickness = 16mm × number of parts in the group

| Group Size | Edge Thickness | Example |
|------------|----------------|---------|
| 1 part | 16mm | Single layer (same as no group) |
| 2 parts | 32mm | Two boards laminated face-to-face |
| 3 parts | 48mm | Three-layer lamination |

**Dropdown options:**
- **None**: Part is not in any group
- **A, B, C...**: Existing groups (click to assign)
- **+ New (X)**: Create a new group with the next available letter

**Use case:** When "side#6" and "side#7" from a CSV import need to be laminated together, assign both to Group A. The edging calculation will use 32mm edging for the combined assembly.

---

### Edge Banding Popover

Click the **Edge** indicator to open the visual edge banding selector:

```
        ┌─── 600 T ───┐
        │             │
   700  │  600 × 700  │  700
    L   │             │   R
        │             │
        └─── 600 B ───┘
```

- Shows part dimensions with labeled edges (T/R/B/L)
- Click edges to toggle banding on/off
- "(2/4 active)" shows how many edges have banding
- Edges use the default edging material for the part's thickness

#### Why This Approach?

**Problem**: Traditional interfaces show checkboxes for "Top, Right, Bottom, Left" - but which edge is which when the part is rotated during cutting?

**Solution**: Visual rectangle representation:
- Shows actual dimensions on each edge
- L (length) dimension runs horizontally by convention
- User clicks the visual edges they want banded
- Clear, unambiguous - you see exactly what you're selecting

---

### Preview Tab

Shows the optimized cutting layout after clicking **Calculate Layout**:
- Visual board layouts with parts positioned
- Product cutlist builder pages restore the saved sheet layout from the costing snapshot when the saved `parts_hash` matches the current parts, so reopening the Preview tab does not rerun the optimizer just to show the last saved layout.
- Waste calculation and efficiency percentage
- Material costs breakdown
  - Primary board costing is derived from the actual packed sheets per material, not a proportional estimate from raw part area.
  - Backer board costing follows the packed backer layout and the same per-sheet billing overrides used in the preview.
  - Backer cost is reported as an overall lamination run cost rather than being allocated into individual primary-board material cards.
- **Backer board cutlist** when parts are set to **With Backer** lamination, with the same per-sheet billing toggles
- The zoomed sheet viewer shows separate **Grain** and **Edges** columns in the legend, uses a wider dialog so the legend is less likely to clip on desktop screens, and can page between sheets with previous/next controls or the left/right arrow keys.
- When offcut-aware layouts are used, the preview now separates **reusable offcuts** from **scrap pockets** per sheet using the organization's reusable-offcut thresholds. Both `guillotine` and `strip` packing outputs populate per-sheet `offcut_summary`.
- Reusable-offcut rectangles are clipped against actual part placements before classification and rendering, so green leftover-stock overlays cannot overlap placed parts even when the strip packer creates broad remnant candidates.
- Product cutlist builder sheet cards and the zoomed sheet viewer render reusable offcuts as green SVG overlays with dimension labels, list reusable offcut sizes sorted largest-first, and show a segmented utilization bar for parts, reusable stock, and scrap.
- The per-sheet **Manual %** input keeps its existing costing behavior. Quick-fill chips above it can populate a **Suggested** billing percentage that rounds actual parts usage up to the nearest 10%, exact **Actual** parts usage, or **Full sheet** billing through the same per-sheet override state.
- The preview also shows one rolled-up **All sheets** utilization bar across primary and backer sheets so estimators can compare whole-job parts, reusable offcut, and scrap percentages without averaging sheet percentages by hand.
- Utilization bars use shop-floor language: **Parts**, **Reuse**, and **Scrap**. Parts-plus-reusable usage remains in the underlying math, but the UI avoids the older "mechanical" and "effective" labels and does not expose reusable-stock usage as a billing shortcut.

### Organization Cutlist Defaults

Admins configure these defaults at `/settings/cutlist`. Values are stored in `organizations.cutlist_defaults` as JSONB and read through the org-settings normalizer:

- `minReusableOffcutLengthMm` defaults to `300`.
- `minReusableOffcutWidthMm` defaults to `300`.
- `minReusableOffcutGrain` defaults to `any`; `length` requires the minimum length along sheet grain, while `width` requires the minimum length across sheet grain.
- `preferredOffcutDimensionMm` defaults to `300` and remains a soft packing preference. It nudges guillotine scoring away from usable-but-awkward leftovers; it is not a hard reusable-stock threshold.

Legacy JSONB rows with the old single-dimension key still load by copying that scalar onto both new axes. The legacy area gate is ignored on read.

---

## Packing Algorithm (Cut Layout)

The `/cutlist` page uses `packPartsSmartOptimized()` in `components/features/cutlist/packing.ts`.

**Default algorithm:** `strip` (cut-minimizing, guillotine-friendly)
- Implemented in `lib/cutlist/stripPacker.ts`.
- Expands parts by quantity and applies grain rules:
  - `grain: length` → length aligned with sheet length (no rotation).
  - `grain: width` → length aligned with sheet width (forced 90°).
  - `grain: any` → rotation allowed; orientation biased to wider-than-tall for strip packing.
- Groups parts into **height bands** (default tolerance 15%), then:
  1. Packs each band into horizontal strips (FFD by width).
  2. Stacks strips top-to-bottom (FFD by height).
  3. Tries three layouts (horizontal strips, nested complementary widths, vertical-first).
  4. Chooses the best layout by **fewest sheets**, then **fewest remaining parts**, then **fewest merged saw cuts**; when cut counts tie it prefers **fewer vertical rip lines** so same-width parts stay in one strip when possible.
- Optional alignment step nudges vertical cut lines to reduce total saw cuts.
- Kerf is applied between adjacent parts/strips using the **Blade Kerf** setting from Materials.

**Alternative algorithm:** `guillotine` (waste-optimized)
- Implemented in `lib/cutlist/guillotinePacker.ts`.
- Uses a free-rectangle list with offcut-aware scoring.
- **Offcut consolidation**: Scores placements based on how well they keep waste in one contiguous piece.
- **Multi-pass optimization**: Tries 20+ different orderings including:
  - 7 sort strategies (area, longest-side, width, perimeter, height, etc.)
  - Reversed versions of each strategy
  - Deterministic shuffles for additional diversity
  - Corner-priority and height-band groupings
- **Split selection**: Evaluates both horizontal and vertical splits at each placement, choosing the one that best consolidates remaining free space.
- **Exact-fit strip continuation**: When a part exactly matches the current strip width/height, the scorer treats the leftover end-trim as cheap terminal waste instead of a hard sliver penalty, which helps preserve full-height/full-width reusable offcuts on jobs like repeated `600 mm` rips.
- **Exact cut stats**: Guillotine and Deep (SA) now track the actual split segments generated during packing, then merge collinear segments per sheet so `cuts` and `cut length` reflect the modeled guillotine sequence instead of a rough `2 cuts per part` estimate.
- **Result metrics**: Tracks `offcutConcentration` (1.0 = all waste in one piece) and `fragmentCount`.
- **Completeness ranking**: Layouts that leave parts unplaced are ranked below any layout with fewer unplaced pieces via lexicographic comparison - completeness is checked first, scalar offcut/utilization scores only break ties among layouts with the same unplaced count. This holds for arbitrarily large jobs; sheet count cannot drown out completeness.

**Deep algorithm:** `simulated annealing` (iterative optimization)
- Implemented in `lib/cutlist/saOptimizer.ts`, runs in a Web Worker (`lib/cutlist/saWorker.ts`).
- Seeds with the best result from the guillotine multi-pass heuristic, then iteratively improves.
- **Solution representation**: Permutation of expanded parts (order fed to the greedy guillotine packer).
- **5 neighborhood moves** (weighted): swap (35%), insert (25%), reverse segment (15%), block swap (15%), promote grain-constrained (10%).
- **Temperature schedule**: Geometric cooling from T=500 to T=0.1, dynamically calibrated after 100 iterations based on actual throughput.
- **Acceptance**: Always accepts improvements; accepts worse solutions with probability `exp(delta/temperature)`.
- **Reheating**: If stuck for 10% of estimated iterations, reheats to `T_START × 0.3`.
- **Scoring (V2)**: Heavily weighted toward offcut quality, but completeness comes first:
  - **Lexicographic completeness gate** - comparison checks unplaced count before any scalar score; a complete layout always beats a partial layout regardless of sheet count or offcut quality. The scalar `-unplacedCount × 10,000,000` term remains in the score function as defensive depth, but the load-bearing guarantee is the comparator.
  - `-sheets × 100,000` (fewer sheets)
  - `+offcutQuality × 500` (largest offcut as % of sheet — user's #1 priority among complete layouts)
  - `+concentration × 300` (consolidated waste)
  - `-compactness × 50` (bounding box penalty — prefer parts packed in corner)
  - `+utilization × 1` (efficiency, weak signal)
  - `-fragments × 20` (fewer fragments better)
- **Strip fallback safety net**: After SA completes, the orchestrator runs the strip packer and falls back to it when (a) strip places strictly more pieces than SA, or (b) both layouts place every part but strip uses fewer sheets. Equivalent to the lexicographic comparator used inside the optimizers - completeness comes first, sheet count second.
- **Progressive UI**: Shows live progress (elapsed time, iterations, improvements, % vs baseline) with a progress bar.
- **Time budget**: User-selectable (10s / 30s / 60s), default 30s.
- **Cancel**: "Stop & Keep Best" button aborts early and keeps the best result found so far.
- **Web Worker**: All computation runs off the main thread so UI stays fully responsive.
- Typical throughput: ~20,000 iterations/second.

**Legacy algorithm:** `packPartsIntoSheets()` (greedy best-fit) remains for older consumers but is not used by the `/cutlist` page.

### Optimization Priority Selector

Located next to the **Calculate Layout** button. Controls which packing algorithm is used:

| Option | Algorithm | Best For |
|--------|-----------|----------|
| **Fast / fewer cuts** | `strip` | Production speed, simpler cutting patterns |
| **Best offcut** | `guillotine` | Material savings, large reusable offcuts |
| **Deep (SA)** | `simulated annealing` | Maximum material savings, best offcut quality (10-60s) |

- **Tooltip**: Hover the `?` icon for a description of each option
- **Persistence**: Selection is saved to localStorage and restored on page reload
- **Indicator**: After calculation, the Preview tab shows which priority was used
- **Time budget selector**: Appears when Deep (SA) is selected (10s / 30s / 60s)

**When to use each:**
- **Fast / fewer cuts**: When labor cost outweighs material cost, or when cutting by hand
- **Best offcut**: When material is expensive, or when you want a large reusable remnant piece
- **Deep (SA)**: When maximum material optimization is needed and you can wait 10-60 seconds

---

## Database Persistence

### Tables

| Table | Purpose |
|-------|---------|
| `cutlists` | Saved cutlist projects |
| `cutlist_material_defaults` | Pinned materials per user |

### Material Defaults Schema

```sql
CREATE TABLE cutlist_material_defaults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  primary_boards JSONB DEFAULT '[]',
  backer_boards JSONB DEFAULT '[]',
  edging JSONB DEFAULT '[]',
  kerf_mm INTEGER DEFAULT 3,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);
```

---

## Component Architecture

### Primitives (`components/features/cutlist/primitives/`)

| Component | Purpose |
|-----------|---------|
| `MaterialsPanel.tsx` | Unified materials configuration panel |
| `CompactPartsTable.tsx` | Parts entry table with quick-add |
| `EdgeBandingPopover.tsx` | Visual edge selector popover |
| `EdgeIndicator.tsx` | Compact edge display for table cells |
| `CustomLaminationModal.tsx` | Multi-layer lamination configuration |
| `InteractiveSheetViewer.tsx` | Pan/zoom dialog with tooltip, legend, highlight |
| `SheetLayoutGrid.tsx` | Paginated sheet card grid with zoom + PDF download |
| `CuttingDiagramButton.tsx` | Lazy-loaded PDF download button |

### Supporting Components

| Component | Purpose |
|-----------|---------|
| `ComponentPickerDialog.tsx` | Inventory material selector |
| `CuttingDiagramPDF.tsx` | React-PDF operator cutting diagram (one page per sheet) |

### Libraries (`lib/cutlist/`)

| File | Purpose |
|------|---------|
| `materialsDefaults.ts` | Load/save pinned materials |
| `boardCalculator.ts` | Lamination expansion helpers |
| `cutlistDimensions.ts` | Dimension parsing utilities |
| `types.ts` | TypeScript type definitions (incl. extended Placement metadata) |
| `stripPacker.ts` | Strip-based packer (default for `/cutlist`) |
| `guillotinePacker.ts` | Waste-optimized guillotine packer |
| `saOptimizer.ts` | Simulated annealing optimization engine (V2 scoring with compactness) |
| `saWorker.ts` | Web Worker entry point for SA (off-main-thread) |
| `colorAssignment.ts` | 12-color palette, deterministic assignment by part name |

### Packing Entry Point

| File | Purpose |
|------|---------|
| `components/features/cutlist/packing.ts` | Packing orchestration, algorithm selection, strip fallback safety net |

---

## Visual Presentation (2026-02-13)

### Color System
Parts are color-coded by type using a 12-color accessible palette. Assignment is deterministic (sorted alphabetically, round-robin). Waste areas use a distinct slate gray with diagonal crosshatch. See `lib/cutlist/colorAssignment.ts`.

### Sheet Preview (`preview.tsx`)
SVG-based rendering with:
- Per-part coloring from color map (falls back to blue when no map provided)
- Grain direction overlay (fine parallel lines — horizontal for length, vertical for width)
- Edge banding ticks (orange indicators on banded edges)
- Hover/click: highlighted parts pulse, non-matching parts dim to 0.35 opacity
- Thumbnail mode: hides part labels, only shows dimensions when parts are large enough
- Interactive mode: cursor pointer, mouse events for hover/click

### Interactive Zoom Dialog (`InteractiveSheetViewer.tsx`)
Near-fullscreen dialog (max-w-6xl, h-[85vh]) with:
- `@panzoom/panzoom` integration with `contain: 'inside'` for bounded zoom
- Floating tooltip on hover (part name, L×W, grain, edges)
- Click-to-highlight all instances of same part type
- Two-column layout: 70% diagram / 30% parts legend
- Legend table: color swatch, letter (A/B/C), display name, qty, L×W, grain/edge info
- Legend hover highlights matching parts in the diagram
- Header shows material, dimensions, and usage percentage
- Zoom controls (+/-/reset) in top-right corner

### Operator Cutting Diagram PDF (`CuttingDiagramPDF.tsx`)
Production-ready PDF via `@react-pdf/renderer` (lazy-loaded):
- One landscape A4 page per sheet
- Lettered part labels (A-Z, AA-AZ) with color-coded backgrounds
- Legend table per sheet with letter, name, qty, L, W
- Header: material name, sheet N of M, date
- Footer: sheet efficiency %, used area
- Download button with date-stamped filename

---

## Technical Notes

### HTML Structure Fix (2026-01-25)

The MaterialsPanel originally used Radix `RadioGroup` wrapped around `TableRow` elements inside `TableBody`. This created invalid HTML (`<div>` inside `<tbody>`) causing inconsistent rendering across browsers.

**Fix**: Replaced with native `<input type="radio">` elements to maintain valid table structure.

### Quick-Add Row Fix (2026-01-25)

The quick-add row was creating a new part on every keystroke. Root cause: activation was triggered on field change, but checked the previous state value (before the current keystroke was applied).

**Fix**: Removed auto-activation from field change handlers. Parts are now only created when user presses Enter.

---

## Quantity Model

**Qty = Pieces to Cut**

The quantity field always represents actual pieces to cut from sheet goods. Lamination type is assembly metadata that affects edge thickness, NOT quantity multiplication.

| Qty | Lamination | Pieces Cut | Edge Thickness | Finished Parts |
|-----|------------|------------|----------------|----------------|
| 4 | None | 4 | 16mm | 4 single-layer parts |
| 4 | Same Board | 4 | 32mm | 2 laminated parts |
| 4 | With Backer | 4+4 | 32mm | 4 parts (each with backer) |

**Example:** 32mm desk legs
- Need: 2 finished legs, each made from 2×16mm boards
- Enter: Qty=4, Lamination="Same Board"
- System: Cuts 4 pieces, uses 32mm edging
- Result: 4 pieces → 2 finished legs after assembly

This model ensures CSV imports and manual entry work identically.

---

## Known Considerations

### Board Thickness for Edging

Currently assumes 16mm boards (32mm when laminated). See `plans/cutlist-improvements.md` for the plan to add dynamic board thickness support for 18mm, 22mm, etc.

---

*Created: 2026-01-25*
*Updated: 2026-01-26 - Added Lamination Groups and Optimization Priority features*
*Updated: 2026-02-13 - Added Deep (SA) simulated annealing optimizer with Web Worker, progressive UI, and time budget control*
*Updated: 2026-02-13 - World-class presentation: color system, interactive zoom, operator PDF, SA compactness fix, strip fallback, UX polish*
*Updated: 2026-03-06 - Documented the canonical internal cutlist entry points and product BOM seeding into the builder page*
*Updated: 2026-04-26 - Optimizer ranking now treats complete placement as mandatory; offcut quality only ranks among layouts with the same unplaced count*
*Updated: 2026-04-26 - Optimizer ranking now uses lexicographic completeness comparison; scalar penalty constants remain as defensive depth*
