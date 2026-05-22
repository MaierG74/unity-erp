import type { Room, RoomItem } from '../types/room';
import type { Layer, FloorPlan } from '../types/floorPlan';
import { getWallOverlaps } from './adjacency';
import { footprintAABB } from './blocks';

export interface MeasurementLine {
  side: 'north' | 'south' | 'east' | 'west';
  gapMm: number;
  targetType: 'wall' | 'opening' | 'block';
}

export interface LateralMeasurement {
  wall: 'north' | 'south' | 'east' | 'west';
  gapMm: number;
  parallelStart: number; // room-local coord of the block's nearest edge
  parallelEnd: number;   // room-local coord of the opening's nearest edge
  perpCoord: number;     // where the line sits (block face toward the wall)
}

export function computeMeasurementLines(
  block: RoomItem,
  room: Room,
  layers: Layer[],
  floorPlan?: FloorPlan,
): MeasurementLine[] {
  const aabb = footprintAABB(block);
  const { length: roomLength, width: roomWidth } = room.dimensions;
  const visibleLayerIds = new Set(layers.filter((layer) => layer.visible).map((layer) => layer.id));
  const otherAABBs = room.items
    .filter((item) => item.id !== block.id && visibleLayerIds.has(item.layerId))
    .map((item) => footprintAABB(item));

  // Build wallId → overlap-zone local start for shared opening position conversion
  const wallIdToLocalStart: Record<string, number> = {};
  if (floorPlan) {
    for (const o of getWallOverlaps(floorPlan)) {
      if (o.roomA.room.id === room.id) wallIdToLocalStart[o.wallA.id] = o.startA;
      if (o.roomB.room.id === room.id) wallIdToLocalStart[o.wallB.id] = o.startB;
    }
  }

  const lines: MeasurementLine[] = [];

  const wallHasOpening = (wallId: string): boolean => {
    if (!room.walls.some((wall) => wall.id === wallId)) return false;
    if (room.openings.some((opening) => opening.wallId === wallId)) return true;
    if (floorPlan && wallIdToLocalStart[wallId] !== undefined) {
      return floorPlan.sharedOpenings.some(
        (so) => so.anchorWallId === wallId || so.partnerWallId === wallId,
      );
    }
    return false;
  };

  {
    const wallGap = aabb.minY;
    const parallelMin = aabb.minX;
    const parallelMax = aabb.maxX;
    const northWallId = room.walls.find((wall) => wall.side === 'north')?.id ?? '';
    let nearestBlockGap = Infinity;

    for (const other of otherAABBs) {
      if (other.maxY > aabb.minY) continue;
      if (other.minX >= parallelMax || other.maxX <= parallelMin) continue;
      nearestBlockGap = Math.min(nearestBlockGap, aabb.minY - other.maxY);
    }

    if (nearestBlockGap <= wallGap) {
      lines.push({ side: 'north', gapMm: nearestBlockGap, targetType: 'block' });
    } else {
      const targetType = wallHasOpening(northWallId) ? 'opening' : 'wall';
      lines.push({ side: 'north', gapMm: wallGap, targetType });
    }
  }

  {
    const wallGap = roomWidth - aabb.maxY;
    const parallelMin = aabb.minX;
    const parallelMax = aabb.maxX;
    const southWallId = room.walls.find((wall) => wall.side === 'south')?.id ?? '';
    let nearestBlockGap = Infinity;

    for (const other of otherAABBs) {
      if (other.minY < aabb.maxY) continue;
      if (other.minX >= parallelMax || other.maxX <= parallelMin) continue;
      nearestBlockGap = Math.min(nearestBlockGap, other.minY - aabb.maxY);
    }

    if (nearestBlockGap <= wallGap) {
      lines.push({ side: 'south', gapMm: nearestBlockGap, targetType: 'block' });
    } else {
      const targetType = wallHasOpening(southWallId) ? 'opening' : 'wall';
      lines.push({ side: 'south', gapMm: wallGap, targetType });
    }
  }

  {
    const wallGap = aabb.minX;
    const parallelMin = aabb.minY;
    const parallelMax = aabb.maxY;
    const westWallId = room.walls.find((wall) => wall.side === 'west')?.id ?? '';
    let nearestBlockGap = Infinity;

    for (const other of otherAABBs) {
      if (other.maxX > aabb.minX) continue;
      if (other.minY >= parallelMax || other.maxY <= parallelMin) continue;
      nearestBlockGap = Math.min(nearestBlockGap, aabb.minX - other.maxX);
    }

    if (nearestBlockGap <= wallGap) {
      lines.push({ side: 'west', gapMm: nearestBlockGap, targetType: 'block' });
    } else {
      const targetType = wallHasOpening(westWallId) ? 'opening' : 'wall';
      lines.push({ side: 'west', gapMm: wallGap, targetType });
    }
  }

  {
    const wallGap = roomLength - aabb.maxX;
    const parallelMin = aabb.minY;
    const parallelMax = aabb.maxY;
    const eastWallId = room.walls.find((wall) => wall.side === 'east')?.id ?? '';
    let nearestBlockGap = Infinity;

    for (const other of otherAABBs) {
      if (other.minX < aabb.maxX) continue;
      if (other.minY >= parallelMax || other.maxY <= parallelMin) continue;
      nearestBlockGap = Math.min(nearestBlockGap, other.minX - aabb.maxX);
    }

    if (nearestBlockGap <= wallGap) {
      lines.push({ side: 'east', gapMm: nearestBlockGap, targetType: 'block' });
    } else {
      const targetType = wallHasOpening(eastWallId) ? 'opening' : 'wall';
      lines.push({ side: 'east', gapMm: wallGap, targetType });
    }
  }

  return lines;
}

