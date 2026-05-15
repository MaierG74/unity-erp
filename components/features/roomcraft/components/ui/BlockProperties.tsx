import { useState, useEffect, type Dispatch } from 'react';
import type { FloorPlan, Layer } from '../../types/floorPlan';
import type { Room, RoomItem, BlockAnchor } from '../../types/room';
import type { RoomAction } from '../../context/RoomContext';
import { SetAnchorDialog } from './SetAnchorDialog';
import { BlockColorDialog } from './BlockColorDialog';
import { DialogOverlay } from './DialogOverlay';
import { validateRotate, validateResize, validateResizeGroup, validateMoveToLayer } from '../../utils/blockActionValidation';
import { useValidateOrToast } from './toastHooks';

interface Props {
  block: RoomItem;
  room: Room;
  layers: Layer[];
  floorPlan: FloorPlan;
  dispatch: Dispatch<RoomAction>;
}

interface DimensionInputProps {
  label: string;
  id: string;
  value: number;
  onCommit: (n: number) => void;
}

function DimensionInput({ label, id, value, onCommit }: DimensionInputProps) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n) && n !== value) onCommit(n);
  };
  return (
    <label className="block text-xs" htmlFor={id}>
      <span className="mb-1 block">{label}</span>
      <input
        id={id}
        className="w-full rounded border px-2 py-1 text-sm"
        inputMode="numeric"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      />
    </label>
  );
}

function anchorLabel(a: BlockAnchor): string {
  return `X: ${a.x} · Y: ${a.y} · Z: ${a.z}`;
}

