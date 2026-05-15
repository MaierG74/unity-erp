import { useRef, useCallback, useEffect } from 'react';
import type { PlacedRoom, FloorPlan, SharedOpening } from '../types/floorPlan';
import { roomToCanvas } from '../utils/scale';
import { findOverlapForShared } from '../utils/adjacency';

interface UseOpeningDragProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  activePlacedRoom: PlacedRoom | null;
  selectedOpeningId: string | null;
  selectedSharedOpeningId?: string | null;
  floorPlan?: FloorPlan | null;
  viewState: { scale: number; offset: { x: number; y: number } };
  onUpdatePosition: (id: string, position: number) => void;
  onUpdateSharedPosition?: (id: string, position: number) => void;
  disabled?: boolean;
}

type DragTarget = 'single' | 'shared' | null;

export function useOpeningDrag({
  containerRef,
  activePlacedRoom,
  selectedOpeningId,
  selectedSharedOpeningId,
  floorPlan,
  viewState,
  onUpdatePosition,
  onUpdateSharedPosition,
  disabled = false,
}: UseOpeningDragProps) {
  const isDragging = useRef(false);
  const dragOpeningId = useRef<string | null>(null);
  const dragTarget = useRef<DragTarget>(null);
  // Capture mutable shared opening ref for use in mousemove without stale closure issues
  const sharedOpeningRef = useRef<SharedOpening | null>(null);

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (disabled) return;
      // --- Shared opening drag check ---
      if (selectedSharedOpeningId && floorPlan && onUpdateSharedPosition) {
        const shared = floorPlan.sharedOpenings.find((s) => s.id === selectedSharedOpeningId);
        if (shared) {
          // Bail if either anchor or partner room is locked
          const anchor = floorPlan.rooms.find((p) => p.room.id === shared.anchorRoomId);
          const partner = floorPlan.rooms.find((p) => p.room.id === shared.partnerRoomId);
          if (anchor?.locked || partner?.locked) return;
          const overlap = findOverlapForShared(floorPlan, shared);
          if (overlap) {
            const rect = containerRef.current?.getBoundingClientRect();
            if (rect) {
              const canvasX = e.clientX - rect.left;
              const canvasY = e.clientY - rect.top;

              const tl = roomToCanvas(
                overlap.roomA.position.x,
                overlap.roomA.position.y,
                viewState.scale,
                viewState.offset,
              );

              let alongWall: number;
              if (overlap.wallA.side === 'north' || overlap.wallA.side === 'south') {
                alongWall = (canvasX - tl.x) / viewState.scale;
              } else {
                alongWall = (canvasY - tl.y) / viewState.scale;
              }

              // Wall-local bounds of the shared opening
              const openingStart = overlap.startA + shared.position;
              const openingEnd = openingStart + shared.width;
              const tolerance = 20 / viewState.scale;

              if (alongWall >= openingStart - tolerance && alongWall <= openingEnd + tolerance) {
                isDragging.current = true;
                dragOpeningId.current = selectedSharedOpeningId;
                dragTarget.current = 'shared';
                sharedOpeningRef.current = shared;
                e.preventDefault();
                e.stopPropagation();
                return;
              }
            }
          }
        }
      }

      // --- Single-room opening drag check ---
      if (!activePlacedRoom || !selectedOpeningId) return;
      // Bail if the active room is locked
      if (activePlacedRoom.locked) return;
      const room = activePlacedRoom.room;
      const opening = room.openings.find((o) => o.id === selectedOpeningId);
      if (!opening) return;
      const wall = room.walls.find((w) => w.id === opening.wallId);
      if (!wall) return;

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;

      const tl = roomToCanvas(
        activePlacedRoom.position.x,
        activePlacedRoom.position.y,
        viewState.scale,
        viewState.offset,
      );
      let alongWall: number;

      if (wall.side === 'north' || wall.side === 'south') {
        alongWall = (canvasX - tl.x) / viewState.scale;
      } else {
        alongWall = (canvasY - tl.y) / viewState.scale;
      }

      const openingStart = opening.position;
      const openingEnd = opening.position + opening.width;

      if (alongWall >= openingStart - 20 / viewState.scale && alongWall <= openingEnd + 20 / viewState.scale) {
        isDragging.current = true;
        dragOpeningId.current = selectedOpeningId;
        dragTarget.current = 'single';
        e.preventDefault();
        e.stopPropagation();
      }
    },
    [containerRef, activePlacedRoom, selectedOpeningId, selectedSharedOpeningId, floorPlan, viewState, onUpdateSharedPosition, disabled],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging.current || !dragOpeningId.current) return;

      // --- Shared opening drag ---
      if (dragTarget.current === 'shared' && floorPlan && onUpdateSharedPosition && sharedOpeningRef.current) {
        const shared = sharedOpeningRef.current;
        const overlap = findOverlapForShared(floorPlan, shared);
        if (!overlap) return;

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const canvasX = e.clientX - rect.left;
        const canvasY = e.clientY - rect.top;

        const tl = roomToCanvas(
          overlap.roomA.position.x,
          overlap.roomA.position.y,
          viewState.scale,
          viewState.offset,
        );

        let alongWall: number;
        if (overlap.wallA.side === 'north' || overlap.wallA.side === 'south') {
          alongWall = (canvasX - tl.x) / viewState.scale;
        } else {
          alongWall = (canvasY - tl.y) / viewState.scale;
        }

        // Convert wall-local to overlap-local, center on cursor
        const overlapLocal = alongWall - overlap.startA - shared.width / 2;
        const maxPos = Math.max(0, overlap.length - shared.width);
        const clamped = Math.round(Math.max(0, Math.min(maxPos, overlapLocal)));

        onUpdateSharedPosition(dragOpeningId.current, clamped);
        e.preventDefault();
        return;
      }

      // --- Single-room opening drag ---
      if (dragTarget.current === 'single' && activePlacedRoom) {
        const room = activePlacedRoom.room;
        const opening = room.openings.find((o) => o.id === dragOpeningId.current);
        if (!opening) return;
        const wall = room.walls.find((w) => w.id === opening.wallId);
        if (!wall) return;

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const canvasX = e.clientX - rect.left;
        const canvasY = e.clientY - rect.top;

        const tl = roomToCanvas(
          activePlacedRoom.position.x,
          activePlacedRoom.position.y,
          viewState.scale,
          viewState.offset,
        );
        let alongWall: number;

        if (wall.side === 'north' || wall.side === 'south') {
          alongWall = (canvasX - tl.x) / viewState.scale;
        } else {
          alongWall = (canvasY - tl.y) / viewState.scale;
        }

        let newPosition = Math.round(alongWall - opening.width / 2);
        newPosition = Math.max(100, Math.min(wall.length - opening.width - 100, newPosition));

        onUpdatePosition(dragOpeningId.current, newPosition);
        e.preventDefault();
      }
    },
    [containerRef, activePlacedRoom, floorPlan, viewState, onUpdatePosition, onUpdateSharedPosition],
  );

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
    dragOpeningId.current = null;
    dragTarget.current = null;
    sharedOpeningRef.current = null;
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
