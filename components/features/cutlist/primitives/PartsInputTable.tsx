'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2 } from 'lucide-react';
import type { PartSpec, GrainOrientation } from '@/lib/cutlist/types';

/**
 * Material option for the material selector dropdown.
 */
export interface MaterialOption {
  id: string;
  name: string;
  description?: string;
  unit_cost?: number | null;
}

/**
 * Extended part type with optional label for display.
 */
export type PartWithLabel = PartSpec & { label?: string };

export interface PartsInputTableProps {
  /** Array of parts to display and edit */
  parts: PartWithLabel[];
  /** Callback when parts array changes */
  onPartsChange: (parts: PartWithLabel[]) => void;
  /** Available materials for the material selector */
  materials?: MaterialOption[];
  /** Whether to show the material selector column */
  showMaterialSelector?: boolean;
  /** Callback when calculate button is clicked */
  onCalculate?: () => void;
}

const NONE_MATERIAL_VALUE = 'none';

/**
 * PartsInputTable - A reusable component for editing cutlist parts.
 *
 * Renders a list of parts with editable fields for:
 * - Part ID
 * - Dimensions (length_mm, width_mm)
 * - Quantity
 * - Grain orientation selector
 * - Edge banding checkboxes (top, right, bottom, left)
 * - Lamination toggle
 * - Material selector (when showMaterialSelector is true)
 * - Add Part / Delete Part buttons
 */
