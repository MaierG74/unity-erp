# Edging Computation for Cutting Plan

**Date:** 2026-04-01
**Status:** Draft
**Depends on:** Order-Level Material Assignment (implemented on `codex/local-material-assignment`)

## v2 — extended for line-level edging primary + auto-pair learning

Phase B of the [cutlist material swap and surcharge design](./2026-04-29-cutlist-material-swap-and-surcharge-design.md) adds an order-line cutlist material dialog. The dialog writes `cutlist_primary_edging_id` and per-part `cutlist_part_overrides`, then rebuilds `cutlist_material_snapshot` with per-part `effective_edging_id` / `effective_edging_name` fields. `board_edging_pairs` is now the suggestion table for board + thickness defaults: first-time pairs are learned silently, conflicting existing defaults prompt the operator to update the default or keep the decision on the line only.

## Problem

The cutting plan currently saves `edging_by_material: []` and never emits `cutlist_edging` overrides. Confirming a "fresh" plan zeros out edge-banding demand in purchasing. Users assign board materials but have no way to specify which edging goes with each board — and edging isn't always a simple thickness lookup because two-tone orders need different edging colors per board material, with occasional per-part exceptions.

## Solution Overview

Extend the material assignment system with **edging defaults** (one edging per assigned board material) and **per-part edging overrides** (for exceptions like black edging on a cherry table top). The generate flow computes edging lengths from `band_edges` + part dimensions, maps to edging component IDs via the assignment data, and emits both `edging_by_material[]` entries and `cutlist_edging` overrides for purchasing.

---

## Data Model

### Extended `MaterialAssignments` JSONB

Two new fields added to the existing `orders.material_assignments` JSONB (no migration needed — JSONB is schema-flexible):

```jsonc
{
  "version": 1,
  "assignments": [...],           // existing board assignments (unchanged)
  "backer_default": {...},        // existing (unchanged)

  "edging_defaults": [
    {
      "board_component_id": 315,        // which board assignment this edging belongs to
      "edging_component_id": 401,       // FK to components.component_id (category 39)
      "edging_component_name": "Brookhill PVC 16mm"
    }
  ],

  "edging_overrides": [
    {
      "board_type": "16mm",             // role fingerprint fields for lookup
      "part_name": "Top",
      "length_mm": 800,
      "width_mm": 500,
      "edging_component_id": 410,       // overrides the board-level default
      "edging_component_name": "Black PVC 16mm"
    }
  ]
}
```

### Key Design Decisions

**Edging defaults keyed by `board_component_id`:** When the user assigns "Brookhill Oak 16mm" (component 315) to carcass parts, they also pick "Brookhill PVC 16mm" (component 401) as the edging for that board. Every part assigned to board 315 inherits edging 401 unless overridden.

**Edging overrides keyed by role fingerprint:** Same `board_type|part_name|length_mm|width_mm` key as board assignments. Looked up first — if present, takes precedence over the board-level default.

**No separate edging assignment for backers:** Backer boards (e.g., Supawood 3mm) don't get edged — they're internal panels. Only primary board assignments need paired edging.

---

## Types

### New Types (add to `lib/orders/material-assignment-types.ts`)

```typescript
export type EdgingDefault = {
  board_component_id: number;     // links to a board assignment's component_id
  edging_component_id: number;    // FK to components (category 39 = Edging)
  edging_component_name: string;
};

export type EdgingOverride = {
  board_type: string;
  part_name: string;
  length_mm: number;
  width_mm: number;
  edging_component_id: number;
  edging_component_name: string;
};
```

### Updated `MaterialAssignments`

```typescript
export type MaterialAssignments = {
  version: 1;
  assignments: MaterialAssignment[];
  backer_default: BackerDefault | null;
  edging_defaults: EdgingDefault[];       // NEW
  edging_overrides: EdgingOverride[];     // NEW
};
```

The `EMPTY` sentinel and `validateAssignments` must be updated to include the new fields with empty-array defaults.

---

## UI Changes

### MaterialAssignmentGrid

**1. Board-level edging combobox:**

When a board material is assigned to one or more parts, a secondary edging combobox appears next to the board assignment. This is rendered at the **group header level** (not per-row) — one per unique assigned board component within a board_type group.

Visual: below or beside the board_type group header, a row per distinct board assignment showing:
```
Brookhill Oak 16mm (7 parts)  →  Edging: [Brookhill PVC 16mm ▾]
White Melamine 16mm (3 parts) →  Edging: [White PVC 16mm ▾]
```

The edging combobox filters to category 39 (Edging) components. No thickness filtering for now — users know which edging matches their board.

**2. Per-part edging override:**

Each part row gets a small icon button (e.g., a pencil or scissors icon) that, when clicked, reveals an inline edging combobox for that specific part. Most rows will never use this — it's for the rare exception case (cherry top → black edging).

When an override is set, the row shows a small badge or indicator so it's visually distinct from inherited edging.

**3. Compulsory check:**

Generation is blocked until every board assignment that has parts with `band_edges` (at least one edge true) also has an edging default set. Parts with no edges (`band_edges` all false) don't need edging.

