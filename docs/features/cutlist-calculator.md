# Cutlist Calculator

> **Status**: Active development
> **Location**: `/app/cutlist/page.tsx`
> **Last Updated**: 2026-01-26

---

## Overview

The Cutlist Calculator is a tool for planning sheet material cuts. Users enter parts with dimensions, and the calculator optimizes how to cut them from stock boards with minimal waste.

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
- Waste calculation and efficiency percentage
- Material costs breakdown
- **Backer board cutlist** when parts are set to **With Backer** lamination, with the same per-sheet billing toggles

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
  4. Chooses the best layout by **fewest sheets**, then **fewest remaining parts**, then **fewest cuts**.
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
- **Result metrics**: Tracks `offcutConcentration` (1.0 = all waste in one piece) and `fragmentCount`.

**Deep algorithm:** `simulated annealing` (iterative optimization)
- Implemented in `lib/cutlist/saOptimizer.ts`, runs in a Web Worker (`lib/cutlist/saWorker.ts`).
- Seeds with the best result from the guillotine multi-pass heuristic, then iteratively improves.
- **Solution representation**: Permutation of expanded parts (order fed to the greedy guillotine packer).
- **5 neighborhood moves** (weighted): swap (35%), insert (25%), reverse segment (15%), block swap (15%), promote grain-constrained (10%).
- **Temperature schedule**: Geometric cooling from T=500 to T=0.1, dynamically calibrated after 100 iterations based on actual throughput.
- **Acceptance**: Always accepts improvements; accepts worse solutions with probability `exp(delta/temperature)`.
- **Reheating**: If stuck for 10% of estimated iterations, reheats to `T_START × 0.3`.
- **Scoring (V2)**: Heavily weighted toward offcut quality:
  - `-sheets × 100,000` (fewer sheets)
  - `+offcutQuality × 500` (largest offcut as % of sheet — user's #1 priority)
  - `+concentration × 300` (consolidated waste)
  - `+utilization × 1` (efficiency, weak signal)
  - `-fragments × 20` (fewer fragments better)
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

### Supporting Components

| Component | Purpose |
|-----------|---------|
| `ComponentPickerDialog.tsx` | Inventory material selector |

### Libraries (`lib/cutlist/`)

| File | Purpose |
|------|---------|
| `materialsDefaults.ts` | Load/save pinned materials |
| `boardCalculator.ts` | Lamination expansion helpers |
| `cutlistDimensions.ts` | Dimension parsing utilities |
| `types.ts` | TypeScript type definitions |
| `stripPacker.ts` | Strip-based packer (default for `/cutlist`) |
| `guillotinePacker.ts` | Waste-optimized guillotine packer |
| `saOptimizer.ts` | Simulated annealing optimization engine |
| `saWorker.ts` | Web Worker entry point for SA (off-main-thread) |

### Packing Entry Point

| File | Purpose |
|------|---------|
| `components/features/cutlist/packing.ts` | Packing orchestration + algorithm selection |

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
