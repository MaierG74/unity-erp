# Cutlist / Nesting Tool – Planning Document

## Goal
Build a lightweight, fast cutlist/nesting utility inside Quotes to estimate material usage for sheet goods (e.g., melamine boards) and edge banding, producing a clear breakdown for costing and a simple visual layout preview.

Reference: CutList Optimizer – feature inspiration only. We will focus on an in-house MVP tailored to our workflow. See: https://www.cutlistoptimizer.com

## MVP Scope
- Input panels to cut (length, width, quantity, optional grain orientation, label).
- Stock sheets (length, width, quantity on hand, cost per sheet, kerf thickness).
- Options: kerf thickness, labels on panels (off by default), single-sheet-only toggle, consider grain direction toggle.
- Outputs:
  - Used sheets and waste summary (total used area, waste %, cuts count, total cut length).
  - Per-sheet layout preview (static SVG/Canvas, not to scale initially OK).
  - Bill of materials: sheets used, offcuts, edge-banding total length by edge flags.
  - Export: add the calculated material lines into a quote cluster, or attach a PNG/SVG snapshot to the quote.

## Nice-to-haves (post-MVP)
- Labels on panels (code/description).
- Mixed stock materials and sheet thickness groups.
- Consider grain direction and edge-banding sides per part.
- Save/load presets per product.
- PDF export of layout.

## Data Model (UI layer only for MVP)
- Part: `{ id, length_mm, width_mm, qty, label?, require_grain?: boolean, band_edges?: {top?: boolean, right?: boolean, bottom?: boolean, left?: boolean} }`
- StockSheet: `{ id, length_mm, width_mm, qty, kerf_mm, cost?: number, material?: string }`
- LayoutResult: `{ sheets: SheetLayout[], stats: { used_area_mm2, waste_area_mm2, cuts: number, cut_length_mm } }`
- SheetLayout: `{ sheet_id, placements: Placement[], waste_pockets?: Rect[] }`
- Placement: `{ part_id, x, y, w, h, rot: 0|90 }` (top-left origin, mm)

## Algorithm
- Start with a robust heuristic, not an exact solver:
  - Normalize parts as rectangles; expand by kerf on boundaries when placing.
  - Sort by area desc, then by longest edge desc.
  - Guillotine cutting with splits: try both orientation splits.
  - Allow 90° rotation when grain not required.
  - Maintain a list of free rectangles per sheet; place greedily with best-fit (min waste increase).
  - When no fit, open a new sheet if available.
- Compute cut length: accumulate shared cut edges once; approximate via per-placement perimeter minus touching edges.
- Edge banding length: sum selected edges of each final oriented part times quantity.

## Tech Implementation
- Location: `components/features/cutlist/` with a client-side module.
- Visualization: simple Canvas or SVG per sheet; dimensions annotated with small text.
- State: React state + pure functions for packing; no server dependency for MVP.
- Performance target: <100 ms for ~50 parts; optimize by pooling rectangles and early exits.

### Files
- `components/features/cutlist/CutlistTool.tsx` – top-level UI (parts table, stock table, options, results, preview)
- `components/features/cutlist/packing.ts` – pure functions: `packPartsIntoSheets(parts, stock, options)` returns `LayoutResult`
- `components/features/cutlist/preview.tsx` – SVG renderer for one `SheetLayout`
- `components/features/cutlist/export.ts` – helper to push results to Quote cluster lines

## Quotes Integration
- Access from Quotes → Line Items tab as a tool button: “Cutlist Calculator”.
- On save:
  - Create/ensure a Costing Cluster and push component lines:
    - `MELAMINE SHEET 2750×1830` × N sheets used (unit cost from inventory or manual input).
    - `EDGE BANDING` total length in meters.
  - Attach SVG/PNG preview image(s) to the quote as item-level attachments.

## API/DB (later)
- Optional persistence: save named cutlist scenarios per quote item.
- Server-side optimization (WebWorker first; server later if needed).

## UX Notes
- Compact, single-screen; collapsible panels for inputs.
- Inputs default to mm; show helpers to convert from cm/inches.
- Clear warnings when parts exceed stock dimensions.
- Toggle to “Use only one sheet” for quick feasibility checks.

## Open Questions
- Material modeling: do we need multiple stock sizes per run? (likely yes post-MVP).
- Grain: percent of parts requiring grain lock; performance impact manageable.
- Pricing source: pull from `inventory_items` or allow manual override per run.

## Milestones
1. Packing library + basic UI + preview.
2. Edge-banding calc + kerf + stats.
3. Quote integration (export lines + attach preview).
4. Persistence and presets.
