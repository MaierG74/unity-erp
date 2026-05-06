# Job Card Drawings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task ends with a commit. Do not batch tasks into a single commit.

**Goal:** Add optional reference drawings to printed job cards. Drawings can come from a per-product BOL upload, a per-order-line override, or the furniture configurator's technical preview.

**Architecture:** Three-tier resolve at job-card issuance — `order_detail_drawings` → `billoflabour.drawing_url` → `products.configurator_drawing_url` (when `billoflabour.use_product_drawing = true`) → none. The resolved URL is **snapshotted** into `job_card_items.drawing_url` so issued cards never silently change. The PDF renderer reads the snapshot and embeds the image between the items table and the work-log section. Configurator captures the technical preview client-side via `dom-to-image-more` on Save to Product.

**Tech Stack:** Next.js 15 / React 19 / TypeScript, Supabase (Postgres + Storage), `@react-pdf/renderer` (lazy-imported), `dom-to-image-more` for SVG→PNG capture (new dep). Tests via `node:test` invoked with `npx tsx --test`.

**Spec:** [docs/superpowers/specs/2026-05-06-bol-job-card-drawings-design.md](../specs/2026-05-06-bol-job-card-drawings-design.md). Read it once before starting.

**Branch:** `codex/local-job-card-drawings-spec` (off `origin/codex/integration @ 2422ee9`). Already created and active. Commit `75ebd78` is the spec doc.

---

## Context (read first)

**Storage bucket.** Reuse the existing `QButton` Supabase Storage bucket (capital Q — verified in `lib/db/purchase-order-attachments.ts:59`). Three path conventions; **every upload uses a fresh UUID** so that re-uploading does not overwrite the file an issued job card snapshotted (load-bearing for the snapshot-at-issuance guarantee):

- BOL manual uploads → `BOL Drawings/{bol_id}/{uuid}.{ext}`
- Configurator-captured → `Product Drawings/{product_id}/{uuid}.png`
- Order-line overrides → `Order Drawings/{order_detail_id}-{bol_id}/{uuid}.{ext}`

A re-upload writes to a new UUID path; the row's `drawing_url` updates to the new path; old issued cards keep their original snapshotted URL (still served from storage). Orphaned old files accumulate — cleanup is a separate maintenance task, out of scope.

**RPC.** The existing `issue_job_card_from_pool()` lives at `supabase/migrations/20260305195332_create_job_work_pool.sql:358-474`. It runs as `SECURITY DEFINER` with `set search_path = public`, validates org membership via `is_org_member(auth.uid(), org_id)`, locks the pool row `FOR UPDATE`, inserts into `job_cards` then `job_card_items`. The drawing-aware replacement adds a resolve step before the `INSERT INTO job_card_items` call.

**Tenancy.** Every new table/column with org-scoped data takes `org_id UUID NOT NULL REFERENCES organizations(id)` (organizations PK is `id`). RLS uses `is_org_member(auth.uid(), org_id)`.

**Test framework.** `node:test` + `node:assert/strict`, run via `npx tsx --test tests/<file>.test.ts`. Pure-helper tests are the natural fit. UI verification is via Chrome MCP browser smoke per CLAUDE.md (see Phase 6).

**File-upload pattern.** `lib/db/purchase-order-attachments.ts:77-135` is the canonical example: direct browser-side upload via `supabase.storage.from('QButton').upload(path, file)`, then `getPublicUrl()`, then DB record insert. No signed URLs needed for read — the bucket prefix is public-read for the existing patterns.

**Lazy PDF import.** Per CLAUDE.md, anything importing `@react-pdf/renderer` must be dynamically imported. `components/features/job-cards/JobCardPDF.tsx` is already structured this way — the changes here stay inside that already-lazy module.

## Verification harness for every task

- Lint: `npm run lint` (tolerate pre-existing warnings unrelated to this plan)
- Type-check: `npx tsc --noEmit` (tolerate pre-existing errors unrelated to this plan)
- Targeted tests when present: `npx tsx --test tests/<file>.test.ts`
- Migrations apply via Supabase Unity MCP (`mcp__supabase__apply_migration`) or local `supabase db push` — see Task 1 for the exact command.
- Browser smoke at the end via Chrome MCP — Phase 6.

---

## Phase 1 — Schema, RPC, Types (foundation)

Two migrations + a types pass. After Phase 1 you can manually insert a `job_card_items.drawing_url` via SQL and the PDF will render it (Phase 2 wires the data path; Phases 3–5 wire the UI inputs).

### Task 1: Migration — drawing columns and override table

**Files:**
- Create: `supabase/migrations/20260506120000_bol_drawing_columns.sql`

- [ ] **Step 1.1: Write the migration**

```sql
-- BOL drawing columns + product configurator drawing + order-line override table + job_card_items snapshot

-- 1. billoflabour: manual upload + opt-in flag for product drawing
ALTER TABLE billoflabour
  ADD COLUMN drawing_url TEXT,
  ADD COLUMN use_product_drawing BOOLEAN NOT NULL DEFAULT false;

-- Mutually exclusive: drawing_url set XOR use_product_drawing true (or both empty)
ALTER TABLE billoflabour
  ADD CONSTRAINT billoflabour_drawing_source_exclusive
  CHECK (NOT (drawing_url IS NOT NULL AND use_product_drawing = true));

-- 2. products: configurator-captured drawing
ALTER TABLE products
  ADD COLUMN configurator_drawing_url TEXT;

-- 3. order_detail_drawings: per-order-line override
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

CREATE INDEX idx_order_detail_drawings_lookup
  ON order_detail_drawings(order_detail_id, bol_id);

-- RLS: org-scoped via is_org_member()
ALTER TABLE order_detail_drawings ENABLE ROW LEVEL SECURITY;

CREATE POLICY order_detail_drawings_select
  ON order_detail_drawings FOR SELECT
  USING (is_org_member(auth.uid(), org_id));

CREATE POLICY order_detail_drawings_insert
  ON order_detail_drawings FOR INSERT
  WITH CHECK (is_org_member(auth.uid(), org_id));

CREATE POLICY order_detail_drawings_update
  ON order_detail_drawings FOR UPDATE
  USING (is_org_member(auth.uid(), org_id))
  WITH CHECK (is_org_member(auth.uid(), org_id));

CREATE POLICY order_detail_drawings_delete
  ON order_detail_drawings FOR DELETE
  USING (is_org_member(auth.uid(), org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON order_detail_drawings TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE order_detail_drawings_id_seq TO authenticated;

-- 4. job_card_items: snapshot column for the resolved drawing
ALTER TABLE job_card_items
  ADD COLUMN drawing_url TEXT;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 1.2: Apply the migration**

Use the Supabase Unity MCP if available:

```
mcp__supabase__apply_migration({
  project_id: "ttlyfhkrsjjrzxiagzpb",
  name: "bol_drawing_columns",
  query: "<paste the SQL above>"
})
```

If MCP is unavailable, run locally: `supabase db push`.

Expected: success, no errors. Schema reload notice shown.

- [ ] **Step 1.3: Verify column existence**

Run via MCP `mcp__supabase__execute_sql` (or `psql` against the dev project):

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'billoflabour' AND column_name IN ('drawing_url', 'use_product_drawing');

SELECT column_name FROM information_schema.columns
WHERE table_name = 'products' AND column_name = 'configurator_drawing_url';

SELECT column_name FROM information_schema.columns
WHERE table_name = 'job_card_items' AND column_name = 'drawing_url';

SELECT count(*) FROM order_detail_drawings;  -- 0
```

Expected: all four queries return rows confirming the new columns/table.

- [ ] **Step 1.4: Verify CHECK constraint behavior**

