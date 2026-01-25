# Cutlist Refactoring Task List

> **Status**: ✅ COMPLETE (15/15 tasks)
>
> **All phases finished!**

This document tracks the progress of refactoring the cutlist system into reusable primitives.

**Goal**: Create a unified component library that can be composed differently for:
- `/cutlist` page (standalone)
- Quote modal (embedded in quotes)
- Product BOM tab (bill of materials)

---

## Phase 1: Foundation ✅
- [x] **#1** Create shared cutlist types file (`lib/cutlist/types.ts`)

## Phase 2: Extract Primitives ✅
- [x] **#2** Extract PartsInputTable primitive
- [x] **#3** Extract CostingPanel primitive
- [x] **#4** Extract ResultsSummary primitive
- [x] **#5** Extract SheetLayoutGrid primitive
- [x] **#6** Extract CSVDropzone primitive
- [x] **#7** Refactor PartCard and GroupCard into primitives folder

## Phase 3: Grouping Support ✅
- [x] **#8** Create GroupedPartsPanel primitive ✅

## Phase 4: Validate on /cutlist Page ✅
- [x] **#9** Update /cutlist page to use new primitives ✅
- [x] **#10** Add grouped mode to /cutlist page ✅

## Phase 5: Create Unified Component ✅
- [x] **#11** Create CutlistWorkspace composable component ✅
- [x] **#12** Create persistence adapters for each context ✅

## Phase 6: Migration ✅
- [x] **#13** Replace Quote cutlist modal with CutlistWorkspace ✅
- [x] **#14** Replace Product BOM cutlist tab with CutlistWorkspace ✅

## Phase 7: Cleanup ✅
- [x] **#15** Clean up deprecated cutlist components ✅

---

## Created Files

### `lib/cutlist/types.ts`
Consolidated type definitions including:
- GrainOrientation, BandEdges, BoardType
- PartSpec, CutlistPart, StockSheetSpec
- Placement, SheetLayout, LayoutResult
- CutlistGroup, MaterialPartSet, BoardCalculation
- CutlistDimensions, CutlistMaterialDefinition
- CutlistSummary, CutlistLineRefs

### `lib/cutlist/index.ts`
Barrel export for all cutlist types and utilities.

### `components/features/cutlist/primitives/`
| File | Purpose |
|------|---------|
| `PartsInputTable.tsx` | Part entry form with dimensions, grain, banding |
| `CostingPanel.tsx` | Material costing configuration |
| `ResultsSummary.tsx` | Stats display (sheets, edging, lamination) |
| `SheetLayoutGrid.tsx` | Sheet preview grid with pagination |
| `CSVDropzone.tsx` | SketchUp CSV import |
| `PartCard.tsx` | Draggable part card |
| `GroupCard.tsx` | Group container with material pickers |
| `index.ts` | Barrel export |

---

## Architecture

```
lib/cutlist/                      ← Core logic
├── types.ts                      ← Consolidated types
├── index.ts                      ← Barrel export
├── packing.ts                    ← Sheet nesting algorithm
├── csvParser.ts                  ← SketchUp CSV parsing
├── boardCalculator.ts            ← Board type expansion
└── cutlistDimensions.ts          ← BOM dimension handling

components/features/cutlist/
├── primitives/                   ← Reusable UI components
│   ├── PartsInputTable.tsx
│   ├── CostingPanel.tsx
│   ├── ResultsSummary.tsx
│   ├── SheetLayoutGrid.tsx
│   ├── CSVDropzone.tsx
│   ├── PartCard.tsx
│   ├── GroupCard.tsx
│   ├── GroupedPartsPanel.tsx     ← (in progress)
│   └── index.ts
│
├── CutlistWorkspace.tsx          ← (planned) Main composable component
├── CutlistTool.tsx               ← Legacy (to be replaced)
└── CutlistBuilder.tsx            ← Legacy (to be replaced)
```

---

---

## Task Dependencies

To restore this task list in a new session, use these dependencies:

| Task | Blocked By | Blocks |
|------|------------|--------|
| #1 | - | #2, #3, #4, #5, #6, #7 |
| #2 | #1 | #9 |
| #3 | #1 | #9 |
| #4 | #1 | #9 |
| #5 | #1 | #9 |
| #6 | #1 | #9 |
| #7 | #1 | #8 |
| #8 | #7 | #10 |
| #9 | #2, #3, #4, #5, #6 | #10 |
| #10 | #8, #9 | #11 |
| #11 | #10 | #12, #13, #14 |
| #12 | #11 | #13, #14 |
| #13 | #11, #12 | #15 |
| #14 | #11, #12 | #15 |
| #15 | #13, #14 | - |

### Quick Restore Command

To restore in a new Claude Code session, say:
> "Read docs/plans/cutlist-refactor-tasks.md and recreate the task list from it. Mark completed tasks as done and resume from where we left off."

---

*Completed: 2025-01-24*
