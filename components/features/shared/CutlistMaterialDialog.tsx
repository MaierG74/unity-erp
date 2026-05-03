'use client';

import React from 'react';
import { Check, ChevronDown, ChevronRight, ChevronsUpDown, Loader2, RotateCcw, Unlink } from 'lucide-react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import { boardEdgingPairKey, cutlistOverrideKey, type CutlistPartOverride, type CutlistSnapshotGroup } from '@/lib/orders/snapshot-types';
import { cn } from '@/lib/utils';

const BOARD_CATEGORY_IDS = [75, 3, 14];
const EDGING_CATEGORY_IDS = [39];

type ComponentOption = {
  component_id: number;
  internal_code?: string | null;
  description?: string | null;
  category_id?: number | null;
  surcharge_percentage?: number | string | null;
};

type PartRow = {
  key: string;
  part_id: string | null;
  part_name: string;
  board_type: string;
  length_mm: number | null;
  width_mm: number | null;
  thickness_mm: number | null;
  current_board_id: number | null;
  current_edging_id: number | null;
};

type SaveValue = {
  cutlist_primary_material_id: number | null;
  cutlist_primary_backer_material_id: number | null;
  cutlist_primary_edging_id: number | null;
  cutlist_part_overrides: CutlistPartOverride[];
  cutlist_surcharge_kind: 'fixed' | 'percentage';
  cutlist_surcharge_value: number;
  cutlist_surcharge_label: string | null;
};

type CutlistMaterialDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: {
    quantity?: number | null;
    unit_price?: number | null;
    cutlist_material_snapshot?: CutlistSnapshotGroup[] | null;
    cutlist_primary_material_id?: number | null;
    cutlist_primary_backer_material_id?: number | null;
    cutlist_primary_edging_id?: number | null;
    cutlist_part_overrides?: unknown[] | null;
    cutlist_surcharge_kind?: 'fixed' | 'percentage' | null;
    cutlist_surcharge_value?: number | string | null;
    cutlist_surcharge_label?: string | null;
  };
  applying?: boolean;
  onApply: (value: SaveValue) => void;
};

type PairConflict = {
  boardId: number;
  thickness: number;
  boardName: string;
  existingEdgingName: string;
  nextEdgingName: string;
  nextEdgingId: number;
};

function componentName(component: ComponentOption | null | undefined): string {
  if (!component) return 'Unassigned';
  return component.description || component.internal_code || `Component ${component.component_id}`;
}

function thicknessForPart(group: CutlistSnapshotGroup, part: any): number | null {
  const explicit = Number(part?.effective_thickness_mm ?? part?.material_thickness);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  if (group.board_type === '32mm-both' || group.board_type === '32mm-backer') return 32;
  return 16;
}

function flattenParts(snapshot: CutlistSnapshotGroup[] | null | undefined): PartRow[] {
  if (!Array.isArray(snapshot)) return [];
  return snapshot.flatMap((group) =>
    (group.parts ?? []).map((part: any) => ({
      key: cutlistOverrideKey(
        group.board_type,
        part.name,
        Number(part.length_mm ?? 0),
        Number(part.width_mm ?? 0),
        part.id ?? null
      ),
      part_id: part.id ?? null,
      part_name: part.name ?? 'Unnamed part',
      board_type: group.board_type,
      length_mm: Number.isFinite(Number(part.length_mm)) ? Number(part.length_mm) : null,
      width_mm: Number.isFinite(Number(part.width_mm)) ? Number(part.width_mm) : null,
      thickness_mm: thicknessForPart(group, part),
      current_board_id: part.effective_board_id ?? group.primary_material_id ?? null,
      current_edging_id: part.effective_edging_id ?? null,
    }))
  );
}

function normalizeOverrides(value: unknown[] | null | undefined): CutlistPartOverride[] {
  return Array.isArray(value) ? (value.filter((entry) => entry && typeof entry === 'object') as CutlistPartOverride[]) : [];
}