```sql
-- Should fail with check_violation
INSERT INTO billoflabour (product_id, job_id, time_required, drawing_url, use_product_drawing)
VALUES (1, 1, 0, 'test-url', true);

-- Should succeed (rollback after)
BEGIN;
UPDATE billoflabour SET drawing_url = 'test-url' WHERE bol_id = (SELECT MIN(bol_id) FROM billoflabour);
ROLLBACK;
```

Expected: first INSERT errors with `new row for relation "billoflabour" violates check constraint`; second UPDATE succeeds inside the transaction.

- [ ] **Step 1.5: Run advisors**

```
mcp__supabase__get_advisors({ project_id: "ttlyfhkrsjjrzxiagzpb", type: "security" })
```

Expected: zero new RLS warnings on `order_detail_drawings`. Pre-existing warnings on unrelated tables are OK.

- [ ] **Step 1.6: Commit**

```bash
git add supabase/migrations/20260506120000_bol_drawing_columns.sql
git commit -m "feat(db): add drawing columns to billoflabour, products, job_card_items + order_detail_drawings table"
```

---

### Task 2: Migration — replace `issue_job_card_from_pool` to resolve + snapshot drawing

**Files:**
- Create: `supabase/migrations/20260506121000_issue_job_card_drawing_resolve.sql`

**Why a full replacement.** Postgres `CREATE OR REPLACE FUNCTION` requires the new signature to match the old one. The existing function returns `INTEGER` (the new `job_card_id`) — keep that signature. We're modifying internal behavior only: resolve the drawing URL and pass it through to `INSERT INTO job_card_items`. All other behavior (FOR UPDATE locking, snapshot reconciliation, exception generation) is preserved verbatim.

- [ ] **Step 2.1: Read the current function definition**

Open `supabase/migrations/20260305195332_create_job_work_pool.sql` and copy lines 358-474 (the entire CREATE FUNCTION block). Inspect it so you understand the existing flow before modifying. Pay attention to:

- Parameter list: `p_pool_id BIGINT, p_quantity INTEGER, p_staff_id UUID, p_override_reason TEXT`
- The `SELECT … FOR UPDATE` lock on `job_work_pool`
- The validation and exception-creation logic (untouched)
- The two `INSERT` statements: `job_cards`, then `job_card_items`

Look for any subsequent migrations that have already replaced this function — search for `issue_job_card_from_pool` across `supabase/migrations/`:

```bash
grep -l "issue_job_card_from_pool" supabase/migrations/*.sql
```

If a later migration has already replaced it, copy *that* version as the baseline (most recent definition wins).

- [ ] **Step 2.2: Write the migration**

The SQL below is the full replacement. Replace the placeholder `<EXISTING BODY UP TO INSERT JOB_CARD_ITEMS>` with the verbatim body from Step 2.1, and `<EXISTING BODY AFTER INSERT JOB_CARD_ITEMS>` with the verbatim trailing portion. The only new logic is: (a) the `v_drawing_url` declaration; (b) the resolve query that runs before `INSERT INTO job_card_items`; (c) the additional column in the `INSERT`.

```sql
CREATE OR REPLACE FUNCTION issue_job_card_from_pool(
  p_pool_id BIGINT,
  p_quantity INTEGER,
  p_staff_id UUID,
  p_override_reason TEXT DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- (existing DECLARE block — copy verbatim from current definition)
  v_drawing_url TEXT;  -- NEW
BEGIN
  -- <EXISTING BODY UP TO BUT NOT INCLUDING INSERT INTO job_card_items>

  -- NEW: resolve drawing URL (3-tier chain)
  -- Tier 1: order-line override
  SELECT odd.drawing_url INTO v_drawing_url
  FROM order_detail_drawings odd
  JOIN job_work_pool jwp
    ON jwp.order_detail_id = odd.order_detail_id
   AND jwp.bol_id = odd.bol_id
  WHERE jwp.pool_id = p_pool_id;

  -- Tier 2 + 3: BOL upload, then product configurator (gated by use_product_drawing)
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

  -- INSERT INTO job_card_items now includes drawing_url
  INSERT INTO job_card_items (
    job_card_id,
    product_id,
    job_id,
    quantity,
    piece_rate,
    work_pool_id,
    drawing_url   -- NEW
    -- (other existing columns — copy from current definition)
  ) VALUES (
    v_job_card_id,
    v_product_id,
    v_job_id,
    p_quantity,
    v_piece_rate,
    p_pool_id,
    v_drawing_url   -- NEW
    -- (other existing values)
  );

  -- <EXISTING BODY AFTER INSERT INTO job_card_items, e.g. status updates, RETURN>
  RETURN v_job_card_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION issue_job_card_from_pool(BIGINT, INTEGER, UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION issue_job_card_from_pool(BIGINT, INTEGER, UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
```

**Important:** Do NOT skip preserving the existing function body. The existing logic includes pool locking, validation, exception generation, and snapshot reconciliation that this plan does not touch. Anything you omit is a regression.

- [ ] **Step 2.3: Apply the migration**

```
mcp__supabase__apply_migration({ project_id: "ttlyfhkrsjjrzxiagzpb", name: "issue_job_card_drawing_resolve", query: "<paste SQL>" })
```

Expected: success.

- [ ] **Step 2.4: Verify resolve chain via SQL**

Set up a temporary fixture and call the RPC:

```sql
-- Pick an existing order's pool row, ensure no drawings yet
SELECT pool_id, bol_id, order_detail_id, product_id, job_id
FROM job_work_pool
WHERE status = 'active' LIMIT 1;
-- Note the values — call this <POOL_ID>, <BOL_ID>, <ORDER_DETAIL_ID>, <PRODUCT_ID>

-- Tier 4 (none): no drawings configured
-- Issue a card and check job_card_items.drawing_url is NULL
SELECT issue_job_card_from_pool(<POOL_ID>, 1, '<TEST_STAFF_UUID>', NULL);
SELECT drawing_url FROM job_card_items
WHERE work_pool_id = <POOL_ID> ORDER BY item_id DESC LIMIT 1;
-- Expected: NULL

-- Tier 3 (product configurator): set products.configurator_drawing_url + bol.use_product_drawing
UPDATE products SET configurator_drawing_url = 'https://example.com/p.png' WHERE product_id = <PRODUCT_ID>;
UPDATE billoflabour SET use_product_drawing = true WHERE bol_id = <BOL_ID>;
SELECT issue_job_card_from_pool(<POOL_ID>, 1, '<TEST_STAFF_UUID>', NULL);
SELECT drawing_url FROM job_card_items WHERE work_pool_id = <POOL_ID> ORDER BY item_id DESC LIMIT 1;
-- Expected: 'https://example.com/p.png'

-- Tier 2 (BOL upload): set bol.drawing_url, clear use_product_drawing
UPDATE billoflabour SET use_product_drawing = false, drawing_url = 'https://example.com/b.png' WHERE bol_id = <BOL_ID>;
SELECT issue_job_card_from_pool(<POOL_ID>, 1, '<TEST_STAFF_UUID>', NULL);
SELECT drawing_url FROM job_card_items WHERE work_pool_id = <POOL_ID> ORDER BY item_id DESC LIMIT 1;
-- Expected: 'https://example.com/b.png'

-- Tier 1 (override): insert into order_detail_drawings
INSERT INTO order_detail_drawings (order_detail_id, bol_id, drawing_url, org_id)
VALUES (<ORDER_DETAIL_ID>, <BOL_ID>, 'https://example.com/o.png', '<ORG_UUID>');
SELECT issue_job_card_from_pool(<POOL_ID>, 1, '<TEST_STAFF_UUID>', NULL);
SELECT drawing_url FROM job_card_items WHERE work_pool_id = <POOL_ID> ORDER BY item_id DESC LIMIT 1;
-- Expected: 'https://example.com/o.png'

-- CLEANUP: roll back the test mutations
UPDATE products SET configurator_drawing_url = NULL WHERE product_id = <PRODUCT_ID>;
UPDATE billoflabour SET drawing_url = NULL, use_product_drawing = false WHERE bol_id = <BOL_ID>;
DELETE FROM order_detail_drawings WHERE order_detail_id = <ORDER_DETAIL_ID> AND bol_id = <BOL_ID>;
-- Optionally clean up the test job cards/items issued during this verification
DELETE FROM job_card_items WHERE work_pool_id = <POOL_ID> AND drawing_url IN ('https://example.com/p.png', 'https://example.com/b.png', 'https://example.com/o.png');
DELETE FROM job_cards WHERE job_card_id NOT IN (SELECT job_card_id FROM job_card_items);
```

