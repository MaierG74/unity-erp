# Per-Order-Line Material Assignment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor material assignment from per-role-fingerprint to per-order-line so the same product on different order lines can have different board + edging materials.

**Architecture:** Widen the role fingerprint key from `board_type|part_name|length_mm|width_mm` to `order_detail_id|board_type|part_name|length_mm|width_mm`. Every type, function, and UI component that uses the four-field key gains the fifth field. The downstream packing pipeline stays unchanged — it groups by assigned material, not by line.

**Tech Stack:** TypeScript, React, Next.js App Router, TanStack Query, shadcn/ui

**Spec:** `docs/superpowers/specs/2026-04-01-per-line-material-assignment-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `lib/orders/material-assignment-types.ts` | Modify | Types, fingerprint, pure functions, validation |
| `hooks/useMaterialAssignments.ts` | Modify | Wider signatures on mutation methods |
| `lib/orders/material-regroup.ts` | Modify | Pass `order_detail_id` to `findAssignment` |
| `lib/orders/edging-computation.ts` | Modify | Pass `order_detail_id` to override lookup |
| `components/features/orders/MaterialAssignmentGrid.tsx` | Modify | Two-level grouping, sub-group headers |
| `hooks/useCuttingPlanBuilder.ts` | Modify | Thread wider signatures, update `onAssign`/`onEdgingOverride` |
| `components/features/orders/CuttingPlanTab.tsx` | Modify | Pass wider callbacks to grid |
| `app/api/orders/[orderId]/material-assignments/route.ts` | Modify | Validation update (via `validateAssignments`) |

---

## Task 1: Widen Types and Fingerprint

**Files:**
- Modify: `lib/orders/material-assignment-types.ts`

- [ ] **Step 1: Update `roleFingerprint` signature and implementation**

Change the function to accept `orderDetailId` as the first parameter:

```ts
export function roleFingerprint(
  orderDetailId: number,
  boardType: string,
  partName: string,
  lengthMm: number,
  widthMm: number,
): string {
  return `${orderDetailId}|${boardType}|${partName}|${lengthMm}|${widthMm}`;
}
```

- [ ] **Step 2: Add `order_detail_id` to `MaterialAssignment`**

```ts
export type MaterialAssignment = {
  order_detail_id: number;
  board_type: string;
  part_name: string;
  length_mm: number;
  width_mm: number;
  component_id: number;
  component_name: string;
};
```

- [ ] **Step 3: Add `order_detail_id` to `EdgingOverride`**

```ts
export type EdgingOverride = {
  order_detail_id: number;
  board_type: string;
  part_name: string;
  length_mm: number;
  width_mm: number;
  edging_component_id: number;
  edging_component_name: string;
};
```

- [ ] **Step 4: Update `PartRole` with per-line fields**

```ts
export type PartRole = {
  order_detail_id: number;
  board_type: string;
  part_name: string;
  length_mm: number;
  width_mm: number;
  total_quantity: number;
  product_names: string[];
  /** Product name for grid sub-group header */
  line_product_name: string;
  /** Order line quantity for grid sub-group header */
  line_quantity: number;
  assigned_component_id: number | null;
  assigned_component_name: string | null;
  has_edges: boolean;
};
```

- [ ] **Step 5: Update `findAssignment` to match on all five fields**

```ts
export function findAssignment(
  assignments: MaterialAssignment[],
  orderDetailId: number,
  boardType: string,
  partName: string,
  lengthMm: number,
  widthMm: number,
): MaterialAssignment | undefined {
  return assignments.find(
    (a) =>
      a.order_detail_id === orderDetailId &&
      a.board_type === boardType &&
      a.part_name === partName &&
      a.length_mm === lengthMm &&
      a.width_mm === widthMm,
  );
}
```

- [ ] **Step 6: Update `upsertAssignment` to match on all five fields**

The matching logic in `findIndex` needs `order_detail_id`:

```ts
export function upsertAssignment(
  assignments: MaterialAssignment[],
  assignment: MaterialAssignment,
): MaterialAssignment[] {
  const idx = assignments.findIndex(
    (a) =>
      a.order_detail_id === assignment.order_detail_id &&
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
```

- [ ] **Step 7: Update `bulkAssign` role type to include `order_detail_id`**

```ts
export function bulkAssign(
  assignments: MaterialAssignment[],
  roles: Array<{ order_detail_id: number; board_type: string; part_name: string; length_mm: number; width_mm: number }>,
  componentId: number,
  componentName: string,
): MaterialAssignment[] {
  let result = [...assignments];
  for (const role of roles) {
    result = upsertAssignment(result, {
      order_detail_id: role.order_detail_id,
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
```

- [ ] **Step 8: Update `buildPartRoles` to stop merging across lines**

Replace the function body. Key changes: fingerprint includes `order_detail_id`, no merging across lines, populate `line_product_name` and `line_quantity`.

```ts
export function buildPartRoles(
  agg: AggregateResponse | null,
  assignments: MaterialAssignments,
): PartRole[] {
  if (!agg) return [];
  const assignmentIndex = new Map(
    assignments.assignments.map((a) => [
      roleFingerprint(a.order_detail_id, a.board_type, a.part_name, a.length_mm, a.width_mm),
      a,
    ]),
  );

  // Pre-compute line quantities: sum part.quantity per order_detail_id
  // (all parts for a line share the same order_detail_id, line qty is baked into part.quantity)
  const lineQuantities = new Map<number, number>();
  const lineProductNames = new Map<number, string>();
  for (const group of agg.material_groups) {
    for (const part of group.parts) {
      if (!lineProductNames.has(part.order_detail_id)) {
        lineProductNames.set(part.order_detail_id, part.product_name);
      }
    }
  }

  const map = new Map<string, PartRole>();
  for (const group of agg.material_groups) {
    for (const part of group.parts) {
      const fp = roleFingerprint(part.order_detail_id, group.board_type, part.name, part.length_mm, part.width_mm);
      const existing = map.get(fp);
      const match = assignmentIndex.get(fp);
      const partHasEdges = !!(
        part.band_edges?.top ||
        part.band_edges?.bottom ||
        part.band_edges?.left ||
        part.band_edges?.right
      );
      if (existing) {
        existing.total_quantity += part.quantity;
        if (!existing.product_names.includes(part.product_name)) {
          existing.product_names.push(part.product_name);
        }
        existing.has_edges = existing.has_edges || partHasEdges;
      } else {
        map.set(fp, {
          order_detail_id: part.order_detail_id,
          board_type: group.board_type,
          part_name: part.name,
          length_mm: part.length_mm,
          width_mm: part.width_mm,
          total_quantity: part.quantity,
          product_names: [part.product_name],
          line_product_name: lineProductNames.get(part.order_detail_id) ?? '',
          line_quantity: part.quantity,
          assigned_component_id: match?.component_id ?? null,
          assigned_component_name: match?.component_name ?? null,
          has_edges: partHasEdges,
        });
      }
    }
  }
  return Array.from(map.values());
}
```

Note: `line_quantity` is set to `part.quantity` on first insert. Within a single `order_detail_id + board_type`, parts may have different quantities (e.g., 10 left sides, 10 right sides). The header should show the order line qty (all parts for that line share it). Since the aggregate multiplies `part.quantity * lineQty` (see aggregate route line 104), the line qty is already baked in. The header can just show the product name — the per-part quantity is already on each row.

- [ ] **Step 9: Update `validateAssignments` for `order_detail_id`**

In the assignments validation loop, add after the `board_type` check:

```ts
if (typeof entry.order_detail_id !== 'number' || entry.order_detail_id <= 0) return 'order_detail_id must be positive';
```

In the edging_overrides validation loop, add after the `board_type` check:

```ts
if (typeof entry.order_detail_id !== 'number' || entry.order_detail_id <= 0) return 'edging override order_detail_id must be positive';
```

Update the duplicate fingerprint check to use five fields:

```ts
const fp = roleFingerprint(a.order_detail_id, a.board_type, a.part_name, a.length_mm, a.width_mm);
```

- [ ] **Step 10: Verify the file compiles**

Run: `npx tsc --noEmit lib/orders/material-assignment-types.ts 2>&1 | head -30`

Expected: Compilation errors from downstream callers (hooks, grid, etc.) — that's fine, we fix those in the next tasks.

- [ ] **Step 11: Commit**

```bash
git add lib/orders/material-assignment-types.ts
git commit -m "feat: widen material assignment types with order_detail_id"
```

---

## Task 2: Update Downstream Pure Functions

**Files:**
- Modify: `lib/orders/material-regroup.ts`
- Modify: `lib/orders/edging-computation.ts`

- [ ] **Step 1: Update `findAssignment` call in `material-regroup.ts`**

At line 41, the `findAssignment` call needs `part.order_detail_id` as the first argument:

```ts
      const match = findAssignment(
        materialAssignments.assignments,
        part.order_detail_id,
        group.board_type,
        part.name,
        part.length_mm,
        part.width_mm,
      );
```

The `AggregatedPart` type already has `order_detail_id` so this is available.

- [ ] **Step 2: Update `resolveEdgingForPart` in `edging-computation.ts`**

Add `orderDetailId: number` as the first parameter. Update the fingerprint call and the override lookup:

```ts
function resolveEdgingForPart(
  orderDetailId: number,
  boardType: string,
  partName: string,
  lengthMm: number,
  widthMm: number,
  assignedBoardComponentId: number,
  assignments: MaterialAssignments,
): { edging_component_id: number; edging_component_name: string } | null {
  const fp = roleFingerprint(orderDetailId, boardType, partName, lengthMm, widthMm);
  const override = assignments.edging_overrides.find(
    (eo) => roleFingerprint(eo.order_detail_id, eo.board_type, eo.part_name, eo.length_mm, eo.width_mm) === fp,
  );
```

The rest of the function (edging_defaults lookup by `board_component_id`) stays the same.

- [ ] **Step 3: Update `computeEdging` to pass `order_detail_id`**

At the call to `resolveEdgingForPart` inside `computeEdging` (around line 94), add `part.order_detail_id`:

```ts
      const resolved = resolveEdgingForPart(
        part.order_detail_id,
        group.board_type,
        part.name,
        part.length_mm,
        part.width_mm,
        group.primary_material_id,
        assignments,
      );
```

`part` is an `AggregatedPart` which already has `order_detail_id`.

- [ ] **Step 4: Commit**

```bash
git add lib/orders/material-regroup.ts lib/orders/edging-computation.ts
git commit -m "feat: thread order_detail_id through regroup and edging functions"
```

---

## Task 3: Update Hooks

**Files:**
- Modify: `hooks/useMaterialAssignments.ts`
- Modify: `hooks/useCuttingPlanBuilder.ts`

- [ ] **Step 1: Update `assign` in `useMaterialAssignments.ts`**

Add `orderDetailId: number` as the first parameter:

```ts
  const assign = useCallback(
    (orderDetailId: number, boardType: string, partName: string, lengthMm: number, widthMm: number, componentId: number, componentName: string) => {
      const next: MaterialAssignments = {
        ...assignments,
        assignments: upsertAssignment(assignments.assignments, {
          order_detail_id: orderDetailId,
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
```

- [ ] **Step 2: Update `assignBulk` in `useMaterialAssignments.ts`**

The `roles` parameter type already gains `order_detail_id` from `bulkAssign` in Task 1. No change needed to this function body — `bulkAssign` handles it. Just update the type annotation:

```ts
  const assignBulk = useCallback(
    (
      roles: Array<{ order_detail_id: number; board_type: string; part_name: string; length_mm: number; width_mm: number }>,
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
```

- [ ] **Step 3: Update `setEdgingOverride` in `useMaterialAssignments.ts`**

Add `orderDetailId: number` as the first parameter. Update the matching logic and entry construction:

```ts
  const setEdgingOverride = useCallback(
    (
      orderDetailId: number,
      boardType: string,
      partName: string,
      lengthMm: number,
      widthMm: number,
      edgingComponentId: number,
      edgingComponentName: string,
    ) => {
      const current = assignments.edging_overrides ?? [];
      const idx = current.findIndex(
        (eo) =>
          eo.order_detail_id === orderDetailId &&
          eo.board_type === boardType &&
          eo.part_name === partName &&
          eo.length_mm === lengthMm &&
          eo.width_mm === widthMm,
      );
      const entry: EdgingOverride = {
        order_detail_id: orderDetailId,
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

- [ ] **Step 4: Update `useCuttingPlanBuilder.ts` return values**

The `assign`, `assignBulk`, `setEdgingOverride` returned from `useCuttingPlanBuilder` come from `useMaterialAssignments` and are passed through unchanged. Their signatures widened automatically. No code change needed in this file — the wider types flow through.

Verify: check that `useCuttingPlanBuilder` doesn't call `assign` or `setEdgingOverride` directly (it doesn't — it only passes them through).

- [ ] **Step 5: Commit**

```bash
git add hooks/useMaterialAssignments.ts hooks/useCuttingPlanBuilder.ts
git commit -m "feat: widen hook signatures for order_detail_id"
```

---

## Task 4: Update Grid Component — Two-Level Grouping

**Files:**
- Modify: `components/features/orders/MaterialAssignmentGrid.tsx`

This is the largest task. The grid currently groups by `board_type` only. We add a second level: within each `board_type`, group by `order_detail_id`.

- [ ] **Step 1: Update `MaterialAssignmentGridProps` callbacks**

The `onAssign` and `onEdgingOverride` callbacks gain `orderDetailId` as first parameter:

```ts
interface MaterialAssignmentGridProps {
  partRoles: PartRole[];
  boards: BoardComponent[];
  backerBoards: BoardComponent[];
  backerDefault: BackerDefault | null;
  onAssign: (
    orderDetailId: number,
    boardType: string,
    partName: string,
    lengthMm: number,
    widthMm: number,
    componentId: number,
    componentName: string,
  ) => void;
  onAssignBulk: (
    roles: Array<{ order_detail_id: number; board_type: string; part_name: string; length_mm: number; width_mm: number }>,
    componentId: number,
    componentName: string,
  ) => void;
  onBackerDefaultChange: (backer: BackerDefault | null) => void;
  edgingComponents: BoardComponent[];
  edgingDefaults: EdgingDefault[];
  edgingOverrides: EdgingOverride[];
  onEdgingDefault: (boardComponentId: number, edgingComponentId: number, edgingComponentName: string) => void;
  onEdgingOverride: (
    orderDetailId: number,
    boardType: string,
    partName: string,
    lengthMm: number,
    widthMm: number,
    edgingComponentId: number,
    edgingComponentName: string,
  ) => void;
}
```

- [ ] **Step 2: Update the `grouped` useMemo for two-level grouping**

Replace the current `grouped` memo with a two-level structure:

```ts
  // Two-level grouping: board_type → order_detail_id → PartRole[]
  const grouped = useMemo(() => {
    const map = new Map<string, Map<number, PartRole[]>>();
    for (const role of partRoles) {
      let btMap = map.get(role.board_type);
      if (!btMap) {
        btMap = new Map();
        map.set(role.board_type, btMap);
      }
      const existing = btMap.get(role.order_detail_id);
      if (existing) existing.push(role);
      else btMap.set(role.order_detail_id, [role]);
    }
    return map;
  }, [partRoles]);
```

- [ ] **Step 3: Update `roleFingerprint` calls throughout the component**

Every call to `roleFingerprint` in the component must now pass `role.order_detail_id` as the first argument. This includes:

- `toggleSelect` (line 85)
- `selectAllInGroup` (line 106)
- `handleBulkAssign` (line 121 — the `find` lookup)
- The `Checkbox` checked prop (line 230-232)
- The per-row `key` (line 274)
- The edging override lookup (lines 314-316)

All follow the same pattern — change `roleFingerprint(role.board_type, ...)` to `roleFingerprint(role.order_detail_id, role.board_type, ...)`.

For `handleBulkAssign`, the role lookup also needs to include `order_detail_id` in the resolved object passed to `onAssignBulk`:

```ts
  const handleBulkAssign = useCallback(
    (componentId: number, componentName: string) => {
      if (!selectedBoardType) return;
      const roles = Array.from(selected).map((fp) => {
        const role = partRoles.find(
          (r) => roleFingerprint(r.order_detail_id, r.board_type, r.part_name, r.length_mm, r.width_mm) === fp,
        );
        return {
          order_detail_id: role!.order_detail_id,
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
```

- [ ] **Step 4: Update `selectAllInGroup` for two-level structure**

Since `selectAllInGroup` currently selects all roles in a board_type, keep that behavior. But now get roles from the nested map:

```ts
  const selectAllInGroup = (bt: string) => {
    const subGroups = grouped.get(bt);
    if (!subGroups) return;
    const allRoles: PartRole[] = [];
    for (const roles of subGroups.values()) {
      allRoles.push(...roles);
    }
    const fps = allRoles.map((r) => roleFingerprint(r.order_detail_id, r.board_type, r.part_name, r.length_mm, r.width_mm));
    const allSelected = fps.every((fp) => selected.has(fp));
    if (allSelected) {
      setSelected(new Set());
      setSelectedBoardType(null);
    } else {
      setSelected(new Set(fps));
      setSelectedBoardType(bt);
    }
  };
```

- [ ] **Step 5: Rewrite the board type groups rendering with sub-group headers**

Replace the `{boardTypes.map((bt) => { ... })}` block. The outer loop iterates board types. Inside, iterate `order_detail_id` sub-groups. Each sub-group gets a header with product name and board/edging comboboxes.

```tsx
        {boardTypes.map((bt) => {
          const subGroups = grouped.get(bt);
          if (!subGroups) return null;
          const allRoles: PartRole[] = [];
          for (const roles of subGroups.values()) {
            allRoles.push(...roles);
          }
          const isCollapsed = collapsed[bt] ?? false;
          const groupAssigned = allRoles.filter((r) => r.assigned_component_id != null).length;

          return (
            <div key={bt} className="rounded-sm border">
              {/* Board type header — same as before */}
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
                  {allRoles.length} part{allRoles.length > 1 ? 's' : ''}
                </span>
                <Badge
                  variant={groupAssigned === allRoles.length ? 'default' : 'outline'}
                  className="ml-auto text-xs"
                >
                  {groupAssigned}/{allRoles.length}
                </Badge>
              </button>

              {!isCollapsed && (
                <div className="border-t">
                  {/* Select all in board type */}
                  <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-1">
                    <Checkbox
                      checked={allRoles.every((r) =>
                        selected.has(roleFingerprint(r.order_detail_id, r.board_type, r.part_name, r.length_mm, r.width_mm)),
                      )}
                      onCheckedChange={() => selectAllInGroup(bt)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="text-xs text-muted-foreground">Select all</span>
                  </div>

                  {/* Sub-groups by order line */}
                  {Array.from(subGroups.entries()).map(([orderDetailId, roles], lineIdx) => {
                    const lineLabel = roles[0]?.line_product_name || `Line ${lineIdx + 1}`;

                    // Determine if all roles in this sub-group share the same assigned board
                    const assignedIds = new Set(roles.map((r) => r.assigned_component_id).filter(Boolean));
                    const subGroupBoardId = assignedIds.size === 1 ? [...assignedIds][0] : null;
                    const subGroupBoardName = subGroupBoardId
                      ? roles.find((r) => r.assigned_component_id === subGroupBoardId)?.assigned_component_name ?? ''
                      : '';

                    // Edging: show if any part in sub-group has edges and a board is assigned
                    const hasEdgedParts = roles.some((r) => r.has_edges && r.assigned_component_id != null);
                    const edgingDefault = subGroupBoardId
                      ? edgingDefaults.find((ed) => ed.board_component_id === subGroupBoardId)
                      : null;

                    return (
                      <div key={orderDetailId} className="border-b last:border-0">
                        {/* Sub-group header */}
                        <div className="flex items-center gap-3 bg-muted/10 px-3 py-1.5 border-b">
                          <span className="text-xs font-medium text-foreground truncate min-w-0">
                            {lineLabel}
                            <span className="text-muted-foreground font-normal ml-1.5">
                              Line {lineIdx + 1}, Qty {roles[0]?.total_quantity ?? 0}
                            </span>
                          </span>
                          <div className="ml-auto flex items-center gap-2">
                            <BoardMaterialCombobox
                              boards={boards}
                              boardType={bt}
                              value={subGroupBoardId ?? null}
                              onChange={(id, name) => {
                                // Bulk-assign all parts in this sub-group
                                const bulkRoles = roles.map((r) => ({
                                  order_detail_id: r.order_detail_id,
                                  board_type: r.board_type,
                                  part_name: r.part_name,
                                  length_mm: r.length_mm,
                                  width_mm: r.width_mm,
                                }));
                                onAssignBulk(bulkRoles, id, name);
                              }}
                              placeholder="Assign board…"
                              className="h-7 w-[200px] text-xs"
                            />
                            {hasEdgedParts && subGroupBoardId && (
                              <BoardMaterialCombobox
                                boards={edgingComponents}
                                boardType={null}
                                value={edgingDefault?.edging_component_id ?? null}
                                onChange={(id, name) => onEdgingDefault(subGroupBoardId, id, name)}
                                placeholder="Edging…"
                                className="h-7 w-[180px] text-xs"
                              />
                            )}
                          </div>
                        </div>

                        {/* Part rows within sub-group */}
                        {roles.map((role) => {
                          const fp = roleFingerprint(role.order_detail_id, role.board_type, role.part_name, role.length_mm, role.width_mm);
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
                              </div>
                              <BoardMaterialCombobox
                                boards={boards}
                                boardType={role.board_type}
                                value={role.assigned_component_id}
                                onChange={(id, name) =>
                                  onAssign(role.order_detail_id, role.board_type, role.part_name, role.length_mm, role.width_mm, id, name)
                                }
                                className="h-8 w-[240px] text-xs"
                              />
                              {role.has_edges && (
                                <>
                                  {expandedOverrides.has(fp) || edgingOverrides.some(
                                    (eo) => roleFingerprint(eo.order_detail_id, eo.board_type, eo.part_name, eo.length_mm, eo.width_mm) === fp,
                                  ) ? (
                                    <BoardMaterialCombobox
                                      boards={edgingComponents}
                                      boardType={null}
                                      value={
                                        edgingOverrides.find(
                                          (eo) => roleFingerprint(eo.order_detail_id, eo.board_type, eo.part_name, eo.length_mm, eo.width_mm) === fp,
                                        )?.edging_component_id ?? null
                                      }
                                      onChange={(id, name) =>
                                        onEdgingOverride(role.order_detail_id, role.board_type, role.part_name, role.length_mm, role.width_mm, id, name)
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
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
```

Note: The old board-level edging combobox IIFE block (`boardsInGroup` map) is removed — edging is now on sub-group headers instead.

- [ ] **Step 6: Remove the `product_names` display from part rows**

The old code showed `role.product_names.join(', ')` under each part name. Since parts are now grouped by order line and the product name is in the sub-group header, remove this block (the `{role.product_names.length > 0 && (...)}` section from the old part rows).

- [ ] **Step 7: Update `toggleSelect` fingerprint call**

```ts
  const toggleSelect = (role: PartRole) => {
    const fp = roleFingerprint(role.order_detail_id, role.board_type, role.part_name, role.length_mm, role.width_mm);
```

- [ ] **Step 8: Commit**

```bash
git add components/features/orders/MaterialAssignmentGrid.tsx
git commit -m "feat: two-level grid grouping by order line within board type"
```

---

## Task 5: Update CuttingPlanTab Prop Wiring

**Files:**
- Modify: `components/features/orders/CuttingPlanTab.tsx`

- [ ] **Step 1: Verify no changes needed**

The `CuttingPlanTab` passes `b.assign`, `b.assignBulk`, `b.setEdgingDefault`, `b.setEdgingOverride` directly as props to `MaterialAssignmentGrid` (lines 97-104). Since these functions come from `useCuttingPlanBuilder` → `useMaterialAssignments`, and their signatures widened in Task 3, the pass-through works automatically. TypeScript will enforce the match.

Run: `npx tsc --noEmit components/features/orders/CuttingPlanTab.tsx 2>&1 | head -20`

If there are type errors, they indicate a signature mismatch — fix by ensuring the callback props match the widened hook signatures.

- [ ] **Step 2: Commit (if any changes were needed)**

```bash
git add components/features/orders/CuttingPlanTab.tsx
git commit -m "fix: align CuttingPlanTab props with widened assignment signatures"
```

---

## Task 6: Update API Validation

**Files:**
- Modify: `app/api/orders/[orderId]/material-assignments/route.ts`

- [ ] **Step 1: Verify validation update**

The API route calls `validateAssignments(body)` which was updated in Task 1 to require `order_detail_id` on assignments and edging overrides. No direct changes needed in the route file — the validation function handles it.

Run: `npx tsc --noEmit app/api/orders/[orderId]/material-assignments/route.ts 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 2: Commit (if any changes were needed)**

Only commit if there were type errors to fix. Otherwise skip this step.

---

## Task 7: Full Build Verification

- [ ] **Step 1: Run TypeScript check**

Run: `npx tsc --noEmit 2>&1 | head -50`

Expected: Clean (or only pre-existing unrelated errors). If there are new errors, fix them — they indicate a missed `order_detail_id` threading.

- [ ] **Step 2: Run linter**

Run: `npm run lint 2>&1 | head -50`

Expected: Clean or pre-existing warnings only.

- [ ] **Step 3: Test in browser**

1. Navigate to an order with cutlist products: `http://localhost:3000/orders/<id>`
2. Go to the Cutting Plan tab
3. Verify the grid shows sub-groups per order line within each board type
4. Assign different materials to different lines
5. Assign edging via the sub-group header
6. Test bulk select across sub-groups
7. Hit Generate and verify it produces a valid cutting plan
8. Verify the scissors override still works on individual parts

- [ ] **Step 4: Verify with multiple same-product lines**

Create or find an order with the same product on two different lines. Verify:
- Both lines show as separate sub-groups
- Each can be assigned a different board material
- Generating merges parts with the same material for packing (check sheet count matches expectations)

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: per-order-line material assignment complete"
```
