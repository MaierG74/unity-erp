# Order-Level Material Assignment — Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users assign specific board components (e.g., "Brookhill Oak 16mm") to cutlist parts on an order before generating the cutting plan, bridging abstract board types to real inventory component IDs.

**Architecture:** New `material_assignments` JSONB column on `orders` persists per-part material choices independently of the cutting plan lifecycle. A collapsible grid on the Cutting Plan tab shows all parts grouped by board thickness — each part-role row has a searchable combobox to pick a board component. Material picking is compulsory: Generate is blocked until every role has a material assigned. On generate, parts are re-grouped by their assigned materials (not snapshot defaults) before packing.

**Tech Stack:** Next.js API routes, Supabase (migration + queries), TanStack Query, shadcn Popover+Command combobox, existing `parseSheetThickness` utility from `lib/cutlist/boardCalculator.ts`.

---

## Codex Review Fixes (v1 → v2)

| Finding | Severity | Fix |
|---------|----------|-----|
| `board_type\|part_name` key too coarse — "Left Side" collides across products with different dimensions | P0 | Assignment key is now `board_type\|part_name\|length_mm\|width_mm` (role fingerprint). Same-name parts with different dimensions are distinct roles. |
| Assignment edits don't stale the cutting plan — purchasing uses stale overrides | P0 | PATCH endpoint calls `markCuttingPlanStale()` on every save. |
| Generate path writes zero backers, zero edging, and assumes one stock sheet | P0 | Generate resolves stock sheets per assigned component (from `suppliercomponents`), computes backer sheets for `-backer` groups, and sums edging per material. |
| Assignment grid disappears after plan exists | P1 | Grid is a collapsible section in ALL states (empty, stale, fresh), not just empty. |
| PATCH validation too weak, autosave doesn't check `res.ok` | P1 | Schema-validate each assignment entry. Auto-save checks response, shows toast on failure, and flushes pending saves before generate. |
| Backer handling too coarse — hardcoded `boardType="6mm"` | P1 | Backer combobox shows MDF + Plywood categories (3, 14) without thickness filtering. Snapshot backer is preserved as default; explicit override replaces it. |
| Duplicated thickness parser | P1 | Extract shared `parseThicknessFromDescription()` into `lib/cutlist/boardCalculator.ts` and import everywhere. |
| Bulk assign can cross board types | P1 | Restrict checkbox selection to one board_type at a time. |
| Cached aggregate reuse in generate | P1 | `handleGenerate` always re-fetches aggregate. |
| Inline state complexity | P2 | Extract `useCuttingPlanBuilder(orderId)` orchestration hook. |
| Extra "Load Parts" click | P2 | Auto-load aggregate on tab mount with skeleton. |

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `supabase/migrations/20260401100000_material_assignments.sql` | Add `material_assignments` JSONB column to `orders` |
| `lib/orders/material-assignment-types.ts` | TypeScript types + pure helpers for material assignments |
| `app/api/orders/[orderId]/material-assignments/route.ts` | GET + PATCH endpoint (validates, saves, stales cutting plan) |
| `hooks/useMaterialAssignments.ts` | TanStack Query hook — load, save, debounced auto-save with error handling |
| `hooks/useBoardComponents.ts` | Query board-category components, filter by parsed thickness |
| `hooks/useCuttingPlanBuilder.ts` | Orchestration hook — combines aggregate, assignments, roles, generate, confirm |
| `components/features/orders/BoardMaterialCombobox.tsx` | Searchable combobox for picking a board component |
| `components/features/orders/MaterialAssignmentGrid.tsx` | Collapsible parts grid with material assignment per part role |
| `lib/orders/material-regroup.ts` | `regroupByAssignedMaterial()` + stock sheet resolution (client-safe, no `crypto`) |

### Modified Files

| File | Change |
|------|--------|
| `components/features/orders/CuttingPlanTab.tsx` | Replace inline state with `useCuttingPlanBuilder`; render grid in all states; block generate when incomplete |
| `lib/cutlist/boardCalculator.ts` | Export shared `parseThicknessFromDescription()` |
| `lib/orders/cutting-plan-utils.ts` | No change (stale-marking already handled server-side via PATCH endpoint) |

---

## Concepts

### Role Fingerprint as Assignment Key

Parts have a `name` field from the configurator (e.g., "Door Panel", "Left Side"). Generic names like "Left Side" can appear in both cupboards and pedestals with different dimensions. Using `board_type|part_name` alone would force them onto the same material.

**Assignment key:** `${board_type}|${part_name}|${length_mm}|${width_mm}`

This fingerprint uniquely identifies a physical part role. Parts with the same name AND dimensions (across products) share a material — which is the desired behavior when two products use the same-sized shelf. Parts with the same name but different dimensions are distinct roles.

The `PartRole` type represents one row in the grid. It aggregates quantities across all order lines where the fingerprint matches.

### Stale-on-Assignment-Change

The PATCH endpoint for `material_assignments` calls `markCuttingPlanStale()` after saving. This ensures:
- If a confirmed cutting plan exists, it's marked stale so purchasing reverts to BOM quantities
- The user sees the stale banner and knows to re-generate
- `source_revision` doesn't need to include assignments — staleness is sufficient

### Backer Handling

Backer boards use a different pattern than primary boards:
- Snapshot groups with `-backer` board types already carry `backer_material_id` from the product configurator
- The UI pre-fills the backer default from the first snapshot backer found
- Users can override to a different backer
- The backer combobox shows MDF (cat 3) + Plywood (cat 14) categories without thickness filtering (backers vary: 3mm Supawood, 6mm MDF, etc.)
- A `-backer` group without a resolved backer blocks generation

### Stock Sheet Resolution

The current generate path hardcodes a single `DEFAULT_STOCK` (2750×1830mm). With material assignment, each assigned component may have a different stock sheet size from `suppliercomponents`. The generate flow queries stock sheet dimensions per component, falling back to 2750×1830mm when no supplier data exists.

### Thickness Parsing (Shared Utility)

`ComponentPickerDialog.tsx` already parses thickness from component descriptions. The plan extracts this into `parseThicknessFromDescription()` in `lib/cutlist/boardCalculator.ts` — a single shared utility. The meter-normalization (values < 10 → multiply by 1000) applies only to length/width, never thickness.

---

## Tasks

### Task 1: Migration — `material_assignments` Column

**Files:**
- Create: `supabase/migrations/20260401100000_material_assignments.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Add material_assignments JSONB column to orders.
-- Stores per-part-role board component selections for the cutting plan.
-- Persists independently of cutting_plan (survives plan clear/regeneration).
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS material_assignments jsonb;

COMMENT ON COLUMN orders.material_assignments IS
  'Per-part-role board component assignments for cutting plan generation. '
  'Keyed by board_type|part_name|length|width fingerprint. NULL = no assignments.';
```

- [ ] **Step 2: Apply the migration**

Run: `mcp__supabase__apply_migration` with the SQL above and name `material_assignments`.

- [ ] **Step 3: Verify the column exists**

Run:
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'orders' AND column_name = 'material_assignments';
```

Expected: One row with `data_type = 'jsonb'`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260401100000_material_assignments.sql
git commit -m "feat: add material_assignments JSONB column to orders"
```

