import type { DisplayUnit } from '../../types/room';

interface UnitToggleProps {
  value: DisplayUnit;
  onChange: (unit: DisplayUnit) => void;
}

const UNITS: DisplayUnit[] = ['mm', 'cm', 'm'];

export function UnitToggle({ value, onChange }: UnitToggleProps) {
  return (
    <div className="flex rounded-md border bg-background text-sm">
      {UNITS.map((unit) => (
        <button
          key={unit}
          onClick={() => onChange(unit)}
          className={`px-3 py-1.5 font-medium transition-colors ${
            value === unit
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          } ${unit === 'mm' ? 'rounded-l-md' : ''} ${unit === 'm' ? 'rounded-r-md' : ''}`}
        >
          {unit}
        </button>
      ))}
    </div>
  );
}
