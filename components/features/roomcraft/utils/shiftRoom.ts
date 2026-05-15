import type { FloorPlan } from '../types/floorPlan';
import { getWallOverlaps, orientOverlapTo } from './adjacency';

export type ShiftAxis = 'x' | 'y';

export function getAvailableAxes(plan: FloorPlan, roomId: string): ShiftAxis[] {
  const axes = new Set<ShiftAxis>();
  for (const overlap of getWallOverlaps(plan)) {
    const involves =
      overlap.roomA.room.id === roomId || overlap.roomB.room.id === roomId;
    if (!involves) continue;
    const side =
      overlap.roomA.room.id === roomId ? overlap.wallA.side : overlap.wallB.side;
    if (side === 'east' || side === 'west') axes.add('y');
    else axes.add('x');
  }
  const out: ShiftAxis[] = [];
  if (axes.has('x')) out.push('x');
  if (axes.has('y')) out.push('y');
  return out;
}

export function inferShiftAxis(
  dx: number,
  dy: number,
  availableAxes: ShiftAxis[],
): ShiftAxis | null {
  if (availableAxes.length === 0) return null;
  if (availableAxes.length === 1) return availableAxes[0];
  return Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
}

export interface ShiftPreview {
  clampedDelta: number;
  positions: Record<string, { x: number; y: number }>;
  blockingOpenings: string[];
  blockingLockedRoomIds: string[];
}

export function computeCascadeSet(
  plan: FloorPlan,
  rootRoomId: string,
  axis: ShiftAxis,
): Set<string> {
  const perpIsEW = axis === 'x';
  const visited = new Set<string>([rootRoomId]);
  const queue: string[] = [rootRoomId];
  const overlaps = getWallOverlaps(plan);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const o of overlaps) {
      const involves =
        o.roomA.room.id === current || o.roomB.room.id === current;
      if (!involves) continue;
      const currentSide =
        o.roomA.room.id === current ? o.wallA.side : o.wallB.side;
      const isEW = currentSide === 'east' || currentSide === 'west';
      if (perpIsEW !== isEW) continue;
      const neighborId =
        o.roomA.room.id === current ? o.roomB.room.id : o.roomA.room.id;
      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        queue.push(neighborId);
      }
    }
  }
  return visited;
}

export function computeSnapPositions(
  plan: FloorPlan,
  rootRoomId: string,
  axis: ShiftAxis,
): number[] {
  const cascade = computeCascadeSet(plan, rootRoomId, axis);
  const rootPlaced = plan.rooms.find((p) => p.room.id === rootRoomId);
  if (!rootPlaced) return [];
  const rootStart = axis === 'x' ? rootPlaced.position.x : rootPlaced.position.y;

  const perpIsEW = axis === 'x';
  const candidates: number[] = [];

  for (const o of getWallOverlaps(plan)) {
    const aIn = cascade.has(o.roomA.room.id);
    const bIn = cascade.has(o.roomB.room.id);
    // Exactly one side must be in cascade
    if (aIn === bIn) continue;

    const isEW = o.wallA.side === 'east' || o.wallA.side === 'west';
    // Skip cascade-edge walls (perpendicular to axis — these are what defines cascade traversal)
    if (isEW === perpIsEW) continue;

    // This is a parallel-to-axis wall (anchor-side clamp wall) — use it for snap
    const cascadePlaced = aIn ? o.roomA : o.roomB;
    const anchorPlaced = aIn ? o.roomB : o.roomA;

    const cMin = axis === 'x' ? cascadePlaced.position.x : cascadePlaced.position.y;
    const cLen = axis === 'x'
      ? cascadePlaced.room.dimensions.length
      : cascadePlaced.room.dimensions.width;
    const cMax = cMin + cLen;

    const aMin = axis === 'x' ? anchorPlaced.position.x : anchorPlaced.position.y;
    const aLen = axis === 'x'
      ? anchorPlaced.room.dimensions.length
      : anchorPlaced.room.dimensions.width;
    const aMax = aMin + aLen;

    // Low-flush: cascade's low edge aligns with anchor's low edge
    const lowFlush = rootStart + (aMin - cMin);
    // High-flush: cascade's high edge aligns with anchor's high edge
    const highFlush = rootStart + (aMax - cMax);

    candidates.push(lowFlush, highFlush);
  }

  // Deduplicate
  return [...new Set(candidates)];
}

