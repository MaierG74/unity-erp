# Cutlist Tab Rewire Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Point the product Cutlist tab at `product_cutlist_groups` (the same source the Cutlist Builder and Configurator already write to), so parts entered in either tool immediately show up on the tab. Fall back to BOM-derived `cutlist_dimensions` only when no groups exist. Surface a snapshot summary (sheets used, utilization) when the Builder has already calculated a layout.

**Architecture:** The Cutlist Builder's load logic already implements the exact priority we want (groups first, BOM fallback) but it's buried inside `useProductCutlistBuilderAdapter.ts`. Extract that into a shared hook, then rewire `ProductCutlistTab.tsx` to consume it. Add a second hook for the saved `cutlist_costing_snapshot` so the tab can show billable sheets / board % / edge metres. Leave Builder and Configurator write paths untouched.

**Tech Stack:** Next.js App Router, React Query (`@tanstack/react-query`), Supabase (REST via `authorizedFetch`), TypeScript, shadcn/Tailwind v4.

**Verification model (Unity ERP convention):** This repo does not have component-level tests for the product tabs. Per `CLAUDE.md`, verification is `npm run lint` + `npx tsc --noEmit` + browser testing with Chrome DevTools MCP on the dev server. Each task ends with `tsc --noEmit` on the touched paths plus a commit; end-to-end browser verification runs once at the end (Task 8).

**Test product:** "Panel Leg Desk Test" (code `PLTest`). Parts already entered in the Builder: Leg 700×700 ×2, Modesty 1118×350 ×1, Top 1200×550 ×1, all 16mm Alegria, Top has a backer. A costing snapshot may or may not exist — the plan must handle both.

---

## File Structure

**New files:**
- `lib/cutlist/productCutlistLoader.ts` — Pure loader that returns `{ groups, bomItems, source }` for a product. Shared by Builder adapter and Tab.
- `hooks/useProductCutlistData.ts` — React Query wrapper around the loader.
- `hooks/useProductCutlistSnapshot.ts` — React Query wrapper for `/api/products/[productId]/cutlist-costing-snapshot`.
- `lib/cutlist/groupsToCutlistRows.ts` — Transforms `DatabaseCutlistGroup[]` into the tab's `CutlistRow[]` shape (mirrors what the BOM path already produces).

**Modified files:**
- `components/features/products/ProductCutlistTab.tsx` — Swap data source, branch rendering between `source: 'groups'` and `source: 'bom'`, add snapshot stats, fix empty state, fix "Generate Cutlist" enablement.
- `components/features/cutlist/adapters/useProductCutlistBuilderAdapter.ts` — Refactor `load()` to call the shared loader. No behavior change.

**Untouched:** The Builder itself, the Configurator, all `/api/products/[productId]/cutlist-*` routes, the BOM routes.

---

## Type contracts used throughout

Put these in `lib/cutlist/productCutlistLoader.ts` and re-export where needed.

```ts
// lib/cutlist/productCutlistLoader.ts
import { authorizedFetch } from '@/lib/client/auth-fetch';
import { MODULE_KEYS } from '@/lib/modules/keys';

export interface DatabaseCutlistGroup {
  id: number;
  product_id: number;
  name: string;
  board_type: string;                  // e.g. "16mm", "32mm-both", "16mm-backer"
  primary_material_id: number | null;
  primary_material_name: string | null;
  backer_material_id: number | null;
  backer_material_name: string | null;
  parts: Array<{
    id: string;
    name: string;
    length_mm: number;
    width_mm: number;
    quantity: number;
    grain: 'length' | 'width' | 'any';
    band_edges: { top: boolean; right: boolean; bottom: boolean; left: boolean };
    material_label?: string;
    lamination_type?: 'same-board' | 'counter-balance' | 'veneer' | 'with-backer' | 'none' | 'custom';
  }>;
  sort_order: number;
}

export interface EffectiveBomItem {
  bom_id?: number | null;
  component_id: number;
  quantity_required: number;
  _source?: 'direct' | 'link' | 'rpc';
  _sub_product_id?: number | null;
  _editable?: boolean;
  component_description?: string | null;
  is_cutlist_item?: boolean | null;
  cutlist_category?: string | null;
  cutlist_dimensions?: Record<string, unknown> | null;
}

export type CutlistDataSource = 'groups' | 'bom' | 'empty';

export interface ProductCutlistData {
  source: CutlistDataSource;
  groups: DatabaseCutlistGroup[];       // [] when source !== 'groups'
  bomItems: EffectiveBomItem[];         // [] when source !== 'bom'
}
```

