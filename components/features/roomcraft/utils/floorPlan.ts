import type { Room, Opening, RoomDimensions } from '../types/room';
import type { FloorPlan, AnchorEdge, PlacedRoom, SharedOpening } from '../types/floorPlan';
import { createWalls } from './room';
import { getWallOverlaps, orientOverlapTo, OPPOSITE } from './adjacency';

export function createFloorPlan(initialRoom: Room): FloorPlan {
  return {
    id: crypto.randomUUID(),
    rooms: [{ room: initialRoom, position: { x: 0, y: 0 }, locked: false }],
    sharedOpenings: [],
    layers: [{ id: crypto.randomUUID(), name: 'Floor', z: 0, visible: true }],
  };
}

export function computeAnchorPosition(
  anchorPosition: { x: number; y: number },
  anchorDimensions: RoomDimensions,
  newDimensions: RoomDimensions,
  edge: AnchorEdge,
): { x: number; y: number } {
  switch (edge) {
    case 'north':
      return { x: anchorPosition.x, y: anchorPosition.y - newDimensions.width };
    case 'south':
      return { x: anchorPosition.x, y: anchorPosition.y + anchorDimensions.width };
    case 'east':
      return { x: anchorPosition.x + anchorDimensions.length, y: anchorPosition.y };
    case 'west':
      return { x: anchorPosition.x - newDimensions.length, y: anchorPosition.y };
  }
}

export function addRoomToFloorPlan(
  floorPlan: FloorPlan,
  newRoom: Room,
  anchorRoomId: string,
  edge: AnchorEdge,
): FloorPlan {
  const anchor = floorPlan.rooms.find((p) => p.room.id === anchorRoomId);
  if (!anchor) return floorPlan;

  const position = computeAnchorPosition(
    anchor.position,
    anchor.room.dimensions,
    newRoom.dimensions,
    edge,
  );

  return {
    ...floorPlan,
    rooms: [...floorPlan.rooms, { room: newRoom, position, locked: false }],
  };
}

export interface FloorPlanBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function getFloorPlanBounds(floorPlan: FloorPlan): FloorPlanBounds {
  if (floorPlan.rooms.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const placed of floorPlan.rooms) {
    const { x, y } = placed.position;
    const { length, width } = placed.room.dimensions;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + length);
    maxY = Math.max(maxY, y + width);
  }

  return { minX, minY, maxX, maxY };
}

export function getPlacedRoom(floorPlan: FloorPlan, roomId: string): PlacedRoom | undefined {
  return floorPlan.rooms.find((p) => p.room.id === roomId);
}

export type AddRoomPreview =
  | { ok: true; promotions: SharedOpening[]; remainingAnchorOpenings: Opening[] }
  | { ok: false; blockingOpenings: Opening[] };

export function previewRoomAddition(
  floorPlan: FloorPlan,
  anchorRoomId: string,
  edge: AnchorEdge,
  newDimensions: RoomDimensions,
): AddRoomPreview {
  const anchor = floorPlan.rooms.find((p) => p.room.id === anchorRoomId);
  if (!anchor) return { ok: true, promotions: [], remainingAnchorOpenings: [] };

  const newPosition = computeAnchorPosition(
    anchor.position,
    anchor.room.dimensions,
    newDimensions,
    edge,
  );

  const syntheticNewRoom: Room = {
    id: '__synthetic__',
    name: '__synthetic__',
    dimensions: newDimensions,
    walls: createWalls(newDimensions),
    openings: [],
    items: [],
    groups: [],
    metadata: { createdAt: '', updatedAt: '', version: 1 },
  };
  const synthetic: FloorPlan = {
    ...floorPlan,
    rooms: [...floorPlan.rooms, { room: syntheticNewRoom, position: newPosition, locked: false }],
  };

  const anchorWall = anchor.room.walls.find((w) => w.side === edge);
  if (!anchorWall) return { ok: true, promotions: [], remainingAnchorOpenings: anchor.room.openings };

  const overlap = getWallOverlaps(synthetic)
    .map((o) => orientOverlapTo(o, anchorRoomId))
    .find((o): o is NonNullable<typeof o> => o !== null && o.wallA.id === anchorWall.id);

  const openingsOnSharedWall = anchor.room.openings.filter((o) => o.wallId === anchorWall.id);
  const openingsOnOtherWalls = anchor.room.openings.filter((o) => o.wallId !== anchorWall.id);

  if (!overlap) {
    return { ok: true, promotions: [], remainingAnchorOpenings: anchor.room.openings };
  }

  const promotions: SharedOpening[] = [];
  const keptOnAnchorWall: Opening[] = [];
  const blocking: Opening[] = [];

  const partnerWall = syntheticNewRoom.walls.find((w) => w.side === OPPOSITE[edge])!;

  for (const opening of openingsOnSharedWall) {
    const openingStart = opening.position;
    const openingEnd = opening.position + opening.width;
    const inside = openingStart >= overlap.startA && openingEnd <= overlap.endA;
    const outside = openingEnd <= overlap.startA || openingStart >= overlap.endA;

    if (outside) {
      keptOnAnchorWall.push(opening);
    } else if (inside) {
      promotions.push({
        id: crypto.randomUUID(),
        type: opening.type,
        anchorRoomId,
        anchorWallId: anchorWall.id,
        partnerRoomId: '__PLACEHOLDER_NEW_ROOM__',
        partnerWallId: partnerWall.id,
        position: openingStart - overlap.startA,
        width: opening.width,
        height: opening.height,
        distanceFromFloor: opening.distanceFromFloor,
        hingeSide: opening.hingeSide,
        swingIntoRoomId:
          opening.type === 'door' || opening.type === 'double-door'
            ? opening.swingDirection === 'outward'
              ? '__PLACEHOLDER_NEW_ROOM__'
              : anchorRoomId
            : undefined,
      });
    } else {
      blocking.push(opening);
    }
  }

  if (blocking.length > 0) return { ok: false, blockingOpenings: blocking };

  return {
    ok: true,
    promotions,
    remainingAnchorOpenings: [...openingsOnOtherWalls, ...keptOnAnchorWall],
  };
}

export function roomHasAttachments(plan: FloorPlan, roomId: string): boolean {
  const placed = plan.rooms.find((p) => p.room.id === roomId);
  if (!placed) return false;
  if (placed.room.openings.length > 0) return true;
  return plan.sharedOpenings.some(
    (s) => s.anchorRoomId === roomId || s.partnerRoomId === roomId,
  );
}

export function isRoomLocked(plan: FloorPlan, roomId: string): boolean {
  const placed = plan.rooms.find((p) => p.room.id === roomId);
  return placed?.locked === true;
}

export function shareSharedOpeningWithLocked(plan: FloorPlan, roomId: string): boolean {
  return plan.sharedOpenings.some((s) => {
    const otherId =
      s.anchorRoomId === roomId ? s.partnerRoomId :
      s.partnerRoomId === roomId ? s.anchorRoomId :
      null;
    return otherId !== null && isRoomLocked(plan, otherId);
  });
}

