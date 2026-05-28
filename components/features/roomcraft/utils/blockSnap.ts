import type { Room, RoomItem } from '../types/room';
import { rotatedFootprint, footprintAABB, rectsOverlap } from './blocks';
import { findChainAt } from './blockChain';

const THRESHOLD = 50;

interface XY { x: number; y: number; }

export function snapPositionToWalls(
  pos: XY,
  b: Pick<RoomItem, 'length' | 'depth' | 'rotation'>,
  room: Pick<Room, 'dimensions'>,
): XY {
  const { length, depth } = rotatedFootprint(b as RoomItem);
  let x = pos.x, y = pos.y;
  // Pick the closer wall when both edges are in threshold (matters for snug-fit blocks in narrow rooms).
  const westDist = Math.abs(x);
  const eastDist = Math.abs(room.dimensions.length - (x + length));
  if (westDist <= THRESHOLD || eastDist <= THRESHOLD) {
    x = westDist <= eastDist ? 0 : room.dimensions.length - length;
  }
  const northDist = Math.abs(y);
  const southDist = Math.abs(room.dimensions.width - (y + depth));
  if (northDist <= THRESHOLD || southDist <= THRESHOLD) {
    y = northDist <= southDist ? 0 : room.dimensions.width - depth;
  }
  return { x, y };
}

export function snapPositionToBlocks(
  pos: XY,
  target: RoomItem,
  sameLayerOthers: RoomItem[],
  roomDims: { length: number; width: number },
): XY {
  let x = pos.x, y = pos.y;
  const { length: tL, depth: tD } = rotatedFootprint(target);

  // Naive per-edge snap (existing behavior).
  for (const other of sameLayerOthers) {
    if (other.id === target.id) continue;
    const { length: oL, depth: oD } = rotatedFootprint(other);
    const targetEastX = x + tL;
    const targetWestX = x;
    const otherWestX = other.x;
    const otherEastX = other.x + oL;
    if (Math.abs(targetEastX - otherWestX) <= THRESHOLD) x = otherWestX - tL;
    else if (Math.abs(targetWestX - otherEastX) <= THRESHOLD) x = otherEastX;
    const targetSouthY = y + tD;
    const targetNorthY = y;
    const otherNorthY = other.y;
    const otherSouthY = other.y + oD;
    if (Math.abs(targetSouthY - otherNorthY) <= THRESHOLD) y = otherNorthY - tD;
    else if (Math.abs(targetNorthY - otherSouthY) <= THRESHOLD) y = otherSouthY;
  }

  // Smart-snap fallback: if naive result overlaps any other block on the same
  // layer, walk the chain containing the snap edge and snap to its end.
  const overlapping = (px: number, py: number) => {
    const probe = { ...target, x: px, y: py };
    const probeAABB = footprintAABB(probe);
    for (const other of sameLayerOthers) {
      if (other.id === target.id) continue;
      if (rectsOverlap(probeAABB, footprintAABB(other))) return true;
    }
    return false;
  };
  const insideRoom = (px: number, py: number, axis: 'x' | 'y') => {
    if (axis === 'x') {
      return px >= 0 && px + tL <= roomDims.length;
    }
    return py >= 0 && py + tD <= roomDims.width;
  };

  // X axis fallback
  if (overlapping(x, y)) {
    // Probe both target edges; first non-null chain wins. If the target straddles
    // a gap between two chains, only the chain at `x` is considered.
    const chainCandidates = [
      findChainAt(x, 'x', sameLayerOthers),
      findChainAt(x + tL, 'x', sameLayerOthers),
    ];
    const chain = chainCandidates.find((c) => c !== null) ?? null;
    if (chain) {
      const minSnap = chain.minEdge - tL;  // target's east edge flush with chain.minEdge
      const maxSnap = chain.maxEdge;        // target's west edge flush with chain.maxEdge
      const minValid = insideRoom(minSnap, y, 'x') && !overlapping(minSnap, y);
      const maxValid = insideRoom(maxSnap, y, 'x') && !overlapping(maxSnap, y);
      const chainCenter = (chain.minEdge + chain.maxEdge) / 2;
      const preferMin = pos.x < chainCenter;
      if (preferMin) {
        if (minValid) x = minSnap;
        else if (maxValid) x = maxSnap;
      } else {
        if (maxValid) x = maxSnap;
        else if (minValid) x = minSnap;
      }
    }
  }

  // Y axis fallback (mirror of X)
  if (overlapping(x, y)) {
    const chainCandidates = [
      findChainAt(y, 'y', sameLayerOthers),
      findChainAt(y + tD, 'y', sameLayerOthers),
    ];
    const chain = chainCandidates.find((c) => c !== null) ?? null;
    if (chain) {
      const minSnap = chain.minEdge - tD;
      const maxSnap = chain.maxEdge;
      const minValid = insideRoom(x, minSnap, 'y') && !overlapping(x, minSnap);
      const maxValid = insideRoom(x, maxSnap, 'y') && !overlapping(x, maxSnap);
      const chainCenter = (chain.minEdge + chain.maxEdge) / 2;
      const preferMin = pos.y < chainCenter;
      if (preferMin) {
        if (minValid) y = minSnap;
        else if (maxValid) y = maxSnap;
      } else {
        if (maxValid) y = maxSnap;
        else if (minValid) y = minSnap;
      }
    }
  }

  return { x, y };
}
