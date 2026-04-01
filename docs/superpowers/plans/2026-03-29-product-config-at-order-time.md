# Product Configuration at Order Time — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When adding a product to an order, let the user swap substitutable BOM components (category-filtered combobox) and review/edit a cutlist snapshot — both frozen as immutable JSONB on the order line.

**Architecture:** Two new JSONB columns on `order_details` (`bom_snapshot`, `cutlist_snapshot`) store frozen copies of the product's BOM and cutlist. A configuration dialog appears when adding products with substitutable lines or cutlists. Downstream (job cards, purchasing, cutting diagram) reads from snapshots, never the live product BOM.

**Tech Stack:** Next.js 15 App Router, Supabase (Postgres), React, shadcn/ui, Tailwind v4, `authorizedFetch` for client API calls, `supabaseAdmin` + `requireProductsAccess` for server auth.

**Spec:** `docs/superpowers/specs/2026-03-29-bom-substitution-design.md` (v2)

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `lib/orders/build-bom-snapshot.ts` | Server-side: build `bom_snapshot` JSONB from product BOM + substitutions |
| `lib/orders/build-cutlist-snapshot.ts` | Server-side: build `cutlist_snapshot` JSONB from product cutlist groups |
| `lib/orders/snapshot-types.ts` | Shared TypeScript types for `BomSnapshotEntry` and `CutlistSnapshotGroup` |
| `app/api/components/by-category/[categoryId]/route.ts` | API: components in a category with cheapest supplier price |
| `app/api/orders/[orderId]/details/[detailId]/effective-bom/route.ts` | API: read `bom_snapshot` for an order line |
| `app/api/orders/[orderId]/details/[detailId]/cutlist/route.ts` | API: read/update `cutlist_snapshot` for an order line |
| `app/api/orders/[orderId]/export-cutlist/route.ts` | API: aggregated cutlist across all order lines |
| `components/features/orders/ConfigureProductDialog.tsx` | UI: configuration dialog (substitution comboboxes + cutlist review) |
| `components/features/orders/SubstitutionCombobox.tsx` | UI: category-filtered searchable combobox for component substitution |
| `components/features/orders/CutlistSnapshotSummary.tsx` | UI: collapsed cutlist summary with edit trigger |
| `hooks/useComponentsByCategory.ts` | Client hook: fetch components by category with search |

### Modified Files
| File | Change |
|------|--------|
| `app/api/products/[productId]/bom/route.ts` | Include `is_substitutable` in GET response |
| `app/api/products/[productId]/bom/[bomId]/route.ts` | Accept `is_substitutable` in PATCH payload |
| `app/api/orders/[orderId]/add-products/route.ts` | Accept substitutions, build snapshots, store on `order_details` |
| `components/features/products/product-bom.tsx` | Add substitutable toggle per BOM row |
| `components/features/orders/AddProductsDialog.tsx` | Trigger ConfigureProductDialog for products with substitutable lines or cutlists |
| `types/orders.ts` | Add `bom_snapshot` and `cutlist_snapshot` to `OrderDetail` type |

---

## Task 1: Database Migration — `is_substitutable` + snapshot columns

**Files:**
- Create: migration via Supabase MCP `apply_migration`

- [ ] **Step 1: Apply migration**

Use the Supabase MCP `apply_migration` tool with this SQL:

```sql
-- Add is_substitutable to BOM lines
ALTER TABLE billofmaterials
  ADD COLUMN IF NOT EXISTS is_substitutable boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN billofmaterials.is_substitutable IS
  'When true, this BOM line can be swapped for another component at order time';

-- Add bom_snapshot to order details
ALTER TABLE order_details
  ADD COLUMN IF NOT EXISTS bom_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN order_details.bom_snapshot IS
  'Immutable snapshot of the full effective BOM at order time. Each entry is a resolved BOM line.';

-- Add cutlist_snapshot to order details
ALTER TABLE order_details
  ADD COLUMN IF NOT EXISTS cutlist_snapshot jsonb DEFAULT NULL;

COMMENT ON COLUMN order_details.cutlist_snapshot IS
  'Frozen copy of product cutlist groups at order time. Editable per order line. NULL = no cutlist.';
```

- [ ] **Step 2: Verify migration**

Run via Supabase MCP `execute_sql`:

