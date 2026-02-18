'use client';

import * as React from 'react';
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Copy, MoreVertical, Plus, Trash2 } from 'lucide-react';
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
  /** Callback when quick-add row has pending data (true) or is empty (false) */
  onQuickAddPending?: (hasPending: boolean) => void;
}

/** Ref handle for CompactPartsTable */
export interface CompactPartsTableRef {
  /** Activate the quick-add row (converts pending data to a real part) */
  activateQuickAdd: () => void;
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

// =============================================================================
// Lamination Group Helpers
// =============================================================================

const GROUP_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** Get next available group letter */
function getNextGroupLetter(parts: CompactPart[]): string {
  const used = new Set(parts.map((p) => p.lamination_group).filter(Boolean));
  return GROUP_LETTERS.find((l) => !used.has(l)) || `G${used.size + 1}`;
}

/** Get group options for dropdown */
function getGroupOptions(parts: CompactPart[]): { value: string; label: string }[] {
  const used = new Set(parts.map((p) => p.lamination_group).filter(Boolean));
  const options: { value: string; label: string }[] = [{ value: '__none__', label: 'None' }];
  Array.from(used)
    .sort()
    .forEach((g) => options.push({ value: g as string, label: g as string }));
  const next = getNextGroupLetter(parts);
  options.push({ value: `__new__${next}`, label: `+ New (${next})` });
  return options;
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
    grain: 'length',
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
  // Stop Enter key from bubbling to parent row (which would create new row)
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.stopPropagation();
    }
  }, []);

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
        onKeyDown={handleKeyDown}
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
  allParts: CompactPart[];
  onUpdate: (index: number, updates: Partial<CompactPart>) => void;
  onDelete: (index: number) => void;
  onDuplicate: (index: number) => void;
  onApplyMaterialToAll: (index: number) => void;
  onApplyEdgingToAll: (index: number) => void;
  onOpenCustomLamination: (partId: string, initialConfig?: LaminationConfig) => void;
  onQuickAddActivate?: () => void;
}

