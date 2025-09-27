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
- SheetLayout: `{ sheet_id, placements: Placement[], waste_pockets?: Rect[] }`
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

### Persistence Plan (in progress)

- **Problem today**
  - `CutlistTool.tsx` keeps `result` state in-memory only; closing the modal or refreshing discards layouts.
  - Costing exports add `quote_cluster_lines`, but the underlying `LayoutResult` (placements, overrides) is not stored anywhere.
  - Operators expect to re-open a quote line item and see the last generated cutlist without recalculating.

- **Proposed data model**
  - Create table `quote_item_cutlists`:
    - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
    - `quote_item_id uuid REFERENCES quote_items(id) ON DELETE CASCADE`
    - `options_hash text` (hash of inputs to detect stale snapshots)
    - `layout_json jsonb` (serialized `LayoutResult` including `unplaced` and per-sheet overrides)
    - `billing_overrides jsonb` (global toggle, per-sheet manual %, etc.)
    - `created_by uuid REFERENCES profiles(id)` (optional)
    - `created_at timestamptz DEFAULT now()`
    - `updated_at timestamptz DEFAULT now()`
  - Index on `(quote_item_id)` for fast lookups; optionally `(quote_item_id, created_at DESC)` for history.

- **Client flow changes** (`components/features/cutlist/CutlistTool.tsx`)
  - On mount, fetch latest cutlist snapshot for the active `quote_item_id` via new API (`/api/quote-items/[id]/cutlist`).
  - Hydrate `result`, `sheetOverrides`, and `globalFullBoard` from persisted data when available.
  - After `Calculate` or `Export`, call a `PUT` endpoint to upsert the snapshot (with optimistic UI update).
  - Provide "Last saved" timestamp and optionally a manual save button.

- **API additions**
  - `app/api/quote-items/[id]/cutlist/route.ts`
    - `GET` → returns latest snapshot (`200` with JSON payload or `204` if none).
    - `PUT` → validates payload against current quote item ownership, hashes inputs, stores snapshot, updates `updated_at`.
  - Use `supabaseAdmin` server-side to bypass RLS where necessary; ensure authorization by verifying current user can edit the quote.

- **Export alignment**
  - `exportCutlistToQuote()` already receives override-aware sheet quantities. Ensure the persisted payload mirrors these values so re-opening the modal shows the exact billed amounts used during export.
  - Add optional `cutlist_snapshot_id` field to `quote_cluster_lines` for traceability (future enhancement).

- **Migration checklist**
  - `db/migrations/20250926_quote_item_cutlists.sql` (new table + trigger to auto-update `updated_at`).
  - Update `lib/db/quotes.ts` to include cutlist snapshot in `fetchQuote()` (eager load) and provide helper `saveQuoteItemCutlist()`.
  - Add zod schema in `app/api/.../cutlist/route.ts` for payload validation.
  - Adjust unit tests / manual QA to cover load/save/export flows.

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
