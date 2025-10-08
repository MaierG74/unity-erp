# Cutting Plan – Implementation Notes

This document summarizes algorithm, UI, integration, and performance suggestions for the Cutlist/Nesting module.

---

## Algorithm (packing.ts)

- Deterministic **guillotine packer** with kerf applied on **splits**, not inflated parts.
- Rotation and grain orientation:
  - Parts now support `grain: 'any' | 'length' | 'width'`.
  - `'any'`: part may rotate 0° or 90° (subject to global rotation option).
  - `'length'`: keep part length aligned with sheet length (0° only).
  - `'width'`: keep part length aligned with sheet width (90° only; requires global rotation enabled).
  - Back-compat: legacy `require_grain: true` is treated as `grain: 'length'`.
- Free-rectangle list per sheet; prune contained and tiny scraps; optionally merge adjacent free rects.
- Composite scoring:
  - Leftover area
  - Fragmentation penalty (avoid slivers)
  - Aspect ratio penalty (avoid skinny)
  - Future-fit penalty (histogram match)
  - Cut length delta (shorter is better)
- Accurate **cut-segment accounting**: track unique guillotine cut segments, merge overlaps.
- Edge banding mapping: if rot=90° map top→left, right→top, bottom→right, left→bottom.
- Edgebanding split by thickness: parts flagged with `laminate: true` contribute banding to 32mm, others to 16mm.

## UI (CutlistTool.tsx)

- Parts table + Stock table + Options panel (kerf, single-sheet, offcut thresholds).
- Grain selector per part using a compact Select: Any, Length, Width.
- Buttons: **Calculate**, **Export to Quote**.
- Stats summary: sheets used (fractional), board used %, edgebanding 16mm (m), edgebanding 32mm (m), lamination on/off, and backer sheets (fractional when applicable).
- Results: Preview each sheet (SVG) with dimensions and part IDs.
- Stock tab carries the default backer board selector so estimators can lock in the common lamination component without jumping to Costing.
- Costing tab groups Backer, Primary, Palette, and Edgebanding settings into collapsible cards with muted backgrounds so operators can hide sections they rarely tweak.
- Debounce calculations or require manual “Calculate” to hit <100 ms target.

## Preview (preview.tsx)

- SVG/Canvas per sheet.
- Draw sheet border, parts with labels, optional dimensions.
- Responsive scaling, padding, minimalistic design.
- Consider storing real sheet size in layout for cleaner rendering.

## Export (export.ts)

- Export costing lines (fractional where applicable):
  - Primary sheet × fractional primary sheets used.
  - Backer sheet × fractional backer sheets used (only when lamination present).
  - Edgebanding 16mm (m) and Edgebanding 32mm (m) as separate lines based on calculated meters.
- Hook into `lib/db/quotes.ts` helpers:
  - `ensureCostingCluster(quoteId)`
  - `insertLines(clusterId, lines)`
  - Optional: attach preview images (PNG/SVG snapshots).

## Integration

- `QuoteItemsTable.tsx`: Add “Cutlist Calculator” button/modal trigger.
- `app/quotes/[id]/page.tsx`: Ensure tool/modal mounts in quote detail.
- `lib/db/quotes.ts`: Provide cluster creation and line insertion helpers.
- `QuoteAttachmentsList.tsx`: Display attached sheet previews if added.

### Costing Tab
- Select components for: Primary sheet, Backer sheet, Edgebanding 16mm, Edgebanding 32mm (via existing Component Selection dialog)
- Prices default from selected supplier component; can be overridden manually.
- Export uses selected components and meters/sheets calculated by the tool.
- Standalone `/cutlist` runs the full material palette (per-part material selector + palette persistence); the Quote modal keeps the legacy costing layout without the palette to preserve the established workflow.

## UX / Feature Ideas

- Edge banding selector (per side toggle ⬆️➡️⬇️⬅️).
- “Single sheet feasibility” quick check (red/green result).
- Preset sheet sizes (PG Bison 2750×1830, etc.).
- Offcut capture (save leftover rectangles to inventory).
- Deterministic seed: same inputs → same layout for quote reproducibility.
- Perf guardrails: prune free list, integer mm math, debounce calculation.

## Checks & Safeguards

- Validate part > sheet (impossible fits) early.
- Ensure kerf is only applied on splits.
- Verify banding mapping when rotated.
- Confirm: used_area + waste_area == sheet_area total.
- Ensure deterministic results with stable sort & tie-breakers.
