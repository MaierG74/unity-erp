# Cutlist Builder — Reusable Offcut Visualization Design

**Date**: 2026-04-25
**Status**: Draft
**Scope**: On-screen visualization of reusable offcuts in the per-product Cutlist Builder. Three coordinated changes: (1) green-tinted overlays with dimension labels on the SVG sheet diagram, (2) a per-sheet size list of reusable offcuts in the stats sidebar, (3) a segmented utilization bar (parts / reusable / scrap) per sheet *and* rolled up at the top of the Builder, with quick-fill chips that one-click populate the existing Manual % billing input.

## Problem

The Cutlist Builder shows mechanical sheet utilization (e.g. *"Used 45.5% (2.27 m² of 5.00 m²)"*) plus a one-line summary *"Reusable offcuts: 3 (26770 cm²)"*. Two gaps result:

1. **Estimators can't see what reusable offcuts exist.** The data is computed (`SheetOffcutSummary.reusableOffcuts: OffcutRect[]` carries x, y, w, h, area_mm² for every reusable rect) but only the count and total area surface. Whether the leftover is a 2140 × 460 panel or three small awkward rects is invisible — the estimator has to mentally infer it from the sheet diagram.
2. **The mechanical-utilization headline misleads when there are reusable offcuts.** A 45% mechanical utilization can mean *"you used 45% of the sheet and the other 55% is waste"* OR *"you used 45% and another 30% is keep-worthy stock for the next job, only 25% is real scrap."* The two are economically very different. Today there is no way to see which case applies, and the existing **Manual %** billing input forces the operator to make a costing call without the data they need to make it well.

A separate issue — operators printing B&W cutting diagrams for the workshop — is **explicitly out of scope here**. Print is the future order-level multi-product PDF brainstorm; this spec is screen-only.

## Goals

1. **C-treatment** — Each reusable offcut is rendered as a green-tinted rect on the existing SVG sheet diagram with its dimensions overlaid as a label inside (or via a leader line if the rect is too small to fit the text).
2. **B-treatment** — Each sheet's stats sidebar shows the dimensions of every reusable offcut as a small bullet list, sortable secondarily by area.
3. **Utilization bar** — A segmented bar (blue parts / green reusable / gray scrap) sits in each sheet's stats card with three percentages labeled, plus a single rolled-up bar at the top of the Builder for the whole job. Below each per-sheet bar, the explicit "Mechanical X% · Effective Y%" line names what the operator is looking at.
4. **Quick-fill chips** — Three buttons (`Mech 45.5` / `Eff 75.5` / `Full 100`) sit immediately above the Manual % input in each sheet's card. One click populates the input. The chips are disabled when "Charge full sheet" is on (which already disables Manual % today).
5. **No costing engine changes.** Effective utilization is informational. The Manual % the operator types is what costing actually consumes (existing behaviour, preserved).

## Out of Scope

- **PDF / print output.** Future order-level PDF brainstorm.
- **Real offcut inventory persistence.** The CutLogic / KerfLab pattern (offcuts saved to stock library, future jobs pull from stock before fresh sheets) is a separate workstream; until that lands, we deliberately do not auto-credit offcut value to the customer's invoice.
- **Per-material rules** (already out of scope from the prior reusable-offcut-rules spec).
- **Order-level cross-product nesting.** This spec touches the per-product Builder only. The order-level cutting plan UI is its own surface.
- **Color-blind accessibility extras** (icons / patterns layered over color in bar segments). Worth noting; defer to implementation polish.

---

## Design

### 1. Where each piece lives

