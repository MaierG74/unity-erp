import type { OpeningType } from '../../types/room';

interface OpeningButtonsProps {
  onAdd: (type: OpeningType) => void;
}

export function OpeningButtons({ onAdd }: OpeningButtonsProps) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-foreground">Openings</h2>
      <div className="flex gap-2">
        <button
          onClick={() => onAdd('door')}
          className="flex-1 rounded-md border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          + Door
        </button>
        <button
          onClick={() => onAdd('window')}
          className="flex-1 rounded-md border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          + Window
        </button>
        <button
          onClick={() => onAdd('archway')}
          className="flex-1 rounded-md border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          + Archway
        </button>
      </div>
    </div>
  );
}
