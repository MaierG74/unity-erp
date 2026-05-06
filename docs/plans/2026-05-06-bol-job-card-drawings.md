# BOL Job Card Drawings


## Purpose / Big Picture


Workshop operators receive printed job cards that today list the job, quantity, and signature blocks but no visual reference. This feature lets the office attach reference drawings to specific BOL (Bill of Labor) jobs, with three sources resolved at issuance: a per-order-line override, a per-(product × job) BOL upload, or a per-product configurator-generated drawing. After this lands, the office can: upload a drawing on a product's BOL row; toggle a BOL row to use the configurator-generated technical preview as its drawing; upload a one-off SketchUp PNG override on the order page; and the printed PDF for the issued job card embeds the resolved drawing between the items table and the work-log section. Already-issued cards are pixel-stable: their drawings never silently change, even when the underlying BOL or product drawing is later replaced.


## Progress


- [ ] Apply migration adding `billoflabour.drawing_url` + `billoflabour.use_product_drawing` (with mutual-exclusion CHECK), `products.configurator_drawing_url`, `job_card_items.drawing_url`, and `order_detail_drawings` table (with org-scoped RLS via `is_org_member()`)
- [ ] Apply migration replacing `issue_job_card_from_pool()` to resolve the drawing URL via the three-tier chain (override → BOL upload → product configurator) and snapshot it into `job_card_items.drawing_url`
- [ ] Add `types/drawings.ts` with `OrderDetailDrawing` and `ResolvedDrawingSource` types; extend `BOLItem` (`product-bol.tsx`) and `JobCardItem` (`JobCardPDF.tsx`, `JobCardsTab.tsx`) with the new fields; update relevant `.select(...)` calls
- [ ] Render the drawing section in `JobCardPDF.tsx` between the items table and the work-log section (reads from `JobCardItem.drawing_url`)
- [ ] Update every callsite that constructs `JobCardItem[]` for the PDF (primarily `JobCardsTab.tsx`) to fetch and pass `drawing_url`
- [ ] Implement `lib/db/bol-drawings.ts` (PNG/JPEG validator + UUID-pathed upload helper) with `node:test` unit tests
- [ ] Extend the BOL editor (`product-bol.tsx`) with the 3-way "Drawing source" radio (None / Upload custom / Use product drawing), file input gated by the `manual` choice, thumbnail preview, and a new "Drawing" column on the BOL table; wire the form submit to upload + persist `drawing_url`/`use_product_drawing`
- [ ] Add `dom-to-image-more` to dependencies
- [ ] Implement `lib/configurator/captureProductDrawing.ts` (UUID-pathed upload + persist `products.configurator_drawing_url`) with `node:test` unit tests
- [ ] Forward a `ref` from `TechnicalSvgPreview` and capture+upload the technical preview in `FurnitureConfigurator`'s `saveParts` after the existing save succeeds; capture failures must not break the save flow (warning toast only)
- [ ] Implement `lib/db/order-detail-drawings.ts` (UUID-pathed UPSERT, delete, list-by-order) with `node:test` unit tests
- [ ] Add per-row override UI to the work-pool view in `JobCardsTab.tsx`: resolved-source thumbnail + badge ("Order override" / "From BOL" / "From product"), upload/replace/remove controls, and a passive "Already issued" hint when a card has been issued from this row
- [ ] Run `npm run lint` and `npx tsc --noEmit` repo-wide; tolerate pre-existing failures unrelated to this work, fix anything new
- [ ] Browser smoke through the four user paths (BOL upload, format-rejection toast, configurator capture, order-line override + issuance + reprint snapshot stability) and clean up all synthetic test rows


## Surprises & Discoveries




## Decision Log




## Outcomes & Retrospective




## Context and Orientation


This repo is `unity-erp`, a Next.js 15 / React 19 / TypeScript ERP with a Supabase backend (Postgres + Storage + RLS). The relevant subsystems are:

