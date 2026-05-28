import type { Room, WallSide } from './room';

export interface PlacedRoom {
  room: Room;
  position: { x: number; y: number }; // mm, from floor plan origin
  locked: boolean;
}

export type SharedOpeningType = 'door' | 'double-door' | 'window' | 'archway';

export interface SharedOpening {
  id: string;
  type: SharedOpeningType;
  anchorRoomId: string;
  anchorWallId: string;
  partnerRoomId: string;
  partnerWallId: string;
  position: number;            // mm, from overlap-zone start (anchor side)
  width: number;               // mm
  height: number;              // mm
  distanceFromFloor: number;   // mm
  hingeSide?: 'left' | 'right';          // anchor-room interior view
  swingIntoRoomId?: string;              // anchorRoomId | partnerRoomId
}

export interface Layer {
  id: string;
  name: string;
  z: number;       // mm — bottom face of any block on this layer
  visible: boolean;
}

export interface FloorPlan {
  id: string;
  rooms: PlacedRoom[];
  sharedOpenings: SharedOpening[];
  layers: Layer[];
}

export type AnchorEdge = WallSide;
