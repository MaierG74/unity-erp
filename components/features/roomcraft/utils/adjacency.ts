import type { FloorPlan, PlacedRoom, SharedOpening } from '../types/floorPlan';
import type { Wall, WallSide } from '../types/room';

export interface WallOverlap {
  roomA: PlacedRoom;
  wallA: Wall;
  roomB: PlacedRoom;
  wallB: Wall;
  startA: number;
  endA: number;
  startB: number;
  endB: number;
  length: number;
}

export const OPPOSITE: Record<WallSide, WallSide> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

function coincidesAtLine(a: PlacedRoom, sideA: WallSide, b: PlacedRoom): boolean {
  switch (sideA) {
    case 'east':
      return a.position.x + a.room.dimensions.length === b.position.x;
    case 'west':
      return b.position.x + b.room.dimensions.length === a.position.x;
    case 'south':
      return a.position.y + a.room.dimensions.width === b.position.y;
    case 'north':
      return b.position.y + b.room.dimensions.width === a.position.y;
  }
}

function overlapRange(
  a: PlacedRoom,
  sideA: WallSide,
  b: PlacedRoom,
): { planStart: number; planEnd: number } | null {
  if (sideA === 'east' || sideA === 'west') {
    const aStart = a.position.y;
    const aEnd = a.position.y + a.room.dimensions.width;
    const bStart = b.position.y;
    const bEnd = b.position.y + b.room.dimensions.width;
    const start = Math.max(aStart, bStart);
    const end = Math.min(aEnd, bEnd);
    return end > start ? { planStart: start, planEnd: end } : null;
  }
  const aStart = a.position.x;
  const aEnd = a.position.x + a.room.dimensions.length;
  const bStart = b.position.x;
  const bEnd = b.position.x + b.room.dimensions.length;
  const start = Math.max(aStart, bStart);
  const end = Math.min(aEnd, bEnd);
  return end > start ? { planStart: start, planEnd: end } : null;
}

function localFromPlan(wall: WallSide, room: PlacedRoom, planCoord: number): number {
  if (wall === 'north' || wall === 'south') return planCoord - room.position.x;
  return planCoord - room.position.y;
}

export function getWallOverlaps(plan: FloorPlan): WallOverlap[] {
  const out: WallOverlap[] = [];
  const rooms = plan.rooms;
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i];
      const b = rooms[j];
      for (const wallA of a.room.walls) {
        const sideB = OPPOSITE[wallA.side];
        if (!coincidesAtLine(a, wallA.side, b)) continue;
        const wallB = b.room.walls.find((w) => w.side === sideB);
        if (!wallB) continue;
        const range = overlapRange(a, wallA.side, b);
        if (!range) continue;
        const startA = localFromPlan(wallA.side, a, range.planStart);
        const endA = localFromPlan(wallA.side, a, range.planEnd);
        const startB = localFromPlan(wallB.side, b, range.planStart);
        const endB = localFromPlan(wallB.side, b, range.planEnd);
        out.push({
          roomA: a,
          wallA,
          roomB: b,
          wallB,
          startA,
          endA,
          startB,
          endB,
          length: endA - startA,
        });
      }
    }
  }
  return out;
}

export function orientOverlapTo(
  overlap: WallOverlap,
  anchorRoomId: string,
): WallOverlap | null {
  if (overlap.roomA.room.id === anchorRoomId) return overlap;
  if (overlap.roomB.room.id === anchorRoomId) {
    return {
      roomA: overlap.roomB,
      wallA: overlap.wallB,
      roomB: overlap.roomA,
      wallB: overlap.wallA,
      startA: overlap.startB,
      endA: overlap.endB,
      startB: overlap.startA,
      endB: overlap.endA,
      length: overlap.length,
    };
  }
  return null;
}

export function findOverlapForShared(
  plan: FloorPlan,
  shared: SharedOpening,
): WallOverlap | null {
  for (const raw of getWallOverlaps(plan)) {
    const oriented = orientOverlapTo(raw, shared.anchorRoomId);
    if (!oriented) continue;
    if (oriented.wallA.id !== shared.anchorWallId) continue;
    return oriented;
  }
  return null;
}

export function findOverlapAtPoint(
  plan: FloorPlan,
  roomId: string,
  wallId: string,
  position: number,
): WallOverlap | null {
  for (const raw of getWallOverlaps(plan)) {
    const o = orientOverlapTo(raw, roomId);
    if (!o) continue;
    if (o.wallA.id !== wallId) continue;
    if (position >= o.startA && position <= o.endA) return o;
  }
  return null;
}