- **BOL (Bill of Labor)** — `billoflabour` table, one row per `(product, job)` pair, columns include `bol_id`, `product_id`, `job_id`, `time_required`, `quantity`. Edited from the Product page's BOL tab in `components/features/products/product-bol.tsx`. The interface `BOLItem` lives at lines 87–102. Add/edit dialogs use `react-hook-form` + `zod` (see `bolItemSchema` near line 105). The dynamically imported `AddJobDialog` is in `components/features/products/AddJobDialog.tsx`.
- **Work pool + job cards** — `job_work_pool` (one row per `(order_detail, bol)` snapshot of demand), `job_cards` (issued cards), `job_card_items` (line items on a card, FK back to the work pool row via `work_pool_id`). Issuance is atomic via the Postgres function `issue_job_card_from_pool(p_pool_id, p_quantity, p_staff_id, p_override_reason)` defined in `supabase/migrations/20260305195332_create_job_work_pool.sql:358-474`. The function runs `SECURITY DEFINER`, locks the pool row `FOR UPDATE`, validates org membership via `is_org_member(auth.uid(), org_id)`, optionally creates exception rows, and inserts into `job_cards` + `job_card_items`. **CLAUDE.md rule: one job = one job card** — the items array on a card is always length 1 in current data, but code keeps the array shape.
- **Job card PDF** — `components/features/job-cards/JobCardPDF.tsx`. Lazy-imports `@react-pdf/renderer` (per CLAUDE.md, the entire module is dynamically loaded by callers). The current document layout is Header → Assignment Info → Notes (conditional) → Items Table → Work Log Section → Signature Section → Footer. The exported `JobCardItem` interface (lines 245–252) is the prop shape consumed by the PDF.
- **Order page work pool view** — `components/features/orders/JobCardsTab.tsx`. This is the tab on the order detail page that shows BOL-derived work-pool rows for the order's lines and lets the user issue cards. The query that fetches these rows starts around line 352. The interface for the row's items lives around lines 66–80. This file is also where issuance happens and where the user will see/manage the per-line drawing override.
- **Furniture configurator** — `/products/{productId}/configurator`. Component tree is rooted at `components/features/configurator/FurnitureConfigurator.tsx`. The technical preview (Front/Side/Top/Assembly composite) is rendered by `components/features/configurator/shared/TechnicalSvgPreview.tsx` (uses an internal `svgRef`). The "Save to Product" button calls a `saveParts` callback (lines 134–187) which POSTs to `/api/products/{productId}/cutlist-groups`.
- **Tenancy** — every org-scoped table carries `org_id UUID NOT NULL REFERENCES organizations(id)` (organizations PK is `id`, not `org_id`). RLS uses `is_org_member(auth.uid(), org_id)` returning boolean. All four CRUD policies (SELECT / INSERT / UPDATE / DELETE) are required for new tables. Privileges are `GRANT … TO authenticated`, plus `USAGE, SELECT` on the sequence for any `BIGSERIAL`/`SERIAL` PK.
- **Storage** — single bucket `QButton` (capital Q — verified in `lib/db/purchase-order-attachments.ts:59`). Direct browser-side upload pattern: `supabase.storage.from('QButton').upload(path, file)` → `getPublicUrl(path)` → DB insert with the resulting URL. The bucket prefix used by existing attachments is publicly readable, which `@react-pdf/renderer` relies on at PDF generation time to fetch and embed images. **For this feature, every upload uses a fresh UUID in the storage path** so re-uploads never overwrite a file an issued job card has snapshotted.
- **Test framework** — `node:test` + `node:assert/strict`, run via `npx tsx --test tests/<file>.test.ts`. Tests live in `tests/`. Pure-helper tests are the natural fit. UI verification is browser smoke per CLAUDE.md.
- **Migrations** — files in `supabase/migrations/` named `YYYYMMDDHHMMSS_descriptive_name.sql`. Apply via the Supabase Unity MCP (`mcp__supabase__apply_migration`, project ref `ttlyfhkrsjjrzxiagzpb`) or `supabase db push` locally. Boilerplate ends with `NOTIFY pgrst, 'reload schema';`.
- **Lint / typecheck** — `npm run lint` and `npx tsc --noEmit`. Pre-existing failures unrelated to the touched area are tolerated; do not fix unrelated breakage.

The full design (with reasoning, AC table, risks, out-of-scope items) is in `docs/superpowers/specs/2026-05-06-bol-job-card-drawings-design.md`. The TDD-checklist version of this plan is at `docs/superpowers/plans/2026-05-06-bol-job-card-drawings.md` for cross-reference, but this ExecPlan is the source of truth for execution.

**Branch:** all work happens on `codex/local-job-card-drawings-spec`, off `origin/codex/integration @ 2422ee9`. The branch already exists and contains the spec + the TDD plan + this ExecPlan.

**Snapshot guarantee.** When `issue_job_card_from_pool` runs, it resolves the drawing URL via the three-tier chain at that moment and copies the result into `job_card_items.drawing_url`. From that point on, the printed PDF reads only `job_card_items.drawing_url`. This is load-bearing: workshop operators must not see drawings change underneath them between issuance and printing. UUID storage paths reinforce this — the URL recorded in the row points at an immutable file.


## Plan of Work


Work proceeds in six logical phases. Phases 1–2 produce a backbone that's verifiable end-to-end via SQL alone (no UI yet). Phases 3–5 attach UI inputs for each of the three drawing sources. Phase 6 verifies the whole feature end-to-end.

**Phase 1 — schema + RPC + types.** Two migrations land first. The first adds the columns and the `order_detail_drawings` table with full RLS. The second replaces `issue_job_card_from_pool` to resolve and snapshot the drawing URL — preserve every other behavior of the existing function verbatim (locking, validation, exception creation), only adding the resolve query before `INSERT INTO job_card_items` and the new column in that INSERT. Then a TypeScript pass: create `types/drawings.ts` with the shared `OrderDetailDrawing` and `ResolvedDrawingSource` types; extend `BOLItem` in `product-bol.tsx` (add `drawing_url: string | null` and `use_product_drawing: boolean`); extend the `JobCardItem` interface in `JobCardPDF.tsx` (add `drawing_url?: string | null`); extend the row interface in `JobCardsTab.tsx`. Update every supabase select against `billoflabour` and `job_card_items` in those files to include the new columns.

