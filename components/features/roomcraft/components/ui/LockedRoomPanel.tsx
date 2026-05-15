import { useRoom } from '../../hooks/useRoom';
import { formatDisplay } from '../../utils/units';

interface LockedRoomPanelProps {
  roomId: string;
}

function ClosedPadlockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
      <rect x="3" y="8" width="10" height="6" rx="1" />
      <path d="M5 8V5.5a3 3 0 0 1 6 0V8" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function LockedRoomPanel({ roomId }: LockedRoomPanelProps) {
  const { state } = useRoom();
  if (!state.floorPlan) return null;
  const placed = state.floorPlan.rooms.find((p) => p.room.id === roomId);
  if (!placed) return null;

  const { room } = placed;
  const unit = state.displayUnit;

  const l = formatDisplay(room.dimensions.length, unit);
  const w = formatDisplay(room.dimensions.width, unit);
  const h = formatDisplay(room.dimensions.height, unit);

  return (
    <div className="space-y-3 rounded-lg bg-gray-50 p-3">
      <div>
        <div className="text-xs font-semibold uppercase text-gray-500">Room</div>
        <div className="text-base font-medium text-gray-800">{room.name}</div>
      </div>
      <div>
        <div className="text-xs font-semibold uppercase text-gray-500">Dimensions</div>
        <div className="text-sm text-gray-700">
          {l} × {w} × {h} {unit}
        </div>
      </div>
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <ClosedPadlockIcon />
        <span>Locked. Click the padlock in the room list to edit.</span>
      </div>
    </div>
  );
}
