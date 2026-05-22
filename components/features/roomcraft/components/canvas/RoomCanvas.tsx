import { useRef, useCallback, useEffect, useState } from 'react';
import { useRoom } from '../../hooks/useRoom';
import { useCanvasRenderer } from '../../hooks/useCanvasRenderer';
import { useZoomPan } from '../../hooks/useZoomPan';
import { useOpeningDrag } from '../../hooks/useOpeningDrag';
import { useRoomShiftDrag } from '../../hooks/useRoomShiftDrag';
import { useBlockDrag } from '../../hooks/useBlockDrag';
import { hitTestOpenings, hitTestSharedOpenings } from '../../utils/openings';
import { hitTestBlocks } from '../../utils/blockHitTest';
import { canvasToRoom } from '../../utils/scale';
import { getActivePlacedRoom } from '../../context/RoomContext';
import { usePlacement } from '../../context/PlacementContext';
import { snapPositionToWalls, snapPositionToBlocks } from '../../utils/blockSnap';
import { validateAddBlockAt } from '../../utils/blockActionValidation';
import type { PlacedRoom } from '../../types/floorPlan';
import type { RoomItem } from '../../types/room';
import { CanvasOverlay } from './CanvasOverlay';
import { BlockActions } from '../ui/BlockActions';
import { RoomCraftThreeScene } from './RoomCraftThreeScene';
import { getProject, PROJECTS_CHANGED_EVENT } from '@/lib/roomcraft/project-store';
import type { ProjectPiece } from '@/lib/roomcraft/types';

function hitTestRoom(
  canvasX: number,
  canvasY: number,
  rooms: PlacedRoom[],
  scale: number,
  offset: { x: number; y: number },
): string | null {
  const pt = canvasToRoom(canvasX, canvasY, scale, offset);
  for (const placed of rooms) {
    const { x, y } = placed.position;
    const { length, width } = placed.room.dimensions;
    if (pt.x >= x && pt.x <= x + length && pt.y >= y && pt.y <= y + width) {
      return placed.room.id;
    }
  }
  return null;
}

function getPlacedRoomAtPoint(
  floorX: number,
  floorY: number,
  rooms: PlacedRoom[],
): PlacedRoom | null {
  for (const placed of rooms) {
    const { x, y } = placed.position;
    const { length, width } = placed.room.dimensions;
    if (floorX >= x && floorX <= x + length && floorY >= y && floorY <= y + width) {
      return placed;
    }
  }
  return null;
}

