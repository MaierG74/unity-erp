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
import type { CupboardConfig } from '@/lib/configurator/templates/types';

interface CupboardFormProps {
  config: CupboardConfig;
  onChange: (config: CupboardConfig) => void;
}

function NumberInput({
  id,
  value,
  min,
  max,
  onChange,
}: {
  id?: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
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

export function CupboardForm({ config, onChange }: CupboardFormProps) {
  const update = (partial: Partial<CupboardConfig>) => {
    onChange({ ...config, ...partial });
  };

  return (
    <div className="space-y-4">
      {/* Overall Dimensions — 3-col row */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-2">Dimensions</h3>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label htmlFor="cfg-width" className="text-xs text-muted-foreground">W (mm)</Label>
            <NumberInput id="cfg-width" value={config.width} min={100} max={3600} onChange={(v) => update({ width: v })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cfg-height" className="text-xs text-muted-foreground">H (mm)</Label>
            <NumberInput id="cfg-height" value={config.height} min={100} max={3600} onChange={(v) => update({ height: v })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cfg-depth" className="text-xs text-muted-foreground">D (mm)</Label>
            <NumberInput id="cfg-depth" value={config.depth} min={50} max={1200} onChange={(v) => update({ depth: v })} />
          </div>
        </div>
      </div>

      {/* Construction — board thickness + shelves + doors in one row each */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-2">Construction</h3>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
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
          <div className="space-y-1">
            <Label htmlFor="cfg-shelves" className="text-xs text-muted-foreground">Shelves</Label>
            <NumberInput id="cfg-shelves" value={config.shelfCount} min={0} max={10} onChange={(v) => update({ shelfCount: v })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Doors</Label>
            <Select value={config.doorStyle} onValueChange={(v) => update({ doorStyle: v as CupboardConfig['doorStyle'] })}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="single">Single</SelectItem>
                <SelectItem value="double">Double</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Back Panel — inline switch + thickness */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-foreground">Back Panel</h3>
          <Switch
            id="cfg-back"
            checked={config.hasBack}
            onCheckedChange={(v) => update({ hasBack: v })}
          />
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

      {/* Advanced — collapsed by default */}
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
              <Label htmlFor="cfg-adjuster" className="text-xs text-muted-foreground">Adjusters</Label>
              <NumberInput id="cfg-adjuster" value={config.adjusterHeight} min={0} max={50} onChange={(v) => update({ adjusterHeight: v })} />
            </div>
            {config.doorStyle !== 'none' && (
              <div className="space-y-1">
                <Label htmlFor="cfg-doorgap" className="text-xs text-muted-foreground">Door Gap</Label>
                <NumberInput id="cfg-doorgap" value={config.doorGap} min={1} max={5} onChange={(v) => update({ doorGap: v })} />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="cfg-setback" className="text-xs text-muted-foreground">Shelf Setback</Label>
              <NumberInput id="cfg-setback" value={config.shelfSetback} min={0} max={10} onChange={(v) => update({ shelfSetback: v })} />
            </div>
          </div>

          {/* Overhangs — 4-col: top sides/back, base sides/back */}
          <div>
            <h4 className="text-xs font-medium text-muted-foreground mb-1.5">Overhangs (mm)</h4>
            <div className="grid grid-cols-4 gap-2">
              <div className="space-y-1">
                <Label htmlFor="cfg-top-oh-sides" className="text-[10px] text-muted-foreground">Top Sides</Label>
                <NumberInput id="cfg-top-oh-sides" value={config.topOverhangSides} min={0} max={30} onChange={(v) => update({ topOverhangSides: v })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cfg-top-oh-back" className="text-[10px] text-muted-foreground">Top Back</Label>
                <NumberInput id="cfg-top-oh-back" value={config.topOverhangBack} min={0} max={30} onChange={(v) => update({ topOverhangBack: v })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cfg-base-oh-sides" className="text-[10px] text-muted-foreground">Base Sides</Label>
                <NumberInput id="cfg-base-oh-sides" value={config.baseOverhangSides} min={0} max={30} onChange={(v) => update({ baseOverhangSides: v })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cfg-base-oh-back" className="text-[10px] text-muted-foreground">Base Back</Label>
                <NumberInput id="cfg-base-oh-back" value={config.baseOverhangBack} min={0} max={30} onChange={(v) => update({ baseOverhangBack: v })} />
              </div>
            </div>
          </div>

          {/* Back-related advanced fields */}
          {config.hasBack && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="cfg-recess" className="text-xs text-muted-foreground">Back Recess</Label>
                <NumberInput id="cfg-recess" value={config.backRecess} min={0} max={30} onChange={(v) => update({ backRecess: v })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cfg-slot" className="text-xs text-muted-foreground">Back Slot Depth</Label>
                <NumberInput id="cfg-slot" value={config.backSlotDepth} min={0} max={15} onChange={(v) => update({ backSlotDepth: v })} />
              </div>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
