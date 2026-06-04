# RoomCraft Measurement Overlay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a block is selected and the Measurements toggle is on, overlay CAD-style dimension lines on the 2D canvas showing the gap from each of the block's four sides to the nearest wall, opening, or neighbouring block.

**Architecture:** New pure utility `utils/measurementLines.ts` computes gaps from room state; `useCanvasRenderer.ts` calls a draw pass after the normal top-down render; `RoomContext` and `blockReducer` get one new boolean field (`showMeasurements`) and one new action (`TOGGLE_MEASUREMENTS`); the Views tab in `Sidebar.tsx` gets a third toggle.

**Tech Stack:** TypeScript, React (no new deps). Tests with vitest (`npx tsx --test`). All drawing via existing `CanvasRenderingContext2D` + `roomToCanvas` helper.

---

## File map

| File | Action | Responsibility |
|------|--------|----------------|
| `context/RoomContext.tsx` | Modify | Add `showMeasurements` to `RoomState`, `initialState`, and `RoomAction` union |
| `context/blockReducer.ts` | Modify | Handle `TOGGLE_MEASUREMENTS` action |
| `utils/measurementLines.ts` | **Create** | Pure gap-computation utility |
| `tests/roomcraft-measurement-lines.test.ts` | **Create** | Unit tests for the utility |
| `hooks/useCanvasRenderer.ts` | Modify | Accept `showMeasurements` param; call draw pass after top-down render |
| `components/canvas/RoomCanvas.tsx` | Modify | Pass `state.showMeasurements` to `useCanvasRenderer` |
| `components/ui/Sidebar.tsx` | Modify | Add Measurements toggle in Views tab |

---

## Task 1 — State: add `showMeasurements` to RoomContext and blockReducer

**Files:**
- Modify: `components/features/roomcraft/context/RoomContext.tsx`
- Modify: `components/features/roomcraft/context/blockReducer.ts`

- [ ] **Step 1.1 — Add field to `RoomState` interface**

  In `RoomContext.tsx`, find the `RoomState` interface (line 13). Add `showMeasurements` after `showIsometric`:

  ```typescript
  export interface RoomState {
    floorPlan: FloorPlan | null;
    activeRoomId: string | null;
    activeLayerId: string | null;
    selectedOpeningId: string | null;
    selectedSharedOpeningId: string | null;
    selectedBlockId: string | null;
    displayUnit: DisplayUnit;
    showHeatmap: boolean;
    showIsometric: boolean;
    showMeasurements: boolean;
  }
  ```

- [ ] **Step 1.2 — Add action to `RoomAction` union**

  Find the `RoomAction` type (around line 25). Add after `{ type: 'TOGGLE_ISOMETRIC' }`:

  ```typescript
  | { type: 'TOGGLE_MEASUREMENTS' }
  ```

- [ ] **Step 1.3 — Set default in `initialState`**

  Find `initialState` (around line 81). Add `showMeasurements: false` after `showIsometric: false`:

  ```typescript
  export const initialState: RoomState = {
    floorPlan: null,
    activeRoomId: null,
    activeLayerId: null,
    selectedOpeningId: null,
    selectedSharedOpeningId: null,
    selectedBlockId: null,
    displayUnit: 'mm',
    showHeatmap: false,
    showIsometric: false,
    showMeasurements: false,
  };
  ```

- [ ] **Step 1.4 — Handle action in `roomReducer`**

  In `RoomContext.tsx`, find the `TOGGLE_ISOMETRIC` case (around line 418). Add a new case after it:

  ```typescript
  case 'TOGGLE_MEASUREMENTS':
    return { ...state, showMeasurements: !state.showMeasurements };
  ```

- [ ] **Step 1.5 — Verify TypeScript**

  From `unity-erp/`:
  ```
  npx tsc --noEmit 2>&1 | Select-String "RoomContext|blockReducer"
  ```
  Expected: no errors in these files.

