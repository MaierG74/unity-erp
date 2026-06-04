import type { Layer } from '../../types/floorPlan';

interface Props {
  layers: Layer[];
  activeLayerId: string | null;
  onAdd: () => void;
  onAddBlock: () => void;
  onSelect: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onRemove: (id: string) => void;
  onEdit: (id: string) => void;
}

export function LayerPanel({
  layers,
  activeLayerId,
  onAdd,
  onAddBlock,
  onSelect,
  onToggleVisible,
  onRemove,
  onEdit,
}: Props) {
  const canRemove = layers.length > 1;

  return (
    <div className="rounded-md border bg-background p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-foreground">Layers</h3>
        <div className="flex gap-1">
          <button
            className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            onClick={onAddBlock}
          >
            + Add block
          </button>
          <button
            className="rounded-md border bg-background px-2 py-1 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={onAdd}
          >
            + New layer
          </button>
        </div>
      </div>
      <ul className="space-y-1">
        {layers.map((layer) => {
          const isActive = layer.id === activeLayerId;

          return (
            <li
              key={layer.id}
              className={`flex items-center gap-2 rounded-md px-2 py-1 text-xs ${
                isActive ? 'bg-accent text-accent-foreground' : 'text-foreground'
              }`}
            >
              <input
                type="checkbox"
                checked={layer.visible}
                onChange={() => onToggleVisible(layer.id)}
                aria-label={`toggle ${layer.name} visibility`}
              />
              <button className="flex-1 truncate text-left" onClick={() => onSelect(layer.id)}>
                {layer.name}
              </button>
              <span className="shrink-0 text-muted-foreground">{layer.z} mm</span>
              <button
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => onEdit(layer.id)}
                aria-label={`edit ${layer.name}`}
              >
                Edit
              </button>
              <button
                className="shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-30"
                onClick={() => onRemove(layer.id)}
                disabled={!canRemove}
                aria-label={`remove layer ${layer.name}`}
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
