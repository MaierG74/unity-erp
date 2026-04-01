# Edging Computation for Cutting Plan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute edge banding totals per edging material in the cutting plan generate flow, with board-level edging defaults and per-part overrides, so purchasing knows how much edging to order.

**Architecture:** Extend the existing `MaterialAssignments` JSONB with `edging_defaults` (one edging per assigned board component) and `edging_overrides` (per-part exceptions). A new `useEdgingComponents` hook queries edging category components. The `MaterialAssignmentGrid` gains board-level edging comboboxes and per-row override buttons. The `generate()` flow computes edging lengths from `band_edges` × part dimensions, resolves edging component IDs from assignments, and emits `edging_by_material[]` entries + `cutlist_edging` overrides.

**Tech Stack:** Same as material assignment feature — Next.js, Supabase, TanStack Query, shadcn Popover+Command.

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `lib/orders/edging-computation.ts` | Pure function: compute edging totals from parts + edging assignments |

### Modified Files

| File | Change |
|------|--------|
| `lib/orders/material-assignment-types.ts` | Add `EdgingDefault`, `EdgingOverride` types; update `MaterialAssignments`; update `validateAssignments`; update `EMPTY`; add `PartRole.has_edges` |
| `hooks/useBoardComponents.ts` | Add `useEdgingComponents` hook (category 39 query) |
| `hooks/useMaterialAssignments.ts` | Add `setEdgingDefault`, `setEdgingOverride` mutation methods; update `EMPTY` |
| `hooks/useCuttingPlanBuilder.ts` | Wire edging components; add edging-complete check to `canGenerate`; call edging computation in `generate()`; expose `edgingComponents` |
| `components/features/orders/MaterialAssignmentGrid.tsx` | Add board-level edging combobox per assigned board; add per-row edging override button |
| `components/features/orders/CuttingPlanTab.tsx` | Pass `edgingComponents` and new callbacks to grid |

---

## Tasks

### Task 1: Types — Edging Assignments

**Files:**
- Modify: `lib/orders/material-assignment-types.ts`

- [ ] **Step 1: Add new types after `BackerDefault`**

After the `BackerDefault` type (line 33), add:

```typescript
/**
 * Board-level edging default — one edging component per assigned board material.
 * All parts assigned to this board inherit this edging unless overridden.
 */
export type EdgingDefault = {
  board_component_id: number;     // links to a MaterialAssignment.component_id
  edging_component_id: number;    // FK to components (category 39)
  edging_component_name: string;
};

/**
 * Per-part edging override — rare exception (e.g., cherry top → black edging).
 * Keyed by the same role fingerprint as board assignments.
 */
export type EdgingOverride = {
  board_type: string;
  part_name: string;
  length_mm: number;
  width_mm: number;
  edging_component_id: number;
  edging_component_name: string;
};
```

- [ ] **Step 2: Update `MaterialAssignments` type**

```typescript
export type MaterialAssignments = {
  version: 1;
  assignments: MaterialAssignment[];
  backer_default: BackerDefault | null;
  edging_defaults: EdgingDefault[];
  edging_overrides: EdgingOverride[];
};
```

- [ ] **Step 3: Add `has_edges` to `PartRole`**

Add to the `PartRole` type after `assigned_component_name`:

```typescript
  /** True if any band_edge is true — this part needs edging */
  has_edges: boolean;
```

- [ ] **Step 4: Update `buildPartRoles` to populate `has_edges`**

In the `buildPartRoles` function, when creating a new PartRole entry, compute `has_edges` from the part's `band_edges`:

```typescript
// Inside the else branch where new PartRole is created:
const partHasEdges = !!(
  part.band_edges?.top ||
  part.band_edges?.bottom ||
  part.band_edges?.left ||
  part.band_edges?.right
);

map.set(fp, {
  board_type: group.board_type,
  part_name: part.name,
  length_mm: part.length_mm,
  width_mm: part.width_mm,
  total_quantity: part.quantity,
  product_names: [part.product_name],
  assigned_component_id: match?.component_id ?? null,
  assigned_component_name: match?.component_name ?? null,
  has_edges: partHasEdges,
});
```

