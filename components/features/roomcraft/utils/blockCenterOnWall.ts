import type { Room, RoomItem, WallSide } from '../types/room';
import { footprintAABB, rectsOverlap, rotatedFootprint } from './blocks';

export function centerOnWall(b: RoomItem, side: WallSide, room: Room): RoomItem {
  const { length, depth } = rotatedFootprint(b);
  switch (side) {
    case 'north':
      return { ...b, x: (room.dimensions.length - length) / 2, y: 0 };
    case 'south':
      return { ...b, x: (room.dimensions.length - length) / 2, y: room.dimensions.width - depth };
    case 'west':
      return { ...b, x: 0, y: (room.dimensions.width - depth) / 2 };
    case 'east':
      return { ...b, x: room.dimensions.length - length, y: (room.dimensions.width - depth) / 2 };
  }
}

export function centerGroupOnWall(groupId: string, side: WallSide, room: Room): RoomItem[] | null {
  const members = room.items.filter((item) => item.groupId === groupId);
  if (members.length === 0) return null;

  const bounds = members.reduce(
    (acc, item) => {
      const aabb = footprintAABB(item);
      return {
        minX: Math.min(acc.minX, aabb.minX),
        maxX: Math.max(acc.maxX, aabb.maxX),
        minY: Math.min(acc.minY, aabb.minY),
        maxY: Math.max(acc.maxY, aabb.maxY),
      };
    },
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
  );

  const groupLength = bounds.maxX - bounds.minX;
  const groupDepth = bounds.maxY - bounds.minY;
  let dx = 0;
  let dy = 0;

  switch (side) {
    case 'north':
      dx = (room.dimensions.length - groupLength) / 2 - bounds.minX;
      dy = -bounds.minY;
      break;
    case 'south':
      dx = (room.dimensions.length - groupLength) / 2 - bounds.minX;
      dy = room.dimensions.width - groupDepth - bounds.minY;
      break;
    case 'west':
      dx = -bounds.minX;
      dy = (room.dimensions.width - groupDepth) / 2 - bounds.minY;
      break;
    case 'east':
      dx = room.dimensions.length - groupLength - bounds.minX;
      dy = (room.dimensions.width - groupDepth) / 2 - bounds.minY;
      break;
  }

  return members.map((item) => ({ ...item, x: item.x + dx, y: item.y + dy }));
}

export function canPlaceGroupItems(groupId: string, candidates: RoomItem[], room: Room): boolean {
  const candidateById = new Map(candidates.map((item) => [item.id, item]));
  const finalItems = room.items.map((item) => candidateById.get(item.id) ?? item);

  for (const candidate of candidates) {
    const aabb = footprintAABB(candidate);
    if (
      aabb.minX < 0 ||
      aabb.minY < 0 ||
      aabb.maxX > room.dimensions.length ||
      aabb.maxY > room.dimensions.width
    ) {
      return false;
    }

    for (const other of finalItems) {
      if (other.id === candidate.id) continue;
      if (other.groupId === groupId) continue;
      if (other.layerId !== candidate.layerId) continue;
      if (rectsOverlap(aabb, footprintAABB(other))) return false;
    }
  }

  return true;
}
