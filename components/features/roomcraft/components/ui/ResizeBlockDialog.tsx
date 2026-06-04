import { useState } from 'react';

interface Props {
  initial: { length: number; depth: number; height: number };
  onSubmit: (next: { length: number; depth: number; height: number }) => void;
  onCancel: () => void;
}

export function ResizeBlockDialog({ initial, onSubmit, onCancel }: Props) {
  const [length, setLength] = useState(String(initial.length));
  const [depth, setDepth] = useState(String(initial.depth));
  const [height, setHeight] = useState(String(initial.height));
  const valid = !Number.isNaN(Number(length)) && !Number.isNaN(Number(depth)) && !Number.isNaN(Number(height));
  return (
    <div className="rounded border bg-white p-4 shadow w-64">
      <h3 className="mb-2 text-sm font-semibold">Resize</h3>
      {[
        { id: 'length', label: 'Length (mm)', val: length, set: setLength },
        { id: 'depth', label: 'Depth (mm)', val: depth, set: setDepth },
        { id: 'height', label: 'Height (mm)', val: height, set: setHeight },
      ].map(({ id, label, val, set }) => (
        <label className="mb-2 block text-xs" key={id} htmlFor={id}>
          <span className="mb-1 block">{label}</span>
          <input id={id} className="w-full rounded border px-2 py-1 text-sm" inputMode="numeric" value={val} onChange={(e) => set(e.target.value)} />
        </label>
      ))}
      <div className="flex justify-end gap-2">
        <button className="rounded px-3 py-1 text-xs" onClick={onCancel}>Cancel</button>
        <button
          className="rounded bg-slate-700 px-3 py-1 text-xs text-white disabled:opacity-50"
          disabled={!valid}
          onClick={() => onSubmit({ length: Number(length), depth: Number(depth), height: Number(height) })}
        >Apply</button>
      </div>
    </div>
  );
}
