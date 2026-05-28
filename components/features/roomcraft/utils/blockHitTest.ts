import type { FloorPlan } from '../types/floorPlan';
import type { RoomItem } from '../types/room';
import { footprintAABB } from './blocks';

export interface BlockHit {
  roomId: string;
  block: RoomItem;
  layerZ: number;
  id: string;
}

/** Returns blocks at the given room-frame point, sorted topmost first (highest z). */
export function hitTestBlocks(roomFrameX: number, roomFrameY: number, fp: FloorPlan): BlockHit[] {
  const hits: BlockHit[] = [];
  for (const placed of fp.rooms) {
    const localX = roomFrameX - placed.position.x;
    const localY = roomFrameY - placed.position.y;
    for (const item of placed.room.items) {
      const layer = fp.layers.find((l) => l.id === item.layerId);
      if (!layer || !layer.visible) continue;
      const aabb = footprintAABB(item);
      if (localX < aabb.minX || localX > aabb.maxX) continue;
      if (localY < aabb.minY || localY > aabb.maxY) continue;
      hits.push({ roomId: placed.room.id, block: item, layerZ: layer.z, id: item.id });
    }
  }
  return hits.sort((a, b) => b.layerZ - a.layerZ);
}
