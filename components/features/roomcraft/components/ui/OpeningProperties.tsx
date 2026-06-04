import { useRoom } from '../../hooks/useRoom';
import { getActiveRoom } from '../../context/RoomContext';
import type { Opening } from '../../types/room';

interface OpeningPropertiesProps {
  opening: Opening;
}

export function OpeningProperties({ opening }: OpeningPropertiesProps) {
  const { state, dispatch } = useRoom();
  const room = getActiveRoom(state);
  const wall = room?.walls.find((w) => w.id === opening.wallId);
  const typeLabel = opening.type === 'double-door' ? 'Double Door' : opening.type.charAt(0).toUpperCase() + opening.type.slice(1);

  function update(changes: Partial<Opening>) {
    dispatch({ type: 'UPDATE_OPENING', payload: { id: opening.id, changes } });
  }

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

      <p className="text-xs text-gray-400">Wall: {wall?.side.toUpperCase() || '?'}</p>

      <label className="block">
        <span className="text-xs font-medium text-gray-500">Position (mm from left)</span>
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
                onClick={() => update({ hingeSide: side })}
                className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                  opening.hingeSide === side
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

      {(opening.type === 'door' || opening.type === 'double-door') && (
        <div>
          <span className="text-xs font-medium text-gray-500">Swing Direction</span>
          <div className="mt-1 flex gap-1">
            {(['inward', 'outward'] as const).map((dir) => (
              <button
                key={dir}
                onClick={() => update({ swingDirection: dir })}
                className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                  opening.swingDirection === dir
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
        onClick={() => {
          dispatch({ type: 'REMOVE_OPENING', payload: { id: opening.id } });
        }}
        className="w-full rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-500 transition-colors hover:bg-red-50"
      >
        Delete {typeLabel}
      </button>
    </div>
  );
}
