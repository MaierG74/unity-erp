import type { Opening, OpeningType, Wall, Room } from '../types/room';
import type { SharedOpening, FloorPlan } from '../types/floorPlan';
import { OPENING_DEFAULTS, OPENING_VALIDATION } from '../constants/theme';
import { roomToCanvas } from './scale';
import { findOverlapForShared } from './adjacency';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export interface WallSegment {
  start: number; // mm from wall left edge
  end: number;   // mm from wall left edge
}

export interface SharedSegmentContext {
  sharedOpenings: SharedOpening[];
  wallIdToLocalStart: Record<string, number>;
  currentRoomId: string;
  currentWallId: string;
}

export function createOpening(type: OpeningType, wallId: string, wall: Wall): Opening {
  const defaults = OPENING_DEFAULTS[type];
  const position = Math.round((wall.length - defaults.width) / 2);

  const opening: Opening = {
    id: crypto.randomUUID(),
    wallId,
    type,
    position,
    width: defaults.width,
    height: defaults.height,
    distanceFromFloor: defaults.distanceFromFloor,
  };

  if (type === 'door') {
    opening.hingeSide = OPENING_DEFAULTS.door.hingeSide;
    opening.swingDirection = OPENING_DEFAULTS.door.swingDirection;
  } else if (type === 'double-door') {
    opening.swingDirection = OPENING_DEFAULTS['double-door'].swingDirection;
  }

  return opening;
}

export function validateOpeningPosition(
  opening: Opening,
  wall: Wall,
  existingOpenings: Opening[],
): ValidationResult {
  const minDist = OPENING_VALIDATION.minCornerDistance;
  const rightEdge = opening.position + opening.width;

  // Check wall bounds
  if (opening.position < minDist) {
    return { valid: false, reason: 'Too close to left corner (minimum 100mm)' };
  }
  if (rightEdge > wall.length - minDist) {
    return { valid: false, reason: 'Too close to right corner or extends beyond wall' };
  }

  // Check overlap with existing openings on same wall
  const sameWall = existingOpenings.filter(
    (o) => o.wallId === opening.wallId && o.id !== opening.id,
  );
  for (const existing of sameWall) {
    const existingRight = existing.position + existing.width;
    if (opening.position < existingRight && rightEdge > existing.position) {
      return { valid: false, reason: 'Openings overlap on the same wall' };
    }
  }

  return { valid: true };
}

export function getWallOpenings(openings: Opening[], wallId: string): Opening[] {
  return openings
    .filter((o) => o.wallId === wallId)
    .sort((a, b) => a.position - b.position);
}

export function getWallSegments(
  wall: Wall,
  openings: Opening[],
  sharedCtx?: SharedSegmentContext,
): WallSegment[] {
  const wallOpenings = getWallOpenings(openings, wall.id);
  const sharedRanges = sharedCtx
    ? sharedOpeningsOnWall(wall, sharedCtx)
    : [];

  const ranges = [
    ...wallOpenings.map((o) => ({ start: o.position, end: o.position + o.width })),
    ...sharedRanges,
  ].sort((a, b) => a.start - b.start);

  if (ranges.length === 0) {
    return [{ start: 0, end: wall.length }];
  }

  const segments: WallSegment[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor) segments.push({ start: cursor, end: r.start });
    cursor = Math.max(cursor, r.end);
  }
  if (cursor < wall.length) segments.push({ start: cursor, end: wall.length });
  return segments;
}

function sharedOpeningsOnWall(
  wall: Wall,
  ctx: SharedSegmentContext,
): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const localStart = ctx.wallIdToLocalStart[wall.id];
  if (localStart === undefined) return out;
  for (const s of ctx.sharedOpenings) {
    const onThisWall =
      (s.anchorRoomId === ctx.currentRoomId && s.anchorWallId === ctx.currentWallId) ||
      (s.partnerRoomId === ctx.currentRoomId && s.partnerWallId === ctx.currentWallId);
    if (!onThisWall) continue;
    if (wall.id !== ctx.currentWallId) continue;
    const start = localStart + s.position;
    out.push({ start, end: start + s.width });
  }
  return out;
}

export function hitTestOpenings(
  canvasX: number,
  canvasY: number,
  room: Room,
  scale: number,
  offset: { x: number; y: number },
  roomOrigin: { x: number; y: number } = { x: 0, y: 0 },
): string | null {
  const minHit = OPENING_VALIDATION.minHitAreaPx;

  for (const wall of room.walls) {
    const wallOpenings = getWallOpenings(room.openings, wall.id);
    for (const opening of wallOpenings) {
      const geo = getWallGeometryForHitTest(
        wall,
        room.dimensions.length,
        room.dimensions.width,
        scale,
        offset,
        roomOrigin,
      );
      const leftX = geo.startX + opening.position * scale * geo.dx;
      const leftY = geo.startY + opening.position * scale * geo.dy;
      const rightX = leftX + opening.width * scale * geo.dx;
      const rightY = leftY + opening.width * scale * geo.dy;

      const minX = Math.min(leftX, rightX) - minHit;
      const maxX = Math.max(leftX, rightX) + minHit;
      const minY = Math.min(leftY, rightY) - minHit;
      const maxY = Math.max(leftY, rightY) + minHit;

      if (canvasX >= minX && canvasX <= maxX && canvasY >= minY && canvasY <= maxY) {
        return opening.id;
      }
    }
  }

  return null;
}

function getWallGeometryForHitTest(
  wall: Wall,
  roomLength: number,
  roomWidth: number,
  scale: number,
  offset: { x: number; y: number },
  roomOrigin: { x: number; y: number } = { x: 0, y: 0 },
) {
  const tl = roomToCanvas(roomOrigin.x, roomOrigin.y, scale, offset);

  switch (wall.side) {
    case 'north':
      return { startX: tl.x, startY: tl.y, dx: 1, dy: 0 };
    case 'south':
      return { startX: tl.x, startY: tl.y + roomWidth * scale, dx: 1, dy: 0 };
    case 'west':
      return { startX: tl.x, startY: tl.y, dx: 0, dy: 1 };
    case 'east':
      return { startX: tl.x + roomLength * scale, startY: tl.y, dx: 0, dy: 1 };
  }
}

export function hitTestSharedOpenings(
  canvasX: number,
  canvasY: number,
  floorPlan: FloorPlan,
  scale: number,
  offset: { x: number; y: number },
): string | null {
  const minHit = OPENING_VALIDATION.minHitAreaPx;
  for (const s of floorPlan.sharedOpenings) {
    const oriented = findOverlapForShared(floorPlan, s);
    if (!oriented) continue;
    const wallLocalStart = oriented.startA + s.position;
    const geo = getWallGeometryForHitTest(
      oriented.wallA,
      oriented.roomA.room.dimensions.length,
      oriented.roomA.room.dimensions.width,
      scale,
      offset,
      oriented.roomA.position,
    );
    const leftX = geo.startX + wallLocalStart * scale * geo.dx;
    const leftY = geo.startY + wallLocalStart * scale * geo.dy;
    const rightX = leftX + s.width * scale * geo.dx;
    const rightY = leftY + s.width * scale * geo.dy;
    const minX = Math.min(leftX, rightX) - minHit;
    const maxX = Math.max(leftX, rightX) + minHit;
    const minY = Math.min(leftY, rightY) - minHit;
    const maxY = Math.max(leftY, rightY) + minHit;
    if (canvasX >= minX && canvasX <= maxX && canvasY >= minY && canvasY <= maxY) {
      return s.id;
    }
  }
  return null;
}
