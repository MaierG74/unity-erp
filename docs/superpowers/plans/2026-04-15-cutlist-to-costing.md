# Cutlist-to-Costing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the cutlist layout result and surface it as material costs in the product costing tab, with padded (for pricing) and actual (for volume deals) cost views.

**Architecture:** New `product_cutlist_costing_snapshots` table stores the per-sheet layout result, billing overrides, resolved prices, and calculator inputs as a self-contained JSONB snapshot. A dedicated PUT endpoint upserts the snapshot. The product costing tab reads the snapshot and derives per-material totals. Staleness is detected by comparing a hash of current product parts against the stored `parts_hash`.

**Tech Stack:** Next.js API routes, Supabase (migration + RLS), React Query, TypeScript

**Spec:** `docs/superpowers/specs/2026-04-15-cutlist-to-costing-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/cutlist/costingSnapshot.ts` | Create | TypeScript types for `CutlistCostingSnapshot`, `computePartsHash()`, `buildSnapshotFromCalculator()` |
| `app/api/products/[productId]/cutlist-costing-snapshot/route.ts` | Create | GET + PUT endpoints for snapshot CRUD |
| `components/features/cutlist/primitives/EdgingOverrideRow.tsx` | Create | Edging override controls (padding %, fixed override, reset) |
| `components/features/cutlist/CutlistCalculator.tsx` | Modify | Add edging override state, include overrides in `onDataChange`, add "Save to Costing" button on preview tab |
| `app/products/[productId]/cutlist-builder/page.tsx` | Modify | Wire `onSummaryChange`, add snapshot save to `handleSave`, add standalone `handleSaveToCosting`, restore snapshot on load |
| `components/features/cutlist/adapters/useProductCutlistBuilderAdapter.ts` | Modify | Add `saveSnapshot()` and `loadSnapshot()` methods |
| `components/features/products/product-costing.tsx` | Modify | Add cutlist materials sub-section, staleness banner, no-snapshot banner |
| `lib/cutlist/types.ts` | Modify | Add `EdgingBillingOverride` type |
| Supabase migration | Create | `product_cutlist_costing_snapshots` table + RLS |

---

### Task 1: Database Migration

**Files:**
- Create: migration via Supabase MCP `apply_migration`

- [ ] **Step 1: Apply the migration**

Use the Supabase MCP to create the `product_cutlist_costing_snapshots` table with org-scoped RLS:

```sql
-- Create table
CREATE TABLE IF NOT EXISTS product_cutlist_costing_snapshots (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  snapshot_data JSONB NOT NULL,
  parts_hash TEXT NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, org_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pccs_product_id ON product_cutlist_costing_snapshots(product_id);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_pccs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_pccs_updated_at
  BEFORE UPDATE ON product_cutlist_costing_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION update_pccs_updated_at();

-- RLS
ALTER TABLE product_cutlist_costing_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY pccs_select_org_member
ON public.product_cutlist_costing_snapshots
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = product_cutlist_costing_snapshots.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY pccs_insert_org_member
ON public.product_cutlist_costing_snapshots
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = product_cutlist_costing_snapshots.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY pccs_update_org_member
ON public.product_cutlist_costing_snapshots
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = product_cutlist_costing_snapshots.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = product_cutlist_costing_snapshots.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY pccs_delete_org_member
ON public.product_cutlist_costing_snapshots
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = product_cutlist_costing_snapshots.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);
```

- [ ] **Step 2: Verify with security advisor**

Run `mcp__supabase__get_advisors` with type `security` to confirm no RLS gaps.

- [ ] **Step 3: Verify with a test query**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'product_cutlist_costing_snapshots'
ORDER BY ordinal_position;
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(db): create product_cutlist_costing_snapshots table with org-scoped RLS"
```

---

### Task 2: TypeScript Types and Snapshot Builder

**Files:**
- Create: `lib/cutlist/costingSnapshot.ts`
- Modify: `lib/cutlist/types.ts` (add `EdgingBillingOverride`)

- [ ] **Step 1: Add `EdgingBillingOverride` type to `lib/cutlist/types.ts`**

After the existing `SheetBillingOverride` interface (around line 557), add:

```typescript
/**
 * Billing override for a single edging material (for costing padding).
 */
export interface EdgingBillingOverride {
  /** Fixed meter override — if set, overrides actual + percentage */
  metersOverride: number | null;
  /** Percentage padding (e.g. 10 = +10%) — if set, padded = actual × (1 + pct/100) */
  pctOverride: number | null;
}
```

- [ ] **Step 2: Create `lib/cutlist/costingSnapshot.ts` with types**

```typescript
import type { CompactPart, BoardMaterial, EdgingMaterial } from '@/components/features/cutlist/primitives';
import type { LayoutResult, SheetBillingOverride, CutlistSummary, EdgingSummaryEntry, EdgingBillingOverride } from '@/lib/cutlist/types';

// =============================================================================
// Snapshot Types
// =============================================================================

export interface SnapshotSheet {
  sheet_id: string;
  material_id: string;
  material_name: string;
  sheet_length_mm: number;
  sheet_width_mm: number;
  used_area_mm2: number;
  billing_override: { mode: 'auto' | 'full' | 'manual'; manualPct: number } | null;
}

export interface SnapshotEdging {
  material_id: string;
  material_name: string;
  thickness_mm: number;
  meters_actual: number;
  meters_override: number | null;
  pct_override: number | null;
  unit_price_per_meter: number | null;
  component_id: number | null;
}

export interface SnapshotBoardPrice {
  material_id: string;
  unit_price_per_sheet: number | null;
  component_id: number | null;
}

export interface SnapshotCalculatorInputs {
  primaryBoards: {
    id: string; name: string; length_mm: number; width_mm: number;
    cost: number; isDefault: boolean; component_id?: number;
  }[];
  backerBoards: {
    id: string; name: string; length_mm: number; width_mm: number;
    cost: number; isDefault: boolean; component_id?: number;
  }[];
  edging: {
    id: string; name: string; thickness_mm: number; width_mm: number;
    cost_per_meter: number; isDefaultForThickness: boolean; component_id?: number;
  }[];
  kerf: number;
  optimizationPriority: 'fast' | 'offcut' | 'deep';
}