```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name IN ('billofmaterials', 'order_details')
  AND column_name IN ('is_substitutable', 'bom_snapshot', 'cutlist_snapshot')
ORDER BY table_name, column_name;
```

Expected: 3 rows — `is_substitutable` (boolean), `bom_snapshot` (jsonb), `cutlist_snapshot` (jsonb).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add is_substitutable, bom_snapshot, cutlist_snapshot columns"
```

---

## Task 2: Shared Types — `BomSnapshotEntry` and `CutlistSnapshotGroup`

**Files:**
- Create: `lib/orders/snapshot-types.ts`
- Modify: `types/orders.ts`

- [ ] **Step 1: Create snapshot types**

```typescript
// lib/orders/snapshot-types.ts

export type BomSnapshotEntry = {
  source_bom_id: number;
  component_id: number;
  component_code: string;
  component_description: string | null;
  category_id: number | null;
  category_name: string | null;
  supplier_component_id: number | null;
  supplier_name: string | null;
  unit_price: number;
  quantity_required: number;
  line_total: number;
  is_substituted: boolean;
  default_component_id: number;
  default_component_code: string;
  is_cutlist_item: boolean;
  cutlist_category: string | null;
  cutlist_group_link: number | null;
  note: string | null;
};

export type CutlistSnapshotPart = {
  id: string;
  name: string;
  grain: string;
  quantity: number;
  width_mm: number;
  length_mm: number;
  band_edges: Record<string, boolean>;
  lamination_type: string;
  material_label?: string;
};

export type CutlistSnapshotGroup = {
  source_group_id: number;
  name: string;
  board_type: string;
  primary_material_id: number | null;
  primary_material_name: string | null;
  backer_material_id: number | null;
  backer_material_name: string | null;
  parts: CutlistSnapshotPart[];
};
```

- [ ] **Step 2: Update OrderDetail type**

In `types/orders.ts`, add to the `OrderDetail` type (around line 36):

```typescript
// Add these fields to the existing OrderDetail type:
bom_snapshot?: BomSnapshotEntry[];
cutlist_snapshot?: CutlistSnapshotGroup[] | null;
```

Import the types at the top of the file:

```typescript
import type { BomSnapshotEntry, CutlistSnapshotGroup } from '@/lib/orders/snapshot-types';
```

- [ ] **Step 3: Commit**

```bash
git add lib/orders/snapshot-types.ts types/orders.ts
git commit -m "feat: add BomSnapshotEntry and CutlistSnapshotGroup types"
```

---

## Task 3: BOM Snapshot Builder — server-side

**Files:**
- Create: `lib/orders/build-bom-snapshot.ts`

- [ ] **Step 1: Implement snapshot builder**

This function loads a product's full BOM, resolves supplier pricing, applies any substitutions, and returns a `BomSnapshotEntry[]`.

```typescript
// lib/orders/build-bom-snapshot.ts

import { supabaseAdmin } from '@/lib/supabase-admin';
import type { BomSnapshotEntry } from './snapshot-types';

type Substitution = {
  bom_id: number;
  component_id: number;
  supplier_component_id?: number | null;
  note?: string | null;
};

/**
 * Builds an immutable BOM snapshot for an order line.
 *
 * @param productId - The product being added to the order
 * @param orgId - Caller's org (for component resolution)
 * @param substitutions - Optional array of component swaps chosen by the user
 * @param cutlistGroupMap - Map of component_id -> cutlist group id (for cutlist_group_link)
 */
