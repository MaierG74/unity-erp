interface CanvasOverlayProps {
  onFitToView: () => void;
  showIsometric: boolean;
  rooms: Array<{ id: string; name: string }>;
  activeRoomId: string | null;
  onSelectRoom: (id: string) => void;
}

export function CanvasOverlay({
  onFitToView,
  showIsometric,
  rooms,
  activeRoomId,
  onSelectRoom,
}: CanvasOverlayProps) {
  return (
    <>
      {showIsometric && rooms.length > 1 && (
        <div
          className="absolute left-3 top-3 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-2 rounded-md border bg-background/95 p-2 shadow-sm"
          onClick={(event) => event.stopPropagation()}
        >
          {rooms.map((room) => {
            const active = room.id === activeRoomId;

            return (
              <button
                key={room.id}
                type="button"
                onClick={() => onSelectRoom(room.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
              >
                {room.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="absolute bottom-3 right-3 flex gap-2">
        {!showIsometric && (
          <button
            onClick={onFitToView}
            className="rounded-md border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            title="Fit room to view"
          >
            Fit to View
          </button>
        )}
      </div>
    </>
  );
}
