# Cutlist Builder - Reusable Offcut Visualization

## Purpose / Big Picture

Surface reusable offcut sizes in the per-product Cutlist Builder so estimators can see what stock a layout produces and feed informed numbers into the existing Manual % billing input. The completed screen-only change adds green-tinted offcut overlays with size labels on each sheet SVG diagram, a per-sheet bullet list of offcut dimensions, and segmented utilization bars for parts, reusable stock, and scrap at both per-sheet and rolled-up job levels. Quick-fill chips above Manual % populate the existing billing override input from raw mechanical, effective, or full-sheet percentages without changing costing engine shapes.

## Progress

- [x] P1. Done 2026-04-25T16:06:00+02:00 - Created `lib/cutlist/effectiveUtilization.ts` with `UtilizationBreakdown`, `computeSheetUtilization`, and `computeRolledUpUtilization`.
- [x] P2. Done 2026-04-25T16:07:00+02:00 - Added `tests/cutlist-effective-utilization.test.ts` covering all nine truth-table cases; helper test passed 9/9.
- [x] P3. Done 2026-04-25T16:11:00+02:00 - Added `components/features/cutlist/primitives/UtilizationBar.tsx` with segmented bar, legend, Mechanical/Effective line, and constrained tooltip.
- [x] P4. Done 2026-04-25T16:11:00+02:00 - Added `components/features/cutlist/primitives/ReusableOffcutList.tsx` with area-descending sort and in-place collapse/expand behavior.
- [x] P5. Done 2026-04-25T16:15:00+02:00 - Extended `components/features/cutlist/preview.tsx` with `showOffcutOverlay` and green SVG overlay labels using the same sheet transform as placements.
- [x] P6. Done 2026-04-25T16:19:00+02:00 - Integrated offcut list, utilization bar, parity m2 readout, overlay, and quick-fill chips into `SheetLayoutGrid.tsx`; preserved existing full/manual/auto override behavior.
- [x] P7. Done 2026-04-25T16:22:00+02:00 - Mirrored reusable offcut list, utilization bar, m2 readout, and overlay into `InteractiveSheetViewer.tsx` without adding billing controls.
- [x] P8. Done 2026-04-25T16:25:00+02:00 - Added the rolled-up "All sheets" utilization bar in `CutlistCalculator.tsx` across primary and backer sheets.
- [x] P9. Done 2026-04-25T16:34:00+02:00 - Browser-verified `/products/856/cutlist-builder`: rolled-up bar, per-sheet list/bar/chips, tooltip, per-sheet/global full toggles, SVG overlays, and zoom modal mirror. Zero-reusable UI state was not produced by product 856, but the helper zero-reusable behavior is covered by tests.
- [x] P10. Done 2026-04-25T16:39:00+02:00 - Final validation completed: stale-string sweep clean, lint at known 37 warnings/0 errors, touched-file tsc grep clean, 58/58 related tests passed, and simplify pass found no safe follow-up edits.

## Surprises & Discoveries

- 2026-04-25T16:25:00+02:00 - Product 856 now has both primary and backer packed results in the Preview tab, so the rolled-up bar was verified across both grids.
- 2026-04-25T16:33:00+02:00 - Product 856 naturally produces reusable offcuts on all visible primary/backer sheets; no zero-reusable browser fixture was available without disturbing saved product data.
- 2026-04-25T16:34:00+02:00 - The zoom modal screenshot showed the green overlays aligned with the underlying sheet coordinates and the tooltip constrained to a compact multi-line width.

## Decision Log

- 2026-04-25T16:06:00+02:00 - Parts area remains authoritative under area drift; reusable area clamps to the remaining sheet area after parts are clamped.
- 2026-04-25T16:15:00+02:00 - The overlay uses the accepted simple leader-line fallback rule: wide-short offcuts label below the sheet, tall-thin offcuts label to the right; collision avoidance remains deferred.
- 2026-04-25T16:19:00+02:00 - Quick-fill chips are inline buttons instead of a new component because their behavior is tightly coupled to the existing per-sheet override state.
- 2026-04-25T16:39:00+02:00 - The simplify pass left SVG/list dimension formatting separate because SVG fit logic and UI list rendering have different constraints.