**Phase 2 — PDF rendering.** Modify `JobCardPDF.tsx`: add styles for a `drawingSection` (12pt vertical margins), `drawingTitle` (small bold "Reference Drawing" label), and `drawingImage` (100% width, max-height ~320pt to leave the signature block above the page break, `objectFit: 'contain'`). Render the section between the closing `</View>` of the items table and the opening `<View>` of the Work Log Section, conditional on at least one item having a `drawing_url`; the "1 job per card" rule means in practice the first match is the only one. Update every callsite that builds `JobCardItem[]` for the PDF — primarily `JobCardsTab.tsx`, but find them all via `grep -rn 'JobCardPDFDocument\\|JobCardPDFDownload'` — to include `drawing_url` in the supabase select and in the row mapping. After this phase, manually setting `job_card_items.drawing_url` via SQL produces a printed PDF with the drawing.

**Phase 3 — BOL editor radio.** In `product-bol.tsx` (and the `AddJobDialog` it uses), extend `bolItemSchema` with `drawing_source: z.enum(['none', 'manual', 'product']).default('none')`. Render a 3-way radio in the form. The "Use product drawing" option is disabled when `products.configurator_drawing_url` is null for this product (resolve via a small `useQuery` for the product or via existing context). The "Upload custom" option reveals a file input that runs through `validateImageFile` synchronously on selection and rejects non-PNG/JPEG with a destructive toast. Submit logic: if `drawing_source === 'manual'` and a pending file is selected, upload through `uploadBolDrawing(file, bol_id)` and persist the returned URL in `billoflabour.drawing_url` while clearing `use_product_drawing`. If `'product'`, persist `use_product_drawing = true` and `drawing_url = NULL`. If `'none'`, clear both. For new BOL rows the upload happens after the insert returns the new `bol_id`. The BOL table gets a new "Drawing" column showing either a thumbnail (`drawing_url`), an "Outline 'Product drawing'" badge (`use_product_drawing`), or a muted dash. The DB CHECK constraint added in Phase 1 will reject any state that violates the radio's mutual exclusivity, providing defense-in-depth against UI bugs.

**Phase 4 — configurator capture.** Add `dom-to-image-more` to dependencies. Implement `lib/configurator/captureProductDrawing.ts` with `productDrawingStoragePath(productId, uuid)` (pure helper) and `captureAndUploadProductDrawing(node, productId)` (lazy-imports the library, calls `toPng` with `bgcolor: '#ffffff'` and `pixelRatio: 2`, converts the data URL to a Blob, uploads to `Product Drawings/{product_id}/{uuid}.png` with `upsert: false`, retrieves the public URL, and updates `products.configurator_drawing_url`). Forward a `ref` from `TechnicalSvgPreview` to its outermost wrapper `<div>` (use `React.forwardRef<HTMLDivElement, …>`). In `FurnitureConfigurator`, hold a `useRef<HTMLDivElement>(null)`, attach it to `<TechnicalSvgPreview ref={…}>`, and call `captureAndUploadProductDrawing(previewRef.current, productId)` inside `saveParts` after the existing `toast.success('Parts saved to product')` and before the `if (navigateToBuilder)` branch. Wrap the capture in its own try/catch and emit a warning toast on failure — capture must never block the existing save flow.

**Phase 5 — order-line override.** Implement `lib/db/order-detail-drawings.ts` with `orderDrawingStoragePath(orderDetailId, bolId, uuid, ext)` (pure helper), `uploadOrderDetailDrawing(file, orderDetailId, bolId, orgId)` (UUID-pathed upload + UPSERT into `order_detail_drawings` on `(order_detail_id, bol_id)`), `deleteOrderDetailDrawing(orderDetailId, bolId)` (DELETE the row, leave the storage file as orphan), and `listOrderDetailDrawings(orderId)` (returns all overrides for any order_detail belonging to this order). In `JobCardsTab.tsx`, alongside the existing work-pool fetch, fetch the override list, the BOL drawing fields for unique `bol_id`s in the pool, and the configurator URLs for unique `product_id`s. Compose them into a `ResolvedDrawingSource | null` per work-pool row using the spec's resolve order (override → BOL upload → product configurator → none). Render a thumbnail + a one-word source badge per row, plus an "Override drawing" / "Replace override" button (file input gated to PNG/JPEG via `validateImageFile`) and a "Remove" button when an override exists. After upload or remove, invalidate the local query so the badge re-resolves. If a card has already been issued from this work-pool row (use whatever existing field on the row reflects this — `completed_quantity > 0` or `status` field), show a passive muted "Already issued — won't affect printed cards" hint next to the controls; the controls remain enabled because future re-issuances will pick up the new override.