export interface CutlistCostingSnapshot {
  sheets: SnapshotSheet[];
  global_full_board: boolean;
  edging: SnapshotEdging[];
  board_prices: SnapshotBoardPrice[];
  backer_sheets: SnapshotSheet[] | null;
  backer_global_full_board: boolean;
  backer_price_per_sheet: number | null;
  calculator_inputs: SnapshotCalculatorInputs;
  stats: {
    total_parts: number;
    total_pieces: number;
    total_used_area_mm2: number;
    total_waste_area_mm2: number;
    total_cuts: number;
  };
}
```

- [ ] **Step 3: Add `computePartsHash()` to the same file**

```typescript
// =============================================================================
// Parts Hash
// =============================================================================

export function computePartsHash(parts: CompactPart[]): string {
  const normalized = parts.map(p => ({
    id: p.id,
    length_mm: p.length_mm,
    width_mm: p.width_mm,
    quantity: p.quantity,
    material_id: p.material_id,
    grain: p.grain,
    band_edges: p.band_edges,
    lamination_type: p.lamination_type,
    lamination_group: p.lamination_group,
    edging_material_id: p.edging_material_id,
  }));
  // Simple djb2 hash — deterministic, fast, no crypto needed
  const str = JSON.stringify(normalized);
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
  }
  return hash.toString(36);
}
```

- [ ] **Step 4: Add `buildSnapshotFromCalculator()` to the same file**

This is the main function that constructs the snapshot from calculator state. It is called at save time.

```typescript
// =============================================================================
// Snapshot Builder
// =============================================================================

export interface BuildSnapshotArgs {
  result: LayoutResult;
  backerResult: LayoutResult | null;
  parts: CompactPart[];
  primaryBoards: BoardMaterial[];
  backerBoards: BoardMaterial[];
  edgingMaterials: EdgingMaterial[];
  kerf: number;
  optimizationPriority: 'fast' | 'offcut' | 'deep';
  sheetOverrides: Record<string, SheetBillingOverride>;
  globalFullBoard: boolean;
  backerSheetOverrides: Record<string, SheetBillingOverride>;
  backerGlobalFullBoard: boolean;
  edgingByMaterial: EdgingSummaryEntry[];
  edgingOverrides: Record<string, EdgingBillingOverride>;
}

