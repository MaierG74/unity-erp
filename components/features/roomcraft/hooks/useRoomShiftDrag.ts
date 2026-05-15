import { useRef, useCallback, useEffect } from 'react';
import type { FloorPlan, PlacedRoom } from '../types/floorPlan';
import type { RoomAction } from '../context/RoomContext';
import type { Dispatch } from 'react';
import { canvasToRoom } from '../utils/scale';
import { getAvailableAxes, inferShiftAxis, previewRoomShift, computeSnapPositions, type ShiftAxis } from '../utils/shiftRoom';
import { hitTestBlocks } from '../utils/blockHitTest';

const AXIS_LOCK_THRESHOLD_PX = 4;

interface UseRoomShiftDragProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  floorPlan: FloorPlan | null;
  activePlacedRoom: PlacedRoom | null;
  selectedOpeningId: string | null;
  selectedSharedOpeningId: string | null;
  viewState: { scale: number; offset: { x: number; y: number } };
  dispatch: Dispatch<RoomAction>;
  disabled?: boolean;
}

export function useRoomShiftDrag({
  containerRef,
  floorPlan,
  activePlacedRoom,
  selectedOpeningId,
  selectedSharedOpeningId,
  viewState,
  dispatch,
  disabled = false,
}: UseRoomShiftDragProps) {
  const isDragging = useRef(false);
  const startClient = useRef({ x: 0, y: 0 });
  const startRootPos = useRef({ x: 0, y: 0 });
  const lockedAxis = useRef<ShiftAxis | null>(null);
  const lastDispatchedDelta = useRef(0);
  const cascadeChecked = useRef(false);

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (disabled) return;
      if (!floorPlan || !activePlacedRoom) return;
      if (selectedOpeningId || selectedSharedOpeningId) return;
      if (activePlacedRoom?.locked) return;

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;
      const pt = canvasToRoom(canvasX, canvasY, viewState.scale, viewState.offset);
      const { x, y } = activePlacedRoom.position;
      const { length, width } = activePlacedRoom.room.dimensions;
      if (pt.x < x || pt.x > x + length || pt.y < y || pt.y > y + width) return;

      // Bail when the click lands on a visible block — block drag (or click-to-select)
      // owns that interaction. Without this guard both useRoomShiftDrag and useBlockDrag
      // arm on the same mousedown and dispatch concurrently.
      if (hitTestBlocks(pt.x, pt.y, floorPlan).length > 0) return;

      const axes = getAvailableAxes(floorPlan, activePlacedRoom.room.id);
      if (axes.length === 0) return;

      isDragging.current = true;
      startClient.current = { x: e.clientX, y: e.clientY };
      startRootPos.current = { x: activePlacedRoom.position.x, y: activePlacedRoom.position.y };
      lockedAxis.current = axes.length === 1 ? axes[0] : null;
      lastDispatchedDelta.current = 0;
      cascadeChecked.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
    [
      containerRef,
      floorPlan,
      activePlacedRoom,
      selectedOpeningId,
      selectedSharedOpeningId,
      viewState,
      disabled,
    ],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging.current || !activePlacedRoom || !floorPlan) return;
      const dx = e.clientX - startClient.current.x;
      const dy = e.clientY - startClient.current.y;

      if (lockedAxis.current === null) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_LOCK_THRESHOLD_PX) return;
        const axes = getAvailableAxes(floorPlan, activePlacedRoom.room.id);
        const inferred = inferShiftAxis(dx, dy, axes);
        if (!inferred) {
          isDragging.current = false;
          return;
        }
        lockedAxis.current = inferred;
      }

      if (!cascadeChecked.current) {
        cascadeChecked.current = true;
        const preview = previewRoomShift(floorPlan, activePlacedRoom.room.id, lockedAxis.current, 1);
        if (preview.blockingLockedRoomIds.length > 0) {
          isDragging.current = false;
          lockedAxis.current = null;
          lastDispatchedDelta.current = 0;
          return;
        }
      }

      const canvasDelta = lockedAxis.current === 'x' ? dx : dy;
      let mmDelta = Math.round(canvasDelta / viewState.scale);

      if (e.shiftKey && floorPlan) {
        const SNAP_PX = 10;
        const thresholdMm = SNAP_PX / viewState.scale;
        const startAbs = lockedAxis.current === 'x'
          ? startRootPos.current.x
          : startRootPos.current.y;
        const desiredAbs = startAbs + mmDelta;
        const snaps = computeSnapPositions(floorPlan, activePlacedRoom.room.id, lockedAxis.current);
        let best: number | null = null;
        let bestDist = thresholdMm + 1;
        for (const s of snaps) {
          const d = Math.abs(desiredAbs - s);
          if (d <= thresholdMm && d < bestDist) {
            best = s;
            bestDist = d;
          }
        }
        if (best !== null) mmDelta = best - startAbs;
      }

      const increment = mmDelta - lastDispatchedDelta.current;
      if (increment === 0) return;

      dispatch({
        type: 'SHIFT_ROOM',
        payload: {
          roomId: activePlacedRoom.room.id,
          axis: lockedAxis.current,
          deltaMm: increment,
        },
      });
      lastDispatchedDelta.current = mmDelta;
      e.preventDefault();
    },
    [activePlacedRoom, floorPlan, viewState, dispatch],
  );

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
    lockedAxis.current = null;
    lastDispatchedDelta.current = 0;
    cascadeChecked.current = false;
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