---

### Task 1: Create the shared cutlist loader

**Files:**
- Create: `lib/cutlist/productCutlistLoader.ts`

**Why:** The Builder already implements the exact "groups first, BOM fallback" priority we want the tab to have. Extracting this loader gives us one authoritative fetch path.

- [ ] **Step 1: Create the loader file**

Paste the type contracts from the preamble above into the file, then add below them:

```ts
export async function loadProductCutlistData(
  productId: number
): Promise<ProductCutlistData> {
  if (!productId || !Number.isFinite(productId)) {
    return { source: 'empty', groups: [], bomItems: [] };
  }

  const groupsRes = await authorizedFetch(
    `/api/products/${productId}/cutlist-groups?module=${MODULE_KEYS.CUTLIST_OPTIMIZER}`
  );
  if (!groupsRes.ok) {
    throw new Error('Failed to load product cutlist groups');
  }
  const groupsJson = (await groupsRes.json()) as { groups?: DatabaseCutlistGroup[] };
  const groups = Array.isArray(groupsJson?.groups) ? groupsJson.groups : [];

  if (groups.length > 0) {
    return { source: 'groups', groups, bomItems: [] };
  }

  const bomRes = await authorizedFetch(`/api/products/${productId}/effective-bom`);
  if (!bomRes.ok) {
    throw new Error('Failed to load effective BOM');
  }
  const bomJson = (await bomRes.json()) as { items?: EffectiveBomItem[] };
  const bomItems = Array.isArray(bomJson?.items) ? bomJson.items : [];

  const cutlistItems = bomItems.filter((item) => {
    const hasFlag = Boolean(item.is_cutlist_item);
    const hasDims =
      item.cutlist_dimensions && Object.keys(item.cutlist_dimensions).length > 0;
    return hasFlag || hasDims;
  });

  if (cutlistItems.length > 0) {
    return { source: 'bom', groups: [], bomItems };
  }

  return { source: 'empty', groups: [], bomItems: [] };
}
```

Note: we return the **full** `bomItems` (not pre-filtered) when `source === 'bom'` because the tab's existing BOM-based rendering filters them itself using the same predicate. This keeps the tab's current row derivation logic unchanged.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (or only pre-existing unrelated failures — report them as such if found).

- [ ] **Step 3: Commit**

```bash
git add lib/cutlist/productCutlistLoader.ts
git commit -m "feat(cutlist): extract shared productCutlistLoader for groups/bom priority"
```

---

### Task 2: Refactor `useProductCutlistBuilderAdapter` to use the shared loader

**Files:**
- Modify: `components/features/cutlist/adapters/useProductCutlistBuilderAdapter.ts`

**Why:** Prove the new loader is behavior-equivalent before anything else depends on it. Builder's `load()` keeps its existing return shape.

- [ ] **Step 1: Replace `load()` implementation**

Find the `load` callback (lines 27–57 of the file). Replace its body with:

```ts
const load = useCallback(async (): Promise<CutlistCalculatorInitialData | null> => {
  if (!productId || Number.isNaN(productId)) {
    return null;
  }

  const data = await loadProductCutlistData(productId);

  if (data.source === 'groups') {
    return { parts: flattenGroupsToCompactParts(data.groups as never[]) };
  }

  if (data.source === 'bom') {
    const bomSeedRows = effectiveBomItemsToSeedRows(data.bomItems as unknown as Record<string, unknown>[]);
    const parts = effectiveBomRowsToCompactParts(bomSeedRows);
    return parts.length > 0 ? { parts } : null;
  }

  return null;
}, [productId]);
```

Add the import at the top of the file:

```ts
import { loadProductCutlistData } from '@/lib/cutlist/productCutlistLoader';
```

Remove the now-unused local interfaces `ProductCutlistGroupsResponse` and `EffectiveBomResponse` at the top of the file.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Smoke-test the Builder still loads**

