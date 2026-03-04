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
import type { PedestalConfig } from '@/lib/configurator/templates/types';

interface PedestalFormProps {
  config: PedestalConfig;
  onChange: (config: PedestalConfig) => void;
}

function NumberInput({
  id,
  value,
  min,
  max,
  onChange,
  disabled,
  className: extraClassName,
}: {
  id?: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
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
      className={`h-8 ${extraClassName ?? ''}`}
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

/**
 * Compute the height of each standard drawer front.
 *
 * carcassHeight = H - adjusterHeight
 * totalFronts   = drawerCount + (pencil ? 1 : 0) + (filing ? 1 : 0)
 * totalGaps     = (totalFronts - 1) * drawerGap
 * available     = carcassHeight - pencilH - filingH - totalGaps
 * stdHeight     = available / drawerCount
 */
function computeDrawerInfo(config: PedestalConfig) {
  const carcassHeight = config.height - config.adjusterHeight;
  const pencilH = config.hasPencilDrawer ? config.pencilDrawerHeight : 0;
  const filingH = config.hasFilingDrawer ? config.filingDrawerHeight : 0;
  const totalFronts =
    config.drawerCount +
    (config.hasPencilDrawer ? 1 : 0) +
    (config.hasFilingDrawer ? 1 : 0);
  const totalGaps = (totalFronts - 1) * config.drawerGap;
  const available = carcassHeight - pencilH - filingH - totalGaps;
  const stdHeight = config.drawerCount > 0 ? Math.round(available / config.drawerCount) : 0;

  return { totalFronts, stdHeight, pencilH, filingH };
}

/** Build a human-readable summary of drawer front heights. */
function drawerSummary(config: PedestalConfig): string {
  const { totalFronts, stdHeight, pencilH, filingH } = computeDrawerInfo(config);
  const parts: string[] = [];
  if (config.hasPencilDrawer) parts.push(`Pencil (${pencilH}mm)`);
  if (config.drawerCount === 1) {
    parts.push(`${stdHeight}mm`);
  } else if (config.drawerCount > 1) {
    parts.push(`${config.drawerCount} \u00d7 ${stdHeight}mm`);
  }
  if (config.hasFilingDrawer) parts.push(`Filing (${filingH}mm)`);
  return `${totalFronts} fronts: ${parts.join(' + ')}`;
}

export function PedestalForm({ config, onChange }: PedestalFormProps) {
  const update = (partial: Partial<PedestalConfig>) => {
    onChange({ ...config, ...partial });
  };

  return (
    <div className="space-y-4">
      {/* Dimensions */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-2">Dimensions</h3>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label htmlFor="ped-width" className="text-xs text-muted-foreground">W (mm)</Label>
            <NumberInput id="ped-width" value={config.width} min={200} max={1200} onChange={(v) => update({ width: v })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ped-height" className="text-xs text-muted-foreground">H (mm)</Label>
            <NumberInput id="ped-height" value={config.height} min={200} max={1200} onChange={(v) => update({ height: v })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ped-depth" className="text-xs text-muted-foreground">D (mm)</Label>
            <NumberInput id="ped-depth" value={config.depth} min={200} max={1200} onChange={(v) => update({ depth: v })} />
          </div>
        </div>
      </div>

      {/* Drawers */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-2">Drawers</h3>
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-1 space-y-1">
            <Label htmlFor="ped-drawer-count" className="text-xs text-muted-foreground">Count</Label>
            <NumberInput id="ped-drawer-count" value={config.drawerCount} min={1} max={8} onChange={(v) => update({ drawerCount: v })} />
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
        <div className="space-y-2 mt-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="ped-pencil" className="text-sm">Pencil drawer</Label>
            <div className="flex items-center gap-2">
              {config.hasPencilDrawer && (
                <NumberInput id="ped-pencil-h" value={config.pencilDrawerHeight} min={10} max={200} className="w-20" onChange={(v) => update({ pencilDrawerHeight: v })} />
              )}
              <Switch id="ped-pencil" checked={config.hasPencilDrawer} onCheckedChange={(v) => update({ hasPencilDrawer: v })} />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="ped-filing" className="text-sm">Filing drawer</Label>
            <div className="flex items-center gap-2">
              {config.hasFilingDrawer && (
                <NumberInput id="ped-filing-h" value={config.filingDrawerHeight} min={50} max={600} className="w-20" onChange={(v) => update({ filingDrawerHeight: v })} />
              )}
              <Switch id="ped-filing" checked={config.hasFilingDrawer} onCheckedChange={(v) => update({ hasFilingDrawer: v })} />
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1.5">
          {drawerSummary(config)}
        </p>
      </div>

      {/* Back panel */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="ped-back" className="text-sm">Back panel</Label>
          <Switch id="ped-back" checked={config.hasBack} onCheckedChange={(v) => update({ hasBack: v })} />
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
              <Label htmlFor="ped-adjuster" className="text-xs text-muted-foreground">Adjusters</Label>
              <NumberInput id="ped-adjuster" value={config.adjusterHeight} min={0} max={50} onChange={(v) => update({ adjusterHeight: v })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ped-drawer-gap" className="text-xs text-muted-foreground">Drawer Gap</Label>
              <NumberInput id="ped-drawer-gap" value={config.drawerGap} min={1} max={10} onChange={(v) => update({ drawerGap: v })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ped-setback" className="text-xs text-muted-foreground">Shelf Setback</Label>
              <NumberInput id="ped-setback" value={config.shelfSetback} min={0} max={10} onChange={(v) => update({ shelfSetback: v })} />
            </div>
          </div>
          {config.hasBack && (
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label htmlFor="ped-recess" className="text-xs text-muted-foreground">Back Recess</Label>
                <NumberInput id="ped-recess" value={config.backRecess} min={0} max={30} onChange={(v) => update({ backRecess: v })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ped-slot" className="text-xs text-muted-foreground">Back Slot Depth</Label>
                <NumberInput id="ped-slot" value={config.backSlotDepth} min={0} max={15} onChange={(v) => update({ backSlotDepth: v })} />
              </div>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