- [ ] **Step 1.6 — Commit**

  ```bash
  git add components/features/roomcraft/context/RoomContext.tsx \
          components/features/roomcraft/context/blockReducer.ts
  git commit -m "feat(roomcraft): add showMeasurements state and TOGGLE_MEASUREMENTS action"
  ```

---

## Task 2 — `computeMeasurementLines` utility + tests

**Files:**
- Create: `components/features/roomcraft/utils/measurementLines.ts`
- Create: `tests/roomcraft-measurement-lines.test.ts`

### Background — coordinate system

- Room X axis: west (0) → east (`room.dimensions.length`)
- Room Y axis: north (0) → south (`room.dimensions.width`)
- `footprintAABB(block)` returns `{ minX, maxX, minY, maxY }` in room-local mm (accounts for rotation)
- Wall sides: `north` (Y=0), `south` (Y=width), `west` (X=0), `east` (X=length)
- Opening `position` on north/south walls = room X (west→east); on west/east walls = room Y (north→south)

### Algorithm per side

For each of the four sides, find the **nearest obstacle** in that direction:

1. **Facing wall** — always the fallback target. Distance = block edge to wall position.
2. **Opening override** — if the facing wall has any opening whose span overlaps the block's perpendicular extent, use `targetType = 'opening'` (same distance as wall).
3. **Nearest neighbouring block** — any other visible block whose footprint overlaps (in the parallel axis) and is in the correct direction. If closer than the wall, wins with `targetType = 'block'`.

Parallel-axis overlap test (blocks and openings):
- N/S sides: parallel axis = X → overlap when `otherMinX < aabb.maxX && otherMaxX > aabb.minX`
- E/W sides: parallel axis = Y → overlap when `otherMinY < aabb.maxY && otherMaxY > aabb.minY`

Direction and gap per side:
| Side | Block edge | Wall position | Other block in direction | Gap formula |
|------|-----------|---------------|--------------------------|-------------|
| north | `aabb.minY` | 0 | `otherAABB.maxY ≤ aabb.minY` | `aabb.minY − other.maxY` |
| south | `aabb.maxY` | `room.dimensions.width` | `otherAABB.minY ≥ aabb.maxY` | `other.minY − aabb.maxY` |
| west | `aabb.minX` | 0 | `otherAABB.maxX ≤ aabb.minX` | `aabb.minX − other.maxX` |
| east | `aabb.maxX` | `room.dimensions.length` | `otherAABB.minX ≥ aabb.maxX` | `other.minX − aabb.maxX` |