export async function buildBomSnapshot(
  productId: number,
  orgId: string,
  substitutions: Substitution[] = [],
  cutlistGroupMap: Map<number, number> = new Map()
): Promise<BomSnapshotEntry[]> {
  // Load full BOM with component + category + supplier info
  const { data: bomRows, error: bomError } = await supabaseAdmin
    .from('billofmaterials')
    .select(`
      bom_id,
      component_id,
      quantity_required,
      supplier_component_id,
      is_cutlist_item,
      cutlist_category,
      is_substitutable,
      components (
        component_id,
        internal_code,
        description,
        category_id,
        component_categories ( cat_id, categoryname )
      )
    `)
    .eq('product_id', productId);

  if (bomError) throw bomError;
  if (!bomRows || bomRows.length === 0) return [];

  // Build substitution lookup
  const subMap = new Map<number, Substitution>();
  for (const sub of substitutions) {
    subMap.set(sub.bom_id, sub);
  }

  // Collect all component IDs we need supplier pricing for
  const componentIds = new Set<number>();
  const supplierComponentIds = new Set<number>();

  for (const row of bomRows) {
    const sub = subMap.get(row.bom_id);
    const effectiveComponentId = sub?.component_id ?? row.component_id;
    if (effectiveComponentId) componentIds.add(effectiveComponentId);
    const effectiveSupplierComponentId = sub?.supplier_component_id ?? row.supplier_component_id;
    if (effectiveSupplierComponentId) supplierComponentIds.add(effectiveSupplierComponentId);
  }

  // Load supplier components for pricing
  const { data: supplierComponents } = await supabaseAdmin
    .from('suppliercomponents')
    .select('supplier_component_id, component_id, price, suppliers(supplier_id, suppliername)')
    .in('component_id', Array.from(componentIds));

  // Build supplier pricing lookup: component_id -> cheapest supplier component
  const cheapestByComponent = new Map<number, any>();
  const supplierById = new Map<number, any>();
  for (const sc of supplierComponents ?? []) {
    supplierById.set(sc.supplier_component_id, sc);
    const existing = cheapestByComponent.get(sc.component_id);
    if (!existing || sc.price < existing.price) {
      cheapestByComponent.set(sc.component_id, sc);
    }
  }

  // If substituted, load the substitute component details
  const subComponentIds = Array.from(new Set(substitutions.map(s => s.component_id)));
  let subComponentsMap = new Map<number, any>();
  if (subComponentIds.length > 0) {
    const { data: subComponents } = await supabaseAdmin
      .from('components')
      .select('component_id, internal_code, description, category_id, component_categories(cat_id, categoryname)')
      .in('component_id', subComponentIds);
    for (const c of subComponents ?? []) {
      subComponentsMap.set(c.component_id, c);
    }
  }

  // Build snapshot entries
  const entries: BomSnapshotEntry[] = [];

  for (const row of bomRows) {
    const sub = subMap.get(row.bom_id);
    const isSubstituted = !!sub;

    // Default component info (from BOM)
    const defaultComponent = row.components as any;
    const defaultCategory = defaultComponent?.component_categories;

    // Effective component (substituted or default)
    const effectiveComponentId = sub?.component_id ?? row.component_id;
    const effectiveComponent = isSubstituted
      ? subComponentsMap.get(effectiveComponentId) ?? defaultComponent
      : defaultComponent;
    const effectiveCategory = effectiveComponent?.component_categories ?? defaultCategory;

    // Resolve supplier pricing
    const explicitSupplierComponentId = sub?.supplier_component_id ?? row.supplier_component_id;
    const supplierComponent = explicitSupplierComponentId
      ? supplierById.get(explicitSupplierComponentId)
      : cheapestByComponent.get(effectiveComponentId);

    const unitPrice = supplierComponent?.price ?? 0;
    const qty = Number(row.quantity_required ?? 0);

    entries.push({
      source_bom_id: row.bom_id,
      component_id: effectiveComponentId,
      component_code: effectiveComponent?.internal_code ?? '',
      component_description: effectiveComponent?.description ?? null,
      category_id: effectiveCategory?.cat_id ?? null,
      category_name: effectiveCategory?.categoryname ?? null,
      supplier_component_id: supplierComponent?.supplier_component_id ?? null,
      supplier_name: (supplierComponent?.suppliers as any)?.suppliername ?? null,
      unit_price: unitPrice,
      quantity_required: qty,
      line_total: Math.round(unitPrice * qty * 100) / 100,
      is_substituted: isSubstituted,
      default_component_id: row.component_id,
      default_component_code: defaultComponent?.internal_code ?? '',
      is_cutlist_item: row.is_cutlist_item ?? false,
      cutlist_category: row.cutlist_category ?? null,
      cutlist_group_link: cutlistGroupMap.get(row.component_id) ?? null,
      note: sub?.note ?? null,
    });
  }

  return entries;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/orders/build-bom-snapshot.ts
git commit -m "feat: add server-side BOM snapshot builder"
```

---

## Task 4: Cutlist Snapshot Builder — server-side

**Files:**
- Create: `lib/orders/build-cutlist-snapshot.ts`

- [ ] **Step 1: Implement cutlist snapshot builder**

```typescript
// lib/orders/build-cutlist-snapshot.ts

import { supabaseAdmin } from '@/lib/supabase-admin';
import type { CutlistSnapshotGroup } from './snapshot-types';

/**
 * Builds a cutlist snapshot from a product's cutlist groups.
 * Returns null if the product has no cutlist.
 *
 * @param productId - The product being added
 * @param orgId - Caller's org
 * @param materialOverrides - Map of original component_id -> substitute component_id + name
 *   (for updating material refs when BOM substitution changes a board material)
 */
export async function buildCutlistSnapshot(
  productId: number,
  orgId: string,
  materialOverrides: Map<number, { component_id: number; name: string }> = new Map()
): Promise<{ snapshot: CutlistSnapshotGroup[] | null; groupMap: Map<number, number> }> {
  const { data: groups, error } = await supabaseAdmin
    .from('product_cutlist_groups')
    .select('*')
    .eq('product_id', productId)
    .eq('org_id', orgId)
    .order('sort_order', { ascending: true });

  if (error) throw error;
  if (!groups || groups.length === 0) return { snapshot: null, groupMap: new Map() };

  // Build map: component_id (primary_material_id) -> cutlist group id
  const groupMap = new Map<number, number>();

  const snapshot: CutlistSnapshotGroup[] = groups.map((g: any) => {
    const materialId = g.primary_material_id;
    if (materialId) {
      groupMap.set(materialId, g.id);
    }

    // Apply material override if BOM substitution changed this board material
    const override = materialId ? materialOverrides.get(materialId) : undefined;

    return {
      source_group_id: g.id,
      name: g.name,
      board_type: g.board_type,
      primary_material_id: override?.component_id ?? g.primary_material_id,
      primary_material_name: override?.name ?? g.primary_material_name,
      backer_material_id: g.backer_material_id,
      backer_material_name: g.backer_material_name,
      parts: g.parts ?? [],
    };
  });

  return { snapshot, groupMap };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/orders/build-cutlist-snapshot.ts
git commit -m "feat: add server-side cutlist snapshot builder"
```

---

## Task 5: BOM API — expose `is_substitutable`

**Files:**
- Modify: `app/api/products/[productId]/bom/route.ts` (GET response)
- Modify: `app/api/products/[productId]/bom/[bomId]/route.ts` (PATCH payload)

- [ ] **Step 1: Add `is_substitutable` to GET response**

In `app/api/products/[productId]/bom/route.ts`, find the `.select()` query in the GET handler and add `is_substitutable` to the selected columns. It should already be selecting from `billofmaterials` — just add the column to the select string.

- [ ] **Step 2: Add `is_substitutable` to PATCH handler**

In `app/api/products/[productId]/bom/[bomId]/route.ts`, find the PATCH handler's `updateData` object construction. Add:

```typescript
if ('is_substitutable' in payload) {
  updateData.is_substitutable = Boolean(payload.is_substitutable);
}
```

- [ ] **Step 3: Verify**

Test via Supabase MCP `execute_sql`:

```sql
SELECT bom_id, component_id, is_substitutable
FROM billofmaterials
WHERE product_id = 812
LIMIT 5;
```

All rows should show `is_substitutable = false` (default).

- [ ] **Step 4: Commit**

```bash
git add "app/api/products/[productId]/bom/route.ts" "app/api/products/[productId]/bom/[bomId]/route.ts"
git commit -m "feat: expose is_substitutable in BOM API"
```

---

## Task 6: BOM UI — substitutable toggle per row

**Files:**
- Modify: `components/features/products/product-bom.tsx`

- [ ] **Step 1: Add substitutable toggle to BOM table**

In `product-bom.tsx`, find the Actions column in the BOM table (around line 1773). Add a toggle/switch before the edit and delete buttons. The toggle should:

1. Display a small `ArrowLeftRight` (from lucide-react) icon button, highlighted when `is_substitutable` is true
2. On click, call the existing PATCH endpoint via `authorizedFetch`:

```typescript
const toggleSubstitutable = async (bomId: number, current: boolean) => {
  await authorizedFetch(`/api/products/${productId}/bom/${bomId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_substitutable: !current }),
  });
  // Trigger refetch of BOM data
};
```

3. Show a tooltip: "Substitutable at order time" when enabled, "Fixed component" when disabled
4. If the component has no `category_id`, show tooltip: "Set a category to enable substitution" and disable the toggle

- [ ] **Step 2: Verify in browser**

Navigate to `localhost:3000/products/812?tab=costing`, find a BOM row, and confirm the toggle appears in the Actions column. Click it and verify the state changes.

- [ ] **Step 3: Commit**

```bash
git add components/features/products/product-bom.tsx
git commit -m "feat: add substitutable toggle to BOM rows"
```

---

## Task 7: Component-by-Category API

**Files:**
- Create: `app/api/components/by-category/[categoryId]/route.ts`

- [ ] **Step 1: Implement the endpoint**

```typescript
// app/api/components/by-category/[categoryId]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireProductsAccess } from '@/lib/api/products-access';

type RouteParams = { categoryId: string };

export async function GET(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  const { categoryId: catParam } = await context.params;
  const url = new URL(request.url);
  const search = url.searchParams.get('search')?.trim() ?? '';
  const showAll = catParam === 'all';
  const categoryId = showAll ? null : Number(catParam);

  if (!showAll && (!Number.isFinite(categoryId) || categoryId! <= 0)) {
    return NextResponse.json({ error: 'Invalid category ID' }, { status: 400 });
  }

  try {
    let query = supabaseAdmin
      .from('components')
      .select(`
        component_id,
        internal_code,
        description,
        category_id,
        component_categories ( cat_id, categoryname ),
        suppliercomponents (
          supplier_component_id,
          price,
          suppliers ( supplier_id, suppliername )
        )
      `)
      .eq('org_id', auth.orgId)
      .order('internal_code', { ascending: true })
      .limit(50);

    if (!showAll && categoryId) {
      query = query.eq('category_id', categoryId);
    }

    if (search.length >= 2) {
      query = query.or(`internal_code.ilike.%${search}%,description.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    // For each component, find the cheapest supplier and include it
    const results = (data ?? []).map((c: any) => {
      const suppliers = c.suppliercomponents ?? [];
      const cheapest = suppliers.length > 0
        ? suppliers.reduce((min: any, s: any) => (s.price < min.price ? s : min), suppliers[0])
        : null;

      return {
        component_id: c.component_id,
        internal_code: c.internal_code,
        description: c.description,
        category_id: c.category_id,
        category_name: c.component_categories?.categoryname ?? null,
        cheapest_price: cheapest?.price ?? null,
        cheapest_supplier_component_id: cheapest?.supplier_component_id ?? null,
        cheapest_supplier_name: cheapest?.suppliers?.suppliername ?? null,
      };
    });

    return NextResponse.json({ components: results });
  } catch (err: any) {
    console.error('[components/by-category] error', err);
    return NextResponse.json({ error: 'Failed to load components' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add "app/api/components/by-category/[categoryId]/route.ts"
git commit -m "feat: add component-by-category API with supplier pricing"
```

---

## Task 8: Substitution Combobox Component

**Files:**
- Create: `components/features/orders/SubstitutionCombobox.tsx`
- Create: `hooks/useComponentsByCategory.ts`

- [ ] **Step 1: Create the data hook**

```typescript
// hooks/useComponentsByCategory.ts

import { useState, useEffect, useRef } from 'react';
import { authorizedFetch } from '@/lib/client/auth-fetch';

export type ComponentOption = {
  component_id: number;
  internal_code: string;
  description: string | null;
  category_id: number | null;
  category_name: string | null;
  cheapest_price: number | null;
  cheapest_supplier_component_id: number | null;
  cheapest_supplier_name: string | null;
};

export function useComponentsByCategory(categoryId: number | 'all' | null, search: string) {
  const [components, setComponents] = useState<ComponentOption[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (categoryId === null) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    const params = new URLSearchParams();
    if (search.trim().length >= 2) params.set('search', search.trim());

    authorizedFetch(`/api/components/by-category/${categoryId}?${params}`, {
      signal: controller.signal,
    })
      .then(res => res.json())
      .then(json => {
        if (!controller.signal.aborted) {
          setComponents(json.components ?? []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [categoryId, search]);

  return { components, loading };
}
```

- [ ] **Step 2: Create the combobox component**

Create `components/features/orders/SubstitutionCombobox.tsx`. This is a Popover + Command (shadcn pattern) with:

- A trigger button showing the currently selected component name and price
- A category filter dropdown at the top right of the popover (defaults to the component's category)
- A search input
- A list of components with internal_code, description, and price
- The default component marked with a star
- "Browse all categories" option at the bottom

Props:
```typescript
type SubstitutionComboboxProps = {
  defaultComponentId: number;
  defaultComponentCode: string;
  defaultCategoryId: number | null;
  defaultCategoryName: string | null;
  selectedComponentId: number;
  onSelect: (component: ComponentOption) => void;
  categories: { cat_id: number; categoryname: string }[];
};
```

Use the `useComponentsByCategory` hook for data fetching. Use `Popover` + `Command` from shadcn. Use the existing searchable combobox pattern from the codebase (reference `feedback_searchable_combobox` memory: use Popover+Command, not Radix Select).

Render price as `R{price.toFixed(2)}` using the existing `formatCurrency` helper if available, or inline formatting.

- [ ] **Step 3: Commit**

```bash
git add hooks/useComponentsByCategory.ts components/features/orders/SubstitutionCombobox.tsx
git commit -m "feat: add SubstitutionCombobox with category filter"
```

---

## Task 9: Configuration Dialog

**Files:**
- Create: `components/features/orders/ConfigureProductDialog.tsx`
- Create: `components/features/orders/CutlistSnapshotSummary.tsx`

- [ ] **Step 1: Create cutlist summary component**

A simple display component showing cutlist group summary when collapsed:

```typescript
// components/features/orders/CutlistSnapshotSummary.tsx

type CutlistSnapshotSummaryProps = {
  groups: CutlistSnapshotGroup[];
  onEdit: () => void;
};
```

Renders: `"Panels (16mm) — 4 parts, White Melamine"` with an `[Edit]` button. One line per group.

- [ ] **Step 2: Create configuration dialog**

Create `components/features/orders/ConfigureProductDialog.tsx`. This is a Dialog (shadcn) that:

1. Receives the product data, its substitutable BOM lines, and cutlist groups
2. Shows a COMPONENTS section with one `SubstitutionCombobox` per substitutable BOM line
3. Shows a CUTLIST section (collapsed) with `CutlistSnapshotSummary`
4. Shows live material cost total with delta from defaults
5. Has "Use all defaults" button and "Add to Order" button

Props:
```typescript
type ConfigureProductDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: {
    product_id: number;
    name: string;
    bomLines: SubstitutableBomLine[];
    cutlistGroups: CutlistSnapshotGroup[];
    defaultMaterialCost: number;
  };
  quantity: number;
  categories: { cat_id: number; categoryname: string }[];
  onConfirm: (config: {
    substitutions: { bom_id: number; component_id: number; supplier_component_id?: number; note?: string }[];
    cutlistEdits: CutlistSnapshotGroup[] | null;
  }) => void;
};
```

State:
- `selections`: `Map<number, ComponentOption>` — bom_id -> selected component (defaults pre-populated)
- `cutlistGroups`: local mutable copy of cutlist groups (for edit)

Material cost calculation:
```typescript
const materialCost = product.bomLines.reduce((sum, line) => {
  const selected = selections.get(line.bom_id);
  const price = selected?.cheapest_price ?? line.default_price;
  return sum + price * line.quantity_required;
}, 0);
const delta = materialCost - product.defaultMaterialCost;
```

Layout follows the spec wireframe. Use `space-y-3` for compact spacing (low-resolution screen support per memory). Dialog should fit within `max-h-[90vh]`.

- [ ] **Step 3: Commit**

```bash
git add components/features/orders/ConfigureProductDialog.tsx components/features/orders/CutlistSnapshotSummary.tsx
git commit -m "feat: add ConfigureProductDialog with substitution and cutlist"
```

---

## Task 10: Modify Add Products Flow — trigger configuration

**Files:**
- Modify: `components/features/orders/AddProductsDialog.tsx`
- Modify: `app/api/orders/[orderId]/add-products/route.ts`

- [ ] **Step 1: Update AddProductsDialog to detect substitutable products**

When the user clicks "Add" for a product that has substitutable BOM lines or cutlist groups, open the `ConfigureProductDialog` instead of immediately adding.

Flow:
1. User selects a product and quantity
2. Before submitting, check if the product has substitutable BOM lines (fetch from `/api/products/{id}/bom` and look for `is_substitutable: true`) or cutlist groups (fetch from `/api/products/{id}/cutlist-groups`)
3. If either exists, open `ConfigureProductDialog`
4. When user confirms configuration, include `substitutions` in the add-products payload
5. If neither exists, add immediately (current behavior)

Add to the request payload per product:
```typescript
{
  product_id: number;
  quantity: number;
  unit_price: number;
  substitutions?: { bom_id: number; component_id: number; supplier_component_id?: number; note?: string }[];
}
```

- [ ] **Step 2: Update add-products API to build snapshots**

In `app/api/orders/[orderId]/add-products/route.ts`, after normalizing the products array:

1. For each product, call `buildCutlistSnapshot()` to get the cutlist snapshot and group map
2. Extract material overrides from substitutions (match substituted board components to cutlist groups)
3. Call `buildBomSnapshot()` with substitutions and the group map
4. Include `bom_snapshot` and `cutlist_snapshot` in the `order_details` insert

```typescript
import { buildBomSnapshot } from '@/lib/orders/build-bom-snapshot';
import { buildCutlistSnapshot } from '@/lib/orders/build-cutlist-snapshot';

// Inside the loop over products:
const materialOverrides = new Map<number, { component_id: number; name: string }>();
// ... build materialOverrides from substitutions that target board components

const { snapshot: cutlistSnapshot, groupMap } = await buildCutlistSnapshot(
  product.product_id, auth.orgId, materialOverrides
);
const bomSnapshot = await buildBomSnapshot(
  product.product_id, auth.orgId, product.substitutions ?? [], groupMap
);

// Add to insert data:
insertData.bom_snapshot = bomSnapshot;
insertData.cutlist_snapshot = cutlistSnapshot;
```

- [ ] **Step 3: Verify in browser**

1. Navigate to an order page
2. Click "Add Products"
3. Select a product that has BOM lines (e.g., product 812)
4. Verify the configuration dialog appears if the product has substitutable lines
5. Confirm the product is added with snapshots (check via `execute_sql` on `order_details`)

- [ ] **Step 4: Commit**

```bash
git add components/features/orders/AddProductsDialog.tsx "app/api/orders/[orderId]/add-products/route.ts"
git commit -m "feat: trigger configuration dialog and build snapshots on add-products"
```

---

## Task 11: Effective BOM API — read snapshot

**Files:**
- Create: `app/api/orders/[orderId]/details/[detailId]/effective-bom/route.ts`

- [ ] **Step 1: Implement endpoint**

Simple read from `order_details.bom_snapshot`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getRouteClient } from '@/lib/supabase-route';

type RouteParams = { orderId: string; detailId: string };

export async function GET(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const { supabase } = getRouteClient(request);
  const { orderId, detailId } = await context.params;

  const { data, error } = await supabase
    .from('order_details')
    .select('order_detail_id, product_id, bom_snapshot')
    .eq('order_detail_id', Number(detailId))
    .eq('order_id', Number(orderId))
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Order detail not found' }, { status: 404 });

  return NextResponse.json({ bom_snapshot: data.bom_snapshot ?? [] });
}
```

- [ ] **Step 2: Commit**

```bash
git add "app/api/orders/[orderId]/details/[detailId]/effective-bom/route.ts"
git commit -m "feat: add effective-bom API reading from snapshot"
```

---

## Task 12: Cutlist Snapshot API — read/update + order export

**Files:**
- Create: `app/api/orders/[orderId]/details/[detailId]/cutlist/route.ts`
- Create: `app/api/orders/[orderId]/export-cutlist/route.ts`

- [ ] **Step 1: Implement per-line cutlist read/update**

GET returns the cutlist snapshot. PATCH updates it (for order-line-level edits like adding a shelf).

```typescript
// app/api/orders/[orderId]/details/[detailId]/cutlist/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getRouteClient } from '@/lib/supabase-route';

type RouteParams = { orderId: string; detailId: string };

export async function GET(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const { supabase } = getRouteClient(request);
  const { orderId, detailId } = await context.params;

  const { data, error } = await supabase
    .from('order_details')
    .select('order_detail_id, cutlist_snapshot')
    .eq('order_detail_id', Number(detailId))
    .eq('order_id', Number(orderId))
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ cutlist_snapshot: data.cutlist_snapshot });
}

export async function PATCH(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const { supabase } = getRouteClient(request);
  const { orderId, detailId } = await context.params;

  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.cutlist_snapshot)) {
    return NextResponse.json({ error: 'cutlist_snapshot array required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('order_details')
    .update({ cutlist_snapshot: body.cutlist_snapshot })
    .eq('order_detail_id', Number(detailId))
    .eq('order_id', Number(orderId))
    .select('order_detail_id, cutlist_snapshot')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ cutlist_snapshot: data.cutlist_snapshot });
}
```

- [ ] **Step 2: Implement order-level cutlist export**

```typescript
// app/api/orders/[orderId]/export-cutlist/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getRouteClient } from '@/lib/supabase-route';
import type { CutlistSnapshotGroup, CutlistSnapshotPart } from '@/lib/orders/snapshot-types';

type RouteParams = { orderId: string };

export async function GET(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const { supabase } = getRouteClient(request);
  const { orderId } = await context.params;

  const { data: details, error } = await supabase
    .from('order_details')
    .select('order_detail_id, product_id, quantity, cutlist_snapshot, products(name)')
    .eq('order_id', Number(orderId));

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Aggregate: multiply part quantities by order line quantity, group by material
  type AggregatedPart = CutlistSnapshotPart & {
    product_name: string;
    order_detail_id: number;
  };

  type MaterialGroup = {
    board_type: string;
    material_id: number | null;
    material_name: string | null;
    parts: AggregatedPart[];
  };

  const groupMap = new Map<string, MaterialGroup>();

  for (const detail of details ?? []) {
    const groups: CutlistSnapshotGroup[] = detail.cutlist_snapshot ?? [];
    const lineQty = detail.quantity ?? 1;
    const productName = (detail.products as any)?.name ?? '';

    for (const group of groups) {
      const key = `${group.board_type}|${group.primary_material_id ?? 'none'}`;

      if (!groupMap.has(key)) {
        groupMap.set(key, {
          board_type: group.board_type,
          material_id: group.primary_material_id,
          material_name: group.primary_material_name,
          parts: [],
        });
      }

      const target = groupMap.get(key)!;
      for (const part of group.parts) {
        target.parts.push({
          ...part,
          quantity: part.quantity * lineQty,
          product_name: productName,
          order_detail_id: detail.order_detail_id,
        });
      }
    }
  }

  return NextResponse.json({
    order_id: Number(orderId),
    material_groups: Array.from(groupMap.values()),
    total_parts: Array.from(groupMap.values()).reduce((sum, g) => sum + g.parts.length, 0),
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add "app/api/orders/[orderId]/details/[detailId]/cutlist/route.ts" "app/api/orders/[orderId]/export-cutlist/route.ts"
git commit -m "feat: add cutlist snapshot API and order-level export"
```

---

## Task 13: Lint + TypeScript check

**Files:** All modified files

- [ ] **Step 1: Run lint**

```bash
npm run lint
```

Fix any errors in files we changed. Ignore pre-existing warnings in untouched files.

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit
```

Fix type errors in our new/modified files. Report pre-existing errors separately.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "fix: lint and type errors"
```

---

## Task 14: Browser Verification

- [ ] **Step 1: Verify substitutable toggle on BOM tab**

Navigate to `localhost:3000/products/812?tab=costing`. Verify:
- Each BOM row shows a substitutable toggle in the Actions column
- Toggling it on/off persists (reload to confirm)
- Screenshot for proof

- [ ] **Step 2: Verify configuration dialog on order**

Navigate to an order, click Add Products, select a product with substitutable BOM lines. Verify:
- Configuration dialog appears
- Substitution comboboxes work (search, category filter, browse all)
- Cost recalculates live
- Cutlist summary shows if the product has cutlist groups
- "Add to Order" saves correctly

- [ ] **Step 3: Verify snapshot data**

After adding a configured product, check the data:

```sql
SELECT order_detail_id, product_id, bom_snapshot, cutlist_snapshot
FROM order_details
WHERE order_id = <test_order_id>
ORDER BY order_detail_id DESC
LIMIT 1;
```

Verify `bom_snapshot` has entries and `cutlist_snapshot` has groups (if applicable).

- [ ] **Step 4: Verify cutlist export**

Hit the export endpoint: `GET /api/orders/{orderId}/export-cutlist` and verify it returns aggregated material groups.

- [ ] **Step 5: Restore test data**

Revert any test data changes made during verification (delete test order lines, reset any toggled `is_substitutable` flags).
