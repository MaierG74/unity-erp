'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { ChevronDown } from 'lucide-react';
import type { PigeonholeConfig } from '@/lib/configurator/templates/types';
type DoorStyle = PigeonholeConfig['doorStyle'];

interface PigeonholeFormProps {
  config: PigeonholeConfig;
  onChange: (config: PigeonholeConfig) => void;
}

function NumberInput({
  id,
  value,
  min,
  max,
  onChange,
  disabled,
}: {
  id?: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const [display, setDisplay] = React.useState(String(value));
  const [focused, setFocused] = React.useState(false);

  React.useEffect(() => {
    if (!focused) setDisplay(String(value));
  }, [value, focused]);

  return (
    <Input
      id={id}
      type="number"
      value={display}
      min={min}
      max={max}
      disabled={disabled}
      className="h-8"
      onChange={(e) => {
        const raw = e.target.value;
        setDisplay(raw);
        const num = parseInt(raw, 10);
        if (!isNaN(num)) onChange(num);
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        const num = parseInt(display, 10);
        if (isNaN(num)) {
          setDisplay(String(value));
        } else {
          const clamped = Math.max(min, Math.min(max, num));
          onChange(clamped);
          setDisplay(String(clamped));
        }
      }}
    />
  );
}

type DimensionMode = 'overall' | 'cell';

/**
 * Compute overall W/H/D from desired internal cell dimensions + construction params.
 *
 * Reverse of the generator math:
 *   internalWidth = cellW × cols + T × (cols - 1)
 *   carcassWidth  = internalWidth + T × 2
 *   W = carcassWidth + max(topOverhangSides, baseOverhangSides) × 2
 *
 *   sideHeight = cellH × rows + T × (rows - 1)
 *   H = sideHeight + adjusterHeight + TB × 2
 *
 *   carcassDepth = cellD + shelfSetback + (hasBack ? BT + backRecess : 0)
 *   D = carcassDepth + max(topOverhangBack, baseOverhangBack)
 */
function cellToOverall(
  cellW: number,
  cellH: number,
  cellD: number,
  config: PigeonholeConfig,
): { width: number; height: number; depth: number } {
  const T = config.materialThickness;
  const TB = config.laminateTopBase ? T * 2 : T;
  const BT = config.backMaterialThickness;

  const internalWidth = cellW * config.columns + T * (config.columns - 1);
  const carcassWidth = internalWidth + T * 2;
  const width = carcassWidth + Math.max(config.topOverhangSides, config.baseOverhangSides) * 2;

  const sideHeight = cellH * config.rows + T * (config.rows - 1);
  const height = sideHeight + config.adjusterHeight + TB + TB;

  const carcassDepth = cellD + config.shelfSetback + (config.hasBack ? BT + config.backRecess : 0);
  const depth = carcassDepth + Math.max(config.topOverhangBack, config.baseOverhangBack);

  return {
    width: Math.round(width),
    height: Math.round(height),
    depth: Math.round(depth),
  };
}

/**
 * Compute cell dimensions from current overall config (reverse of generator).
 */
function overallToCell(config: PigeonholeConfig): { cellW: number; cellH: number; cellD: number } {
  const T = config.materialThickness;
  const TB = config.laminateTopBase ? T * 2 : T;
  const BT = config.backMaterialThickness;

  const carcassWidth = config.width - Math.max(config.topOverhangSides, config.baseOverhangSides) * 2;
  const internalWidth = carcassWidth - T * 2;
  const cellW = (internalWidth - T * (config.columns - 1)) / config.columns;

  const sideHeight = config.height - config.adjusterHeight - TB - TB;
  const cellH = (sideHeight - T * (config.rows - 1)) / config.rows;

  const carcassDepth = config.depth - Math.max(config.topOverhangBack, config.baseOverhangBack);
  const cellD = carcassDepth - config.shelfSetback - (config.hasBack ? BT + config.backRecess : 0);

  return {
    cellW: Math.round(cellW),
    cellH: Math.round(cellH),
    cellD: Math.round(cellD),
  };
}

export function PigeonholeForm({ config, onChange }: PigeonholeFormProps) {
  const [dimMode, setDimMode] = React.useState<DimensionMode>('overall');

  // Cell dimensions — local state, synced from config when in overall mode
  const derivedCell = overallToCell(config);
  const [cellW, setCellW] = React.useState(derivedCell.cellW);
  const [cellH, setCellH] = React.useState(derivedCell.cellH);
  const [cellD, setCellD] = React.useState(derivedCell.cellD);

  // When switching to cell mode, sync cell values from current overall dims
  const handleModeChange = (mode: DimensionMode) => {
    if (mode === 'cell') {
      const c = overallToCell(config);
      setCellW(c.cellW);
      setCellH(c.cellH);
      setCellD(c.cellD);
    }
    setDimMode(mode);
  };

  // Push overall dims when cell dimensions or dependent config changes in cell mode
  const updateCellDim = React.useCallback((newCellW: number, newCellH: number, newCellD: number, cfg: PigeonholeConfig) => {
    const overall = cellToOverall(newCellW, newCellH, newCellD, cfg);
    onChange({ ...cfg, ...overall });
  }, [onChange]);

  const update = (partial: Partial<PigeonholeConfig>) => {
    const next = { ...config, ...partial };
    if (dimMode === 'cell') {
      // Recalculate overall dims from current cell sizes with updated config
      const overall = cellToOverall(cellW, cellH, cellD, next);
      onChange({ ...next, ...overall });
    } else {
      onChange(next);
    }
  };

  const isCellMode = dimMode === 'cell';
  const rawDoorStyle = config.doorStyle ?? 'none';
  const doorStyle = rawDoorStyle === 'single' || rawDoorStyle === 'double' ? 'per-cell' : rawDoorStyle;
  const doorGap = config.doorGap ?? 2;

  return (
    <div className="space-y-4">
      {/* Dimensions */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-foreground">Dimensions</h3>
          <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
            <button
              type="button"
              onClick={() => handleModeChange('overall')}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                !isCellMode ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Overall
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('cell')}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                isCellMode ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Cell Size
            </button>
          </div>
        </div>

        {isCellMode ? (
          <>
            {/* Cell size inputs */}
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label htmlFor="ph-cell-w" className="text-xs text-muted-foreground">Cell W</Label>
                <NumberInput id="ph-cell-w" value={cellW} min={50} max={2000} onChange={(v) => { setCellW(v); updateCellDim(v, cellH, cellD, config); }} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ph-cell-h" className="text-xs text-muted-foreground">Cell H</Label>
                <NumberInput id="ph-cell-h" value={cellH} min={50} max={2000} onChange={(v) => { setCellH(v); updateCellDim(cellW, v, cellD, config); }} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ph-cell-d" className="text-xs text-muted-foreground">Cell D</Label>
                <NumberInput id="ph-cell-d" value={cellD} min={50} max={1200} onChange={(v) => { setCellD(v); updateCellDim(cellW, cellH, v, config); }} />
              </div>
            </div>
            {/* Show computed overall as read-only summary */}
            <p className="text-xs text-muted-foreground mt-1.5">
              Overall: {config.width} &times; {config.height} &times; {config.depth}mm
            </p>
          </>
        ) : (
          <>
            {/* Overall dimension inputs */}
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label htmlFor="ph-width" className="text-xs text-muted-foreground">W (mm)</Label>
                <NumberInput id="ph-width" value={config.width} min={100} max={3600} onChange={(v) => update({ width: v })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ph-height" className="text-xs text-muted-foreground">H (mm)</Label>
                <NumberInput id="ph-height" value={config.height} min={100} max={3600} onChange={(v) => update({ height: v })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ph-depth" className="text-xs text-muted-foreground">D (mm)</Label>
                <NumberInput id="ph-depth" value={config.depth} min={50} max={1200} onChange={(v) => update({ depth: v })} />
              </div>
            </div>
            {/* Show computed cell size as read-only summary */}
            <p className="text-xs text-muted-foreground mt-1.5">
              Cell: {derivedCell.cellW} &times; {derivedCell.cellH} &times; {derivedCell.cellD}mm
            </p>
          </>
        )}
      </div>

      {/* Grid + Construction */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-2">Grid &amp; Construction</h3>
        <div className="grid grid-cols-4 gap-2">
          <div className="space-y-1">
            <Label htmlFor="ph-cols" className="text-xs text-muted-foreground">Cols</Label>
            <NumberInput id="ph-cols" value={config.columns} min={1} max={12} onChange={(v) => update({ columns: v })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ph-rows" className="text-xs text-muted-foreground">Rows</Label>
            <NumberInput id="ph-rows" value={config.rows} min={1} max={12} onChange={(v) => update({ rows: v })} />
          </div>
          <div className="col-span-2 space-y-1">
            <Label className="text-xs text-muted-foreground">Board</Label>
            <Select value={String(config.materialThickness)} onValueChange={(v) => update({ materialThickness: parseInt(v, 10) })}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="16">16mm</SelectItem>
                <SelectItem value="18">18mm</SelectItem>
                <SelectItem value="25">25mm</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1.5">
          {config.columns} &times; {config.rows} = {config.columns * config.rows} pigeon holes
        </p>
      </div>

      {/* Doors */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-2">Doors</h3>
        <Select value={doorStyle} onValueChange={(v) => update({ doorStyle: v as DoorStyle })}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="per-cell">Per Compartment</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Laminate + Back */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="ph-laminate" className="text-sm">Laminate top &amp; base</Label>
          <Switch id="ph-laminate" checked={config.laminateTopBase} onCheckedChange={(v) => update({ laminateTopBase: v })} />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="ph-back" className="text-sm">Back panel</Label>
          <Switch id="ph-back" checked={config.hasBack} onCheckedChange={(v) => update({ hasBack: v })} />
        </div>
        {config.hasBack && (
          <Select
            value={String(config.backMaterialThickness)}
            onValueChange={(v) => update({ backMaterialThickness: parseInt(v, 10) })}
          >
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="3">3mm (Hardboard)</SelectItem>
              <SelectItem value="16">16mm (Melamine)</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Advanced */}
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5 px-0 text-muted-foreground">
            <ChevronDown className="h-3.5 w-3.5" />
            Advanced
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label htmlFor="ph-adjuster" className="text-xs text-muted-foreground">Adjusters</Label>
              <NumberInput id="ph-adjuster" value={config.adjusterHeight} min={0} max={50} onChange={(v) => update({ adjusterHeight: v })} />
            </div>
            {doorStyle !== 'none' && (
              <div className="space-y-1">
                <Label htmlFor="ph-doorgap" className="text-xs text-muted-foreground">Door Gap</Label>
                <NumberInput id="ph-doorgap" value={doorGap} min={1} max={5} onChange={(v) => update({ doorGap: v })} />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="ph-setback" className="text-xs text-muted-foreground">Shelf Setback</Label>
              <NumberInput id="ph-setback" value={config.shelfSetback} min={0} max={10} onChange={(v) => update({ shelfSetback: v })} />
            </div>
          </div>
          {config.hasBack && (
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label htmlFor="ph-recess" className="text-xs text-muted-foreground">Back Recess</Label>
                <NumberInput id="ph-recess" value={config.backRecess} min={0} max={30} onChange={(v) => update({ backRecess: v })} />
              </div>
            </div>
          )}

          {/* Overhangs — 4-col */}
          <div>
            <h4 className="text-xs font-medium text-muted-foreground mb-1.5">Overhangs (mm)</h4>
            <div className="grid grid-cols-4 gap-2">
              <div className="space-y-1">
                <Label htmlFor="ph-top-oh-sides" className="text-[10px] text-muted-foreground">Top Sides</Label>
                <NumberInput id="ph-top-oh-sides" value={config.topOverhangSides} min={0} max={30} onChange={(v) => update({ topOverhangSides: v })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ph-top-oh-back" className="text-[10px] text-muted-foreground">Top Back</Label>
                <NumberInput id="ph-top-oh-back" value={config.topOverhangBack} min={0} max={30} onChange={(v) => update({ topOverhangBack: v })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ph-base-oh-sides" className="text-[10px] text-muted-foreground">Base Sides</Label>
                <NumberInput id="ph-base-oh-sides" value={config.baseOverhangSides} min={0} max={30} onChange={(v) => update({ baseOverhangSides: v })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ph-base-oh-back" className="text-[10px] text-muted-foreground">Base Back</Label>
                <NumberInput id="ph-base-oh-back" value={config.baseOverhangBack} min={0} max={30} onChange={(v) => update({ baseOverhangBack: v })} />
              </div>
            </div>
          </div>

          {config.hasBack && (
            <div className="space-y-1">
              <Label htmlFor="ph-slot" className="text-xs text-muted-foreground">Back Slot Depth</Label>
              <NumberInput id="ph-slot" value={config.backSlotDepth} min={0} max={15} onChange={(v) => update({ backSlotDepth: v })} />
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