- [ ] **Step 2.1 — Write failing tests**

  Create `tests/roomcraft-measurement-lines.test.ts`:

  ```typescript
  import { describe, it, expect } from 'vitest';
  import { computeMeasurementLines } from '../components/features/roomcraft/utils/measurementLines';
  import type { Room, RoomItem } from '../components/features/roomcraft/types/room';
  import type { Layer } from '../components/features/roomcraft/types/floorPlan';

  function makeRoom(length: number, width: number, overrides: Partial<Room> = {}): Room {
    return {
      id: 'r1',
      name: 'Test',
      dimensions: { length, width, height: 2400 },
      walls: [
        { id: 'north', side: 'north', length, height: 2400 },
        { id: 'south', side: 'south', length, height: 2400 },
        { id: 'west',  side: 'west',  length: width, height: 2400 },
        { id: 'east',  side: 'east',  length: width, height: 2400 },
      ],
      openings: [],
      items: [],
      groups: [],
      metadata: { createdAt: '', updatedAt: '', version: 1 },
      ...overrides,
    };
  }

  function makeBlock(id: string, x: number, y: number, length: number, depth: number): RoomItem {
    return {
      id, label: id, layerId: 'l1', x, y, length, depth, height: 900,
      rotation: 0, anchor: { x: 'min', y: 'min', z: 'min' },
    };
  }

  const layer: Layer = { id: 'l1', name: 'Floor', z: 0, visible: true };

  describe('computeMeasurementLines', () => {
    it('returns four sides for a block in the middle of an empty room', () => {
      const block = makeBlock('b1', 1000, 1000, 1000, 1000);
      const room = makeRoom(4000, 4000, { items: [block] });
      const lines = computeMeasurementLines(block, room, [layer]);
      expect(lines).toHaveLength(4);
      const sides = lines.map(l => l.side).sort();
      expect(sides).toEqual(['east', 'north', 'south', 'west']);
    });

    it('north gap is 0 when block is flush against north wall', () => {
      const block = makeBlock('b1', 500, 0, 500, 600);
      const room = makeRoom(3000, 3000, { items: [block] });
      const lines = computeMeasurementLines(block, room, [layer]);
      const north = lines.find(l => l.side === 'north')!;
      expect(north.gapMm).toBe(0);
      expect(north.targetType).toBe('wall');
    });

    it('south gap is room.width − block.maxY when no other blocks', () => {
      const block = makeBlock('b1', 500, 500, 1000, 600);
      const room = makeRoom(3000, 3000, { items: [block] });
      const lines = computeMeasurementLines(block, room, [layer]);
      const south = lines.find(l => l.side === 'south')!;
      expect(south.gapMm).toBe(3000 - (500 + 600)); // 1900
      expect(south.targetType).toBe('wall');
    });

    it('uses targetType "opening" when facing wall has an opening overlapping block X span', () => {
      const block = makeBlock('b1', 500, 0, 1000, 600);
      // Archway on south wall: position=400, width=900 — overlaps block X span [500, 1500]
      const room = makeRoom(3000, 3000, {
        items: [block],
        openings: [{
          id: 'o1', wallId: 'south', type: 'archway',
          position: 400, width: 900, height: 2100, distanceFromFloor: 0,
        }],
      });
      const lines = computeMeasurementLines(block, room, [layer]);
      const south = lines.find(l => l.side === 'south')!;
      expect(south.targetType).toBe('opening');
      expect(south.gapMm).toBe(3000 - 600); // same distance as wall
    });

    it('opening that does NOT overlap block span does not change targetType', () => {
      const block = makeBlock('b1', 500, 0, 500, 600);
      // Archway on south wall: position=2000, width=500 — does NOT overlap block X span [500, 1000]
      const room = makeRoom(3000, 3000, {
        items: [block],
        openings: [{
          id: 'o1', wallId: 'south', type: 'archway',
          position: 2000, width: 500, height: 2100, distanceFromFloor: 0,
        }],
      });
      const lines = computeMeasurementLines(block, room, [layer]);
      const south = lines.find(l => l.side === 'south')!;
      expect(south.targetType).toBe('wall');
    });

    it('uses targetType "block" and nearer distance when another block is in the way', () => {
      const selected = makeBlock('sel', 1000, 1000, 1000, 1000);
      // Neighbour to the east, 200mm gap: minX=2200, maxX=2700, Y spans overlap
      const neighbour = makeBlock('nbr', 2200, 1200, 500, 600);
      const room = makeRoom(5000, 4000, { items: [selected, neighbour] });
      const lines = computeMeasurementLines(selected, room, [layer]);
      const east = lines.find(l => l.side === 'east')!;
      expect(east.targetType).toBe('block');
      expect(east.gapMm).toBe(200); // 2200 - 2000
    });

    it('ignores a neighbouring block whose parallel span does not overlap', () => {
      const selected = makeBlock('sel', 1000, 1000, 1000, 1000); // Y: 1000–2000
      // Neighbour east, but Y span 2500–2800 — no overlap with 1000–2000
      const neighbour = makeBlock('nbr', 2200, 2500, 500, 300);
      const room = makeRoom(5000, 4000, { items: [selected, neighbour] });
      const lines = computeMeasurementLines(selected, room, [layer]);
      const east = lines.find(l => l.side === 'east')!;
      expect(east.targetType).toBe('wall');
      expect(east.gapMm).toBe(5000 - 2000); // 3000
    });

    it('ignores blocks on invisible layers', () => {
      const selected = makeBlock('sel', 1000, 1000, 1000, 1000);
      const neighbour = makeBlock('nbr', 2200, 1200, 500, 600);
      neighbour.layerId = 'hidden';
      const room = makeRoom(5000, 4000, { items: [selected, neighbour] });
      const hiddenLayer: Layer = { id: 'hidden', name: 'Hidden', z: 900, visible: false };
      const lines = computeMeasurementLines(selected, room, [layer, hiddenLayer]);
      const east = lines.find(l => l.side === 'east')!;
      expect(east.targetType).toBe('wall'); // neighbour ignored
    });
  });
  ```

