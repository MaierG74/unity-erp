import { type Dispatch, type RefObject, useState } from 'react';
import type { FloorPlan } from '../../types/floorPlan';
import type { RoomAction } from '../../context/RoomContext';
import type { BlockAnchor, WallSide } from '../../types/room';
import { useBlockContextMenu } from '../../hooks/useBlockContextMenu';
import { BlockContextMenu } from './BlockContextMenu';
import { ResizeBlockDialog } from './ResizeBlockDialog';
import { SetAnchorDialog } from './SetAnchorDialog';
import { BlockColorDialog } from './BlockColorDialog';
import { DialogOverlay } from './DialogOverlay';
import { validateRotate, validateResize, validateResizeGroup, validateMoveToLayer, validateCenterOnWall, validateDuplicate, lookupLiveBlock } from '../../utils/blockActionValidation';
import { useValidateOrToast } from './toastHooks';

interface ViewState {
  scale: number;
  offset: { x: number; y: number };
}

interface Props {
  containerRef: RefObject<HTMLElement | null>;
  floorPlan: FloorPlan | null;
  viewState: ViewState;
  dispatch: Dispatch<RoomAction>;
}

// Snapshots for each dialog — captured when menu item is clicked so they
// survive after the menu closes (menuState.blockId becomes null).
interface ResizeSnapshot {
  roomId: string;
  id: string;
  groupId: string | undefined;
  initial: { length: number; depth: number; height: number };
}

interface AnchorSnapshot {
  roomId: string;
  id: string;
  initial: BlockAnchor;
}

interface ColorSnapshot {
  roomId: string;
  id: string;
  groupId: string | undefined;
  initial: string;
}

interface MoveToLayerSnapshot {
  roomId: string;
  id: string;
  layerId: string;
}

const DEFAULT_COLOR = '#bcd9c3';

