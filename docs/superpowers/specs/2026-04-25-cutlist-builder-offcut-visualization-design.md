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
  /** Area covered by placed parts (clamped to [0, totalArea]). */
  partsArea_mm2: number;
  /** Area classified as reusable offcuts, clamped to [0, totalArea − partsArea]. */
  reusableArea_mm2: number;
  /** Remainder: totalArea − partsArea − reusableArea. Always ≥ 0. */
  scrapArea_mm2: number;

  // ─── Raw percentages (use for chip values, "Reset to auto" parity, billing labels) ───
  /** parts ÷ total × 100, no rounding compensation. Matches the existing autoPct exactly. */
  mechanicalPctRaw: number;
  /** (parts + reusable) ÷ total × 100, no rounding compensation. Drives the Eff chip. */
  effectivePctRaw: number;

  // ─── Display percentages (use for bar segments + legend numbers; sum to exactly 100) ───
  /** Rounded, compensated to sum to 100 across the three segments. */
  displayPartsPct: number;
  displayReusablePct: number;
  displayScrapPct: number;

  /** True when reusableArea_mm2 === 0 — UI hides the Eff chip and the Effective line. */
  hasReusable: boolean;
  /** Diagnostic flag: true when the original (parts + reusable) overflowed total before clamping. */
  hasAreaDrift: boolean;
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

- **Parts area is trusted; reusable yields to drift.** Compute in this order:
  1. `partsArea_mm2 = clamp(sheet.used_area_mm2 ?? sum of placement w*h, 0, totalArea)`
  2. `reusableArea_mm2 = clamp(sheet.offcut_summary?.reusableArea_mm2 ?? 0, 0, totalArea − partsArea)`
  3. `scrapArea_mm2 = totalArea − partsArea − reusableArea` (guaranteed ≥ 0 after the above)
  4. `hasAreaDrift = (rawParts + rawReusable) > totalArea` — set before clamping reusable, used only for diagnostics
