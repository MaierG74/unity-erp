# Job Card Drawings (per BOL row, per order line, configurator-sourced)

**Date:** 2026-05-06
**Status:** Draft — pending user review
**Branch:** codex/local-job-card-drawings-spec (off origin/codex/integration @ 2422ee9)
**Scope:** BOL editor, order page, configurator, job card issuance RPC, job card PDF

## Problem

Assembly and other build jobs printed on job cards routinely need a reference drawing — the operator on the floor needs to see what they're building. Today the printed job card has the job, quantity, and signature blocks, but no visual reference. Drawings live in operators' heads, on paper at the bench, or in a third-party tool like SketchUp.

The same job ("Assemble Cupboard") is shared across many products (1200, 1500, 1800 cupboard etc.), so the drawing cannot live on the `jobs` table — each *product × job* combination needs its own drawing. Some products are built via the furniture configurator and already have a high-quality technical preview that could be reused; others are non-configurator products and need a manually uploaded drawing. And occasionally a specific order calls for a one-off custom drawing (e.g. a SketchUp export for a non-standard build) that should print only on that order's card.

## Design

### Resolve chain

At job-card issuance the system picks the drawing for each job_card_item by walking these tiers in order. The first tier with a value wins; if all are empty, no drawing is printed.

1. **Order-line override** — `order_detail_drawings.drawing_url` for `(order_detail_id, bol_id)`
2. **BOL manual upload** — `billoflabour.drawing_url`
3. **Product configurator drawing** — `products.configurator_drawing_url`, *only if* `billoflabour.use_product_drawing = true`
4. None (no drawing section rendered on the printed card)

The resolved URL is **snapshotted into `job_card_items.drawing_url`** at issuance time. Once a card is issued, editing the BOL drawing or product configurator drawing does not change what prints on that card. Re-issuance after cancellation re-resolves.

### Schema changes

All new columns/tables include `org_id` for tenancy and follow the project's existing RLS pattern (`is_org_member()`). All file URLs are nullable.

```sql
-- 1. BOL drawing fields
ALTER TABLE billoflabour
  ADD COLUMN drawing_url TEXT,
  ADD COLUMN use_product_drawing BOOLEAN NOT NULL DEFAULT false;
-- Constraint: drawing_url and use_product_drawing are mutually exclusive
ALTER TABLE billoflabour
  ADD CONSTRAINT billoflabour_drawing_source_exclusive
  CHECK (NOT (drawing_url IS NOT NULL AND use_product_drawing = true));

-- 2. Product-level configurator drawing
ALTER TABLE products
  ADD COLUMN configurator_drawing_url TEXT;

-- 3. Order-line override table
CREATE TABLE order_detail_drawings (
  id BIGSERIAL PRIMARY KEY,
  order_detail_id BIGINT NOT NULL REFERENCES order_details(order_detail_id) ON DELETE CASCADE,
  bol_id INTEGER NOT NULL REFERENCES billoflabour(bol_id) ON DELETE CASCADE,
  drawing_url TEXT NOT NULL,
  org_id UUID NOT NULL REFERENCES organizations(id),
  uploaded_by UUID REFERENCES auth.users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_detail_id, bol_id)
);
CREATE INDEX idx_order_detail_drawings_lookup ON order_detail_drawings(order_detail_id, bol_id);
-- RLS: SELECT/INSERT/UPDATE/DELETE allowed for org members of org_id

-- 4. Job card item drawing snapshot
ALTER TABLE job_card_items
  ADD COLUMN drawing_url TEXT;
```

### Storage

Reuse the existing `QButton` Supabase Storage bucket. Three path conventions, **each upload gets a fresh UUID** in the path so old uploads remain readable (load-bearing for the snapshot guarantee):

- BOL manual uploads: `BOL Drawings/{bol_id}/{uuid}.{ext}`
- Configurator-captured: `Product Drawings/{product_id}/{uuid}.png`
- Order-line overrides: `Order Drawings/{order_detail_id}-{bol_id}/{uuid}.{ext}`

A re-upload writes to a brand-new UUID path; the row's `drawing_url` is updated to the new path. Already-issued job cards keep their snapshotted URLs pointing at the old file, which still exists in storage — so reprints are pixel-stable. The displaced files are never `DELETE`d, accumulating as orphans that a separate maintenance job can clean up later (out of scope).

