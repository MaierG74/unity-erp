import { createContext, useContext, useEffect, useReducer, type ReactNode } from 'react';
import type { Room, RoomDimensions, Opening, DisplayUnit, BlockAnchor, WallSide } from '../types/room';
import type { FloorPlan, AnchorEdge, PlacedRoom, SharedOpening } from '../types/floorPlan';
import { createRoom, createWalls } from '../utils/room';
import { createFloorPlan, addRoomToFloorPlan, previewRoomAddition, isRoomLocked, shareSharedOpeningWithLocked } from '../utils/floorPlan';
import { OPPOSITE, findOverlapForShared } from '../utils/adjacency';
import { previewRoomShift, type ShiftAxis } from '../utils/shiftRoom';
import { addLayer, updateLayer, removeLayer, reorderLayers, getLayer } from '../utils/layers';
import { createBlock } from '../utils/blocks';
import { touchMetadata } from './reducerHelpers';
import { blockReducer } from './blockReducer';

export interface RoomState {
  floorPlan: FloorPlan | null;
  activeRoomId: string | null;
  activeLayerId: string | null;
  selectedOpeningId: string | null;
  selectedSharedOpeningId: string | null;
  selectedBlockId: string | null;
  displayUnit: DisplayUnit;
  showHeatmap: boolean;
  showIsometric: boolean;
  showMeasurements: boolean;
  visible3DWalls: Record<WallSide, boolean>;
}

export type RoomAction =
  | { type: 'CREATE_ROOM'; payload: { name: string; dimensions: RoomDimensions } }
  | {
      type: 'ADD_ROOM_TO_FLOOR_PLAN';
      payload: {
        name: string;
        dimensions: RoomDimensions;
        anchorRoomId: string;
        edge: AnchorEdge;
      };
    }
  | { type: 'SET_ACTIVE_ROOM'; payload: { id: string } }
  | { type: 'REMOVE_ROOM_FROM_FLOOR_PLAN'; payload: { id: string } }
  | { type: 'UPDATE_ROOM_NAME'; payload: { name: string } }
  | { type: 'SET_DIMENSIONS'; payload: { dimensions: RoomDimensions } }
  | { type: 'RESET_FLOOR_PLAN' }
  | { type: 'ADD_OPENING'; payload: { opening: Opening } }
  | { type: 'UPDATE_OPENING'; payload: { id: string; changes: Partial<Opening> } }
  | { type: 'REMOVE_OPENING'; payload: { id: string } }
  | { type: 'SELECT_OPENING'; payload: { id: string } }
  | { type: 'SELECT_SHARED_OPENING'; payload: { id: string } }
  | { type: 'DESELECT_OPENING' }
  | { type: 'ADD_SHARED_OPENING'; payload: { opening: SharedOpening } }
  | { type: 'UPDATE_SHARED_OPENING'; payload: { id: string; changes: Partial<SharedOpening> } }
  | { type: 'REMOVE_SHARED_OPENING'; payload: { id: string } }
  | { type: 'SET_DISPLAY_UNIT'; payload: { unit: DisplayUnit } }
  | { type: 'SHIFT_ROOM'; payload: { roomId: string; axis: ShiftAxis; deltaMm: number } }
  | { type: 'TOGGLE_ROOM_LOCK'; payload: { id: string } }
  | { type: 'ADD_LAYER'; payload: { name: string; z: number } }
  | { type: 'UPDATE_LAYER'; payload: { id: string; changes: Partial<{ name: string; z: number; visible: boolean }> } }
  | { type: 'REMOVE_LAYER'; payload: { id: string } }
  | { type: 'REORDER_LAYERS'; payload: { id: string; index: number } }
  | { type: 'TOGGLE_LAYER_VISIBLE'; payload: { id: string } }
  | { type: 'SET_ACTIVE_LAYER'; payload: { id: string } }
  | { type: 'ADD_BLOCK'; payload: { roomId: string; init: Omit<Parameters<typeof createBlock>[0], never> } }
  | { type: 'REMOVE_BLOCK'; payload: { roomId: string; id: string } }
  | { type: 'UPDATE_BLOCK_POSITION'; payload: { roomId: string; id: string; x: number; y: number } }
  | { type: 'ROTATE_BLOCK'; payload: { roomId: string; id: string; direction: 'cw' | 'ccw' } }
  | { type: 'SET_BLOCK_ANCHOR'; payload: { roomId: string; id: string; anchor: BlockAnchor } }
  | { type: 'SET_BLOCK_COLOR'; payload: { roomId: string; id: string; color: string } }
  | { type: 'SET_GROUP_COLOR'; payload: { roomId: string; groupId: string; color: string } }
  | { type: 'GROUP_BLOCKS'; payload: { roomId: string; sourceId: string; targetId: string } }
  | { type: 'MOVE_BLOCK_TO_LAYER'; payload: { roomId: string; id: string; layerId: string } }
  | { type: 'DUPLICATE_BLOCK'; payload: { roomId: string; id: string } }
  | { type: 'UNGROUP_BLOCK'; payload: { roomId: string; id: string } }
  | { type: 'RESIZE_BLOCK_GROUP'; payload: { roomId: string; groupId: string; length: number; depth: number; height: number } }
  | { type: 'RESIZE_BLOCK'; payload: { roomId: string; id: string; length: number; depth: number; height: number } }
  | { type: 'RENAME_BLOCK'; payload: { roomId: string; id: string; label: string } }
  | { type: 'CENTER_BLOCK_ON_WALL'; payload: { roomId: string; id: string; side: WallSide } }
  | { type: 'SELECT_BLOCK'; payload: { id: string } }
  | { type: 'DESELECT_BLOCK' }
  | { type: 'TOGGLE_HEATMAP' }
  | { type: 'TOGGLE_ISOMETRIC' }
  | { type: 'TOGGLE_MEASUREMENTS' }
  | { type: 'TOGGLE_3D_WALL'; payload: { side: WallSide } }
  | { type: 'SET_BLOCK_FURNITURE_TYPE'; payload: { roomId: string; id: string; furnitureType: import('@/lib/roomcraft/types').FurnitureType } }
  | { type: 'SET_BLOCK_CONFIGURED_PIECE'; payload: { roomId: string; id: string; configuredPieceId: string } };

