import { useState, useCallback, useRef, useEffect } from 'react';
import type { FloorPlan } from '../types/floorPlan';
import { calculateScale, canvasToRoom } from '../utils/scale';
import { getFloorPlanBounds } from '../utils/floorPlan';
import { CANVAS } from '../constants/theme';

interface ViewState {
  scale: number;
  offset: { x: number; y: number };
}

export function useZoomPan(
  containerRef: React.RefObject<HTMLDivElement | null>,
  floorPlan: FloorPlan | null,
) {
  const [viewState, setViewState] = useState<ViewState>({
    scale: 0.1,
    offset: { x: 0, y: 0 },
  });
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const fitToView = useCallback(() => {
    const container = containerRef.current;
    if (!container || !floorPlan || floorPlan.rooms.length === 0) return;

    const rect = container.getBoundingClientRect();
    const bounds = getFloorPlanBounds(floorPlan);
    const planLength = bounds.maxX - bounds.minX;
    const planWidth = bounds.maxY - bounds.minY;
    const scale = calculateScale(
      { length: planLength, width: planWidth },
      { width: rect.width, height: rect.height },
      CANVAS.padding,
    );
    const planW = planLength * scale;
    const planH = planWidth * scale;
    const offsetX = (rect.width - planW) / 2 - bounds.minX * scale;
    const offsetY = (rect.height - planH) / 2 - bounds.minY * scale;

    setViewState({ scale, offset: { x: offsetX, y: offsetY } });
  }, [containerRef, floorPlan]);

  useEffect(() => {
    fitToView();
  }, [fitToView]);

  useEffect(() => {
    const handleResize = () => fitToView();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [fitToView]);

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      if (!floorPlan || floorPlan.rooms.length === 0) return;

      setViewState((prev) => {
        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
        const newScale = prev.scale * zoomFactor;

        const container = containerRef.current;
        if (!container) return prev;
        const rect = container.getBoundingClientRect();
        const bounds = getFloorPlanBounds(floorPlan);
        const minScale = calculateScale(
          { length: bounds.maxX - bounds.minX, width: bounds.maxY - bounds.minY },
          { width: rect.width, height: rect.height },
          CANVAS.padding,
        ) * 0.5;
        const maxScale = CANVAS.maxZoom;
        const clampedScale = Math.max(minScale, Math.min(maxScale, newScale));

        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const scaleRatio = clampedScale / prev.scale;
        const newOffsetX = mouseX - (mouseX - prev.offset.x) * scaleRatio;
        const newOffsetY = mouseY - (mouseY - prev.offset.y) * scaleRatio;

        return { scale: clampedScale, offset: { x: newOffsetX, y: newOffsetY } };
      });
    },
    [containerRef, floorPlan],
  );

  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (e.button !== 0) return;
    // Bail when the click lands inside any room — block-drag or room-shift owns
    // that interaction. Without this guard, pan competes with both and the
    // viewport drifts whenever the user drags a block or shifts a room.
    if (floorPlan && floorPlan.rooms.length > 0) {
      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const pt = canvasToRoom(e.clientX - rect.left, e.clientY - rect.top, viewState.scale, viewState.offset);
        for (const placed of floorPlan.rooms) {
          const { x, y } = placed.position;
          const { length, width } = placed.room.dimensions;
          if (pt.x >= x && pt.x <= x + length && pt.y >= y && pt.y <= y + width) return;
        }
      }
    }
    isPanning.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, [containerRef, floorPlan, viewState]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isPanning.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };

    setViewState((prev) => ({
      ...prev,
      offset: { x: prev.offset.x + dx, y: prev.offset.y + dy },
    }));
  }, []);

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [containerRef, handleWheel, handleMouseDown, handleMouseMove, handleMouseUp]);

  return { viewState, fitToView };
}