const PartRow = memo(function PartRow({
  part,
  index,
  materialOptions,
  edgingOptions,
  isQuickAdd = false,
  allParts,
  onUpdate,
  onDelete,
  onDuplicate,
  onApplyMaterialToAll,
  onApplyEdgingToAll,
  onOpenCustomLamination,
  onQuickAddActivate,
}: PartRowProps) {
  const [edgePopoverOpen, setEdgePopoverOpen] = useState(false);
  const [grainTooltipOpen, setGrainTooltipOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLTableRowElement>(null);

  // Auto-add when focus leaves the quick-add row (if it has data)
  const handleRowBlur = useCallback(
    (e: React.FocusEvent) => {
      if (!isQuickAdd || !onQuickAddActivate) return;

      // Use setTimeout to allow focus to settle on the new element
      setTimeout(() => {
        const activeElement = document.activeElement;
        const rowElement = rowRef.current;

        // Check if focus moved outside this row
        if (rowElement && !rowElement.contains(activeElement)) {
          // Don't auto-add if focus moved to a popover/dropdown portal
          // Radix UI renders these outside the DOM tree, so we check for their data attributes
          const isInRadixPortal = activeElement?.closest(
            '[data-radix-popper-content-wrapper], [data-radix-select-content], [data-radix-dropdown-menu-content], [data-radix-popover-content], [role="listbox"], [role="dialog"]'
          );

          if (isInRadixPortal) {
            return; // Focus is in a dropdown/popover, don't auto-add yet
          }

          // Check if the part has meaningful data (not just defaults)
          const hasData =
            part.name.trim() !== '' ||
            part.length_mm > 0 ||
            part.width_mm > 0;

          if (hasData) {
            onQuickAddActivate();
          }
        }
      }, 0);
    },
    [isQuickAdd, onQuickAddActivate, part.name, part.length_mm, part.width_mm]
  );

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

  const handleGroupChange = useCallback(
    (value: string) => {
      // Handle special values
      if (value === '__none__') {
        onUpdate(index, { lamination_group: undefined });
      } else if (value.startsWith('__new__')) {
        const newLetter = value.replace('__new__', '');
        onUpdate(index, { lamination_group: newLetter });
      } else {
        onUpdate(index, { lamination_group: value });
      }
    },
    [index, onUpdate]
  );

  const handleEdgesChange = useCallback(
    (edges: EdgeBandingEdges) => {
      onUpdate(index, {
        band_edges: edges as Required<BandEdges>,
      });
    },
    [index, onUpdate]
  );

  const handleEdgingMaterialChange = useCallback(
    (edgingId: string) => {
      onUpdate(index, {
        edging_material_id: edgingId === '__default__' ? undefined : edgingId,
      });
    },
    [index, onUpdate]
  );

  // Toggle a single edge
  const toggleEdge = useCallback(
    (edge: 'top' | 'right' | 'bottom' | 'left') => {
      const currentEdges = part.band_edges || DEFAULT_BAND_EDGES;
      onUpdate(index, {
        band_edges: {
          ...currentEdges,
          [edge]: !currentEdges[edge],
        } as Required<BandEdges>,
      });
    },
    [index, onUpdate, part.band_edges]
  );

  // Toggle all edges
  const toggleAllEdges = useCallback(() => {
    const currentEdges = part.band_edges || DEFAULT_BAND_EDGES;
    const allActive = currentEdges.top && currentEdges.right && currentEdges.bottom && currentEdges.left;
    const newState = !allActive;
    onUpdate(index, {
      band_edges: {
        top: newState,
        right: newState,
        bottom: newState,
        left: newState,
      },
    });
  }, [index, onUpdate, part.band_edges]);

  // Keyboard handler for edge banding
  const handleEdgeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Arrow keys toggle edges
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        toggleEdge('top');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        toggleEdge('bottom');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        toggleEdge('left');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        toggleEdge('right');
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        e.stopPropagation();
        toggleAllEdges();
      } else if (e.key === ' ') {
        // Space opens the popover for visual editing
        e.preventDefault();
        e.stopPropagation();
        setEdgePopoverOpen(true);
      } else if (e.key === 'Enter') {
        // Enter moves to next row (don't open popover)
        e.stopPropagation();
        // Let the row's keydown handle moving to next row
        if (isQuickAdd && onQuickAddActivate) {
          onQuickAddActivate();
        }
        const nextRow = document.querySelector<HTMLInputElement>(
          `[data-row-index="${index + 1}"] input:first-of-type`
        );
        nextRow?.focus();
      }
    },
    [toggleEdge, toggleAllEdges, isQuickAdd, onQuickAddActivate, index]
  );

  const handleGrainToggle = useCallback(() => {
    const newGrain = nextGrainOrientation(part.grain || 'any');
    onUpdate(index, { grain: newGrain });
  }, [index, onUpdate, part.grain]);

  const handleGrainKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Space or Enter to toggle
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        handleGrainToggle();
      }
      // Arrow keys to cycle
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
        e.preventDefault();
        handleGrainToggle();
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        e.preventDefault();
        // Reverse cycle
        const order: GrainOrientation[] = ['any', 'length', 'width'];
        const currentIndex = order.indexOf(part.grain || 'any');
        const newGrain = order[(currentIndex - 1 + order.length) % order.length];
        onUpdate(index, { grain: newGrain });
      }
    },
    [handleGrainToggle, index, onUpdate, part.grain]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        // Don't handle Enter if it's from a select/dropdown - let them handle it
        const target = e.target as HTMLElement;
        const isInSelect = target.closest('[role="combobox"], [data-radix-select-trigger], [data-radix-collection-item]');
        if (isInSelect) {
          return; // Let the select handle Enter
        }

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
      ref={isQuickAdd ? rowRef : undefined}
      data-row-index={index}
      className={cn(
        'h-10',
        isQuickAdd && 'bg-muted/30 hover:bg-muted/50'
      )}
      onKeyDown={handleKeyDown}
      onBlur={isQuickAdd ? handleRowBlur : undefined}
    >
      {/* ID / Name */}
      <TableCell className="p-1">
        {isQuickAdd ? (
          <TooltipProvider delayDuration={500}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <CompactInput
                    ref={inputRef}
                    value={part.name}
                    onChange={handleNameChange}
                    placeholder="Add part..."
                    className="min-w-[80px]"
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start">
                <p className="text-xs">Enter details, then press <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Enter</kbd> or click <Plus className="inline h-3 w-3" /> to add</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <CompactInput
            ref={inputRef}
            value={part.name}
            onChange={handleNameChange}
            placeholder="ID"
            className="min-w-[80px]"
          />
        )}
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
          className="w-[5.5rem]"
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
          className="w-[5.5rem]"
        />
      </TableCell>

      {/* Quantity */}
      <TableCell className="p-1">
        <CompactInput
          type="number"
          value={part.quantity}
          onChange={handleQuantityChange}
          min={1}
          className="w-16"
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
                onKeyDown={handleGrainKeyDown}
                onMouseEnter={() => setGrainTooltipOpen(true)}
                onMouseLeave={() => setGrainTooltipOpen(false)}
                onFocus={() => setGrainTooltipOpen(true)}
                onBlur={() => setGrainTooltipOpen(false)}
                tabIndex={0}
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
                aria-label={`Grain: ${getGrainOption(part.grain || 'any').label}. Press Space to toggle.`}
              >
                {getGrainOption(part.grain || 'any').icon}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              <p>{getGrainOption(part.grain || 'any').label}</p>
              <p className="text-muted-foreground">Space/arrows to change</p>
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

      {/* Lamination Group */}
      <TableCell className="p-1">
        <CompactSelect
          value={part.lamination_group || '__none__'}
          onValueChange={handleGroupChange}
          options={getGroupOptions(allParts)}
          className="min-w-[70px]"
        />
      </TableCell>

      {/* Edge Banding */}
      <TableCell className="p-1">
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <EdgeBandingPopover
                  length={part.length_mm || 0}
                  width={part.width_mm || 0}
                  edges={part.band_edges}
                  onEdgesChange={handleEdgesChange}
                  edgingOptions={edgingOptions}
                  selectedEdgingId={part.edging_material_id || '__default__'}
                  onEdgingChange={handleEdgingMaterialChange}
                  open={edgePopoverOpen}
                  onOpenChange={setEdgePopoverOpen}
                  trigger={
                    <button
                      type="button"
                      onKeyDown={handleEdgeKeyDown}
                      tabIndex={0}
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
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              <p className="font-medium">Edge Banding</p>
              <p className="text-muted-foreground">Arrows: toggle edges | A: all | Space: popover</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </TableCell>

      {/* Actions */}
      <TableCell className="p-1 w-10">
        {isQuickAdd ? (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-primary"
                  onClick={onQuickAddActivate}
                >
                  <Plus className="h-4 w-4" />
                  <span className="sr-only">Add part</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                <p>Add part (Enter)</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
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
              {part.material_id && (
                <DropdownMenuItem onClick={() => onApplyMaterialToAll(index)}>
                  <Copy className="mr-2 h-4 w-4" />
                  Apply material to all rows
                </DropdownMenuItem>
              )}
              {part.edging_material_id && (
                <DropdownMenuItem onClick={() => onApplyEdgingToAll(index)}>
                  <Copy className="mr-2 h-4 w-4" />
                  Apply edging to all rows
                </DropdownMenuItem>
              )}
              {(part.material_id || part.edging_material_id) && <DropdownMenuSeparator />}
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
export const CompactPartsTable = memo(forwardRef<CompactPartsTableRef, CompactPartsTableProps>(function CompactPartsTable({
  parts,
  onPartsChange,
  materialOptions,
  onOpenCustomLamination,
  edgingOptions,
  className,
  onQuickAddPending,
}, ref) {
  // Quick-add state
  const [quickAddPart, setQuickAddPart] = useState<CompactPart>(() =>
    createEmptyPart(materialOptions[0]?.id)
  );

  // Notify parent when quick-add has pending data
  useEffect(() => {
    if (onQuickAddPending) {
      const hasPending = !isPartEmpty(quickAddPart);
      onQuickAddPending(hasPending);
    }
  }, [quickAddPart, onQuickAddPending]);

  // Expose activateQuickAdd to parent via ref
  useImperativeHandle(ref, () => ({
    activateQuickAdd: () => {
      if (!isPartEmpty(quickAddPart)) {
        const newPart: CompactPart = {
          ...quickAddPart,
          id: generatePartId(),
        };
        onPartsChange([...parts, newPart]);
        setQuickAddPart(createEmptyPart(materialOptions[0]?.id));
      }
    },
  }), [quickAddPart, parts, onPartsChange, materialOptions]);

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

  // Apply material from one row to all other rows
  const handleApplyMaterialToAll = useCallback(
    (index: number) => {
      const sourcePart = parts[index];
      if (!sourcePart?.material_id) return;
      const newParts = parts.map((p) => ({
        ...p,
        material_id: sourcePart.material_id,
      }));
      onPartsChange(newParts);
    },
    [parts, onPartsChange]
  );

  // Apply edging material from one row to all other rows
  const handleApplyEdgingToAll = useCallback(
    (index: number) => {
      const sourcePart = parts[index];
      if (!sourcePart?.edging_material_id) return;
      const newParts = parts.map((p) => ({
        ...p,
        edging_material_id: sourcePart.edging_material_id,
      }));
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
            <TableHead className="px-2 py-1 font-medium text-xs w-[5.5rem]">L</TableHead>
            <TableHead className="px-2 py-1 font-medium text-xs w-[5.5rem]">W</TableHead>
            <TableHead className="px-2 py-1 font-medium text-xs w-16">Qty</TableHead>
            <TableHead className="px-2 py-1 font-medium text-xs w-10" title="Grain Direction">Grain</TableHead>
            <TableHead className="px-2 py-1 font-medium text-xs">Lam</TableHead>
            <TableHead className="px-2 py-1 font-medium text-xs w-16" title="Lamination Group">Grp</TableHead>
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
              allParts={parts}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
              onApplyMaterialToAll={handleApplyMaterialToAll}
              onApplyEdgingToAll={handleApplyEdgingToAll}
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
            allParts={parts}
            onUpdate={handleQuickAddUpdate}
            onDelete={() => {}}
            onDuplicate={() => {}}
            onApplyMaterialToAll={() => {}}
            onApplyEdgingToAll={() => {}}
            onOpenCustomLamination={onOpenCustomLamination}
            onQuickAddActivate={handleQuickAddActivate}
          />
        </TableBody>
      </Table>
    </div>
  );
}));

export default CompactPartsTable;