export const initialState: RoomState = {
  floorPlan: null,
  activeRoomId: null,
  activeLayerId: null,
  selectedOpeningId: null,
  selectedSharedOpeningId: null,
  selectedBlockId: null,
  displayUnit: 'mm',
  showHeatmap: false,
  showIsometric: false,
  showMeasurements: false,
  visible3DWalls: {
    north: true,
    south: false,
    east: true,
    west: true,
  },
};

function updateActiveRoom(
  state: RoomState,
  updater: (room: Room) => Room,
): RoomState {
  if (!state.floorPlan || !state.activeRoomId) return state;
  const rooms = state.floorPlan.rooms.map((placed) =>
    placed.room.id === state.activeRoomId
      ? { ...placed, room: updater(placed.room) }
      : placed,
  );
  return { ...state, floorPlan: { ...state.floorPlan, rooms } };
}

function refreshSharedOpeningWalls(
  floorPlan: FloorPlan,
  shared: SharedOpening,
): SharedOpening | null {
  const anchorRoom = floorPlan.rooms.find((p) => p.room.id === shared.anchorRoomId);
  const partnerRoom = floorPlan.rooms.find((p) => p.room.id === shared.partnerRoomId);
  if (!anchorRoom || !partnerRoom) return null;
  const a = anchorRoom.position;
  const b = partnerRoom.position;
  let anchorSide: 'north' | 'south' | 'east' | 'west' | null = null;
  if (a.x + anchorRoom.room.dimensions.length === b.x) anchorSide = 'east';
  else if (b.x + partnerRoom.room.dimensions.length === a.x) anchorSide = 'west';
  else if (a.y + anchorRoom.room.dimensions.width === b.y) anchorSide = 'south';
  else if (b.y + partnerRoom.room.dimensions.width === a.y) anchorSide = 'north';
  if (!anchorSide) return null;
  const anchorWall = anchorRoom.room.walls.find((w) => w.side === anchorSide);
  const partnerWall = partnerRoom.room.walls.find((w) => w.side === OPPOSITE[anchorSide]);
  if (!anchorWall || !partnerWall) return null;
  return { ...shared, anchorWallId: anchorWall.id, partnerWallId: partnerWall.id };
}