**Format restriction:** PNG and JPEG only. The upload control in both BOL editor and order page must show a clear hint ("PNG or JPEG required"). Server-side: validate by content-type + extension before signing the upload URL. Reject anything else with a friendly error.

### BOL editor UX

For each BOL row in the product BOL editor, replace the absence of a drawing field with a 3-way radio + thumbnail:

```
Drawing source:  ( ) None   ( ) Upload custom   ( ) Use product drawing
                                   [ Upload PNG/JPG ]
                 [Thumbnail of resolved drawing, if any]
```

- **None** (default for existing rows + new rows) — `drawing_url = NULL`, `use_product_drawing = false`
- **Upload custom** — file picker; `drawing_url = <uploaded>`, `use_product_drawing = false`
- **Use product drawing** — disabled (greyed) if `products.configurator_drawing_url IS NULL` for this product. Sets `drawing_url = NULL`, `use_product_drawing = true`.

The radio is mutually exclusive (enforced by the CHECK constraint above). Switching from *Upload custom* to another option clears `drawing_url` (the file in storage becomes orphaned but stays — no auto-delete).

### Order page UX

On the order detail expanded view, alongside each line's BOL jobs (which already get pulled through into the work pool), surface a per-line drawing override:

```
[Job: Assemble Cupboard]
  Drawing on card:  [ thumbnail ]  [ Replace with custom ▾ ]   (resolved from BOL)
                                   ↳ Override for this order: [ Upload PNG/JPG ]   [ Remove override ]
```

- The thumbnail shows whatever the resolve chain currently picks for this `(order_detail_id, bol_id)` pair, with a small label noting the source: *"From product"*, *"From BOL"*, or *"Order override"*.
- "Override for this order" inserts/updates a row in `order_detail_drawings` via UPSERT on `(order_detail_id, bol_id)` — the existing UNIQUE constraint means a re-upload replaces the prior URL on the same row rather than creating duplicates. After upload, the resolved source switches to *"Order override"*.
- "Remove override" deletes the override row; the resolved source falls back to BOL.

Override is only meaningful before the relevant job card is issued. After issuance the snapshot in `job_card_items.drawing_url` is fixed; editing the override afterwards has no effect on already-issued cards (and the UI should show a passive note: *"Already issued — override won't affect printed cards"*).

### Configurator integration

In the furniture configurator (`/products/{id}/configurator`), the "Save to Product" button additionally captures the technical preview as a PNG and writes it to `products.configurator_drawing_url`.

Capture is **client-side**, against the SVG container of the technical preview (the `<Preview>` panel — Front / Side / Top / Assembly Details composite). Use `dom-to-image-more` (small, well-maintained, handles foreignObject and embedded fonts better than `html2canvas` for our SVG). Output PNG, upload to `QButton/Product Drawings/{product_id}/{uuid}.png`, persist URL on `products`.

Failure modes: capture errors should not block the existing "Save to Product" flow — log + toast warning, leave the previous `configurator_drawing_url` intact (or null if first save).

3D preview is out of scope for capture — only the Technical preview is captured.

### Job card PDF rendering

In [components/features/job-cards/JobCardPDF.tsx](components/features/job-cards/JobCardPDF.tsx):