- [ ] **Step 2.2 — Run tests to verify they fail**

  From `unity-erp/`:
  ```
  npx vitest run tests/roomcraft-measurement-lines.test.ts
  ```
  Expected: all tests fail with "Cannot find module" or similar — the utility doesn't exist yet.

- [ ] **Step 2.3 — Create `utils/measurementLines.ts`**

  Create `components/features/roomcraft/utils/measurementLines.ts`:

  ```typescript
  import type { Room, RoomItem } from '../types/room';
  import type { Layer } from '../types/floorPlan';
  import { footprintAABB } from './blocks';

  export interface MeasurementLine {
    side: 'north' | 'south' | 'east' | 'west';
    gapMm: number;
    targetType: 'wall' | 'opening' | 'block';
  }

  export function computeMeasurementLines(
    block: RoomItem,
    room: Room,
    layers: Layer[],
  ): MeasurementLine[] {
    const aabb = footprintAABB(block);
    const { length: roomLength, width: roomWidth } = room.dimensions;
    const visibleLayerIds = new Set(layers.filter(l => l.visible).map(l => l.id));
    const otherBlocks = room.items.filter(i => i.id !== block.id && visibleLayerIds.has(i.layerId));
    const otherAABBs = otherBlocks.map(b => footprintAABB(b));

    const lines: MeasurementLine[] = [];

    // Helper: does an opening overlap a parallel span?
    const openingOverlaps = (wallId: string, spanMin: number, spanMax: number): boolean => {
      const wall = room.walls.find(w => w.id === wallId);
      if (!wall) return false;
      return room.openings.some(
        o => o.wallId === wallId &&
             o.position < spanMax &&
             o.position + o.width > spanMin,
      );
    };

    // North side: block.minY → Y=0
    {
      const wallGap = aabb.minY;
      const parallelMin = aabb.minX;
      const parallelMax = aabb.maxX;
      const northWallId = room.walls.find(w => w.side === 'north')?.id ?? '';

      let nearestBlockGap = Infinity;
      for (const other of otherAABBs) {
        if (other.maxY > aabb.minY) continue; // not north of block
        if (other.minX >= parallelMax || other.maxX <= parallelMin) continue; // no X overlap
        nearestBlockGap = Math.min(nearestBlockGap, aabb.minY - other.maxY);
      }

      if (nearestBlockGap <= wallGap) {
        lines.push({ side: 'north', gapMm: nearestBlockGap, targetType: 'block' });
      } else {
        const type = openingOverlaps(northWallId, parallelMin, parallelMax) ? 'opening' : 'wall';
        lines.push({ side: 'north', gapMm: wallGap, targetType: type });
      }
    }

    // South side: block.maxY → Y=roomWidth
    {
      const wallGap = roomWidth - aabb.maxY;
      const parallelMin = aabb.minX;
      const parallelMax = aabb.maxX;
      const southWallId = room.walls.find(w => w.side === 'south')?.id ?? '';

      let nearestBlockGap = Infinity;
      for (const other of otherAABBs) {
        if (other.minY < aabb.maxY) continue; // not south of block
        if (other.minX >= parallelMax || other.maxX <= parallelMin) continue;
        nearestBlockGap = Math.min(nearestBlockGap, other.minY - aabb.maxY);
      }

      if (nearestBlockGap <= wallGap) {
        lines.push({ side: 'south', gapMm: nearestBlockGap, targetType: 'block' });
      } else {
        const type = openingOverlaps(southWallId, parallelMin, parallelMax) ? 'opening' : 'wall';
        lines.push({ side: 'south', gapMm: wallGap, targetType: type });
      }
    }

    // West side: block.minX → X=0
    {
      const wallGap = aabb.minX;
      const parallelMin = aabb.minY;
      const parallelMax = aabb.maxY;
      const westWallId = room.walls.find(w => w.side === 'west')?.id ?? '';

      let nearestBlockGap = Infinity;
      for (const other of otherAABBs) {
        if (other.maxX > aabb.minX) continue; // not west of block
        if (other.minY >= parallelMax || other.maxY <= parallelMin) continue;
        nearestBlockGap = Math.min(nearestBlockGap, aabb.minX - other.maxX);
      }

      if (nearestBlockGap <= wallGap) {
        lines.push({ side: 'west', gapMm: nearestBlockGap, targetType: 'block' });
      } else {
        const type = openingOverlaps(westWallId, parallelMin, parallelMax) ? 'opening' : 'wall';
        lines.push({ side: 'west', gapMm: wallGap, targetType: type });
      }
    }

    // East side: block.maxX → X=roomLength
    {
      const wallGap = roomLength - aabb.maxX;
      const parallelMin = aabb.minY;
      const parallelMax = aabb.maxY;
      const eastWallId = room.walls.find(w => w.side === 'east')?.id ?? '';

      let nearestBlockGap = Infinity;
      for (const other of otherAABBs) {
        if (other.minX < aabb.maxX) continue; // not east of block
        if (other.minY >= parallelMax || other.maxY <= parallelMin) continue;
        nearestBlockGap = Math.min(nearestBlockGap, other.minX - aabb.maxX);
      }

      if (nearestBlockGap <= wallGap) {
        lines.push({ side: 'east', gapMm: nearestBlockGap, targetType: 'block' });
      } else {
        const type = openingOverlaps(eastWallId, parallelMin, parallelMax) ? 'opening' : 'wall';
        lines.push({ side: 'east', gapMm: wallGap, targetType: type });
      }
    }

    return lines;
  }
  ```

