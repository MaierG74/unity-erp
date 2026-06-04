import { useMemo, useState } from 'react';
import { useRoom } from '../../hooks/useRoom';
import {
  getAvailableAxes,
  previewRoomShift,
  type ShiftAxis,
} from '../../utils/shiftRoom';
import { displayToMm } from '../../utils/units';

interface ShiftRoomFieldProps {
  roomId: string;
}

export function ShiftRoomField({ roomId }: ShiftRoomFieldProps) {
  const { state, dispatch } = useRoom();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const availableAxes = useMemo<ShiftAxis[]>(
    () => (state.floorPlan ? getAvailableAxes(state.floorPlan, roomId) : []),
    [state.floorPlan, roomId],
  );
  const [axis, setAxis] = useState<ShiftAxis>(availableAxes[0] ?? 'x');

  if (!state.floorPlan || availableAxes.length === 0) return null;
  const effectiveAxis: ShiftAxis = availableAxes.includes(axis)
    ? axis
    : availableAxes[0];

  function handleApply() {
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed)) return;
    const deltaMm = Math.round(displayToMm(parsed, state.displayUnit));
    if (deltaMm === 0 || !state.floorPlan) return;
    const preview = previewRoomShift(state.floorPlan, roomId, effectiveAxis, deltaMm);
    if (preview.blockingLockedRoomIds.length > 0) {
      const names = preview.blockingLockedRoomIds
        .map((id) => state.floorPlan!.rooms.find((p) => p.room.id === id)?.room.name ?? id)
        .join(', ');
      setError(`Can't shift — ${names} is locked.`);
      return;
    }
    if (preview.blockingOpenings.length > 0) {
      setError(
        `Shift blocked — ${preview.blockingOpenings.length} shared opening${
          preview.blockingOpenings.length === 1 ? '' : 's'
        } would be cut off.`,
      );
      return;
    }
    setError(null);
    dispatch({
      type: 'SHIFT_ROOM',
      payload: { roomId, axis: effectiveAxis, deltaMm },
    });
    setValue('');
  }

  const axisLabel = effectiveAxis === 'x' ? 'X' : 'Y';
  const inputId = `shift-nudge-${roomId}`;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">Shift Room</h2>
      {availableAxes.length > 1 && (
        <div className="flex gap-2" role="group" aria-label="Shift axis">
          {(['x', 'y'] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAxis(a)}
              className={`flex-1 rounded-lg border px-3 py-1 text-xs font-medium transition-colors ${
                effectiveAxis === a
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              {a.toUpperCase()}
            </button>
          ))}
        </div>
      )}
      <label className="block" htmlFor={inputId}>
        <span className="text-xs font-medium text-muted-foreground">
          Nudge along {axisLabel} ({state.displayUnit})
        </span>
        <input
          id={inputId}
          type="number"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          step="any"
          className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        />
      </label>
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
        >
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={handleApply}
        disabled={value === ''}
        className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        Apply
      </button>
    </div>
  );
}
