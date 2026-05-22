# RoomCraft Lateral Measurements Design

## Goal

Add along-wall measurement lines that show the gap between a selected block's edge and the nearest edge of an opening on a facing wall. This lets users answer "what size unit can I fit between this shelf and the archway?"

## Context

The existing measurement overlay (`computeMeasurementLines`) already draws four perpendicular lines from the selected block to the nearest obstacle in each cardinal direction (wall, adjacent block, or opening). It colours the line blue when the target is an opening.

A lateral measurement is orthogonal to this: it runs *parallel* to the wall, showing the floor space available alongside the block up to where an opening begins.

## Behaviour

A lateral measurement is emitted for a given wall when:

1. The wall has at least one opening (regular `room.openings` or shared `floorPlan.sharedOpenings`).
2. That opening's nearest edge falls **outside** the block's parallel span — i.e., the opening is beside the block, not directly in front of it.
3. The resulting gap is greater than 0 mm.

One `LateralMeasurement` is emitted per qualifying opening edge. Multiple openings on the same wall each produce their own lateral line if they qualify.

## Data Model

```typescript
// measurementLines.ts — new export alongside MeasurementLine
export interface LateralMeasurement {
  wall: 'north' | 'south' | 'east' | 'west';
  gapMm: number;         // available space between block edge and opening edge
  parallelStart: number; // room-local coord of the block's nearest edge
  parallelEnd: number;   // room-local coord of the opening's nearest edge
  perpCoord: number;     // where the line sits (block's face toward the wall)
}
```

### Coordinate conventions

| Wall | Parallel axis | `parallelStart/End` meaning | `perpCoord` |
|------|--------------|-----------------------------|-------------|
| north | X | block west/east edge → opening edge | `aabb.minY` |
| south | X | block west/east edge → opening edge | `aabb.maxY` |
| east  | Y | block north/south edge → opening edge | `aabb.maxX` |
| west  | Y | block north/south edge → opening edge | `aabb.minX` |

`parallelStart` is always the block edge; `parallelEnd` is always the opening edge. Either `parallelStart < parallelEnd` (opening is to the right/south of the block) or `parallelStart > parallelEnd` (opening is to the left/north). The drawing code handles both orderings.

### Opening position resolution

Regular openings: `position` is room-local mm from the wall's start.

Shared openings: use `wallIdToLocalStart[wallId] + so.position` to get the room-local position, identical to the approach already used in `computeMeasurementLines`.

## API

```typescript
export function computeLateralMeasurements(
  block: RoomItem,
  room: Room,
  layers: Layer[],
  floorPlan?: FloorPlan,
): LateralMeasurement[]
```

Lives in `measurementLines.ts` alongside `computeMeasurementLines`. Pure function, no side effects.

## Drawing

Called inside `drawBlockMeasurements` in `useCanvasRenderer.ts`, immediately after the existing perpendicular lines.

- **Line**: runs parallel to the wall at `perpCoord` (block's face toward the wall), from `parallelStart` to `parallelEnd` in room-local mm, scaled and offset to canvas coordinates.
- **End ticks**: same style as perpendicular measurement ticks.
- **Label**: gap in mm, centred on the line, same font/style as existing labels.
- **Colour**: `#2563EB` (blue — same as opening colour, because the gap is bounded by an opening).
- **Zero gaps**: omit (gap > 0 check in `computeLateralMeasurements`).

## Files Changed

| File | Change |
|------|--------|
| `components/features/roomcraft/utils/measurementLines.ts` | Add `LateralMeasurement` interface; add `computeLateralMeasurements()` |
| `components/features/roomcraft/hooks/useCanvasRenderer.ts` | Call `computeLateralMeasurements` in `drawBlockMeasurements`; draw lateral lines |
| `tests/roomcraft-measurement-lines.test.ts` | Tests for `computeLateralMeasurements` |

No changes to `RoomContext`, `Sidebar`, `RoomCanvas`, or any type files.

## Test Cases

1. Opening to the right of block on south wall → one lateral line with correct `gapMm`, `parallelStart = aabb.maxX`, `parallelEnd = opening.position`
2. Opening to the left of block on south wall → `parallelStart = aabb.minX`, `parallelEnd = opening.position + opening.width`
3. Opening directly in front of block (spans the block's parallel range) → no lateral measurement emitted
4. Shared opening to the side of block → lateral line using `localStart + so.position`
5. Block on invisible layer → excluded from consideration (existing `visibleLayerIds` filter)
6. Multiple openings on same wall → one lateral line per qualifying opening