Run: `npm run lint`
Expected: clean.

Then open the Cutlist Builder page in a running dev server (the test product is `PLTest`, product page route `/products/<id>/cutlist-builder`) and confirm the 3 parts still load. (Full browser verification is Task 8 — a quick manual reload is enough here.)

- [ ] **Step 4: Commit**

```bash
git add components/features/cutlist/adapters/useProductCutlistBuilderAdapter.ts
git commit -m "refactor(cutlist): use shared productCutlistLoader in builder adapter"
```

---

### Task 3: Add `useProductCutlistData` React Query hook

**Files:**
- Create: `hooks/useProductCutlistData.ts`

**Why:** Give the tab a single cached query that matches what the Builder loads, and let us invalidate both from one key.

- [ ] **Step 1: Create the hook**

```ts
'use client';

import { useQuery } from '@tanstack/react-query';
import {
  loadProductCutlistData,
  type ProductCutlistData,
} from '@/lib/cutlist/productCutlistLoader';

export const productCutlistDataKey = (productId: number) =>
  ['product-cutlist-data', productId] as const;

export function useProductCutlistData(productId: number | null | undefined) {
  return useQuery<ProductCutlistData>({
    queryKey: productCutlistDataKey(productId ?? 0),
    queryFn: () => loadProductCutlistData(productId as number),
    enabled: Boolean(productId && Number.isFinite(productId)),
    retry: 1,
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add hooks/useProductCutlistData.ts
git commit -m "feat(cutlist): add useProductCutlistData hook"
```

---

### Task 4: Add `useProductCutlistSnapshot` hook

**Files:**
- Create: `hooks/useProductCutlistSnapshot.ts`

**Why:** The Cutlist Builder already saves a full layout snapshot (`product_cutlist_costing_snapshots`). The tab can show sheets-used / board-utilization / edging metres without recomputing.

- [ ] **Step 1: Create the hook**

```ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import { MODULE_KEYS } from '@/lib/modules/keys';
import type { CutlistCostingSnapshot } from '@/lib/cutlist/costingSnapshot';

export const productCutlistSnapshotKey = (productId: number) =>
  ['product-cutlist-snapshot', productId] as const;

export function useProductCutlistSnapshot(productId: number | null | undefined) {
  return useQuery<CutlistCostingSnapshot | null>({
    queryKey: productCutlistSnapshotKey(productId ?? 0),
    queryFn: async () => {
      const res = await authorizedFetch(
        `/api/products/${productId}/cutlist-costing-snapshot?module=${MODULE_KEYS.CUTLIST_OPTIMIZER}`
      );
      if (!res.ok) return null;
      const json = (await res.json()) as {
        snapshot: { snapshot_data: CutlistCostingSnapshot } | null;
      };
      return json.snapshot?.snapshot_data ?? null;
    },
    enabled: Boolean(productId && Number.isFinite(productId)),
    retry: 1,
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add hooks/useProductCutlistSnapshot.ts
git commit -m "feat(cutlist): add useProductCutlistSnapshot hook"
```

---

### Task 5: Add `groupsToCutlistRows` transform

**Files:**
- Create: `lib/cutlist/groupsToCutlistRows.ts`

**Why:** The tab currently renders `CutlistRow[]` derived from BOM items. To re-use the same table UI for group-sourced data, we need a transform from groups → `CutlistRow[]`. Keeping the row shape identical means the table rendering code does not branch.

**Row shape reference** (from `ProductCutlistTab.tsx` lines 91–104 — keep this shape exactly):

```ts
interface CutlistRow {
  key: string;
  bomId: number | null;                   // null for group-sourced rows
  componentId: number;                    // -1 for group-sourced rows (no component)
  componentCode: string;                  // the part's `name` ("Leg", "Top", etc.)
  componentDescription: string | null;    // the group label ("16mm Alegria", etc.)
  source: 'direct' | 'link' | 'rpc';      // always 'direct' for group-sourced rows
  isEditable: boolean;                    // false for group-sourced rows — edit in Builder
  category: string | null;                // group.board_type (e.g. "16mm")
  dimensions: CutlistDimensions | null;   // synthesised so the existing summary helper renders
  quantityRequired: number;               // part.quantity
  quantityPer: number;                    // 1
  totalParts: number;                     // part.quantity
}
```