**Phase 6 — verification.** Run `npm run lint` and `npx tsc --noEmit` repo-wide; report pre-existing breakage but tolerate it. Run all three new test files. Then a Chrome MCP browser smoke covering the four user paths in Validation and Acceptance below, with explicit cleanup of every synthetic row inserted during the smoke. The cleanup step is load-bearing — synthetic data left in the live DB has, in past sessions, contaminated weekly payroll runs.


## Concrete Steps


1. **Confirm working tree clean and on the right branch** — run `git status --short` (expect empty) and `git branch --show-current` (expect `codex/local-job-card-drawings-spec`). If either is wrong, stop and surface to the user before proceeding.
2. **Phase 1 — schema migration.** Create `supabase/migrations/20260506120000_bol_drawing_columns.sql` with: ALTER TABLE on `billoflabour` adding `drawing_url TEXT` and `use_product_drawing BOOLEAN NOT NULL DEFAULT false`, plus the named CHECK constraint `billoflabour_drawing_source_exclusive` enforcing `NOT (drawing_url IS NOT NULL AND use_product_drawing = true)`; ALTER TABLE on `products` adding `configurator_drawing_url TEXT`; CREATE TABLE `order_detail_drawings` per the schema in Interfaces and Dependencies; CREATE INDEX `idx_order_detail_drawings_lookup`; ENABLE ROW LEVEL SECURITY; the four RLS policies; the GRANTs on the table and sequence; ALTER TABLE on `job_card_items` adding `drawing_url TEXT`; final `NOTIFY pgrst, 'reload schema';`. Apply via `mcp__supabase__apply_migration({ project_id: "ttlyfhkrsjjrzxiagzpb", name: "bol_drawing_columns", query: <SQL> })`. Verify with `mcp__supabase__execute_sql` that all columns/table exist and that an attempt to UPDATE a `billoflabour` row to set both `drawing_url = 'x'` and `use_product_drawing = true` fails with `check_violation`. Run `mcp__supabase__get_advisors({ project_id: "ttlyfhkrsjjrzxiagzpb", type: "security" })` and confirm zero new warnings on `order_detail_drawings`. Commit: `feat(db): add drawing columns to billoflabour, products, job_card_items + order_detail_drawings table`.
3. **Phase 1 — RPC migration.** Locate the most recent definition of `issue_job_card_from_pool` (`grep -l "issue_job_card_from_pool" supabase/migrations/*.sql`). Read its full body. Create `supabase/migrations/20260506121000_issue_job_card_drawing_resolve.sql` containing a full `CREATE OR REPLACE FUNCTION` for the same signature `(p_pool_id BIGINT, p_quantity INTEGER, p_staff_id UUID, p_override_reason TEXT DEFAULT NULL) RETURNS INTEGER`, copying every line of the existing body verbatim, with three additions: declare `v_drawing_url TEXT;` in the DECLARE block; add the resolve query (described in Interfaces and Dependencies) immediately before the existing `INSERT INTO job_card_items`; add the `drawing_url` column to that INSERT's column list and `v_drawing_url` to its values list. Preserve `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`. End the migration with `REVOKE EXECUTE … FROM anon`, `GRANT EXECUTE … TO authenticated`, and `NOTIFY pgrst, 'reload schema';`. Apply via MCP. Verify the resolve chain by calling the RPC against an existing pool row in four scenarios (none → product → BOL → override) and asserting `job_card_items.drawing_url` matches expectation each time. Clean up every synthetic mutation and inserted card before commit. Commit: `feat(db): resolve & snapshot drawing URL in issue_job_card_from_pool RPC`.
4. **Phase 1 — types.** Create `types/drawings.ts` with `OrderDetailDrawing` and `ResolvedDrawingSource` per the contracts in Interfaces and Dependencies. Extend `BOLItem` in `components/features/products/product-bol.tsx` with `drawing_url: string | null` and `use_product_drawing: boolean`; update every `.from('billoflabour').select(...)` in this file to include both columns. Extend the row item interface in `components/features/orders/JobCardsTab.tsx` and the supabase select against `job_card_items` to include `drawing_url`. Run `npx tsc --noEmit` and confirm no new errors mentioning `drawing_url`, `use_product_drawing`, or `OrderDetailDrawing`. Commit: `feat(types): extend BOLItem + JobCardItem with drawing fields, add OrderDetailDrawing type`.
5. **Phase 2 — PDF render.** In `components/features/job-cards/JobCardPDF.tsx`: add `drawing_url?: string | null` to the `JobCardItem` interface; add `Image` to the `@react-pdf/renderer` import if not already present; add the three new style entries to the `StyleSheet.create({…})` block; insert the conditional drawing section in `JobCardPDFDocument` between the closing `</View>` of the items table and the opening `<View style={styles.workLogSection}>` (use `items.find(i => i.drawing_url)` to pick the first item with a drawing). Lint + typecheck the file. Commit: `feat(job-card-pdf): render reference drawing between items table and work log`.
6. **Phase 2 — wire data.** Find every callsite of `JobCardPDFDocument` and `JobCardPDFDownload` (`grep -rn 'JobCardPDFDocument\\|JobCardPDFDownload' app/ components/ lib/`). For each, ensure `drawing_url` is included in the supabase select against `job_card_items` and propagated through the mapping that builds the `items: JobCardItem[]` prop. Manually verify by setting `job_card_items.drawing_url = 'https://placehold.co/600x400/png?text=Test'` on one existing item via SQL, downloading the PDF, confirming the test image renders between items table and work log, then reverting the SQL change. Commit: `feat(job-cards): pass drawing_url from job_card_items into PDF render`.
7. **Phase 3 — BOL upload helper.** Write `tests/bol-drawings.test.ts` with four cases (rejects non-image extension, rejects mismatched mime, accepts PNG, accepts JPEG). Run `npx tsx --test tests/bol-drawings.test.ts` to confirm failure (module missing). Implement `lib/db/bol-drawings.ts` per the contracts in Interfaces and Dependencies. Re-run; expect 4 passes. Commit: `feat(bol-drawings): add upload helper + image validation`.
8. **Phase 3 — BOL editor UI.** If `@/components/ui/radio-group` does not exist, run `pnpm dlx shadcn@latest add radio-group` (note: per CLAUDE.md the project uses npm; check `package.json`/`package-lock.json` and use the matching package manager). Extend `bolItemSchema` in `product-bol.tsx`. Add the 3-way radio FormField, the conditional file input (gated to `drawing_source === 'manual'`), and the thumbnail render. Wire submit per the prose in Plan of Work — including the "for new rows, upload after the insert returns `bol_id`, then UPDATE the row" sequence. Add a "Drawing" column to the BOL list table. Lint + typecheck the file. Commit: `feat(bol-editor): 3-way drawing source radio with upload + thumbnail`.
9. **Phase 4 — dependency.** Run `npm install dom-to-image-more`. Verify with `node -e "import('dom-to-image-more').then(m => console.log(typeof m.toPng))"` (expect `function`). Commit: `build: add dom-to-image-more for SVG-to-PNG capture`.
10. **Phase 4 — capture helper.** Write `tests/capture-product-drawing.test.ts` covering the storage path helper (valid case asserts the exact path string; invalid IDs throw). Run; expect failure. Implement `lib/configurator/captureProductDrawing.ts` per the contracts. Re-run; expect 2 passes. Commit: `feat(configurator): captureAndUploadProductDrawing helper`.
11. **Phase 4 — wire configurator.** In `components/features/configurator/shared/TechnicalSvgPreview.tsx`, change the export to `React.forwardRef<HTMLDivElement, TechnicalSvgPreviewProps>(…)` and attach the forwarded ref to the outermost wrapper `<div>`. In `components/features/configurator/FurnitureConfigurator.tsx`, declare `const previewRef = React.useRef<HTMLDivElement>(null);`, pass `<TechnicalSvgPreview ref={previewRef} …>`, and inside `saveParts`'s try block (after the existing `toast.success('Parts saved to product')`, before `if (navigateToBuilder)`), wrap a call to `captureAndUploadProductDrawing(previewRef.current, productId)` in its own try/catch with `toast.warning('Parts saved, but reference drawing capture failed')` on failure. Browser-smoke this single path: log in as `testai@qbutton.co.za`, navigate to a configurator product (e.g. `/products/859/configurator`), click Save to Product, confirm `products.configurator_drawing_url` is set to a `…/Product Drawings/859/<uuid>.png` URL, open it and verify the PNG matches the on-screen technical preview. Commit: `feat(configurator): capture technical preview as PNG on Save to Product`.
12. **Phase 5 — order-detail upload helper.** Write `tests/order-detail-drawings.test.ts` covering the storage path helper. Run; expect failure. Implement `lib/db/order-detail-drawings.ts` per the contracts (re-using `validateImageFile` from `bol-drawings.ts`). Re-run; expect 2 passes. Commit: `feat(order-drawings): UPSERT/delete helpers for per-order-line overrides`.
13. **Phase 5 — order-page UI.** In `JobCardsTab.tsx`, add the `useQuery` for drawing context (overrides + BOL drawing fields + product configurator URLs). Add the `resolveDrawingForRow` helper. In the work-pool row rendering, inject a "Drawing" cell with thumbnail + source badge + the `DrawingOverrideMenu` controls (file input, replace, remove) and the "Already issued" passive hint. After upload/delete, invalidate `['order-drawing-context']`. Resolve `orgId` from the existing org-scoped context in this file. Lint + typecheck. Commit: `feat(orders): per-row drawing override UI with resolved-source badge`.
14. **Phase 6 — repo-wide checks.** Run `npm run lint` and `npx tsc --noEmit`. Capture full output for the artifacts section. Run all three new test files: `npx tsx --test tests/bol-drawings.test.ts tests/capture-product-drawing.test.ts tests/order-detail-drawings.test.ts` (expect 8 passes). No commit — verification step only.
15. **Phase 6 — browser smoke.** Start the dev server via `mcp__Claude_Preview__preview_start({ name: 'next-dev' })`. Walk through the four paths in Validation and Acceptance, capturing transcripts/screenshots in Artifacts and Notes. Clean up every synthetic row inserted during smoke (overrides, test BOL rows, test job cards) — verify zero remain. Stop the dev server.
16. **Wrap-up.** Run `/simplify` per CLAUDE.md (>3 files modified). Push branch: `git push -u origin codex/local-job-card-drawings-spec`. Report status, with the appended PLANS.md and the lint/typecheck/test transcripts.


