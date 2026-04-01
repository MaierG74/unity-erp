# Per-Order-Line Material Assignment — Design Spec

**Date:** 2026-04-01
**Branch:** `codex/local-material-assignment` (continues existing work)
**Status:** Approved

## Problem

The material assignment grid groups parts by role fingerprint (`board_type|part_name|length_mm|width_mm`), merging identical parts across order lines. When the same product appears on multiple lines with different color requirements (e.g., 10 cupboards in black + 10 in white), users cannot assign different board materials per line.

## Solution

Add `order_detail_id` to the role fingerprint so each order line's parts are separate rows in the assignment grid. Users assign materials per line. The downstream packing algorithm still merges parts by assigned material for optimal nesting — the separation only affects the assignment step.

## Approach: Option A — Widen the Fingerprint Key

Extend the existing flat fingerprint pattern with `order_detail_id` as the leading segment. Every type and function that uses the four-field key (`board_type`, `part_name`, `length_mm`, `width_mm`) gains the fifth field. No structural JSONB redesign, no new code paths.

### Why not nested JSONB (Option B)?

Restructuring `MaterialAssignments` into `{ [board_type]: { [order_detail_id]: assignment[] } }` would require rewriting every function (find, upsert, bulk, validate) plus the API validation. Much more churn for no functional benefit.

### Why not a parallel `line_assignments` map (Option C)?

Adding a separate lookup map creates two code paths and confusing precedence rules. The flat fingerprint approach is simpler and already proven.

---

## Section 1: Type & Fingerprint Changes

**File:** `lib/orders/material-assignment-types.ts`

### `roleFingerprint()`

```
Before: board_type|part_name|length_mm|width_mm
After:  order_detail_id|board_type|part_name|length_mm|width_mm
```

New signature: `roleFingerprint(orderDetailId: number, boardType: string, partName: string, lengthMm: number, widthMm: number): string`

### `MaterialAssignment`

Gains `order_detail_id: number`.

### `EdgingOverride`

Gains `order_detail_id: number`.

### `PartRole`

Gains:
- `order_detail_id: number`
- `line_product_name: string` — product name for the grid sub-group header
- `line_quantity: number` — line quantity for the grid sub-group header

`product_names: string[]` stays for backward compat but will always be a single-element array.

### `EdgingDefault`

**No change.** Stays keyed by `board_component_id` globally. If the same board material is used on two lines, they share the same edging default. The per-part override (scissors button) handles exceptions.

### Pure functions

- `findAssignment()` — gains `orderDetailId` parameter, matches on all five fields
- `upsertAssignment()` — gains `order_detail_id` on the `MaterialAssignment` being upserted
- `bulkAssign()` — role keys include `order_detail_id`
- `validateAssignments()` — checks `order_detail_id` is present and positive on each assignment and edging override
- `buildPartRoles()` — stops merging across `order_detail_id`. The fingerprint map key includes it, so same-dimension parts from different lines produce separate `PartRole` entries. Populates `line_product_name` and `line_quantity` from `AggregatedPart`.

### JSONB version

Stays `1`. Old data without `order_detail_id` won't match any roles — the grid shows everything as unassigned and the user re-picks. Acceptable for pre-production.

---

## Section 2: Grid Layout Changes

**File:** `components/features/orders/MaterialAssignmentGrid.tsx`

### Grouping hierarchy

```
Before: board_type → [part roles]
After:  board_type → order_detail_id sub-groups → [part roles]
```

### Sub-group header

Each sub-group within a board type gets a header row:

```
TestChair LC2 (Line 1, Qty 10)    Board: [Black Melamine ▾]  Edging: [Black PVC ▾]
  Left Side    1726×490mm  ×10
  Right Side   1726×490mm  ×10

TestChair LC2 (Line 2, Qty 10)    Board: [White Melamine ▾]  Edging: [White PVC ▾]
  Left Side    1726×490mm  ×10
  Right Side   1726×490mm  ×10
```