**Important:** Per recurring guidance in memory, never leave synthetic test data in the live DB. Verify cleanup leaves zero synthetic rows before moving on. Use a real test staff UUID (e.g. the `testai@qbutton.co.za` user) and a real org UUID — query `auth.users` and `organizations` if you don't have them on hand.

- [ ] **Step 2.5: Commit**

```bash
git add supabase/migrations/20260506121000_issue_job_card_drawing_resolve.sql
git commit -m "feat(db): resolve & snapshot drawing URL in issue_job_card_from_pool RPC"
```

---

### Task 3: TypeScript types

**Files:**
- Modify: `components/features/products/product-bol.tsx:87-102` (extend `BOLItem`)
- Modify: `components/features/orders/JobCardsTab.tsx:66-80` (extend `JobCardItemRow`-like interface — line numbers from spec exploration)
- Create: `types/drawings.ts`

- [ ] **Step 3.1: Create the shared types module**

`types/drawings.ts`:

```typescript
export type DrawingSource = 'none' | 'manual' | 'product';

/**
 * Per-order-line override for a specific BOL job's drawing.
 */
export interface OrderDetailDrawing {
  id: number;
  order_detail_id: number;
  bol_id: number;
  drawing_url: string;
  org_id: string;
  uploaded_by: string | null;
  uploaded_at: string;
}

/**
 * Resolved drawing source label, for the order-page UI's "From product" /
 * "From BOL" / "Order override" badge. `null` means no drawing will print.
 */
export type ResolvedDrawingSource =
  | { source: 'override'; url: string }
  | { source: 'bol'; url: string }
  | { source: 'product'; url: string }
  | null;
```

- [ ] **Step 3.2: Extend `BOLItem` in `product-bol.tsx`**

Change the interface (around line 87-102) to add `drawing_url` and `use_product_drawing`:

```typescript
interface BOLItem {
  bol_id: number;
  product_id: number;
  job_id: number;
  time_required: number | null;
  time_unit: 'hours' | 'minutes' | 'seconds';
  quantity: number;
  rate_id: number | null;
  hourly_rate_id?: number | null;
  pay_type?: 'hourly' | 'piece';
  piece_rate_id?: number | null;
  drawing_url: string | null;          // NEW
  use_product_drawing: boolean;         // NEW
  job: Job;
  rate: JobCategoryRate | null;
  hourly_rate?: JobHourlyRate | null;
  piece_rate?: { rate_id: number; rate: number } | null;
}
```

Update any select queries that fetch BOL rows in this file to include the new columns. Search for `.select('` against `billoflabour` in `product-bol.tsx` and add `drawing_url, use_product_drawing` to the column list.

- [ ] **Step 3.3: Extend job-card-item types in `JobCardsTab.tsx`**

Open `components/features/orders/JobCardsTab.tsx`, locate the `JobCardItemRow` (or equivalent) interface around line 66-80, and add `drawing_url: string | null;`. Do the same for any sibling type used to render the items in the PDF (likely passed into `<JobCardPDFDocument>` — see Task 4).

Update the corresponding `.select('...')` calls against `job_card_items` in this file to include `drawing_url`.

- [ ] **Step 3.4: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -E "drawing_url|use_product_drawing|OrderDetailDrawing" | head -20
```

Expected: zero output (the new types are valid). If there are unrelated pre-existing errors, ignore them.

- [ ] **Step 3.5: Commit**

```bash
git add types/drawings.ts components/features/products/product-bol.tsx components/features/orders/JobCardsTab.tsx
git commit -m "feat(types): extend BOLItem + JobCardItem with drawing fields, add OrderDetailDrawing type"
```

---

## Phase 2 — PDF rendering (end-to-end visible)

After Phase 2, manually setting `job_card_items.drawing_url` via SQL and printing a card will show the drawing on the PDF. No UI inputs yet — those are Phases 3-5.

### Task 4: Render drawing section in `JobCardPDF.tsx`

**Files:**
- Modify: `components/features/job-cards/JobCardPDF.tsx`

The drawing renders **between the items table and the Work Log section** (insertion point is around line 382-383, just after the closing `</View>` of the items table and before `<View style={styles.workLogSection}>`).

- [ ] **Step 4.1: Extend `JobCardItem` interface**

In `components/features/job-cards/JobCardPDF.tsx` around line 245:

```typescript
interface JobCardItem {
  item_id: number;
  product_name: string;
  product_code: string;
  job_name: string;
  quantity: number;
  piece_rate: number;
  drawing_url?: string | null;  // NEW
}
```

- [ ] **Step 4.2: Add styles for the drawing section**

Find the `StyleSheet.create({...})` block (search `const styles = StyleSheet.create`). Add three new style entries:

```typescript
drawingSection: {
  marginTop: 12,
  marginBottom: 12,
},
drawingTitle: {
  fontSize: 9,
  fontWeight: 'bold',
  marginBottom: 6,
},
drawingImage: {
  width: '100%',
  maxHeight: 320,            // ≈ half A4 page height in points
  objectFit: 'contain',
},
```

- [ ] **Step 4.3: Add `Image` import**

At the top of the file, ensure `Image` is imported from `@react-pdf/renderer`:

```typescript
import { Document, Page, Text, View, StyleSheet, pdf, Image } from '@react-pdf/renderer';
```

(`Image` may already be imported — if so, no change needed.)

- [ ] **Step 4.4: Render the drawing section**

In `JobCardPDFDocument`, immediately after the closing `</View>` of the items table (the one wrapping `<View style={styles.totalRow}>`) and before `<View style={styles.workLogSection}>`, insert:

```typescript
{/* Drawing — first item with a drawing_url (per the 1-job-1-card rule). */}
{(() => {
  const drawing = items.find((i) => i.drawing_url);
  if (!drawing?.drawing_url) return null;
  return (
    <View style={styles.drawingSection}>
      <Text style={styles.drawingTitle}>Reference Drawing</Text>
      <Image src={drawing.drawing_url} style={styles.drawingImage} />
    </View>
  );
})()}
```

The IIFE keeps the conditional render readable in JSX. The `1-job-1-card` rule (CLAUDE.md) means in practice `items.length === 1`, but `find` is defensive against future multi-item cards.

- [ ] **Step 4.5: Type-check + lint**

```bash
npx tsc --noEmit 2>&1 | grep -E "JobCardPDF|drawingSection|drawingImage" | head -10
npm run lint -- --max-warnings 9999 components/features/job-cards/JobCardPDF.tsx 2>&1 | tail -10
```

Expected: no new errors specific to this file.

- [ ] **Step 4.6: Commit**

```bash
git add components/features/job-cards/JobCardPDF.tsx
git commit -m "feat(job-card-pdf): render reference drawing between items table and work log"
```

---

### Task 5: Pass `drawing_url` through to the PDF

The PDF renders `drawing_url` from each item. The fetch + transform path that builds `items: JobCardItem[]` needs to include it. The data already lives on `job_card_items` (Task 1 added the column).

**Files:**
- Modify: `components/features/orders/JobCardsTab.tsx` (or wherever `JobCardPDFDocument` is invoked)
- Modify: any other callsite that constructs `JobCardItem[]` for the PDF

- [ ] **Step 5.1: Find every callsite of `JobCardPDFDocument`**

```bash
grep -rn "JobCardPDFDocument\|JobCardPDFDownload" --include='*.tsx' --include='*.ts' app/ components/ lib/ | grep -v test
```

For each callsite, trace where the `items` prop is built. Most callsites query `job_card_items` and map fields. Each map must include `drawing_url` from the row.

- [ ] **Step 5.2: Update the supabase select**

For each `.from('job_card_items').select(...)` query that feeds the PDF, add `drawing_url`:

```typescript
.from('job_card_items')
.select(`
  item_id,
  product_id,
  job_id,
  quantity,
  completed_quantity,
  piece_rate,
  status,
  drawing_url,        // NEW
  jobs!inner(name),
  products!inner(name, code)
`)
```

- [ ] **Step 5.3: Update the mapping into `JobCardItem`**

Wherever the rows are mapped, propagate `drawing_url`:

```typescript
const items: JobCardItem[] = rows.map((r) => ({
  item_id: r.item_id,
  product_name: r.products?.name ?? '',
  product_code: r.products?.code ?? '',
  job_name: r.jobs?.name ?? '',
  quantity: r.quantity,
  piece_rate: r.piece_rate ?? 0,
  drawing_url: r.drawing_url,  // NEW
}));
```

- [ ] **Step 5.4: Manual verification**

Before any UI exists, manually inject a test drawing URL via SQL on a single item and confirm it renders on the printed PDF.

```sql
-- Pick a recently issued job card item that doesn't have a drawing yet
SELECT item_id, job_card_id FROM job_card_items WHERE drawing_url IS NULL ORDER BY item_id DESC LIMIT 1;
-- Note <ITEM_ID> and <JOB_CARD_ID>

