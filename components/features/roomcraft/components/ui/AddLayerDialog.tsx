import { useState } from 'react';

interface Props {
  mode: 'add' | 'edit';
  onSubmit: (init: { name: string; z: number }) => void;
  onCancel: () => void;
  initialName?: string;
  initialZ?: number;
}

export function AddLayerDialog({ mode, onSubmit, onCancel, initialName = '', initialZ = 0 }: Props) {
  const [name, setName] = useState(initialName);
  const [z, setZ] = useState(String(initialZ));
  const valid = name.trim().length > 0 && !Number.isNaN(Number(z));
  const isEditing = mode === 'edit';
  return (
    <div className="rounded border bg-background p-4 shadow text-foreground">
      <h3 className="mb-2 text-sm font-semibold">{isEditing ? 'Edit layer' : 'New layer'}</h3>
      <label className="mb-2 block text-xs">
        <span className="mb-1 block">Name</span>
        <input
          className="w-full rounded border bg-background text-foreground px-2 py-1 text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="mb-3 block text-xs">
        <span className="mb-1 block">Mount height (mm)</span>
        <input
          className="w-full rounded border bg-background text-foreground px-2 py-1 text-sm"
          inputMode="numeric"
          value={z}
          onChange={(e) => setZ(e.target.value)}
        />
      </label>
      <div className="flex justify-end gap-2">
        <button className="rounded px-3 py-1 text-xs text-foreground" onClick={onCancel}>Cancel</button>
        <button
          className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground disabled:opacity-50"
          disabled={!valid}
          onClick={() => onSubmit({ name: name.trim(), z: Number(z) })}
        >
          {isEditing ? 'Save' : 'Add'}
        </button>
      </div>
    </div>
  );
}