export function buildSnapshotFromCalculator(args: BuildSnapshotArgs): CutlistCostingSnapshot {
  const {
    result, backerResult, parts, primaryBoards, backerBoards, edgingMaterials,
    kerf, optimizationPriority, sheetOverrides, globalFullBoard,
    backerSheetOverrides, backerGlobalFullBoard, edgingByMaterial, edgingOverrides,
  } = args;

  // Map sheets with their billing overrides
  const sheets: SnapshotSheet[] = result.sheets.map(s => ({
    sheet_id: s.sheet_id,
    material_id: s.placements.find(p => p.material_id)?.material_id || '',
    material_name: s.material_label || '',
    sheet_length_mm: s.stock_length_mm || 0,
    sheet_width_mm: s.stock_width_mm || 0,
    used_area_mm2: s.used_area_mm2 || 0,
    billing_override: sheetOverrides[s.sheet_id]
      ? { mode: sheetOverrides[s.sheet_id].mode, manualPct: sheetOverrides[s.sheet_id].manualPct }
      : null,
  }));

  // Backer sheets — use default backer board for material identity
  const defaultBacker = backerBoards.find(b => b.isDefault) || backerBoards[0];
  const backer_sheets: SnapshotSheet[] | null = backerResult
    ? backerResult.sheets.map(s => ({
        sheet_id: s.sheet_id,
        material_id: defaultBacker?.id || '',
        material_name: defaultBacker?.name || '',
        sheet_length_mm: s.stock_length_mm || 0,
        sheet_width_mm: s.stock_width_mm || 0,
        used_area_mm2: s.used_area_mm2 || 0,
        billing_override: backerSheetOverrides[s.sheet_id]
          ? { mode: backerSheetOverrides[s.sheet_id].mode, manualPct: backerSheetOverrides[s.sheet_id].manualPct }
          : null,
      }))
    : null;

  // Edging with overrides and resolved prices
  const edging: SnapshotEdging[] = edgingByMaterial.map(e => {
    const override = edgingOverrides[e.materialId];
    return {
      material_id: e.materialId,
      material_name: e.name,
      thickness_mm: e.thickness_mm,
      meters_actual: e.length_mm / 1000,
      meters_override: override?.metersOverride ?? null,
      pct_override: override?.pctOverride ?? null,
      unit_price_per_meter: e.cost_per_meter || null,
      component_id: e.component_id ?? null,
    };
  });

  // Board prices — one entry per unique primary board material
  const seenBoardIds = new Set<string>();
  const board_prices: SnapshotBoardPrice[] = [];
  for (const b of primaryBoards) {
    if (!seenBoardIds.has(b.id)) {
      seenBoardIds.add(b.id);
      board_prices.push({
        material_id: b.id,
        unit_price_per_sheet: b.cost || null,
        component_id: b.component_id ?? null,
      });
    }
  }

  // Calculator inputs for self-containedness
  const calculator_inputs: SnapshotCalculatorInputs = {
    primaryBoards: primaryBoards.map(b => ({
      id: b.id, name: b.name, length_mm: b.length_mm, width_mm: b.width_mm,
      cost: b.cost, isDefault: b.isDefault, component_id: b.component_id,
    })),
    backerBoards: backerBoards.map(b => ({
      id: b.id, name: b.name, length_mm: b.length_mm, width_mm: b.width_mm,
      cost: b.cost, isDefault: b.isDefault, component_id: b.component_id,
    })),
    edging: edgingMaterials.map(e => ({
      id: e.id, name: e.name, thickness_mm: e.thickness_mm, width_mm: e.width_mm,
      cost_per_meter: e.cost_per_meter, isDefaultForThickness: e.isDefaultForThickness,
      component_id: e.component_id,
    })),
    kerf,
    optimizationPriority,
  };

  // Stats
  const totalPieces = parts.reduce((sum, p) => sum + (p.quantity || 0), 0);
  const stats = {
    total_parts: parts.length,
    total_pieces: totalPieces,
    total_used_area_mm2: result.stats.used_area_mm2,
    total_waste_area_mm2: result.stats.waste_area_mm2,
    total_cuts: result.stats.cuts,
  };

  return {
    sheets,
    global_full_board: globalFullBoard,
    edging,
    board_prices,
    backer_sheets,
    backer_global_full_board: backerGlobalFullBoard,
    backer_price_per_sheet: defaultBacker?.cost ?? null,
    calculator_inputs,
    stats,
  };
}
```

- [ ] **Step 5: Commit**

```bash
git add lib/cutlist/costingSnapshot.ts lib/cutlist/types.ts
git commit -m "feat: add cutlist costing snapshot types, hash, and builder"
```

---

### Task 3: API Endpoints (GET + PUT)

**Files:**
- Create: `app/api/products/[productId]/cutlist-costing-snapshot/route.ts`

- [ ] **Step 1: Create the route file**

Model after the existing `app/api/products/[productId]/cutlist-groups/route.ts` for auth pattern.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireProductsAccess } from '@/lib/api/products-access';
import { supabaseAdmin } from '@/lib/supabase-admin';

function parseProductId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * GET /api/products/[productId]/cutlist-costing-snapshot
 * Returns the costing snapshot for a product, or { snapshot: null }.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  const { productId } = await params;
  const productIdNum = parseProductId(productId);
  if (!productIdNum) {
    return NextResponse.json({ error: 'Invalid product ID' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('product_cutlist_costing_snapshots')
    .select('*')
    .eq('product_id', productIdNum)
    .eq('org_id', auth.orgId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching costing snapshot:', error);
    return NextResponse.json({ error: 'Failed to fetch snapshot' }, { status: 500 });
  }

  return NextResponse.json({ snapshot: data ?? null });
}

/**
 * PUT /api/products/[productId]/cutlist-costing-snapshot
 * Upserts the costing snapshot for a product.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  const { productId } = await params;
  const productIdNum = parseProductId(productId);
  if (!productIdNum) {
    return NextResponse.json({ error: 'Invalid product ID' }, { status: 400 });
  }

  let body: { snapshot_data?: unknown; parts_hash?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.snapshot_data || typeof body.parts_hash !== 'string') {
    return NextResponse.json({ error: 'snapshot_data and parts_hash are required' }, { status: 400 });
  }

  // Verify product exists and belongs to org
  const { data: product } = await supabaseAdmin
    .from('products')
    .select('product_id')
    .eq('product_id', productIdNum)
    .eq('org_id', auth.orgId)
    .maybeSingle();

  if (!product) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from('product_cutlist_costing_snapshots')
    .upsert(
      {
        product_id: productIdNum,
        org_id: auth.orgId,
        snapshot_data: body.snapshot_data,
        parts_hash: body.parts_hash,
        calculated_at: new Date().toISOString(),
      },
      { onConflict: 'product_id,org_id' }
    )
    .select()
    .single();

  if (error) {
    console.error('Error upserting costing snapshot:', error);
    return NextResponse.json({ error: 'Failed to save snapshot' }, { status: 500 });
  }

  return NextResponse.json({ success: true, snapshot: data });
}
```

- [ ] **Step 2: Test the endpoints manually**

Use the Supabase MCP to insert a test row, then verify the GET returns it:

```sql
SELECT * FROM product_cutlist_costing_snapshots LIMIT 1;
```

- [ ] **Step 3: Commit**

```bash
git add app/api/products/\[productId\]/cutlist-costing-snapshot/route.ts
git commit -m "feat(api): add GET/PUT endpoints for cutlist costing snapshot"
```

---

### Task 4: Adapter — Add `saveSnapshot()` to Product Cutlist Builder Adapter

**Files:**
- Modify: `components/features/cutlist/adapters/useProductCutlistBuilderAdapter.ts`

- [ ] **Step 1: Add the `saveSnapshot` method**

Import the snapshot type and add a `saveSnapshot` function alongside the existing `save`:

```typescript
import type { CutlistCostingSnapshot } from '@/lib/cutlist/costingSnapshot';
```

Add this function inside `useProductCutlistBuilderAdapter`, after the existing `save`:

```typescript
const saveSnapshot = useCallback(async (
  snapshotData: CutlistCostingSnapshot,
  partsHash: string,
): Promise<void> => {
  if (!productId || Number.isNaN(productId)) return;

  const res = await authorizedFetch(
    `/api/products/${productId}/cutlist-costing-snapshot?module=${MODULE_KEYS.CUTLIST_OPTIMIZER}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshot_data: snapshotData, parts_hash: partsHash }),
    }
  );

  if (!res.ok) {
    throw new Error('Failed to save costing snapshot');
  }
}, [productId]);
```

Add `saveSnapshot` to the return object.

- [ ] **Step 2: Commit**

```bash
git add components/features/cutlist/adapters/useProductCutlistBuilderAdapter.ts
git commit -m "feat: add saveSnapshot to product cutlist builder adapter"
```

---

### Task 5: Edging Override Controls

**Files:**
- Create: `components/features/cutlist/primitives/EdgingOverrideRow.tsx`
- Modify: `components/features/cutlist/CutlistCalculator.tsx`

- [ ] **Step 1: Create `EdgingOverrideRow.tsx`**

A row component for a single edging material with padding % and fixed override inputs:

```typescript
'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { RotateCcw } from 'lucide-react';
import type { EdgingBillingOverride } from '@/lib/cutlist/types';