UPDATE job_card_items
SET drawing_url = 'https://placehold.co/600x400/png?text=Test+Drawing'
WHERE item_id = <ITEM_ID>;
```

Then in the dev UI, navigate to that order's Job Cards tab, download the PDF, and confirm the test image renders between the items table and the work log. (Don't forget to revert: `UPDATE job_card_items SET drawing_url = NULL WHERE item_id = <ITEM_ID>;`)

- [ ] **Step 5.5: Commit**

```bash
git add components/features/orders/JobCardsTab.tsx
# add other modified callsites
git commit -m "feat(job-cards): pass drawing_url from job_card_items into PDF render"
```

---

## Phase 3 — BOL editor: 3-way drawing source radio

The BOL editor is `components/features/products/product-bol.tsx`. Each BOL row gets a "Drawing source" radio (None / Upload custom / Use product drawing) and a thumbnail preview.

### Task 6: Storage helper for BOL drawing uploads

**Files:**
- Create: `lib/db/bol-drawings.ts`

- [ ] **Step 6.1: Write the failing test**

`tests/bol-drawings.test.ts`:

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateImageFile } from '@/lib/db/bol-drawings';

test('validateImageFile rejects non-image extensions', () => {
  const f = new File(['x'], 'drawing.pdf', { type: 'application/pdf' });
  assert.throws(() => validateImageFile(f), /PNG or JPEG/);
});

test('validateImageFile rejects mismatched mime type even with image extension', () => {
  const f = new File(['x'], 'drawing.png', { type: 'application/pdf' });
  assert.throws(() => validateImageFile(f), /PNG or JPEG/);
});

test('validateImageFile accepts PNG', () => {
  const f = new File(['x'], 'drawing.png', { type: 'image/png' });
  assert.doesNotThrow(() => validateImageFile(f));
});

test('validateImageFile accepts JPEG', () => {
  const f = new File(['x'], 'drawing.jpg', { type: 'image/jpeg' });
  assert.doesNotThrow(() => validateImageFile(f));
});
```

- [ ] **Step 6.2: Run test to verify failure**

```bash
npx tsx --test tests/bol-drawings.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/db/bol-drawings'`.

- [ ] **Step 6.3: Implement helper**

`lib/db/bol-drawings.ts`:

```typescript
import { supabase } from '@/lib/supabase';

const STORAGE_BUCKET = 'QButton';
const STORAGE_PATH_PREFIX = 'BOL Drawings';

const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg']);
const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg']);

export function validateImageFile(file: File): void {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext) || !ALLOWED_MIME_TYPES.has(file.type)) {
    throw new Error('PNG or JPEG required');
  }
}

export function bolDrawingStoragePath(bolId: number, uuid: string, ext: string): string {
  if (!Number.isFinite(bolId) || bolId <= 0) {
    throw new Error('Invalid bol_id');
  }
  return `${STORAGE_PATH_PREFIX}/${bolId}/${uuid}.${ext}`;
}

/**
 * Upload a NEW drawing file for a BOL row. Returns the public URL.
 * Each upload uses a fresh UUID — re-uploads create new files rather than
 * overwriting, preserving snapshot stability for already-issued job cards.
 */
export async function uploadBolDrawing(file: File, bolId: number): Promise<string> {
  validateImageFile(file);

  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const uuid = crypto.randomUUID();
  const storagePath = bolDrawingStoragePath(bolId, uuid, ext);

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false,  // each upload is a fresh UUID, never collides
    });

  if (uploadError) {
    throw new Error(`Failed to upload BOL drawing: ${uploadError.message}`);
  }

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
  if (!data?.publicUrl) {
    throw new Error('Failed to get public URL for BOL drawing');
  }
  return data.publicUrl;
}
```

- [ ] **Step 6.4: Run test to verify pass**

```bash
npx tsx --test tests/bol-drawings.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 6.5: Commit**

```bash
git add lib/db/bol-drawings.ts tests/bol-drawings.test.ts
git commit -m "feat(bol-drawings): add upload helper + image validation"
```

---

### Task 7: BOL editor — 3-way drawing source radio

**Files:**
- Modify: `components/features/products/product-bol.tsx`

The product-bol.tsx file uses `react-hook-form` with a `bolItemSchema` (around line 105). The radio + upload UI integrates into the existing add/edit dialogs.

- [ ] **Step 7.1: Extend the form schema**

Around line 105 of `product-bol.tsx`:

```typescript
const bolItemSchema = z.object({
  job_category_id: z.string().min(1, 'Job category is required'),
  job_id: z.string().min(1, 'Job is required'),
  pay_type: z.enum(['hourly', 'piece']).default('hourly'),
  time_required: z.coerce.number().optional(),
  time_unit: z.enum(['hours', 'minutes', 'seconds']).optional(),
  quantity: z.coerce.number().min(1, 'Quantity must be at least 1'),
  drawing_source: z.enum(['none', 'manual', 'product']).default('none'),  // NEW
});
```

- [ ] **Step 7.2: Add UI imports for radio**

Add `RadioGroup` to existing UI imports near the top of `product-bol.tsx`:

```typescript
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
```

(If `@/components/ui/radio-group` doesn't exist yet, add it via `pnpm dlx shadcn@latest add radio-group` and commit the new file as part of this task.)

- [ ] **Step 7.3: Render the radio + upload UI in the BOL form dialog**

Find the form dialog component (likely an `AddJobDialog` or similar — search for `bolItemSchema` use in `product-bol.tsx` and any imported dialog file). Inside the form's `<Form>` block, after the existing fields and before the submit row, add:

```typescript
const [pendingDrawingFile, setPendingDrawingFile] = useState<File | null>(null);
const [drawingThumbnailUrl, setDrawingThumbnailUrl] = useState<string | null>(
  editingItem?.drawing_url ?? null
);