export function BlockActions({ containerRef, floorPlan, viewState, dispatch }: Props) {
  const validateOrToast = useValidateOrToast();
  const { menuState, closeMenu } = useBlockContextMenu({ containerRef, floorPlan, viewState });

  const [resizeSnapshot, setResizeSnapshot] = useState<ResizeSnapshot | null>(null);
  const [anchorSnapshot, setAnchorSnapshot] = useState<AnchorSnapshot | null>(null);
  const [colorSnapshot, setColorSnapshot] = useState<ColorSnapshot | null>(null);
  const [moveToLayerConfirm, setMoveToLayerConfirm] = useState<MoveToLayerSnapshot | null>(null);

  // Resolve target block + its roomId from the current menu state.
  function resolveTarget() {
    if (!floorPlan || !menuState.blockId) return null;
    for (const placed of floorPlan.rooms) {
      const item = placed.room.items.find((i) => i.id === menuState.blockId);
      if (item) return { item, room: placed.room, roomId: placed.room.id };
    }
    return null;
  }

  // --- Handlers wired to menu items ---

  function handleDuplicate() {
    const t = resolveTarget();
    if (!t || !floorPlan) return;
    if (!validateOrToast(validateDuplicate(t.item, t.room, floorPlan))) return;
    dispatch({ type: 'DUPLICATE_BLOCK', payload: { roomId: t.roomId, id: t.item.id } });
  }

  function handleResize() {
    const t = resolveTarget();
    if (!t) return;
    setResizeSnapshot({
      roomId: t.roomId,
      id: t.item.id,
      groupId: t.item.groupId,
      initial: { length: t.item.length, depth: t.item.depth, height: t.item.height },
    });
  }

  function handleSetAnchor() {
    const t = resolveTarget();
    if (!t) return;
    setAnchorSnapshot({
      roomId: t.roomId,
      id: t.item.id,
      initial: t.item.anchor,
    });
  }

  function handleColor() {
    const t = resolveTarget();
    if (!t) return;
    let initial = DEFAULT_COLOR;
    if (t.item.groupId) {
      const grp = t.room.groups.find((g) => g.id === t.item.groupId);
      if (grp) initial = grp.color;
    } else {
      initial = t.item.color ?? DEFAULT_COLOR;
    }
    setColorSnapshot({ roomId: t.roomId, id: t.item.id, groupId: t.item.groupId, initial });
  }

  function handleRotate(direction: 'cw' | 'ccw') {
    const t = resolveTarget();
    if (!t || !floorPlan) return;
    if (!validateOrToast(validateRotate(t.item, direction, t.room, floorPlan))) return;
    dispatch({ type: 'ROTATE_BLOCK', payload: { roomId: t.roomId, id: t.item.id, direction } });
  }

  function handleCenterOnWall(side: WallSide) {
    const t = resolveTarget();
    if (!t || !floorPlan) return;
    if (!validateOrToast(validateCenterOnWall(t.item, side, t.room, floorPlan))) return;
    dispatch({ type: 'CENTER_BLOCK_ON_WALL', payload: { roomId: t.roomId, id: t.item.id, side } });
  }

  function handleMoveToLayer(layerId: string) {
    const t = resolveTarget();
    if (!t || !floorPlan) return;
    // Up-front validation: don't show the detach-confirm modal for an action
    // that's going to fail anyway. One check serves both grouped/ungrouped paths.
    if (!validateOrToast(validateMoveToLayer(t.item, layerId, t.room, floorPlan))) return;
    if (t.item.groupId) {
      // Grouped: show confirm before dispatching (detaches from group).
      setMoveToLayerConfirm({ roomId: t.roomId, id: t.item.id, layerId });
    } else {
      dispatch({ type: 'MOVE_BLOCK_TO_LAYER', payload: { roomId: t.roomId, id: t.item.id, layerId } });
    }
  }

  function handleUngroup() {
    const t = resolveTarget();
    if (!t) return;
    dispatch({ type: 'UNGROUP_BLOCK', payload: { roomId: t.roomId, id: t.item.id } });
  }

  function handleDelete() {
    const t = resolveTarget();
    if (!t) return;
    dispatch({ type: 'REMOVE_BLOCK', payload: { roomId: t.roomId, id: t.item.id } });
  }

  // --- Derive values for BlockContextMenu from the resolved target ---

  const target = menuState.open ? resolveTarget() : null;
  const layers = floorPlan?.layers ?? [];
  const currentLayerId = target?.item.layerId ?? '';
  const isGrouped = target?.item.groupId !== undefined;

  return (
    <>
      {menuState.open && target && (
        <BlockContextMenu
          x={menuState.x}
          y={menuState.y}
          isGrouped={isGrouped}
          onDuplicate={handleDuplicate}
          onResize={handleResize}
          onSetAnchor={handleSetAnchor}
          onColor={handleColor}
          onRotate={handleRotate}
          onCenterOnWall={handleCenterOnWall}
          onMoveToLayer={handleMoveToLayer}
          onUngroup={handleUngroup}
          onDelete={handleDelete}
          onClose={closeMenu}
          layers={layers}
          currentLayerId={currentLayerId}
        />
      )}

      {resizeSnapshot && (
        <DialogOverlay>
          <ResizeBlockDialog
            initial={resizeSnapshot.initial}
            onSubmit={(next) => {
              const snap = resizeSnapshot;
              if (!floorPlan) { setResizeSnapshot(null); return; }
              // Look up live block + room from floorPlan — state may have changed since snapshot.
              const live = lookupLiveBlock(floorPlan, snap.roomId, snap.id);
              if (!live) { setResizeSnapshot(null); return; }
              if (snap.groupId) {
                if (!validateOrToast(validateResizeGroup(snap.groupId, next, live.room, floorPlan))) return; // dialog stays open
                setResizeSnapshot(null);
                dispatch({ type: 'RESIZE_BLOCK_GROUP', payload: { roomId: snap.roomId, groupId: snap.groupId, ...next } });
              } else {
                if (!validateOrToast(validateResize(live.block, next, live.room, floorPlan))) return; // dialog stays open
                setResizeSnapshot(null);
                dispatch({ type: 'RESIZE_BLOCK', payload: { roomId: snap.roomId, id: snap.id, ...next } });
              }
            }}
            onCancel={() => setResizeSnapshot(null)}
          />
        </DialogOverlay>
      )}

      {anchorSnapshot && (
        <DialogOverlay>
          <SetAnchorDialog
            initial={anchorSnapshot.initial}
            onSubmit={(anchor) => {
              const snap = anchorSnapshot;
              setAnchorSnapshot(null);
              dispatch({ type: 'SET_BLOCK_ANCHOR', payload: { roomId: snap.roomId, id: snap.id, anchor } });
            }}
            onCancel={() => setAnchorSnapshot(null)}
          />
        </DialogOverlay>
      )}

      {colorSnapshot && (
        <DialogOverlay>
          <BlockColorDialog
            initial={colorSnapshot.initial}
            onSubmit={(color) => {
              const snap = colorSnapshot;
              setColorSnapshot(null);
              if (snap.groupId) {
                dispatch({ type: 'SET_GROUP_COLOR', payload: { roomId: snap.roomId, groupId: snap.groupId, color } });
              } else {
                dispatch({ type: 'SET_BLOCK_COLOR', payload: { roomId: snap.roomId, id: snap.id, color } });
              }
            }}
            onCancel={() => setColorSnapshot(null)}
          />
        </DialogOverlay>
      )}

      {moveToLayerConfirm && (
        <DialogOverlay>
          <div role="dialog" aria-modal="true" className="p-4 w-72">
            <p className="text-sm mb-4">This will detach the block from its group. Continue?</p>
            <div className="flex justify-end gap-2">
              <button
                className="rounded px-3 py-1 text-xs"
                onClick={() => setMoveToLayerConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="rounded bg-slate-700 px-3 py-1 text-xs text-white"
                onClick={() => {
                  const snap = moveToLayerConfirm;
                  if (!snap || !floorPlan) { setMoveToLayerConfirm(null); return; }
                  // Defensive re-validation: state may have changed between menu-click
                  // and confirm-click. Look up live block + room from floorPlan.
                  const live = lookupLiveBlock(floorPlan, snap.roomId, snap.id);
                  if (!live) { setMoveToLayerConfirm(null); return; }
                  if (!validateOrToast(validateMoveToLayer(live.block, snap.layerId, live.room, floorPlan))) {
                    setMoveToLayerConfirm(null);
                    return;
                  }
                  setMoveToLayerConfirm(null);
                  dispatch({ type: 'MOVE_BLOCK_TO_LAYER', payload: { roomId: snap.roomId, id: snap.id, layerId: snap.layerId } });
                }}
              >
                Continue
              </button>
            </div>
          </div>
        </DialogOverlay>
      )}
    </>
  );
}