function resolvedLineSurcharge(kind: 'fixed' | 'percentage', value: number, quantity: number, unitPrice: number): number {
  const base = quantity * unitPrice;
  return kind === 'percentage' ? Math.round(base * value) / 100 : Math.round(value * quantity * 100) / 100;
}

async function fetchComponents(categoryIds: number[]): Promise<ComponentOption[]> {
  const responses = await Promise.all(
    categoryIds.map(async (categoryId) => {
      const response = await authorizedFetch(`/api/components/by-category/${categoryId}`);
      if (!response.ok) throw new Error('Failed to load component options');
      const json = await response.json();
      return Array.isArray(json.components) ? json.components : [];
    })
  );
  const byId = new Map<number, ComponentOption>();
  for (const component of responses.flat()) byId.set(Number(component.component_id), component);
  return Array.from(byId.values()).sort((a, b) => componentName(a).localeCompare(componentName(b)));
}

async function fetchPair(boardId: number, thickness: number) {
  const response = await authorizedFetch(`/api/cutlist/board-edging-pairs?boardComponentId=${boardId}&thicknessMm=${thickness}`);
  if (!response.ok) return null;
  const json = await response.json();
  return json.pair ?? null;
}

async function savePair(boardId: number, thickness: number, edgingId: number) {
  const response = await authorizedFetch('/api/cutlist/board-edging-pairs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      board_component_id: boardId,
      thickness_mm: thickness,
      edging_component_id: edgingId,
    }),
  });
  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    throw new Error(json.error || 'Failed to save board edging pair');
  }
}

