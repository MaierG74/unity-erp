import type { Room, RoomDimensions, Wall, WallSide } from '../types/room';

export function createWalls(dimensions: RoomDimensions): Wall[] {
  const { length, width, height } = dimensions;

  const wallDefs: { side: WallSide; wallLength: number }[] = [
    { side: 'north', wallLength: length },
    { side: 'south', wallLength: length },
    { side: 'east', wallLength: width },
    { side: 'west', wallLength: width },
  ];

  return wallDefs.map(({ side, wallLength }) => ({
    id: crypto.randomUUID(),
    side,
    length: wallLength,
    height,
  }));
}

export function createRoom(name: string, dimensions: RoomDimensions): Room {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    dimensions,
    walls: createWalls(dimensions),
    openings: [],
    items: [],
    groups: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
  };
}