function useShiftKey(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Shift') setHeld(true); };
    const up = (e: KeyboardEvent) => { if (e.key === 'Shift') setHeld(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);
  return held;
}

interface RoomCanvasProps {
  projectId?: string;
}

export function RoomCanvas({ projectId }: RoomCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { state, dispatch } = useRoom();
  const floorPlan = state.floorPlan;
  const activePlaced = getActivePlacedRoom(state);

  // Alt+click cycling state: tracks the last block-click location and cycling index.
  const lastBlockClick = useRef<{ x: number; y: number; index: number } | null>(null);

  const { viewState, fitToView } = useZoomPan(containerRef, floorPlan);
  const { placement, setCursor, cancel } = usePlacement();
  const isPlacing = placement.mode === 'placing';
  const shiftHeld = useShiftKey();
  const cameraFlipped = false;

  const loadProjectPieces = useCallback(() => {
    if (!projectId) return new Map();
    const project = getProject(projectId);
    return new Map((project?.pieces ?? []).map((piece) => [piece.blockId, piece]));
  }, [projectId]);

  const [pieceMap, setPieceMap] = useState<Map<string, ProjectPiece>>(() => loadProjectPieces());

  const refreshProjectPieces = useCallback(() => {
    setPieceMap(loadProjectPieces());
  }, [loadProjectPieces]);

  useEffect(() => {
    refreshProjectPieces();
    if (!projectId) return;

    const handleProjectChange = (event: Event) => {
      const changedProjectId = (event as CustomEvent<{ projectId?: string }>).detail?.projectId;
      if (!changedProjectId || changedProjectId === projectId) {
        refreshProjectPieces();
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshProjectPieces();
      }
    };

    window.addEventListener(PROJECTS_CHANGED_EVENT, handleProjectChange);
    window.addEventListener('focus', refreshProjectPieces);
    window.addEventListener('pageshow', refreshProjectPieces);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener(PROJECTS_CHANGED_EVENT, handleProjectChange);
      window.removeEventListener('focus', refreshProjectPieces);
      window.removeEventListener('pageshow', refreshProjectPieces);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [projectId, refreshProjectPieces]);

  useEffect(() => {
    if (state.showIsometric) {
      refreshProjectPieces();
    }
  }, [state.showIsometric, refreshProjectPieces]);

  const ghost = (() => {
    if (placement.mode !== 'placing' || !placement.cursor || !floorPlan) return null;
    const targetPlaced = getPlacedRoomAtPoint(
      placement.cursor.x,
      placement.cursor.y,
      floorPlan.rooms,
    );
    if (!targetPlaced) return null;

    const v = placement.values;
    const localCursor = {
      x: placement.cursor.x - targetPlaced.position.x,
      y: placement.cursor.y - targetPlaced.position.y,
    };
    let gx = localCursor.x - v.length / 2;
    let gy = localCursor.y - v.depth / 2;
    if (shiftHeld) {
      const wallSnapped = snapPositionToWalls({ x: gx, y: gy }, { length: v.length, depth: v.depth, rotation: 0 }, targetPlaced.room);
      gx = wallSnapped.x; gy = wallSnapped.y;
      const sameLayerOthers = targetPlaced.room.items.filter((i) => i.layerId === v.layerId);
      const synthetic: RoomItem = {
        id: '__ghost__', label: 'ghost', layerId: v.layerId,
        x: gx, y: gy, length: v.length, depth: v.depth, height: v.height,
        rotation: 0, anchor: { x: 'center', y: 'max', z: 'min' },
      };
      const blockSnapped = snapPositionToBlocks({ x: gx, y: gy }, synthetic, sameLayerOthers, targetPlaced.room.dimensions);
      gx = blockSnapped.x; gy = blockSnapped.y;
    }
    const valid = validateAddBlockAt(v, { x: gx, y: gy }, targetPlaced.room, floorPlan).ok;
    return {
      x: targetPlaced.position.x + gx,
      y: targetPlaced.position.y + gy,
      length: v.length,
      depth: v.depth,
      valid,
    };
  })();

  useCanvasRenderer(
    canvasRef, floorPlan, state.activeRoomId, viewState,
    state.selectedOpeningId, state.selectedSharedOpeningId, state.selectedBlockId, state.displayUnit,
    ghost,
    state.showHeatmap,
    state.showIsometric,
    cameraFlipped,
    pieceMap,
    state.showMeasurements,
  );

  const handleUpdatePosition = useCallback(
    (id: string, position: number) => {
      dispatch({ type: 'UPDATE_OPENING', payload: { id, changes: { position } } });
    },
    [dispatch],
  );

  const handleUpdateSharedPosition = useCallback(
    (id: string, position: number) => {
      dispatch({ type: 'UPDATE_SHARED_OPENING', payload: { id, changes: { position } } });
    },
    [dispatch],
  );

  useOpeningDrag({
    containerRef,
    activePlacedRoom: activePlaced ?? null,
    selectedOpeningId: state.selectedOpeningId,
    selectedSharedOpeningId: state.selectedSharedOpeningId,
    floorPlan,
    viewState,
    onUpdatePosition: handleUpdatePosition,
    onUpdateSharedPosition: handleUpdateSharedPosition,
    disabled: isPlacing,
  });

  useRoomShiftDrag({
    containerRef,
    floorPlan,
    activePlacedRoom: activePlaced ?? null,
    selectedOpeningId: state.selectedOpeningId,
    selectedSharedOpeningId: state.selectedSharedOpeningId,
    viewState,
    dispatch,
    disabled: isPlacing,
  });

  useBlockDrag({
    containerRef,
    floorPlan,
    activePlacedRoom: activePlaced ?? null,
    selectedBlockId: state.selectedBlockId,
    viewState,
    dispatch,
    disabled: isPlacing,
  });

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (placement.mode !== 'placing') return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;
    const pt = canvasToRoom(canvasX, canvasY, viewState.scale, viewState.offset);
    setCursor({ x: pt.x, y: pt.y });
  }, [placement.mode, viewState, setCursor]);

  const handleMouseLeave = useCallback(() => {
    if (placement.mode !== 'placing') return;
    setCursor(null);
  }, [placement.mode, setCursor]);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!floorPlan) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;

      if (state.showIsometric) {
        return;
      }

      // Placement mode short-circuits all other click logic.
      if (placement.mode === 'placing') {
        const pt = canvasToRoom(canvasX, canvasY, viewState.scale, viewState.offset);
        const targetPlaced = getPlacedRoomAtPoint(pt.x, pt.y, floorPlan.rooms);
        if (!targetPlaced || targetPlaced.locked) return;

        const v = placement.values;
        const localCursor = {
          x: pt.x - targetPlaced.position.x,
          y: pt.y - targetPlaced.position.y,
        };
        // Center the block on the cursor:
        let candX = localCursor.x - v.length / 2;
        let candY = localCursor.y - v.depth / 2;
        // Shift held? Snap to walls then to other same-layer blocks.
        if (e.shiftKey) {
          const wallSnapped = snapPositionToWalls({ x: candX, y: candY }, { length: v.length, depth: v.depth, rotation: 0 }, targetPlaced.room);
          candX = wallSnapped.x; candY = wallSnapped.y;
          const sameLayerOthers = targetPlaced.room.items.filter((i) => i.layerId === v.layerId);
          const synthetic: RoomItem = {
            id: '__ghost__', label: 'ghost', layerId: v.layerId,
            x: candX, y: candY, length: v.length, depth: v.depth, height: v.height,
            rotation: 0, anchor: { x: 'center', y: 'max', z: 'min' },
          };
          const blockSnapped = snapPositionToBlocks({ x: candX, y: candY }, synthetic, sameLayerOthers, targetPlaced.room.dimensions);
          candX = blockSnapped.x; candY = blockSnapped.y;
        }
        // Validate before dispatch.
        const result = validateAddBlockAt(v, { x: candX, y: candY }, targetPlaced.room, floorPlan);
        if (!result.ok) return; // silent ignore
        if (targetPlaced.room.id !== state.activeRoomId) {
          dispatch({ type: 'SET_ACTIVE_ROOM', payload: { id: targetPlaced.room.id } });
        }
        dispatch({
          type: 'ADD_BLOCK',
          payload: {
            roomId: targetPlaced.room.id,
            init: {
              label: v.label || 'Block',
              layerId: v.layerId,
              x: candX, y: candY,
              length: v.length, depth: v.depth, height: v.height,
              rotation: 0,
            },
          },
        });
        cancel(); // exit placement mode; reducer auto-selects the new block
        return;
      }

      const sharedHit = hitTestSharedOpenings(canvasX, canvasY, floorPlan, viewState.scale, viewState.offset);
      if (sharedHit) {
        dispatch({ type: 'SELECT_SHARED_OPENING', payload: { id: sharedHit } });
        return;
      }

      if (activePlaced) {
        const openingHit = hitTestOpenings(
          canvasX, canvasY, activePlaced.room,
          viewState.scale, viewState.offset, activePlaced.position,
        );
        if (openingHit) {
          dispatch({ type: 'SELECT_OPENING', payload: { id: openingHit } });
          return;
        }
      }

      // Block hit-test — convert to room-frame coords then test all blocks.
      const roomPt = canvasToRoom(canvasX, canvasY, viewState.scale, viewState.offset);

      // Alt+click cycling: if alt held AND we have a prior click near this point, cycle.
      const TOLERANCE = 5; // canvas pixels
      if (
        e.altKey &&
        lastBlockClick.current !== null &&
        Math.abs(canvasX - lastBlockClick.current.x) <= TOLERANCE &&
        Math.abs(canvasY - lastBlockClick.current.y) <= TOLERANCE
      ) {
        const hits = hitTestBlocks(roomPt.x, roomPt.y, floorPlan);
        if (hits.length > 1) {
          const newIndex = (lastBlockClick.current.index + 1) % hits.length;
          lastBlockClick.current = { x: canvasX, y: canvasY, index: newIndex };
          const hit = hits[newIndex];
          if (hit.roomId !== state.activeRoomId) {
            dispatch({ type: 'SET_ACTIVE_ROOM', payload: { id: hit.roomId } });
          }
          dispatch({ type: 'SELECT_BLOCK', payload: { id: hit.id } });
          return;
        }
      }

      // Normal block click (or alt-click at a new location).
      const hits = hitTestBlocks(roomPt.x, roomPt.y, floorPlan);
      if (hits.length > 0) {
        const hit = hits[0];
        lastBlockClick.current = { x: canvasX, y: canvasY, index: 0 };
        if (hit.roomId !== state.activeRoomId) {
          dispatch({ type: 'SET_ACTIVE_ROOM', payload: { id: hit.roomId } });
        }
        dispatch({ type: 'SELECT_BLOCK', payload: { id: hit.id } });
        return;
      }

      // No block hit — clear lastBlockClick cycling ref.
      lastBlockClick.current = null;

      const roomHit = hitTestRoom(canvasX, canvasY, floorPlan.rooms, viewState.scale, viewState.offset);
      if (roomHit && roomHit !== state.activeRoomId) {
        dispatch({ type: 'SET_ACTIVE_ROOM', payload: { id: roomHit } });
        return;
      }

      dispatch({ type: 'DESELECT_OPENING' });
    },
    [floorPlan, activePlaced, placement, viewState, state.activeRoomId, state.showIsometric, dispatch, cancel],
  );

  // Cancel placement when the active room's identity or lock-state changes.
  // Deps deliberately exclude placement.mode (would self-cancel on the
  // picking→placing entry) and cancel (stable callback). FloorPlan-wide
  // resets are covered transitively because they reassign room IDs.
  useEffect(() => {
    if (placement.mode === 'idle') return;
    cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlaced?.room.id, activePlaced?.locked]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (placement.mode !== 'idle') {
          cancel();
          return; // don't also clear selection
        }
        if (state.selectedOpeningId || state.selectedSharedOpeningId) {
          dispatch({ type: 'DESELECT_OPENING' });
        }
        if (state.selectedBlockId) {
          dispatch({ type: 'DESELECT_BLOCK' });
        }
      }
      if (e.key === 'Delete' && state.selectedBlockId) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        if (!activePlaced) return;
        dispatch({ type: 'REMOVE_BLOCK', payload: { roomId: activePlaced.room.id, id: state.selectedBlockId } });
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [placement.mode, cancel, state.selectedOpeningId, state.selectedSharedOpeningId, state.selectedBlockId, activePlaced, dispatch]);

  return (
    <div
      ref={containerRef}
      data-testid="room-canvas-container"
      className="relative h-full w-full cursor-grab active:cursor-grabbing"
      onClick={handleCanvasClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full${state.showIsometric ? ' hidden' : ''}`}
      />
      {state.showIsometric && activePlaced && floorPlan && (
        <RoomCraftThreeScene
          room={activePlaced.room}
          layers={floorPlan.layers}
          pieceMap={pieceMap}
          visibleWalls={state.visible3DWalls}
          className="absolute inset-0 h-full w-full"
        />
      )}
      {floorPlan && (
        <CanvasOverlay
          onFitToView={fitToView}
          showIsometric={state.showIsometric}
          rooms={floorPlan.rooms.map((placed) => ({
            id: placed.room.id,
            name: placed.room.name,
          }))}
          activeRoomId={state.activeRoomId}
          onSelectRoom={(id) => dispatch({ type: 'SET_ACTIVE_ROOM', payload: { id } })}
        />
      )}
      <BlockActions
        containerRef={containerRef}
        floorPlan={floorPlan}
        viewState={viewState}
        dispatch={dispatch}
      />
    </div>
  );
}