interface EdgingOverrideRowProps {
  name: string;
  thickness_mm: number;
  metersActual: number;
  override: EdgingBillingOverride | undefined;
  onOverrideChange: (override: EdgingBillingOverride | undefined) => void;
}

export function EdgingOverrideRow({
  name,
  thickness_mm,
  metersActual,
  override,
  onOverrideChange,
}: EdgingOverrideRowProps) {
  const pctOverride = override?.pctOverride ?? null;
  const metersOverride = override?.metersOverride ?? null;

  // Compute padded meters
  let paddedMeters = metersActual;
  if (metersOverride !== null) {
    paddedMeters = metersOverride;
  } else if (pctOverride !== null) {
    paddedMeters = metersActual * (1 + pctOverride / 100);
  }

  const hasOverride = pctOverride !== null || metersOverride !== null;

  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="text-muted-foreground w-[140px] truncate" title={name}>
        {name} ({thickness_mm}mm)
      </span>
      <span className="w-[60px] text-right tabular-nums">{metersActual.toFixed(2)}m</span>
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground">+</span>
        <Input
          type="number"
          className="h-7 w-[60px] text-xs tabular-nums"
          placeholder="—"
          value={metersOverride !== null ? '' : (pctOverride ?? '')}
          disabled={metersOverride !== null}
          onChange={(e) => {
            const val = e.target.value === '' ? null : Math.max(0, Number(e.target.value));
            onOverrideChange(val !== null ? { pctOverride: val, metersOverride: null } : undefined);
          }}
        />
        <span className="text-muted-foreground">%</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground">or</span>
        <Input
          type="number"
          className="h-7 w-[70px] text-xs tabular-nums"
          placeholder="—"
          value={metersOverride ?? ''}
          onChange={(e) => {
            const val = e.target.value === '' ? null : Math.max(0, Number(e.target.value));
            onOverrideChange(val !== null ? { pctOverride: null, metersOverride: val } : undefined);
          }}
        />
        <span className="text-muted-foreground">m</span>
      </div>
      <span className="w-[60px] text-right tabular-nums font-medium">
        {paddedMeters.toFixed(2)}m
      </span>
      {hasOverride && (
        <Button
          variant="link"
          size="sm"
          className="h-auto px-1 text-xs text-primary"
          onClick={() => onOverrideChange(undefined)}
        >
          <RotateCcw className="h-3 w-3 mr-0.5" />
          Reset
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add edging override state to `CutlistCalculator.tsx`**

In the "Billing overrides" section (around line 286), add:

```typescript
import type { EdgingBillingOverride } from '@/lib/cutlist/types';
import { EdgingOverrideRow } from './primitives/EdgingOverrideRow';

// Add state after backerGlobalFullBoard state:
const [edgingOverrides, setEdgingOverrides] = React.useState<Record<string, EdgingBillingOverride>>({});
```

- [ ] **Step 3: Include `edgingOverrides` in `onDataChange` emission**

In the `CutlistCalculatorData` interface (around line 128), add:

```typescript
edgingOverrides: Record<string, EdgingBillingOverride>;
```

In the `onDataChange` effect (around line 617), add `edgingOverrides` to the emitted data and the dependency array.

- [ ] **Step 4: Render edging override rows on the preview tab**

In the preview tab section of `CutlistCalculator.tsx`, after the existing sheet grid and stats cards, add edging overrides UI. Find the area where `edgingByMaterial` summary entries are displayed (or after the sheet stats), and render:

```tsx
{summary?.edgingByMaterial && summary.edgingByMaterial.length > 0 && (
  <div className="space-y-2 mt-4">
    <h4 className="text-xs font-medium text-muted-foreground uppercase">Edging Overrides (for Costing)</h4>
    {summary.edgingByMaterial.map(e => (
      <EdgingOverrideRow
        key={e.materialId}
        name={e.name}
        thickness_mm={e.thickness_mm}
        metersActual={e.length_mm / 1000}
        override={edgingOverrides[e.materialId]}
        onOverrideChange={(override) => {
          setEdgingOverrides(prev => {
            const next = { ...prev };
            if (override) {
              next[e.materialId] = override;
            } else {
              delete next[e.materialId];
            }
            return next;
          });
        }}
      />
    ))}
  </div>
)}
```

- [ ] **Step 5: Commit**

```bash
git add components/features/cutlist/primitives/EdgingOverrideRow.tsx \
      components/features/cutlist/CutlistCalculator.tsx \
      lib/cutlist/types.ts
git commit -m "feat: add edging override controls to cutlist builder preview tab"
```

---

### Task 6: Wire Snapshot Save into Cutlist Builder Page

**Files:**
- Modify: `app/products/[productId]/cutlist-builder/page.tsx`
- Modify: `components/features/cutlist/CutlistCalculator.tsx` (add "Save to Costing" button)

- [ ] **Step 1: Track summary in the page component**

In `cutlist-builder/page.tsx`, add state and callback for the summary:

```typescript
import type { CutlistSummary } from '@/lib/cutlist/types';
import { buildSnapshotFromCalculator, computePartsHash } from '@/lib/cutlist/costingSnapshot';

// Add state:
const summaryRef = useRef<CutlistSummary | null>(null);

// Add callback:
const handleSummaryChange = useCallback((summary: CutlistSummary | null) => {
  summaryRef.current = summary;
}, []);
```

Pass `onSummaryChange={handleSummaryChange}` to the `CutlistCalculator` component.

- [ ] **Step 2: Enhance `handleSave` to also save snapshot**

Replace the existing `handleSave` with:

```typescript
const handleSave = useCallback(async () => {
  const data = dataRef.current;
  if (!data || !data.parts.length) return;

  setSaving(true);
  try {
    // 1. Save parts groups (existing behavior)
    await adapter.save(data);

    // 2. If a layout result exists, also save the costing snapshot
    const summary = summaryRef.current;
    if (summary?.result) {
      const snapshot = buildSnapshotFromCalculator({
        result: summary.result,
        backerResult: summary.backerResult,
        parts: data.parts,
        primaryBoards: data.primaryBoards,
        backerBoards: data.backerBoards,
        edgingMaterials: data.edging,
        kerf: data.kerf,
        optimizationPriority: data.optimizationPriority,
        sheetOverrides: data.sheetOverrides,
        globalFullBoard: data.globalFullBoard,
        backerSheetOverrides: data.backerSheetOverrides,
        backerGlobalFullBoard: data.backerGlobalFullBoard,
        edgingByMaterial: summary.edgingByMaterial ?? [],
        edgingOverrides: data.edgingOverrides,
      });
      const partsHash = computePartsHash(data.parts);
      await adapter.saveSnapshot(snapshot, partsHash);
    }

    toast.success('Cutlist saved to product');
  } catch {
    toast.error('Failed to save cutlist');
  } finally {
    setSaving(false);
  }
}, [adapter]);
```

- [ ] **Step 3: Add "Save to Costing" button on the preview tab**

In `CutlistCalculator.tsx`, add a prop for a standalone "save to costing" action:

```typescript
/** Called when user clicks "Save to Costing" on preview tab */
onSaveToCosting?: () => void;
/** Whether a costing save is in progress */
savingToCosting?: boolean;
```

In the preview tab section, after the edging overrides, add:

```tsx
{onSaveToCosting && result && (
  <Button
    size="sm"
    onClick={onSaveToCosting}
    disabled={savingToCosting}
    className="mt-4 gap-1.5"
  >
    {savingToCosting ? 'Saving...' : 'Save to Costing'}
  </Button>
)}
```

- [ ] **Step 4: Wire `onSaveToCosting` in the page**

In `cutlist-builder/page.tsx`, add:

```typescript
const [savingToCosting, setSavingToCosting] = useState(false);

const handleSaveToCosting = useCallback(async () => {
  const data = dataRef.current;
  const summary = summaryRef.current;
  if (!data || !summary?.result) return;

  setSavingToCosting(true);
  try {
    const snapshot = buildSnapshotFromCalculator({
      result: summary.result,
      backerResult: summary.backerResult,
      parts: data.parts,
      primaryBoards: data.primaryBoards,
      backerBoards: data.backerBoards,
      edgingMaterials: data.edging,
      kerf: data.kerf,
      optimizationPriority: data.optimizationPriority,
      sheetOverrides: data.sheetOverrides,
      globalFullBoard: data.globalFullBoard,
      backerSheetOverrides: data.backerSheetOverrides,
      backerGlobalFullBoard: data.backerGlobalFullBoard,
      edgingByMaterial: summary.edgingByMaterial ?? [],
      edgingOverrides: data.edgingOverrides,
    });
    const partsHash = computePartsHash(data.parts);
    await adapter.saveSnapshot(snapshot, partsHash);
    toast.success('Costing snapshot saved');
  } catch {
    toast.error('Failed to save costing snapshot');
  } finally {
    setSavingToCosting(false);
  }
}, [adapter]);
```

Pass `onSaveToCosting={handleSaveToCosting}` and `savingToCosting={savingToCosting}` to the `CutlistCalculator`.

- [ ] **Step 5: Verify in the browser**

Open the product cutlist builder, calculate a layout, click "Save to Costing". Verify the snapshot is written:

```sql
SELECT product_id, parts_hash, calculated_at
FROM product_cutlist_costing_snapshots
ORDER BY calculated_at DESC LIMIT 5;
```

- [ ] **Step 6: Commit**

```bash
git add app/products/\[productId\]/cutlist-builder/page.tsx \
      components/features/cutlist/CutlistCalculator.tsx
git commit -m "feat: wire snapshot save into cutlist builder — Save button and Save to Costing button"
```

---

### Task 7: Restore Snapshot into Cutlist Builder (Layout Survives Navigation)

**Files:**
- Modify: `components/features/cutlist/adapters/useProductCutlistBuilderAdapter.ts`
- Modify: `app/products/[productId]/cutlist-builder/page.tsx`
- Modify: `components/features/cutlist/CutlistCalculator.tsx`

The spec's Goal 1 says the layout result should survive page navigation. Currently the builder loads parts from `product_cutlist_groups` but doesn't restore the saved layout result, sheet overrides, or edging overrides. This task adds that read path.

- [ ] **Step 1: Add `loadSnapshot` to the adapter**

In `useProductCutlistBuilderAdapter.ts`, add a method to fetch the saved snapshot:

```typescript
import type { CutlistCostingSnapshot } from '@/lib/cutlist/costingSnapshot';

const loadSnapshot = useCallback(async (): Promise<CutlistCostingSnapshot | null> => {
  if (!productId || Number.isNaN(productId)) return null;

  const res = await authorizedFetch(
    `/api/products/${productId}/cutlist-costing-snapshot?module=${MODULE_KEYS.CUTLIST_OPTIMIZER}`
  );
  if (!res.ok) return null;

  const json = (await res.json()) as { snapshot: { snapshot_data: CutlistCostingSnapshot } | null };
  return json.snapshot?.snapshot_data ?? null;
}, [productId]);
```

Add `loadSnapshot` to the return object.

- [ ] **Step 2: Extend `CutlistCalculatorData` to include saved snapshot for restoration**

In `CutlistCalculator.tsx`, extend the `CutlistCalculatorProps` interface to accept an optional saved snapshot:

```typescript
/** Previously saved costing snapshot — used to restore sheet overrides and edging overrides on load */
savedSnapshot?: CutlistCostingSnapshot | null;
```

Import the type:

```typescript
import type { CutlistCostingSnapshot } from '@/lib/cutlist/costingSnapshot';
```

In the component body, when `savedSnapshot` is provided and the calculator initialises, restore:
- `sheetOverrides` from `savedSnapshot.sheets` (reconstruct `Record<string, SheetBillingOverride>` from per-sheet `billing_override`)
- `globalFullBoard` from `savedSnapshot.global_full_board`
- `backerSheetOverrides` from `savedSnapshot.backer_sheets`
- `backerGlobalFullBoard` from `savedSnapshot.backer_global_full_board`
- `edgingOverrides` from `savedSnapshot.edging` (reconstruct `Record<string, EdgingBillingOverride>` from per-edging entries)

Add a `useEffect` that runs once when `savedSnapshot` is provided:

```typescript
React.useEffect(() => {
  if (!savedSnapshot) return;

  // Restore sheet billing overrides
  const restoredSheetOverrides: Record<string, SheetBillingOverride> = {};
  for (const sheet of savedSnapshot.sheets) {
    if (sheet.billing_override) {
      restoredSheetOverrides[sheet.sheet_id] = {
        mode: sheet.billing_override.mode,
        manualPct: sheet.billing_override.manualPct,
      };
    }
  }
  setSheetOverrides(restoredSheetOverrides);
  setGlobalFullBoard(savedSnapshot.global_full_board);

  // Restore backer overrides
  if (savedSnapshot.backer_sheets) {
    const restoredBackerOverrides: Record<string, SheetBillingOverride> = {};
    for (const sheet of savedSnapshot.backer_sheets) {
      if (sheet.billing_override) {
        restoredBackerOverrides[sheet.sheet_id] = {
          mode: sheet.billing_override.mode,
          manualPct: sheet.billing_override.manualPct,
        };
      }
    }
    setBackerSheetOverrides(restoredBackerOverrides);
  }
  setBackerGlobalFullBoard(savedSnapshot.backer_global_full_board);

  // Restore edging overrides
  const restoredEdgingOverrides: Record<string, EdgingBillingOverride> = {};
  for (const e of savedSnapshot.edging) {
    if (e.meters_override !== null || e.pct_override !== null) {
      restoredEdgingOverrides[e.material_id] = {
        metersOverride: e.meters_override,
        pctOverride: e.pct_override,
      };
    }
  }
  setEdgingOverrides(restoredEdgingOverrides);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []); // Run once on mount — savedSnapshot is a prop, not state
```

- [ ] **Step 3: Load snapshot in the builder page and pass to calculator**

In `cutlist-builder/page.tsx`, load the snapshot alongside the parts:

```typescript
const [savedSnapshot, setSavedSnapshot] = useState<CutlistCostingSnapshot | null>(null);
```

In the existing `loadGroups` effect, add:

```typescript
// After loading parts, also load saved snapshot
const snapshot = await adapter.loadSnapshot();
if (!cancelled && snapshot) {
  setSavedSnapshot(snapshot);
}
```

Pass to the calculator:

```tsx
<CutlistCalculator
  key={calculatorKey}
  initialData={initialData}
  savedSnapshot={savedSnapshot}
  onDataChange={handleDataChange}
  onSummaryChange={handleSummaryChange}
  onSaveToCosting={handleSaveToCosting}
  savingToCosting={savingToCosting}
  loadMaterialDefaults={true}
  saveMaterialDefaults={true}
/>
```

- [ ] **Step 4: Verify in the browser**

1. Open cutlist builder, calculate layout, set a sheet to "manual 80%", set edging +10%, click "Save to Costing"
2. Navigate away (e.g. back to product page)
3. Return to cutlist builder
4. Verify: sheet overrides and edging overrides are restored from the saved snapshot

- [ ] **Step 5: Commit**

```bash
git add components/features/cutlist/adapters/useProductCutlistBuilderAdapter.ts \
      components/features/cutlist/CutlistCalculator.tsx \
      app/products/\[productId\]/cutlist-builder/page.tsx
git commit -m "feat: restore saved snapshot overrides when reopening cutlist builder"
```

---

### Task 8: Costing Tab — Cutlist Materials Sub-Section

**Files:**
- Modify: `components/features/products/product-costing.tsx`

This is the main UI integration — reading the snapshot and displaying cutlist material costs alongside existing BOM costs.

- [ ] **Step 1: Add snapshot query and parts hash query**

In `ProductCosting`, add two new queries:

```typescript
import { authorizedFetch } from '@/lib/client/auth-fetch';
import type { CutlistCostingSnapshot } from '@/lib/cutlist/costingSnapshot';
import { computePartsHash } from '@/lib/cutlist/costingSnapshot';
import { flattenGroupsToCompactParts } from '@/lib/configurator/cutlistGroupConversion';

// Fetch costing snapshot
const { data: snapshotResponse } = useQuery({
  queryKey: ['cutlist-costing-snapshot', productId],
  queryFn: async () => {
    const res = await authorizedFetch(`/api/products/${productId}/cutlist-costing-snapshot`);
    if (!res.ok) return { snapshot: null };
    return (await res.json()) as { snapshot: { snapshot_data: CutlistCostingSnapshot; parts_hash: string } | null };
  },
});

// Fetch cutlist groups for staleness check
const { data: cutlistGroups } = useQuery({
  queryKey: ['cutlist-groups', productId],
  queryFn: async () => {
    const res = await authorizedFetch(`/api/products/${productId}/cutlist-groups`);
    if (!res.ok) return { groups: [] };
    return (await res.json()) as { groups: unknown[] };
  },
});
```

- [ ] **Step 2: Add `is_cutlist_item` to `EffectiveItem` type and filter cutlist BOM rows**

The existing `EffectiveItem` type (around line 76) doesn't include `is_cutlist_item`. Add it:

```typescript
type EffectiveItem = {
  component_id: number
  quantity_required: number
  supplier_component_id: number | null
  suppliercomponents?: { price?: number | null } | null
  _source?: 'direct' | 'link'
  _sub_product_id?: number
  is_cutlist_item?: boolean | null  // ← add this
}
```

The effective-bom API already returns this field. When a cutlist snapshot exists, filter cutlist BOM rows out of the materials list to prevent double-counting. Find where `materials` is computed from `effective.items` or `bom` (around line 159) and add:

```typescript
// When cutlist snapshot exists, exclude cutlist BOM items from hardware materials
const filteredEffectiveItems = snapshot
  ? (effective.items || []).filter(it => !it.is_cutlist_item)
  : (effective.items || []);
```

Use `filteredEffectiveItems` instead of `effective.items` in the materials mapping. For the legacy `bom` fallback path, add the same filter using a join to check `is_cutlist_item` on the BOM row (add `is_cutlist_item` to the BOM select query).

- [ ] **Step 3: Compute staleness**

Add `useMemo` to the existing `import { useState } from 'react'` at the top of the file:

```typescript
import { useState, useMemo } from 'react'
```

Then add the staleness computation:

```typescript
const snapshot = snapshotResponse?.snapshot?.snapshot_data ?? null;
const storedHash = snapshotResponse?.snapshot?.parts_hash ?? null;
const hasCutlistGroups = (cutlistGroups?.groups?.length ?? 0) > 0;

// Compute current parts hash for staleness check
const currentPartsHash = useMemo(() => {
  if (!cutlistGroups?.groups?.length) return null;
  const parts = flattenGroupsToCompactParts(cutlistGroups.groups as never[]);
  return computePartsHash(parts);
}, [cutlistGroups]);

const isStale = storedHash !== null && currentPartsHash !== null && storedHash !== currentPartsHash;
```

- [ ] **Step 4: Add helper to derive per-material totals from snapshot**

```typescript
interface CutlistMaterialCostLine {
  label: string;
  unit: string;
  actual: number;
  padded: number;
  unitPrice: number | null;
  actualCost: number | null;
  paddedCost: number | null;
}

function deriveCutlistCostLines(snapshot: CutlistCostingSnapshot): CutlistMaterialCostLine[] {
  const lines: CutlistMaterialCostLine[] = [];

  // Board lines — aggregate per material from per-sheet data
  const materialSheets = new Map<string, { actual: number; padded: number; name: string }>();
  for (const sheet of snapshot.sheets) {
    const matId = sheet.material_id || 'unknown';
    const current = materialSheets.get(matId) ?? { actual: 0, padded: 0, name: sheet.material_name };
    const sheetArea = sheet.sheet_length_mm * sheet.sheet_width_mm;
    const usedFrac = sheetArea > 0 ? sheet.used_area_mm2 / sheetArea : 0;
    current.actual += usedFrac;

    let billedFrac = usedFrac;
    if (snapshot.global_full_board) {
      billedFrac = 1;
    } else if (sheet.billing_override) {
      if (sheet.billing_override.mode === 'full') billedFrac = 1;
      if (sheet.billing_override.mode === 'manual') billedFrac = sheet.billing_override.manualPct / 100;
    }
    current.padded += billedFrac;
    materialSheets.set(matId, current);
  }

  for (const [matId, { actual, padded, name }] of materialSheets) {
    const price = snapshot.board_prices.find(b => b.material_id === matId)?.unit_price_per_sheet ?? null;
    lines.push({
      label: name || matId,
      unit: 'sheets',
      actual,
      padded,
      unitPrice: price,
      actualCost: price !== null ? actual * price : null,
      paddedCost: price !== null ? padded * price : null,
    });
  }

  // Edging lines
  for (const e of snapshot.edging) {
    let paddedMeters = e.meters_actual;
    if (e.meters_override !== null) {
      paddedMeters = e.meters_override;
    } else if (e.pct_override !== null) {
      paddedMeters = e.meters_actual * (1 + e.pct_override / 100);
    }
    lines.push({
      label: `${e.material_name} (${e.thickness_mm}mm edging)`,
      unit: 'm',
      actual: e.meters_actual,
      padded: paddedMeters,
      unitPrice: e.unit_price_per_meter,
      actualCost: e.unit_price_per_meter !== null ? e.meters_actual * e.unit_price_per_meter : null,
      paddedCost: e.unit_price_per_meter !== null ? paddedMeters * e.unit_price_per_meter : null,
    });
  }

  // Backer lines
  if (snapshot.backer_sheets && snapshot.backer_sheets.length > 0) {
    let backerActual = 0;
    let backerPadded = 0;
    for (const s of snapshot.backer_sheets) {
      const area = s.sheet_length_mm * s.sheet_width_mm;
      const frac = area > 0 ? s.used_area_mm2 / area : 0;
      backerActual += frac;
      let billed = frac;
      if (snapshot.backer_global_full_board) {
        billed = 1;
      } else if (s.billing_override) {
        if (s.billing_override.mode === 'full') billed = 1;
        if (s.billing_override.mode === 'manual') billed = s.billing_override.manualPct / 100;
      }
      backerPadded += billed;
    }
    const backerPrice = snapshot.backer_price_per_sheet;
    lines.push({
      label: 'Backer board',
      unit: 'sheets',
      actual: backerActual,
      padded: backerPadded,
      unitPrice: backerPrice,
      actualCost: backerPrice !== null ? backerActual * backerPrice : null,
      paddedCost: backerPrice !== null ? backerPadded * backerPrice : null,
    });
  }

  return lines;
}
```

- [ ] **Step 5: Render the cutlist materials sub-section**

In the materials section of the costing tab (where `materials` array is rendered in the table), add a conditional block for the cutlist sub-section:

```tsx
{/* Staleness banner */}
{isStale && (
  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-sm px-3 py-2 mb-3 flex items-center gap-2 text-xs text-yellow-200">
    <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
    <span>Cutlist parts have been modified since the last layout calculation. Costs may be outdated.</span>
    <a href={`/products/${productId}/cutlist-builder`} className="text-primary underline ml-auto whitespace-nowrap">
      Open Cutlist Builder →
    </a>
  </div>
)}

{/* No snapshot but has cutlist */}
{!snapshot && hasCutlistGroups && (
  <div className="bg-muted/50 border border-border rounded-sm px-3 py-2 mb-3 flex items-center gap-2 text-xs text-muted-foreground">
    <Package className="h-3.5 w-3.5 flex-shrink-0" />
    <span>This product has cutlist parts but no layout has been calculated yet.</span>
    <a href={`/products/${productId}/cutlist-builder`} className="text-primary underline ml-auto whitespace-nowrap">
      Open Cutlist Builder →
    </a>
  </div>
)}

{/* Cutlist Materials table */}
{snapshot && (() => {
  const cutlistLines = deriveCutlistCostLines(snapshot);
  const cutlistPaddedTotal = cutlistLines.reduce((s, l) => s + (l.paddedCost ?? 0), 0);
  const cutlistActualTotal = cutlistLines.reduce((s, l) => s + (l.actualCost ?? 0), 0);

  return (
    <div className="mt-4">
      <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">Cutlist Materials</h4>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Material</TableHead>
            <TableHead className="text-right">Actual</TableHead>
            <TableHead className="text-right">Padded</TableHead>
            <TableHead className="text-right">Unit Price</TableHead>
            <TableHead className="text-right">Actual Cost</TableHead>
            <TableHead className="text-right">Padded Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cutlistLines.map((line, i) => (
            <TableRow key={i}>
              <TableCell className="text-sm">{line.label}</TableCell>
              <TableCell className="text-right tabular-nums text-sm">
                {line.actual.toFixed(3)} {line.unit}
              </TableCell>
              <TableCell className="text-right tabular-nums text-sm font-medium">
                {line.padded.toFixed(3)} {line.unit}
              </TableCell>
              <TableCell className="text-right tabular-nums text-sm">
                {line.unitPrice !== null ? fmtMoney(line.unitPrice) : '—'}
                {line.unit === 'm' ? '/m' : ''}
              </TableCell>
              <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                {fmtMoney(line.actualCost)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-sm font-medium">
                {fmtMoney(line.paddedCost)}
              </TableCell>
            </TableRow>
          ))}
          <TableRow className="border-t-2">
            <TableCell className="font-medium text-sm">Cutlist Subtotal</TableCell>
            <TableCell />
            <TableCell />
            <TableCell />
            <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
              {fmtMoney(cutlistActualTotal)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-sm font-medium">
              {fmtMoney(cutlistPaddedTotal)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
})()}
```

- [ ] **Step 6: Update total materials calculation**

The existing `materialTotal` is computed from BOM line totals. Since Step 2 already filters out cutlist BOM items when a snapshot exists, `materialTotal` now represents hardware-only cost. Add the cutlist padded subtotal on top:

```typescript
const cutlistCostLines = snapshot ? deriveCutlistCostLines(snapshot) : [];
const cutlistPaddedTotal = cutlistCostLines.reduce((s, l) => s + (l.paddedCost ?? 0), 0);
const cutlistActualTotal = cutlistCostLines.reduce((s, l) => s + (l.actualCost ?? 0), 0);

// materialTotal already excludes cutlist items (filtered in Step 2), so no double-count
const totalMaterials = materialTotal + cutlistPaddedTotal;
```

Update the "Total Materials" display row to use `totalMaterials`. Show the actual total (hardware + cutlist actual) in muted text as a secondary line.

- [ ] **Step 7: Verify in the browser**

Navigate to the product costing tab for a product with a saved snapshot. Confirm:
- Cutlist Materials sub-section renders with correct data
- Actual and Padded columns show the right numbers
- Hardware BOM items with `is_cutlist_item = true` are NOT shown in the Hardware & Components section (no double-counting)
- Total materials = hardware subtotal + cutlist padded subtotal
- Products without cutlist show unchanged behavior

- [ ] **Step 8: Commit**

```bash
git add components/features/products/product-costing.tsx
git commit -m "feat: display cutlist materials in product costing tab with actual/padded costs"
```

---

### Task 9: End-to-End Verification

**Files:** None — this is a test/verification task.

- [ ] **Step 1: Full flow test**

1. Navigate to a product with cutlist parts (e.g. product 810)
2. Open the Cutlist Builder tab → click Cutlist Builder
3. Click Calculate Layout
4. Adjust Manual % on a sheet to 80%
5. Set an edging padding (e.g. +10%)
6. Click "Save to Costing"
7. Navigate back to the product → Costing tab
8. Verify the Cutlist Materials sub-section shows correct actual/padded values
9. Verify the total materials cost includes cutlist contribution

- [ ] **Step 2: Staleness test**

1. Go back to Cutlist Builder
2. Change a part dimension (e.g. increase shelf width)
3. Do NOT click Calculate Layout — just let autosave fire
4. Navigate to Costing tab
5. Verify the staleness banner appears: "Cutlist parts have been modified..."

- [ ] **Step 3: No-snapshot test**

1. Navigate to a product that has cutlist groups but has never had Calculate Layout run
2. Verify the info banner appears: "This product has cutlist parts but no layout..."

- [ ] **Step 4: No-cutlist test**

1. Navigate to a product with no cutlist groups at all
2. Verify the costing tab looks exactly the same as before (no cutlist section, no banners)

- [ ] **Step 5: Run lint**

```bash
npm run lint
```

- [ ] **Step 6: Run type check**

```bash
npx tsc --noEmit
```

- [ ] **Step 7: Final commit (if any fixes needed)**

```bash
git add -A && git commit -m "fix: address lint/type issues from cutlist-to-costing integration"
```

---

## Summary of Tasks

| Task | Description | Dependencies |
|------|-------------|--------------|
| 1 | Database migration + RLS | None |
| 2 | TypeScript types + snapshot builder | None |
| 3 | API endpoints (GET/PUT) | Task 1 |
| 4 | Adapter `saveSnapshot()` | Task 2, 3 |
| 5 | Edging override controls | Task 2 |
| 6 | Wire snapshot save into builder page | Task 4, 5 |
| 7 | Restore snapshot into cutlist builder | Task 3, 4 |
| 8 | Costing tab cutlist materials section | Task 2, 3 |
| 9 | End-to-end verification | All above |

Tasks 1 and 2 can run in parallel. Tasks 3, 5 can partially overlap. Task 7 (restore) and Task 8 (costing tab) are independent of each other. Task 9 is the final verification.
