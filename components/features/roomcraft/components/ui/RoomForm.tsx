import { useState } from 'react';
import { displayToMm } from '../../utils/units';
import { useRoom } from '../../hooks/useRoom';
import { UnitToggle } from './UnitToggle';

export function RoomForm() {
  const { state, dispatch } = useRoom();
  const unit = state.displayUnit;
  const [length, setLength] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');

  const placeholders = {
    mm: { length: '3400', width: '2800', height: '2500' },
    cm: { length: '340', width: '280', height: '250' },
    m: { length: '3.4', width: '2.8', height: '2.5' },
  };

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const l = length ? parseFloat(length) : parseFloat(placeholders[unit].length);
    const w = width ? parseFloat(width) : parseFloat(placeholders[unit].width);
    const h = height ? parseFloat(height) : parseFloat(placeholders[unit].height);

    if (isNaN(l) || isNaN(w) || isNaN(h) || l <= 0 || w <= 0 || h <= 0) return;

    dispatch({
      type: 'CREATE_ROOM',
      payload: {
        name: 'My Room',
        dimensions: {
          length: displayToMm(l, unit),
          width: displayToMm(w, unit),
          height: displayToMm(h, unit),
        },
      },
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Room Dimensions</h2>
        <UnitToggle
          value={unit}
          onChange={(u) => dispatch({ type: 'SET_DISPLAY_UNIT', payload: { unit: u } })}
        />
      </div>

      <div className="space-y-3">
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Length</span>
          <input
            type="number"
            value={length}
            onChange={(e) => setLength(e.target.value)}
            placeholder={placeholders[unit].length}
            step="any"
            min="0"
            className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Width</span>
          <input
            type="number"
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            placeholder={placeholders[unit].width}
            step="any"
            min="0"
            className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Height</span>
          <input
            type="number"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            placeholder={placeholders[unit].height}
            step="any"
            min="0"
            className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          />
        </label>
      </div>

      <button
        type="submit"
        className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Build Room
      </button>
    </form>
  );
}