- **Why this order:** parts area comes from packer placements (the most physically meaningful number). Reusable area is computed by classifying free rects, which can drift due to kerf accounting. If we clamped parts first to make room for reusable, a drift-y job would silently understate the placed-parts percentage — visible as "Used 70%" suddenly reading "Used 65%" with no operator action.
- **Chip values use the raw percentages**: `mechanicalPctRaw` matches the existing `autoPct` (`used_area_mm2 / sheetArea`) used at [SheetLayoutGrid.tsx:116](../../../components/features/cutlist/primitives/SheetLayoutGrid.tsx#L116) and [CutlistCalculator.tsx:508](../../../components/features/cutlist/CutlistCalculator.tsx#L508), so the Mech chip and "Reset to auto" produce identical numbers.
- **Bar segments use the display percentages**: round each to one decimal, then add the rounding delta to whichever segment has the largest unrounded value so the three sum to exactly 100.
- **Rolled-up function sums areas across sheets first**, then computes percentages from the sums (do not average per-sheet percentages). Example: sheet1 has 4 m² parts / 1 m² reusable / 5 m² total; sheet2 has 0 / 0 / 5 m² total. Rolled-up = 40% / 10% / 50% — never the average of (80/20/0) and (0/0/100).

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
- When `displayReusablePct === 0`: the green segment isn't rendered, the legend collapses to two columns.

**"Effective" tooltip copy** (on the small `(i)` icon):

> Parts placed plus reusable offcuts retained as stock. This is informational — costing uses Manual % below.

**Chip behaviour:**
- Three `<button>` elements: `Mech 45.5` (gray), `Eff 75.5` (green-tinted), `Full 100` (gray). Values use the **raw** percentages (`mechanicalPctRaw`, `effectivePctRaw`) so the Mech chip and the existing "Reset to auto" link produce identical numbers.
- Click → write the per-sheet override `{ mode: 'manual', manualPct: nextPct }` (the existing `mode` field on the override, see [types.ts:558](../../../lib/cutlist/types.ts#L558) — **not** `chargeMode`). This is the same shape the Manual % input writes today at [SheetLayoutGrid.tsx:240](../../../components/features/cutlist/primitives/SheetLayoutGrid.tsx#L240).
- Disabled (visually muted, click no-op) when **either** the per-sheet "Charge full sheet" toggle is on **or** the global "Charge full sheet for every used board" toggle (above the page selector) is on. The chips can't usefully fill an input that isn't honoured.
- `Eff` chip hidden entirely when `reusableArea_mm2 === 0`.
- Chip layout: 3-column grid `gap-1`, full width of the card. Each button shows the label on top line, the percentage on the bottom line in monospace, both inside a 28-32px button.

### 4. SVG sheet diagram — C treatment

In `SheetPreview` ([preview.tsx](../../../components/features/cutlist/preview.tsx)), after rendering placements (~lines 244-275), add a new render pass for `layout.offcut_summary?.reusableOffcuts`. Gate it behind a new optional prop `showOffcutOverlay?: boolean` (default `true` for both grid card and zoom modal; the legend is rendered separately by the parent — see below).

**Coordinate transform — must mirror the existing placement renderer.** `SheetPreview` computes a scale factor and `sheetX` / `sheetY` padding offsets ([preview.tsx:71](../../../components/features/cutlist/preview.tsx#L71)). Placements render via `sheetX + pl.x * scale` ([preview.tsx:245](../../../components/features/cutlist/preview.tsx#L245)). Reusable offcut rects must use the identical transform:

```tsx
const cx = sheetX + rect.x * scale;
const cy = sheetY + rect.y * scale;
const cw = rect.w * scale;
const ch = rect.h * scale;

<g key={`reusable-${i}`}>
  <rect
    x={cx}
    y={cy}
    width={cw}
    height={ch}
    fill="rgb(16 185 129 / 0.32)"
    stroke="rgb(16 185 129)"
    strokeWidth={1.5}
  />
  {/* Label rendered conditionally — see below */}
</g>
```

**Label format and styling.** `{maxDim} × {minDim}` mm (e.g. `680 × 320`) — bigger dimension first, matching the B list convention. Color `rgb(52 211 153)` (Tailwind emerald-400), monospace, font-weight 600. Optional second smaller line `reusable · {area_cm2} cm²` in a muted green, font-weight 400, only shown when the rect is large enough.

**Label fit — mirror the existing adaptive logic.** `SheetPreview` already does adaptive label sizing for placements ([preview.tsx:262](../../../components/features/cutlist/preview.tsx#L262)) — estimating text width and minimum legible font size from the post-scale rendered pixel dimensions (`wPx`, `hPx`). Reusable-offcut labels reuse the same approach:

1. Compute `wPx = cw` and `hPx = ch` (already in scaled pixel coordinates).
2. Estimate `dimensionLabelWidth_px` for the chosen font size using the same heuristic as the existing label code.
3. Branch on what fits:
   - **Two-line inside label** (dimensions + `reusable · cm²`) — when `wPx ≥ dimensionLabelWidth_px + 8` AND `hPx ≥ 2 × lineHeight_px + 4`.
   - **Single-line inside label** (dimensions only) — when `wPx ≥ dimensionLabelWidth_px + 4` AND `hPx ≥ lineHeight_px + 2`.
   - **Outside leader-line label** — when neither fits. Draw a 1px green line from the rect's center to a point 12px (in scaled pixels) outside the nearest sheet edge; place a single-line label at the leader endpoint anchored away from the sheet.

The minimum legible font size and line-height constants should match what the existing placement label logic uses (read them from the same module if exported, or duplicate the constants with a comment cross-reference).

**Leader-line collision avoidance** is acknowledged as a gap but deliberately not solved in v1 — when multiple tiny reusable rects cluster near the same edge, labels may overlap. Operators can use the zoom modal to inspect; the B size list in the stats sidebar provides the reliable canonical list. If clustering proves to be a real problem in practice, a follow-up spec adds simple vertical-stacking of leader endpoints along the same edge.

**Legend lives in the parent stats card, not in `SheetPreview`.** `SheetPreview` stays a pure renderer of the SVG itself. The legend (`■ parts placed   ■ reusable offcut   ▦ scrap`) is rendered as part of the per-sheet stats card in `SheetLayoutGrid.tsx` and the modal stats panel in `InteractiveSheetViewer.tsx`. This avoids inventing a "compact mode" prop on `SheetPreview` and keeps the SVG component focused.

### 5. Rolled-up bar at the top of the Builder

In `CutlistCalculator.tsx` near the existing summary metrics row (the "Used %", "Sheets", "Cuts" cards), insert a new wide segmented bar with the same legend treatment. No chips up there — the operator workflow is per-sheet (per the user's clarification: *"the user should work through sheet by sheet and give the amount to charge"*) so the rolled-up bar is read-only context, not an action surface.

**Backer-aware rollup.** The Builder renders primary and (optional) backer results separately ([CutlistCalculator.tsx:1886](../../../components/features/cutlist/CutlistCalculator.tsx#L1886) and [:1903](../../../components/features/cutlist/CutlistCalculator.tsx#L1903)) — `result.sheets` carries only the primary set. `computeRolledUpUtilization` must accept both: the call site at the top of the Builder passes `[...result.sheets, ...(backerResult?.sheets ?? [])]` paired with each sheet's own dimensions (primary and backer can differ in stock size). The label on the rolled-up bar reads "All sheets" — generic, covers both cases. If only primary exists, the math reduces to primary-only with no labelling change.

The rolled-up bar shows `Mechanical X% · Effective Y%` underneath but **does not** show a "Manual %", chips, or the "Charge full sheet" toggle — billing is per-sheet, and the rolled-up surface is read-only context.

### 6. Zoom modal mirror

`InteractiveSheetViewer.tsx` already shows the same `Used %` / `Reusable offcuts:` / `Scrap pockets:` block (around lines 455-475). Replace those lines with the same per-sheet bar + legend + size list components. Reuse the same React components from `SheetLayoutGrid.tsx` rather than duplicating markup — extract them into small primitives (e.g. `UtilizationBar.tsx`, `ReusableOffcutList.tsx`) so both consumers share one source of truth.

The Manual % input and chips do **not** appear in the zoom modal — they only live in the inline card. The zoom modal is read-only inspection.

### 7. Edge cases & defaults

- **Sheet with no `offcut_summary`** (legacy/strip output before the prior P4 work landed): bar shows only Parts + Scrap (no green segment), B list hidden, `hasReusable: false`, Eff chip hidden. Mechanical and Effective collapse to one number.
- **Sheet 100% used** (placements fill the whole sheet): bar is full blue, no green or gray, all three legend columns hide except Parts.
- **Sheet 0% used** (impossible in practice but defensively): bar is full gray, no Parts/Reuse columns; this should never happen because such a sheet wouldn't be in the result, but guard against divide-by-zero in the percentage helper.
- **Floating-point rounding / area drift**: `partsArea + reusableArea > totalArea` by a few mm² is possible due to kerf accounting. The clamp rule from §2 applies — parts area is preserved, reusable area is reduced to fit. The `hasAreaDrift` flag is set for diagnostics if needed (e.g. a future "Layout drift" warning). Never show negative percentages or sums above 100.
- **Existing "Reset to auto"** *deletes* the per-sheet override (see [SheetLayoutGrid.tsx:254](../../../components/features/cutlist/primitives/SheetLayoutGrid.tsx#L254)) — it does not write a value to Manual %. With the override gone, the card falls back to displaying `autoPct` (= `mechanicalPctRaw`). Behaviour preserved exactly. The chips are an additional convenience; the link continues to work.

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

## Spec revision history

- **2026-04-25 r1** — initial draft.
- **2026-04-25 r2** — Codex review pass incorporated:
  - §2 split percentages into raw (chip values, billing parity with `autoPct`) and display (segment math, sums to 100). Added `hasAreaDrift` diagnostic flag.
  - §2 + §7 rewrote the clamp rule: parts area is preserved (clamped to total), reusable yields to drift. Prevents silent under-reporting of placed-parts %.
  - §4 corrected the SVG transform to mirror the existing placement renderer (`sheetX + rect.x * scale`). Raw mm coordinates would have rendered offcuts off-position.
  - §4 replaced the "80mm/40mm" mm-based label thresholds with a reuse of the existing adaptive label logic (post-scale `wPx`/`hPx` + estimated text width). Acknowledged leader-line collision avoidance as a deferred v1 limitation.
  - §4 lifted the legend out of `SheetPreview` into the parent stats card; added `showOffcutOverlay?: boolean` prop instead of inventing a "compact mode".
  - §5 made the rolled-up bar backer-aware: combines `result.sheets + backerResult.sheets` instead of primary-only.
  - §3 corrected the chip click semantics: writes `{ mode: 'manual', manualPct: nextPct }` (existing `mode` field, not `chargeMode`).
  - §7 corrected the "Reset to auto" semantics: it deletes the override; it does not write `autoPct` to the input.