## Validation and Acceptance


Each path is observable workshop-floor or office behaviour. Test account: `testai@qbutton.co.za` / `ClaudeTest2026!` / org QButton.

**Path A — BOL upload + format guard.** On a product's BOL editor, opening an existing BOL row and switching the Drawing source to "Upload custom", picking a sample PNG, and saving makes the BOL list show that row's drawing thumbnail in the new "Drawing" column. The `billoflabour` row, when SELECTed, has `drawing_url` set to a `https://ttlyfhkrsjjrzxiagzpb.supabase.co/storage/v1/object/public/QButton/BOL Drawings/<bol_id>/<uuid>.png` URL and `use_product_drawing = false`. In the same dialog, attempting to upload a `.pdf` file produces a destructive toast reading "PNG or JPEG required" (or similar) and the file is rejected — the form's `drawing_url` does not change. (Spec ACs 3, 8.)

**Path B — configurator capture.** Navigating to `/products/859/configurator` (or another configurator-backed product) and clicking "Save to Product" produces a success toast for the existing parts save AND populates `products.configurator_drawing_url` for that product with a `…/Product Drawings/859/<uuid>.png` URL. Opening that URL in a fresh browser tab shows a PNG that visually matches the technical preview panel (Front + Side + Top + Assembly). The save flow does not block or error if the capture sub-step fails — instead a warning toast appears. (Spec AC 2.)