- [ ] **Step 1: Create the transform**

```ts
import type { DatabaseCutlistGroup } from '@/lib/cutlist/productCutlistLoader';
import type { CutlistDimensions } from '@/lib/cutlist/cutlistDimensions';

export interface GroupCutlistRow {
  key: string;
  bomId: number | null;
  componentId: number;
  componentCode: string;
  componentDescription: string | null;
  source: 'direct' | 'link' | 'rpc';
  isEditable: boolean;
  category: string | null;
  dimensions: CutlistDimensions | null;
  quantityRequired: number;
  quantityPer: number;
  totalParts: number;
}

export function groupsToCutlistRows(
  groups: DatabaseCutlistGroup[]
): GroupCutlistRow[] {
  const rows: GroupCutlistRow[] = [];

  for (const group of groups) {
    const materialLabel =
      group.primary_material_name?.trim() || group.name?.trim() || 'Unassigned';
    const materialCode = group.primary_material_id
      ? String(group.primary_material_id)
      : null;

    for (const part of group.parts ?? []) {
      const length = Number(part.length_mm) || 0;
      const width = Number(part.width_mm) || 0;
      const qty = Number(part.quantity) || 0;

      const dimensions: CutlistDimensions = {
        length_mm: length,
        width_mm: width,
        quantity_per: 1,
        material_code: materialCode ?? undefined,
        material_label: materialLabel,
        colour_family: materialLabel,
        grain: part.grain,
        notes: part.name,
      } as CutlistDimensions;

      rows.push({
        key: `group:${group.id}:${part.id}`,
        bomId: null,
        componentId: -1,
        componentCode: part.name || 'Part',
        componentDescription: materialLabel,
        source: 'direct',
        isEditable: false,
        category: group.board_type ?? null,
        dimensions,
        quantityRequired: qty,
        quantityPer: 1,
        totalParts: qty,
      });
    }
  }

  return rows;
}
```

**Note on `CutlistDimensions`:** It's defined in `lib/cutlist/cutlistDimensions.ts`. The fields used above (`length_mm`, `width_mm`, `quantity_per`, `material_code`, `material_label`, `colour_family`, `grain`, `notes`) are the ones the tab's `summariseCutlistDimensions` helper reads. If TypeScript rejects any field, open `cutlistDimensions.ts` and adjust to the actual property name — do not invent new fields.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. If the `CutlistDimensions` cast fails, inspect `lib/cutlist/cutlistDimensions.ts` and remove any field the interface doesn't declare rather than forcing a cast.

- [ ] **Step 3: Commit**

```bash
git add lib/cutlist/groupsToCutlistRows.ts
git commit -m "feat(cutlist): add groupsToCutlistRows transform for tab rendering"
```

---

### Task 6: Rewire `ProductCutlistTab` to the new data source

**Files:**
- Modify: `components/features/products/ProductCutlistTab.tsx`

This is the biggest task. Split it into focused steps.

- [ ] **Step 1: Add the new imports**

At the top of the file, add:

```ts
import { useProductCutlistData } from '@/hooks/useProductCutlistData';
import { useProductCutlistSnapshot } from '@/hooks/useProductCutlistSnapshot';
import { groupsToCutlistRows } from '@/lib/cutlist/groupsToCutlistRows';
import type { CutlistDataSource } from '@/lib/cutlist/productCutlistLoader';
```

- [ ] **Step 2: Replace the `effectiveBom` query with `useProductCutlistData`**

Remove the existing `useQuery<EffectiveBomResponse>({ queryKey: ['cutlist-effective-bom', ... }, ... })` block (currently lines 117–133).

Replace with:

```ts
const {
  data: cutlistData,
  isLoading: cutlistLoading,
  isRefetching: cutlistRefetching,
  error: cutlistError,
  refetch: refetchCutlist,
} = useProductCutlistData(productId);

const {
  data: snapshot,
} = useProductCutlistSnapshot(productId);

const dataSource: CutlistDataSource = cutlistData?.source ?? 'empty';
```

