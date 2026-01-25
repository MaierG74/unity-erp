# Cutlist Calculator

> **Status**: Active development
> **Location**: `/app/cutlist/page.tsx`
> **Last Updated**: 2026-01-25

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
| `boardCalculator.ts` | Packing/nesting algorithm |
| `cutlistDimensions.ts` | Dimension parsing utilities |
| `types.ts` | TypeScript type definitions |

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
