# RoomCraft Measurement Overlay — Design Spec

**Date:** 2026-05-22  
**Branch target:** `feature/roomcraft-integration` → `codex/integration`  
**Status:** Approved, ready for implementation planning

---

## Overview

When a user selects a furniture block on the RoomCraft canvas, they need to know the exact gap between that block and its surroundings (walls, openings, neighbouring blocks). Today they have to mentally reconstruct this from wall-segment labels and block positions. A measurement overlay solves this directly.

---

## Feature Behaviour

### Toggle

A **Measurements** toggle is added to the Views tab in the RoomCraft sidebar, alongside the existing Clearance and 3D View toggles. It is off by default.

The overlay is active when **both** conditions are true:
- Measurements toggle is **on**
- A block is **selected** (`state.selectedBlockId` is set)

When either condition is false, no dimension lines are drawn.

### What is measured

For each of the four sides of the selected block (north, south, east, west), find the **nearest target** in that direction within the room:

1. **Nearest neighbouring block edge** — any other block on any visible layer whose footprint overlaps the projection of the selected block's side
2. **Nearest opening edge** — any door, archway, or window on the wall that side faces, if the opening's span overlaps the side's projection
3. **Wall** — fallback if no block or opening is closer

The gap is the distance in mm from the selected block's edge to the nearest target. A gap of 0mm is valid (block flush against wall or another block) and is shown.

Only one dimension line is drawn per side — the nearest target wins.

### Visual style

Classic CAD-style extension lines:

- **Extension lines** run perpendicular from the block edge to the target edge, offset 12px outward so they don't overlap the block stroke
- **Arrowheads** at both ends of the dimension line (filled triangles, 5px)
- **Label** — white-filled rectangle background, mm value centred on the dimension line, `12px system-ui` font, bold
- **Colour by target type:**
  - Grey (`#6B7280`) — wall target
  - Blue (`#2563EB`) — opening target
  - Orange (`#EA580C`) — neighbouring block target

Lines are drawn on top of the normal canvas render pass (last draw call in `useCanvasRenderer`).

### Scope

- Top-down 2D view only — no overlay in 3D (Three.js) view
- Works at any zoom level (all measurements are in room-mm, converted via `scale`)
- Works on locked rooms in read-only mode (measurements are read-only by nature)
- Works with grouped blocks — measures the selected block's own footprint, not the group bounding box

---

## Architecture

### New file: `utils/measurementLines.ts`

Pure utility — no React, no canvas side effects. Exports one function:

```typescript
export interface MeasurementLine {
  side: 'north' | 'south' | 'east' | 'west';
  gapMm: number;
  targetType: 'wall' | 'opening' | 'block';
  // Block-space coordinates of the selected block's edge midpoint
  // and the target edge — used by renderer to draw extension + dim line
  blockEdge: number;   // along-wall coordinate of selected block's near edge
  targetEdge: number;  // along-wall coordinate of target
  transverse: number;  // perpendicular coordinate (the wall's position)
}

export function computeMeasurementLines(
  block: RoomItem,
  room: Room,
  layers: Layer[],
): MeasurementLine[];
```

Logic per side:
1. Project the side outward to find the relevant wall
2. Collect all openings on that wall whose span overlaps the block's edge projection
3. Collect all other visible blocks whose footprint projection overlaps the block's edge projection
4. Return the nearest, with its type and gap distance

### State

One new boolean field on `RoomState`: `showMeasurements: boolean` (default `false`).

New action: `TOGGLE_MEASUREMENTS` — flips `showMeasurements`.

### Renderer change: `useCanvasRenderer.ts`

After the existing top-down draw pass, when `showMeasurements && selectedBlockId && !showIsometric`:
1. Find the selected block in `activeRoom.items`
2. Call `computeMeasurementLines(block, activeRoom, floorPlan.layers)`
3. For each `MeasurementLine`, draw the extension lines, arrowheads, and label using the canvas context and current `scale` / `offset`

Drawing is handled inline in the renderer (not a separate hook) — it is a straightforward canvas draw sequence, not complex enough to warrant its own abstraction.

### Sidebar change: `Sidebar.tsx`

In the Views tab, add a third toggle row for **Measurements**, dispatching `TOGGLE_MEASUREMENTS`.  Follows the same markup pattern as Clearance and 3D View toggles.

---

## Files to change

| File | Change |
|------|--------|
| `context/RoomContext.tsx` | Add `showMeasurements` to `RoomState`, default `false` |
| `context/blockReducer.ts` | Handle `TOGGLE_MEASUREMENTS` action |
| `utils/measurementLines.ts` | **New** — gap computation logic |
| `hooks/useCanvasRenderer.ts` | Call measurement draw pass after top-down render |
| `components/ui/Sidebar.tsx` | Add Measurements toggle to Views tab |

---

## Verification

```bash
npm run lint
npx tsc --noEmit 2>&1 | Select-String "measurementLines|useCanvasRenderer|Sidebar"
```

Browser:
1. Open `/roomcraft/<projectId>`, go to Views tab → toggle Measurements on
2. Click a shelf block flush against a wall — should show 0mm on that side, grey
3. Click a block next to an archway — blue line on the archway side, label matches the gap you'd calculate manually
4. Click a block adjacent to another block — orange line on the shared side
5. Zoom in and out — lines and labels scale correctly
6. Switch to 3D View — no overlay appears in Three.js scene
7. Deselect block (click canvas) — all lines disappear

---

## Out of scope (v1)

- Angular/diagonal measurements
- Multi-block selection measurements
- Measurements in 3D view
- Hover-to-measure (no block selection required)
- Export/print of measurement annotations