- "Line 1", "Line 2" is positional ordering within the board type group, not stored
- Board material combobox on the header bulk-assigns all parts in that sub-group
- Edging combobox appears when any parts in the sub-group have edges and a board is assigned

### Board-level edging combobox

Moves from per-board-type to per-sub-group header. Still keyed by `board_component_id` globally — the combobox reads/writes the same `EdgingDefault`. If two sub-groups assign the same board, they show the same edging default value.

### Bulk select

Stays scoped to one `board_type`. Users can select parts across sub-groups (different lines) and bulk-assign them all to the same material.

### Backer default

Unchanged — single global combobox at the top.

### Per-part rows

Identical to today: checkbox, part name, dimensions, qty, board combobox, scissors override. Qty reflects one line instead of merged totals.

---

## Section 3: Hook & Data Flow Changes

### `hooks/useMaterialAssignments.ts`

- `assign()` gains `orderDetailId` parameter, passes through to `upsertAssignment`
- `assignBulk()` — role keys include `order_detail_id`
- `setEdgingOverride()` gains `orderDetailId` parameter
- `setEdgingDefault()` — unchanged (global by `board_component_id`)
- No structural changes — wider signatures to thread the extra field

### `hooks/useCuttingPlanBuilder.ts`

- `buildPartRoles` call unchanged (internal change only)
- `canGenerate` edging check unchanged (global `board_component_id`)
- `regroupByAssignedMaterial` call passes `part.order_detail_id` to `findAssignment`
- Regroup key stays `board_type|component_id|backer_id` (material-based, not line-based) — parts with the same assigned material still merge for packing

### `lib/orders/edging-computation.ts`

- `resolveEdgingForPart()` gains `orderDetailId` parameter for override lookup with the wider fingerprint
- `EdgingDefault` lookup unchanged (keyed by `board_component_id`)
- `computeEdging()` passes `part.order_detail_id` through (`AggregatedPart` already carries it)

### `lib/orders/material-regroup.ts`

- `findAssignment()` call gains `part.order_detail_id` (already available on `AggregatedPart`)

### `app/api/orders/[orderId]/material-assignments/route.ts`

- `validateAssignments` handles the new `order_detail_id` field (covered in Section 1)
- No other API changes

---

## Section 4: Migration & Edge Cases

### Existing JSONB data

Assignments without `order_detail_id` won't match any `PartRole`. Grid shows them as unassigned. User re-picks. No data migration needed (pre-production).

### Single-product orders

Grid still shows sub-group header ("ProductName (Line 1, Qty 5)"). Slightly more verbose but consistent — no special-casing.

### Same product on multiple lines

Core use case. Each line is its own sub-group with independent material + edging choices.

### Bulk assign across sub-groups

Works within one `board_type`. Select parts from different lines, assign once. Covers the common case where lines want the same board.

---

## What Does NOT Change

- Aggregate endpoint — already has `order_detail_id` on each `AggregatedPart`
- Packing algorithm — works on regrouped data, doesn't care about line origin
- `regroupByAssignedMaterial` grouping key — still `board_type|component_id|backer_id`
- Cutting plan JSONB shape — unchanged
- `BoardMaterialCombobox` component — unchanged
- `computeEdging` logic — unchanged (just wider parameter on override lookup)
- Database schema — no migration needed
- `EdgingDefault` type and keying — stays global per `board_component_id`

## Files to Modify

| File | Change |
|------|--------|
| `lib/orders/material-assignment-types.ts` | Types, fingerprint, pure functions, validation |
| `hooks/useMaterialAssignments.ts` | Wider signatures on mutation methods |
| `hooks/useCuttingPlanBuilder.ts` | Thread `order_detail_id` through canGenerate edging check (minor) |
| `components/features/orders/MaterialAssignmentGrid.tsx` | Sub-group layout, header comboboxes, props |
| `lib/orders/material-regroup.ts` | `findAssignment` call gains `order_detail_id` |
| `lib/orders/edging-computation.ts` | `resolveEdgingForPart` gains `orderDetailId` |
| `app/api/orders/[orderId]/material-assignments/route.ts` | Validation update (via `validateAssignments`) |