| Element | File | Surface |
|---|---|---|
| Green offcut overlay + dimension label | [components/features/cutlist/preview.tsx](../../../components/features/cutlist/preview.tsx) (`SheetPreview`) | The SVG sheet diagram, used in both the grid card and the zoom modal. |
| Per-sheet stats card (utilization bar + B size list + chips + Manual %) | [components/features/cutlist/primitives/SheetLayoutGrid.tsx](../../../components/features/cutlist/primitives/SheetLayoutGrid.tsx) | Each sheet card in the Builder. |
| Mirror in zoom modal stats panel | [components/features/cutlist/primitives/InteractiveSheetViewer.tsx](../../../components/features/cutlist/primitives/InteractiveSheetViewer.tsx) | The "Zoom" expanded view of a sheet. |
| Rolled-up utilization bar | [components/features/cutlist/CutlistCalculator.tsx](../../../components/features/cutlist/CutlistCalculator.tsx) (top of Builder, near the existing summary metrics) | Whole-job view, all sheets aggregated. |
| Pure utility for the bar math | New file: `lib/cutlist/effectiveUtilization.ts` | Imported by both stats card and the rolled-up bar so the math is identical. |

### 2. Pure utility — `effectiveUtilization.ts`

Centralises the percentage math so per-sheet and rolled-up renders cannot diverge:

```ts
import type { SheetLayout, SheetOffcutSummary } from './types';

export interface UtilizationBreakdown {
  /** Total area considered (sheet area for per-sheet, sum of sheet areas for rolled-up). */
  totalArea_mm2: number;
  /** Area covered by placed parts. */
  partsArea_mm2: number;
  /** Area classified as reusable offcuts (sum of SheetOffcutSummary.reusableArea_mm2). */
  reusableArea_mm2: number;
  /** Remainder: totalArea − partsArea − reusableArea. Always ≥ 0. */
  scrapArea_mm2: number;
  /** Percentages, summing to 100 (sub-percent rounding compensated on the largest segment). */
  partsPct: number;
  reusablePct: number;
  scrapPct: number;
  /** Mechanical = partsPct. Effective = partsPct + reusablePct. */
  mechanicalPct: number;
  effectivePct: number;
  /** True when reusableArea_mm2 === 0 — UI hides the Eff chip and the Effective line. */
  hasReusable: boolean;
}

export function computeSheetUtilization(
  sheet: SheetLayout,
  sheetWidth_mm: number,
  sheetLength_mm: number,
): UtilizationBreakdown;

export function computeRolledUpUtilization(
  sheets: Array<{ layout: SheetLayout; widthMm: number; lengthMm: number }>,
): UtilizationBreakdown;
```

Implementation notes:
- `partsArea_mm2 = sheet.used_area_mm2 ?? sum of placement w*h`.
- `reusableArea_mm2 = sheet.offcut_summary?.reusableArea_mm2 ?? 0`.
- `scrapArea_mm2 = max(0, totalArea − parts − reusable)` — guard against floating-point negatives from rounding.
- Percentages use the rule: round each to one decimal, then add the rounding delta to whichever segment has the largest unrounded value so the three sum to exactly 100.
- The rolled-up function sums areas across sheets first, then computes percentages from the sums (do not average per-sheet percentages).

### 3. Per-sheet stats card layout

The existing card in `SheetLayoutGrid.tsx` (around lines 122-280) holds the sheet header, diagram, "Used X%" line, "Reusable offcuts / Scrap pockets" two-line block, "Charge full sheet" toggle, "Manual %" input, and "Reset to auto" link. Replace the two-line stats block with the new bar+legend, insert the chips above Manual %, and add the B size list above the bar. The toggle, input, and reset link stay in place with unchanged behaviour.

Visual order top to bottom inside the card:

```
[ Sheet header — name + Zoom link ]
[ SVG diagram — now with green offcut overlays ]
[ B: small "Reusable offcuts (3)" header + bullet size list — collapsible if > 6 items ]
[ Segmented utilization bar (18-22px tall, full card width) ]
[ Three-column legend — Parts / Reuse / Scrap with %s ]
[ Mechanical X% · Effective Y%  (i)  — small monospace line; (i) tooltip explains "Effective" ]
[ "Charge full sheet" toggle — UNCHANGED ]
[ Quick-fill chips: Mech / Eff / Full — disabled when toggle is ON; Eff hidden when reusableArea === 0 ]
[ Manual % input — UNCHANGED behaviour, fed by chips when clicked ]
[ "Billing X.X% · Reset to auto" — UNCHANGED ]
```