Also merge `has_edges` in the existing-role branch (use `||` so any part with edges makes the role edged):

```typescript
if (existing) {
  existing.total_quantity += part.quantity;
  existing.has_edges = existing.has_edges || partHasEdges;
  // ...rest unchanged
}
```

- [ ] **Step 5: Update `validateAssignments`**

Add validation for the two new fields at the end of `validateAssignments`, before the duplicate fingerprint check:

```typescript
  // Validate edging_defaults
  if (!Array.isArray(obj.edging_defaults ?? [])) return 'edging_defaults must be an array';
  for (const ed of (obj.edging_defaults ?? []) as unknown[]) {
    if (typeof ed !== 'object' || !ed) return 'Invalid edging_defaults entry';
    const entry = ed as Record<string, unknown>;
    if (typeof entry.board_component_id !== 'number' || entry.board_component_id <= 0)
      return 'edging_defaults: board_component_id must be positive';
    if (typeof entry.edging_component_id !== 'number' || entry.edging_component_id <= 0)
      return 'edging_defaults: edging_component_id must be positive';
    if (typeof entry.edging_component_name !== 'string' || !entry.edging_component_name)
      return 'edging_defaults: edging_component_name required';
  }

  // Validate edging_overrides
  if (!Array.isArray(obj.edging_overrides ?? [])) return 'edging_overrides must be an array';
  for (const eo of (obj.edging_overrides ?? []) as unknown[]) {
    if (typeof eo !== 'object' || !eo) return 'Invalid edging_overrides entry';
    const entry = eo as Record<string, unknown>;
    if (typeof entry.board_type !== 'string' || !entry.board_type) return 'edging_overrides: board_type required';
    if (typeof entry.part_name !== 'string' || !entry.part_name) return 'edging_overrides: part_name required';
    if (typeof entry.length_mm !== 'number' || entry.length_mm <= 0) return 'edging_overrides: length_mm must be positive';
    if (typeof entry.width_mm !== 'number' || entry.width_mm <= 0) return 'edging_overrides: width_mm must be positive';
    if (typeof entry.edging_component_id !== 'number' || entry.edging_component_id <= 0)
      return 'edging_overrides: edging_component_id must be positive';
    if (typeof entry.edging_component_name !== 'string' || !entry.edging_component_name)
      return 'edging_overrides: edging_component_name required';
  }
```

- [ ] **Step 6: Run lint and commit**

```bash
npm run lint
git add lib/orders/material-assignment-types.ts
git commit -m "feat: add EdgingDefault/EdgingOverride types, has_edges on PartRole, validation"
```

---

### Task 2: Edging Components Hook

**Files:**
- Modify: `hooks/useBoardComponents.ts`

- [ ] **Step 1: Add the edging category constant**

After the existing category constants (line 11), add:

```typescript
/** Edging category ID */
const EDGING_CATEGORY_ID = 39;
```

- [ ] **Step 2: Add `useEdgingComponents` hook**

After `useBackerComponents`, add:

```typescript
/**
 * Fetch active edging components (category 39).
 * Reuses the same BoardComponent type — edging components have
 * parsed_thickness_mm from their description (e.g., "16mm" PVC).
 */
export function useEdgingComponents() {
  return useQuery({
    queryKey: ['edging-components'],
    queryFn: async (): Promise<BoardComponent[]> => {
      const { data, error } = await supabase
        .from('components')
        .select('component_id, internal_code, description, category_id')
        .eq('category_id', EDGING_CATEGORY_ID)
        .eq('is_active', true)
        .order('internal_code');

      if (error) throw new Error(error.message);

      return (data ?? []).map((c) => ({
        component_id: c.component_id,
        internal_code: c.internal_code ?? '',
        description: c.description ?? '',
        category_id: c.category_id,
        parsed_thickness_mm: parseThicknessFromDescription(c.description ?? ''),
      }));
    },
    staleTime: 5 * 60 * 1000,
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add hooks/useBoardComponents.ts
git commit -m "feat: add useEdgingComponents hook for category 39"
```