export function roomReducer(state: RoomState, action: RoomAction): RoomState {
  const blockResult = blockReducer(state, action);
  if (blockResult !== state) return blockResult;
  switch (action.type) {
    case 'CREATE_ROOM': {
      const room = createRoom(action.payload.name, action.payload.dimensions);
      const floorPlan = createFloorPlan(room);
      return {
        ...state,
        floorPlan,
        activeRoomId: room.id,
        activeLayerId: floorPlan.layers[0].id,
        selectedOpeningId: null,
        selectedSharedOpeningId: null,
        selectedBlockId: null,
      };
    }
    case 'ADD_ROOM_TO_FLOOR_PLAN': {
      if (!state.floorPlan) return state;
      const preview = previewRoomAddition(
        state.floorPlan,
        action.payload.anchorRoomId,
        action.payload.edge,
        action.payload.dimensions,
      );
      if (!preview.ok) return state;

      const newRoom = createRoom(action.payload.name, action.payload.dimensions);
      const nextFloorPlan = addRoomToFloorPlan(
        state.floorPlan,
        newRoom,
        action.payload.anchorRoomId,
        action.payload.edge,
      );
      if (nextFloorPlan === state.floorPlan) return state;

      const partnerWall = newRoom.walls.find(
        (w) => w.side === OPPOSITE[action.payload.edge],
      );
      const resolvedPromotions = preview.promotions.map((p) => ({
        ...p,
        partnerRoomId: newRoom.id,
        partnerWallId: partnerWall?.id ?? p.partnerWallId,
        swingIntoRoomId:
          p.swingIntoRoomId === '__PLACEHOLDER_NEW_ROOM__' ? newRoom.id : p.swingIntoRoomId,
      }));

      const rooms = nextFloorPlan.rooms.map((placed) =>
        placed.room.id === action.payload.anchorRoomId
          ? {
              ...placed,
              room: { ...placed.room, openings: preview.remainingAnchorOpenings },
            }
          : placed,
      );

      return {
        ...state,
        floorPlan: {
          ...nextFloorPlan,
          rooms,
          sharedOpenings: [...nextFloorPlan.sharedOpenings, ...resolvedPromotions],
        },
        activeRoomId: newRoom.id,
        activeLayerId: state.activeLayerId,
        selectedOpeningId: null,
        selectedSharedOpeningId: null,
        selectedBlockId: null,
      };
    }
    case 'SET_ACTIVE_ROOM': {
      if (!state.floorPlan) return state;
      const exists = state.floorPlan.rooms.some((p) => p.room.id === action.payload.id);
      if (!exists) return state;
      return { ...state, activeRoomId: action.payload.id, selectedOpeningId: null, selectedSharedOpeningId: null, selectedBlockId: null };
    }
    case 'TOGGLE_ROOM_LOCK': {
      if (!state.floorPlan) return state;
      const exists = state.floorPlan.rooms.some((p) => p.room.id === action.payload.id);
      if (!exists) return state;
      return {
        ...state,
        floorPlan: {
          ...state.floorPlan,
          rooms: state.floorPlan.rooms.map((p) =>
            p.room.id === action.payload.id ? { ...p, locked: !p.locked } : p,
          ),
        },
      };
    }
    case 'REMOVE_ROOM_FROM_FLOOR_PLAN': {
      if (!state.floorPlan) return state;
      if (isRoomLocked(state.floorPlan, action.payload.id)) return state;
      if (shareSharedOpeningWithLocked(state.floorPlan, action.payload.id)) return state;
      const remaining = state.floorPlan.rooms.filter((p) => p.room.id !== action.payload.id);
      if (remaining.length === state.floorPlan.rooms.length) return state;
      const nextActiveId =
        state.activeRoomId === action.payload.id
          ? (remaining[0]?.room.id ?? null)
          : state.activeRoomId;
      const nextSharedOpenings = state.floorPlan.sharedOpenings.filter(
        (s) => s.anchorRoomId !== action.payload.id && s.partnerRoomId !== action.payload.id,
      );
      return {
        ...state,
        floorPlan:
          remaining.length > 0
            ? { ...state.floorPlan, rooms: remaining, sharedOpenings: nextSharedOpenings }
            : null,
        activeRoomId: nextActiveId,
        activeLayerId: state.activeLayerId,
        selectedOpeningId: null,
        selectedSharedOpeningId: null,
        selectedBlockId: null,
      };
    }
    case 'UPDATE_ROOM_NAME':
      if (state.floorPlan && state.activeRoomId && isRoomLocked(state.floorPlan, state.activeRoomId)) return state;
      return updateActiveRoom(state, (room) =>
        touchMetadata({ ...room, name: action.payload.name }),
      );
    case 'SET_DIMENSIONS': {
      if (state.floorPlan && state.activeRoomId && isRoomLocked(state.floorPlan, state.activeRoomId)) return state;
      if (state.floorPlan && state.activeRoomId && shareSharedOpeningWithLocked(state.floorPlan, state.activeRoomId)) return state;
      const resized = updateActiveRoom(state, (room) =>
        touchMetadata({
          ...room,
          dimensions: action.payload.dimensions,
          walls: createWalls(action.payload.dimensions),
        }),
      );
      if (!resized.floorPlan) return { ...resized, selectedOpeningId: null, selectedSharedOpeningId: null, selectedBlockId: null };
      const refreshed = resized.floorPlan.sharedOpenings
        .map((s) => refreshSharedOpeningWalls(resized.floorPlan!, s))
        .filter((s): s is SharedOpening => s !== null);
      const nextShared = refreshed.flatMap((s) => {
        const match = findOverlapForShared(resized.floorPlan!, s);
        if (!match) return [];
        if (match.length < s.width) return [];
        const maxPos = match.length - s.width;
        const clamped = Math.max(0, Math.min(maxPos, s.position));
        return [{ ...s, position: clamped }];
      });
      return {
        ...resized,
        floorPlan: { ...resized.floorPlan, sharedOpenings: nextShared },
        selectedOpeningId: null,
        selectedSharedOpeningId: null,
        selectedBlockId: null,
      };
    }
    case 'RESET_FLOOR_PLAN':
      return { ...state, floorPlan: null, activeRoomId: null, activeLayerId: null, selectedOpeningId: null, selectedSharedOpeningId: null, selectedBlockId: null };
    case 'ADD_OPENING':
      if (state.floorPlan && state.activeRoomId && isRoomLocked(state.floorPlan, state.activeRoomId)) return state;
      return updateActiveRoom(state, (room) =>
        touchMetadata({ ...room, openings: [...room.openings, action.payload.opening] }),
      );
    case 'UPDATE_OPENING':
      if (state.floorPlan && state.activeRoomId && isRoomLocked(state.floorPlan, state.activeRoomId)) return state;
      return updateActiveRoom(state, (room) =>
        touchMetadata({
          ...room,
          openings: room.openings.map((o) =>
            o.id === action.payload.id ? { ...o, ...action.payload.changes } : o,
          ),
        }),
      );
    case 'REMOVE_OPENING': {
      if (state.floorPlan && state.activeRoomId && isRoomLocked(state.floorPlan, state.activeRoomId)) return state;
      const next = updateActiveRoom(state, (room) =>
        touchMetadata({
          ...room,
          openings: room.openings.filter((o) => o.id !== action.payload.id),
        }),
      );
      return {
        ...next,
        selectedOpeningId:
          state.selectedOpeningId === action.payload.id ? null : state.selectedOpeningId,
        selectedSharedOpeningId: state.selectedSharedOpeningId,
        selectedBlockId: null,
      };
    }
    case 'SELECT_OPENING':
      return { ...state, selectedOpeningId: action.payload.id, selectedSharedOpeningId: null, selectedBlockId: null };
    case 'SELECT_SHARED_OPENING':
      return { ...state, selectedSharedOpeningId: action.payload.id, selectedOpeningId: null, selectedBlockId: null };
    case 'DESELECT_OPENING':
      return { ...state, selectedOpeningId: null, selectedSharedOpeningId: null, selectedBlockId: null };
    case 'ADD_SHARED_OPENING': {
      if (!state.floorPlan) return state;
      const s = action.payload.opening;
      if (isRoomLocked(state.floorPlan, s.anchorRoomId) || isRoomLocked(state.floorPlan, s.partnerRoomId)) return state;
      return {
        ...state,
        floorPlan: {
          ...state.floorPlan,
          sharedOpenings: [...state.floorPlan.sharedOpenings, s],
        },
      };
    }
    case 'UPDATE_SHARED_OPENING': {
      if (!state.floorPlan) return state;
      const existing = state.floorPlan.sharedOpenings.find((s) => s.id === action.payload.id);
      if (existing && (isRoomLocked(state.floorPlan, existing.anchorRoomId) || isRoomLocked(state.floorPlan, existing.partnerRoomId))) return state;
      return {
        ...state,
        floorPlan: {
          ...state.floorPlan,
          sharedOpenings: state.floorPlan.sharedOpenings.map((o) =>
            o.id === action.payload.id ? { ...o, ...action.payload.changes } : o,
          ),
        },
      };
    }
    case 'REMOVE_SHARED_OPENING': {
      if (!state.floorPlan) return state;
      const toRemove = state.floorPlan.sharedOpenings.find((s) => s.id === action.payload.id);
      if (toRemove && (isRoomLocked(state.floorPlan, toRemove.anchorRoomId) || isRoomLocked(state.floorPlan, toRemove.partnerRoomId))) return state;
      return {
        ...state,
        floorPlan: {
          ...state.floorPlan,
          sharedOpenings: state.floorPlan.sharedOpenings.filter((o) => o.id !== action.payload.id),
        },
        selectedSharedOpeningId:
          state.selectedSharedOpeningId === action.payload.id ? null : state.selectedSharedOpeningId,
        selectedBlockId: null,
      };
    }
    case 'SET_DISPLAY_UNIT':
      return { ...state, displayUnit: action.payload.unit };
    case 'SHIFT_ROOM': {
      if (!state.floorPlan) return state;
      if (isRoomLocked(state.floorPlan, action.payload.roomId)) return state;
      const preview = previewRoomShift(
        state.floorPlan,
        action.payload.roomId,
        action.payload.axis,
        action.payload.deltaMm,
      );
      if (preview.blockingOpenings.length > 0 || preview.blockingLockedRoomIds.length > 0) return state;
      if (preview.clampedDelta === 0) return state;
      const rooms = state.floorPlan.rooms.map((pr) => {
        const newPos = preview.positions[pr.room.id];
        return newPos ? { ...pr, position: newPos } : pr;
      });
      const updatedPlan = { ...state.floorPlan, rooms };
      const refreshedOpenings = updatedPlan.sharedOpenings
        .map((s) => refreshSharedOpeningWalls(updatedPlan, s))
        .filter((s): s is SharedOpening => s !== null);
      return {
        ...state,
        floorPlan: { ...updatedPlan, sharedOpenings: refreshedOpenings },
      };
    }
    case 'ADD_LAYER': {
      if (!state.floorPlan) return state;
      return { ...state, floorPlan: addLayer(state.floorPlan, action.payload) };
    }
    case 'UPDATE_LAYER': {
      if (!state.floorPlan) return state;
      return { ...state, floorPlan: updateLayer(state.floorPlan, action.payload.id, action.payload.changes) };
    }
    case 'REMOVE_LAYER': {
      if (!state.floorPlan) return state;
      return { ...state, floorPlan: removeLayer(state.floorPlan, action.payload.id) };
    }
    case 'REORDER_LAYERS': {
      if (!state.floorPlan) return state;
      return { ...state, floorPlan: reorderLayers(state.floorPlan, action.payload.id, action.payload.index) };
    }
    case 'TOGGLE_LAYER_VISIBLE': {
      if (!state.floorPlan) return state;
      const layer = getLayer(state.floorPlan, action.payload.id);
      if (!layer) return state;
      return { ...state, floorPlan: updateLayer(state.floorPlan, action.payload.id, { visible: !layer.visible }) };
    }
    case 'SET_ACTIVE_LAYER':
      return { ...state, activeLayerId: action.payload.id };
    case 'SELECT_BLOCK':
      return { ...state, selectedBlockId: action.payload.id, selectedOpeningId: null, selectedSharedOpeningId: null };
    case 'DESELECT_BLOCK':
      return { ...state, selectedBlockId: null };
    case 'TOGGLE_HEATMAP':
      return {
        ...state,
        showHeatmap: !state.showHeatmap,
        showIsometric: !state.showHeatmap ? false : state.showIsometric,
      };
    case 'TOGGLE_ISOMETRIC':
      return {
        ...state,
        showIsometric: !state.showIsometric,
        showHeatmap: !state.showIsometric ? false : state.showHeatmap,
      };
    case 'TOGGLE_MEASUREMENTS':
      return { ...state, showMeasurements: !state.showMeasurements };
    case 'TOGGLE_3D_WALL':
      return {
        ...state,
        visible3DWalls: {
          ...initialState.visible3DWalls,
          ...state.visible3DWalls,
          [action.payload.side]: !(state.visible3DWalls ?? initialState.visible3DWalls)[action.payload.side],
        },
      };
    default:
      return state;
  }
}

