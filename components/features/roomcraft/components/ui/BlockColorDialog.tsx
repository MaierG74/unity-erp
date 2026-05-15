import { useState } from 'react';

const PALETTE = ['#bcd9c3', '#d9b86c', '#a8b8d9', '#d9a8b8', '#b8d9c0', '#d9c3a8', '#c0a8d9', '#d9d0a8'];

interface Props {
  initial: string;
  onSubmit: (color: string) => void;
  onCancel: () => void;
}

export function BlockColorDialog({ initial, onSubmit, onCancel }: Props) {
  const [color, setColor] = useState(initial);
  const valid = /^#[0-9a-fA-F]{6}$/.test(color);
  return (
    <div className="rounded border bg-white p-4 shadow w-72">
      <h3 className="mb-2 text-sm font-semibold">Color</h3>
      <div className="mb-2 flex flex-wrap gap-1">
        {PALETTE.map((c) => (
          <button
            key={c}
            aria-label={`swatch ${c}`}
            className={`h-8 w-8 rounded border ${color === c ? 'ring-2 ring-slate-700' : ''}`}
            style={{ background: c }}
            onClick={() => setColor(c)}
          />
        ))}
      </div>
      <label className="mb-3 block text-xs">
        <span className="mb-1 block">Custom hex</span>
        <input className="w-full rounded border px-2 py-1 text-sm" value={color} onChange={(e) => setColor(e.target.value)} />
      </label>
      <div className="flex justify-end gap-2">
        <button className="rounded px-3 py-1 text-xs" onClick={onCancel}>Cancel</button>
        <button
          className="rounded bg-slate-700 px-3 py-1 text-xs text-white disabled:opacity-50"
          disabled={!valid}
          onClick={() => onSubmit(color)}
        >Apply</button>
      </div>
    </div>
  );
}