---

### Task 3: Edging Mutation Methods in useMaterialAssignments

**Files:**
- Modify: `hooks/useMaterialAssignments.ts`

- [ ] **Step 1: Update EMPTY sentinel**

Change the `EMPTY` constant to include the new fields:

```typescript
const EMPTY: MaterialAssignments = {
  version: 1,
  assignments: [],
  backer_default: null,
  edging_defaults: [],
  edging_overrides: [],
};
```

- [ ] **Step 2: Import new types**

Update the import from `material-assignment-types` to include:

```typescript
import type {
  MaterialAssignments,
  MaterialAssignment,
  BackerDefault,
  EdgingDefault,
  EdgingOverride,
} from '@/lib/orders/material-assignment-types';
```

- [ ] **Step 3: Add `setEdgingDefault` callback**

After the existing `setBackerDefault` callback, add:

```typescript
  const setEdgingDefault = useCallback(
    (boardComponentId: number, edgingComponentId: number, edgingComponentName: string) => {
      const current = assignments.edging_defaults;
      const idx = current.findIndex((ed) => ed.board_component_id === boardComponentId);
      const entry: EdgingDefault = {
        board_component_id: boardComponentId,
        edging_component_id: edgingComponentId,
        edging_component_name: edgingComponentName,
      };
      const next: EdgingDefault[] =
        idx >= 0
          ? current.map((ed, i) => (i === idx ? entry : ed))
          : [...current, entry];
      save({ ...assignments, edging_defaults: next });
    },
    [assignments, save],
  );

  const setEdgingOverride = useCallback(
    (
      boardType: string,
      partName: string,
      lengthMm: number,
      widthMm: number,
      edgingComponentId: number,
      edgingComponentName: string,
    ) => {
      const current = assignments.edging_overrides;
      const idx = current.findIndex(
        (eo) =>
          eo.board_type === boardType &&
          eo.part_name === partName &&
          eo.length_mm === lengthMm &&
          eo.width_mm === widthMm,
      );
      const entry: EdgingOverride = {
        board_type: boardType,
        part_name: partName,
        length_mm: lengthMm,
        width_mm: widthMm,
        edging_component_id: edgingComponentId,
        edging_component_name: edgingComponentName,
      };
      const next: EdgingOverride[] =
        idx >= 0
          ? current.map((eo, i) => (i === idx ? entry : eo))
          : [...current, entry];
      save({ ...assignments, edging_overrides: next });
    },
    [assignments, save],
  );
```

- [ ] **Step 4: Add to return block**

Add `setEdgingDefault` and `setEdgingOverride` to the return object.

- [ ] **Step 5: Commit**

```bash
git add hooks/useMaterialAssignments.ts
git commit -m "feat: add setEdgingDefault and setEdgingOverride mutation methods"
```

---

### Task 4: Edging Computation Pure Function

**Files:**
- Create: `lib/orders/edging-computation.ts`

- [ ] **Step 1: Create the edging computation module**

