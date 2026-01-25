# Cutlist Calculator Improvements

> **Status**: Planning
> **Created**: 2026-01-25

---

## Overview

Three key improvements identified during cutlist testing:

1. **CSV Import vs Lamination** - Prevent double-counting when importing pre-expanded parts
2. **Grain Direction Toggle** - Per-part grain direction control
3. **Dynamic Board Thickness** - Calculate edging based on actual board thickness, not hardcoded 16mm

---

## Issue 1: CSV Import + Lamination Double-Counting ✅ COMPLETE

### Problem

When importing from SketchUp CSV:
- CSV contains actual cut pieces (e.g., 4 pieces for 2 laminated legs)
- If user then sets "Same Board" lamination, system doubles to 8 pieces
- This is incorrect - the CSV already accounts for lamination

### Solution Implemented (2026-01-25)

**Unified Model: Qty = Pieces to Cut**

Rather than adding an `is_pre_expanded` flag that creates two different behaviors, we unified the system so that quantity ALWAYS means "pieces to cut":

| Input Method | User Enters | Lamination | System Calculates |
|--------------|-------------|------------|-------------------|
| CSV Import | 4 pieces | Same Board | 4 pieces ✓ |
| Manual Entry | 4 pieces | Same Board | 4 pieces ✓ |

**Key Changes:**
1. Removed quantity doubling from `expandPartsWithLamination()` for `same-board` type
2. Removed quantity doubling from `expandGroupsToPartSpecs()` for `32mm-both` type
3. Lamination type now only affects edge thickness calculation (16mm → 32mm)

**Behavior:**
- Qty always = actual pieces to cut from sheet goods
- Lamination = assembly metadata (how pieces are paired after cutting)
- Edge thickness still calculated based on lamination type

**Example:**
```
32mm desk legs (2 finished legs, each made from 2×16mm):
- Enter: Qty=4, Lamination="Same Board"
- System: Cuts 4 pieces, uses 32mm edging
- Result: 4 pieces → 2 finished legs after assembly
```

See also: `docs/plans/cutlist-qty-as-pieces-plan.md` for full implementation details.

---

## Issue 2: Grain Direction Toggle ✅ COMPLETE

### Problem

Parts have a `grain` field but it's not exposed in the UI. Users can't specify grain direction per-part.

### Solution Implemented (2026-01-25)

Added grain toggle button to `CompactPartsTable`:

| Icon | Value | Description |
|------|-------|-------------|
| `○` | `any` | No grain preference (solid color) |
| `↕` | `length` | Grain runs along L dimension |
| `↔` | `width` | Grain runs along W dimension |

Click to cycle through options. Toggle button shows:
- Muted color for `any`
- Primary color for `length` and `width`
- Tooltip on hover explains the current setting

```
| ID | Material | L | W | Qty | Grain | Lam | Edge |
|    |          |   |   |     |   ↕   |     |      |
```

---

## Issue 3: Dynamic Board Thickness for Edging

### Problem

Current code hardcodes thickness assumptions:
```typescript
case 'same-board':
  return 32; // Assumes 16mm × 2
```

But boards come in different thicknesses:
- 16mm (common)
- 18mm (common in some regions)
- 22mm (user mentioned)
- Others possible

### Current State

`BoardMaterial` is missing thickness:
```typescript
export interface BoardMaterial {
  id: string;
  name: string;
  length_mm: number;
  width_mm: number;
  cost: number;
  isDefault: boolean;
  isPinned?: boolean;
  component_id?: number;
  // ❌ No thickness_mm field!
}
```

### Proposed Solution

**Step 1: Add thickness to BoardMaterial**

```typescript
export interface BoardMaterial {
  // ... existing fields
  thickness_mm: number; // NEW: 16, 18, 22, etc.
}
```

**Step 2: Update ComponentPickerDialog**

When selecting a board, parse thickness from description (e.g., "16mm African Wenge"):
```typescript
// Already exists in parseDimensions()
const thicknessMatch = description.match(/^(\d+)\s*mm/i);
```

**Step 3: Update edge thickness calculation**

```typescript
function getEdgeThickness(
  laminationType: LaminationType,
  boardThickness: number,  // NEW parameter
  laminationConfig?: CustomLaminationConfig
): number {
  switch (laminationType) {
    case 'none':
      return boardThickness; // e.g., 16, 22
    case 'with-backer':
    case 'same-board':
      return boardThickness * 2; // e.g., 32, 44
    case 'custom':
      return laminationConfig?.edgeThickness || boardThickness * 3;
  }
}
```

**Step 4: Update edging defaults system**

Currently edging is grouped by `thickness_mm` (16, 32, 48).

With dynamic board thickness, we need edging for:
- 16mm, 22mm (single boards)
- 32mm, 44mm (laminated)
- 48mm, 66mm (triple lamination)

**Options:**
- A) User adds edging for each thickness they use
- B) System shows "No 44mm edging configured" warning when needed
- C) Allow edging thickness ranges (e.g., "use 45mm edging for 44mm parts")

**Recommendation:** Option A with B as fallback warning

---

## Implementation Priority

| Priority | Issue | Effort | Impact | Status |
|----------|-------|--------|--------|--------|
| 1 | Grain Direction Toggle | Low | High - essential for production | ✅ Complete |
| 2 | CSV Import / Qty Consistency | Medium | High - prevents double-counting | ✅ Complete |
| 3 | Board Thickness Field | Medium | High - required for accurate edging | Pending |

---

## Files Modified

### Issue 1 (CSV Import / Qty = Pieces to Cut) ✅ COMPLETE
- `lib/cutlist/boardCalculator.ts` - Removed quantity doubling for `same-board` and `32mm-both`

### Issue 2 (Grain Direction) ✅ COMPLETE
- `components/features/cutlist/primitives/CompactPartsTable.tsx` - Added Grain toggle column

### Issue 3 (Board Thickness) - Pending
- `components/features/cutlist/primitives/MaterialsPanel.tsx` - Add/display thickness field
- `lib/cutlist/boardCalculator.ts` - Use dynamic thickness
- `app/cutlist/page.tsx` - Pass thickness to calculator

---

*Created: 2026-01-25*
