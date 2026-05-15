import { useRef, useCallback, useEffect } from 'react';
import type { RefObject, Dispatch } from 'react';
import { canvasToRoom } from '../utils/scale';
import { hitTestBlocks } from '../utils/blockHitTest';
import { snapPositionToWalls, snapPositionToBlocks } from '../utils/blockSnap';
import type { FloorPlan, PlacedRoom } from '../types/floorPlan';
import type { RoomAction } from '../context/RoomContext';
import type { RoomDimensions, RoomItem } from '../types/room';

interface ViewState {
  scale: number;
  offset: { x: number; y: number };
}

interface Params {
  containerRef: RefObject<HTMLElement | null>;
  floorPlan: FloorPlan | null;
  activePlacedRoom: PlacedRoom | null;
  selectedBlockId: string | null;
  viewState: ViewState;
  dispatch: Dispatch<RoomAction>;
  disabled?: boolean;
}

export function useBlockDrag({
  containerRef,
  floorPlan,
  activePlacedRoom,
  selectedBlockId,
  viewState,
  dispatch,
  disabled = false,
}: Params) {
  const isDragging = useRef(false);
  const startMouse = useRef({ x: 0, y: 0 });
  const originalXY = useRef({ x: 0, y: 0 });
  const dragBlockId = useRef<string | null>(null);
  const dragRoomId = useRef<string | null>(null);
  // Captured at mousedown for shift+snap — avoids re-running find() per mousemove.
  // Full target item: satisfies both snapPositionToWalls (Pick<...>) and snapPositionToBlocks (RoomItem).
  const snapBlockFull = useRef<RoomItem | null>(null);
  const snapRoomDims = useRef<RoomDimensions | null>(null);
  // Same-layer others captured once at mousedown; other blocks don't move during a drag.
  const snapSameLayerOthers = useRef<RoomItem[] | null>(null);

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (disabled) return;
      // Only left-button starts a drag; right-button is reserved for the context menu.
      if (e.button !== 0) return;
      if (!floorPlan || !activePlacedRoom || !selectedBlockId) return;
      if (activePlacedRoom.locked) return;

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const pt = canvasToRoom(cx, cy, viewState.scale, viewState.offset);

      // Use hitTestBlocks (rotation-correct, z-order-aware) instead of inline AABB.
      const hits = hitTestBlocks(pt.x, pt.y, floorPlan);
      if (hits.length === 0 || hits[0].id !== selectedBlockId) return;

      const target = activePlacedRoom.room.items.find((i) => i.id === selectedBlockId);
      if (!target) return;

      isDragging.current = true;
      startMouse.current = { x: e.clientX, y: e.clientY };
      originalXY.current = { x: target.x, y: target.y };
      dragBlockId.current = selectedBlockId;
      dragRoomId.current = activePlacedRoom.room.id;
      snapBlockFull.current = target;
      snapRoomDims.current = activePlacedRoom.room.dimensions;
      snapSameLayerOthers.current = activePlacedRoom.room.items.filter(
        (i) => i.id !== selectedBlockId && i.layerId === target.layerId,
      );

      e.preventDefault();
    },
    [containerRef, floorPlan, activePlacedRoom, selectedBlockId, viewState, disabled],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging.current || !dragBlockId.current || !dragRoomId.current) return;

      const dx = (e.clientX - startMouse.current.x) / viewState.scale;
      const dy = (e.clientY - startMouse.current.y) / viewState.scale;

      const candidate = { x: originalXY.current.x + dx, y: originalXY.current.y + dy };
      let final =
        e.shiftKey && snapBlockFull.current && snapRoomDims.current
          ? snapPositionToWalls(candidate, snapBlockFull.current, { dimensions: snapRoomDims.current })
          : candidate;

      if (e.shiftKey && snapSameLayerOthers.current && snapBlockFull.current) {
        // Build a synthetic target with the snapped position so block-snap math sees the right edges.
        const syntheticTarget = { ...snapBlockFull.current, x: final.x, y: final.y };
        final = snapPositionToBlocks(
          final,
          syntheticTarget,
          snapSameLayerOthers.current,
          snapRoomDims.current!,
        );
      }

      // Optimistic position; reducer rejects on collision (returns same state ref).
      dispatch({
        type: 'UPDATE_BLOCK_POSITION',
        payload: {
          roomId: dragRoomId.current,
          id: dragBlockId.current,
          x: final.x,
          y: final.y,
        },
      });
    },
    [viewState, dispatch],
  );

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
    dragBlockId.current = null;
    dragRoomId.current = null;
    snapBlockFull.current = null;
    snapRoomDims.current = null;
    snapSameLayerOthers.current = null;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('mousedown', handleMouseDown, { capture: true });
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      container.removeEventListener('mousedown', handleMouseDown, { capture: true });
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [containerRef, handleMouseDown, handleMouseMove, handleMouseUp]);
}