```typescript
import type { AggregatedPartGroup } from '@/lib/orders/cutting-plan-types';
import type {
  MaterialAssignments,
  EdgingDefault,
  EdgingOverride,
} from '@/lib/orders/material-assignment-types';
import { roleFingerprint } from '@/lib/orders/material-assignment-types';
import type { CuttingPlanEdgingEntry, CuttingPlanOverride } from '@/lib/orders/cutting-plan-types';

type EdgingResult = {
  /** Per-material-group edging entries (for edging_by_material on each group) */
  groupEdging: Map<string, CuttingPlanEdgingEntry[]>;
  /** Aggregated edging overrides for component_overrides */
  edgingOverrides: CuttingPlanOverride[];
};

/**
 * Resolve which edging component a part should use.
 * Priority: edging_overrides (per-part) > edging_defaults (per-board) > null.
 */
function resolveEdgingForPart(
  boardType: string,
  partName: string,
  lengthMm: number,
  widthMm: number,
  assignedBoardComponentId: number,
  assignments: MaterialAssignments,
): { edging_component_id: number; edging_component_name: string } | null {
  // 1. Check per-part override
  const fp = roleFingerprint(boardType, partName, lengthMm, widthMm);
  const override = assignments.edging_overrides.find(
    (eo) => roleFingerprint(eo.board_type, eo.part_name, eo.length_mm, eo.width_mm) === fp,
  );
  if (override) {
    return {
      edging_component_id: override.edging_component_id,
      edging_component_name: override.edging_component_name,
    };
  }

  // 2. Fall back to board-level edging default
  const boardDefault = assignments.edging_defaults.find(
    (ed) => ed.board_component_id === assignedBoardComponentId,
  );
  if (boardDefault) {
    return {
      edging_component_id: boardDefault.edging_component_id,
      edging_component_name: boardDefault.edging_component_name,
    };
  }

  return null;
}

/**
 * Compute edging lengths per edging component from regrouped material groups.
 *
 * For each part with band_edges, calculates:
 *   top/bottom edges → part.length_mm × quantity
 *   left/right edges → part.width_mm × quantity
 *
 * Groups use the regrouped key (board_type|primary_material_id|backer_id)
 * as the Map key for per-group edging entries.
 *
 * Returns null if any part with edges is missing an edging assignment.
 */
export function computeEdging(
  regroupedGroups: AggregatedPartGroup[],
  assignments: MaterialAssignments,
): EdgingResult | null {
  // Per-group edging: Map<groupKey, Map<edgingComponentId, accumulator>>
  const groupEdgingMap = new Map<
    string,
    Map<number, { name: string; length_mm: number }>
  >();

  // Global totals for component_overrides
  const globalTotals = new Map<number, { name: string; length_mm: number }>();

  for (const group of regroupedGroups) {
    const groupKey = `${group.board_type}|${group.primary_material_id}|${group.backer_material_id ?? 'none'}`;

    if (!groupEdgingMap.has(groupKey)) {
      groupEdgingMap.set(groupKey, new Map());
    }
    const groupAcc = groupEdgingMap.get(groupKey)!;

    for (const part of group.parts) {
      const edges = part.band_edges;
      if (!edges) continue;

      const hasAnyEdge = edges.top || edges.bottom || edges.left || edges.right;
      if (!hasAnyEdge) continue;

      // Compute total edging length for this part
      let edgingLength = 0;
      if (edges.top) edgingLength += part.length_mm * part.quantity;
      if (edges.bottom) edgingLength += part.length_mm * part.quantity;
      if (edges.left) edgingLength += part.width_mm * part.quantity;
      if (edges.right) edgingLength += part.width_mm * part.quantity;

      if (edgingLength === 0) continue;

      // Resolve edging component
      if (group.primary_material_id == null) return null;
      const resolved = resolveEdgingForPart(
        group.board_type,
        part.name,
        part.length_mm,
        part.width_mm,
        group.primary_material_id,
        assignments,
      );
      if (!resolved) return null; // Missing edging assignment

      // Accumulate per-group
      const existing = groupAcc.get(resolved.edging_component_id);
      if (existing) {
        existing.length_mm += edgingLength;
      } else {
        groupAcc.set(resolved.edging_component_id, {
          name: resolved.edging_component_name,
          length_mm: edgingLength,
        });
      }

      // Accumulate global
      const globalExisting = globalTotals.get(resolved.edging_component_id);
      if (globalExisting) {
        globalExisting.length_mm += edgingLength;
      } else {
        globalTotals.set(resolved.edging_component_id, {
          name: resolved.edging_component_name,
          length_mm: edgingLength,
        });
      }
    }
  }

  // Convert per-group accumulators to CuttingPlanEdgingEntry[]
  const groupEdging = new Map<string, CuttingPlanEdgingEntry[]>();
  for (const [groupKey, acc] of groupEdgingMap) {
    const entries: CuttingPlanEdgingEntry[] = Array.from(acc.entries()).map(
      ([componentId, { name, length_mm }]) => ({
        component_id: componentId,
        component_name: name,
        thickness_mm: 0, // filled by caller from component data if needed
        length_mm: Math.round(length_mm),
        unit: 'mm' as const,
      }),
    );
    groupEdging.set(groupKey, entries);
  }

  // Convert global totals to CuttingPlanOverride[]
  const edgingOverrides: CuttingPlanOverride[] = Array.from(
    globalTotals.entries(),
  ).map(([componentId, { length_mm }]) => ({
    component_id: componentId,
    quantity: Math.round(length_mm),
    unit: 'mm' as const,
    source: 'cutlist_edging' as const,
  }));

  return { groupEdging, edgingOverrides };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/orders/edging-computation.ts
git commit -m "feat: add computeEdging pure function for edging length calculation"
```

