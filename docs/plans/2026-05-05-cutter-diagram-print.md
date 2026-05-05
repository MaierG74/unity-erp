# Cutter Diagram Print Plan

## Scope

POL-92 Phase 1 adds order-page, per-material cutter cut-list PDFs from the Cutting Plan tab. It is a client-side print/download surface only: no schema, no storage, no API mutation, no RLS policy, and no migration.

Phase 2 remains deferred. Job-card detail printing, cutter-pack bundling, swim-lane scheduling, feed-rate estimation, and persisted kerf/trim settings need separate planning.

## Data Flow

`useCuttingPlanBuilder` already loads the order cutlist aggregate and the saved or pending `displayPlan`. POL-92 adds a read-only `partLabelMap` derived from that aggregate:

```text
AggregateResponse.material_groups[].parts[]
  -> buildPartLabelMap()
  -> Map<AggregatedPart.id, "Product - Part">
  -> CuttingPlanTab
  -> CutterCutListButton
  -> CutterCutListPDF
```

The PDF resolves each placement designation with:

```text
partLabelMap.get(getBasePartName(placement.part_id)) ?? placement.label ?? placement.part_id
```

This keeps the enrichment additive and leaves `toPartSpecs()` unchanged.

## Phase 1 Decisions

- Print actions live per row in the Cutting Plan tab Material Breakdown table.
- Non-backer groups produce one primary PDF.
- Backer groups produce separate primary and backer PDFs so different cutters can run them independently.
- Cover statistics are limited to Sheets, Parts, and Waste %.
- Panel summary rows are grouped by distinct stock-sheet shape and always render.
- PDF text uses ASCII-only labels such as `Total Area mm2`, `|`, `-`, and `o`.
- `optimization_quality` is not shown or threaded through this print surface; POL-93 owns that follow-up.
- Edge-band marks use `getPlacedBandEdges(placement)` so rotated placements show banding on placed-rectangle edges.

## Files

- `components/features/cutlist/CutterCutListButton.tsx` lazy-loads React PDF and the document.
- `components/features/cutlist/CutterCutListPDF.tsx` renders the cover and per-sheet pages.
- `lib/cutlist/cutter-cut-list-types.ts` stores shared non-React-PDF types.
- `lib/cutlist/cutter-cut-list-helpers.ts` stores label-map, filename, backer-gating, and edge-rotation helpers.
- `hooks/useCuttingPlanBuilder.ts` exposes the derived label map and readiness flag.
- `components/features/orders/CuttingPlanTab.tsx` adds the row actions.
- `app/orders/[orderId]/page.tsx` passes order number and customer name into the tab.

## Rollback

Revert the POL-92 merge commit. The Cutting Plan tab print actions disappear, and the existing standalone cutlist diagram and job-card PDFs are unaffected.