- [ ] **Step 2.4 — Run tests to verify they pass**

  ```
  npx vitest run tests/roomcraft-measurement-lines.test.ts
  ```
  Expected: all 7 tests pass.

- [ ] **Step 2.5 — Lint and tsc check**

  ```
  npm run lint --quiet
  npx tsc --noEmit 2>&1 | Select-String "measurementLines"
  ```
  Expected: 0 errors in `measurementLines.ts`.

- [ ] **Step 2.6 — Commit**

  ```bash
  git add components/features/roomcraft/utils/measurementLines.ts \
          tests/roomcraft-measurement-lines.test.ts
  git commit -m "feat(roomcraft): add computeMeasurementLines utility with tests"
  ```

---

## Task 3 — Renderer draw pass + RoomCanvas threading

**Files:**
- Modify: `components/features/roomcraft/hooks/useCanvasRenderer.ts`
- Modify: `components/features/roomcraft/components/canvas/RoomCanvas.tsx`

### 3A — `useCanvasRenderer.ts`

- [ ] **Step 3.1 — Add `showMeasurements` parameter**

  Find the `useCanvasRenderer` function signature (line 35). Add `showMeasurements: boolean = false` as the 14th parameter, after `pieceMap`:

  ```typescript
  export function useCanvasRenderer(
    canvasRef: React.RefObject<HTMLCanvasElement | null>,
    floorPlan: FloorPlan | null,
    activeRoomId: string | null,
    viewState: ViewState,
    selectedOpeningId?: string | null,
    selectedSharedOpeningId?: string | null,
    selectedBlockId: string | null = null,
    displayUnit: DisplayUnit = 'mm',
    ghost: GhostInfo | null = null,
    showHeatmap: boolean = false,
    showIsometric: boolean = false,
    cameraFlipped: boolean = false,
    pieceMap: Map<string, ProjectPiece> = new Map(),
    showMeasurements: boolean = false,
  ) {
  ```

