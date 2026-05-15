import type { Dispatch } from 'react';
import type { FloorPlan } from '../../types/floorPlan';
import type { RoomAction } from '../../context/RoomContext';
import { getLayer, countBlocksOnLayer } from '../../utils/layers';
import { AddLayerDialog } from './AddLayerDialog';
import { DialogOverlay } from './DialogOverlay';

interface Props {
  floorPlan: FloorPlan;
  showAdd: boolean;
  editingLayerId: string | null;
  deletingLayerId: string | null;
  dispatch: Dispatch<RoomAction>;
  onCloseAdd: () => void;
  onCloseEdit: () => void;
  onCloseDelete: () => void;
}

export function LayerModals({
  floorPlan,
  showAdd,
  editingLayerId,
  deletingLayerId,
  dispatch,
  onCloseAdd,
  onCloseEdit,
  onCloseDelete,
}: Props) {
  return (
    <>
      {showAdd && (
        <DialogOverlay>
          <AddLayerDialog
            mode="add"
            onSubmit={(payload) => {
              dispatch({ type: 'ADD_LAYER', payload });
              onCloseAdd();
            }}
            onCancel={onCloseAdd}
          />
        </DialogOverlay>
      )}

      {editingLayerId && (() => {
        const layer = getLayer(floorPlan, editingLayerId);
        if (!layer) return null;
        return (
          <DialogOverlay>
            <AddLayerDialog
              mode="edit"
              initialName={layer.name}
              initialZ={layer.z}
              onSubmit={(payload) => {
                dispatch({ type: 'UPDATE_LAYER', payload: { id: editingLayerId, changes: payload } });
                onCloseEdit();
              }}
              onCancel={onCloseEdit}
            />
          </DialogOverlay>
        );
      })()}

      {deletingLayerId && (
        <DialogOverlay>
          <div className="p-4">
            <h3 className="mb-2 text-sm font-semibold">Confirm deletion</h3>
            <p className="mb-4 text-xs text-gray-600">
              This will delete {countBlocksOnLayer(floorPlan, deletingLayerId)} block(s) on this layer. Are you sure?
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="rounded px-3 py-1 text-xs"
                onClick={onCloseDelete}
              >
                Cancel
              </button>
              <button
                className="rounded bg-red-600 px-3 py-1 text-xs text-white"
                onClick={() => {
                  dispatch({ type: 'REMOVE_LAYER', payload: { id: deletingLayerId } });
                  onCloseDelete();
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </DialogOverlay>
      )}
    </>
  );
}