**Path C — Use product drawing toggle.** With the configurator drawing populated from Path B, opening the same product's BOL editor and switching one BOL row's Drawing source to "Use product drawing" and saving makes the BOL list show a "Product drawing" badge for that row. The `billoflabour` row has `drawing_url = NULL` and `use_product_drawing = true`. Switching that same row to "None" and re-saving clears both fields. The "Use product drawing" radio is disabled (greyed) for products whose `products.configurator_drawing_url` is null. (Spec AC 3.)

**Path D — order-line override + issuance + snapshot.** With the BOL row from Path C, opening an order containing that product and navigating to the Job Cards tab shows the work-pool row for that BOL with a thumbnail of the configurator drawing and a "From product" badge. Clicking "Override drawing" and uploading a different SketchUp-style PNG switches the badge to "Order override" and shows the new image; an `order_detail_drawings` row exists with `drawing_url` matching `…/Order Drawings/<order_detail_id>-<bol_id>/<uuid>.png`. Issuing a job card from that row writes `job_card_items.drawing_url` to the override URL. Downloading the printed PDF for that card shows the override drawing rendered between the items table and the work-log section, sized to roughly half the page height with the signature block still visible. After issuance, replacing the override with a third image on the order page does not change `job_card_items.drawing_url` for the already-issued card (still the original override URL); reprinting the issued PDF still shows the original override drawing. The order-page row reflects the third image with badge "Order override" and a passive "Already issued" hint. (Spec ACs 4, 5, 6, 7.)

**Final.** `npm run lint` exits with no NEW warnings/errors attributable to files this plan touched. `npx tsc --noEmit` exits with no NEW errors attributable to files this plan touched. `npx tsx --test tests/bol-drawings.test.ts tests/capture-product-drawing.test.ts tests/order-detail-drawings.test.ts` reports 8 passes, 0 failures. `mcp__supabase__get_advisors({ project_id: "ttlyfhkrsjjrzxiagzpb", type: "security" })` reports no new RLS warnings on `order_detail_drawings`. After the smoke is complete, every synthetic row inserted during testing is deleted; SELECTs against `order_detail_drawings`, `job_cards`, `job_card_items`, and modified `billoflabour`/`products` rows show no leftover synthetic data.


## Idempotence and Recovery


**Migrations.** Both migrations are designed to be safe to retry until they succeed. If the first migration partially applies and is interrupted, re-running it will fail on the already-existing column or table — fix is to inspect via `\\d billoflabour`, `\\d order_detail_drawings`, etc., and run the missing pieces individually; or roll back the partial state with explicit `ALTER TABLE … DROP COLUMN` / `DROP TABLE order_detail_drawings` and re-apply cleanly. The second migration uses `CREATE OR REPLACE FUNCTION` and is naturally idempotent — re-running replaces the function. Rollback for the function is to copy the prior body back into a `CREATE OR REPLACE FUNCTION` statement and apply.