## Outcomes & Retrospective

The implementation is complete as a screen-only cutlist-builder enhancement. Estimators can now read reusable offcut stock from the SVG diagram, the sorted list, and the utilization bars; they can also apply mechanical/effective/full billing percentages through the existing Manual % override path. Costing data shapes, SQL, RLS, migrations, and PDF rendering were not changed.

## Context and Orientation

Unity ERP is a Next.js App Router furniture-manufacturing ERP backed by Supabase. The Cutlist Builder page at `/products/<id>/cutlist-builder` renders packed primary sheets and optional backer sheets through `CutlistCalculator.tsx`, `SheetLayoutGrid.tsx`, `SheetPreview`, and `InteractiveSheetViewer`. The existing billing model is unchanged: `autoPct` is mechanical used area divided by sheet area, per-sheet overrides are keyed by `sheet.sheet_id`, and `chargePct` still flows into costing as full/manual/auto. Reusable offcut data comes from `sheet.offcut_summary.reusableOffcuts`, where each offcut rect uses sheet coordinates `{ x, y, w, h, area_mm2 }`.

## Plan of Work

The work was implemented in the intended order: pure utilization helper and tests first, display primitives next, SVG overlay after that, then per-sheet card integration, zoom modal integration, rolled-up integration, docs, browser verification, and final validation. The implementation stayed within screen-only scope and did not add dependencies, migrations, new data writes, costing changes, or PDF changes.

## Concrete Steps

1. Confirmed the repo was `/Users/gregorymaier/developer/unity-erp` on `codex/integration` with a clean worktree.
2. Read `docs/README.md`, `docs/overview/todo-index.md`, and identified `docs/features/cutlist-calculator.md` as the canonical feature doc to update.
3. Added `lib/cutlist/effectiveUtilization.ts` and `tests/cutlist-effective-utilization.test.ts`; committed `ba8b8e1`.
4. Added `UtilizationBar.tsx`; committed `57e1902`.
5. Added `ReusableOffcutList.tsx`; committed `3fc80a3`.
6. Added `showOffcutOverlay` rendering to `preview.tsx`; committed `2155eeb`.
7. Integrated per-sheet bars, list, chips, and overlay into `SheetLayoutGrid.tsx`; committed `0530869`.
8. Integrated read-only zoom modal stats and overlay into `InteractiveSheetViewer.tsx`; committed `058f834`.
9. Added rolled-up primary/backer utilization in `CutlistCalculator.tsx`; committed `21cc2be`.
10. Updated `docs/features/cutlist-calculator.md`; committed `e76188d`.
11. Browser-verified product 856 on the existing dev server at `http://localhost:3000/products/856/cutlist-builder`.
12. Ran final validation commands and recorded transcripts.

## Validation and Acceptance

