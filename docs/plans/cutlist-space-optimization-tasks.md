# Cutlist Space Optimization Tasks

> **Status**: ✅ COMPLETE (8/8 tasks)
>
> **Goal**: Reduce part entry from ~400px to ~40px per row, inspired by CutListOptimizer.com

---

## Task Overview

| # | Task | Blocked By | Status |
|---|------|------------|--------|
| 1 | Create MaterialsPanel primitive | - | ✅ Complete |
| 3 | Create EdgeBandingPopover component | - | ✅ Complete |
| 4 | Create CustomLaminationModal component | - | ✅ Complete |
| 5 | Create EdgeIndicator component | - | ✅ Complete |
| 2 | Create CompactPartsTable primitive | #3, #5 | ✅ Complete |
| 6 | Update /cutlist page with new components | #1, #2, #4 | ✅ Complete |
| 7 | Add database persistence for materials | #1 | ✅ Complete |
| 8 | Update packing algorithm for lamination | #6 | ✅ Complete |

---

## Phase 1: Independent Primitives (can run in parallel)

### #1 MaterialsPanel
Merged Stock + Materials tab with three sections:
- Primary Boards (from inventory)
- Backer Boards (from inventory)
- Edging (from inventory, default per thickness)
- Global kerf setting

### #3 EdgeBandingPopover
Visual rectangle showing part dimensions. Click edges to toggle banding.
Optional edging material override.

### #4 CustomLaminationModal
For 48mm+ lamination (3+ layers). Layer count with material per layer.

### #5 EdgeIndicator
Small visual rectangle for table cell showing which edges have banding.

---

## Phase 2: Parts Table

### #2 CompactPartsTable
Requires: #3, #5

Replace card layout with compact table rows (~40px):
```
| ID | Material | L | W | Qty | Lam | Edge | ⋮ |
```

Features:
- Always-visible compact inputs
- Border-on-focus styling
- Empty row at bottom for quick-add
- Tab/Enter keyboard navigation
- Lamination dropdown: None / With Backer / Same Board / Custom

---

## Phase 3: Integration

### #6 Update /cutlist page
Requires: #1, #2, #4

Wire everything together:
- Replace Stock tab with Materials tab
- Replace PartsInputTable with CompactPartsTable
- Connect materials to parts dropdowns
- Handle lamination in calculate function

---

## Phase 4: Polish

### #7 Database persistence
Requires: #1

Save default materials to database (not just localStorage).

### #8 Packing algorithm updates
Requires: #6

Support new lamination types: None / With Backer / Same Board / Custom.

---

## Key Decisions Made

| Topic | Decision |
|-------|----------|
| Materials/Stock | Merged into one Materials tab |
| Board selection | Dropdown from pre-defined boards (not full picker per part) |
| Lamination | Row property: None / With Backer / Same Board / Custom |
| Custom lamination | Modal for 48mm+ with layer configuration |
| Edge positions | Per-part (visual rectangle popover) |
| Edge material | Defaults per thickness, rare override in popover |
| Table inputs | Always-visible compact inputs, border-on-focus |
| Kerf | Global setting (not per-board) |
| Persistence | Database for defaults (user/org level) |

---

## Post-Completion Enhancements

### Component Picker Integration
- Created `ComponentPickerDialog` component for selecting materials from inventory
- "+ Add" buttons now open picker filtered by category:
  - Primary Boards → Melamine (cat_id: 75)
  - Backer Boards → MDF/Plywood (cat_id: 3, 14)
  - Edging → Edging (cat_id: 39)
- Parses dimensions from component descriptions (e.g., "2750x1830x16")
- Pulls prices from supplier components table

### Sticky/Pinned Materials Feature
- Materials can be pinned (📌) to persist across sessions
- Unpinned materials are session-only (gone on refresh)
- Pin state saved to `cutlist_material_defaults` database table
- Visual indicators: pinned rows normal, unpinned rows muted with "(session)" label
- Page starts empty - users add materials from inventory and pin favorites

---

## Files Created/Modified

### New Components
| File | Purpose |
|------|---------|
| `primitives/MaterialsPanel.tsx` | Unified materials config with pin support |
| `primitives/CompactPartsTable.tsx` | ~40px per row table layout |
| `primitives/EdgeBandingPopover.tsx` | Visual edge toggle |
| `primitives/EdgeIndicator.tsx` | Compact edge indicator |
| `primitives/CustomLaminationModal.tsx` | 48mm+ layer config |
| `ComponentPickerDialog.tsx` | Inventory component selector |

### Database
| Table | Purpose |
|-------|---------|
| `cutlist_material_defaults` | Stores pinned materials per user |

### Persistence
| File | Purpose |
|------|---------|
| `lib/cutlist/materialsDefaults.ts` | Load/save pinned materials |

---

*Created: 2025-01-24*
*Completed: 2026-01-24*