**Storage uploads.** Each upload writes to a brand-new UUID-suffixed path with `upsert: false`, so retries after a failed DB insert produce orphaned files but never collide. Cleanup of orphans is out of scope. If a DB insert fails after a successful upload, the next upload attempt will again write a fresh UUID; the row's `drawing_url` only ever points at one specific file.

**RPC re-issuance.** The existing function's `FOR UPDATE` lock and validation logic is preserved, so concurrent issuance attempts retain their original safety. The new resolve query is read-only and runs inside the existing transaction; if it fails, the entire issuance rolls back. Re-issuing a cancelled card naturally re-runs the resolve and produces a fresh `job_card_items.drawing_url` from current state — this is the correct behavior.

**Browser-smoke synthetic data.** Every test row inserted during smoke must be deleted in the same session — this is non-negotiable per CLAUDE.md (synthetic wage data has bled into payroll runs in past sessions). Recovery for forgotten cleanup: the cleanup SQL in the smoke step deletes synthetic rows by their IDs; if you forget to capture an ID, query `order_detail_drawings WHERE uploaded_at > <test_start>` and `job_cards WHERE issue_date::date = <today> AND staff_id = <test_user_uuid>`.

**TypeScript / lint.** All edits compile cleanly in isolation. If a tsc error appears after a step, the corresponding `git checkout -- <file>` reverts that file and rebuilds the change locally. Fast forward only — no rebases against `codex/integration` mid-execution.


## Artifacts and Notes




## Interfaces and Dependencies


**New dependency.** `dom-to-image-more` (latest stable, ~1.x). Installed via `npm install dom-to-image-more`. Lazy-imported inside `captureAndUploadProductDrawing` so it doesn't bloat the initial bundle.

**Schema additions.**

```sql
ALTER TABLE billoflabour
  ADD COLUMN drawing_url TEXT,
  ADD COLUMN use_product_drawing BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE billoflabour
  ADD CONSTRAINT billoflabour_drawing_source_exclusive
  CHECK (NOT (drawing_url IS NOT NULL AND use_product_drawing = true));

ALTER TABLE products
  ADD COLUMN configurator_drawing_url TEXT;

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

ALTER TABLE job_card_items
  ADD COLUMN drawing_url TEXT;
```

RLS on `order_detail_drawings`: enable RLS, then four policies (SELECT, INSERT, UPDATE, DELETE) all using `is_org_member(auth.uid(), org_id)`. Grant SELECT/INSERT/UPDATE/DELETE to `authenticated`, plus USAGE+SELECT on `order_detail_drawings_id_seq`.

**RPC additions** (inside the existing `issue_job_card_from_pool` body, preserving every other line):

```sql
-- DECLARE block: add v_drawing_url TEXT;

-- Before the existing INSERT INTO job_card_items, run:
SELECT odd.drawing_url INTO v_drawing_url
FROM order_detail_drawings odd
JOIN job_work_pool jwp
  ON jwp.order_detail_id = odd.order_detail_id
 AND jwp.bol_id = odd.bol_id
WHERE jwp.pool_id = p_pool_id;

IF v_drawing_url IS NULL THEN
  SELECT
    CASE
      WHEN bl.drawing_url IS NOT NULL THEN bl.drawing_url
      WHEN bl.use_product_drawing THEN p.configurator_drawing_url
      ELSE NULL
    END
  INTO v_drawing_url
  FROM job_work_pool jwp
  JOIN billoflabour bl ON bl.bol_id = jwp.bol_id
  JOIN products p ON p.product_id = jwp.product_id
  WHERE jwp.pool_id = p_pool_id;
END IF;

-- INSERT INTO job_card_items: add drawing_url to the column list and v_drawing_url to the values list.
```

**TypeScript types** in `types/drawings.ts`:

```ts
export type DrawingSource = 'none' | 'manual' | 'product';

export interface OrderDetailDrawing {
  id: number;
  order_detail_id: number;
  bol_id: number;
  drawing_url: string;
  org_id: string;
  uploaded_by: string | null;
  uploaded_at: string;
}

export type ResolvedDrawingSource =
  | { source: 'override'; url: string }
  | { source: 'bol'; url: string }
  | { source: 'product'; url: string }
  | null;
```

**`BOLItem` extension** (in `components/features/products/product-bol.tsx`): add `drawing_url: string | null` and `use_product_drawing: boolean` (non-optional).

**`JobCardItem` extension** (in `components/features/job-cards/JobCardPDF.tsx`): add `drawing_url?: string | null`.

**Helper module contracts.**

`lib/db/bol-drawings.ts` exports:
```ts
export function validateImageFile(file: File): void;
export function bolDrawingStoragePath(bolId: number, uuid: string, ext: string): string;
export async function uploadBolDrawing(file: File, bolId: number): Promise<string>; // returns public URL
```