function clampDeltaForWall(
  cascade: Set<string>,
  axis: ShiftAxis,
  signedDelta: number,
  overlaps: ReturnType<typeof getWallOverlaps>,
): number {
  const perpIsEW = axis === 'x';
  let limit = signedDelta;
  for (const o of overlaps) {
    const aIn = cascade.has(o.roomA.room.id);
    const bIn = cascade.has(o.roomB.room.id);
    if (aIn === bIn) continue;
    const isEW = o.wallA.side === 'east' || o.wallA.side === 'west';
    if (perpIsEW === isEW) continue;
    const cascadePlaced = aIn ? o.roomA : o.roomB;
    const anchorPlaced = aIn ? o.roomB : o.roomA;
    const cMin =
      axis === 'x' ? cascadePlaced.position.x : cascadePlaced.position.y;
    const cLen =
      axis === 'x'
        ? cascadePlaced.room.dimensions.length
        : cascadePlaced.room.dimensions.width;
    const cMax = cMin + cLen;
    const aMin =
      axis === 'x' ? anchorPlaced.position.x : anchorPlaced.position.y;
    const aLen =
      axis === 'x'
        ? anchorPlaced.room.dimensions.length
        : anchorPlaced.room.dimensions.width;
    const aMax = aMin + aLen;
    if (signedDelta > 0) {
      limit = Math.min(limit, aMax - cMin);
    } else if (signedDelta < 0) {
      limit = Math.max(limit, aMin - cMax);
    }
  }
  return limit;
}

function computeNewOverlapLength(
  o: ReturnType<typeof getWallOverlaps>[number],
  cascade: Set<string>,
  axis: ShiftAxis,
  delta: number,
): number {
  const aIn = cascade.has(o.roomA.room.id);
  const cascadePlaced = aIn ? o.roomA : o.roomB;
  const anchorPlaced = aIn ? o.roomB : o.roomA;
  const cMin =
    (axis === 'x' ? cascadePlaced.position.x : cascadePlaced.position.y) + delta;
  const cLen =
    axis === 'x'
      ? cascadePlaced.room.dimensions.length
      : cascadePlaced.room.dimensions.width;
  const cMax = cMin + cLen;
  const aMin =
    axis === 'x' ? anchorPlaced.position.x : anchorPlaced.position.y;
  const aLen =
    axis === 'x'
      ? anchorPlaced.room.dimensions.length
      : anchorPlaced.room.dimensions.width;
  const aMax = aMin + aLen;
  return Math.max(0, Math.min(cMax, aMax) - Math.max(cMin, aMin));
}

function findBlockingOpenings(
  plan: FloorPlan,
  cascade: Set<string>,
  axis: ShiftAxis,
  clampedDelta: number,
  overlaps: ReturnType<typeof getWallOverlaps>,
): string[] {
  const blocking: string[] = [];
  for (const shared of plan.sharedOpenings) {
    const aIn = cascade.has(shared.anchorRoomId);
    const bIn = cascade.has(shared.partnerRoomId);
    if (aIn === bIn) continue;
    const raw = overlaps.find((o) => {
      const oriented = orientOverlapTo(o, shared.anchorRoomId);
      return oriented !== null && oriented.wallA.id === shared.anchorWallId;
    });
    if (!raw) continue;
    const oriented = orientOverlapTo(raw, shared.anchorRoomId)!;
    const isEW = oriented.wallA.side === 'east' || oriented.wallA.side === 'west';
    const perpIsEW = axis === 'x';
    if (perpIsEW === isEW) continue;
    const newLen = computeNewOverlapLength(raw, cascade, axis, clampedDelta);
    if (shared.position + shared.width > newLen) {
      blocking.push(shared.id);
    }
  }
  return blocking;
}

export function previewRoomShift(
  plan: FloorPlan,
  roomId: string,
  axis: ShiftAxis,
  deltaMm: number,
): ShiftPreview {
  const overlaps = getWallOverlaps(plan);
  const cascade = computeCascadeSet(plan, roomId, axis);

  const blockingLockedRoomIds: string[] = [];
  for (const id of cascade) {
    const placed = plan.rooms.find((p) => p.room.id === id);
    if (placed?.locked) blockingLockedRoomIds.push(id);
  }

  if (blockingLockedRoomIds.length > 0) {
    return { clampedDelta: 0, positions: {}, blockingOpenings: [], blockingLockedRoomIds };
  }

  const clampedDelta = clampDeltaForWall(cascade, axis, deltaMm, overlaps);
  const positions: Record<string, { x: number; y: number }> = {};
  for (const placed of plan.rooms) {
    if (!cascade.has(placed.room.id)) continue;
    positions[placed.room.id] = {
      x: placed.position.x + (axis === 'x' ? clampedDelta : 0),
      y: placed.position.y + (axis === 'y' ? clampedDelta : 0),
    };
  }
  const blockingOpenings = findBlockingOpenings(plan, cascade, axis, clampedDelta, overlaps);
  return { clampedDelta, positions, blockingOpenings, blockingLockedRoomIds: [] };
}
