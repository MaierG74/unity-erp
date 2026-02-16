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

/**
 * Number input that allows clearing the field to type fresh.
 * Shows empty string while editing, commits clamped value on blur.
 */
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

  // Sync display when value changes externally (and not focused)
  React.useEffect(() => {
    if (!focused) {
      setDisplay(String(value));
    }
  }, [value, focused]);

  return (
    <Input
      id={id}
      type="number"
      value={display}
      min={min}
      max={max}
      onChange={(e) => {
        const raw = e.target.value;
        setDisplay(raw);
        // Commit raw value without clamping so preview updates live;
        // clamping happens on blur to avoid jumpy editing
        const num = parseInt(raw, 10);
        if (!isNaN(num)) {
          onChange(num);
        }
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        // On blur, if empty or invalid, reset to current value
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
    <div className="space-y-6">
      {/* Overall Dimensions */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-3">Overall Dimensions</h3>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="cfg-width" className="text-xs text-muted-foreground">
              Width (mm)
            </Label>
            <NumberInput
              id="cfg-width"
              value={config.width}
              min={100}
              max={3600}
              onChange={(v) => update({ width: v })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cfg-height" className="text-xs text-muted-foreground">
              Height (mm)
            </Label>
            <NumberInput
              id="cfg-height"
              value={config.height}
              min={100}
              max={3600}
              onChange={(v) => update({ height: v })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cfg-depth" className="text-xs text-muted-foreground">
              Depth (mm)
            </Label>
            <NumberInput
              id="cfg-depth"
              value={config.depth}
              min={50}
              max={1200}
              onChange={(v) => update({ depth: v })}
            />
          </div>
        </div>
      </div>

      {/* Construction */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-3">Construction</h3>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Board Thickness</Label>
            <Select
              value={String(config.materialThickness)}
              onValueChange={(v) => update({ materialThickness: parseInt(v, 10) })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="16">16mm</SelectItem>
                <SelectItem value="18">18mm</SelectItem>
                <SelectItem value="25">25mm</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cfg-shelves" className="text-xs text-muted-foreground">
              Number of Shelves
            </Label>
            <NumberInput
              id="cfg-shelves"
              value={config.shelfCount}
              min={0}
              max={10}
              onChange={(v) => update({ shelfCount: v })}
            />
          </div>
        </div>
      </div>

      {/* Doors */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-3">Doors</h3>
        <Select
          value={config.doorStyle}
          onValueChange={(v) =>
            update({ doorStyle: v as CupboardConfig['doorStyle'] })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No Doors</SelectItem>
            <SelectItem value="single">Single Door</SelectItem>
            <SelectItem value="double">Double Doors</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Back Panel */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-3">Back Panel</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="cfg-back" className="text-sm">Include back panel</Label>
            <Switch
              id="cfg-back"
              checked={config.hasBack}
              onCheckedChange={(v) => update({ hasBack: v })}
            />
          </div>
          {config.hasBack && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Back Thickness</Label>
              <Select
                value={String(config.backMaterialThickness)}
                onValueChange={(v) =>
                  update({ backMaterialThickness: parseInt(v, 10) })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3mm (Hardboard)</SelectItem>
                  <SelectItem value="16">16mm (Melamine)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>

      {/* Advanced */}
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5 px-0 text-muted-foreground">
            <ChevronDown className="h-3.5 w-3.5" />
            Advanced Options
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cfg-adjuster" className="text-xs text-muted-foreground">
              Adjuster Height (mm)
            </Label>
            <NumberInput
              id="cfg-adjuster"
              value={config.adjusterHeight}
              min={0}
              max={50}
              onChange={(v) => update({ adjusterHeight: v })}
            />
          </div>

          <h4 className="text-xs font-medium text-muted-foreground pt-2">Top Overhang</h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cfg-top-oh-sides" className="text-xs text-muted-foreground">
                Sides (mm)
              </Label>
              <NumberInput
                id="cfg-top-oh-sides"
                value={config.topOverhangSides}
                min={0}
                max={30}
                onChange={(v) => update({ topOverhangSides: v })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cfg-top-oh-back" className="text-xs text-muted-foreground">
                Back (mm)
              </Label>
              <NumberInput
                id="cfg-top-oh-back"
                value={config.topOverhangBack}
                min={0}
                max={30}
                onChange={(v) => update({ topOverhangBack: v })}
              />
            </div>
          </div>

          <h4 className="text-xs font-medium text-muted-foreground pt-2">Base Overhang</h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cfg-base-oh-sides" className="text-xs text-muted-foreground">
                Sides (mm)
              </Label>
              <NumberInput
                id="cfg-base-oh-sides"
                value={config.baseOverhangSides}
                min={0}
                max={30}
                onChange={(v) => update({ baseOverhangSides: v })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cfg-base-oh-back" className="text-xs text-muted-foreground">
                Back (mm)
              </Label>
              <NumberInput
                id="cfg-base-oh-back"
                value={config.baseOverhangBack}
                min={0}
                max={30}
                onChange={(v) => update({ baseOverhangBack: v })}
              />
            </div>
          </div>

          {config.hasBack && (
            <div className="space-y-1.5">
              <Label htmlFor="cfg-slot" className="text-xs text-muted-foreground">
                Back Slot Depth (mm)
              </Label>
              <NumberInput
                id="cfg-slot"
                value={config.backSlotDepth}
                min={0}
                max={15}
                onChange={(v) => update({ backSlotDepth: v })}
              />
            </div>
          )}
          {config.doorStyle !== 'none' && (
            <div className="space-y-1.5">
              <Label htmlFor="cfg-doorgap" className="text-xs text-muted-foreground">
                Door Gap (mm)
              </Label>
              <NumberInput
                id="cfg-doorgap"
                value={config.doorGap}
                min={1}
                max={5}
                onChange={(v) => update({ doorGap: v })}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="cfg-setback" className="text-xs text-muted-foreground">
              Shelf Setback (mm)
            </Label>
            <NumberInput
              id="cfg-setback"
              value={config.shelfSetback}
              min={0}
              max={10}
              onChange={(v) => update({ shelfSetback: v })}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