---

### Task 5: Wire Edging into useCuttingPlanBuilder

**Files:**
- Modify: `hooks/useCuttingPlanBuilder.ts`

- [ ] **Step 1: Add imports**

Add to imports:

```typescript
import { useEdgingComponents } from '@/hooks/useBoardComponents';
import { computeEdging } from '@/lib/orders/edging-computation';
```

- [ ] **Step 2: Add edging hook and destructure new methods**

After `const backerComponents = useBackerComponents();` add:

```typescript
const edgingComponents = useEdgingComponents();
```

Update the destructuring of `useMaterialAssignments` to include:

```typescript
const {
  assignments: matAssignments,
  flush: flushAssignments,
  assign,
  assignBulk,
  setBackerDefault,
  setEdgingDefault,
  setEdgingOverride,
  isLoading: isAssignmentsLoading,
} = useMaterialAssignments(orderId);
```

- [ ] **Step 3: Update `canGenerate` to check edging completeness**

After the backer check in `canGenerate`, add an edging check:

```typescript
    // Check edging: every assigned board that has parts with edges needs an edging default
    const boardIdsWithEdges = new Set<number>();
    for (const role of partRoles) {
      if (role.has_edges && role.assigned_component_id != null) {
        boardIdsWithEdges.add(role.assigned_component_id);
      }
    }
    for (const boardId of boardIdsWithEdges) {
      const hasEdgingDefault = matAssignments.edging_defaults.some(
        (ed) => ed.board_component_id === boardId,
      );
      // Also check if ALL parts for this board have overrides (rare but valid)
      if (!hasEdgingDefault) {
        const allOverridden = partRoles
          .filter((r) => r.assigned_component_id === boardId && r.has_edges)
          .every((r) =>
            matAssignments.edging_overrides.some(
              (eo) =>
                eo.board_type === r.board_type &&
                eo.part_name === r.part_name &&
                eo.length_mm === r.length_mm &&
                eo.width_mm === r.width_mm,
            ),
          );
        if (!allOverridden) return false;
      }
    }
    return true;
```

- [ ] **Step 4: Call edging computation in `generate()`**

After the `packResults` loop that builds `materialGroups` and `overrides`, add:

```typescript
      // 5. Compute edging from parts + edging assignments
      const edgingResult = computeEdging(regrouped, currentAssignments);
      if (!edgingResult) {
        toast.error('Some parts with edges are missing edging assignments');
        return;
      }

      // Apply per-group edging entries
      for (const mg of materialGroups) {
        const groupKey = `${mg.board_type}|${mg.primary_material_id}|${mg.backer_material_id ?? 'none'}`;
        mg.edging_by_material = edgingResult.groupEdging.get(groupKey) ?? [];
      }

      // Add edging overrides to component_overrides
      overrides.push(...edgingResult.edgingOverrides);
```

