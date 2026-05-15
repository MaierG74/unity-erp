import type { Room, RoomItem, WallSide } from '../types/room';
import { rotatedFootprint } from './blocks';

export function centerOnWall(b: RoomItem, side: WallSide, room: Room): RoomItem {
  const { length, depth } = rotatedFootprint(b);
  switch (side) {
    case 'north':
      return { ...b, x: (room.dimensions.length - length) / 2, y: 0 };
    case 'south':
      return { ...b, x: (room.dimensions.length - length) / 2, y: room.dimensions.width - depth };
    case 'west':
      return { ...b, x: 0, y: (room.dimensions.width - depth) / 2 };
    case 'east':
      return { ...b, x: room.dimensions.length - length, y: (room.dimensions.width - depth) / 2 };
  }
}