Also update all downstream references that used the old `effectiveBom`/`bomLoading`/etc. variables — they should use `cutlistData`, `cutlistLoading`, `cutlistRefetching`, `cutlistError`, `refetchCutlist` instead.

- [ ] **Step 3: Branch `allCutlistRows` derivation**

Replace the `allCutlistRows` `useMemo` (currently lines 176–205) with:

```ts
const allCutlistRows: CutlistRow[] = useMemo(() => {
  if (dataSource === 'groups') {
    return groupsToCutlistRows(cutlistData?.groups ?? []);
  }

  if (dataSource === 'bom') {
    const items = cutlistData?.bomItems ?? [];
    return items
      .filter((item) => {
        const hasCutlistFlag = Boolean(item.is_cutlist_item);
        const hasDimensions =
          item.cutlist_dimensions && Object.keys(item.cutlist_dimensions).length > 0;
        return hasCutlistFlag || hasDimensions;
      })
      .map((item, index) => {
        const component = componentById.get(item.component_id);
        const dimensions = cloneCutlistDimensions(item.cutlist_dimensions) ?? null;
        const quantityRequired = Number(item.quantity_required ?? 0) || 0;
        const quantityPer = Number(dimensions?.quantity_per ?? 1) || 1;
        const totalParts = quantityRequired * quantityPer;
        return {
          key: item.bom_id ? `bom:${item.bom_id}` : `computed:${item.component_id}:${index}`,
          bomId: item.bom_id ?? null,
          componentId: item.component_id,
          componentCode: component?.internal_code ?? `Component #${item.component_id}`,
          componentDescription: item.component_description ?? component?.description ?? null,
          source: item._source ?? 'direct',
          isEditable: Boolean(item._editable) && Boolean(item.bom_id),
          category: item.cutlist_category ?? null,
          dimensions,
          quantityRequired,
          quantityPer,
          totalParts,
        };
      });
  }

  return [];
}, [dataSource, cutlistData, componentById]);
```

**Note:** The `EffectiveBomItem` interface at the top of the file (lines 63–76) is now only referenced by the BOM branch. Keep it, but import the shared `EffectiveBomItem` type from `@/lib/cutlist/productCutlistLoader` instead, and delete the local duplicate. Adjust the field names if they diverge — only add fields, do not remove what the BOM branch needs.

- [ ] **Step 4: Update overview stats**

Replace the "Total parts / Direct rows / Linked rows" stat block (currently ~lines 379–391) with:

```tsx
<div className="rounded-md border bg-muted/40 px-3 py-2">
  <div className="text-xs text-muted-foreground">Total parts</div>
  <div className="text-sm font-semibold text-foreground">{totalParts}</div>
</div>
{dataSource === 'groups' ? (
  <div className="rounded-md border bg-muted/40 px-3 py-2">
    <div className="text-xs text-muted-foreground">Groups</div>
    <div className="text-sm font-semibold text-foreground">
      {cutlistData?.groups.length ?? 0}
    </div>
  </div>
) : (
  <>
    <div className="rounded-md border bg-muted/40 px-3 py-2">
      <div className="text-xs text-muted-foreground">Direct rows</div>
      <div className="text-sm font-semibold text-foreground">{directCount}</div>
    </div>
    <div className="rounded-md border bg-muted/40 px-3 py-2">
      <div className="text-xs text-muted-foreground">Linked rows</div>
      <div className="text-sm font-semibold text-foreground">{linkedCount}</div>
    </div>
  </>
)}
{snapshot ? (
  <>
    <div className="rounded-md border bg-muted/40 px-3 py-2">
      <div className="text-xs text-muted-foreground">Sheets used</div>
      <div className="text-sm font-semibold text-foreground">
        {snapshotSheetsUsed(snapshot)}
      </div>
    </div>
    <div className="rounded-md border bg-muted/40 px-3 py-2">
      <div className="text-xs text-muted-foreground">Board used %</div>
      <div className="text-sm font-semibold text-foreground">
        {snapshotBoardUsedPct(snapshot)}
      </div>
    </div>
  </>
) : null}
```

Add these helpers above the component:

```ts
import type { CutlistCostingSnapshot } from '@/lib/cutlist/costingSnapshot';