- [ ] **Step 5: Expose new values in return block**

Add to the return object:

```typescript
    // Edging
    edgingComponents: edgingComponents.data ?? [],
    setEdgingDefault,
    setEdgingOverride,
```

- [ ] **Step 6: Run lint and commit**

```bash
npm run lint
git add hooks/useCuttingPlanBuilder.ts
git commit -m "feat: wire edging computation into generate flow with canGenerate check"
```

---

### Task 6: Board-Level Edging Combobox in MaterialAssignmentGrid

**Files:**
- Modify: `components/features/orders/MaterialAssignmentGrid.tsx`

This is the largest UI task. The grid needs to show, for each distinct assigned board within a board_type group, an edging combobox.

- [ ] **Step 1: Update props interface**

Add to `MaterialAssignmentGridProps`:

```typescript
  edgingComponents: BoardComponent[];
  edgingDefaults: EdgingDefault[];
  edgingOverrides: EdgingOverride[];
  onEdgingDefault: (boardComponentId: number, edgingComponentId: number, edgingComponentName: string) => void;
  onEdgingOverride: (
    boardType: string,
    partName: string,
    lengthMm: number,
    widthMm: number,
    edgingComponentId: number,
    edgingComponentName: string,
  ) => void;
```

Import `EdgingDefault` and `EdgingOverride` from `material-assignment-types`.

- [ ] **Step 2: Add board-level edging rows inside each group**

After the "Select all" row and before the part rows, compute the distinct assigned boards in this group and render an edging combobox for each:

```typescript
{/* Board-level edging assignments */}
{(() => {
  // Collect distinct assigned boards in this group that have parts with edges
  const boardsInGroup = new Map<number, string>();
  for (const role of roles) {
    if (role.assigned_component_id != null && role.has_edges) {
      if (!boardsInGroup.has(role.assigned_component_id)) {
        boardsInGroup.set(role.assigned_component_id, role.assigned_component_name ?? '');
      }
    }
  }
  if (boardsInGroup.size === 0) return null;
  return Array.from(boardsInGroup.entries()).map(([boardId, boardName]) => {
    const edgingDefault = edgingDefaults.find((ed) => ed.board_component_id === boardId);
    return (
      <div
        key={`edging-${boardId}`}
        className="flex items-center gap-3 border-b bg-muted/20 px-3 py-1.5"
      >
        <span className="text-xs text-muted-foreground truncate min-w-0 flex-1">
          Edging for <span className="font-medium text-foreground">{boardName}</span>:
        </span>
        <BoardMaterialCombobox
          boards={edgingComponents}
          boardType={null}
          value={edgingDefault?.edging_component_id ?? null}
          onChange={(id, name) => onEdgingDefault(boardId, id, name)}
          placeholder="Select edging…"
          className="h-8 w-[240px] text-xs"
        />
      </div>
    );
  });
})()}
```

- [ ] **Step 3: Add per-row edging override**

For each part row that has `role.has_edges`, add a small override button/indicator. When clicked, it reveals an edging combobox inline. Use local state `expandedOverrides: Set<string>` to track which rows have the override expanded.

Add state:

```typescript
const [expandedOverrides, setExpandedOverrides] = useState<Set<string>>(new Set());
```

In the part row, after the board combobox:

```typescript
{role.has_edges && (
  <>
    {expandedOverrides.has(fp) || edgingOverrides.some(
      (eo) => roleFingerprint(eo.board_type, eo.part_name, eo.length_mm, eo.width_mm) === fp,
    ) ? (
      <BoardMaterialCombobox
        boards={edgingComponents}
        boardType={null}
        value={
          edgingOverrides.find(
            (eo) => roleFingerprint(eo.board_type, eo.part_name, eo.length_mm, eo.width_mm) === fp,
          )?.edging_component_id ?? null
        }
        onChange={(id, name) =>
          onEdgingOverride(role.board_type, role.part_name, role.length_mm, role.width_mm, id, name)
        }
        placeholder="Override edging…"
        className="h-8 w-[180px] text-xs"
      />
    ) : (
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-1.5 text-xs text-muted-foreground"
        onClick={() => setExpandedOverrides((prev) => {
          const next = new Set(prev);
          next.add(fp);
          return next;
        })}
        title="Override edging for this part"
      >
        <Scissors className="h-3 w-3" />
      </Button>
    )}
  </>
)}
```

Import `Scissors` from lucide-react (add to the existing import).

- [ ] **Step 4: Commit**

```bash
git add components/features/orders/MaterialAssignmentGrid.tsx
git commit -m "feat: add board-level edging combobox and per-row override to assignment grid"
```

---

### Task 7: Wire CuttingPlanTab to Pass Edging Props

**Files:**
- Modify: `components/features/orders/CuttingPlanTab.tsx`

- [ ] **Step 1: Pass edging props to MaterialAssignmentGrid**

Update the `<MaterialAssignmentGrid>` JSX to include the new props:

```tsx
<MaterialAssignmentGrid
  partRoles={b.partRoles}
  boards={b.boards}
  backerBoards={b.backerBoards}
  backerDefault={b.assignments.backer_default}
  onAssign={b.assign}
  onAssignBulk={b.assignBulk}
  onBackerDefaultChange={b.setBackerDefault}
  edgingComponents={b.edgingComponents}
  edgingDefaults={b.assignments.edging_defaults ?? []}
  edgingOverrides={b.assignments.edging_overrides ?? []}
  onEdgingDefault={b.setEdgingDefault}
  onEdgingOverride={b.setEdgingOverride}
/>
```

- [ ] **Step 2: Run lint and commit**

```bash
npm run lint
git add components/features/orders/CuttingPlanTab.tsx
git commit -m "feat: pass edging props from CuttingPlanTab to MaterialAssignmentGrid"
```

---

### Task 8: End-to-End Browser Verification

**Files:** None (verification only)

- [ ] **Step 1: Start dev server**

```bash
npm run dev -- --webpack
```

- [ ] **Step 2: Navigate to order with cutlist parts**

Log in with test account, go to order 401 Cutting Plan tab.

- [ ] **Step 3: Verify edging UI appears**

1. Assign board materials to all parts (bulk assign)
2. Verify: below each board_type group header, an "Edging for [Board Name]:" row appears with a combobox
3. Pick an edging component for each assigned board
4. Verify: the edging override scissors icon appears on parts that have edges
5. Click the scissors on one part, verify the override combobox opens
6. Pick a different edging for that part

- [ ] **Step 4: Verify generate includes edging**

1. Generate the cutting plan
2. Check: Material Breakdown table — look for edging info (may need to scroll)
3. Check: no console errors
4. Confirm the plan saves

- [ ] **Step 5: Run lint and type check**

```bash
npm run lint && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 6: Commit any fixes**

```bash
git add -A && git commit -m "fix: address issues found during edging e2e verification"
```

---

## Post-Implementation Notes

### Not Covered (Future)

1. **Edging cost computation** — Needs `cost_per_meter` from supplier data. Not blocking for quantity tracking.
2. **Edging thickness on CuttingPlanEdgingEntry** — Currently set to `0`. Should resolve from edging component description via `parseThicknessFromDescription`. Low priority since purchasing uses `component_id`, not thickness.
3. **Edging in Material Breakdown table** — The table currently only shows board sheets. A future enhancement could show edging rows (total meters per edging component).
4. **Auto-suggest edging from board name** — If "Brookhill Oak 16mm" is assigned, auto-suggest "Brookhill PVC 16mm" from the edging catalog by matching the color prefix. Nice UX improvement for later.