**B size list specifics:**
- Header: `Reusable offcuts (N)` where N = `offcut_summary.reusableCount`.
- Items: each rendered as `• {length_mm} × {width_mm} mm` where `length` = `Math.max(w, h)` and `width` = `Math.min(w, h)` (so the bigger dimension reads first regardless of which axis it lies on).
- Sort: descending by area.
- If N ≤ 6, render inline. If N > 6, render the first 5 and a `+N more` link that expands the rest in place (no modal — keeps the card scannable).
- Hidden entirely when `offcut_summary` is missing or `reusableCount === 0`.

**Bar legend specifics:**
- Three columns side by side: `■ Parts 45.5%`, `■ Reuse 30.0%`, `■ Scrap 24.5%`. Color swatch matches the bar segment.
- When `reusablePct === 0`: the green segment isn't rendered, the legend collapses to two columns.

**"Effective" tooltip copy** (on the small `(i)` icon):

> Parts placed plus reusable offcuts retained as stock. This is informational — costing uses Manual % below.

**Chip behaviour:**
- Three `<button>` elements: `Mech 45.5` (gray), `Eff 75.5` (green-tinted), `Full 100` (gray).
- Click → set Manual % to that value AND set the chargeMode to `'manual'` (so "Charge full sheet" stays off and the typed value is honoured).
- Disabled (visually muted, click no-op) when **either** the per-sheet "Charge full sheet" toggle is on **or** the global "Charge full sheet for every used board" toggle (above the page selector) is on. The chips can't usefully fill an input that isn't honoured.
- `Eff` chip hidden entirely when `reusablePct === 0`.
- Chip layout: 3-column grid `gap-1`, full width of the card. Each button shows the label on top line, the percentage on the bottom line in monospace, both inside a 28-32px button.

### 4. SVG sheet diagram — C treatment

In `SheetPreview` ([preview.tsx](../../../components/features/cutlist/preview.tsx)), after rendering placements (~line 188-210), add a new render pass for `layout.offcut_summary?.reusableOffcuts`. Each `OffcutRect { x, y, w, h, area_mm2 }` becomes:

```tsx
<g key={`reusable-${i}`}>
  <rect
    x={rect.x}
    y={rect.y}
    width={rect.w}
    height={rect.h}
    fill="rgb(16 185 129 / 0.32)"
    stroke="rgb(16 185 129)"
    strokeWidth={1.5}
  />
  {/* Label rendered conditionally — see below */}
</g>
```

**Label placement decision tree:**

The label format is `{maxDim} × {minDim}` (e.g. `680 × 320`) — bigger dimension first, matching the B list convention. Render it in a green that reads on dark and light: `rgb(52 211 153)` (Tailwind emerald-400), monospace, font-weight 600. A second smaller line below it reads `reusable · {area_cm2} cm²` in a muted green, font-weight 400.

To handle small offcuts:

```
if (rect.w >= 80 mm AND rect.h >= 40 mm in SVG units):
  → label centered inside the rect (two lines)
else if (rect.w >= 60 mm OR rect.h >= 30 mm in SVG units):
  → label centered inside the rect, single line, dimensions only
else:
  → label rendered outside the rect via a leader line
  → leader: 1px green line from rect center to a point 12 SVG-units outside the nearest sheet edge
  → label sits at the leader endpoint, anchored toward sheet exterior
```

The "SVG units" thresholds above assume the sheet is rendered with its mm-coordinates as the SVG viewBox (which is the existing convention). If `SheetPreview` scales, the thresholds compare against the post-scale rendered size — implementation may need a tiny `useEffect` measuring the actual rendered scale to pick the right branch.

**Inline legend at the bottom of the SVG container** (small, 10px, monospace):

```
■ parts placed   ■ reusable offcut   ▦ scrap
```

Same colors as the bar legend. Rendered as a `<div>` underneath the SVG, not inside it (so it doesn't get part of the diagram's coordinate system). Hidden when the parent prop says compact-mode.