function snapshotSheetsUsed(s: CutlistCostingSnapshot): string {
  const used = s.primary_layout?.sheets?.length ?? 0;
  const backer = s.backer_layout?.sheets?.length ?? 0;
  return backer > 0 ? `${used} + ${backer} backer` : String(used);
}

function snapshotBoardUsedPct(s: CutlistCostingSnapshot): string {
  const used = s.stats?.total_used_area_mm2 ?? 0;
  const total = used + (s.stats?.total_waste_area_mm2 ?? 0);
  if (total <= 0) return '—';
  return `${((used / total) * 100).toFixed(1)}%`;
}
```

**Note:** If `LayoutResult.sheets` has a different property (e.g. `layouts`, `pages`), open `lib/cutlist/types.ts` and use the real property name. Do not guess — the whole point of reading the snapshot is exact numbers.

- [ ] **Step 5: Hide the "Show linked parts" switch when `dataSource === 'groups'`**

The switch only makes sense for BOM-sourced data (groups have no concept of linked sub-products in this tab). Wrap the existing `<Switch>` + its `<Label>` in:

```tsx
{dataSource === 'bom' ? (
  /* existing Switch + Label */
) : null}
```

- [ ] **Step 6: Fix "Generate Cutlist" button enablement and label**

Replace the existing button (lines 403–409) with:

```tsx
<Button
  onClick={() => router.push(`/products/${productId}/cutlist-builder`)}
  disabled={isBusy}
>
  <Calculator className="h-4 w-4 mr-2" />
  {dataSource === 'empty' ? 'Open Cutlist Builder' : 'Open in Cutlist Builder'}
</Button>
```

The `disabled={allCutlistRows.length === 0}` check was the root cause of the bug the user reported — it's unconditional now. The button always routes to the Builder, which knows how to handle empty-state too.

- [ ] **Step 7: Disable Assign / Delete actions for group-sourced rows**

In the actions cell, the current code already gates `Assign` and `Delete` on `row.isEditable`. Because Task 5 sets `isEditable: false` for all group-sourced rows, the buttons will auto-disable with the existing "Linked BOM rows are read-only here" message. Update that copy to be accurate for both paths:

Change (currently ~lines 640–644):

```tsx
{!row.isEditable ? (
  <div className="mt-2 text-[11px] text-muted-foreground">
    Linked BOM rows are read-only here. Edit the source product instead.
  </div>
) : null}
```

to:

```tsx
{!row.isEditable ? (
  <div className="mt-2 text-[11px] text-muted-foreground">
    {dataSource === 'groups'
      ? 'Group-sourced parts are edited in the Cutlist Builder.'
      : 'Linked BOM rows are read-only here. Edit the source product instead.'}
  </div>
) : null}
```

- [ ] **Step 8: Empty-state copy update**

Replace the "No cutlist rows captured yet" block (~line 471) with:

```tsx
{!isBusy && groupedByMaterial.length === 0 ? (
  <p className="text-sm text-muted-foreground">
    No cutlist parts yet. Open the Cutlist Builder to enter parts manually, or use
    &ldquo;Design with Configurator&rdquo; for parametric products. You can also seed parts
    by filling <span className="font-medium">Cutlist dimensions</span> on Bill of Materials rows.
  </p>
) : null}
```

- [ ] **Step 9: Invalidate both query keys after BOM edits**

The existing `updateMaterialMutation.onSuccess` and `deleteRowMutation.onSuccess` invalidate `['cutlist-effective-bom', productId]`. Since that key no longer drives the tab, add the new key:

```ts
queryClient.invalidateQueries({ queryKey: productCutlistDataKey(productId) });
```

Import it at the top:

```ts
import { productCutlistDataKey } from '@/hooks/useProductCutlistData';
```

Keep the old `['cutlist-effective-bom', productId]` invalidation too — other consumers may still rely on it.

- [ ] **Step 10: Lint and typecheck**

```bash
npm run lint
npx tsc --noEmit
```

Expected: clean on the modified paths.

- [ ] **Step 11: Commit**

```bash
git add components/features/products/ProductCutlistTab.tsx
git commit -m "feat(cutlist): rewire product Cutlist tab to read from product_cutlist_groups"
```

---

### Task 7: `/simplify` the changed surface

**Files:**
- All files touched in Tasks 1–6.

- [ ] **Step 1: Run /simplify on the tab**

This project's `CLAUDE.md` requires `/simplify` on PRs touching more than 3 files. We've touched 5.

Run the `/simplify` slash command and address any callouts inline. Commit each cleanup as its own small commit.

---

### Task 8: End-to-end browser verification

**Files:** none (verification only).

The test account is in `CLAUDE.md`:
- Email: `testai@qbutton.co.za` / Password: `ClaudeTest2026!`
- Test product: "Panel Leg Desk Test" (`PLTest`).

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

Wait for "Ready on http://localhost:3000".

- [ ] **Step 2: Verify the bug fix (group-sourced path)**

Using Chrome DevTools MCP:

1. Navigate to `http://localhost:3000`, log in as the test account.
2. Navigate to the `PLTest` product detail page and click the **Cutlist** tab.
3. Confirm "Total parts" shows `4` (Leg ×2 + Modesty ×1 + Top ×1).
4. Confirm "Groups" card is visible and shows `≥ 1`.
5. Confirm the **Parts by material** table lists Leg 700×700, Modesty 1118×350, Top 1200×550 grouped under a 16mm Alegria header.
6. Confirm **Generate Cutlist** is enabled and its label reads `Open in Cutlist Builder`.
7. Confirm the Assign/Delete buttons in each row are disabled with the "Group-sourced parts are edited in the Cutlist Builder" message visible.