---

### Task 2: Shared Thickness Parser

**Files:**
- Modify: `lib/cutlist/boardCalculator.ts`

Extract the thickness parsing logic from `ComponentPickerDialog.tsx` into a shared utility.

- [ ] **Step 1: Read `ComponentPickerDialog.tsx`**

Read the file to find the existing thickness parsing function (around line 92 per Codex review).

- [ ] **Step 2: Add shared parser to `boardCalculator.ts`**

Append to `lib/cutlist/boardCalculator.ts`:

```typescript
/**
 * Parse thickness in mm from a component description string.
 * Handles: "2750x1830x16", "16mm White Melamine", "2.750x1.830x16".
 * Returns null if no thickness found.
 *
 * NOTE: Meter-normalization (values < 10 → ×1000) applies only to
 * length/width dimensions, NEVER to thickness. A 0.6mm laminate stays 0.6.
 */
export function parseThicknessFromDescription(desc: string): number | null {
  // Full dimensions: LxWxT
  const dimMatch = desc.match(
    /(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i,
  );
  if (dimMatch) {
    return parseFloat(dimMatch[3]); // Thickness is always the third value, never meter-normalize
  }
  // "Nmm" pattern (e.g., "16mm White Melamine")
  const mmMatch = desc.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*mm/i);
  if (mmMatch) {
    return parseFloat(mmMatch[1]);
  }
  return null;
}
```

- [ ] **Step 3: Update `ComponentPickerDialog.tsx` to import the shared parser**

Replace the inline thickness parsing in `ComponentPickerDialog.tsx` with an import of `parseThicknessFromDescription` from `@/lib/cutlist/boardCalculator`. Keep the length/width parsing (with meter-normalization) inline since those have different rules.

- [ ] **Step 4: Run lint + verify no regressions**

```bash
npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add lib/cutlist/boardCalculator.ts components/features/cutlist/ComponentPickerDialog.tsx
git commit -m "refactor: extract shared parseThicknessFromDescription into boardCalculator"
```

---

### Task 3: Types — Material Assignment

**Files:**
- Create: `lib/orders/material-assignment-types.ts`

- [ ] **Step 1: Define the types**

```typescript
/**
 * Role fingerprint: board_type|part_name|length_mm|width_mm
 * Uniquely identifies a physical part role. Same-name parts with different
 * dimensions (e.g., "Left Side" in cupboard vs pedestal) are distinct roles.
 */
export function roleFingerprint(
  boardType: string,
  partName: string,
  lengthMm: number,
  widthMm: number,
): string {
  return `${boardType}|${partName}|${lengthMm}|${widthMm}`;
}

/**
 * A single material assignment: maps a part role to a board component.
 */
export type MaterialAssignment = {
  board_type: string;
  part_name: string;
  length_mm: number;
  width_mm: number;
  component_id: number;
  component_name: string;
};

/**
 * Backer material default — applies to all parts with -backer board types.
 */
export type BackerDefault = {
  component_id: number;
  component_name: string;
};

/**
 * Persisted JSONB shape on orders.material_assignments.
 */
export type MaterialAssignments = {
  version: 1;
  assignments: MaterialAssignment[];
  backer_default: BackerDefault | null;
};

/**
 * Unique part role within a board type — one row in the assignment grid.
 * Aggregates quantities across all order lines where the fingerprint matches.
 */
export type PartRole = {
  board_type: string;
  part_name: string;
  length_mm: number;
  width_mm: number;
  /** Total quantity across all order lines */
  total_quantity: number;
  /** Product names that contain this part */
  product_names: string[];
  /** Current assignment (null if unassigned) */
  assigned_component_id: number | null;
  assigned_component_name: string | null;
};

/**
 * Look up an assignment by role fingerprint.
 */
export function findAssignment(
  assignments: MaterialAssignment[],
  boardType: string,
  partName: string,
  lengthMm: number,
  widthMm: number,
): MaterialAssignment | undefined {
  return assignments.find(
    (a) =>
      a.board_type === boardType &&
      a.part_name === partName &&
      a.length_mm === lengthMm &&
      a.width_mm === widthMm,
  );
}

/**
 * Set or update an assignment. Returns a new array (immutable).
 */
export function upsertAssignment(
  assignments: MaterialAssignment[],
  assignment: MaterialAssignment,
): MaterialAssignment[] {
  const idx = assignments.findIndex(
    (a) =>
      a.board_type === assignment.board_type &&
      a.part_name === assignment.part_name &&
      a.length_mm === assignment.length_mm &&
      a.width_mm === assignment.width_mm,
  );
  if (idx >= 0) {
    const next = [...assignments];
    next[idx] = assignment;
    return next;
  }
  return [...assignments, assignment];
}

/**
 * Bulk-set the same material for multiple part roles. Returns a new array.
 */
export function bulkAssign(
  assignments: MaterialAssignment[],
  roles: Array<{ board_type: string; part_name: string; length_mm: number; width_mm: number }>,
  componentId: number,
  componentName: string,
): MaterialAssignment[] {
  let result = [...assignments];
  for (const role of roles) {
    result = upsertAssignment(result, {
      board_type: role.board_type,
      part_name: role.part_name,
      length_mm: role.length_mm,
      width_mm: role.width_mm,
      component_id: componentId,
      component_name: componentName,
    });
  }
  return result;
}

/**
 * Validate a MaterialAssignments object. Returns error message or null.
 */
export function validateAssignments(data: unknown): string | null {
  if (!data || typeof data !== 'object') return 'Invalid data';
  const obj = data as Record<string, unknown>;
  if (obj.version !== 1) return 'Invalid version';
  if (!Array.isArray(obj.assignments)) return 'assignments must be an array';
  for (const a of obj.assignments) {
    if (typeof a !== 'object' || !a) return 'Invalid assignment entry';
    const entry = a as Record<string, unknown>;
    if (typeof entry.board_type !== 'string' || !entry.board_type) return 'board_type required';
    if (typeof entry.part_name !== 'string' || !entry.part_name) return 'part_name required';
    if (typeof entry.length_mm !== 'number' || entry.length_mm <= 0) return 'length_mm must be positive';
    if (typeof entry.width_mm !== 'number' || entry.width_mm <= 0) return 'width_mm must be positive';
    if (typeof entry.component_id !== 'number' || entry.component_id <= 0) return 'component_id must be positive';
    if (typeof entry.component_name !== 'string' || !entry.component_name) return 'component_name required';
  }
  if (obj.backer_default != null) {
    const bd = obj.backer_default as Record<string, unknown>;
    if (typeof bd.component_id !== 'number' || bd.component_id <= 0) return 'backer component_id invalid';
    if (typeof bd.component_name !== 'string' || !bd.component_name) return 'backer component_name invalid';
  }
  // Check for duplicate fingerprints
  const seen = new Set<string>();
  for (const a of obj.assignments as MaterialAssignment[]) {
    const fp = roleFingerprint(a.board_type, a.part_name, a.length_mm, a.width_mm);
    if (seen.has(fp)) return `Duplicate assignment for ${fp}`;
    seen.add(fp);
  }
  return null;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/orders/material-assignment-types.ts
git commit -m "feat: add material assignment types with role fingerprint and validation"
```

