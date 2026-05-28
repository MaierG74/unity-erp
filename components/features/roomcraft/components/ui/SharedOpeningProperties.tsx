import { useRoom } from '../../hooks/useRoom';
import { isRoomLocked } from '../../utils/floorPlan';
import type { SharedOpening } from '../../types/floorPlan';

interface Props {
  opening: SharedOpening;
}

export function SharedOpeningProperties({ opening }: Props) {
  const { state, dispatch } = useRoom();
  if (!state.floorPlan) return null;
  const anchor = state.floorPlan.rooms.find((p) => p.room.id === opening.anchorRoomId);
  const partner = state.floorPlan.rooms.find((p) => p.room.id === opening.partnerRoomId);
  if (!anchor || !partner) return null;

  const anchorLocked = isRoomLocked(state.floorPlan, opening.anchorRoomId);
  const partnerLocked = isRoomLocked(state.floorPlan, opening.partnerRoomId);
  const locked = anchorLocked || partnerLocked;

  const typeLabel =
    opening.type === 'double-door'
      ? 'Double Door'
      : opening.type.charAt(0).toUpperCase() + opening.type.slice(1);

  if (locked) {
    return (
      <div className="space-y-3 rounded-lg bg-gray-50 p-3">
        <div className="text-xs font-semibold uppercase text-gray-500">Shared opening</div>
        <div className="text-sm text-gray-700">
          Type: {typeLabel}
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          🔒 Locked. Click the padlock in the room list to edit.
        </div>
      </div>
    );
  }

  const activeIsAnchor = state.activeRoomId === opening.anchorRoomId;

  function update(changes: Partial<SharedOpening>) {
    dispatch({ type: 'UPDATE_SHARED_OPENING', payload: { id: opening.id, changes } });
  }

  const swingsIntoActive =
    (activeIsAnchor && opening.swingIntoRoomId === opening.anchorRoomId) ||
    (!activeIsAnchor && opening.swingIntoRoomId === opening.partnerRoomId);

  const displayHinge: 'left' | 'right' =
    activeIsAnchor
      ? opening.hingeSide ?? 'left'
      : opening.hingeSide === 'right'
        ? 'left'
        : 'right';

  function setDisplayHinge(display: 'left' | 'right') {
    const stored: 'left' | 'right' = activeIsAnchor
      ? display
      : display === 'left'
        ? 'right'
        : 'left';
    update({ hingeSide: stored });
  }

  function setSwingDirection(dir: 'inward' | 'outward') {
    const activeRoomId = activeIsAnchor ? opening.anchorRoomId : opening.partnerRoomId;
    const otherRoomId = activeIsAnchor ? opening.partnerRoomId : opening.anchorRoomId;
    update({ swingIntoRoomId: dir === 'inward' ? activeRoomId : otherRoomId });
  }

  const isDoor = opening.type === 'door' || opening.type === 'double-door';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">{typeLabel} Properties</h2>
        <button
          onClick={() => dispatch({ type: 'DESELECT_OPENING' })}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Done
        </button>
      </div>

      <p className="text-xs text-gray-400">
        Shared between {anchor.room.name} and {partner.room.name}
      </p>

      <label className="block">
        <span className="text-xs font-medium text-gray-500">Position (mm from overlap start)</span>
        <input
          type="number"
          value={opening.position}
          onChange={(e) => update({ position: parseFloat(e.target.value) || 0 })}
          step="10"
          className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium text-gray-500">Width (mm)</span>
        <input
          type="number"
          value={opening.width}
          onChange={(e) => update({ width: parseFloat(e.target.value) || 0 })}
          step="10"
          className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium text-gray-500">Height (mm)</span>
        <input
          type="number"
          value={opening.height}
          onChange={(e) => update({ height: parseFloat(e.target.value) || 0 })}
          step="10"
          className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
        />
      </label>

      {opening.type === 'door' && (
        <div>
          <span className="text-xs font-medium text-gray-500">Hinge Side</span>
          <div className="mt-1 flex gap-1">
            {(['left', 'right'] as const).map((side) => (
              <button
                key={side}
                onClick={() => setDisplayHinge(side)}
                className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                  displayHinge === side
                    ? 'bg-gray-800 text-white'
                    : 'bg-white text-gray-500 hover:text-gray-800'
                }`}
              >
                {side.charAt(0).toUpperCase() + side.slice(1)}
              </button>
            ))}
          </div>
        </div>
      )}

      {isDoor && (
        <div>
          <span className="text-xs font-medium text-gray-500">Swing Direction</span>
          <div className="mt-1 flex gap-1">
            {(['inward', 'outward'] as const).map((dir) => (
              <button
                key={dir}
                onClick={() => setSwingDirection(dir)}
                className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                  (dir === 'inward' && swingsIntoActive) || (dir === 'outward' && !swingsIntoActive)
                    ? 'bg-gray-800 text-white'
                    : 'bg-white text-gray-500 hover:text-gray-800'
                }`}
              >
                {dir.charAt(0).toUpperCase() + dir.slice(1)}
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => dispatch({ type: 'REMOVE_SHARED_OPENING', payload: { id: opening.id } })}
        className="w-full rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-500 transition-colors hover:bg-red-50"
      >
        Delete {typeLabel}
      </button>
    </div>
  );
}