- [ ] **Step 3.2 — Add `showMeasurements` to the `useCallback` dependency array**

  Find the `useCallback` closing line (around line 179):
  ```typescript
  }, [canvasRef, floorPlan, activeRoomId, viewState, selectedOpeningId, selectedSharedOpeningId, displayUnit, selectedBlockId, ghost, heatmapData, showHeatmap, showIsometric, cameraFlipped, pieceMap]);
  ```

  Replace with:
  ```typescript
  }, [canvasRef, floorPlan, activeRoomId, viewState, selectedOpeningId, selectedSharedOpeningId, displayUnit, selectedBlockId, ghost, heatmapData, showHeatmap, showIsometric, cameraFlipped, pieceMap, showMeasurements]);
  ```

- [ ] **Step 3.3 — Add the import for `computeMeasurementLines`**

  At the top of `useCanvasRenderer.ts`, after the existing imports, add:

  ```typescript
  import { computeMeasurementLines } from '../utils/measurementLines';
  ```

- [ ] **Step 3.4 — Add the measurement draw call after the existing wall measurement pass**

  Find the comment and call `drawWallMeasurements` (around lines 165–171):

  ```typescript
      // Measurement pass — selected room only, drawn below shared-opening layer and below compass.
      if (activeRoomId) {
        const activePlaced = floorPlan.rooms.find((p) => p.room.id === activeRoomId);
        if (activePlaced) {
          drawWallMeasurements(ctx, activePlaced.room, activePlaced.position, scale, offset, floorPlan, rawOverlaps, displayUnit);
        }
      }
  ```

  Replace with:

  ```typescript
      // Measurement pass — selected room only, drawn below shared-opening layer and below compass.
      if (activeRoomId) {
        const activePlaced = floorPlan.rooms.find((p) => p.room.id === activeRoomId);
        if (activePlaced) {
          drawWallMeasurements(ctx, activePlaced.room, activePlaced.position, scale, offset, floorPlan, rawOverlaps, displayUnit);
          if (showMeasurements && selectedBlockId) {
            const selectedBlock = activePlaced.room.items.find(i => i.id === selectedBlockId);
            if (selectedBlock) {
              drawBlockMeasurements(ctx, selectedBlock, activePlaced.room, floorPlan.layers, activePlaced.position, scale, offset);
            }
          }
        }
      }
  ```

