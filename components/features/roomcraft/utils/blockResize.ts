import type { Room, RoomItem } from '../types/room';
import { footprintAABB, rectsOverlap, resizeAroundAnchor } from './blocks';

interface ResizeRequest { groupId: string; length: number; depth: number; height: number; }

interface ResizeResult { items: RoomItem[]; }

// Safeguard against runaway loops if the cascade fails to converge. Min-translation
// over a small group should resolve in O(n²) shifts; 200 is comfortably above that.
const MAX_ITERATIONS = 200;

export function computeCascadeResize(req: ResizeRequest, room: Room): ResizeResult | null {
  const groupMembers = room.items.filter((i) => i.groupId === req.groupId);
  if (groupMembers.length === 0) return null;

  let updated = groupMembers.map((m) =>
    resizeAroundAnchor(m, { length: req.length, depth: req.depth, height: req.height }),
  );

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const collision = findGroupCollision(updated);
    if (!collision) break;
    const { i, j } = collision;
    const a = updated[i], b = updated[j];
    const overlap = computeOverlap(a, b);
    // Shift along the smaller-overlap axis (minimum-translation).
    if (Math.abs(overlap.dx) <= Math.abs(overlap.dy)) {
      updated = updated.map((m, idx) =>
        idx === j ? { ...m, x: m.x + signAwayX(a, b) * Math.abs(overlap.dx) } : m,
      );
    } else {
      updated = updated.map((m, idx) =>
        idx === j ? { ...m, y: m.y + signAwayY(a, b) * Math.abs(overlap.dy) } : m,
      );
    }
  }
  if (findGroupCollision(updated)) return null;

  const nonGroup = room.items.filter((i) => i.groupId !== req.groupId);
  for (const u of updated) {
    const aabb = footprintAABB(u);
    if (
      aabb.minX < 0 ||
      aabb.minY < 0 ||
      aabb.maxX > room.dimensions.length ||
      aabb.maxY > room.dimensions.width
    ) {
      return null;
    }
    for (const og of nonGroup) {
      if (og.layerId !== u.layerId) continue;
      if (rectsOverlap(aabb, footprintAABB(og))) return null;
    }
  }

  return { items: updated };
}

function findGroupCollision(items: RoomItem[]): { i: number; j: number } | null {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (items[i].layerId !== items[j].layerId) continue;
      if (rectsOverlap(footprintAABB(items[i]), footprintAABB(items[j]))) return { i, j };
    }
  }
  return null;
}

function computeOverlap(a: RoomItem, b: RoomItem): { dx: number; dy: number } {
  const aR = footprintAABB(a), bR = footprintAABB(b);
  const dx = Math.min(aR.maxX, bR.maxX) - Math.max(aR.minX, bR.minX);
  const dy = Math.min(aR.maxY, bR.maxY) - Math.max(aR.minY, bR.minY);
  return { dx, dy };
}

// Midpoints derived from the rotated footprint so members with rotation 90/270
// are compared on their true X/Y extents, not the raw length/depth fields.
function signAwayX(a: RoomItem, b: RoomItem) {
  const aR = footprintAABB(a);
  const bR = footprintAABB(b);
  return bR.minX + bR.maxX >= aR.minX + aR.maxX ? 1 : -1;
}

function signAwayY(a: RoomItem, b: RoomItem) {
  const aR = footprintAABB(a);
  const bR = footprintAABB(b);
  return bR.minY + bR.maxY >= aR.minY + aR.maxY ? 1 : -1;
}
