# Cutlist / Nesting Tool – Planning Document

## Goal
Build a lightweight, fast cutlist/nesting utility inside Quotes to estimate material usage for sheet goods (e.g., melamine boards) and edge banding, producing a clear breakdown for costing and a simple visual layout preview.

Reference: CutList Optimizer – feature inspiration only. We will focus on an in-house MVP tailored to our workflow. See: https://www.cutlistoptimizer.com

## MVP Scope
- Input panels to cut (length, width, quantity, grain orientation, label).
- Stock sheets (length, width, quantity on hand, cost per sheet, kerf thickness).
- Options: kerf thickness, labels on panels (off by default), single-sheet-only toggle, consider grain direction toggle.
- Outputs:
  - Used sheets and waste summary (total used area, waste %, cuts count, total cut length).
  - Fractional sheets used for primary and, when lamination present, backer sheets.
  - Per-sheet layout preview (static SVG/Canvas, not to scale initially OK).
  - Bill of materials: edgebanding split into 16mm and 32mm based on per-part lamination.
  - Export: push fractional sheet usage and banding meters as lines to the quote cluster; optionally attach a PNG/SVG snapshot.

## Nice-to-haves (post-MVP)
- Labels on panels (code/description).
- Mixed stock materials and sheet thickness groups.
- Consider grain direction and edge-banding sides per part.
- Save/load presets per product.
- PDF export of layout.

## Data Model (UI layer only for MVP)
- Part: `{ id, length_mm, width_mm, qty, label?, grain?: 'any'|'length'|'width', band_edges?: {top?: boolean, right?: boolean, bottom?: boolean, left?: boolean}, laminate?: boolean, require_grain?: boolean /* legacy */ }`
- StockSheet: `{ id, length_mm, width_mm, qty, kerf_mm, cost?: number, material?: string }`
- LayoutResult: `{ sheets: SheetLayout[], stats: { used_area_mm2, waste_area_mm2, cuts: number, cut_length_mm, edgebanding_length_mm, edgebanding_16mm_mm, edgebanding_32mm_mm } }`
- SheetLayout: `{ sheet_id, placements: Placement[], used_area_mm2?, waste_pockets?: Rect[] }`
- Placement: `{ part_id, x, y, w, h, rot: 0|90 }` (top-left origin, mm)

## Algorithm
- Start with a robust heuristic, not an exact solver:
  - Normalize parts as rectangles; expand by kerf on boundaries when placing.
  - Sort by area desc, then by longest edge desc.
  - Guillotine cutting with splits: try both orientation splits.
  - Rotation policy respects `grain`:
    - any → try 0° and 90°
    - length → only 0°
    - width → only 90° (requires global rotation enabled)
    - legacy `require_grain: true` behaves like `grain: 'length'`
  - Maintain a list of free rectangles per sheet; place greedily with best-fit (min waste increase).
  - When no fit, open a new sheet if available.
- Compute cut length: accumulate shared cut edges once; approximate via per-placement perimeter minus touching edges.
- Edge banding length: sum selected edges of each final oriented part times quantity; accumulate into 16mm or 32mm buckets depending on `laminate`.

## Tech Implementation
- Location: `components/features/cutlist/` with a client-side module.
- Visualization: simple Canvas or SVG per sheet; dimensions annotated with small text.
- Rendering now shows width labels along the horizontal edge and length labels along the vertical edge for quick orientation.
- Clicking a sheet preview opens a zoomed dialog so measurements are legible during review.
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
  - Create/ensure a Costing Cluster and push component lines with fractional quantities:
    - Primary sheet × fractional primary sheets used.
  - Buttons: **Calculate**, **Export to Quote**.
- Stats summary: sheets used (fractional), board used %, edgebanding 16mm (m), edgebanding 32mm (m), lamination on/off, and backer sheets (fractional when applicable).
- Each sheet card shows its own usage %, billed % and m², with controls to charge the full sheet or set a manual billing percentage. A global toggle applies 100% billing across all sheets.
- Attach SVG/PNG preview image(s) to the quote as item-level attachments.

## API/DB (later)
- Optional persistence: save named cutlist scenarios per quote item.
- Server-side optimization (WebWorker first; server later if needed).

### Persistence Implementation (2025-09-27)

- **Why**
  - Operators can now re-open a quote line item and immediately see the most recent cutlist run, including costing overrides.

- **Data model**
  - Table `quote_item_cutlists` (Supabase migration applied Sept 2025):
    - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
    - `quote_item_id uuid REFERENCES quote_items(id) ON DELETE CASCADE`
    - `options_hash text` (hash of inputs to detect stale snapshots)
    - `layout_json jsonb` (serialized `LayoutResult` including `unplaced` and per-sheet overrides)
    - `billing_overrides jsonb` (global toggle, per-sheet manual %, etc.)
    - `created_by uuid REFERENCES profiles(id)` (optional)
    - `created_at timestamptz DEFAULT now()`
    - `updated_at timestamptz DEFAULT now()`
  - Index on `(quote_item_id)` for fast lookups; optionally `(quote_item_id, created_at DESC)` for history.

- **Client flow** (`components/features/cutlist/CutlistTool.tsx`)
  - Auto-loads the latest snapshot on modal open (hydrates parts, stock, costing fields, overrides, layout).
  - Auto-saves (debounced) whenever results or billing overrides change; manual saves occur after calculate/export.
  - Shows a "Saving…" status while snapshot persistence is in-flight so operators see progress feedback.
  - Tracks costing line references (`CutlistLineRefs`) so subsequent exports update/delete existing lines instead of duplicating them.
  - Displays "Last saved" timestamp and any save/load errors inline with the results summary.

- **API**
  - `app/api/quote-items/[id]/cutlist/route.ts`
    - `GET` → returns the latest snapshot (`204` if none).
    - `PUT` → upserts the payload (layout + billing) scoped to `quote_item_id`.
  - Uses `supabaseAdmin` to bypass RLS while logging errors for debugging.

- **Export alignment**
  - `exportCutlistToQuote()` now upserts the individual sheet/banding lines and returns their IDs; snapshots persist those references for later runs.
  - Future idea: add `cutlist_snapshot_id` to `quote_cluster_lines` for traceability.

- **Future considerations**
  - Support multiple named snapshots per line item (version history).
  - Optionally store generated SVG/PNG assets for quick attachment without re-rendering client-side.
  - Nested cutlists per quote item (e.g., carcass vs top material) with grouped costing references.

- **Follow-ups**
  - Optional helpers in `lib/db/quotes.ts` if we need server-side snapshot access.
  - Additional QA to ensure multi-user edits merge well (consider optimistic conflicts via `options_hash`).
  - Evaluate version history / named snapshots per quote line.

- **Future considerations**
  - Support multiple named snapshots per line item (version history).
  - Optionally store generated SVG/PNG assets for quick attachment without re-rendering client-side.

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
