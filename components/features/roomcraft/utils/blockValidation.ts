import type { Room, RoomItem, Opening } from '../types/room';
import type { FloorPlan } from '../types/floorPlan';
import { footprintAABB, rectsOverlap, vertical3DAABB, rangesOverlap, type FootprintAABB } from './blocks';

export type SoftWarning =
  | { type: 'cross-layer-conflict'; otherBlockId: string }
  | { type: 'ceiling-poke' }
  | { type: 'door-blocked'; openingId: string }
  | { type: 'window-blocked'; openingId: string };

function ceilingPokes(target: RoomItem, layerZ: number, room: Room): boolean {
  return layerZ + target.height > room.dimensions.height;
}

function doorSwingArcAABB(opening: Opening, room: Room): FootprintAABB | null {
  if (opening.type !== 'door' && opening.type !== 'double-door') return null;
  const wall = room.walls.find((w) => w.id === opening.wallId);
  if (!wall) return null;
  const w = opening.width;
  const isInward = opening.swingDirection !== 'outward';

  // Hinge & swing depth in plan units, mapped per wall side.
  switch (wall.side) {
    case 'north': {
      const hingeY = 0;
      const minY = isInward ? hingeY : hingeY - w;
      const maxY = isInward ? hingeY + w : hingeY;
      return { minX: opening.position, maxX: opening.position + w, minY, maxY };
    }
    case 'south': {
      const hingeY = room.dimensions.width;
      const minY = isInward ? hingeY - w : hingeY;
      const maxY = isInward ? hingeY : hingeY + w;
      return { minX: opening.position, maxX: opening.position + w, minY, maxY };
    }
    case 'west': {
      const hingeX = 0;
      const minX = isInward ? hingeX : hingeX - w;
      const maxX = isInward ? hingeX + w : hingeX;
      return { minX, maxX, minY: opening.position, maxY: opening.position + w };
    }
    case 'east': {
      const hingeX = room.dimensions.length;
      const minX = isInward ? hingeX - w : hingeX;
      const maxX = isInward ? hingeX : hingeX + w;
      return { minX, maxX, minY: opening.position, maxY: opening.position + w };
    }
  }
}

function blockTouchesWall(target: RoomItem, wallSide: 'north'|'south'|'east'|'west', room: Room, opening: Opening): boolean {
  const aabb = footprintAABB(target);
  const opStart = opening.position;
  const opEnd = opening.position + opening.width;
  const epsilon = 0.5;
  switch (wallSide) {
    case 'north':
      return aabb.minY <= epsilon && aabb.minX < opEnd && aabb.maxX > opStart;
    case 'south':
      return aabb.maxY >= room.dimensions.width - epsilon && aabb.minX < opEnd && aabb.maxX > opStart;
    case 'west':
      return aabb.minX <= epsilon && aabb.minY < opEnd && aabb.maxY > opStart;
    case 'east':
      return aabb.maxX >= room.dimensions.length - epsilon && aabb.minY < opEnd && aabb.maxY > opStart;
  }
}

export function computeSoftWarnings(target: RoomItem, room: Room, fp: FloorPlan): SoftWarning[] {
  const warnings: SoftWarning[] = [];
  const targetLayer = fp.layers.find((l) => l.id === target.layerId);
  if (!targetLayer) return warnings;

  const targetFootprint = footprintAABB(target);
  const targetVerticalRange = vertical3DAABB(target, targetLayer.z);

  for (const other of room.items) {
    if (other.id === target.id) continue;
    if (other.layerId === target.layerId) continue;  // same-layer is hard-blocked elsewhere
    const otherLayer = fp.layers.find((l) => l.id === other.layerId);
    if (!otherLayer) continue;
    if (!rectsOverlap(targetFootprint, footprintAABB(other))) continue;
    if (!rangesOverlap(targetVerticalRange, vertical3DAABB(other, otherLayer.z))) continue;
    warnings.push({ type: 'cross-layer-conflict', otherBlockId: other.id });
  }

  // Ceiling poke
  if (ceilingPokes(target, targetLayer.z, room)) {
    warnings.push({ type: 'ceiling-poke' });
  }

  // Door blocked
  for (const opening of room.openings) {
    const arc = doorSwingArcAABB(opening, room);
    if (!arc) continue;
    if (rectsOverlap(targetFootprint, arc)) {
      warnings.push({ type: 'door-blocked', openingId: opening.id });
    }
  }

  // Window blocked
  for (const opening of room.openings) {
    if (opening.type !== 'window') continue;
    const wall = room.walls.find((w) => w.id === opening.wallId);
    if (!wall) continue;
    const winMinZ = opening.distanceFromFloor;
    const winMaxZ = opening.distanceFromFloor + opening.height;
    const blockMinZ = targetLayer.z;
    const blockMaxZ = targetLayer.z + target.height;
    const verticalOverlap = blockMinZ < winMaxZ && winMinZ < blockMaxZ;
    if (!verticalOverlap) continue;
    if (!blockTouchesWall(target, wall.side, room, opening)) continue;
    warnings.push({ type: 'window-blocked', openingId: opening.id });
  }

  return warnings;
}

export function hasSameLayerOverlap(target: RoomItem, room: Room): boolean {
  const aabb = footprintAABB(target);
  for (const other of room.items) {
    if (other.id === target.id) continue;
    if (other.layerId !== target.layerId) continue;
    if (rectsOverlap(aabb, footprintAABB(other))) return true;
  }
  return false;
}

export function isInsideRoom(target: RoomItem, room: Room): boolean {
  const aabb = footprintAABB(target);
  return aabb.minX >= 0 && aabb.minY >= 0 && aabb.maxX <= room.dimensions.length && aabb.maxY <= room.dimensions.width;
}