function ComponentCombobox({
  value,
  options,
  onChange,
  placeholder,
  triggerClassName,
}: {
  value: number | null;
  options: ComponentOption[];
  onChange: (id: number | null) => void;
  placeholder: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const selected = value != null ? options.find((option) => option.component_id === value) ?? null : null;
  const label = selected ? componentName(selected) : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('w-full justify-between font-normal', triggerClassName)}
        >
          <span className="truncate text-left">{label}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-[320px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search..." />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={placeholder}
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                <Check className={cn('mr-2 h-4 w-4 shrink-0', value == null ? 'opacity-100' : 'opacity-0')} />
                {placeholder}
              </CommandItem>
              {options.map((option) => {
                const optionLabel = componentName(option);
                const code = option.internal_code ?? '';
                return (
                  <CommandItem
                    key={option.component_id}
                    value={`${optionLabel} ${code}`}
                    onSelect={() => {
                      onChange(option.component_id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4 shrink-0',
                        value === option.component_id ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <span className="truncate">{optionLabel}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function CutlistMaterialDialog({
  open,
  onOpenChange,
  detail,
  applying = false,
  onApply,
}: CutlistMaterialDialogProps) {
  const parts = React.useMemo(() => flattenParts(detail.cutlist_material_snapshot), [detail.cutlist_material_snapshot]);
  const [boards, setBoards] = React.useState<ComponentOption[]>([]);
  const [edgings, setEdgings] = React.useState<ComponentOption[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [primaryId, setPrimaryId] = React.useState<number | null>(null);
  const [edgingId, setEdgingId] = React.useState<number | null>(null);
  const [paired, setPaired] = React.useState(false);
  const [kind, setKind] = React.useState<'fixed' | 'percentage'>('fixed');
  const [surchargeValue, setSurchargeValue] = React.useState('0');
  const [surchargeLabel, setSurchargeLabel] = React.useState('');
  const [surchargeTouched, setSurchargeTouched] = React.useState(false);
  const [overridesOpen, setOverridesOpen] = React.useState(false);
  const [overrides, setOverrides] = React.useState<CutlistPartOverride[]>([]);
  const [conflicts, setConflicts] = React.useState<PairConflict[]>([]);
  const [pendingValue, setPendingValue] = React.useState<SaveValue | null>(null);

  const boardById = React.useMemo(() => new Map(boards.map((board) => [board.component_id, board])), [boards]);
  const edgingById = React.useMemo(() => new Map(edgings.map((edging) => [edging.component_id, edging])), [edgings]);
  const overrideByKey = React.useMemo(() => {
    const map = new Map<string, CutlistPartOverride>();
    for (const override of overrides) {
      map.set(cutlistOverrideKey(
        override.board_type ?? '',
        override.part_name ?? '',
        Number(override.length_mm ?? 0),
        Number(override.width_mm ?? 0),
        override.part_id ?? null
      ), override);
    }
    return map;
  }, [overrides]);
  const overrideCount = overrides.length;
  const selectedPrimary = primaryId ? boardById.get(primaryId) : null;
  const quantity = Number(detail.quantity ?? 0);
  const unitPrice = Number(detail.unit_price ?? 0);
  const numericSurcharge = Number(surchargeValue || 0);
  const resolvedSurcharge = resolvedLineSurcharge(
    kind,
    Number.isFinite(numericSurcharge) ? numericSurcharge : 0,
    Number.isFinite(quantity) ? quantity : 0,
    Number.isFinite(unitPrice) ? unitPrice : 0
  );

  React.useEffect(() => {
    if (!open) return;
    setPrimaryId(detail.cutlist_primary_material_id ?? null);
    setEdgingId(detail.cutlist_primary_edging_id ?? null);
    setKind(detail.cutlist_surcharge_kind === 'percentage' ? 'percentage' : 'fixed');
    setSurchargeValue(String(detail.cutlist_surcharge_value ?? 0));
    setSurchargeLabel(detail.cutlist_surcharge_label ?? '');
    setSurchargeTouched(Number(detail.cutlist_surcharge_value ?? 0) !== 0);
    const nextOverrides = normalizeOverrides(detail.cutlist_part_overrides);
    setOverrides(nextOverrides);
    setOverridesOpen(nextOverrides.length > 0);
    setPaired(false);
  }, [detail, open]);

  React.useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    Promise.all([fetchComponents(BOARD_CATEGORY_IDS), fetchComponents(EDGING_CATEGORY_IDS)])
      .then(([boardOptions, edgingOptions]) => {
        if (!active) return;
        setBoards(boardOptions);
        setEdgings(edgingOptions);
      })
      .catch((error) => toast.error(error.message))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  React.useEffect(() => {
    if (!selectedPrimary || surchargeTouched) return;
    const tier = Number(selectedPrimary.surcharge_percentage ?? 0);
    if (Number.isFinite(tier) && tier !== 0) {
      setKind('percentage');
      setSurchargeValue(String(tier));
      setSurchargeLabel(componentName(selectedPrimary));
    }
  }, [selectedPrimary, surchargeTouched]);

  React.useEffect(() => {
    if (!open || !primaryId) return;
    const thicknesses = Array.from(new Set(parts.map((part) => part.thickness_mm).filter((thickness): thickness is number => Boolean(thickness))));
    if (thicknesses.length === 0) return;

    let active = true;
    Promise.all(
      thicknesses.map(async (thickness) => ({
        thickness,
        pair: await fetchPair(primaryId, thickness),
      }))
    )
      .then((results) => {
        if (!active) return;
        const edgingByThickness = new Map<number, { id: number; name: string | null }>();
        for (const result of results) {
          if (result.pair?.edging_component_id) {
            edgingByThickness.set(result.thickness, {
              id: Number(result.pair.edging_component_id),
              name: result.pair.edging_component_name ?? null,
            });
          }
        }
        if (edgingByThickness.size === 0) return;

        setOverrides((currentOverrides) => {
          const currentByKey = new Map<string, CutlistPartOverride>();
          for (const override of currentOverrides) {
            currentByKey.set(cutlistOverrideKey(
              override.board_type ?? '',
              override.part_name ?? '',
              Number(override.length_mm ?? 0),
              Number(override.width_mm ?? 0),
              override.part_id ?? null
            ), override);
          }

          let changed = false;
          const nextOverrides = [...currentOverrides];
          for (const part of parts) {
            if (!part.thickness_mm) continue;
            const pair = edgingByThickness.get(part.thickness_mm);
            if (!pair) continue;
            const existing = currentByKey.get(part.key);
            if (existing?.edging_component_id != null) continue;
            const next: CutlistPartOverride = {
              part_id: part.part_id,
              part_name: part.part_name,
              board_type: part.board_type,
              length_mm: part.length_mm,
              width_mm: part.width_mm,
              ...existing,
              edging_component_id: pair.id,
              edging_component_name: pair.name,
            };
            if (existing) {
              const index = nextOverrides.findIndex((override) =>
                cutlistOverrideKey(
                  override.board_type ?? '',
                  override.part_name ?? '',
                  Number(override.length_mm ?? 0),
                  Number(override.width_mm ?? 0),
                  override.part_id ?? null
                ) === part.key
              );
              if (index >= 0) nextOverrides[index] = next;
            } else {
              nextOverrides.push(next);
            }
            currentByKey.set(part.key, next);
            changed = true;
          }
          return changed ? nextOverrides : currentOverrides;
        });
      })
      .catch((error) => toast.error(error.message));

    return () => {
      active = false;
    };
  }, [open, primaryId, parts]);

  async function applyPrimary(nextId: number | null) {
    setPrimaryId(nextId);
    const nextPrimary = nextId ? boardById.get(nextId) : null;
    if (nextPrimary && !surchargeLabel.trim()) setSurchargeLabel(componentName(nextPrimary));
    if (!nextId) {
      setPaired(false);
      return;
    }
    const primaryThickness = parts[0]?.thickness_mm ?? 16;
    const pair = await fetchPair(nextId, primaryThickness);
    if (pair?.edging_component_id) {
      setEdgingId(Number(pair.edging_component_id));
      setPaired(true);
    } else {
      setPaired(false);
    }
  }

  async function updatePartOverride(part: PartRow, patch: Partial<CutlistPartOverride>) {
    const existing = overrideByKey.get(part.key);
    const next: CutlistPartOverride = {
      part_id: part.part_id,
      part_name: part.part_name,
      board_type: part.board_type,
      length_mm: part.length_mm,
      width_mm: part.width_mm,
      ...existing,
      ...patch,
    };
    const boardId = next.board_component_id ?? null;
    const edgeId = next.edging_component_id ?? null;
    const isReset = boardId == null && edgeId == null;
    const nextOverrides = overrides.filter((override) =>
      cutlistOverrideKey(
        override.board_type ?? '',
        override.part_name ?? '',
        Number(override.length_mm ?? 0),
        Number(override.width_mm ?? 0),
        override.part_id ?? null
      ) !== part.key
    );
    if (!isReset) nextOverrides.push(next);
    setOverrides(nextOverrides);

    if (patch.board_component_id && patch.edging_component_id === undefined && part.thickness_mm) {
      const pair = await fetchPair(Number(patch.board_component_id), part.thickness_mm);
      if (pair?.edging_component_id) {
        updatePartOverride(part, {
          ...patch,
          edging_component_id: Number(pair.edging_component_id),
          edging_component_name: pair.edging_component_name ?? null,
        });
      }
    }
  }

  function buildValue(): SaveValue {
    const value = Number(surchargeValue || 0);
    return {
      cutlist_primary_material_id: primaryId,
      cutlist_primary_backer_material_id: detail.cutlist_primary_backer_material_id ?? null,
      cutlist_primary_edging_id: edgingId,
      cutlist_part_overrides: overrides,
      cutlist_surcharge_kind: kind,
      cutlist_surcharge_value: Number.isFinite(value) ? value : 0,
      cutlist_surcharge_label: surchargeLabel.trim() || (selectedPrimary ? componentName(selectedPrimary) : null),
    };
  }

  async function collectPairConflicts(value: SaveValue): Promise<PairConflict[]> {
    const triples = new Map<string, { boardId: number; thickness: number; edgingIds: Set<number> }>();
    for (const part of parts) {
      const override = overrideByKey.get(part.key);
      const boardId = override?.board_component_id ?? value.cutlist_primary_material_id;
      const edgeId = override?.edging_component_id ?? value.cutlist_primary_edging_id;
      const thickness = part.thickness_mm;
      if (!boardId || !edgeId || !thickness) continue;
      const key = boardEdgingPairKey(boardId, thickness);
      const current = triples.get(key) ?? { boardId, thickness, edgingIds: new Set<number>() };
      current.edgingIds.add(edgeId);
      triples.set(key, current);
    }

    const nextConflicts: PairConflict[] = [];
    for (const triple of triples.values()) {
      if (triple.edgingIds.size !== 1) continue;
      const nextEdgingId = Array.from(triple.edgingIds)[0];
      const existingPair = await fetchPair(triple.boardId, triple.thickness);
      if (!existingPair) {
        await savePair(triple.boardId, triple.thickness, nextEdgingId);
        continue;
      }
      if (Number(existingPair.edging_component_id) !== nextEdgingId) {
        nextConflicts.push({
          boardId: triple.boardId,
          thickness: triple.thickness,
          boardName: componentName(boardById.get(triple.boardId)),
          existingEdgingName: existingPair.edging_component_name ?? `Edging ${existingPair.edging_component_id}`,
          nextEdgingName: componentName(edgingById.get(nextEdgingId)),
          nextEdgingId,
        });
      }
    }
    return nextConflicts;
  }

  async function handleApply() {
    const value = buildValue();
    const nextConflicts = await collectPairConflicts(value);
    if (nextConflicts.length > 0) {
      setPendingValue(value);
      setConflicts(nextConflicts);
      return;
    }
    onApply(value);
  }

  async function resolveConflicts(updateDefaults: boolean) {
    if (!pendingValue) return;
    if (updateDefaults) {
      for (const conflict of conflicts) {
        await savePair(conflict.boardId, conflict.thickness, conflict.nextEdgingId);
      }
    }
    setConflicts([]);
    setPendingValue(null);
    onApply(pendingValue);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{primaryId ? 'Cutlist material' : 'Pick a cutlist material'}</DialogTitle>
          </DialogHeader>

          {loading ? (
            <div className="flex h-56 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-5 pt-1">
              <section className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Material
                </h3>
                <div className="grid gap-x-4 gap-y-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Primary material</Label>
                    <ComponentCombobox
                      value={primaryId}
                      options={boards}
                      onChange={(id) => applyPrimary(id)}
                      placeholder="Unassigned"
                    />
                    {selectedPrimary?.surcharge_percentage != null && (
                      <p className="text-xs text-muted-foreground">
                        Surcharge tier: {Number(selectedPrimary.surcharge_percentage)}% suggested
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Edging</Label>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <ComponentCombobox
                          value={edgingId}
                          options={edgings}
                          onChange={(id) => {
                            setEdgingId(id);
                            setPaired(false);
                          }}
                          placeholder="Unassigned"
                        />
                      </div>
                      {paired && <Badge variant="secondary" className="h-10 px-3">(paired)</Badge>}
                      <Button type="button" variant="outline" size="icon" onClick={() => { setEdgingId(null); setPaired(false); }} title="Unlink edging">
                        <Unlink className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Surcharge
                </h3>
                <div className="grid gap-x-4 gap-y-4 md:grid-cols-[1fr_120px_1fr]">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Amount</Label>
                    <Input value={surchargeValue} type="number" step="0.01" onChange={(event) => {
                      setSurchargeValue(event.target.value);
                      setSurchargeTouched(true);
                    }} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Kind</Label>
                    <Select value={kind} onValueChange={(value) => setKind(value as 'fixed' | 'percentage')}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fixed">Fixed R</SelectItem>
                        <SelectItem value="percentage">%</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Label</Label>
                    <Input value={surchargeLabel} onChange={(event) => setSurchargeLabel(event.target.value)} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  = {resolvedSurcharge >= 0 ? '+' : '-'} R {Math.abs(resolvedSurcharge).toFixed(2)} on this line
                </p>
              </section>

              <section className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-3">
                <Collapsible open={overridesOpen} onOpenChange={setOverridesOpen}>
                  <div className="flex items-center justify-between gap-3">
                    <CollapsibleTrigger asChild>
                      <Button type="button" variant="ghost" className="h-7 -ml-2 px-2 hover:bg-transparent">
                        {overridesOpen ? <ChevronDown className="mr-2 h-4 w-4" /> : <ChevronRight className="mr-2 h-4 w-4" />}
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Customise per part
                        </span>
                        {overrideCount > 0 && (
                          <Badge variant="secondary" className="ml-2">
                            {overrideCount} {overrideCount === 1 ? 'part override' : 'part overrides'}
                          </Badge>
                        )}
                      </Button>
                    </CollapsibleTrigger>
                    {overrideCount > 0 && (
                      <Button
                        type="button"
                        variant="link"
                        className="h-7 px-0 text-xs"
                        onClick={() => setOverrides([])}
                      >
                        Reset all
                      </Button>
                    )}
                  </div>
                  <CollapsibleContent className="mt-3 max-h-[360px] overflow-auto rounded-md border bg-background">
                    <TooltipProvider>
                      <div className="grid grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_minmax(180px,1fr)_44px] gap-2 border-b bg-muted/50 px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        <span>Part name</span>
                        <span>Board</span>
                        <span>Edging</span>
                        <span />
                      </div>
                      {parts.map((part) => {
                      const override = overrideByKey.get(part.key);
                      const boardValue = override?.board_component_id ?? part.current_board_id ?? primaryId ?? null;
                      const edgingValue = override?.edging_component_id ?? part.current_edging_id ?? edgingId ?? null;
                      return (
                        <div key={part.key} className="grid grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_minmax(180px,1fr)_44px] gap-2 px-3 py-2">
                          <Tooltip>
                            <TooltipTrigger className="truncate text-left text-sm">
                              {part.part_name}
                            </TooltipTrigger>
                            <TooltipContent>{part.length_mm ?? '?'} x {part.width_mm ?? '?'}mm</TooltipContent>
                          </Tooltip>
                          <ComponentCombobox
                            value={boardValue ?? null}
                            options={boards}
                            onChange={(id) => {
                              const board = id != null ? boardById.get(id) : null;
                              updatePartOverride(part, {
                                board_component_id: board?.component_id ?? null,
                                board_component_name: board ? componentName(board) : null,
                              });
                            }}
                            placeholder="Line primary"
                            triggerClassName="h-8 px-3 text-sm"
                          />
                          <ComponentCombobox
                            value={edgingValue ?? null}
                            options={edgings}
                            onChange={(id) => {
                              const edging = id != null ? edgingById.get(id) : null;
                              updatePartOverride(part, {
                                edging_component_id: edging?.component_id ?? null,
                                edging_component_name: edging ? componentName(edging) : null,
                              });
                            }}
                            placeholder="Line edging"
                            triggerClassName="h-8 px-3 text-sm"
                          />
                          <Button type="button" variant="ghost" size="icon" className={cn('h-8 w-8', !override && 'invisible')} onClick={() => updatePartOverride(part, { board_component_id: null, board_component_name: null, edging_component_id: null, edging_component_name: null })}>
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </TooltipProvider>
                </CollapsibleContent>
                </Collapsible>
              </section>
            </div>
          )}

          <DialogFooter className="border-t border-border/50 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="button" onClick={handleApply} disabled={applying || loading || !parts.length}>
              {applying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={conflicts.length > 0} onOpenChange={(nextOpen) => !nextOpen && setConflicts([])}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update edging defaults?</AlertDialogTitle>
            <AlertDialogDescription>
              {conflicts.map((conflict) => (
                <span key={`${conflict.boardId}-${conflict.thickness}`} className="block">
                  {conflict.boardName} ({conflict.thickness}mm): {conflict.existingEdgingName} {'->'} {conflict.nextEdgingName}
                </span>
              ))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => resolveConflicts(false)}>Just this line</AlertDialogCancel>
            <AlertDialogAction onClick={() => resolveConflicts(true)}>Update default</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