### New Component: `EdgingMaterialCombobox`

Reuses the same `BoardMaterialCombobox` pattern but filters to edging category (39) instead of board categories. Could be the same component with a `categoryFilter` prop, or a thin wrapper. The combobox should show edging component descriptions (e.g., "Brookhill PVC 16mm", "Black PVC 22mm").

### Hook: `useEdgingComponents`

Similar to `useBoardComponents` — queries `components` where `category_id = 39` and `is_active = true`. Can derive from a shared base hook or be a standalone query with `staleTime: 5min`.

---

## Generate Flow Changes

### Edging Length Computation

After packing produces `LayoutResult` per material group, compute edging for each group:

```
For each part in the group:
  If part has any band_edges = true:
    edging_length = 0
    if band_edges.top:    edging_length += part.length_mm * part.quantity
    if band_edges.bottom: edging_length += part.length_mm * part.quantity
    if band_edges.left:   edging_length += part.width_mm * part.quantity
    if band_edges.right:  edging_length += part.width_mm * part.quantity

    Resolve edging component:
      1. Check edging_overrides for this part's fingerprint
      2. Fall back to edging_defaults for this part's assigned board_component_id
      3. If neither found → should be blocked by UI, but guard anyway

    Accumulate: edging_totals[edging_component_id] += edging_length
```

Note: this computes edging from the **original part dimensions × quantity**, not from the packing placements. This is the correct approach because edge banding is applied to individual panels before they go on the sheet — it doesn't depend on how they're arranged.

### Build `edging_by_material`

Convert the accumulated `edging_totals` map into `CuttingPlanEdgingEntry[]` for each material group:

```typescript
edging_by_material: [
  {
    component_id: 401,
    component_name: "Brookhill PVC 16mm",
    thickness_mm: 16,
    length_mm: 45600,    // total mm across all parts
    unit: 'mm',
  },
  {
    component_id: 410,
    component_name: "Black PVC 16mm",
    thickness_mm: 16,
    length_mm: 2600,     // just the overridden parts
    unit: 'mm',
  },
]
```

### Build `cutlist_edging` Overrides

Aggregate edging across ALL material groups into `component_overrides`:

```typescript
component_overrides: [
  // ...existing cutlist_primary and cutlist_backer entries...
  { component_id: 401, quantity: 45600, unit: 'mm', source: 'cutlist_edging' },
  { component_id: 410, quantity: 2600,  unit: 'mm', source: 'cutlist_edging' },
]
```

### Edging Thickness Resolution

The `CuttingPlanEdgingEntry` requires `thickness_mm`. This comes from the edging material's description (parsed via `parseThicknessFromDescription`). Alternatively, since the generate flow already has the `BoardComponent` data (which includes `parsed_thickness_mm`), we can extend the edging components query to include parsed thickness. Fall back to the board's sheet thickness if parsing fails.

---

## Persistence & Stale Marking

No new persistence mechanism needed — edging defaults and overrides are stored inside the existing `material_assignments` JSONB. The existing PATCH endpoint and stale-marking apply automatically.

When edging assignments change (via the same auto-save debounce), the cutting plan is marked stale — same as board assignment changes.

---

## Validation Changes

`validateAssignments()` must validate the two new fields:

- `edging_defaults`: array of objects, each with valid `board_component_id`, `edging_component_id` (positive numbers), and non-empty `edging_component_name`
- `edging_overrides`: array of objects, each with valid fingerprint fields (`board_type`, `part_name`, `length_mm`, `width_mm` — same rules as board assignments) plus valid `edging_component_id` and `edging_component_name`

---

## What Parts Need Edging?

A part needs edging if ANY of its `band_edges` values is `true`. The aggregate endpoint already passes through `band_edges` from the snapshot. The UI uses this to determine:

1. Whether a board assignment needs a paired edging default (at least one part with edges)
2. Whether the "override edging" button appears on a part row (only if that part has edges)
3. Whether generation should be blocked (unresolved edging for parts with edges)

Parts with all `band_edges = false` (e.g., back panels, internal shelves) need no edging and are ignored in the edging computation.

---

## Scope Boundaries

**In scope:**
- `edging_defaults` and `edging_overrides` in MaterialAssignments JSONB
- Types: `EdgingDefault`, `EdgingOverride`
- `useEdgingComponents` hook (category 39 query)
- Board-level edging combobox in MaterialAssignmentGrid group headers
- Per-part edging override button + inline combobox
- Edging length computation in generate flow (from `band_edges` + dimensions)
- `edging_by_material[]` population per material group
- `cutlist_edging` override emission in `component_overrides`
- Compulsory check: block generate if edging unresolved for parts with edges
- Validation of new fields in `validateAssignments`

**Out of scope:**
- Edging cost computation (deferred — needs cost-per-meter from supplier data)
- Per-component stock sheet resolution (deferred — DEFAULT_STOCK is fine for now)
- Edging width/thickness display in the grid (nice-to-have, not blocking)
- Edging assignment for backer boards (backers don't get edged)