export function getActiveRoom(state: RoomState): Room | undefined {
  if (!state.floorPlan || !state.activeRoomId) return undefined;
  const placed = state.floorPlan.rooms.find((p) => p.room.id === state.activeRoomId);
  return placed?.room;
}

export function getActivePlacedRoom(state: RoomState): PlacedRoom | undefined {
  if (!state.floorPlan || !state.activeRoomId) return undefined;
  return state.floorPlan.rooms.find((p) => p.room.id === state.activeRoomId);
}

export const RoomContext = createContext<{
  state: RoomState;
  dispatch: React.Dispatch<RoomAction>;
}>({ state: initialState, dispatch: () => {} });

function loadInitialState(storageKey?: string): RoomState {
  if (!storageKey || typeof window === 'undefined') return initialState;

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return initialState;
    const parsed = JSON.parse(raw) as Partial<RoomState>;
    return {
      ...initialState,
      ...parsed,
      visible3DWalls: {
        ...initialState.visible3DWalls,
        ...parsed.visible3DWalls,
      },
    } as RoomState;
  } catch {
    return initialState;
  }
}

export function RoomProvider({ children, storageKey }: { children: ReactNode; storageKey?: string }) {
  const [state, dispatch] = useReducer(
    roomReducer,
    storageKey,
    (key) => loadInitialState(key),
  );

  useEffect(() => {
    if (!storageKey) return;
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  }, [state, storageKey]);

  return (
    <RoomContext.Provider value={{ state, dispatch }}>
      {children}
    </RoomContext.Provider>
  );
}

export function useRoomContext() {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error('useRoomContext must be used inside RoomProvider');
  return ctx;
}

