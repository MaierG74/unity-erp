import { useState } from 'react';
import type { OpeningType, WallSide } from '../../types/room';
import { useRoom } from '../../hooks/useRoom';
import { getActiveRoom } from '../../context/RoomContext';
import { createOpening, validateOpeningPosition } from '../../utils/openings';
import { orientOverlapTo, getWallOverlaps, type WallOverlap } from '../../utils/adjacency';
import type { SharedOpening } from '../../types/floorPlan';

interface OpeningFormProps {
  type: OpeningType;
  onCancel: () => void;
  onPlaced: () => void;
}

const WALL_OPTIONS: { side: WallSide; label: string }[] = [
  { side: 'north', label: 'North' },
  { side: 'south', label: 'South' },
  { side: 'east', label: 'East' },
  { side: 'west', label: 'West' },
];

export function OpeningForm({ type, onCancel, onPlaced }: OpeningFormProps) {
  const { state, dispatch } = useRoom();
  const room = getActiveRoom(state);
  const [selectedWall, setSelectedWall] = useState<WallSide>('north');
  const [isDouble, setIsDouble] = useState(false);
  const [hingeSide, setHingeSide] = useState<'left' | 'right'>('left');
  const [swingDirection, setSwingDirection] = useState<'inward' | 'outward'>('inward');
  const [error, setError] = useState<string | null>(null);

  if (!room) return null;

  const effectiveType: OpeningType = type === 'door' && isDouble ? 'double-door' : type;
  const isDoor = type === 'door';

  function handlePlace() {
    if (!room || !state.floorPlan) return;
    const wall = room.walls.find((w) => w.side === selectedWall);
    if (!wall) return;

    const opening = createOpening(effectiveType, wall.id, wall);

    if (effectiveType === 'door') {
      opening.hingeSide = hingeSide;
      opening.swingDirection = swingDirection;
    } else if (effectiveType === 'double-door') {
      opening.swingDirection = swingDirection;
    }

    // Try single traversal to find overlap on this wall
    const oriented: WallOverlap | null = getWallOverlaps(state.floorPlan)
      .map((o) => orientOverlapTo(o, room.id))
      .find((o): o is WallOverlap => o !== null && o.wallA.id === wall.id) ?? null;

    if (oriented) {
      if (oriented.length < opening.width) {
        setError('Opening too wide for shared wall overlap');
        return;
      }
      // Center within overlap
      const sharedLocalPosition = (oriented.length - opening.width) / 2;
      const shared: SharedOpening = {
        id: crypto.randomUUID(),
        type: effectiveType,
        anchorRoomId: oriented.roomA.room.id,
        anchorWallId: oriented.wallA.id,
        partnerRoomId: oriented.roomB.room.id,
        partnerWallId: oriented.wallB.id,
        position: sharedLocalPosition,
        width: opening.width,
        height: opening.height,
        distanceFromFloor: opening.distanceFromFloor,
        hingeSide: effectiveType === 'door' ? hingeSide : undefined,
        swingIntoRoomId:
          effectiveType === 'door' || effectiveType === 'double-door'
            ? swingDirection === 'inward'
              ? oriented.roomA.room.id
              : oriented.roomB.room.id
            : undefined,
      };
      dispatch({ type: 'ADD_SHARED_OPENING', payload: { opening: shared } });
      onPlaced();
      return;
    }

    // Non-shared path
    const validation = validateOpeningPosition(opening, wall, room.openings);
    if (!validation.valid) {
      setError(validation.reason || 'Invalid placement');
      return;
    }

    dispatch({ type: 'ADD_OPENING', payload: { opening } });
    onPlaced();
  }

  const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <h3 className="text-xs font-semibold text-gray-600">Place {typeLabel}</h3>

      {/* Wall picker */}
      <div>
        <span className="text-xs font-medium text-gray-500">Wall</span>
        <div className="mt-1 flex gap-1">
          {WALL_OPTIONS.map(({ side, label }) => (
            <button
              key={side}
              onClick={() => { setSelectedWall(side); setError(null); }}
              className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                selectedWall === side
                  ? 'bg-gray-800 text-white'
                  : 'bg-white text-gray-500 hover:text-gray-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Single / Double toggle — doors only */}
      {isDoor && (
        <div>
          <span className="text-xs font-medium text-gray-500">Style</span>
          <div className="mt-1 flex gap-1">
            {([false, true] as const).map((double) => (
              <button
                key={double ? 'double' : 'single'}
                onClick={() => setIsDouble(double)}
                className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                  isDouble === double
                    ? 'bg-gray-800 text-white'
                    : 'bg-white text-gray-500 hover:text-gray-800'
                }`}
              >
                {double ? 'Double' : 'Single'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Hinge side — single doors only */}
      {isDoor && !isDouble && (
        <div>
          <span className="text-xs font-medium text-gray-500">Hinge Side</span>
          <div className="mt-1 flex gap-1">
            {(['left', 'right'] as const).map((side) => (
              <button
                key={side}
                onClick={() => setHingeSide(side)}
                className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                  hingeSide === side
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

      {/* Swing direction — all doors */}
      {isDoor && (
        <div>
          <span className="text-xs font-medium text-gray-500">Swing Direction</span>
          <div className="mt-1 flex gap-1">
            {(['inward', 'outward'] as const).map((dir) => (
              <button
                key={dir}
                onClick={() => setSwingDirection(dir)}
                className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                  swingDirection === dir
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

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={handlePlace}
          className="flex-1 rounded-lg bg-gray-800 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-gray-700"
        >
          Place {isDouble ? 'Double Door' : typeLabel}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
