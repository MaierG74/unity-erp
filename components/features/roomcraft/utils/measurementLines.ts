import type { Room, RoomItem } from '../types/room';
import type { Layer } from '../types/floorPlan';
import { footprintAABB } from './blocks';

export interface MeasurementLine {
  side: 'north' | 'south' | 'east' | 'west';
  gapMm: number;
  targetType: 'wall' | 'opening' | 'block';
}

export function computeMeasurementLines(
  block: RoomItem,
  room: Room,
  layers: Layer[],
): MeasurementLine[] {
  const aabb = footprintAABB(block);
  const { length: roomLength, width: roomWidth } = room.dimensions;
  const visibleLayerIds = new Set(layers.filter((layer) => layer.visible).map((layer) => layer.id));
  const otherAABBs = room.items
    .filter((item) => item.id !== block.id && visibleLayerIds.has(item.layerId))
    .map((item) => footprintAABB(item));

  const lines: MeasurementLine[] = [];

  const openingOverlaps = (wallId: string, spanMin: number, spanMax: number): boolean => {
    if (!room.walls.some((wall) => wall.id === wallId)) return false;
    return room.openings.some(
      (opening) =>
        opening.wallId === wallId &&
        opening.position < spanMax &&
        opening.position + opening.width > spanMin,
    );
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
      const targetType = openingOverlaps(northWallId, parallelMin, parallelMax) ? 'opening' : 'wall';
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
      const targetType = openingOverlaps(southWallId, parallelMin, parallelMax) ? 'opening' : 'wall';
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
      const targetType = openingOverlaps(westWallId, parallelMin, parallelMax) ? 'opening' : 'wall';
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
      const targetType = openingOverlaps(eastWallId, parallelMin, parallelMax) ? 'opening' : 'wall';
      lines.push({ side: 'east', gapMm: wallGap, targetType });
    }
  }

  return lines;
}
