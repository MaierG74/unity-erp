import type { Room } from '../../types/room';
import { useRoom } from '../../hooks/useRoom';
import { roomHasAttachments, shareSharedOpeningWithLocked } from '../../utils/floorPlan';

interface RoomListProps {
  onAddClick: () => void;
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 4h11" />
      <path d="M6 4V2.5h4V4" />
      <path d="M4 4l.75 9.25a1 1 0 0 0 1 .75h4.5a1 1 0 0 0 1-.75L12 4" />
      <path d="M6.5 7v4.5" />
      <path d="M9.5 7v4.5" />
    </svg>
  );
}

function OpenPadlockIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="8" width="10" height="6" rx="1" />
      <path d="M5 8V5.5a3 3 0 0 1 5.9-0.5" />
    </svg>
  );
}

function ClosedPadlockIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="8" width="10" height="6" rx="1" />
      <path d="M5 8V5.5a3 3 0 0 1 6 0V8" fill="none" />
    </svg>
  );
}

export function RoomList({ onAddClick }: RoomListProps) {
  const { state, dispatch } = useRoom();
  if (!state.floorPlan) return null;

  const handleDelete = (e: React.MouseEvent, room: Room) => {
    e.stopPropagation();
    if (!state.floorPlan) return;
    if (shareSharedOpeningWithLocked(state.floorPlan, room.id)) {
      window.alert(`Can't delete "${room.name}" — shares an opening with a locked room. Unlock the neighbor first.`);
      return;
    }
    const attached = roomHasAttachments(state.floorPlan, room.id);
    if (attached && !window.confirm(`Delete "${room.name}" and its openings?`)) return;
    dispatch({ type: 'REMOVE_ROOM_FROM_FLOOR_PLAN', payload: { id: room.id } });
  };

  const handleToggleLock = (e: React.MouseEvent, roomId: string) => {
    e.stopPropagation();
    dispatch({ type: 'TOGGLE_ROOM_LOCK', payload: { id: roomId } });
  };

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-foreground">Rooms</h2>
      <ul className="space-y-1">
        {state.floorPlan.rooms.map((placed) => {
          const { room } = placed;
          const isActive = room.id === state.activeRoomId;
          const locked = placed.locked;
          return (
            <li key={room.id} className="flex items-stretch gap-1">
              <button
                onClick={() => dispatch({ type: 'SET_ACTIVE_ROOM', payload: { id: room.id } })}
                className={`flex-1 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-muted/60 text-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
              >
                {room.name}
              </button>
              <button
                onClick={(e) => handleToggleLock(e, room.id)}
                aria-label={`${locked ? 'Unlock' : 'Lock'} ${room.name}`}
                className="flex items-center rounded-lg bg-muted/60 px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {locked ? <ClosedPadlockIcon /> : <OpenPadlockIcon />}
              </button>
              <button
                onClick={(e) => handleDelete(e, room)}
                aria-label={`Delete ${room.name}`}
                disabled={locked}
                className={`flex items-center rounded-lg bg-muted/60 px-2 transition-colors ${
                  locked
                    ? 'cursor-not-allowed text-muted-foreground/40'
                    : 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
                }`}
              >
                <TrashIcon />
              </button>
            </li>
          );
        })}
      </ul>
      <button
        onClick={onAddClick}
        className="w-full rounded-lg border border-dashed px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-accent hover:text-accent-foreground"
      >
        + Add Room
      </button>
    </div>
  );
}