- [ ] **Step 3: Verify the BOM fallback path**

Pick any product that has `billofmaterials` rows with `cutlist_dimensions` set but **no** `product_cutlist_groups` (ask the user for one if you cannot find one quickly). Confirm the tab still renders those rows, the Direct/Linked stats appear, and Assign/Delete still work.

If you cannot find such a product, state that explicitly rather than claiming this path is verified. Do not create test data on the live database just to exercise the path.

- [ ] **Step 4: Verify the empty state**

Pick or create a product with no groups and no BOM cutlist rows. Confirm:
- Tab shows "No cutlist parts yet…" message.
- "Generate Cutlist" is still enabled and routes to the Builder (it should handle empty input too).

If test data is modified for this check, revert it before finishing (per the `feedback_restore_test_data` convention in memory).

- [ ] **Step 5: Verify the snapshot stats (if a snapshot exists)**

If the `PLTest` product has a saved `cutlist_costing_snapshot` (the Builder saves one after clicking Calculate Layout), confirm the tab now shows "Sheets used" and "Board used %" stat cards matching the Builder's Preview tab numbers (0.407 / 40.7% in the user's screenshot).

If no snapshot exists, go into the Builder, click **Calculate Layout**, click **Save**, then come back to the tab and confirm the stats appear.

- [ ] **Step 6: Run the final checks**

```bash
npm run lint
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 7: Final commit if any simplify follow-ups were made**

```bash
git status
# If anything uncommitted, commit it.
```

---

## Out of scope (deliberately)

- Writing group-sourced part edits from the tab. Editing stays in the Builder — the tab is a read-only overview for group-sourced data.
- Showing the cutting-diagram thumbnail on the tab. Numeric snapshot stats are enough for this pass; a thumbnail is an obvious follow-up.
- Backfilling BOM `cutlist_dimensions` from groups (or vice-versa). Those are different data models for different purposes; do not cross-populate.
- Touching the Configurator or Builder UIs.

## Risks and mitigations

- **Risk:** Some product's `CutlistDimensions` type does not include `notes` or `grain` fields used in `groupsToCutlistRows`. **Mitigation:** Task 5 Step 2 explicitly tells the engineer to adjust to the real interface.
- **Risk:** `LayoutResult.sheets` property name differs from `SnapshotSheet[]` wrapper. **Mitigation:** Task 6 Step 4 flags this — inspect `lib/cutlist/types.ts` before committing the snapshot helpers.
- **Risk:** Existing consumers of the old query key `['cutlist-effective-bom', productId]` break. **Mitigation:** Task 6 Step 9 keeps the old invalidation call alongside the new one.
