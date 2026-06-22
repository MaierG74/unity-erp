import { useEffect, useState } from 'react';
import { useRoom } from '../../hooks/useRoom';
import { getActiveRoom } from '../../context/RoomContext';

const MIN_MM = 1000;

export function DimensionsForm() {
  const { state, dispatch } = useRoom();
  const room = getActiveRoom(state);
  const [length, setLength] = useState(room?.dimensions.length.toString() ?? '');
  const [width, setWidth] = useState(room?.dimensions.width.toString() ?? '');
  const [height, setHeight] = useState(room?.dimensions.height.toString() ?? '');
  const roomId = room?.id;
  const roomLength = room?.dimensions.length;
  const roomWidth = room?.dimensions.width;
  const roomHeight = room?.dimensions.height;

  useEffect(() => {
    if (roomLength !== undefined && roomWidth !== undefined && roomHeight !== undefined) {
      setLength(roomLength.toString());
      setWidth(roomWidth.toString());
      setHeight(roomHeight.toString());
    }
  }, [roomId, roomLength, roomWidth, roomHeight]);

  if (!room) return null;

  const l = parseFloat(length);
  const w = parseFloat(width);
  const h = parseFloat(height);
  const valid = l >= MIN_MM && w >= MIN_MM && h >= MIN_MM;

  function handleApply() {
    if (!valid) return;
    dispatch({
      type: 'SET_DIMENSIONS',
      payload: { dimensions: { length: l, width: w, height: h } },
    });
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">Dimensions</h2>
      <label className="block">
        <span className="text-xs font-medium text-muted-foreground">Length (mm)</span>
        <input
          type="number"
          value={length}
          onChange={(e) => setLength(e.target.value)}
          step="10"
          min={MIN_MM}
          className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted-foreground">Width (mm)</span>
        <input
          type="number"
          value={width}
          onChange={(e) => setWidth(e.target.value)}
          step="10"
          min={MIN_MM}
          className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted-foreground">Height (mm)</span>
        <input
          type="number"
          value={height}
          onChange={(e) => setHeight(e.target.value)}
          step="10"
          min={MIN_MM}
          className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        />
      </label>
      <button
        type="button"
        onClick={handleApply}
        disabled={!valid}
        className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        Apply
      </button>
    </div>
  );
}