- Helper truth table: `npx tsx --test tests/cutlist-effective-utilization.test.ts` passed 9/9.
- Related cutlist suites: `npx tsx --test tests/cutlist-effective-utilization.test.ts tests/cutlist-packing.test.ts tests/cutlist-reusable-offcut.test.ts tests/use-org-settings-cutlist-defaults.test.ts` passed 58/58.
- Lint: `npm run lint` completed with 0 errors and the known 37 image warnings.
- Touched-file type check: `npx tsc --noEmit 2>&1 | grep -E "lib/cutlist/effectiveUtilization|UtilizationBar|ReusableOffcutList|preview\.tsx|SheetLayoutGrid|InteractiveSheetViewer|CutlistCalculator|tests/cutlist-effective-utilization"` produced no output.
- Stale-string sweep: `grep -rn "Reusable offcuts: \|Scrap pockets:" --include="*.tsx" components/features/cutlist` produced no output.
- Browser evidence on product 856: all-sheets bar showed primary plus backer math; primary card showed `Reusable offcuts (3)`, `Parts 45.5% / Reuse 53.6% / Scrap 1.0%`, `Mechanical 45.5% · Effective 99.0%`, chips `Mech 45.5`, `Eff 99.0`, `Full 100.0`, and green SVG offcut overlays.
- Browser interaction evidence: Eff chip wrote raw `99.04649812846534` into Manual %, Reset restored the auto display to `45.5`, and Mech chip wrote raw `45.4632798895094` while Billing displayed `45.5%`.
- Browser toggle evidence: per-sheet and global full-sheet switches disabled chips and Manual % inputs, then re-enabled them when toggled off.
- Browser modal evidence: the zoom modal showed reusable list, utilization bar, Mechanical/Effective line, and green overlays, with no chips, no Manual % input, and no Reset link.
- Tooltip evidence: hovering the Effective info icon showed the exact copy beginning `Parts placed plus reusable offcuts retained as stock` in a constrained-width tooltip.
- Zero-reusable browser state: not produced on product 856; helper tests verify zero reusable collapses effective to mechanical and clears reusable percentage state.

## Idempotence and Recovery

Each functional progress item was committed separately. To roll back one step, revert that step's commit. To roll back the full implementation, revert commits `ba8b8e1..e76188d` from this branch. There are no data-layer changes, no SQL migrations, no RLS/policy changes, no package changes, no JSONB shape changes, and no costing engine changes. Re-running validation is safe; the canonical completion checks are the helper tests, stale-string sweep, lint, touched-file tsc grep, and browser walkthrough.

## Artifacts and Notes

- Commits: `ba8b8e1`, `57e1902`, `3fc80a3`, `2155eeb`, `0530869`, `058f834`, `21cc2be`, `e76188d`.
- Browser URL verified: `http://localhost:3000/products/856/cutlist-builder`.
- Dev server was already listening on port 3000 under node PID 95004.
- Visual artifact observed in browser: zoom modal displayed three green reusable rectangles on the primary sheet with labels `1203 x 724`, `703 x 424`, and `1830 x 824`; larger labels included the `reusable` area line.
- Transcript files written for local reference: `/tmp/offcut-final-lint.txt`, `/tmp/offcut-final-tsc.txt`, `/tmp/offcut-final-tests.txt`, `/tmp/offcut-final-stale-grep.txt`.

## Interfaces and Dependencies

New helper module:

```ts
export interface UtilizationBreakdown {
  totalArea_mm2: number;
  partsArea_mm2: number;
  reusableArea_mm2: number;
  scrapArea_mm2: number;
  mechanicalPctRaw: number;
  effectivePctRaw: number;
  displayPartsPct: number;
  displayReusablePct: number;
  displayScrapPct: number;
  hasReusable: boolean;
  hasAreaDrift: boolean;
}

export function computeSheetUtilization(sheet: SheetLayout, sheetWidth_mm: number, sheetLength_mm: number): UtilizationBreakdown;
export function computeRolledUpUtilization(sheets: Array<{ layout: SheetLayout; widthMm: number; lengthMm: number }>): UtilizationBreakdown;
```

New components:

```ts
export function UtilizationBar(props: {
  breakdown: UtilizationBreakdown;
  className?: string;
  title?: string;
}): JSX.Element;

export function ReusableOffcutList(props: {
  offcuts: OffcutRect[];
  className?: string;
  collapseAfter?: number;
}): JSX.Element | null;
```

Modified component contract:

```ts
interface SheetPreviewProps {
  showOffcutOverlay?: boolean;
}
```

No new package dependencies were introduced. Existing dependencies used: React, `lucide-react`, shadcn Tooltip/Button/Input/Switch primitives, Tailwind utility classes, and existing cutlist types.
