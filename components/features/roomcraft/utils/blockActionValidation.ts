import type { RoomItem, Room, WallSide } from '../types/room';
import type { FloorPlan } from '../types/floorPlan';
import { rotateAroundAnchor, resizeAroundAnchor } from './blocks';
import { centerOnWall } from './blockCenterOnWall';
import { isInsideRoom, hasSameLayerOverlap } from './blockValidation';
import { isRoomLocked } from './floorPlan';
import { computeCascadeResize } from './blockResize';
import { findDuplicateOffset } from './blockGroup';

/**
 * Result of a block-action precondition check. On rejection, `reason` is a
 * user-facing toast message. New action validators should reuse this shape.
 */
export type Validation = { ok: true } | { ok: false; reason: string };

const LOCKED_REASON = 'Room is locked. Unlock it from the room list to make changes.';

function checkLocked(room: Room, floorPlan: FloorPlan): Validation | null {
  if (isRoomLocked(floorPlan, room.id)) return { ok: false, reason: LOCKED_REASON };
  return null;
}

// Use when the action's two failure modes are "exits the room" and "overlaps a
// same-layer block." validateCenterOnWall (too-large vs blocked) and
// validateResizeGroup (cascade failure) have distinct semantics — inline their checks.
function checkPlacement(candidate: RoomItem, room: Room, outOfRoomReason: string, overlapReason: string): Validation {
  if (!isInsideRoom(candidate, room)) return { ok: false, reason: outOfRoomReason };
  if (hasSameLayerOverlap(candidate, room)) return { ok: false, reason: overlapReason };
  return { ok: true };
}

export function validateRotate(
  block: RoomItem,
  direction: 'cw' | 'ccw',
  room: Room,
  floorPlan: FloorPlan,
): Validation {
  const locked = checkLocked(room, floorPlan);
  if (locked) return locked;
  const candidate = rotateAroundAnchor(block, direction);
  return checkPlacement(
    candidate,
    room,
    "Can't rotate — block would extend outside the room.",
    "Can't rotate — would overlap another block on this layer.",
  );
}

export function validateResize(
  block: RoomItem,
  next: { length: number; depth: number; height: number },
  room: Room,
  floorPlan: FloorPlan,
): Validation {
  const locked = checkLocked(room, floorPlan);
  if (locked) return locked;
  const candidate = resizeAroundAnchor(block, next);
  return checkPlacement(
    candidate,
    room,
    "Can't resize — block would extend outside the room.",
    "Can't resize — would overlap another block on this layer.",
  );
}

// First arg is groupId, not a block — group resize operates on all members of the group.
export function validateResizeGroup(
  groupId: string,
  next: { length: number; depth: number; height: number },
  room: Room,
  floorPlan: FloorPlan,
): Validation {
  const locked = checkLocked(room, floorPlan);
  if (locked) return locked;
  // computeCascadeResize returns null on failure (overlap, out-of-room, etc.)
  const result = computeCascadeResize({ groupId, ...next }, room);
  if (result === null) {
    return { ok: false, reason: "Can't resize group — cascade would push a member into a wall or another block." };
  }
  return { ok: true };
}

export function validateMoveToLayer(
  block: RoomItem,
  newLayerId: string,
  room: Room,
  floorPlan: FloorPlan,
): Validation {
  const locked = checkLocked(room, floorPlan);
  if (locked) return locked;
  const candidate: RoomItem = { ...block, layerId: newLayerId };
  if (hasSameLayerOverlap(candidate, room)) {
    const layer = floorPlan.layers.find((l) => l.id === newLayerId);
    const layerName = layer?.name ?? newLayerId;
    return { ok: false, reason: `Can't move to layer "${layerName}" — a block is already in that position.` };
  }
  return { ok: true };
}

export function validateCenterOnWall(
  block: RoomItem,
  side: WallSide,
  room: Room,
  floorPlan: FloorPlan,
): Validation {
  const locked = checkLocked(room, floorPlan);
  if (locked) return locked;
  const candidate = centerOnWall(block, side, room);
  // "too large" before "overlap" — actionable reason wins.
  if (!isInsideRoom(candidate, room)) {
    return { ok: false, reason: 'Block too large to center on this wall.' };
  }
  if (hasSameLayerOverlap(candidate, room)) {
    return { ok: false, reason: "Can't center — another block is in the way." };
  }
  return { ok: true };
}

export function validateDuplicate(
  block: RoomItem,
  room: Room,
  floorPlan: FloorPlan,
): Validation {
  const locked = checkLocked(room, floorPlan);
  if (locked) return locked;
  const offset = findDuplicateOffset(block, room);
  if (!offset) {
    return { ok: false, reason: "Can't duplicate — no free space next to this block." };
  }
  return { ok: true };
}

export function validateAddBlockAt(
  values: { layerId: string; length: number; depth: number; height: number },
  position: { x: number; y: number },
  room: Room,
  floorPlan: FloorPlan,
): Validation {
  const locked = checkLocked(room, floorPlan);
  if (locked) return locked;
  const candidate: RoomItem = {
    id: '__candidate__',
    label: 'Block',
    layerId: values.layerId,
    x: position.x, y: position.y,
    length: values.length, depth: values.depth, height: values.height,
    rotation: 0,
    anchor: { x: 'center', y: 'max', z: 'min' },
  };
  return checkPlacement(
    candidate,
    room,
    "Can't place — block would extend outside the room.",
    "Can't place — block would overlap another block on this layer.",
  );
}

/**
 * Re-resolve a block + its room from the live floorPlan. Used by deferred
 * actions (dialog onSubmit, confirm modal Continue) where state may have
 * mutated between the snapshot and the dispatch — e.g., the block was deleted
 * or moved. Returns null if either the room or block can't be found.
 */
export function lookupLiveBlock(
  floorPlan: FloorPlan,
  roomId: string,
  blockId: string,
): { room: Room; block: RoomItem } | null {
  const placed = floorPlan.rooms.find((r) => r.room.id === roomId);
  const room = placed?.room;
  const block = room?.items.find((i) => i.id === blockId);
  if (!room || !block) return null;
  return { room, block };
}