`validateImageFile` accepts only `image/png` or `image/jpeg` MIME with extension in `{png, jpg, jpeg}`; throws `Error('PNG or JPEG required')` otherwise.

`bolDrawingStoragePath` returns `BOL Drawings/{bolId}/{uuid}.{ext}`. Throws on non-positive `bolId`.

`uploadBolDrawing` validates, generates `crypto.randomUUID()`, uploads to the path with `upsert: false`, returns the public URL via `getPublicUrl`. Storage bucket `QButton`.

`lib/configurator/captureProductDrawing.ts` exports:
```ts
export function productDrawingStoragePath(productId: number, uuid: string): string;
export async function captureAndUploadProductDrawing(node: HTMLElement, productId: number): Promise<string>;
```

`productDrawingStoragePath` returns `Product Drawings/{productId}/{uuid}.png`. Throws on non-positive `productId`.

`captureAndUploadProductDrawing` lazy-imports `dom-to-image-more`, calls `toPng(node, { cacheBust: true, bgcolor: '#ffffff', pixelRatio: 2 })`, fetches the data URL into a Blob, generates a UUID, uploads to the storage path with `upsert: false`, retrieves the public URL, updates `products.configurator_drawing_url` for `productId`, and returns the URL.

`lib/db/order-detail-drawings.ts` exports:
```ts
export function orderDrawingStoragePath(orderDetailId: number, bolId: number, uuid: string, ext: string): string;
export async function uploadOrderDetailDrawing(
  file: File, orderDetailId: number, bolId: number, orgId: string
): Promise<OrderDetailDrawing>;
export async function deleteOrderDetailDrawing(orderDetailId: number, bolId: number): Promise<void>;
export async function listOrderDetailDrawings(orderId: number): Promise<OrderDetailDrawing[]>;
```

`orderDrawingStoragePath` returns `Order Drawings/{orderDetailId}-{bolId}/{uuid}.{ext}`. Throws on non-positive ids.

`uploadOrderDetailDrawing` validates the file, uploads under a fresh UUID, and UPSERTs the row in `order_detail_drawings` on the `(order_detail_id, bol_id)` unique constraint, replacing the prior `drawing_url` for that pair.

`deleteOrderDetailDrawing` deletes the row by `(order_detail_id, bol_id)`. Storage file is left as orphan.

`listOrderDetailDrawings(orderId)` joins via `order_details.order_id` and returns all override rows for any of the order's lines.

**PDF render contract.** In `JobCardPDFDocument`, between the items-table closing `</View>` and the work-log section's opening `<View>`, render the drawing section iff `items.find(i => i.drawing_url)` returns a match. The section comprises: an optional small bold "Reference Drawing" heading; an `<Image src={drawing.drawing_url} style={styles.drawingImage} />` where `drawingImage` has `width: '100%'`, `maxHeight: 320`, `objectFit: 'contain'`. The section's outer view has 12pt vertical margins.

**BOL editor radio contract.** `bolItemSchema` extended with `drawing_source: z.enum(['none', 'manual', 'product']).default('none')`. A pending file is held in component state separately from the form and uploaded only on submit. The "Use product drawing" radio is disabled when the parent product has no `configurator_drawing_url`. On submit, the persisted state is one of: (`drawing_url = url`, `use_product_drawing = false`), (`drawing_url = NULL`, `use_product_drawing = true`), or (`drawing_url = NULL`, `use_product_drawing = false`) — these match the three radio choices and are enforced by the DB CHECK constraint as defense-in-depth.

**Order-page resolve helper signature** (pure function, can live inline in `JobCardsTab.tsx` or be extracted to `lib/drawings/resolve.ts` with its own test):

```ts
function resolveDrawingForRow(
  row: { order_detail_id: number | null; bol_id: number | null; product_id: number | null },
  ctx: {
    overrides: OrderDetailDrawing[];
    bolByid: Map<number, { drawing_url: string | null; use_product_drawing: boolean }>;
    productById: Map<number, { configurator_drawing_url: string | null }>;
  }
): ResolvedDrawingSource;
```

Resolves in the order: override (matching both `order_detail_id` and `bol_id`) → BOL `drawing_url` → BOL `use_product_drawing` ? product `configurator_drawing_url` : null → null.

**Storage bucket.** Single bucket `QButton` (capital Q). All three path families (`BOL Drawings/`, `Product Drawings/`, `Order Drawings/`) live under this bucket. Public-read for the same prefixes that existing attachment uploads use — no signed URL flow needed for `@react-pdf/renderer` to embed images.

**Test framework.** `node:test` + `node:assert/strict`, run via `npx tsx --test tests/<file>.test.ts`. Three new test files: `tests/bol-drawings.test.ts` (4 cases — image validation), `tests/capture-product-drawing.test.ts` (2 cases — storage path helper), `tests/order-detail-drawings.test.ts` (2 cases — storage path helper). 8 cases total, all on pure helpers.