- Extend the `JobCardItem` interface with `drawing_url?: string | null`.
- Existing layout is: Header → Job info → Items table → Signature blocks. The drawing renders **between the items table and the signature blocks** — keeps signatures as the last printed element (they're a sign-off block after the work is done) and matches the user's "job at top, drawing at bottom" intent without burying the signature area.
- Layout: drawing fills the available width below the items table; aspect-ratio preserved; capped at roughly half the page height so signatures stay visible without spilling to a second page. If the natural image height exceeds the cap, the image scales down to fit; it does not page-break.
- Use `@react-pdf/renderer`'s `<Image src={url}/>`. The renderer pulls images at PDF generation time over HTTPS — Supabase storage URLs work directly.
- If the per-card rule (one job per card) holds in practice (it does per CLAUDE.md), there is at most one drawing per card. If the data shape ever yields multiple items per card, render only the first item's drawing — out of scope to lay out multiple.

The existing lazy-import requirement for `@react-pdf/renderer` (per CLAUDE.md) is preserved — the new image rendering lives in the same module that's already lazy-imported.

### Issuance RPC changes

Update `issue_job_card_from_pool()` (in `supabase/migrations/20260305195332_create_job_work_pool.sql`) to resolve and snapshot the drawing URL:

```sql
-- pseudocode inside the existing RPC, before INSERT INTO job_card_items
v_drawing_url := (
  SELECT odd.drawing_url
  FROM order_detail_drawings odd
  JOIN job_work_pool jwp ON jwp.order_detail_id = odd.order_detail_id AND jwp.bol_id = odd.bol_id
  WHERE jwp.pool_id = p_pool_id
);
IF v_drawing_url IS NULL THEN
  v_drawing_url := (
    SELECT
      CASE
        WHEN bl.drawing_url IS NOT NULL THEN bl.drawing_url
        WHEN bl.use_product_drawing THEN p.configurator_drawing_url
        ELSE NULL
      END
    FROM job_work_pool jwp
    JOIN billoflabour bl ON bl.bol_id = jwp.bol_id
    JOIN products p ON p.product_id = jwp.product_id
    WHERE jwp.pool_id = p_pool_id
  );
END IF;

INSERT INTO job_card_items (..., drawing_url) VALUES (..., v_drawing_url);
```

The existing FOR UPDATE locking and snapshot-reconciliation behavior is unchanged — drawing resolution is a read-only query inside the existing transaction.

### RLS

- `billoflabour.drawing_url` and `billoflabour.use_product_drawing` — same RLS as the existing `billoflabour` policies (no change).
- `products.configurator_drawing_url` — same as existing `products`.
- `order_detail_drawings` — new policies: org-scoped via `is_org_member(org_id)` for SELECT/INSERT/UPDATE/DELETE.
- `job_card_items.drawing_url` — same as existing `job_card_items`.

## Data Flow

1. **Configurator save.** User configures a cupboard, clicks Save to Product → configurator captures the technical preview to PNG → uploads to storage → updates `products.configurator_drawing_url`.
2. **BOL setup.** Admin opens product BOL editor for "1800 cupboard". For "Assemble Cupboard" job they choose *Use product drawing*. For "Pack" job they leave *None*.
3. **Order created.** Order added with one 1800 cupboard line. Order detail row created → work pool rows created (one per BOL row) → snapshot of BOL state at order time. No drawings stored yet on the work pool — resolution happens at issuance.
4. **Optional override.** On the order page, user uploads a SketchUp PNG against the (order_detail, Assemble Cupboard BOL row) pair → row written to `order_detail_drawings`.
5. **Job card issued.** User issues a card from the work pool row → `issue_job_card_from_pool` runs the resolve query → snapshots the drawing URL into `job_card_items.drawing_url`.
6. **Card printed.** PDF renderer reads `job_card_items.drawing_url` and embeds the image.

## Files to Modify

**Migrations (new):**
- `supabase/migrations/<timestamp>_bol_drawing_columns.sql` — schema changes for `billoflabour`, `products`, `order_detail_drawings`, `job_card_items`
- `supabase/migrations/<timestamp>_issue_job_card_drawing_resolve.sql` — replace the `issue_job_card_from_pool` function with the drawing-aware version

**Backend / API:**
- API route or server action for signing storage uploads (BOL, product, order-detail) — content-type + extension validation
- API route or server action for `order_detail_drawings` CRUD

**Frontend:**
- `components/features/configurator/FurnitureConfigurator.tsx` (or whichever holds the Save to Product handler) — add PNG capture + upload step
- BOL editor component — add 3-way radio + thumbnail (file path: search `BOL` editor in `components/features/products/`)
- Order detail expanded view — add per-job drawing override UI (likely under `components/features/orders/`)
- [components/features/job-cards/JobCardPDF.tsx](components/features/job-cards/JobCardPDF.tsx) — add drawing section to the printed layout
- [components/ui/input.tsx](components/ui/input.tsx) is unchanged; new file uploader component or reuse existing `order_attachments` upload pattern from the order page

**Types:**
- Extend `JobCardItem` type with `drawing_url`
- Add `OrderDetailDrawing` type
- Extend `BolRow` / `Product` types

**Dependencies:**
- Add `dom-to-image-more` (or equivalent) for client-side SVG-to-PNG capture in the configurator

## Acceptance Criteria

1. **Schema** — Migrations apply cleanly. `billoflabour_drawing_source_exclusive` CHECK rejects rows with both `drawing_url` set and `use_product_drawing = true`. `order_detail_drawings.UNIQUE(order_detail_id, bol_id)` rejects duplicate overrides.
2. **Configurator** — Saving an 1800 cupboard product writes `configurator_drawing_url`. The captured PNG renders the same content as the on-screen technical preview (Front + Side + Top + Assembly Details). The 3D preview is not captured.
3. **BOL editor** — For an 1800 cupboard's "Assemble Cupboard" row, switching to *Use product drawing* updates `use_product_drawing = true` and `drawing_url = NULL`. *Use product drawing* is disabled for products without a `configurator_drawing_url`. Switching away from *Upload custom* (to either *None* or *Use product drawing*) clears `drawing_url`. Switching to *Upload custom* sets `drawing_url` and clears `use_product_drawing`.
4. **Order page** — Uploading a SketchUp PNG override for `(order_detail X, Assemble Cupboard BOL row)` writes to `order_detail_drawings` and the row's resolved-source label switches to *Order override*. Removing the override falls back to *Use product drawing* / *Upload custom* / *None* per the BOL state.
5. **Issuance** — Issuing a card resolves correctly across all four tiers (override → BOL upload → product configurator → none). The resolved URL is snapshotted into `job_card_items.drawing_url`.
6. **Snapshot** — After a card is issued, editing the BOL `drawing_url`, toggling `use_product_drawing`, replacing the configurator drawing, or replacing the override does **not** change the value in `job_card_items.drawing_url` for the issued card.
7. **PDF** — When `drawing_url` is set on the job card item, the printed PDF renders the image filling the bottom region. When null, the drawing section is absent and the layout collapses cleanly. Verified end-to-end on at least one configurator-backed card and one BOL-upload-backed card.
8. **Format guard** — Uploading a `.pdf` or other non-image is rejected with a clear "PNG or JPEG only" error in all three upload paths.
9. **RLS** — Cross-org SELECT on `order_detail_drawings` returns zero rows; cross-org INSERT errors out.

## Out of Scope

- **Multiple drawings per BOL row** — single drawing per slot. Multi-image / multi-page support deferred until a real need surfaces.
- **PDF source files** — SketchUp users export as image, not PDF. PDF support deferred (would require server-side rasterization).
- **Auto-update of issued cards** — once snapshotted, drawings are frozen on the card. Reissuing a cancelled card re-resolves naturally.
- **Captioning, sort order, multi-attachment metadata** — the simple-column schema is intentionally narrow; if these become real needs, migrate to a `bol_attachments` table at that point.
- **Drawing capture from the 3D preview** — only the Technical view is captured.
- **Storage cleanup of orphaned files** — separate maintenance task; safe to defer.
- **Configurator products that aren't yet saved** — `configurator_drawing_url` is only populated on Save to Product. Users who want the drawing must save first.
- **Per-job drawings for non-configurator products without manual upload** — those rows just have no drawing. Manual upload is the only path.

## Risks

- **dom-to-image / html-to-image SVG fidelity.** Complex SVG with embedded fonts can rasterize poorly. Mitigation: smoke-test the capture against the existing cupboard + pigeonhole templates during implementation; if fidelity is bad, fall back to capturing a fixed bounding box via `html2canvas` or rendering server-side via puppeteer (heavier, last-resort).
- **Storage bucket public-read assumption.** `@react-pdf/renderer` fetches images at PDF render time. If the bucket requires signed URLs for read, the PDF will fail to embed. Verify `QButton` is public-read for the relevant prefixes (it is for existing `order_attachments`); if not, generate a signed URL at PDF render time.
- **Configurator product mismatch.** If a configurator-saved product is later edited via the configurator, `configurator_drawing_url` is overwritten. Already-issued cards are unaffected (snapshot), but pre-issuance cards on the same product will pick up the new drawing when they're issued. Acceptable behavior — flag in the BOL editor that the drawing reflects current configurator state.
- **CHECK constraint on existing rows.** Existing `billoflabour` rows have `drawing_url IS NULL` and `use_product_drawing = false` (default), satisfying the constraint trivially. No data backfill required.