const product = useProductQuery(productId);  // existing hook or inline query
const productHasConfiguratorDrawing = !!product?.configurator_drawing_url;

// In the form JSX:
<FormField
  control={form.control}
  name="drawing_source"
  render={({ field }) => (
    <FormItem>
      <FormLabel>Drawing source</FormLabel>
      <FormControl>
        <RadioGroup
          value={field.value}
          onValueChange={(value) => {
            field.onChange(value);
            if (value !== 'manual') setPendingDrawingFile(null);
          }}
          className="flex gap-4"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="none" id="drawing-none" />
            <Label htmlFor="drawing-none">None</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="manual" id="drawing-manual" />
            <Label htmlFor="drawing-manual">Upload custom</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem
              value="product"
              id="drawing-product"
              disabled={!productHasConfiguratorDrawing}
            />
            <Label
              htmlFor="drawing-product"
              className={!productHasConfiguratorDrawing ? 'text-muted-foreground' : ''}
            >
              Use product drawing
              {!productHasConfiguratorDrawing && ' (no configurator drawing yet)'}
            </Label>
          </div>
        </RadioGroup>
      </FormControl>
      <FormMessage />
    </FormItem>
  )}
/>

{form.watch('drawing_source') === 'manual' && (
  <FormItem>
    <FormLabel>Drawing file (PNG or JPEG required)</FormLabel>
    <FormControl>
      <input
        type="file"
        accept="image/png,image/jpeg"
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          if (file) {
            try {
              validateImageFile(file);
              setPendingDrawingFile(file);
            } catch (err) {
              toast({
                title: 'Invalid file',
                description: err instanceof Error ? err.message : 'PNG or JPEG required',
                variant: 'destructive',
              });
              e.target.value = '';
            }
          }
        }}
      />
    </FormControl>
  </FormItem>
)}

{drawingThumbnailUrl && (
  <div className="flex items-center gap-2">
    <span className="text-xs text-muted-foreground">Current:</span>
    <img src={drawingThumbnailUrl} alt="" className="h-16 w-auto rounded border" />
  </div>
)}
```

Add `import { validateImageFile } from '@/lib/db/bol-drawings';` near the other imports.

- [ ] **Step 7.4: Wire submission**

In the form `onSubmit` handler, after computing the submit payload:

```typescript
const onSubmit = async (values: BOLItemFormValues) => {
  let drawing_url: string | null = editingItem?.drawing_url ?? null;
  let use_product_drawing = false;

  if (values.drawing_source === 'manual') {
    if (pendingDrawingFile) {
      // Upload happens after the BOL row is created so we have a bol_id.
      // For new rows: insert without drawing_url first, then upload + UPDATE.
      // For edits: upload first (we have bol_id), then include URL in the update.
      if (editingItem?.bol_id) {
        drawing_url = await uploadBolDrawing(pendingDrawingFile, editingItem.bol_id);
      }
    }
    use_product_drawing = false;
  } else if (values.drawing_source === 'product') {
    drawing_url = null;
    use_product_drawing = true;
  } else {
    drawing_url = null;
    use_product_drawing = false;
  }

  const payload = {
    // ... existing fields
    drawing_url,
    use_product_drawing,
  };

  // For new rows: after insert returns bol_id, if pendingDrawingFile is still set, upload + UPDATE drawing_url
  const inserted = await supabase
    .from('billoflabour')
    .insert(payload) // or upsert/update for edits
    .select()
    .single();

  if (!editingItem && pendingDrawingFile && values.drawing_source === 'manual') {
    const url = await uploadBolDrawing(pendingDrawingFile, inserted.data.bol_id);
    await supabase
      .from('billoflabour')
      .update({ drawing_url: url })
      .eq('bol_id', inserted.data.bol_id);
  }

  // ... existing post-submit logic (toast, refetch, close dialog)
};
```

Add `import { uploadBolDrawing } from '@/lib/db/bol-drawings';` near the other imports.

- [ ] **Step 7.5: Render thumbnail in the BOL list row**

In the table that lists existing BOL rows (search `<TableRow>` in `product-bol.tsx`), add a small drawing-source indicator:

```typescript
<TableCell>
  {item.use_product_drawing ? (
    <Badge variant="outline">Product drawing</Badge>
  ) : item.drawing_url ? (
    <img src={item.drawing_url} alt="" className="h-8 w-auto rounded border" />
  ) : (
    <span className="text-xs text-muted-foreground">—</span>
  )}
</TableCell>
```

(Add a column header "Drawing" in the matching `<TableHead>`.)

- [ ] **Step 7.6: Type-check + lint**

```bash
npx tsc --noEmit 2>&1 | grep "product-bol" | head -10
npm run lint -- components/features/products/product-bol.tsx 2>&1 | tail -10
```

Expected: no new errors.

- [ ] **Step 7.7: Commit**

```bash
git add components/features/products/product-bol.tsx components/ui/radio-group.tsx
git commit -m "feat(bol-editor): 3-way drawing source radio with upload + thumbnail"
```

---

## Phase 4 — Configurator captures the technical preview

After Phase 4, clicking "Save to Product" in the configurator generates a PNG of the technical preview and persists the URL on `products.configurator_drawing_url`. Combined with the BOL editor's "Use product drawing" toggle (Phase 3), this enables tier 3 of the resolve chain.

### Task 8: Add `dom-to-image-more` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 8.1: Install**

```bash
npm install dom-to-image-more
```

(Or `pnpm add dom-to-image-more` if the project uses pnpm — check `package.json` for the lockfile to confirm. From CLAUDE.md, npm is used.)

- [ ] **Step 8.2: Verify import works**

```bash
node -e "import('dom-to-image-more').then(m => console.log(typeof m.toPng))"
```

Expected: `function`.

- [ ] **Step 8.3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add dom-to-image-more for SVG-to-PNG capture"
```

---

### Task 9: Capture + upload helper

**Files:**
- Create: `lib/configurator/captureProductDrawing.ts`
- Create: `tests/capture-product-drawing.test.ts`

- [ ] **Step 9.1: Write the failing test**

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { productDrawingStoragePath } from '@/lib/configurator/captureProductDrawing';

test('productDrawingStoragePath nests product id and uuid with .png extension', () => {
  assert.equal(productDrawingStoragePath(859, 'abc-123'), 'Product Drawings/859/abc-123.png');
});

test('productDrawingStoragePath rejects non-positive ids', () => {
  assert.throws(() => productDrawingStoragePath(0, 'u'), /product id/i);
  assert.throws(() => productDrawingStoragePath(-1, 'u'), /product id/i);
});
```

- [ ] **Step 9.2: Run test to verify failure**

```bash
npx tsx --test tests/capture-product-drawing.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 9.3: Implement**

`lib/configurator/captureProductDrawing.ts`:

