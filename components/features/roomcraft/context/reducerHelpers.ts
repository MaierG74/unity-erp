import type { RoomState } from './RoomContext';
import type { Room } from '../types/room';

export function updateRoom(
  state: RoomState,
  roomId: string,
  updater: (room: Room) => Room,
): RoomState {
  if (!state.floorPlan) return state;
  const rooms = state.floorPlan.rooms.map((p) =>
    p.room.id === roomId ? { ...p, room: updater(p.room) } : p,
  );
  return { ...state, floorPlan: { ...state.floorPlan, rooms } };
}

export function touchMetadata(room: Room): Room {
  return { ...room, metadata: { ...room.metadata, updatedAt: new Date().toISOString() } };
}
