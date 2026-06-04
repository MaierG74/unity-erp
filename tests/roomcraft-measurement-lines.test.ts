import { describe, it, expect } from 'vitest';
import { computeMeasurementLines, computeLateralMeasurements } from '../components/features/roomcraft/utils/measurementLines';
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
      { id: 'west', side: 'west', length: width, height: 2400 },
      { id: 'east', side: 'east', length: width, height: 2400 },
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
    id,
    label: id,
    layerId: 'l1',
    x,
    y,
    length,
    depth,
    height: 900,
    rotation: 0,
    anchor: { x: 'min', y: 'min', z: 'min' },
  };
}

const layer: Layer = { id: 'l1', name: 'Floor', z: 0, visible: true };

describe('computeMeasurementLines', () => {
  it('returns four sides for a block in the middle of an empty room', () => {
    const block = makeBlock('b1', 1000, 1000, 1000, 1000);
    const room = makeRoom(4000, 4000, { items: [block] });
    const lines = computeMeasurementLines(block, room, [layer]);
    expect(lines).toHaveLength(4);
    const sides = lines.map((line) => line.side).sort();
    expect(sides).toEqual(['east', 'north', 'south', 'west']);
  });

  it('north gap is 0 when block is flush against north wall', () => {
    const block = makeBlock('b1', 500, 0, 500, 600);
    const room = makeRoom(3000, 3000, { items: [block] });
    const lines = computeMeasurementLines(block, room, [layer]);
    const north = lines.find((line) => line.side === 'north')!;
    expect(north.gapMm).toBe(0);
    expect(north.targetType).toBe('wall');
  });

  it('south gap is room.width - block.maxY when no other blocks', () => {
    const block = makeBlock('b1', 500, 500, 1000, 600);
    const room = makeRoom(3000, 3000, { items: [block] });
    const lines = computeMeasurementLines(block, room, [layer]);
    const south = lines.find((line) => line.side === 'south')!;
    expect(south.gapMm).toBe(3000 - (500 + 600));
    expect(south.targetType).toBe('wall');
  });

  it('uses targetType "opening" when facing wall has an opening overlapping block X span', () => {
    const block = makeBlock('b1', 500, 0, 1000, 600);
    const room = makeRoom(3000, 3000, {
      items: [block],
      openings: [{
        id: 'o1',
        wallId: 'south',
        type: 'archway',
        position: 400,
        width: 900,
        height: 2100,
        distanceFromFloor: 0,
      }],
    });
    const lines = computeMeasurementLines(block, room, [layer]);
    const south = lines.find((line) => line.side === 'south')!;
    expect(south.targetType).toBe('opening');
    expect(south.gapMm).toBe(3000 - 600);
  });

  it('opening on wall uses targetType "opening" even when it does not overlap block span', () => {
    const block = makeBlock('b1', 500, 0, 500, 600);
    const room = makeRoom(3000, 3000, {
      items: [block],
      openings: [{
        id: 'o1',
        wallId: 'south',
        type: 'archway',
        position: 2000,
        width: 500,
        height: 2100,
        distanceFromFloor: 0,
      }],
    });
    const lines = computeMeasurementLines(block, room, [layer]);
    const south = lines.find((line) => line.side === 'south')!;
    expect(south.targetType).toBe('opening');
  });

  it('uses targetType "block" and nearer distance when another block is in the way', () => {
    const selected = makeBlock('sel', 1000, 1000, 1000, 1000);
    const neighbour = makeBlock('nbr', 2200, 1200, 500, 600);
    const room = makeRoom(5000, 4000, { items: [selected, neighbour] });
    const lines = computeMeasurementLines(selected, room, [layer]);
    const east = lines.find((line) => line.side === 'east')!;
    expect(east.targetType).toBe('block');
    expect(east.gapMm).toBe(200);
  });

  it('ignores a neighbouring block whose parallel span does not overlap', () => {
    const selected = makeBlock('sel', 1000, 1000, 1000, 1000);
    const neighbour = makeBlock('nbr', 2200, 2500, 500, 300);
    const room = makeRoom(5000, 4000, { items: [selected, neighbour] });
    const lines = computeMeasurementLines(selected, room, [layer]);
    const east = lines.find((line) => line.side === 'east')!;
    expect(east.targetType).toBe('wall');
    expect(east.gapMm).toBe(5000 - 2000);
  });

  it('ignores blocks on invisible layers', () => {
    const selected = makeBlock('sel', 1000, 1000, 1000, 1000);
    const neighbour = makeBlock('nbr', 2200, 1200, 500, 600);
    neighbour.layerId = 'hidden';
    const room = makeRoom(5000, 4000, { items: [selected, neighbour] });
    const hiddenLayer: Layer = { id: 'hidden', name: 'Hidden', z: 900, visible: false };
    const lines = computeMeasurementLines(selected, room, [layer, hiddenLayer]);
    const east = lines.find((line) => line.side === 'east')!;
    expect(east.targetType).toBe('wall');
  });
});