---

### Task 4: API — Material Assignments Endpoint

**Files:**
- Create: `app/api/orders/[orderId]/material-assignments/route.ts`

- [ ] **Step 1: Write the GET + PATCH endpoint**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getRouteClient } from '@/lib/supabase-route';
import { validateAssignments } from '@/lib/orders/material-assignment-types';
import { markCuttingPlanStale } from '@/lib/orders/cutting-plan-utils';

type RouteParams = { orderId: string };

export async function GET(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await getRouteClient(request);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { orderId } = await context.params;
  const orderIdNum = Number(orderId);
  if (!Number.isFinite(orderIdNum) || orderIdNum <= 0) {
    return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from('orders')
    .select('material_assignments')
    .eq('order_id', orderIdNum)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data?.material_assignments ?? null);
}

export async function PATCH(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await getRouteClient(request);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { orderId } = await context.params;
  const orderIdNum = Number(orderId);
  if (!Number.isFinite(orderIdNum) || orderIdNum <= 0) {
    return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Schema validation
  const validationError = validateAssignments(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const { error } = await auth.supabase
    .from('orders')
    .update({ material_assignments: body })
    .eq('order_id', orderIdNum);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Mark cutting plan stale so purchasing doesn't use outdated overrides
  await markCuttingPlanStale(orderIdNum, auth.supabase);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/orders/[orderId]/material-assignments/route.ts
git commit -m "feat: add validated GET/PATCH endpoint for material assignments with stale marking"
```

---

### Task 5: Hook — `useBoardComponents`

**Files:**
- Create: `hooks/useBoardComponents.ts`

Fetches board-category components and filters by parsed thickness.

- [ ] **Step 1: Write the hook**

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { parseThicknessFromDescription, parseSheetThickness } from '@/lib/cutlist/boardCalculator';

/** Board-category IDs (primary boards) */
const PRIMARY_BOARD_CATEGORY_IDS = [75, 3, 14]; // Melamine, MDF, Plywood
/** Backer-category IDs (typically MDF, Plywood — thinner sheets) */
const BACKER_CATEGORY_IDS = [3, 14]; // MDF, Plywood

export type BoardComponent = {
  component_id: number;
  internal_code: string;
  description: string;
  parsed_thickness_mm: number | null;
};

/**
 * Fetch all active board components. Cached globally — boards don't change often.
 */
export function useBoardComponents() {
  return useQuery({
    queryKey: ['board-components'],
    queryFn: async (): Promise<BoardComponent[]> => {
      const { data, error } = await supabase
        .from('components')
        .select('component_id, internal_code, description')
        .in('category_id', PRIMARY_BOARD_CATEGORY_IDS)
        .eq('is_active', true)
        .order('internal_code');

      if (error) throw new Error(error.message);

      return (data ?? []).map((c) => ({
        component_id: c.component_id,
        internal_code: c.internal_code ?? '',
        description: c.description ?? '',
        parsed_thickness_mm: parseThicknessFromDescription(c.description ?? ''),
      }));
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch backer board components (MDF, Plywood). No thickness filtering —
 * backers vary widely (3mm, 6mm, 9mm) and users should see all options.
 */
export function useBackerComponents() {
  return useQuery({
    queryKey: ['backer-components'],
    queryFn: async (): Promise<BoardComponent[]> => {
      const { data, error } = await supabase
        .from('components')
        .select('component_id, internal_code, description')
        .in('category_id', BACKER_CATEGORY_IDS)
        .eq('is_active', true)
        .order('internal_code');

      if (error) throw new Error(error.message);

      return (data ?? []).map((c) => ({
        component_id: c.component_id,
        internal_code: c.internal_code ?? '',
        description: c.description ?? '',
        parsed_thickness_mm: parseThicknessFromDescription(c.description ?? ''),
      }));
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Filter board components to those matching a board_type's sheet thickness.
 * "16mm" → 16, "32mm-both" → 16 (half), "32mm-backer" → 16 (half).
 */
export function filterByBoardType(
  boards: BoardComponent[],
  boardType: string,
): BoardComponent[] {
  const targetThickness = parseSheetThickness(boardType);
  return boards.filter((b) => b.parsed_thickness_mm === targetThickness);
}
```

- [ ] **Step 2: Commit**

```bash
git add hooks/useBoardComponents.ts
git commit -m "feat: add useBoardComponents and useBackerComponents hooks"
```

---

### Task 6: Hook — `useMaterialAssignments`

**Files:**
- Create: `hooks/useMaterialAssignments.ts`

Load and save material assignments with debounced auto-save. Derives `PartRole[]` from aggregate data. Auto-save checks `res.ok` and toasts on failure.

- [ ] **Step 1: Write the hook**

```typescript
'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import { toast } from 'sonner';
import type { AggregateResponse } from '@/lib/orders/cutting-plan-types';
import type {
  MaterialAssignments,
  MaterialAssignment,
  BackerDefault,
  PartRole,
} from '@/lib/orders/material-assignment-types';
import {
  findAssignment,
  upsertAssignment,
  bulkAssign,
  roleFingerprint,
} from '@/lib/orders/material-assignment-types';

const EMPTY: MaterialAssignments = { version: 1, assignments: [], backer_default: null };
const DEBOUNCE_MS = 800;

export function useMaterialAssignments(orderId: number) {
  const queryClient = useQueryClient();
  const [localAssignments, setLocalAssignments] = useState<MaterialAssignments | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<Promise<void> | null>(null);

  const query = useQuery({
    queryKey: ['material-assignments', orderId],
    queryFn: async (): Promise<MaterialAssignments | null> => {
      const res = await authorizedFetch(`/api/orders/${orderId}/material-assignments`);
      if (!res.ok) throw new Error('Failed to load material assignments');
      const data = await res.json();
      return data ?? null;
    },
  });

  const assignments = localAssignments ?? query.data ?? EMPTY;

  // Internal save function (returns promise for flush)
  const doSave = useCallback(
    async (next: MaterialAssignments) => {
      const res = await authorizedFetch(`/api/orders/${orderId}/material-assignments`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || 'Failed to save material assignments');
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['material-assignments', orderId] });
      // Stale-marking happens server-side, invalidate cutting plan query
      queryClient.invalidateQueries({ queryKey: ['order-cutting-plan', orderId] });
    },
    [orderId, queryClient],
  );

  // Debounced save
  const save = useCallback(
    (next: MaterialAssignments) => {
      setLocalAssignments(next);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      pendingSaveRef.current = new Promise<void>((resolve) => {
        saveTimerRef.current = setTimeout(async () => {
          await doSave(next);
          pendingSaveRef.current = null;
          resolve();
        }, DEBOUNCE_MS);
      });
    },
    [doSave],
  );

  /**
   * Flush any pending debounced save. Call before generate/confirm
   * to ensure server state matches local state.
   */
  const flush = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (localAssignments) {
      await doSave(localAssignments);
      pendingSaveRef.current = null;
    }
  }, [localAssignments, doSave]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const assign = useCallback(
    (boardType: string, partName: string, lengthMm: number, widthMm: number, componentId: number, componentName: string) => {
      const next: MaterialAssignments = {
        ...assignments,
        assignments: upsertAssignment(assignments.assignments, {
          board_type: boardType,
          part_name: partName,
          length_mm: lengthMm,
          width_mm: widthMm,
          component_id: componentId,
          component_name: componentName,
        }),
      };
      save(next);
    },
    [assignments, save],
  );

  const assignBulk = useCallback(
    (
      roles: Array<{ board_type: string; part_name: string; length_mm: number; width_mm: number }>,
      componentId: number,
      componentName: string,
    ) => {
      const next: MaterialAssignments = {
        ...assignments,
        assignments: bulkAssign(assignments.assignments, roles, componentId, componentName),
      };
      save(next);
    },
    [assignments, save],
  );

  const setBackerDefault = useCallback(
    (backer: BackerDefault | null) => {
      const next: MaterialAssignments = { ...assignments, backer_default: backer };
      save(next);
    },
    [assignments, save],
  );

  /**
   * Derive PartRole[] from aggregate data + current assignments.
   * Groups parts by role fingerprint (board_type + name + dimensions).
   */
  const buildPartRoles = useCallback(
    (agg: AggregateResponse): PartRole[] => {
      const map = new Map<string, PartRole>();
      for (const group of agg.material_groups) {
        for (const part of group.parts) {
          const fp = roleFingerprint(group.board_type, part.name, part.length_mm, part.width_mm);
          const existing = map.get(fp);
          const match = findAssignment(
            assignments.assignments,
            group.board_type,
            part.name,
            part.length_mm,
            part.width_mm,
          );
          if (existing) {
            existing.total_quantity += part.quantity;
            if (!existing.product_names.includes(part.product_name)) {
              existing.product_names.push(part.product_name);
            }
          } else {
            map.set(fp, {
              board_type: group.board_type,
              part_name: part.name,
              length_mm: part.length_mm,
              width_mm: part.width_mm,
              total_quantity: part.quantity,
              product_names: [part.product_name],
              assigned_component_id: match?.component_id ?? null,
              assigned_component_name: match?.component_name ?? null,
            });
          }
        }
      }
      return Array.from(map.values());
    },
    [assignments],
  );

  const isComplete = useCallback(
    (roles: PartRole[]): boolean => roles.every((r) => r.assigned_component_id != null),
    [],
  );

  return {
    assignments,
    isLoading: query.isLoading,
    assign,
    assignBulk,
    setBackerDefault,
    buildPartRoles,
    isComplete,
    flush,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add hooks/useMaterialAssignments.ts
git commit -m "feat: add useMaterialAssignments hook with flush and error handling"
```

---

### Task 7: Component — `BoardMaterialCombobox`

**Files:**
- Create: `components/features/orders/BoardMaterialCombobox.tsx`

Searchable combobox (Popover + Command) for picking a board component, filtered to correct thickness.

- [ ] **Step 1: Write the combobox component**

```typescript
'use client';

import { useState, useMemo } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import type { BoardComponent } from '@/hooks/useBoardComponents';
import { filterByBoardType } from '@/hooks/useBoardComponents';

interface BoardMaterialComboboxProps {
  boards: BoardComponent[];
  /** When set, filters boards to matching thickness. When null, shows all boards (for backers). */
  boardType: string | null;
  value: number | null;
  onChange: (componentId: number, componentName: string) => void;
  placeholder?: string;
  className?: string;
}

export default function BoardMaterialCombobox({
  boards,
  boardType,
  value,
  onChange,
  placeholder = 'Select material…',
  className,
}: BoardMaterialComboboxProps) {
  const [open, setOpen] = useState(false);

  const filtered = useMemo(
    () => (boardType ? filterByBoardType(boards, boardType) : boards),
    [boards, boardType],
  );

  const selected = filtered.find((b) => b.component_id === value);
  const label = selected ? selected.description || selected.internal_code : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'justify-between font-normal',
            !label && 'text-muted-foreground',
            className,
          )}
        >
          <span className="truncate">{label ?? placeholder}</span>
          <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search boards…" />
          <CommandList>
            <CommandEmpty>No boards found.</CommandEmpty>
            {filtered.map((board) => (
              <CommandItem
                key={board.component_id}
                value={`${board.internal_code} ${board.description}`}
                onSelect={() => {
                  onChange(board.component_id, board.description || board.internal_code);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    'mr-2 h-3 w-3',
                    value === board.component_id ? 'opacity-100' : 'opacity-0',
                  )}
                />
                <div className="flex flex-col">
                  <span className="text-sm">{board.description || board.internal_code}</span>
                  {board.description && board.internal_code && (
                    <span className="text-xs text-muted-foreground">{board.internal_code}</span>
                  )}
                </div>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/features/orders/BoardMaterialCombobox.tsx
git commit -m "feat: add BoardMaterialCombobox with optional thickness filtering"
```

---

### Task 8: Component — `MaterialAssignmentGrid`

**Files:**
- Create: `components/features/orders/MaterialAssignmentGrid.tsx`

Collapsible parts grid grouped by board type. Each part-role row shows dimensions, qty, products, and a material combobox. Bulk select restricted to one board_type at a time.

- [ ] **Step 1: Write the grid component**

```typescript
'use client';

import { useState, useMemo, useCallback } from 'react';
import { ChevronDown, ChevronRight, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import BoardMaterialCombobox from './BoardMaterialCombobox';
import type { BoardComponent } from '@/hooks/useBoardComponents';
import type { PartRole, BackerDefault } from '@/lib/orders/material-assignment-types';
import { roleFingerprint } from '@/lib/orders/material-assignment-types';

interface MaterialAssignmentGridProps {
  partRoles: PartRole[];
  boards: BoardComponent[];
  backerBoards: BoardComponent[];
  backerDefault: BackerDefault | null;
  onAssign: (
    boardType: string,
    partName: string,
    lengthMm: number,
    widthMm: number,
    componentId: number,
    componentName: string,
  ) => void;
  onAssignBulk: (
    roles: Array<{ board_type: string; part_name: string; length_mm: number; width_mm: number }>,
    componentId: number,
    componentName: string,
  ) => void;
  onBackerDefaultChange: (backer: BackerDefault | null) => void;
}

export default function MaterialAssignmentGrid({
  partRoles,
  boards,
  backerBoards,
  backerDefault,
  onAssign,
  onAssignBulk,
  onBackerDefaultChange,
}: MaterialAssignmentGridProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // Selected fingerprints — restricted to one board_type at a time
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedBoardType, setSelectedBoardType] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, PartRole[]>();
    for (const role of partRoles) {
      const existing = map.get(role.board_type);
      if (existing) existing.push(role);
      else map.set(role.board_type, [role]);
    }
    return map;
  }, [partRoles]);

  const boardTypes = useMemo(() => Array.from(grouped.keys()).sort(), [grouped]);

  const hasBackerTypes = boardTypes.some((bt) => bt.includes('-backer'));

  const toggleCollapse = (bt: string) => {
    setCollapsed((prev) => ({ ...prev, [bt]: !prev[bt] }));
  };

  const toggleSelect = (role: PartRole) => {
    const fp = roleFingerprint(role.board_type, role.part_name, role.length_mm, role.width_mm);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fp)) {
        next.delete(fp);
        if (next.size === 0) setSelectedBoardType(null);
      } else {
        // Restrict to one board_type
        if (selectedBoardType && selectedBoardType !== role.board_type) {
          // Clear previous selection and start fresh
          next.clear();
          setSelectedBoardType(role.board_type);
        } else if (!selectedBoardType) {
          setSelectedBoardType(role.board_type);
        }
        next.add(fp);
      }
      return next;
    });
  };

  const selectAllInGroup = (bt: string) => {
    const roles = grouped.get(bt) ?? [];
    const fps = roles.map((r) => roleFingerprint(r.board_type, r.part_name, r.length_mm, r.width_mm));
    const allSelected = fps.every((fp) => selected.has(fp));
    if (allSelected) {
      setSelected(new Set());
      setSelectedBoardType(null);
    } else {
      setSelected(new Set(fps));
      setSelectedBoardType(bt);
    }
  };

  const handleBulkAssign = useCallback(
    (componentId: number, componentName: string) => {
      if (!selectedBoardType) return;
      const roles = Array.from(selected).map((fp) => {
        const role = partRoles.find(
          (r) => roleFingerprint(r.board_type, r.part_name, r.length_mm, r.width_mm) === fp,
        );
        return {
          board_type: role!.board_type,
          part_name: role!.part_name,
          length_mm: role!.length_mm,
          width_mm: role!.width_mm,
        };
      });
      onAssignBulk(roles, componentId, componentName);
      setSelected(new Set());
      setSelectedBoardType(null);
    },
    [selected, selectedBoardType, partRoles, onAssignBulk],
  );

  const totalRoles = partRoles.length;
  const assignedCount = partRoles.filter((r) => r.assigned_component_id != null).length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium uppercase text-muted-foreground">
            Material Assignments
          </CardTitle>
          <Badge variant={assignedCount === totalRoles ? 'default' : 'secondary'}>
            {assignedCount}/{totalRoles} assigned
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Backer default */}
        {hasBackerTypes && (
          <div className="flex items-center gap-3 rounded-sm border bg-muted/30 px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
              Backer Default:
            </span>
            <BoardMaterialCombobox
              boards={backerBoards}
              boardType={null}
              value={backerDefault?.component_id ?? null}
              onChange={(id, name) => onBackerDefaultChange({ component_id: id, component_name: name })}
              placeholder="Select backer material…"
              className="h-8 w-full max-w-xs text-xs"
            />
          </div>
        )}

        {/* Bulk assign bar */}
        {selected.size > 0 && selectedBoardType && (
          <div className="flex items-center gap-3 rounded-sm border border-blue-500/50 bg-blue-500/10 px-3 py-2">
            <span className="text-xs text-blue-400">
              {selected.size} part{selected.size > 1 ? 's' : ''} selected
            </span>
            <BoardMaterialCombobox
              boards={boards}
              boardType={selectedBoardType}
              value={null}
              onChange={handleBulkAssign}
              placeholder="Assign material to selected…"
              className="h-8 flex-1 text-xs"
            />
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => { setSelected(new Set()); setSelectedBoardType(null); }}
            >
              Clear
            </Button>
          </div>
        )}

        {/* Board type groups */}
        {boardTypes.map((bt) => {
          const roles = grouped.get(bt) ?? [];
          const isCollapsed = collapsed[bt] ?? false;
          const groupAssigned = roles.filter((r) => r.assigned_component_id != null).length;

          return (
            <div key={bt} className="rounded-sm border">
              <button
                onClick={() => toggleCollapse(bt)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm font-medium">{bt}</span>
                <span className="text-xs text-muted-foreground">
                  {roles.length} part{roles.length > 1 ? 's' : ''}
                </span>
                <Badge
                  variant={groupAssigned === roles.length ? 'default' : 'outline'}
                  className="ml-auto text-xs"
                >
                  {groupAssigned}/{roles.length}
                </Badge>
              </button>

              {!isCollapsed && (
                <div className="border-t">
                  <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-1">
                    <Checkbox
                      checked={roles.every((r) =>
                        selected.has(roleFingerprint(r.board_type, r.part_name, r.length_mm, r.width_mm)),
                      )}
                      onCheckedChange={() => selectAllInGroup(bt)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="text-xs text-muted-foreground">Select all</span>
                  </div>

                  {roles.map((role) => {
                    const fp = roleFingerprint(role.board_type, role.part_name, role.length_mm, role.width_mm);
                    return (
                      <div
                        key={fp}
                        className="flex items-center gap-3 border-b px-3 py-1.5 last:border-0"
                      >
                        <Checkbox
                          checked={selected.has(fp)}
                          onCheckedChange={() => toggleSelect(role)}
                          className="h-3.5 w-3.5"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">
                              {role.part_name}
                            </span>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {role.length_mm}×{role.width_mm}mm
                            </span>
                            <span className="text-xs text-muted-foreground">
                              ×{role.total_quantity}
                            </span>
                          </div>
                          {role.product_names.length > 0 && (
                            <span className="text-xs text-muted-foreground truncate block">
                              {role.product_names.join(', ')}
                            </span>
                          )}
                        </div>
                        <BoardMaterialCombobox
                          boards={boards}
                          boardType={role.board_type}
                          value={role.assigned_component_id}
                          onChange={(id, name) =>
                            onAssign(role.board_type, role.part_name, role.length_mm, role.width_mm, id, name)
                          }
                          className="h-8 w-[240px] text-xs"
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/features/orders/MaterialAssignmentGrid.tsx
git commit -m "feat: add MaterialAssignmentGrid with single-board-type bulk selection"
```

---

### Task 9: Utility — `regroupByAssignedMaterial`

**Files:**
- Create: `lib/orders/material-regroup.ts`

Re-groups aggregated parts by assigned materials. Resolves backer from `backer_default`. Client-safe (no `crypto`).

- [ ] **Step 1: Write the regroup utility**

```typescript
import type { AggregateResponse, AggregatedPartGroup } from '@/lib/orders/cutting-plan-types';
import type { MaterialAssignments } from '@/lib/orders/material-assignment-types';
import { findAssignment } from '@/lib/orders/material-assignment-types';

/**
 * Re-group aggregated parts by their assigned material.
 *
 * The aggregate endpoint groups by snapshot material. After the user assigns
 * specific materials per part role, this function flattens all parts and
 * re-groups them by the assigned material so the packer processes correct groups.
 *
 * Returns null if any part is missing an assignment or if a -backer group
 * has no backer_default resolved.
 */
export function regroupByAssignedMaterial(
  agg: AggregateResponse,
  materialAssignments: MaterialAssignments,
): AggregatedPartGroup[] | null {
  const groupMap = new Map<string, AggregatedPartGroup>();

  for (const group of agg.material_groups) {
    const hasBacker = group.board_type.includes('-backer');

    // Resolve backer: prefer user's backer_default, fall back to snapshot
    let backerId: number | null = null;
    let backerName: string | null = null;
    if (hasBacker) {
      if (materialAssignments.backer_default) {
        backerId = materialAssignments.backer_default.component_id;
        backerName = materialAssignments.backer_default.component_name;
      } else if (group.backer_material_id) {
        // Preserve snapshot backer if no explicit override
        backerId = group.backer_material_id;
        backerName = group.backer_material_name;
      } else {
        return null; // -backer group with no backer resolved
      }
    }

    for (const part of group.parts) {
      const match = findAssignment(
        materialAssignments.assignments,
        group.board_type,
        part.name,
        part.length_mm,
        part.width_mm,
      );

      if (!match) return null; // Missing assignment

      const key = `${group.board_type}|${match.component_id}|${backerId ?? 'none'}`;

      if (!groupMap.has(key)) {
        groupMap.set(key, {
          board_type: group.board_type,
          primary_material_id: match.component_id,
          primary_material_name: match.component_name,
          backer_material_id: backerId,
          backer_material_name: backerName,
          parts: [],
        });
      }

      groupMap.get(key)!.parts.push(part);
    }
  }

  return Array.from(groupMap.values());
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/orders/material-regroup.ts
git commit -m "feat: add regroupByAssignedMaterial with backer fallback to snapshot"
```

---

### Task 10: Orchestration Hook — `useCuttingPlanBuilder`

**Files:**
- Create: `hooks/useCuttingPlanBuilder.ts`

Combines aggregate loading, material assignments, part roles, generation, and confirmation into one hook. Replaces the inline state in `CuttingPlanTab`. Always re-fetches aggregate on generate. Flushes pending saves before generate.

- [ ] **Step 1: Write the orchestration hook**

```typescript
'use client';

import { useState, useMemo, useCallback } from 'react';
import { useOrderCuttingPlan } from '@/hooks/useOrderCuttingPlan';
import { useMaterialAssignments } from '@/hooks/useMaterialAssignments';
import { useBoardComponents, useBackerComponents } from '@/hooks/useBoardComponents';
import { regroupByAssignedMaterial } from '@/lib/orders/material-regroup';
import { packPartsSmartOptimized } from '@/components/features/cutlist/packing';
import { parseSheetThickness } from '@/lib/cutlist/boardCalculator';
import { toast } from 'sonner';
import type { StockSheetSpec, PartSpec, GrainOrientation } from '@/lib/cutlist/types';
import type {
  CuttingPlan,
  CuttingPlanMaterialGroup,
  CuttingPlanOverride,
  AggregateResponse,
  AggregatedPartGroup,
} from '@/lib/orders/cutting-plan-types';
import type { PartRole } from '@/lib/orders/material-assignment-types';

const DEFAULT_STOCK: StockSheetSpec = {
  id: 'S1',
  length_mm: 2750,
  width_mm: 1830,
  qty: 99,
  kerf_mm: 4,
};

function toGrain(grain: string): GrainOrientation {
  if (grain === 'length' || grain === 'along_length') return 'length';
  if (grain === 'width' || grain === 'along_width') return 'width';
  return 'any';
}

function toPartSpecs(group: AggregatedPartGroup): PartSpec[] {
  return group.parts.map((p) => ({
    id: p.id,
    length_mm: p.length_mm,
    width_mm: p.width_mm,
    qty: p.quantity,
    grain: toGrain(p.grain),
    band_edges: {
      top: p.band_edges?.top ?? false,
      bottom: p.band_edges?.bottom ?? false,
      left: p.band_edges?.left ?? false,
      right: p.band_edges?.right ?? false,
    },
    lamination_type: (p.lamination_type as PartSpec['lamination_type']) || 'none',
    lamination_config: p.lamination_config as PartSpec['lamination_config'],
    material_thickness: p.material_thickness,
    label: p.material_label,
  }));
}

export function useCuttingPlanBuilder(orderId: number) {
  const cuttingPlan = useOrderCuttingPlan(orderId);
  const materialAssignments = useMaterialAssignments(orderId);
  const { data: boards = [] } = useBoardComponents();
  const { data: backerBoards = [] } = useBackerComponents();

  const [aggData, setAggData] = useState<AggregateResponse | null>(null);
  const [pendingPlan, setPendingPlan] = useState<CuttingPlan | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [quality, setQuality] = useState<'fast' | 'balanced' | 'quality'>('fast');

  // Derive part roles from aggregate + assignments
  const partRoles: PartRole[] = useMemo(() => {
    if (!aggData) return [];
    return materialAssignments.buildPartRoles(aggData);
  }, [aggData, materialAssignments]);

  const allAssigned = materialAssignments.isComplete(partRoles);

  // Check if -backer types need a resolved backer
  const needsBacker = useMemo(
    () => aggData?.material_groups.some((g) => g.board_type.includes('-backer')) ?? false,
    [aggData],
  );
  const backerResolved =
    !needsBacker ||
    materialAssignments.assignments.backer_default != null ||
    aggData?.material_groups
      .filter((g) => g.board_type.includes('-backer'))
      .every((g) => g.backer_material_id != null) === true;

  const canGenerate = partRoles.length > 0 && allAssigned && backerResolved;

  // Load aggregate data (auto-loads on mount via this function)
  const loadAggregate = useCallback(async () => {
    const agg = await cuttingPlan.aggregate();
    setAggData(agg);
    return agg;
  }, [cuttingPlan]);

  // Generate: always re-fetch aggregate, flush assignments, regroup, pack
  const generate = useCallback(async () => {
    setIsGenerating(true);
    setPendingPlan(null);
    try {
      // Flush any pending assignment saves
      await materialAssignments.flush();

      // Always re-fetch aggregate for freshness
      const agg = await cuttingPlan.aggregate();
      setAggData(agg);

      if (!agg.has_cutlist_items) {
        toast.error('No cutlist items found on this order');
        return;
      }

      // Re-group parts by assigned materials
      const regrouped = regroupByAssignedMaterial(agg, materialAssignments.assignments);
      if (!regrouped) {
        toast.error('All parts must have materials assigned before generating');
        return;
      }

      const sheetArea = DEFAULT_STOCK.length_mm * DEFAULT_STOCK.width_mm;

      // Pack all material groups in parallel
      // TODO(future): resolve stock sheet per assigned component from suppliercomponents
      const packResults = await Promise.all(
        regrouped.map(async (group) => {
          const parts = toPartSpecs(group);
          const result = await packPartsSmartOptimized(parts, [DEFAULT_STOCK]);
          return { group, parts, result };
        }),
      );

      const materialGroups: CuttingPlanMaterialGroup[] = [];
      const overrides: CuttingPlanOverride[] = [];

      for (const { group, parts, result } of packResults) {
        const sheetsUsed = result.sheets.length;
        const totalArea = sheetArea * sheetsUsed;
        const usedArea = result.stats.used_area_mm2;
        const wastePercent = totalArea > 0 ? ((totalArea - usedArea) / totalArea) * 100 : 0;

        const bomEstimateArea = parts.reduce(
          (s, p) => s + p.length_mm * p.width_mm * p.qty,
          0,
        );
        const bomEstimateSheets = Math.ceil(bomEstimateArea / sheetArea);

        // For -backer board types, compute backer sheets needed
        const hasBacker = group.board_type.includes('-backer');
        // Each part in a -backer group needs one primary and one backer sheet cut.
        // The packer packs primary boards; backers use the same layout.
        const backerSheetsRequired = hasBacker ? sheetsUsed : 0;

        materialGroups.push({
          board_type: group.board_type,
          primary_material_id: group.primary_material_id,
          primary_material_name: group.primary_material_name,
          backer_material_id: group.backer_material_id,
          backer_material_name: group.backer_material_name,
          sheets_required: sheetsUsed,
          backer_sheets_required: backerSheetsRequired,
          edging_by_material: [], // TODO(future): compute edging from part edge banding + edging material assignments
          total_parts: parts.reduce((s, p) => s + p.qty, 0),
          waste_percent: Math.round(wastePercent * 10) / 10,
          bom_estimate_sheets: bomEstimateSheets,
          bom_estimate_backer_sheets: hasBacker ? bomEstimateSheets : 0,
          layouts: result.sheets,
          stock_sheet_spec: {
            length_mm: DEFAULT_STOCK.length_mm,
            width_mm: DEFAULT_STOCK.width_mm,
          },
        });

        if (group.primary_material_id != null) {
          overrides.push({
            component_id: group.primary_material_id,
            quantity: sheetsUsed,
            unit: 'sheets',
            source: 'cutlist_primary',
          });
        }
        if (group.backer_material_id != null && backerSheetsRequired > 0) {
          overrides.push({
            component_id: group.backer_material_id,
            quantity: backerSheetsRequired,
            unit: 'sheets',
            source: 'cutlist_backer',
          });
        }
      }

      const newPlan: CuttingPlan = {
        version: 1,
        generated_at: new Date().toISOString(),
        optimization_quality: quality,
        stale: false,
        source_revision: agg.source_revision,
        material_groups: materialGroups,
        component_overrides: overrides,
      };

      setPendingPlan(newPlan);
      toast.success(
        `Cutting plan generated: ${materialGroups.reduce((s, g) => s + g.sheets_required, 0)} sheets across ${materialGroups.length} material group(s)`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to generate cutting plan';
      toast.error(message);
    } finally {
      setIsGenerating(false);
    }
  }, [cuttingPlan, materialAssignments, quality]);

  const confirmPlan = useCallback(async () => {
    if (!pendingPlan) return;
    try {
      await cuttingPlan.confirm(pendingPlan);
      setPendingPlan(null);
      toast.success('Cutting plan confirmed and saved');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to confirm cutting plan';
      toast.error(message);
    }
  }, [pendingPlan, cuttingPlan]);

  const clearPlan = useCallback(async () => {
    try {
      await cuttingPlan.clear();
      setPendingPlan(null);
      toast.success('Cutting plan cleared');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to clear cutting plan';
      toast.error(message);
    }
  }, [cuttingPlan]);

  return {
    // Plan state
    plan: cuttingPlan.plan,
    pendingPlan,
    displayPlan: pendingPlan || cuttingPlan.plan,
    isPending: pendingPlan != null,
    isLoading: cuttingPlan.isLoading || materialAssignments.isLoading,
    isSaving: cuttingPlan.isSaving,
    isGenerating,

    // Material assignments
    assignments: materialAssignments.assignments,
    assign: materialAssignments.assign,
    assignBulk: materialAssignments.assignBulk,
    setBackerDefault: materialAssignments.setBackerDefault,
    partRoles,
    canGenerate,

    // Board data
    boards,
    backerBoards,

    // Actions
    loadAggregate,
    generate,
    confirmPlan,
    clearPlan,
    discardPending: () => setPendingPlan(null),

    // Quality
    quality,
    setQuality,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add hooks/useCuttingPlanBuilder.ts
git commit -m "feat: add useCuttingPlanBuilder orchestration hook"
```

---

### Task 11: Integration — Rewrite CuttingPlanTab

**Files:**
- Modify: `components/features/orders/CuttingPlanTab.tsx`

Replace all inline state with `useCuttingPlanBuilder`. Render `MaterialAssignmentGrid` in ALL states (empty, stale, fresh) as a collapsible section. Auto-load aggregate on mount. Block generate until all roles assigned.

- [ ] **Step 1: Read the current file**

Read `components/features/orders/CuttingPlanTab.tsx`.

- [ ] **Step 2: Rewrite the component**

Replace the entire file with a slim component that delegates to `useCuttingPlanBuilder`:

```typescript
'use client';

import { useEffect } from 'react';
import { useCuttingPlanBuilder } from '@/hooks/useCuttingPlanBuilder';
import MaterialAssignmentGrid from './MaterialAssignmentGrid';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle,
  Loader2,
  Scissors,
  Package,
  Trash2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useState } from 'react';

interface CuttingPlanTabProps {
  orderId: number;
}

export default function CuttingPlanTab({ orderId }: CuttingPlanTabProps) {
  const b = useCuttingPlanBuilder(orderId);
  const [gridCollapsed, setGridCollapsed] = useState(false);

  // Auto-load aggregate on mount
  useEffect(() => {
    b.loadAggregate().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (b.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const displayPlan = b.displayPlan;

  // Summary stats (when plan exists)
  const totalSheets = displayPlan?.material_groups.reduce((s, g) => s + g.sheets_required, 0) ?? 0;
  const totalParts = displayPlan?.material_groups.reduce((s, g) => s + g.total_parts, 0) ?? 0;
  const avgWaste = displayPlan && displayPlan.material_groups.length > 0
    ? displayPlan.material_groups.reduce((s, g) => s + g.waste_percent, 0) / displayPlan.material_groups.length
    : 0;
  const totalBomEstimate = displayPlan?.material_groups.reduce((s, g) => s + g.bom_estimate_sheets, 0) ?? 0;
  const sheetsSaved = totalBomEstimate - totalSheets;

  return (
    <div className="space-y-4">
      {/* Stale warning */}
      {displayPlan?.stale && (
        <div className="flex items-center gap-2 rounded-sm border border-yellow-500/50 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-500">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>Order has changed since this plan was generated. Re-generate for accurate results.</span>
          <Button size="sm" variant="outline" className="ml-auto" onClick={b.generate} disabled={b.isGenerating}>
            {b.isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Re-generate'}
          </Button>
        </div>
      )}

      {/* Pending confirmation banner */}
      {b.isPending && (
        <div className="flex items-center gap-2 rounded-sm border border-blue-500/50 bg-blue-500/10 px-3 py-2 text-sm text-blue-400">
          <Package className="h-4 w-4 shrink-0" />
          <span>Plan generated but not saved. Confirm to update purchasing requirements.</span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={b.discardPending}>Discard</Button>
            <Button size="sm" onClick={b.confirmPlan} disabled={b.isSaving}>
              {b.isSaving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}
              Confirm
            </Button>
          </div>
        </div>
      )}

      {/* Material Assignment Grid — always visible, collapsible */}
      {b.partRoles.length > 0 && (
        <div>
          <button
            onClick={() => setGridCollapsed((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-1"
          >
            {gridCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Material Assignments
          </button>
          {!gridCollapsed && (
            <MaterialAssignmentGrid
              partRoles={b.partRoles}
              boards={b.boards}
              backerBoards={b.backerBoards}
              backerDefault={b.assignments.backer_default}
              onAssign={b.assign}
              onAssignBulk={b.assignBulk}
              onBackerDefaultChange={b.setBackerDefault}
            />
          )}
        </div>
      )}

      {/* Generate controls (when no plan exists or plan is stale) */}
      {(!displayPlan || displayPlan.stale) && b.partRoles.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            value={b.quality}
            onChange={(e) => b.setQuality(e.target.value as 'fast' | 'balanced' | 'quality')}
            className="h-9 rounded-sm border bg-background px-3 text-sm"
          >
            <option value="fast">Fast</option>
            <option value="balanced">Balanced</option>
            <option value="quality">Quality</option>
          </select>
          <Button onClick={b.generate} disabled={b.isGenerating || !b.canGenerate}>
            {b.isGenerating ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…</>
            ) : (
              <><Scissors className="mr-2 h-4 w-4" /> Generate Cutting Plan</>
            )}
          </Button>
          {!b.canGenerate && b.partRoles.length > 0 && (
            <span className="text-xs text-muted-foreground">
              Assign all materials to enable generation
            </span>
          )}
        </div>
      )}

      {/* Empty state (no parts loaded yet) */}
      {b.partRoles.length === 0 && !displayPlan && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-6 space-y-3">
            <Scissors className="h-8 w-8 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              No cutlist parts found. Add products with cutlist data to this order.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Summary cards (when plan exists) */}
      {displayPlan && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card>
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">Total Sheets</p>
                <p className="text-2xl font-bold">{totalSheets}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">Total Parts</p>
                <p className="text-2xl font-bold">{totalParts}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">Avg Waste</p>
                <p className="text-2xl font-bold">{avgWaste.toFixed(1)}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">Sheets Saved</p>
                <p className="text-2xl font-bold text-green-500">
                  {sheetsSaved > 0 ? `${sheetsSaved}` : '\u2014'}
                </p>
                {sheetsSaved > 0 && (
                  <p className="text-xs text-muted-foreground">vs BOM estimate ({totalBomEstimate})</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Material breakdown table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium uppercase text-muted-foreground">
                Material Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-sm border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-3 py-2 text-left font-medium">Material</th>
                      <th className="px-3 py-2 text-right font-medium">Parts</th>
                      <th className="px-3 py-2 text-right font-medium">Sheets</th>
                      <th className="px-3 py-2 text-right font-medium">BOM Est.</th>
                      <th className="px-3 py-2 text-right font-medium">Saved</th>
                      <th className="px-3 py-2 text-right font-medium">Waste</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayPlan.material_groups.map((group, i) => {
                      const saved = group.bom_estimate_sheets - group.sheets_required;
                      return (
                        <tr key={i} className="border-b last:border-0">
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span>{group.primary_material_name ?? group.board_type}</span>
                              {group.backer_material_name && (
                                <Badge variant="outline" className="text-xs">
                                  + {group.backer_material_name}
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{group.total_parts}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">{group.sheets_required}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{group.bom_estimate_sheets}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {saved > 0 ? (
                              <span className="text-green-500">-{saved}</span>
                            ) : (
                              <span className="text-muted-foreground">{'\u2014'}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{group.waste_percent}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Actions footer */}
          {!b.isPending && !displayPlan.stale && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Generated {new Date(displayPlan.generated_at).toLocaleString()} · Quality: {displayPlan.optimization_quality}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={b.generate} disabled={b.isGenerating}>
                  {b.isGenerating ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Scissors className="mr-1 h-3 w-3" />}
                  Re-generate
                </Button>
                <Button size="sm" variant="outline" onClick={b.clearPlan}>
                  <Trash2 className="mr-1 h-3 w-3" /> Clear
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add components/features/orders/CuttingPlanTab.tsx
git commit -m "feat: rewrite CuttingPlanTab with useCuttingPlanBuilder and persistent grid"
```

---

### Task 12: Verify End-to-End in Browser

**Files:** None (verification only)

- [ ] **Step 1: Start the dev server**

```bash
npm run dev -- --webpack
```

- [ ] **Step 2: Navigate to an order with cutlist items**

Use Claude in Chrome to:
1. Log in with the test account (testai@qbutton.co.za / ClaudeTest2026!)
2. Navigate to an order that has products with cutlist snapshots
3. Click the Cutting Plan tab

- [ ] **Step 3: Verify auto-load and grid**

1. Grid should auto-load with part roles grouped by board type
2. Parts with same name but different dimensions should be distinct rows
3. Each row shows dimensions, quantity, product name(s)
4. Combobox should show only boards matching the thickness

- [ ] **Step 4: Verify assignment + bulk assign**

1. Assign materials to individual parts via combobox
2. Select multiple parts (within same board type) — verify cross-board-type is prevented
3. Bulk assign selected parts
4. Verify "X/Y assigned" badge updates

- [ ] **Step 5: Verify generate blocks when incomplete**

1. Leave some parts unassigned
2. Generate button should be disabled with "Assign all materials" message

- [ ] **Step 6: Verify generate with assigned materials**

1. Assign all parts, click Generate
2. Material breakdown should show assigned material names
3. Backer sheets should show non-zero for -backer groups
4. Confirm saves successfully

- [ ] **Step 7: Verify grid persists after plan**

1. After confirming, the material assignment grid should still be visible (collapsible)
2. Changing an assignment should mark the plan stale

- [ ] **Step 8: Run lint and type check**

```bash
npm run lint && npx tsc --noEmit
```

- [ ] **Step 9: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during e2e verification"
```

---

## Post-Implementation Notes

### Addressed by This Plan

- Role fingerprint prevents same-name collision across products (P0)
- PATCH stales cutting plan so purchasing can't use outdated overrides (P0)
- Backer sheets computed for -backer groups, backer override with snapshot fallback (P0/P1)
- Grid visible in all states (P1)
- Schema validation on PATCH, auto-save checks res.ok, flush before generate (P1)
- Shared thickness parser (P1)
- Bulk select restricted to one board_type (P1)
- Aggregate always re-fetched on generate (P1)
- Orchestration hook replaces inline state (P2)
- Auto-load on mount (P2)

### Deferred (Future Tasks)

1. **Per-component stock sheet resolution** — Query `suppliercomponents` for sheet dimensions per assigned component. Currently uses DEFAULT_STOCK (2750×1830). Marked with `TODO(future)` in `useCuttingPlanBuilder.ts`.
2. **Edging material assignment** — Similar grid for assigning edging materials. Currently `edging_by_material` is empty. Depends on having an edging assignment UI.
3. **Auto-populate from product defaults** — When aggregate loads, pre-fill assignments from snapshot `primary_material_id` where available.
4. **Assignment validation against stock** — Show stock levels in combobox.
5. **Per-group backer override** — Allow different backers per material group instead of one universal default.