```typescript
import { supabase } from '@/lib/supabase';

const STORAGE_BUCKET = 'QButton';
const STORAGE_PATH_PREFIX = 'Product Drawings';

export function productDrawingStoragePath(productId: number, uuid: string): string {
  if (!Number.isFinite(productId) || productId <= 0) {
    throw new Error('Invalid product id');
  }
  return `${STORAGE_PATH_PREFIX}/${productId}/${uuid}.png`;
}

/**
 * Capture an HTMLElement (typically the technical preview container) as PNG,
 * upload to Supabase Storage at a fresh UUID path, and persist the public URL
 * on products.configurator_drawing_url.
 *
 * Each save creates a new UUID-suffixed file so previously snapshotted URLs
 * (on issued job cards) keep pointing at the original capture.
 *
 * Returns the public URL. Throws on failure (caller should toast + log and
 * leave the existing configurator_drawing_url intact).
 */
export async function captureAndUploadProductDrawing(
  node: HTMLElement,
  productId: number
): Promise<string> {
  // Lazy-import dom-to-image-more so it doesn't bloat the initial bundle
  const { toPng } = await import('dom-to-image-more');

  const dataUrl = await toPng(node, {
    cacheBust: true,
    bgcolor: '#ffffff',
    pixelRatio: 2,        // sharper for print
  });

  // Convert data URL to Blob
  const res = await fetch(dataUrl);
  const blob = await res.blob();

  const uuid = crypto.randomUUID();
  const path = productDrawingStoragePath(productId, uuid);

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, blob, { contentType: 'image/png', upsert: false });

  if (uploadError) {
    throw new Error(`Failed to upload product drawing: ${uploadError.message}`);
  }

  const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  if (!urlData?.publicUrl) {
    throw new Error('Failed to get public URL for product drawing');
  }
  const publicUrl = urlData.publicUrl;

  const { error: updateError } = await supabase
    .from('products')
    .update({ configurator_drawing_url: publicUrl })
    .eq('product_id', productId);

  if (updateError) {
    throw new Error(`Failed to persist drawing URL: ${updateError.message}`);
  }

  return publicUrl;
}
```

- [ ] **Step 9.4: Run test to verify pass**

```bash
npx tsx --test tests/capture-product-drawing.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 9.5: Commit**

```bash
git add lib/configurator/captureProductDrawing.ts tests/capture-product-drawing.test.ts
git commit -m "feat(configurator): captureAndUploadProductDrawing helper"
```

---

### Task 10: Wire `saveParts` to capture + upload after save

**Files:**
- Modify: `components/features/configurator/FurnitureConfigurator.tsx`
- Modify: `components/features/configurator/shared/TechnicalSvgPreview.tsx` (forward ref)

- [ ] **Step 10.1: Forward a ref from `TechnicalSvgPreview`**

Open `components/features/configurator/shared/TechnicalSvgPreview.tsx`. The component currently uses an internal `svgRef` (around line 110). Wrap the component in `React.forwardRef` and forward an outer ref to the *outermost* container (so we capture the full Front+Side+Top+Assembly composite, not just one SVG):

Around the component definition (search for `export function TechnicalSvgPreview` or `export const TechnicalSvgPreview`), change to:

```typescript
export const TechnicalSvgPreview = React.forwardRef<HTMLDivElement, TechnicalSvgPreviewProps>(
  function TechnicalSvgPreview(props, ref) {
    // ... existing body unchanged ...
    return (
      <div ref={ref} className="...existing classes...">
        {/* existing JSX */}
      </div>
    );
  }
);
```

- [ ] **Step 10.2: Hold the ref in `FurnitureConfigurator`**

In `components/features/configurator/FurnitureConfigurator.tsx`, near the existing state declarations:

```typescript
import { captureAndUploadProductDrawing } from '@/lib/configurator/captureProductDrawing';
const previewRef = React.useRef<HTMLDivElement>(null);
```

Find where `<TechnicalSvgPreview ... />` is rendered (search the file for `TechnicalSvgPreview` usage) and pass the ref:

```typescript
<TechnicalSvgPreview ref={previewRef} {...existingProps} />
```

- [ ] **Step 10.3: Capture + upload after successful save**

In the `saveParts` callback (around line 134-187), inside the `try` block, after `toast.success('Parts saved to product')` and before the `if (navigateToBuilder)` line, insert:

```typescript
// Capture the technical preview as a product drawing. Failure here MUST NOT
// fail the save flow — surface as warning toast and continue.
if (previewRef.current) {
  try {
    await captureAndUploadProductDrawing(previewRef.current, productId);
  } catch (captureErr) {
    console.error('Product drawing capture failed:', captureErr);
    toast.warning('Parts saved, but reference drawing capture failed');
  }
}
```

- [ ] **Step 10.4: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -E "FurnitureConfigurator|TechnicalSvgPreview" | head -10
```

Expected: no new errors.

- [ ] **Step 10.5: Browser smoke**

Use Chrome MCP. Log in as `testai@qbutton.co.za` (password: `ClaudeTest2026!`). Navigate to a configurator-enabled product, e.g. `/products/859/configurator`. Click "Save to Product". Then via SQL:

```sql
SELECT product_id, configurator_drawing_url FROM products WHERE product_id = 859;
```

Expected: `configurator_drawing_url` is set to a `https://ttlyfhkrsjjrzxiagzpb.supabase.co/storage/v1/object/public/QButton/Product Drawings/859/<uuid>.png` URL. Open it in the browser to verify the captured PNG renders the technical preview correctly.

- [ ] **Step 10.6: Commit**

```bash
git add components/features/configurator/FurnitureConfigurator.tsx components/features/configurator/shared/TechnicalSvgPreview.tsx
git commit -m "feat(configurator): capture technical preview as PNG on Save to Product"
```

---

## Phase 5 — Order-line override on the order page

After Phase 5, the user can upload a one-off SketchUp PNG against `(order_detail, BOL job)` from the order page. This overrides the BOL/configurator drawing on that specific order's job card at issuance time.

### Task 11: Storage helper + DB CRUD for order-detail drawings

**Files:**
- Create: `lib/db/order-detail-drawings.ts`
- Create: `tests/order-detail-drawings.test.ts`

- [ ] **Step 11.1: Write the failing test**

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { orderDrawingStoragePath } from '@/lib/db/order-detail-drawings';

test('orderDrawingStoragePath nests order_detail_id-bol_id and uuid with ext', () => {
  assert.equal(orderDrawingStoragePath(123, 45, 'abc-123', 'png'), 'Order Drawings/123-45/abc-123.png');
  assert.equal(orderDrawingStoragePath(7, 8, 'xyz', 'jpg'), 'Order Drawings/7-8/xyz.jpg');
});

test('orderDrawingStoragePath rejects invalid ids', () => {
  assert.throws(() => orderDrawingStoragePath(0, 1, 'u', 'png'), /id/i);
  assert.throws(() => orderDrawingStoragePath(1, 0, 'u', 'png'), /id/i);
});
```

- [ ] **Step 11.2: Run test to verify failure**

```bash
npx tsx --test tests/order-detail-drawings.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 11.3: Implement**

`lib/db/order-detail-drawings.ts`:

```typescript
import { supabase } from '@/lib/supabase';
import { validateImageFile } from '@/lib/db/bol-drawings';
import type { OrderDetailDrawing } from '@/types/drawings';

const STORAGE_BUCKET = 'QButton';
const STORAGE_PATH_PREFIX = 'Order Drawings';

export function orderDrawingStoragePath(
  orderDetailId: number,
  bolId: number,
  uuid: string,
  ext: string
): string {
  if (!Number.isFinite(orderDetailId) || orderDetailId <= 0) {
    throw new Error('Invalid order_detail_id');
  }
  if (!Number.isFinite(bolId) || bolId <= 0) {
    throw new Error('Invalid bol_id');
  }
  return `${STORAGE_PATH_PREFIX}/${orderDetailId}-${bolId}/${uuid}.${ext}`;
}

/**
 * Upload a NEW override drawing for (order_detail_id, bol_id) and UPSERT
 * the row in order_detail_drawings. Each upload uses a fresh UUID so old
 * snapshots stay readable.
 */
export async function uploadOrderDetailDrawing(
  file: File,
  orderDetailId: number,
  bolId: number,
  orgId: string
): Promise<OrderDetailDrawing> {
  validateImageFile(file);

  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const uuid = crypto.randomUUID();
  const path = orderDrawingStoragePath(orderDetailId, bolId, uuid, ext);

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) {
    throw new Error(`Failed to upload override drawing: ${uploadError.message}`);
  }

  const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  if (!urlData?.publicUrl) {
    throw new Error('Failed to get public URL for override drawing');
  }
  const drawingUrl = urlData.publicUrl;

  const { data, error: dbError } = await supabase
    .from('order_detail_drawings')
    .upsert(
      {
        order_detail_id: orderDetailId,
        bol_id: bolId,
        drawing_url: drawingUrl,
        org_id: orgId,
      },
      { onConflict: 'order_detail_id,bol_id' }
    )
    .select('*')
    .single();

  if (dbError || !data) {
    throw new Error(`Failed to save override row: ${dbError?.message}`);
  }
  return data as OrderDetailDrawing;
}

export async function deleteOrderDetailDrawing(
  orderDetailId: number,
  bolId: number
): Promise<void> {
  const { error } = await supabase
    .from('order_detail_drawings')
    .delete()
    .eq('order_detail_id', orderDetailId)
    .eq('bol_id', bolId);
  if (error) {
    throw new Error(`Failed to delete override: ${error.message}`);
  }
  // Storage file is left as orphan (cleanup is a separate maintenance task)
}

export async function listOrderDetailDrawings(orderId: number): Promise<OrderDetailDrawing[]> {
  // Pull all overrides for any order_detail belonging to this order
  const { data: details, error: detailErr } = await supabase
    .from('order_details')
    .select('order_detail_id')
    .eq('order_id', orderId);
  if (detailErr) throw new Error(detailErr.message);

  const detailIds = (details ?? []).map((d) => d.order_detail_id);
  if (detailIds.length === 0) return [];

  const { data, error } = await supabase
    .from('order_detail_drawings')
    .select('*')
    .in('order_detail_id', detailIds);
  if (error) throw new Error(error.message);
  return (data ?? []) as OrderDetailDrawing[];
}
```

- [ ] **Step 11.4: Run test to verify pass**

```bash
npx tsx --test tests/order-detail-drawings.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 11.5: Commit**

```bash
git add lib/db/order-detail-drawings.ts tests/order-detail-drawings.test.ts
git commit -m "feat(order-drawings): UPSERT/delete helpers for per-order-line overrides"
```

---

### Task 12: Override UI on the order page work-pool view

**Files:**
- Modify: `components/features/orders/JobCardsTab.tsx`

This task adds a per-row drawing override control to the work-pool view, plus a resolved-source badge for visibility.

- [ ] **Step 12.1: Fetch overrides + product/BOL drawing info**

Find the existing work-pool `useQuery` hook (around line 352-419 per spec exploration). Extend the data shape to include the resolved drawing source. Add an additional select on `billoflabour` and `products` (or join in the existing query if structure allows):

```typescript
// After the existing work pool fetch:
const { data: drawingContext } = useQuery({
  queryKey: ['order-drawing-context', orderId],
  queryFn: async () => {
    const overrides = await listOrderDetailDrawings(orderId);

    // Get unique bol_ids from work pool
    const bolIds = Array.from(new Set(workPool.filter(p => p.bol_id != null).map(p => p.bol_id!)));
    const productIds = Array.from(new Set(workPool.filter(p => p.product_id != null).map(p => p.product_id!)));

    const { data: bolRows } = bolIds.length === 0 ? { data: [] } : await supabase
      .from('billoflabour')
      .select('bol_id, drawing_url, use_product_drawing')
      .in('bol_id', bolIds);

    const { data: productRows } = productIds.length === 0 ? { data: [] } : await supabase
      .from('products')
      .select('product_id, configurator_drawing_url')
      .in('product_id', productIds);

    return {
      overrides,
      bolByid: new Map((bolRows ?? []).map(b => [b.bol_id, b])),
      productById: new Map((productRows ?? []).map(p => [p.product_id, p])),
    };
  },
  enabled: workPool.length > 0,
});
```

- [ ] **Step 12.2: Resolve helper**

Add a small pure function near the top of the component (or inline in `lib/`):

```typescript
import type { ResolvedDrawingSource } from '@/types/drawings';