describe('computeLateralMeasurements', () => {
  it('emits a lateral line when opening is to the right of block on south wall', () => {
    // Block at x=500..1000, opening at x=1200..1700 on south wall
    const block = makeBlock('b1', 500, 0, 500, 600);
    const room = makeRoom(3000, 3000, {
      items: [block],
      openings: [{
        id: 'o1',
        wallId: 'south',
        type: 'archway',
        position: 1200,
        width: 500,
        height: 2100,
        distanceFromFloor: 0,
      }],
    });
    const lats = computeLateralMeasurements(block, room, [layer]);
    const south = lats.find((l) => l.wall === 'south')!;
    expect(south).toBeDefined();
    expect(south.gapMm).toBe(200);          // 1200 - 1000
    expect(south.parallelStart).toBe(1000); // block east edge
    expect(south.parallelEnd).toBe(1200);   // opening west edge
    expect(south.perpCoord).toBe(600);      // block south face (y=0+600)
  });

  it('emits a lateral line when opening is to the left of block on south wall', () => {
    // Block at x=1500..2000, opening at x=200..700 on south wall
    const block = makeBlock('b1', 1500, 0, 500, 600);
    const room = makeRoom(3000, 3000, {
      items: [block],
      openings: [{
        id: 'o1',
        wallId: 'south',
        type: 'archway',
        position: 200,
        width: 500,
        height: 2100,
        distanceFromFloor: 0,
      }],
    });
    const lats = computeLateralMeasurements(block, room, [layer]);
    const south = lats.find((l) => l.wall === 'south')!;
    expect(south).toBeDefined();
    expect(south.gapMm).toBe(800);          // 1500 - 700
    expect(south.parallelStart).toBe(1500); // block west edge
    expect(south.parallelEnd).toBe(700);    // opening east edge
  });

  it('emits no lateral line when opening is directly in front of the block', () => {
    // Block at x=500..1000, opening spans x=400..900 — overlaps block span
    const block = makeBlock('b1', 500, 0, 500, 600);
    const room = makeRoom(3000, 3000, {
      items: [block],
      openings: [{
        id: 'o1',
        wallId: 'south',
        type: 'archway',
        position: 400,
        width: 500,
        height: 2100,
        distanceFromFloor: 0,
      }],
    });
    const lats = computeLateralMeasurements(block, room, [layer]);
    expect(lats.filter((l) => l.wall === 'south')).toHaveLength(0);
  });

  it('emits no lateral line when gap is zero (block edge flush with opening edge)', () => {
    // Block at x=500..1000, opening starts at x=1000 exactly
    const block = makeBlock('b1', 500, 0, 500, 600);
    const room = makeRoom(3000, 3000, {
      items: [block],
      openings: [{
        id: 'o1',
        wallId: 'south',
        type: 'archway',
        position: 1000,
        width: 500,
        height: 2100,
        distanceFromFloor: 0,
      }],
    });
    const lats = computeLateralMeasurements(block, room, [layer]);
    expect(lats.filter((l) => l.wall === 'south')).toHaveLength(0);
  });

  it('emits lateral lines for multiple openings on the same wall', () => {
    // Block at x=1000..1500, openings at x=200..400 and x=1800..2200
    const block = makeBlock('b1', 1000, 0, 500, 600);
    const room = makeRoom(3000, 3000, {
      items: [block],
      openings: [
        { id: 'o1', wallId: 'south', type: 'archway', position: 200,  width: 200, height: 2100, distanceFromFloor: 0 },
        { id: 'o2', wallId: 'south', type: 'archway', position: 1800, width: 400, height: 2100, distanceFromFloor: 0 },
      ],
    });
    const lats = computeLateralMeasurements(block, room, [layer]);
    const south = lats.filter((l) => l.wall === 'south');
    expect(south).toHaveLength(2);
    expect(south.find((l) => l.parallelEnd === 400)).toBeDefined();  // left gap
    expect(south.find((l) => l.parallelEnd === 1800)).toBeDefined(); // right gap
  });
});
