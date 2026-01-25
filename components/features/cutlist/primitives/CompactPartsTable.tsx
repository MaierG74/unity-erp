'use client';

import * as React from 'react';
import { memo, useCallback, useRef, useState } from 'react';
import { Copy, MoreVertical, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { EdgeIndicator } from './EdgeIndicator';
import { EdgeBandingPopover, type EdgeBandingEdges, type EdgeBandingOption } from './EdgeBandingPopover';
import type { LaminationConfig } from './CustomLaminationModal';
import type { CutlistPart, BandEdges, LaminationType, CustomLaminationConfig, GrainOrientation } from '@/lib/cutlist/types';

// Re-export types for convenience
export type { LaminationType, GrainOrientation } from '@/lib/cutlist/types';

// =============================================================================
// Types
// =============================================================================

/**
 * Material option for the material selector dropdown.
 */
export interface MaterialOption {
  id: string;
  label: string;
  thickness?: number;
}

/**
 * Extended CutlistPart with lamination tracking.
 * Note: CutlistPart already includes lamination_type, lamination_config, and material_id,
 * but we extend it here to ensure LaminationConfig from the modal is compatible.
 */
export interface CompactPart extends Omit<CutlistPart, 'lamination_config'> {
  /** Custom lamination configuration (modal format) */
  lamination_config?: LaminationConfig;
}

export interface CompactPartsTableProps {
  /** Array of parts to display and edit */
  parts: CompactPart[];
  /** Callback when parts array changes */
  onPartsChange: (parts: CompactPart[]) => void;
  /** Available materials for the material selector */
  materialOptions: MaterialOption[];
  /** Callback to open the custom lamination modal */
  onOpenCustomLamination: (partId: string, initialConfig?: LaminationConfig) => void;
  /** Optional edging material options */
  edgingOptions?: EdgeBandingOption[];
  /** Optional className for the container */
  className?: string;
}

// =============================================================================
// Constants
// =============================================================================

const LAMINATION_OPTIONS: { value: LaminationType; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'with-backer', label: 'With Backer' },
  { value: 'same-board', label: 'Same Board' },
  { value: 'custom', label: 'Custom...' },
];

/** Grain direction options with display icons and tooltips */
const GRAIN_OPTIONS: { value: GrainOrientation; icon: string; label: string }[] = [
  { value: 'any', icon: '○', label: 'Any direction (solid color)' },
  { value: 'length', icon: '↕', label: 'Grain along Length' },
  { value: 'width', icon: '↔', label: 'Grain along Width' },
];

/** Cycle to next grain orientation */
function nextGrainOrientation(current: GrainOrientation): GrainOrientation {
  const order: GrainOrientation[] = ['any', 'length', 'width'];
  const currentIndex = order.indexOf(current);
  return order[(currentIndex + 1) % order.length];
}

/** Get grain option by value */
function getGrainOption(value: GrainOrientation) {
  return GRAIN_OPTIONS.find((o) => o.value === value) || GRAIN_OPTIONS[0];
}

const DEFAULT_BAND_EDGES: Required<BandEdges> = {
  top: false,
  right: false,
  bottom: false,
  left: false,
};

// =============================================================================
// Helper Functions
// =============================================================================

function generatePartId(): string {
  return crypto.randomUUID();
}

function createEmptyPart(materialId?: string): CompactPart {
  return {
    id: generatePartId(),
    name: '',
    length_mm: 0,
    width_mm: 0,
    quantity: 1,
    grain: 'any',
    band_edges: { ...DEFAULT_BAND_EDGES },
    material_id: materialId,
    lamination_type: 'none',
  };
}

function isPartEmpty(part: CompactPart): boolean {
  return (
    !part.name &&
    part.length_mm === 0 &&
    part.width_mm === 0 &&
    part.quantity === 1
  );
}

// =============================================================================
// Compact Input Component
// =============================================================================

interface CompactInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string | number;
  onChange: (value: string) => void;
  type?: 'text' | 'number';
  selectOnFocus?: boolean;
}

