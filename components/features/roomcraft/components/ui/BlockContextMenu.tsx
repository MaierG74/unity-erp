import { useState } from 'react';
import type { Layer } from '../../types/floorPlan';
import type { WallSide } from '../../types/room';

interface Props {
  x: number;
  y: number;
  isGrouped: boolean;
  onDuplicate: () => void;
  onResize: () => void;
  onSetAnchor: () => void;
  onColor: () => void;
  onRotate: (direction: 'cw' | 'ccw') => void;
  onCenterOnWall: (side: WallSide) => void;
  onMoveToLayer: (layerId: string) => void;
  onUngroup: () => void;
  onDelete: () => void;
  onClose: () => void;
  layers: Layer[];
  currentLayerId: string;
}

const WALL_SIDES: Array<{ side: WallSide; label: string }> = [
  { side: 'north', label: 'North' },
  { side: 'south', label: 'South' },
  { side: 'east', label: 'East' },
  { side: 'west', label: 'West' },
];

const ITEM_CLASS =
  'w-full rounded px-3 py-1 text-left text-xs font-medium text-slate-900 hover:bg-slate-100 hover:text-slate-950 disabled:opacity-50';

export function BlockContextMenu({
  x,
  y,
  isGrouped,
  onDuplicate,
  onResize,
  onSetAnchor,
  onColor,
  onRotate,
  onCenterOnWall,
  onMoveToLayer,
  onUngroup,
  onDelete,
  onClose,
  layers,
  currentLayerId,
}: Props) {
  const [submenu, setSubmenu] = useState<'none' | 'wall' | 'layer'>('none');

  // Wraps a leaf callback: fires it then dismisses the menu.
  const handle = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <div
      role="menu"
      style={{ position: 'fixed', left: x, top: y, zIndex: 50 }}
      className="min-w-40 rounded border border-slate-200 bg-white py-1 text-xs text-slate-900 shadow"
    >
      {submenu === 'none' && (
        <>
          <button role="menuitem" className={ITEM_CLASS} onClick={handle(onDuplicate)}>
            Duplicate
          </button>
          <button role="menuitem" className={ITEM_CLASS} onClick={handle(onResize)}>
            Resize…
          </button>
          <button role="menuitem" className={ITEM_CLASS} onClick={handle(onSetAnchor)}>
            Set Anchor…
          </button>
          <button role="menuitem" className={ITEM_CLASS} onClick={handle(onColor)}>
            Color…
          </button>
          <button role="menuitem" className={ITEM_CLASS} onClick={handle(() => onRotate('cw'))}>
            Rotate 90° CW
          </button>
          <button role="menuitem" className={ITEM_CLASS} onClick={handle(() => onRotate('ccw'))}>
            Rotate 90° CCW
          </button>
          <button role="menuitem" className={ITEM_CLASS} onClick={() => setSubmenu('wall')}>
            Center on Wall ▸
          </button>
          <button role="menuitem" className={ITEM_CLASS} onClick={() => setSubmenu('layer')}>
            Move to Layer ▸
          </button>
          {isGrouped && (
            <button role="menuitem" className={ITEM_CLASS} onClick={handle(onUngroup)}>
              Ungroup
            </button>
          )}
          <button role="menuitem" className={ITEM_CLASS} onClick={handle(onDelete)}>
            Delete
          </button>
        </>
      )}

      {submenu === 'wall' && (
        <>
          <button role="menuitem" className={ITEM_CLASS} onClick={() => setSubmenu('none')}>
            ← Back
          </button>
          {WALL_SIDES.map(({ side, label }) => (
            <button
              key={side}
              role="menuitem"
              className={ITEM_CLASS}
              onClick={handle(() => onCenterOnWall(side))}
            >
              {label}
            </button>
          ))}
        </>
      )}

      {submenu === 'layer' && (
        <>
          <button role="menuitem" className={ITEM_CLASS} onClick={() => setSubmenu('none')}>
            ← Back
          </button>
          {layers
            .filter((l) => l.id !== currentLayerId)
            .map((l) => (
              <button
                key={l.id}
                role="menuitem"
                className={ITEM_CLASS}
                onClick={handle(() => onMoveToLayer(l.id))}
              >
                {l.name}
              </button>
            ))}
        </>
      )}
    </div>
  );
}
