import type { RoomItem, AnchorAxisValue } from '../types/room';

export interface FootprintAABB { minX: number; maxX: number; minY: number; maxY: number; }
export interface Vertical3DAABB { minZ: number; maxZ: number; }

/** Effective length/depth after rotation. */
export function rotatedFootprint(b: RoomItem): { length: number; depth: number } {
  const swap = b.rotation === 90 || b.rotation === 270;
  return swap ? { length: b.depth, depth: b.length } : { length: b.length, depth: b.depth };
}

export function footprintAABB(b: RoomItem): FootprintAABB {
  const { length, depth } = rotatedFootprint(b);
  return { minX: b.x, maxX: b.x + length, minY: b.y, maxY: b.y + depth };
}

export function vertical3DAABB(b: RoomItem, layerZ: number): Vertical3DAABB {
  return { minZ: layerZ, maxZ: layerZ + b.height };
}

export function rectsOverlap(a: FootprintAABB, b: FootprintAABB): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

export function rangesOverlap(a: Vertical3DAABB, b: Vertical3DAABB): boolean {
  return a.minZ < b.maxZ && b.minZ < a.maxZ;
}

export function anchorPlanPosition(b: RoomItem): { x: number; y: number } {
  const { length, depth } = rotatedFootprint(b);
  return {
    x: b.x + axisOffset(length, b.anchor.x === 'min' ? 'min' : b.anchor.x === 'max' ? 'max' : 'center'),
    y: b.y + axisOffset(depth, b.anchor.y === 'min' ? 'min' : b.anchor.y === 'max' ? 'max' : 'center'),
  };
}

function axisOffset(extent: number, anchor: AnchorAxisValue): number {
  if (anchor === 'min') return 0;
  if (anchor === 'max') return extent;
  return extent / 2;
}

function invertAxisValue(value: AnchorAxisValue): AnchorAxisValue {
  if (value === 'min') return 'max';
  if (value === 'max') return 'min';
  return 'center';
}

function rotateAnchorInPlan(
  anchor: RoomItem['anchor'],
  direction: 'cw' | 'ccw',
): RoomItem['anchor'] {
  if (direction === 'cw') {
    return { x: anchor.y, y: invertAxisValue(anchor.x), z: anchor.z };
  }
  return { x: invertAxisValue(anchor.y), y: anchor.x, z: anchor.z };
}

/**
 * Returns a new block with the given new dimensions, repositioning x/y so the
 * anchor point in plan view is unchanged. Z anchor doesn't affect plan position
 * (height is purely vertical) but is used by 3D conflict checks elsewhere.
 *
 * NB: the input length/depth are interpreted PRE-rotation (the underlying field).
 * This function does not change rotation.
 */
export function resizeAroundAnchor(
  b: RoomItem,
  next: { length: number; depth: number; height: number },
): RoomItem {
  const beforePivot = anchorPlanPosition(b);
  const candidate: RoomItem = { ...b, length: next.length, depth: next.depth, height: next.height };
  const afterPivot = anchorPlanPosition(candidate);
  const dx = beforePivot.x - afterPivot.x;
  const dy = beforePivot.y - afterPivot.y;
  return { ...candidate, x: candidate.x + dx, y: candidate.y + dy };
}

/**
 * Returns a new block rotated 90° in the given direction, repositioning x/y so the
 * anchor point in plan view is unchanged. This preserves the pivot while the footprint
 * rotates around it.
 */
export function rotateAroundAnchor(b: RoomItem, direction: 'cw' | 'ccw'): RoomItem {
  const before = anchorPlanPosition(b);
  const newRot = (direction === 'cw' ? (b.rotation + 90) % 360 : (b.rotation + 270) % 360) as 0 | 90 | 180 | 270;
  const candidate: RoomItem = { ...b, rotation: newRot, anchor: rotateAnchorInPlan(b.anchor, direction) };
  const after = anchorPlanPosition(candidate);
  return { ...candidate, x: candidate.x + (before.x - after.x), y: candidate.y + (before.y - after.y) };
}

type CreateBlockInit = {
  label: string;
  layerId: string;
  x: number; y: number;
  length: number; depth: number; height: number;
  rotation: 0 | 90 | 180 | 270;
};

export function createBlock(init: CreateBlockInit): RoomItem {
  return {
    id: crypto.randomUUID(),
    label: init.label,
    layerId: init.layerId,
    x: init.x, y: init.y,
    length: init.length, depth: init.depth, height: init.height,
    rotation: init.rotation,
    anchor: { x: 'center', y: 'max', z: 'min' },
  };
}