export function BlockProperties({ block, room, layers, floorPlan, dispatch }: Props) {
  const validateOrToast = useValidateOrToast();
  const [anchorOpen, setAnchorOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(block.label);
  useEffect(() => { setNameDraft(block.label); }, [block.label, block.id]);

  const commitName = () => {
    if (nameDraft !== block.label) {
      dispatch({ type: 'RENAME_BLOCK', payload: { roomId: room.id, id: block.id, label: nameDraft } });
    }
  };

  const group = block.groupId ? room.groups.find((g) => g.id === block.groupId) : undefined;
  const groupMemberCount = block.groupId
    ? room.items.filter((i) => i.groupId === block.groupId).length
    : 0;
  const currentColor = group?.color ?? block.color ?? '#bbb';

  const dispatchResize = (next: { length?: number; depth?: number; height?: number }) => {
    const length = next.length ?? block.length;
    const depth = next.depth ?? block.depth;
    const height = next.height ?? block.height;
    if (block.groupId) {
      if (!validateOrToast(validateResizeGroup(block.groupId, { length, depth, height }, room, floorPlan))) return;
      dispatch({ type: 'RESIZE_BLOCK_GROUP', payload: { roomId: room.id, groupId: block.groupId, length, depth, height } });
    } else {
      if (!validateOrToast(validateResize(block, { length, depth, height }, room, floorPlan))) return;
      dispatch({ type: 'RESIZE_BLOCK', payload: { roomId: room.id, id: block.id, length, depth, height } });
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{block.label || 'Block'}</h3>

      {/* Name */}
      <label className="block text-xs">
        <span className="mb-1 block">Name</span>
        <input
          aria-label="Block name"
          className="w-full rounded border px-2 py-1 text-sm"
          type="text"
          placeholder="Block"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => { if (e.key === 'Enter') commitName(); }}
        />
      </label>

      {/* Layer select */}
      <label className="block text-xs">
        <span className="mb-1 block">Layer</span>
        <select
          className="w-full rounded border px-2 py-1 text-sm"
          value={block.layerId}
          onChange={(e) => {
            const newLayerId = e.target.value;
            if (!validateOrToast(validateMoveToLayer(block, newLayerId, room, floorPlan))) return;
            dispatch({ type: 'MOVE_BLOCK_TO_LAYER', payload: { roomId: room.id, id: block.id, layerId: newLayerId } });
          }}
        >
          {layers.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({l.z} mm)
            </option>
          ))}
        </select>
      </label>

      {/* L/D/H inputs */}
      <DimensionInput
        id={`bp-length-${block.id}`}
        label="Length (mm)"
        value={block.length}
        onCommit={(n) => dispatchResize({ length: n })}
      />
      <DimensionInput
        id={`bp-depth-${block.id}`}
        label="Depth (mm)"
        value={block.depth}
        onCommit={(n) => dispatchResize({ depth: n })}
      />
      <DimensionInput
        id={`bp-height-${block.id}`}
        label="Height (mm)"
        value={block.height}
        onCommit={(n) => dispatchResize({ height: n })}
      />

      {/* Rotation buttons */}
      <div className="text-xs">
        <span className="mb-1 block">Rotation</span>
        <div className="flex gap-2">
          <button
            className="rounded bg-slate-100 px-2 py-1 text-xs"
            onClick={() => {
              if (!validateOrToast(validateRotate(block, 'ccw', room, floorPlan))) return;
              dispatch({ type: 'ROTATE_BLOCK', payload: { roomId: room.id, id: block.id, direction: 'ccw' } });
            }}
          >
            ↺ 90° CCW
          </button>
          <button
            className="rounded bg-slate-100 px-2 py-1 text-xs"
            onClick={() => {
              if (!validateOrToast(validateRotate(block, 'cw', room, floorPlan))) return;
              dispatch({ type: 'ROTATE_BLOCK', payload: { roomId: room.id, id: block.id, direction: 'cw' } });
            }}
          >
            ↻ 90° CW
          </button>
          <span className="ml-auto self-center text-slate-500">Currently: {block.rotation}°</span>
        </div>
      </div>

      {/* Anchor display (read-only summary, click to edit) */}
      <button className="block w-full text-left text-xs" onClick={() => setAnchorOpen(true)}>
        <span className="mb-1 block">Anchor</span>
        <span className="block rounded border bg-white px-2 py-1">
          {anchorLabel(block.anchor)}
        </span>
      </button>

      {/* Color swatch */}
      <button className="block w-full text-left text-xs" onClick={() => setColorOpen(true)}>
        <span className="mb-1 block">Color</span>
        <span className="flex items-center gap-2 rounded border bg-white px-2 py-1">
          <span
            className="inline-block h-4 w-4 rounded border"
            style={{ background: currentColor }}
          />
          <span className="font-mono">{currentColor}</span>
        </span>
      </button>

      {/* Group info */}
      {block.groupId && (
        <div className="text-xs">
          <span className="mb-1 block">Group</span>
          <div className="flex items-center gap-2 rounded border bg-white px-2 py-1">
            <span className="text-slate-500">Members: {groupMemberCount}</span>
            <button
              className="ml-auto rounded bg-slate-100 px-2 py-1 text-xs"
              onClick={() =>
                dispatch({ type: 'UNGROUP_BLOCK', payload: { roomId: room.id, id: block.id } })
              }
            >
              Ungroup
            </button>
          </div>
        </div>
      )}

      {/* Delete */}
      <button
        className="rounded bg-red-50 px-3 py-1 text-xs text-red-700"
        onClick={() =>
          dispatch({ type: 'REMOVE_BLOCK', payload: { roomId: room.id, id: block.id } })
        }
      >
        Delete block
      </button>

      {/* Modals */}
      {anchorOpen && (
        <DialogOverlay>
          <SetAnchorDialog
            initial={block.anchor}
            onSubmit={(anchor) => {
              dispatch({ type: 'SET_BLOCK_ANCHOR', payload: { roomId: room.id, id: block.id, anchor } });
              setAnchorOpen(false);
            }}
            onCancel={() => setAnchorOpen(false)}
          />
        </DialogOverlay>
      )}

      {colorOpen && (
        <DialogOverlay>
          <BlockColorDialog
            initial={currentColor}
            onSubmit={(color) => {
              if (block.groupId) {
                dispatch({ type: 'SET_GROUP_COLOR', payload: { roomId: room.id, groupId: block.groupId, color } });
              } else {
                dispatch({ type: 'SET_BLOCK_COLOR', payload: { roomId: room.id, id: block.id, color } });
              }
              setColorOpen(false);
            }}
            onCancel={() => setColorOpen(false)}
          />
        </DialogOverlay>
      )}
    </div>
  );
}