function resolveDrawingForRow(
  poolRow: { order_detail_id: number | null; bol_id: number | null; product_id: number | null },
  ctx: { overrides: OrderDetailDrawing[]; bolByid: Map<number, any>; productById: Map<number, any> }
): ResolvedDrawingSource {
  if (poolRow.order_detail_id != null && poolRow.bol_id != null) {
    const ovr = ctx.overrides.find(
      (o) => o.order_detail_id === poolRow.order_detail_id && o.bol_id === poolRow.bol_id
    );
    if (ovr) return { source: 'override', url: ovr.drawing_url };
  }
  if (poolRow.bol_id != null) {
    const bol = ctx.bolByid.get(poolRow.bol_id);
    if (bol?.drawing_url) return { source: 'bol', url: bol.drawing_url };
    if (bol?.use_product_drawing && poolRow.product_id != null) {
      const product = ctx.productById.get(poolRow.product_id);
      if (product?.configurator_drawing_url) {
        return { source: 'product', url: product.configurator_drawing_url };
      }
    }
  }
  return null;
}
```

(Optional: extract to `lib/drawings/resolve.ts` and unit-test it directly. Recommended.)

- [ ] **Step 12.3: Render per-row override UI**

In the work-pool row rendering (search for the `.map((row) =>` loop in `JobCardsTab.tsx`), inject a "Drawing" cell:

```typescript
{(() => {
  if (!drawingContext) return <span className="text-xs text-muted-foreground">—</span>;
  if (row.bol_id == null || row.order_detail_id == null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const resolved = resolveDrawingForRow(row, drawingContext);
  return (
    <div className="flex items-center gap-2">
      {resolved ? (
        <>
          <img src={resolved.url} alt="" className="h-8 w-auto rounded border" />
          <Badge variant="outline" className="text-xs">
            {resolved.source === 'override' ? 'Order override' :
             resolved.source === 'bol' ? 'From BOL' : 'From product'}
          </Badge>
        </>
      ) : (
        <span className="text-xs text-muted-foreground">No drawing</span>
      )}
      <DrawingOverrideMenu
        orderDetailId={row.order_detail_id}
        bolId={row.bol_id}
        orgId={orgId}
        hasOverride={resolved?.source === 'override'}
      />
    </div>
  );
})()}
```

`DrawingOverrideMenu` is a small inline component — define it in the same file:

```typescript
function DrawingOverrideMenu({
  orderDetailId,
  bolId,
  orgId,
  hasOverride,
}: {
  orderDetailId: number;
  bolId: number;
  orgId: string;
  hasOverride: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const handleUpload = async (file: File) => {
    try {
      validateImageFile(file);
      await uploadOrderDetailDrawing(file, orderDetailId, bolId, orgId);
      toast.success('Override saved');
      queryClient.invalidateQueries({ queryKey: ['order-drawing-context'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    }
  };

  const handleRemove = async () => {
    try {
      await deleteOrderDetailDrawing(orderDetailId, bolId);
      toast.success('Override removed');
      queryClient.invalidateQueries({ queryKey: ['order-drawing-context'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Remove failed');
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleUpload(f);
          e.target.value = '';
        }}
      />
      <Button size="sm" variant="ghost" onClick={() => inputRef.current?.click()}>
        {hasOverride ? 'Replace override' : 'Override drawing'}
      </Button>
      {hasOverride && (
        <Button size="sm" variant="ghost" onClick={handleRemove}>
          Remove
        </Button>
      )}
    </>
  );
}
```

Add the necessary imports near the top of `JobCardsTab.tsx`:

```typescript
import { listOrderDetailDrawings, uploadOrderDetailDrawing, deleteOrderDetailDrawing } from '@/lib/db/order-detail-drawings';
import { validateImageFile } from '@/lib/db/bol-drawings';
import type { OrderDetailDrawing } from '@/types/drawings';
```

You'll also need `orgId` from somewhere in scope — find the existing org-scoped query in this file (search for `org_id` in `JobCardsTab.tsx`) and reuse it. If not present, fetch from session via the existing pattern.

- [ ] **Step 12.4: Disable override on already-issued cards (passive note)**

Per the spec ("Already issued — override won't affect printed cards"), if the work-pool row's status reflects that a card has been issued, show a tooltip:

```typescript
{row.has_active_card && (
  <span className="text-xs text-muted-foreground" title="A job card has already been issued for this row. Editing the override will only affect cards issued after this point.">
    Already issued
  </span>
)}
```

Use whatever field on `workPool` already indicates issuance status (e.g. `completed_quantity > 0`, `status === 'issued'`).

- [ ] **Step 12.5: Type-check + lint**

```bash
npx tsc --noEmit 2>&1 | grep -E "JobCardsTab|DrawingOverrideMenu" | head -10
npm run lint -- components/features/orders/JobCardsTab.tsx 2>&1 | tail -10
```

- [ ] **Step 12.6: Commit**

```bash
git add components/features/orders/JobCardsTab.tsx
git commit -m "feat(orders): per-row drawing override UI with resolved-source badge"
```

---

## Phase 6 — End-to-end verification

### Task 13: Repository-wide lint + typecheck

- [ ] **Step 13.1: Lint**

```bash
npm run lint
```

Expected: zero NEW warnings/errors related to the files this plan touched. Pre-existing image-route warnings or unrelated issues are OK — surface them but don't fix.

- [ ] **Step 13.2: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero NEW errors related to the files this plan touched. If there are pre-existing errors elsewhere, surface them clearly in the task report — don't try to fix unrelated breakage.

- [ ] **Step 13.3: All targeted tests**

```bash
npx tsx --test tests/bol-drawings.test.ts tests/capture-product-drawing.test.ts tests/order-detail-drawings.test.ts
```

Expected: 8 tests pass (4 + 2 + 2).

- [ ] **Step 13.4: No commit needed (verification-only step).**

---

### Task 14: Browser smoke (Chrome MCP)

End-to-end through the four feature paths. Use the test account: `testai@qbutton.co.za` / `ClaudeTest2026!` / org `QButton`.

- [ ] **Step 14.1: Start the dev server**

Use the preview MCP:

```
mcp__Claude_Preview__preview_start({ name: 'next-dev' })
```

Note the assigned port. Use it for all subsequent navigations.

- [ ] **Step 14.2: Path 1 — BOL editor: manual upload**

Navigate to a product with at least one BOL row, e.g. `/products/<some-id>?tab=bol`. Add or edit a row. Pick *Upload custom*. Upload a small PNG. Save. Reload. Confirm the thumbnail shows in the table row.

Verify in DB:
```sql
SELECT bol_id, drawing_url, use_product_drawing
FROM billoflabour
WHERE bol_id = <BOL_ID>;
```
Expected: `drawing_url` is a Supabase URL, `use_product_drawing` false.

- [ ] **Step 14.3: Path 2 — BOL editor: PNG/JPG validation**

Try to upload a `.pdf` file in the same dialog. Confirm a toast appears with "PNG or JPEG required" and the file is rejected.

- [ ] **Step 14.4: Path 3 — Configurator captures product drawing**

Navigate to `/products/859/configurator`. Click "Save to Product". Verify in DB:
```sql
SELECT product_id, configurator_drawing_url FROM products WHERE product_id = 859;
```
Expected: a `…/Product Drawings/859/<uuid>.png` URL. Open it in the browser — confirm the captured PNG matches the technical preview.

- [ ] **Step 14.5: Path 4 — BOL editor: "Use product drawing"**

Back on the BOL editor for product 859, edit a BOL row, switch to *Use product drawing*. Save. Verify:
```sql
SELECT bol_id, drawing_url, use_product_drawing FROM billoflabour WHERE bol_id = <BOL_ID>;
```
Expected: `drawing_url` NULL, `use_product_drawing` true.

- [ ] **Step 14.6: Path 5 — Order page: per-line override**

Open an order containing product 859 with that BOL row. Navigate to the Job Cards tab. For the work-pool row corresponding to that BOL job, the resolved drawing thumbnail should show (with badge "From product"). Click "Override drawing", upload a different PNG. Verify the badge switches to "Order override" and the new image shows.

```sql
SELECT * FROM order_detail_drawings WHERE order_detail_id = <ORDER_DETAIL_ID> AND bol_id = <BOL_ID>;
```
Expected: one row, with the new URL.

- [ ] **Step 14.7: Path 6 — Issue the card and verify snapshot**

Issue a job card from that work-pool row. Then:

```sql
SELECT item_id, drawing_url FROM job_card_items WHERE work_pool_id = <POOL_ID> ORDER BY item_id DESC LIMIT 1;
```
Expected: `drawing_url` is the override URL.

Now download the printed PDF (use the existing Print/Download UI). Confirm the override drawing renders between the items table and the work log.

- [ ] **Step 14.8: Path 7 — Snapshot stability**

Edit the override on the order page (replace with a third drawing). Confirm:
```sql
SELECT drawing_url FROM job_card_items WHERE item_id = <ITEM_ID>;
```
Expected: still the original (Path 6) URL — already-issued cards do not change.

The order-page row for that work-pool entry should now show the new override (Path 7's third drawing) — but only future cards issued from this row would pick it up.

- [ ] **Step 14.9: Cleanup**

Remove all synthetic test data. Per recurring guidance: never leave synthetic rows in the live DB.

```sql
-- Delete the override row(s) created during testing
DELETE FROM order_detail_drawings
WHERE order_detail_id = <ORDER_DETAIL_ID> AND bol_id = <BOL_ID>;

-- If you inserted a test BOL row, remove it
-- DELETE FROM billoflabour WHERE bol_id = <BOL_ID>;

-- If you issued a test job card during smoke that should not become a real piecework record, delete:
DELETE FROM job_card_items WHERE item_id = <TEST_ITEM_ID>;
DELETE FROM job_cards WHERE job_card_id = <TEST_CARD_ID>;
```

Verify zero synthetic rows remain. Then stop the dev server: `mcp__Claude_Preview__preview_stop`.

- [ ] **Step 14.10: No commit needed (smoke is verification-only). Report findings.**

---

## Final wrap-up

- [ ] **Run `/simplify`** per CLAUDE.md ("Run automatically before finalising any PR or at the end of any session that modifies more than 3 files"). Touch any cleanup it finds.

- [ ] **Push the branch:**

```bash
git push -u origin codex/local-job-card-drawings-spec
```

- [ ] **Open PR (or comment on the relevant Linear issue) with:**
  - Summary of changes
  - Spec link: `docs/superpowers/specs/2026-05-06-bol-job-card-drawings-design.md`
  - Migrations applied: list both file names + project ref `ttlyfhkrsjjrzxiagzpb`
  - Browser smoke confirmation (with screenshots if possible)

- [ ] **Linear:** if a Linear issue exists for this work, set status → Verifying with the merge SHA. If not, file POL-XX summarizing the feature with link to the spec + this plan.
