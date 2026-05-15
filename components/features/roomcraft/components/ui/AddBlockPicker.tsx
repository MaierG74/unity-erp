import type { Layer } from '../../types/floorPlan';
import type { PlacementValues } from '../../hooks/useBlockPlacement';

interface Props {
  layers: Layer[];
  mode: 'picking' | 'placing';
  values: PlacementValues;
  onChange: (partial: Partial<PlacementValues>) => void;
  onStartPlacing: () => void;
  onCancel: () => void;
}

export function AddBlockPicker({ layers, mode, values, onChange, onStartPlacing, onCancel }: Props) {
  const placing = mode === 'placing';
  const numericValid =
    Number.isFinite(values.length) && Number.isFinite(values.depth) && Number.isFinite(values.height) &&
    values.length > 0 && values.depth > 0 && values.height > 0;
  const startEnabled = !placing && numericValid && values.layerId !== '';

  const num = (raw: string): number => {
    const n = Number(raw);
    return raw === '' || Number.isNaN(n) ? NaN : n;
  };

  return (
    <div className="w-full rounded-md border bg-background p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Add block</h3>
        <button type="button" className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={onCancel}>Cancel</button>
      </div>
      <label className="mb-2 block text-xs text-muted-foreground">
        <span className="mb-1 block">Name</span>
        <input
          aria-label="Name"
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-70"
          type="text"
          placeholder="e.g. Oven, 3 Drawer"
          disabled={placing}
          value={values.label}
          onChange={(e) => onChange({ label: e.target.value })}
        />
      </label>
      <label className="mb-2 block text-xs text-muted-foreground">
        <span className="mb-1 block">Layer</span>
        <select
          aria-label="Layer"
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-70"
          disabled={placing}
          value={values.layerId}
          onChange={(e) => onChange({ layerId: e.target.value })}
        >
          {layers.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.z} mm)</option>)}
        </select>
      </label>
      {[
        { label: 'Length (mm)', key: 'length' as const },
        { label: 'Depth (mm)', key: 'depth' as const },
        { label: 'Height (mm)', key: 'height' as const },
      ].map(({ label, key }) => (
        <label className="mb-2 block text-xs text-muted-foreground" key={key}>
          <span className="mb-1 block">{label}</span>
          <input
            aria-label={label.split(' ')[0]}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-70"
            inputMode="numeric"
            disabled={placing}
            value={Number.isFinite(values[key]) ? String(values[key]) : ''}
            onChange={(e) => onChange({ [key]: num(e.target.value) } as Partial<PlacementValues>)}
          />
        </label>
      ))}
      {placing ? (
        <p role="status" className="mt-3 text-xs italic text-muted-foreground">
          Click on canvas to place — Esc to cancel
        </p>
      ) : (
        <button
          type="button"
          className="mt-2 w-full rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          disabled={!startEnabled}
          onClick={onStartPlacing}
        >
          Start Placing
        </button>
      )}
    </div>
  );
}