export function PartsInputTable({
  parts,
  onPartsChange,
  materials = [],
  showMaterialSelector = false,
  onCalculate,
}: PartsInputTableProps) {
  const addPartRow = () => {
    const nextIndex = parts.length + 1;
    const defaultMaterialId = materials[0]?.id ?? null;
    onPartsChange([
      ...parts,
      {
        id: `P${nextIndex}`,
        length_mm: 400,
        width_mm: 300,
        qty: 1,
        grain: 'length',
        band_edges: { top: true, right: true, bottom: true, left: true },
        material_id: defaultMaterialId,
      },
    ]);
  };

  const removePartRow = (idx: number) => {
    onPartsChange(parts.filter((_, i) => i !== idx));
  };

  const updatePart = (idx: number, updates: Partial<PartWithLabel>) => {
    const next = [...parts];
    next[idx] = { ...next[idx], ...updates };
    onPartsChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="font-medium">Parts</div>
      <div className="space-y-2">
        <div className="space-y-4">
          {parts.map((p, idx) => {
            const material = p.material_id ? materials.find((m) => m.id === p.material_id) : null;
            return (
              <div key={idx} className="rounded-xl border bg-card/40 shadow-sm">
                <div className="flex flex-col gap-4 border-b px-4 py-4 md:flex-row md:items-start md:justify-between">
                  <div
                    className={`grid w-full gap-4 md:w-auto ${
                      showMaterialSelector ? 'md:grid-cols-[96px_minmax(0,1fr)] md:items-start' : 'md:grid-cols-[96px]'
                    }`}
                  >
                    <div className="space-y-1">
                      <Label htmlFor={`pid-${idx}`} className="text-xs font-medium uppercase text-muted-foreground">ID</Label>
                      <Input id={`pid-${idx}`} className="w-full md:w-[96px]" value={p.id} onChange={(e) => updatePart(idx, { id: e.target.value })} />
                    </div>
                    {showMaterialSelector && (
                      <div className="space-y-1">
                        <Label htmlFor={`mat-${idx}`} className="text-xs font-medium uppercase text-muted-foreground">Material</Label>
                        <div className="flex flex-wrap items-start gap-2">
                          <Select
                            value={p.material_id ?? NONE_MATERIAL_VALUE}
                            onValueChange={(v) => updatePart(idx, { material_id: v === NONE_MATERIAL_VALUE ? null : v })}
                          >
                            <SelectTrigger id={`mat-${idx}`} className="w-full md:w-[220px]">
                              <SelectValue placeholder="Select material" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE_MATERIAL_VALUE}>No material</SelectItem>
                              {materials.map((mat) => (
                                <SelectItem key={mat.id} value={mat.id}>
                                  {mat.name || mat.description}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {material && (
                          <div className="text-[11px] text-muted-foreground">
                            {material.description}
                            {material.unit_cost != null ? ` - ${material.unit_cost.toFixed(2)}` : ''}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <Button variant="destructiveSoft" size="icon" className="h-8 w-8 self-start" type="button" onClick={() => removePartRow(idx)} aria-label="Delete row">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid gap-4 px-4 py-4 md:grid-cols-2 xl:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor={`len-${idx}`}>Length (mm)</Label>
                    <Input id={`len-${idx}`} type="number" value={p.length_mm} onChange={(e) => updatePart(idx, { length_mm: Number(e.target.value || 0) })} onFocus={(e) => e.target.select()} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`wid-${idx}`}>Width (mm)</Label>
                    <Input id={`wid-${idx}`} type="number" value={p.width_mm} onChange={(e) => updatePart(idx, { width_mm: Number(e.target.value || 0) })} onFocus={(e) => e.target.select()} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`qty-${idx}`}>Quantity</Label>
                    <Input id={`qty-${idx}`} type="number" value={p.qty} onChange={(e) => updatePart(idx, { qty: Number(e.target.value || 0) })} onFocus={(e) => e.target.select()} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`grain-${idx}`}>Grain</Label>
                    <Select value={p.grain ?? (p.require_grain ? 'length' : 'any')} onValueChange={(v) => updatePart(idx, { grain: v as GrainOrientation, require_grain: undefined })}>
                      <SelectTrigger id={`grain-${idx}`}>
                        <SelectValue placeholder="Grain" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Any</SelectItem>
                        <SelectItem value="length">Length</SelectItem>
                        <SelectItem value="width">Width</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Edge length</Label>
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <div className="flex items-center gap-1">
                        <Checkbox id={`len-left-${idx}`} className="h-4 w-4" checked={Boolean(p.band_edges?.left)} onCheckedChange={(v) => updatePart(idx, { band_edges: { ...p.band_edges, left: Boolean(v) } })} />
                        <Label htmlFor={`len-left-${idx}`} className="leading-none">Left ({p.length_mm})</Label>
                      </div>
                      <div className="flex items-center gap-1">
                        <Checkbox id={`len-right-${idx}`} className="h-4 w-4" checked={Boolean(p.band_edges?.right)} onCheckedChange={(v) => updatePart(idx, { band_edges: { ...p.band_edges, right: Boolean(v) } })} />
                        <Label htmlFor={`len-right-${idx}`} className="leading-none">Right ({p.length_mm})</Label>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Edge width</Label>
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <div className="flex items-center gap-1">
                        <Checkbox id={`wid-top-${idx}`} className="h-4 w-4" checked={Boolean(p.band_edges?.top)} onCheckedChange={(v) => updatePart(idx, { band_edges: { ...p.band_edges, top: Boolean(v) } })} />
                        <Label htmlFor={`wid-top-${idx}`} className="leading-none">Top ({p.width_mm})</Label>
                      </div>
                      <div className="flex items-center gap-1">
                        <Checkbox id={`wid-bot-${idx}`} className="h-4 w-4" checked={Boolean(p.band_edges?.bottom)} onCheckedChange={(v) => updatePart(idx, { band_edges: { ...p.band_edges, bottom: Boolean(v) } })} />
                        <Label htmlFor={`wid-bot-${idx}`} className="leading-none">Bottom ({p.width_mm})</Label>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`lam-${idx}`}>Lamination</Label>
                    <div className="flex items-center gap-2">
                      <Checkbox id={`lam-${idx}`} checked={Boolean(p.laminate)} onCheckedChange={(v) => updatePart(idx, { laminate: Boolean(v) })} />
                      <Label htmlFor={`lam-${idx}`} className="text-sm text-muted-foreground">Apply backer</Label>
                    </div>
                  </div>
                  {showMaterialSelector && material && (
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <div className="font-medium text-foreground">{material.description}</div>
                      {material.unit_cost != null && (
                        <div>Unit price: {material.unit_cost.toFixed(2)}</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="button" variant="secondary" onClick={addPartRow}>+ Add Part</Button>
          {onCalculate && <Button onClick={onCalculate}>Calculate</Button>}
        </div>
      </div>
    </div>
  );
}

export default PartsInputTable;