- [ ] **Step 3.5 — Add the `drawBlockMeasurements` function**

  Add this function at the end of `useCanvasRenderer.ts`, after the last existing function:

  ```typescript
  function drawBlockMeasurements(
    ctx: CanvasRenderingContext2D,
    block: RoomItem,
    room: Room,
    layers: Layer[],
    roomOrigin: { x: number; y: number },
    scale: number,
    offset: { x: number; y: number },
  ): void {
    const lines = computeMeasurementLines(block, room, layers);
    const aabb = footprintAABB(block);
    const midRoomX = (aabb.minX + aabb.maxX) / 2;
    const midRoomY = (aabb.minY + aabb.maxY) / 2;

    for (const line of lines) {
      const color =
        line.targetType === 'opening' ? '#2563EB'
        : line.targetType === 'block' ? '#EA580C'
        : '#6B7280';

      let x1: number, y1: number, x2: number, y2: number, labelX: number, labelY: number;

      switch (line.side) {
        case 'north': {
          const p1 = roomToCanvas(roomOrigin.x + midRoomX, roomOrigin.y + aabb.minY, scale, offset);
          const p2 = roomToCanvas(roomOrigin.x + midRoomX, roomOrigin.y + aabb.minY - line.gapMm, scale, offset);
          x1 = p1.x; y1 = p1.y; x2 = p2.x; y2 = p2.y;
          labelX = x1; labelY = (y1 + y2) / 2;
          break;
        }
        case 'south': {
          const p1 = roomToCanvas(roomOrigin.x + midRoomX, roomOrigin.y + aabb.maxY, scale, offset);
          const p2 = roomToCanvas(roomOrigin.x + midRoomX, roomOrigin.y + aabb.maxY + line.gapMm, scale, offset);
          x1 = p1.x; y1 = p1.y; x2 = p2.x; y2 = p2.y;
          labelX = x1; labelY = (y1 + y2) / 2;
          break;
        }
        case 'west': {
          const p1 = roomToCanvas(roomOrigin.x + aabb.minX, roomOrigin.y + midRoomY, scale, offset);
          const p2 = roomToCanvas(roomOrigin.x + aabb.minX - line.gapMm, roomOrigin.y + midRoomY, scale, offset);
          x1 = p1.x; y1 = p1.y; x2 = p2.x; y2 = p2.y;
          labelX = (x1 + x2) / 2; labelY = y1;
          break;
        }
        case 'east': {
          const p1 = roomToCanvas(roomOrigin.x + aabb.maxX, roomOrigin.y + midRoomY, scale, offset);
          const p2 = roomToCanvas(roomOrigin.x + aabb.maxX + line.gapMm, roomOrigin.y + midRoomY, scale, offset);
          x1 = p1.x; y1 = p1.y; x2 = p2.x; y2 = p2.y;
          labelX = (x1 + x2) / 2; labelY = y1;
          break;
        }
        default:
          continue;
      }

      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      const ux = len > 0 ? dx / len : 0;
      const uy = len > 0 ? dy / len : 0;
      const px = -uy; // perpendicular x
      const py = ux;  // perpendicular y
      const TICK = 5;
      const HEAD = 5;

      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.2;

      // Tick marks at each endpoint
      ctx.beginPath();
      ctx.moveTo(x1 + px * TICK, y1 + py * TICK);
      ctx.lineTo(x1 - px * TICK, y1 - py * TICK);
      ctx.moveTo(x2 + px * TICK, y2 + py * TICK);
      ctx.lineTo(x2 - px * TICK, y2 - py * TICK);
      ctx.stroke();

      if (line.gapMm > 0 && len > 1) {
        // Dimension line
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // Arrowhead at block edge (pointing toward target)
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 + ux * HEAD + px * HEAD * 0.5, y1 + uy * HEAD + py * HEAD * 0.5);
        ctx.lineTo(x1 + ux * HEAD - px * HEAD * 0.5, y1 + uy * HEAD - py * HEAD * 0.5);
        ctx.closePath();
        ctx.fill();

        // Arrowhead at target edge (pointing back toward block)
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - ux * HEAD + px * HEAD * 0.5, y2 - uy * HEAD + py * HEAD * 0.5);
        ctx.lineTo(x2 - ux * HEAD - px * HEAD * 0.5, y2 - uy * HEAD - py * HEAD * 0.5);
        ctx.closePath();
        ctx.fill();
      }

      // Label with white background
      const label = `${Math.round(line.gapMm)}mm`;
      ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const textW = ctx.measureText(label).width;
      const PAD = 3;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillRect(labelX - textW / 2 - PAD, labelY - 7, textW + PAD * 2, 14);
      ctx.fillStyle = color;
      ctx.fillText(label, labelX, labelY);

      ctx.restore();
    }
  }
  ```

### 3B — `RoomCanvas.tsx`

- [ ] **Step 3.6 — Pass `state.showMeasurements` to `useCanvasRenderer`**

  Find the `useCanvasRenderer` call in `RoomCanvas.tsx` (around line 176):

  ```typescript
  useCanvasRenderer(
    canvasRef, floorPlan, state.activeRoomId, viewState,
    state.selectedOpeningId, state.selectedSharedOpeningId, state.selectedBlockId, state.displayUnit,
    ghost,
    state.showHeatmap,
    state.showIsometric,
    cameraFlipped,
    pieceMap,
  );
  ```

  Replace with:

  ```typescript
  useCanvasRenderer(
    canvasRef, floorPlan, state.activeRoomId, viewState,
    state.selectedOpeningId, state.selectedSharedOpeningId, state.selectedBlockId, state.displayUnit,
    ghost,
    state.showHeatmap,
    state.showIsometric,
    cameraFlipped,
    pieceMap,
    state.showMeasurements,
  );
  ```

