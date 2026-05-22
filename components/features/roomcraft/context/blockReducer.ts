import type { RoomState, RoomAction } from './RoomContext';
import type { RoomItem } from '../types/room';
import { updateRoom, touchMetadata } from './reducerHelpers';
import { createBlock, rotateAroundAnchor, resizeAroundAnchor } from '../utils/blocks';
import { hasSameLayerOverlap, isInsideRoom } from '../utils/blockValidation';
import { createGroup, nextGroupColor, findDuplicateOffset } from '../utils/blockGroup';
import { computeCascadeResize } from '../utils/blockResize';
import { canPlaceGroupItems, centerGroupOnWall, centerOnWall } from '../utils/blockCenterOnWall';

export function blockReducer(state: RoomState, action: RoomAction): RoomState {
  switch (action.type) {
    case 'ADD_BLOCK': {
      if (!state.floorPlan) return state;
      const placed = state.floorPlan.rooms.find((p) => p.room.id === action.payload.roomId);
      if (!placed || placed.locked) return state;
      const candidate = createBlock(action.payload.init);
      if (!isInsideRoom(candidate, placed.room)) return state;
      if (hasSameLayerOverlap(candidate, placed.room)) return state;
      const next = updateRoom(state, action.payload.roomId, (room) =>
        touchMetadata({ ...room, items: [...room.items, candidate] }),
      );
      return { ...next, selectedBlockId: candidate.id };
    }
    case 'REMOVE_BLOCK': {
      if (!state.floorPlan) return state;
      const placed = state.floorPlan.rooms.find((p) => p.room.id === action.payload.roomId);
      if (!placed || placed.locked) return state;
      const next = updateRoom(state, action.payload.roomId, (room) =>
        touchMetadata({
          ...room,
          items: room.items.filter((i) => i.id !== action.payload.id),
        }),
      );
      return {
        ...next,
        selectedBlockId: state.selectedBlockId === action.payload.id ? null : state.selectedBlockId,
      };
    }
    case 'UPDATE_BLOCK_POSITION': {
      if (!state.floorPlan) return state;
      const placed = state.floorPlan.rooms.find((p) => p.room.id === action.payload.roomId);
      if (!placed || placed.locked) return state;
      const target = placed.room.items.find((i) => i.id === action.payload.id);
      if (!target) return state;
      const moved: RoomItem = { ...target, x: action.payload.x, y: action.payload.y };
      if (!isInsideRoom(moved, placed.room)) return state;
      if (hasSameLayerOverlap(moved, placed.room)) return state;
      return updateRoom(state, action.payload.roomId, (room) =>
        touchMetadata({ ...room, items: room.items.map((i) => (i.id === action.payload.id ? moved : i)) }),
      );
    }
    case 'ROTATE_BLOCK': {
      if (!state.floorPlan) return state;
      const placed = state.floorPlan.rooms.find((p) => p.room.id === action.payload.roomId);
      if (!placed || placed.locked) return state;
      const target = placed.room.items.find((i) => i.id === action.payload.id);
      if (!target) return state;
      const rotated = rotateAroundAnchor(target, action.payload.direction);
      if (!isInsideRoom(rotated, placed.room)) return state;
      if (hasSameLayerOverlap(rotated, placed.room)) return state;
      return updateRoom(state, action.payload.roomId, (room) =>
        touchMetadata({ ...room, items: room.items.map((i) => (i.id === action.payload.id ? rotated : i)) }),
      );
    }
    case 'SET_BLOCK_ANCHOR': {
      if (!state.floorPlan) return state;
      const placed = state.floorPlan.rooms.find((p) => p.room.id === action.payload.roomId);
      if (!placed || placed.locked) return state;
      return updateRoom(state, action.payload.roomId, (room) =>
        touchMetadata({
          ...room,
          items: room.items.map((i) => (i.id === action.payload.id ? { ...i, anchor: action.payload.anchor } : i)),
        }),
      );
    }
    case 'SET_BLOCK_COLOR': {
      if (!state.floorPlan) return state;
      const placed = state.floorPlan.rooms.find((p) => p.room.id === action.payload.roomId);
      if (!placed || placed.locked) return state;
      return updateRoom(state, action.payload.roomId, (room) =>
        touchMetadata({
          ...room,
          items: room.items.map((i) => {
            if (i.id !== action.payload.id) return i;
            // If grouped, color updates the group instead — handled in SET_GROUP_COLOR.
            return { ...i, color: action.payload.color };
          }),
        }),
      );
    }
    case 'SET_GROUP_COLOR': {
      if (!state.floorPlan) return state;
      const placed = state.floorPlan.rooms.find((p) => p.room.id === action.payload.roomId);
      if (!placed || placed.locked) return state;
      return updateRoom(state, action.payload.roomId, (room) =>
        touchMetadata({
          ...room,
          groups: room.groups.map((g) => (g.id === action.payload.groupId ? { ...g, color: action.payload.color } : g)),
        }),
      );
    }
    case 'GROUP_BLOCKS': {
      if (!state.floorPlan) return state;
      const placed = state.floorPlan.rooms.find((p) => p.room.id === action.payload.roomId);
      if (!placed || placed.locked) return state;
      const source = placed.room.items.find((i) => i.id === action.payload.sourceId);
      const target = placed.room.items.find((i) => i.id === action.payload.targetId);
      if (!source || !target || source.id === target.id) return state;
      if (source.layerId !== target.layerId) return state;

      return updateRoom(state, action.payload.roomId, (room) => {
        const sourceGroup = source.groupId ? room.groups.find((group) => group.id === source.groupId) : undefined;
        const targetGroup = target.groupId ? room.groups.find((group) => group.id === target.groupId) : undefined;
        const primaryGroup =
          sourceGroup ??
          targetGroup ??
          createGroup({
            layerId: source.layerId,
            color: source.color ?? target.color ?? nextGroupColor(room.groups.length),
          });
        const mergedGroupIds = new Set(
          [source.groupId, target.groupId].filter((id): id is string => Boolean(id)),
        );
        const hasPrimary = room.groups.some((group) => group.id === primaryGroup.id);
        const groups = [
          ...(hasPrimary ? room.groups : [...room.groups, primaryGroup]),
        ].filter((group) => group.id === primaryGroup.id || !mergedGroupIds.has(group.id));
        const items = room.items.map((item) => {
          if (item.id === source.id || item.id === target.id || (item.groupId && mergedGroupIds.has(item.groupId))) {
            return { ...item, groupId: primaryGroup.id, color: undefined };
          }
          return item;
        });
        return touchMetadata({ ...room, items, groups });
      });
    }
    case 'MOVE_BLOCK_TO_LAYER': {
      if (!state.floorPlan) return state;
      const placed = state.floorPlan.rooms.find((p) => p.room.id === action.payload.roomId);
      if (!placed || placed.locked) return state;
      const target = placed.room.items.find((i) => i.id === action.payload.id);
      if (!target) return state;
      if (!state.floorPlan.layers.some((l) => l.id === action.payload.layerId)) return state;
      // Build a candidate at the new layer (and ungrouped — group is layer-bound)
      const candidate: RoomItem = { ...target, layerId: action.payload.layerId, groupId: undefined };
      if (!isInsideRoom(candidate, placed.room)) return state;
      if (hasSameLayerOverlap(candidate, placed.room)) return state;
      // If the source was grouped, prune the group if it goes empty
      const wasGroupId = target.groupId;
      return updateRoom(state, action.payload.roomId, (room) => {
        const items = room.items.map((i) => (i.id === target.id ? candidate : i));
        const groups = wasGroupId
          ? items.some((i) => i.groupId === wasGroupId)
            ? room.groups
            : room.groups.filter((g) => g.id !== wasGroupId)
          : room.groups;
        return touchMetadata({ ...room, items, groups });
      });
    }
    case 'DUPLICATE_BLOCK': {
      if (!state.floorPlan) return state;
      const placed = state.floorPlan.rooms.find((p) => p.room.id === action.payload.roomId);
      if (!placed || placed.locked) return state;
      const source = placed.room.items.find((i) => i.id === action.payload.id);
      if (!source) return state;
      const offset = findDuplicateOffset(source, placed.room);
      if (!offset) return state;

      let groups = placed.room.groups;
      let groupId = source.groupId;
      let updatedItems = placed.room.items;
      if (!groupId) {
        const newGroup = createGroup({
          layerId: source.layerId,
          color: source.color ?? nextGroupColor(groups.length),
        });
        groups = [...groups, newGroup];
        groupId = newGroup.id;
        // Source joins the new group (color falls away in favor of group color)
        updatedItems = updatedItems.map((i) => (i.id === source.id ? { ...i, groupId, color: undefined } : i));
      }
      const copy: RoomItem = {
        ...source,
        id: crypto.randomUUID(),
        x: source.x + offset.x,
        y: source.y + offset.y,
        groupId,
        color: undefined,
      };
      return updateRoom(state, action.payload.roomId, (room) =>
        touchMetadata({ ...room, items: [...updatedItems, copy], groups }),
      );
    }
    case 'UNGROUP_BLOCK': {
      if (!state.floorPlan) return state;
      const placed = state.floorPlan.rooms.find((p) => p.room.id === action.payload.roomId);
      if (!placed || placed.locked) return state;
      const target = placed.room.items.find((i) => i.id === action.payload.id);
      if (!target || !target.groupId) return state;
      const oldGroupId = target.groupId;
      return updateRoom(state, action.payload.roomId, (room) => {
        const items = room.items.map((i) => (i.id === target.id ? { ...i, groupId: undefined } : i));
        const groups = items.some((i) => i.groupId === oldGroupId)
          ? room.groups
          : room.groups.filter((g) => g.id !== oldGroupId);
        return touchMetadata({ ...room, items, groups });
      });
    }
    case 'RESIZE_BLOCK_GROUP': {
      if (!state.floorPlan) return state;
      const placed = state.floorPlan.rooms.find((p) => p.room.id === action.payload.roomId);
      if (!placed || placed.locked) return state;
      const result = computeCascadeResize(action.payload, placed.room);
      if (!result) return state;
      const updatedById = new Map(result.items.map((i) => [i.id, i]));
      return updateRoom(state, action.payload.roomId, (room) =>
        touchMetadata({
          ...room,
          items: room.items.map((i) => updatedById.get(i.id) ?? i),
        }),
      );
    }
    case 'RESIZE_BLOCK': {
      if (!state.floorPlan) return state;
      const placed = state.floorPlan.rooms.find((p) => p.room.id === action.payload.roomId);
      if (!placed || placed.locked) return state;
      const target = placed.room.items.find((i) => i.id === action.payload.id);
      if (!target) return state;
      const next = resizeAroundAnchor(target, action.payload);
      if (!isInsideRoom(next, placed.room)) return state;
      if (hasSameLayerOverlap(next, placed.room)) return state;
      return updateRoom(state, action.payload.roomId, (room) =>
        touchMetadata({ ...room, items: room.items.map((i) => (i.id === target.id ? next : i)) }),
      );
    }
    case 'RENAME_BLOCK': {
      if (!state.floorPlan) return state;
      const placed = state.floorPlan.rooms.find((p) => p.room.id === action.payload.roomId);
      if (!placed || placed.locked) return state;
      return updateRoom(state, action.payload.roomId, (room) =>
        touchMetadata({
          ...room,
          items: room.items.map((i) => (i.id === action.payload.id ? { ...i, label: action.payload.label } : i)),
        }),
      );
    }
    case 'CENTER_BLOCK_ON_WALL': {
      if (!state.floorPlan) return state;
      const placed = state.floorPlan.rooms.find((p) => p.room.id === action.payload.roomId);
      if (!placed || placed.locked) return state;
      const target = placed.room.items.find((i) => i.id === action.payload.id);
      if (!target) return state;
      if (target.groupId) {
        const nextGroupItems = centerGroupOnWall(target.groupId, action.payload.side, placed.room);
        if (!nextGroupItems || !canPlaceGroupItems(target.groupId, nextGroupItems, placed.room)) return state;
        const updatedById = new Map(nextGroupItems.map((item) => [item.id, item]));
        return updateRoom(state, action.payload.roomId, (room) =>
          touchMetadata({ ...room, items: room.items.map((item) => updatedById.get(item.id) ?? item) }),
        );
      }
      const next = centerOnWall(target, action.payload.side, placed.room);
      if (!isInsideRoom(next, placed.room)) return state;
      if (hasSameLayerOverlap(next, placed.room)) return state;
      return updateRoom(state, action.payload.roomId, (room) =>
        touchMetadata({ ...room, items: room.items.map((i) => (i.id === target.id ? next : i)) }),
      );
    }
    case 'SET_BLOCK_FURNITURE_TYPE': {
      if (!state.floorPlan) return state;
      return updateRoom(state, action.payload.roomId, (room) =>
        touchMetadata({
          ...room,
          items: room.items.map((i) =>
            i.id === action.payload.id
              ? { ...i, furnitureType: action.payload.furnitureType }
              : i,
          ),
        }),
      );
    }
    case 'SET_BLOCK_CONFIGURED_PIECE': {
      if (!state.floorPlan) return state;
      return updateRoom(state, action.payload.roomId, (room) =>
        touchMetadata({
          ...room,
          items: room.items.map((i) =>
            i.id === action.payload.id
              ? { ...i, configuredPieceId: action.payload.configuredPieceId }
              : i,
          ),
        }),
      );
    }
    default:
      return state;
  }
}