const CompactInput = React.forwardRef<HTMLInputElement, CompactInputProps>(
  function CompactInput(
    {
      value,
      onChange,
      type = 'text',
      selectOnFocus = true,
      className,
      ...props
    },
    ref
  ) {
    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        onChange(e.target.value);
      },
      [onChange]
    );

    const handleFocus = useCallback(
      (e: React.FocusEvent<HTMLInputElement>) => {
        if (selectOnFocus) {
          e.target.select();
        }
      },
      [selectOnFocus]
    );

    return (
      <Input
        ref={ref}
        type={type}
        value={value}
        onChange={handleChange}
        onFocus={handleFocus}
        className={cn(
          'h-8 w-full px-2 text-sm',
          'border-transparent bg-transparent',
          'focus:border-input focus:bg-background',
          'transition-colors',
          type === 'number' && 'tabular-nums text-right',
          className
        )}
        {...props}
      />
    );
  }
);

// =============================================================================
// Compact Select Component
// =============================================================================

interface CompactSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
}

const CompactSelect = memo(function CompactSelect({
  value,
  onValueChange,
  options,
  placeholder,
  className,
}: CompactSelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        className={cn(
          'h-8 w-full px-2 text-sm',
          'border-transparent bg-transparent',
          'focus:border-input focus:bg-background',
          'transition-colors',
          className
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value} className="text-sm">
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
});

// =============================================================================
// Part Row Component
// =============================================================================

interface PartRowProps {
  part: CompactPart;
  index: number;
  materialOptions: MaterialOption[];
  edgingOptions?: EdgeBandingOption[];
  isQuickAdd?: boolean;
  onUpdate: (index: number, updates: Partial<CompactPart>) => void;
  onDelete: (index: number) => void;
  onDuplicate: (index: number) => void;
  onOpenCustomLamination: (partId: string, initialConfig?: LaminationConfig) => void;
  onQuickAddActivate?: () => void;
}

const PartRow = memo(function PartRow({
  part,
  index,
  materialOptions,
  edgingOptions,
  isQuickAdd = false,
  onUpdate,
  onDelete,
  onDuplicate,
  onOpenCustomLamination,
  onQuickAddActivate,
}: PartRowProps) {
  const [edgePopoverOpen, setEdgePopoverOpen] = useState(false);
  const [grainTooltipOpen, setGrainTooltipOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Material options for select
  const materialSelectOptions = materialOptions.map((m) => ({
    value: m.id,
    label: m.label,
  }));

  // Handle field changes
  const handleNameChange = useCallback(
    (value: string) => {
      onUpdate(index, { name: value });
    },
    [index, onUpdate]
  );

  const handleLengthChange = useCallback(
    (value: string) => {
      const numValue = Number(value) || 0;
      onUpdate(index, { length_mm: numValue });
    },
    [index, onUpdate]
  );

  const handleWidthChange = useCallback(
    (value: string) => {
      const numValue = Number(value) || 0;
      onUpdate(index, { width_mm: numValue });
    },
    [index, onUpdate]
  );

  const handleQuantityChange = useCallback(
    (value: string) => {
      const numValue = Math.max(1, Number(value) || 1);
      onUpdate(index, { quantity: numValue });
    },
    [index, onUpdate]
  );

  const handleMaterialChange = useCallback(
    (value: string) => {
      onUpdate(index, { material_id: value });
    },
    [index, onUpdate]
  );

  const handleLaminationChange = useCallback(
    (value: string) => {
      const laminationType = value as LaminationType;
      if (laminationType === 'custom') {
        onOpenCustomLamination(part.id, part.lamination_config);
      } else {
        onUpdate(index, {
          lamination_type: laminationType,
          lamination_config: undefined,
        });
      }
    },
    [index, onOpenCustomLamination, onUpdate, part.id, part.lamination_config]
  );

  const handleEdgesChange = useCallback(
    (edges: EdgeBandingEdges) => {
      onUpdate(index, {
        band_edges: edges as Required<BandEdges>,
      });
    },
    [index, onUpdate]
  );

  const handleGrainToggle = useCallback(() => {
    const newGrain = nextGrainOrientation(part.grain || 'any');
    onUpdate(index, { grain: newGrain });
  }, [index, onUpdate, part.grain]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        // If quick-add row, activate it first (convert to real part)
        if (isQuickAdd && onQuickAddActivate) {
          onQuickAddActivate();
        }
        // Move to next row on Enter
        const nextRow = document.querySelector<HTMLInputElement>(
          `[data-row-index="${index + 1}"] input:first-of-type`
        );
        nextRow?.focus();
      }
    },
    [index, isQuickAdd, onQuickAddActivate]
  );

  // Get lamination display value
  const laminationValue = part.lamination_config
    ? 'custom'
    : part.lamination_type || 'none';

  const laminationDisplayLabel = part.lamination_config
    ? `${part.lamination_config.finalThickness}mm`
    : undefined;

  return (
    <TableRow
      data-row-index={index}
      className={cn(
        'h-10',
        isQuickAdd && 'bg-muted/30 hover:bg-muted/50'
      )}
      onKeyDown={handleKeyDown}
    >
      {/* ID / Name */}
      <TableCell className="p-1">
        <CompactInput
          ref={inputRef}
          value={part.name}
          onChange={handleNameChange}
          placeholder={isQuickAdd ? 'Add part...' : 'ID'}
          className="min-w-[80px]"
        />
      </TableCell>

      {/* Material */}
      <TableCell className="p-1">
        <CompactSelect
          value={part.material_id || ''}
          onValueChange={handleMaterialChange}
          options={materialSelectOptions}
          placeholder="Material"
          className="min-w-[100px]"
        />
      </TableCell>

      {/* Length */}
      <TableCell className="p-1">
        <CompactInput
          type="number"
          value={part.length_mm || ''}
          onChange={handleLengthChange}
          placeholder="L"
          min={0}
          className="w-16"
        />
      </TableCell>

      {/* Width */}
      <TableCell className="p-1">
        <CompactInput
          type="number"
          value={part.width_mm || ''}
          onChange={handleWidthChange}
          placeholder="W"
          min={0}
          className="w-16"
        />
      </TableCell>

      {/* Quantity */}
      <TableCell className="p-1">
        <CompactInput
          type="number"
          value={part.quantity}
          onChange={handleQuantityChange}
          min={1}
          className="w-12"
        />
      </TableCell>

      {/* Grain Direction */}
      <TableCell className="p-1">
        <TooltipProvider delayDuration={100}>
          <Tooltip open={grainTooltipOpen}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleGrainToggle}
                onMouseEnter={() => setGrainTooltipOpen(true)}
                onMouseLeave={() => setGrainTooltipOpen(false)}
                className={cn(
                  'flex items-center justify-center',
                  'h-8 w-8 rounded-md',
                  'border-transparent bg-transparent',
                  'hover:bg-muted/50',
                  'transition-colors',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
                  'text-base font-medium',
                  part.grain === 'any' && 'text-muted-foreground',
                  part.grain === 'length' && 'text-primary',
                  part.grain === 'width' && 'text-primary'
                )}
                aria-label={getGrainOption(part.grain || 'any').label}
              >
                {getGrainOption(part.grain || 'any').icon}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {getGrainOption(part.grain || 'any').label}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </TableCell>

      {/* Lamination */}
      <TableCell className="p-1">
        <CompactSelect
          value={laminationValue}
          onValueChange={handleLaminationChange}
          options={
            laminationDisplayLabel
              ? [
                  ...LAMINATION_OPTIONS.filter((o) => o.value !== 'custom'),
                  { value: 'custom', label: laminationDisplayLabel },
                ]
              : LAMINATION_OPTIONS
          }
          className="min-w-[90px]"
        />
      </TableCell>

      {/* Edge Banding */}
      <TableCell className="p-1">
        <EdgeBandingPopover
          length={part.length_mm || 0}
          width={part.width_mm || 0}
          edges={part.band_edges}
          onEdgesChange={handleEdgesChange}
          edgingOptions={edgingOptions}
          open={edgePopoverOpen}
          onOpenChange={setEdgePopoverOpen}
          trigger={
            <button
              type="button"
              className={cn(
                'flex items-center justify-center',
                'h-8 w-8 rounded-md',
                'border-transparent bg-transparent',
                'hover:bg-muted/50',
                'transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1'
              )}
            >
              <EdgeIndicator
                edges={part.band_edges}
                size="sm"
              />
            </button>
          }
        />
      </TableCell>

      {/* Actions */}
      <TableCell className="p-1 w-10">
        {!isQuickAdd && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
              >
                <MoreVertical className="h-4 w-4" />
                <span className="sr-only">Actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onDuplicate(index)}>
                <Copy className="mr-2 h-4 w-4" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onDelete(index)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TableCell>
    </TableRow>
  );
});