### 5. Rolled-up bar at the top of the Builder

In `CutlistCalculator.tsx` near the existing summary metrics row (the "Used %", "Sheets", "Cuts" cards), insert a new wide segmented bar with the same legend treatment, computed via `computeRolledUpUtilization` over all sheets in the result. No chips up there — the operator workflow is per-sheet (per the user's clarification: *"the user should work through sheet by sheet and give the amount to charge"*) so the rolled-up bar is read-only context, not an action surface.

The rolled-up bar shows `Mechanical X% · Effective Y%` underneath but **does not** show a "Manual %", chips, or the "Charge full sheet" toggle — billing is per-sheet, and the rolled-up surface is read-only context.

### 6. Zoom modal mirror

`InteractiveSheetViewer.tsx` already shows the same `Used %` / `Reusable offcuts:` / `Scrap pockets:` block (around lines 455-475). Replace those lines with the same per-sheet bar + legend + size list components. Reuse the same React components from `SheetLayoutGrid.tsx` rather than duplicating markup — extract them into small primitives (e.g. `UtilizationBar.tsx`, `ReusableOffcutList.tsx`) so both consumers share one source of truth.

The Manual % input and chips do **not** appear in the zoom modal — they only live in the inline card. The zoom modal is read-only inspection.

### 7. Edge cases & defaults

- **Sheet with no `offcut_summary`** (legacy/strip output before the prior P4 work landed): bar shows only Parts + Scrap (no green segment), B list hidden, `hasReusable: false`, Eff chip hidden. Mechanical and Effective collapse to one number.
- **Sheet 100% used** (placements fill the whole sheet): bar is full blue, no green or gray, all three legend columns hide except Parts.
- **Sheet 0% used** (impossible in practice but defensively): bar is full gray, no Parts/Reuse columns; this should never happen because such a sheet wouldn't be in the result, but guard against divide-by-zero in the percentage helper.
- **Floating-point rounding**: `partsArea + reusableArea > totalArea` by a few mm² is possible due to kerf accounting drift. Cap `partsPct + reusablePct ≤ 100` and assign the leftover to scrap; never show negative percentages.
- **Existing "Reset to auto"** sets Manual % to `autoPct` (= mechanical). Behaviour preserved exactly. The chips are an additional convenience; the link continues to work.

---

## Testing

### Unit (new file: `tests/cutlist-effective-utilization.test.ts`)

- `computeSheetUtilization` against fabricated `SheetLayout` inputs covering: full sheet of parts, 40/30/30 split, no reusable offcuts, 100% reusable, area drift edge case (parts+reusable rounds slightly over total).
- `computeRolledUpUtilization` against multi-sheet inputs: 3 sheets with mixed splits, confirms the rolled-up percentages match per-sheet area sums (not per-sheet pct averages).
- The rounding-compensation rule: percentages always sum to exactly 100.

### Manual (Claude in Chrome on the test account)

- `/products/856/cutlist-builder` — open Builder, confirm: per-sheet bar renders with three segments, B size list renders with sortable bullets, chips populate Manual % on click, "Effective" tooltip surfaces, green offcut overlay appears on the SVG with size labels, rolled-up bar shows job total at the top.
- Toggle "Charge full sheet" ON — chips and Manual % go disabled, bar still visible.
- Toggle off — chips re-enabled, click `Eff` → Manual % populates with effective %.
- Use a layout with zero reusable offcuts — confirm `Eff` chip hidden, "Effective" line collapses, bar shows only Parts + Scrap.
- Open a sheet zoom modal — same bar + legend + size list visible inside, no chips/input.

---

## Open Questions

None blocking. Implementation will pick reasonable defaults for:

- Exact emerald shade and opacity (spec says ~32% on `rgb(16 185 129)`; final visual tuning is implementation-time).
- Bar segment height (suggest 18-22px — dial in during build).
- Tooltip primitive — reuse the shadcn Tooltip already used on the settings page.
