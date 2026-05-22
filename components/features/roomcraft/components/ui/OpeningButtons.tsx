import type { OpeningType } from '../../types/room';

interface OpeningButtonsProps {
  onAdd: (type: OpeningType) => void;
}

export function OpeningButtons({ onAdd }: OpeningButtonsProps) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-foreground">Openings</h2>
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => onAdd('door')}
          className="min-w-0 truncate rounded-md border bg-background px-2 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          + Door
        </button>
        <button
          onClick={() => onAdd('window')}
          className="min-w-0 truncate rounded-md border bg-background px-2 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          + Window
        </button>
        <button
          onClick={() => onAdd('archway')}
          className="min-w-0 truncate rounded-md border bg-background px-2 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          + Archway
        </button>
      </div>
    </div>
  );
}