// =============================================================================
// Main Component
// =============================================================================

/**
 * CompactPartsTable - Compact table for cutlist part entry.
 *
 * Displays parts in a compact table format (~40px per row) with columns for:
 * - ID (part name/designation)
 * - Material (dropdown)
 * - L (length in mm)
 * - W (width in mm)
 * - Qty (quantity)
 * - Grain (toggle: ○ any, ↕ length, ↔ width)
 * - Lam (lamination type dropdown)
 * - Edge (clickable EdgeIndicator with popover)
 * - Actions menu (delete, duplicate)
 *
 * Features:
 * - Quick-add row at the bottom for fast part entry
 * - Keyboard navigation (Tab through inputs, Enter to move to next row)
 * - Compact inputs with border-on-focus styling
 * - Per-part grain direction toggle
 * - Dark theme compatible
 *
 * Note: Consider virtualization for large part lists (100+ parts)
 */
export const CompactPartsTable = memo(function CompactPartsTable({
  parts,
  onPartsChange,
  materialOptions,
  onOpenCustomLamination,
  edgingOptions,
  className,
}: CompactPartsTableProps) {
  // Quick-add state
  const [quickAddPart, setQuickAddPart] = useState<CompactPart>(() =>
    createEmptyPart(materialOptions[0]?.id)
  );

  // Update handler
  const handleUpdate = useCallback(
    (index: number, updates: Partial<CompactPart>) => {
      const newParts = [...parts];
      newParts[index] = { ...newParts[index], ...updates };
      onPartsChange(newParts);
    },
    [parts, onPartsChange]
  );

  // Delete handler
  const handleDelete = useCallback(
    (index: number) => {
      const newParts = parts.filter((_, i) => i !== index);
      onPartsChange(newParts);
    },
    [parts, onPartsChange]
  );

  // Duplicate handler
  const handleDuplicate = useCallback(
    (index: number) => {
      const partToDuplicate = parts[index];
      const duplicatedPart: CompactPart = {
        ...partToDuplicate,
        id: generatePartId(),
        name: `${partToDuplicate.name} (copy)`,
      };
      const newParts = [
        ...parts.slice(0, index + 1),
        duplicatedPart,
        ...parts.slice(index + 1),
      ];
      onPartsChange(newParts);
    },
    [parts, onPartsChange]
  );

  // Quick-add update handler
  const handleQuickAddUpdate = useCallback(
    (_index: number, updates: Partial<CompactPart>) => {
      setQuickAddPart((prev) => ({ ...prev, ...updates }));
    },
    []
  );

  // Activate quick-add (convert to real part)
  const handleQuickAddActivate = useCallback(() => {
    if (!isPartEmpty(quickAddPart)) {
      // Add the quick-add part to the list
      const newPart: CompactPart = {
        ...quickAddPart,
        id: generatePartId(),
      };
      onPartsChange([...parts, newPart]);

      // Reset quick-add
      setQuickAddPart(createEmptyPart(materialOptions[0]?.id));
    }
  }, [quickAddPart, parts, onPartsChange, materialOptions]);

  return (
    <div className={cn('rounded-md border', className)}>
      <Table>
        <TableHeader>
          <TableRow className="h-10">
            <TableHead className="px-2 py-1 font-medium text-xs">ID</TableHead>
            <TableHead className="px-2 py-1 font-medium text-xs">Material</TableHead>
            <TableHead className="px-2 py-1 font-medium text-xs w-16">L</TableHead>
            <TableHead className="px-2 py-1 font-medium text-xs w-16">W</TableHead>
            <TableHead className="px-2 py-1 font-medium text-xs w-12">Qty</TableHead>
            <TableHead className="px-2 py-1 font-medium text-xs w-10" title="Grain Direction">Grain</TableHead>
            <TableHead className="px-2 py-1 font-medium text-xs">Lam</TableHead>
            <TableHead className="px-2 py-1 font-medium text-xs w-10">Edge</TableHead>
            <TableHead className="px-2 py-1 w-10"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* Existing parts */}
          {parts.map((part, index) => (
            <PartRow
              key={part.id}
              part={part}
              index={index}
              materialOptions={materialOptions}
              edgingOptions={edgingOptions}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
              onOpenCustomLamination={onOpenCustomLamination}
            />
          ))}

          {/* Quick-add row */}
          <PartRow
            part={quickAddPart}
            index={parts.length}
            materialOptions={materialOptions}
            edgingOptions={edgingOptions}
            isQuickAdd
            onUpdate={handleQuickAddUpdate}
            onDelete={() => {}}
            onDuplicate={() => {}}
            onOpenCustomLamination={onOpenCustomLamination}
            onQuickAddActivate={handleQuickAddActivate}
          />
        </TableBody>
      </Table>
    </div>
  );
});

export default CompactPartsTable;
