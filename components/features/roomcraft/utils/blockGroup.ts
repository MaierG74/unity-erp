import type { Group, Room, RoomItem } from '../types/room';
import { footprintAABB, rectsOverlap } from './blocks';

const PALETTE = ['#bcd9c3', '#d9b86c', '#a8b8d9', '#d9a8b8', '#b8d9c0', '#d9c3a8', '#c0a8d9', '#d9d0a8'];

export function createGroup(init: { layerId: string; color: string }): Group {
  return { id: crypto.randomUUID(), layerId: init.layerId, color: init.color };
}

export function nextGroupColor(existingCount: number): string {
  return PALETTE[existingCount % PALETTE.length];
}

/**
 * Tries to find a position offset for a duplicate that doesn't collide.
 * Order: +X (east), -X (west), +Y (south), -Y (north), then SE diagonal. Returns null if no spot in room.
 */
export function findDuplicateOffset(source: RoomItem, room: Room): { x: number; y: number } | null {
  const candidates = [
    { x: source.length, y: 0 },
    { x: -source.length, y: 0 },
    { x: 0, y: source.depth },
    { x: 0, y: -source.depth },
    { x: source.length, y: source.depth },
  ];
  for (const offset of candidates) {
    const candidate: RoomItem = { ...source, id: 'temp', x: source.x + offset.x, y: source.y + offset.y };
    if (!fits(candidate, room)) continue;
    return offset;
  }
  return null;
}

function fits(target: RoomItem, room: Room): boolean {
  const aabb = footprintAABB(target);
  if (aabb.minX < 0 || aabb.minY < 0 || aabb.maxX > room.dimensions.length || aabb.maxY > room.dimensions.width) return false;
  for (const other of room.items) {
    if (other.id === target.id) continue;
    if (other.layerId !== target.layerId) continue;
    if (rectsOverlap(aabb, footprintAABB(other))) return false;
  }
  return true;
}