export function computeLateralMeasurements(
  block: RoomItem,
  room: Room,
  _layers: Layer[],
  floorPlan?: FloorPlan,
): LateralMeasurement[] {
  const aabb = footprintAABB(block);

  const wallIdToLocalStart: Record<string, number> = {};
  if (floorPlan) {
    for (const o of getWallOverlaps(floorPlan)) {
      if (o.roomA.room.id === room.id) wallIdToLocalStart[o.wallA.id] = o.startA;
      if (o.roomB.room.id === room.id) wallIdToLocalStart[o.wallB.id] = o.startB;
    }
  }

  const results: LateralMeasurement[] = [];

  const processWall = (
    wall: 'north' | 'south' | 'east' | 'west',
    wallId: string,
    blockParallelMin: number,
    blockParallelMax: number,
    perpCoord: number,
  ) => {
    const openingRanges: Array<{ posStart: number; posEnd: number }> = [];

    for (const o of room.openings) {
      if (o.wallId === wallId) {
        openingRanges.push({ posStart: o.position, posEnd: o.position + o.width });
      }
    }

    const localStart = wallIdToLocalStart[wallId];
    if (floorPlan && localStart !== undefined) {
      for (const so of floorPlan.sharedOpenings) {
        if (so.anchorWallId === wallId || so.partnerWallId === wallId) {
          const posStart = localStart + so.position;
          openingRanges.push({ posStart, posEnd: posStart + so.width });
        }
      }
    }

    for (const { posStart, posEnd } of openingRanges) {
      if (posStart >= blockParallelMax) {
        const gap = posStart - blockParallelMax;
        if (gap > 0) {
          results.push({ wall, gapMm: gap, parallelStart: blockParallelMax, parallelEnd: posStart, perpCoord });
        }
      } else if (posEnd <= blockParallelMin) {
        const gap = blockParallelMin - posEnd;
        if (gap > 0) {
          results.push({ wall, gapMm: gap, parallelStart: blockParallelMin, parallelEnd: posEnd, perpCoord });
        }
      }
    }
  };

  processWall('north', room.walls.find((w) => w.side === 'north')?.id ?? '', aabb.minX, aabb.maxX, aabb.minY);
  processWall('south', room.walls.find((w) => w.side === 'south')?.id ?? '', aabb.minX, aabb.maxX, aabb.maxY);
  processWall('east',  room.walls.find((w) => w.side === 'east')?.id  ?? '', aabb.minY, aabb.maxY, aabb.maxX);
  processWall('west',  room.walls.find((w) => w.side === 'west')?.id  ?? '', aabb.minY, aabb.maxY, aabb.minX);

  return results;
}
