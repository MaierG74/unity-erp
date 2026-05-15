import { useState } from 'react';
import type { BlockAnchor, AnchorAxisValue } from '../../types/room';

interface Props {
  initial: BlockAnchor;
  onSubmit: (anchor: BlockAnchor) => void;
  onCancel: () => void;
}

const AXES: Array<{ axis: 'x'|'y'|'z'; label: string; opts: Array<{ val: AnchorAxisValue; name: string }> }> = [
  { axis: 'x', label: 'X (length)', opts: [{ val: 'min', name: 'Left' }, { val: 'center', name: 'Center' }, { val: 'max', name: 'Right' }] },
  { axis: 'y', label: 'Y (depth)', opts: [{ val: 'min', name: 'Front' }, { val: 'center', name: 'Center' }, { val: 'max', name: 'Back' }] },
  { axis: 'z', label: 'Z (height)', opts: [{ val: 'min', name: 'Floor' }, { val: 'center', name: 'Center' }, { val: 'max', name: 'Top' }] },
];

export function SetAnchorDialog({ initial, onSubmit, onCancel }: Props) {
  const [anchor, setAnchor] = useState<BlockAnchor>(initial);
  return (
    <div className="rounded border bg-white p-4 shadow w-80">
      <h3 className="mb-2 text-sm font-semibold">Set anchor</h3>
      {AXES.map(({ axis, label, opts }) => (
        <div className="mb-2" key={axis}>
          <span className="mb-1 block text-xs">{label}</span>
          <div className="flex">
            {opts.map(({ val, name }) => (
              <button
                key={val}
                aria-pressed={anchor[axis] === val}
                className={`flex-1 border px-2 py-1 text-xs ${anchor[axis] === val ? 'bg-slate-700 text-white' : 'bg-white'}`}
                onClick={() => setAnchor((a) => ({ ...a, [axis]: val }))}
              >{name}</button>
            ))}
          </div>
        </div>
      ))}
      <div className="flex justify-end gap-2 mt-3">
        <button className="rounded px-3 py-1 text-xs" onClick={onCancel}>Cancel</button>
        <button className="rounded bg-slate-700 px-3 py-1 text-xs text-white" onClick={() => onSubmit(anchor)}>Apply</button>
      </div>
    </div>
  );
}
