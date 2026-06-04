export interface Group {
  id: string;
  layerId: string;
  color: string;   // hex, e.g. '#bcd9c3'
}

export interface Room {
  id: string;
  name: string;
  dimensions: RoomDimensions;
  walls: Wall[];
  openings: Opening[];
  items: RoomItem[];
  groups: Group[];
  metadata: RoomMetadata;
}

export interface RoomDimensions {
  length: number; // mm
  width: number;  // mm
  height: number; // mm
}

export interface Wall {
  id: string;
  side: WallSide;
  length: number; // mm
  height: number; // mm
}

export type WallSide = 'north' | 'south' | 'east' | 'west';

export interface Opening {
  id: string;
  wallId: string;
  type: OpeningType;
  position: number;              // mm from left edge of wall
  width: number;                 // mm
  height: number;                // mm
  distanceFromFloor: number;     // mm — 0 for doors/archways, ~900 for windows
  hingeSide?: 'left' | 'right';         // doors only
  swingDirection?: 'inward' | 'outward'; // doors only
}

export type OpeningType = 'door' | 'double-door' | 'window' | 'archway';

export type AnchorAxisValue = 'min' | 'center' | 'max';

export interface BlockAnchor {
  x: AnchorAxisValue;
  y: AnchorAxisValue;
  z: AnchorAxisValue;
}

export interface RoomItem {
  id: string;
  label: string;
  layerId: string;
  groupId?: string;
  x: number;          // mm from room origin
  y: number;          // mm from room origin
  length: number;     // mm (X-axis extent) — RENAMED from width
  depth: number;      // mm (Y-axis extent)
  height: number;     // mm (Z-axis extent)
  rotation: 0 | 90 | 180 | 270;
  anchor: BlockAnchor;
  color?: string;     // only used when groupId is undefined
  furnitureType?: import('@/lib/roomcraft/types').FurnitureType;
  configuredPieceId?: string;
}

export interface RoomMetadata {
  createdAt: string; // ISO 8601
  updatedAt: string;
  version: number;
}

export type DisplayUnit = 'mm' | 'cm' | 'm';