- [ ] **Step 3.7 — Verify TypeScript**

  ```
  npx tsc --noEmit 2>&1 | Select-String "useCanvasRenderer|RoomCanvas|measurementLines"
  ```
  Expected: 0 errors in these files.

- [ ] **Step 3.8 — Commit**

  ```bash
  git add components/features/roomcraft/hooks/useCanvasRenderer.ts \
          components/features/roomcraft/components/canvas/RoomCanvas.tsx
  git commit -m "feat(roomcraft): draw block measurement overlay on canvas"
  ```

---

## Task 4 — Sidebar: Measurements toggle in Views tab

**Files:**
- Modify: `components/features/roomcraft/components/ui/Sidebar.tsx`

- [ ] **Step 4.1 — Add the toggle to the Views tab**

  Find the Views tab content in `Sidebar.tsx` (around line 275). The section currently has two toggles (Clearance and 3D View). Add a third toggle for Measurements after the 3D View block.

  Find this closing section of the Views TabPanel:
  ```tsx
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">3D View</span>
              <button
                onClick={() => dispatch({ type: 'TOGGLE_ISOMETRIC' })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                  state.showIsometric ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span className="sr-only">{state.showIsometric ? 'On' : 'Off'}</span>
                <span
                  className={`${
                    state.showIsometric ? 'translate-x-6' : 'translate-x-1'
                  } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
                />
              </button>
            </div>
          </div>
        </TabPanel>
  ```

  Replace with:
  ```tsx
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">3D View</span>
              <button
                onClick={() => dispatch({ type: 'TOGGLE_ISOMETRIC' })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                  state.showIsometric ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span className="sr-only">{state.showIsometric ? 'On' : 'Off'}</span>
                <span
                  className={`${
                    state.showIsometric ? 'translate-x-6' : 'translate-x-1'
                  } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Measurements</span>
              <button
                onClick={() => dispatch({ type: 'TOGGLE_MEASUREMENTS' })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                  state.showMeasurements ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span className="sr-only">{state.showMeasurements ? 'On' : 'Off'}</span>
                <span
                  className={`${
                    state.showMeasurements ? 'translate-x-6' : 'translate-x-1'
                  } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
                />
              </button>
            </div>
          </div>
        </TabPanel>
  ```

- [ ] **Step 4.2 — Verify TypeScript and lint**

  ```
  npm run lint --quiet
  npx tsc --noEmit 2>&1 | Select-String "Sidebar"
  ```
  Expected: 0 errors in `Sidebar.tsx`.

- [ ] **Step 4.3 — Commit**

  ```bash
  git add components/features/roomcraft/components/ui/Sidebar.tsx
  git commit -m "feat(roomcraft): add Measurements toggle to Views tab"
  ```

---

## Final verification

- [ ] **Run all tests**

  ```
  npx vitest run tests/roomcraft-measurement-lines.test.ts
  ```
  Expected: 7 tests pass.

- [ ] **Run lint**

  ```
  npm run lint --quiet
  ```
  Expected: 0 errors (pre-existing warnings about `<img>` are fine).

- [ ] **Browser verify**

  ```
  npm run dev
  ```

  1. Open `/roomcraft/<projectId>`
  2. Go to **Views tab** → confirm **Measurements** toggle is present
  3. Toggle Measurements **on**
  4. Click a shelf block flush against the west wall → west side should show **0mm** in grey
  5. The south side should show the gap to the south wall (or **opening** label in blue if an archway overlaps that projection)
  6. Click a block with another block to its east → east side should show distance in **orange**
  7. Deselect block (click canvas background) → all lines disappear
  8. Toggle to **3D View** → no measurement lines appear (Three.js scene, not canvas)
  9. Toggle Measurements **off** → lines disappear in 2D view too

- [ ] **Final commit if any cleanup was needed**

  If no cleanup: done. If minor fixes were required, commit with:
  ```bash
  git commit -m "fix(roomcraft): measurement overlay browser verification fixes"
  ```
