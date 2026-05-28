import { useState, useEffect } from 'react';
import type { Opening } from '../../types/room';
import type { AnchorEdge } from '../../types/floorPlan';
import { displayToMm } from '../../utils/units';
import { useRoom } from '../../hooks/useRoom';
import { UnitToggle } from './UnitToggle';
import { previewRoomAddition } from '../../utils/floorPlan';

interface AddRoomFormProps {
  onCancel: () => void;
  onAdded: () => void;
}

const EDGES: { value: AnchorEdge; label: string }[] = [
  { value: 'north', label: 'North of' },
  { value: 'south', label: 'South of' },
  { value: 'east', label: 'East of' },
  { value: 'west', label: 'West of' },
];

export function AddRoomForm({ onCancel, onAdded }: AddRoomFormProps) {
  const { state, dispatch } = useRoom();
  const unit = state.displayUnit;
  const [name, setName] = useState('New Room');
  const [length, setLength] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [anchorRoomId, setAnchorRoomId] = useState<string>(state.activeRoomId ?? '');
  const [edge, setEdge] = useState<AnchorEdge>('east');
  const [blocking, setBlocking] = useState<Opening[]>([]);

  useEffect(() => {
    if (!anchorRoomId && state.activeRoomId) {
      setAnchorRoomId(state.activeRoomId);
    }
  }, [state.activeRoomId, anchorRoomId]);

  const placeholders = {
    mm: { length: '3000', width: '2500', height: '2500' },
    cm: { length: '300', width: '250', height: '250' },
    m: { length: '3.0', width: '2.5', height: '2.5' },
  };

  if (!state.floorPlan || state.floorPlan.rooms.length === 0) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!anchorRoomId || !state.floorPlan) return;
    const l = length ? parseFloat(length) : parseFloat(placeholders[unit].length);
    const w = width ? parseFloat(width) : parseFloat(placeholders[unit].width);
    const h = height ? parseFloat(height) : parseFloat(placeholders[unit].height);
    if (isNaN(l) || isNaN(w) || isNaN(h) || l <= 0 || w <= 0 || h <= 0) return;

    const dimensions = {
      length: displayToMm(l, unit),
      width: displayToMm(w, unit),
      height: displayToMm(h, unit),
    };

    const preview = previewRoomAddition(state.floorPlan, anchorRoomId, edge, dimensions);
    if (!preview.ok) {
      setBlocking(preview.blockingOpenings);
      return;
    }
    setBlocking([]);

    dispatch({
      type: 'ADD_ROOM_TO_FLOOR_PLAN',
      payload: {
        name: name.trim() || 'Room',
        dimensions,
        anchorRoomId,
        edge,
      },
    });
    onAdded();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Add Room</h2>
        <UnitToggle value={unit} onChange={(u) => dispatch({ type: 'SET_DISPLAY_UNIT', payload: { unit: u } })} />
      </div>

      <label className="block">
        <span className="text-xs font-medium text-gray-500">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium text-gray-500">Anchor to</span>
        <select
          value={anchorRoomId}
          onChange={(e) => setAnchorRoomId(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
        >
          {state.floorPlan.rooms.map(({ room }) => (
            <option key={room.id} value={room.id}>
              {room.name}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="space-y-1">
        <legend className="text-xs font-medium text-gray-500">Edge</legend>
        <div className="grid grid-cols-2 gap-2">
          {EDGES.map((e) => (
            <label key={e.value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="edge"
                value={e.value}
                checked={edge === e.value}
                onChange={() => setEdge(e.value)}
              />
              {e.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-3">
        <label className="block">
          <span className="text-xs font-medium text-gray-500">Length</span>
          <input
            type="number"
            value={length}
            onChange={(e) => setLength(e.target.value)}
            placeholder={placeholders[unit].length}
            step="any"
            min="0"
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-gray-500">Width</span>
          <input
            type="number"
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            placeholder={placeholders[unit].width}
            step="any"
            min="0"
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-gray-500">Height</span>
          <input
            type="number"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            placeholder={placeholders[unit].height}
            step="any"
            min="0"
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
          />
        </label>
      </div>

      {blocking.length > 0 && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          Can't add this room — {blocking.length} opening
          {blocking.length === 1 ? '' : 's'} on the anchor's {edge} wall would be split
          by the new room boundary. Move or resize them first.
          <ul className="mt-2 list-disc pl-4">
            {blocking.map((o) => (
              <li key={o.id}>
                {o.type} at {o.position} mm, width {o.width} mm
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          className="flex-1 rounded-lg bg-gray-800 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-700"
        >
          Add
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

