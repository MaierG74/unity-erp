'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ChevronsUpDown, Loader2, MinusCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import { formatCurrency, formatQuantity } from '@/lib/format-utils';
import type { BomSnapshotEntry, BomSnapshotSwapKind } from '@/lib/orders/snapshot-types';

type ComponentOption = {
  component_id: number;
  internal_code: string;
  description: string | null;
  category_id: number | null;
  category_name: string | null;
  cheapest_price: number | string | null;
  cheapest_supplier_component_id: number | null;
  cheapest_supplier_name: string | null;
};

export type SwapComponentDialogValue = {
  entry: BomSnapshotEntry;
  surchargeAmount: number;
};

type SwapComponentDialogProps = {
  open: boolean;
  entry: BomSnapshotEntry | null;
  onOpenChange: (open: boolean) => void;
  onApply: (value: SwapComponentDialogValue) => void;
  applying?: boolean;
  downstreamWarning?: boolean;
};

const REMOVE_VALUE = '__remove__';

function toNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function optionLabel(option: ComponentOption | null): string {
  if (!option) return '';
  return option.internal_code || option.description || `Component ${option.component_id}`;
}

export function SwapComponentDialog({
  open,
  entry,
  onOpenChange,
  onApply,
  applying = false,
  downstreamWarning = false,
}: SwapComponentDialogProps) {
  const [options, setOptions] = useState<ComponentOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [selectedValue, setSelectedValue] = useState<string>('');
  const [surchargeInput, setSurchargeInput] = useState('0');
  const [labelInput, setLabelInput] = useState('');
  const [labelTouched, setLabelTouched] = useState(false);

  useEffect(() => {
    if (!open || !entry) return;

    if (entry.swap_kind === 'removed' || entry.is_removed) {
      setSelectedValue(REMOVE_VALUE);
    } else {
      setSelectedValue(String(entry.effective_component_id ?? entry.component_id));
    }
    setSurchargeInput(String(toNumber(entry.surcharge_amount, 0)));
    setLabelInput(entry.surcharge_label || entry.effective_component_code || entry.component_code || '');
    setLabelTouched(Boolean(entry.surcharge_label));
  }, [entry, open]);

  useEffect(() => {
    let cancelled = false;

    async function loadComponents() {
      if (!open || !entry?.category_id) {
        setOptions([]);
        return;
      }

      setLoading(true);
      try {
        const response = await authorizedFetch(`/api/components/by-category/${entry.category_id}`);
        if (!response.ok) throw new Error('Failed to load components');
        const payload = await response.json();
        if (!cancelled) {
          setOptions(Array.isArray(payload?.components) ? payload.components : []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadComponents();
    return () => {
      cancelled = true;
    };
  }, [entry?.category_id, open]);

  const selectedOption = useMemo(
    () => options.find((option) => String(option.component_id) === selectedValue) ?? null,
    [options, selectedValue]
  );

  const swapKind: BomSnapshotSwapKind = selectedValue === REMOVE_VALUE
    ? 'removed'
    : Number(selectedValue) === Number(entry?.default_component_id ?? entry?.component_id)
      ? 'default'
      : 'alternative';

  const effectiveUnitPrice = selectedValue === REMOVE_VALUE
    ? 0
    : toNumber(selectedOption?.cheapest_price, toNumber(entry?.effective_unit_price ?? entry?.unit_price));
  const effectiveQuantity = selectedValue === REMOVE_VALUE ? 0 : toNumber(entry?.quantity_required);
  const defaultUnitPrice = toNumber(entry?.default_unit_price ?? entry?.unit_price);
  const defaultQuantity = toNumber(entry?.quantity_required);
  const costDelta = effectiveUnitPrice * effectiveQuantity - defaultUnitPrice * defaultQuantity;
  const surchargeAmount = toNumber(surchargeInput, 0);

  useEffect(() => {
    if (!entry || labelTouched) return;
    if (selectedValue === REMOVE_VALUE) {
      setLabelInput('(removed)');
    } else if (selectedOption) {
      setLabelInput(optionLabel(selectedOption));
    } else {
      setLabelInput(entry.effective_component_code || entry.component_code || '');
    }
  }, [entry, labelTouched, selectedOption, selectedValue]);

  if (!entry) return null;

  const defaultLabel = entry.default_component_code || entry.component_code || 'Default component';
  const selectedLabel = selectedValue === REMOVE_VALUE
    ? 'None / Remove this component'
    : selectedOption
      ? optionLabel(selectedOption)
      : entry.effective_component_code || entry.component_code || 'Select component';

  const applyDisabled = applying || loading || !selectedValue || !Number.isFinite(surchargeAmount);

  const handleApply = () => {
    if (applyDisabled) return;

    const effectiveComponentId = selectedValue === REMOVE_VALUE
      ? Number(entry.default_component_id ?? entry.component_id)
      : Number(selectedValue);
    const effectiveCode = selectedValue === REMOVE_VALUE
      ? entry.default_component_code || entry.component_code
      : selectedOption?.internal_code || entry.effective_component_code || entry.component_code;

    onApply({
      surchargeAmount,
      entry: {
        ...entry,
        component_id: selectedValue === REMOVE_VALUE ? entry.component_id : effectiveComponentId,
        component_code: selectedValue === REMOVE_VALUE ? entry.component_code : effectiveCode,
        supplier_component_id: selectedValue === REMOVE_VALUE
          ? entry.supplier_component_id
          : selectedOption?.cheapest_supplier_component_id ?? entry.supplier_component_id,
        supplier_name: selectedValue === REMOVE_VALUE
          ? entry.supplier_name
          : selectedOption?.cheapest_supplier_name ?? entry.supplier_name,
        unit_price: selectedValue === REMOVE_VALUE ? 0 : effectiveUnitPrice,
        line_total: selectedValue === REMOVE_VALUE ? 0 : effectiveUnitPrice * defaultQuantity,
        swap_kind: swapKind,
        is_removed: swapKind === 'removed',
        effective_component_id: effectiveComponentId,
        effective_component_code: effectiveCode,
        effective_quantity_required: effectiveQuantity,
        effective_unit_price: effectiveUnitPrice,
        effective_line_total: effectiveUnitPrice * effectiveQuantity,
        default_unit_price: defaultUnitPrice,
        surcharge_amount: Math.round(surchargeAmount * 100) / 100,
        surcharge_label: labelInput.trim() || null,
        is_substituted: swapKind !== 'default',
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Swap component</DialogTitle>
          <DialogDescription>
            Change the operational BOM component and add an optional commercial surcharge.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {downstreamWarning && (
            <div className="flex gap-3 rounded-md border border-yellow-500/40 bg-yellow-50 px-3 py-2 text-sm text-yellow-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" />
              <p>
                <strong>Components for this line have already been ordered/scheduled.</strong>{' '}
                Swapping will create a production exception that must be resolved by purchasing or production. Continue?
              </p>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-[96px_1fr_auto] sm:items-center">
            <Label>Default</Label>
            <div className="rounded border bg-muted/40 px-3 py-2 text-sm font-medium">
              {defaultLabel}
            </div>
            <div className="text-sm text-muted-foreground tabular-nums">
              {formatCurrency(defaultUnitPrice)} each
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-[96px_1fr] sm:items-start">
            <Label className="pt-2">Swap to</Label>
            <Popover modal open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  className="justify-between"
                  disabled={!entry.category_id}
                >
                  <span className="truncate">{selectedLabel}</span>
                  {loading ? (
                    <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin" />
                  ) : (
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search components..." />
                  <CommandList className="max-h-[260px] overscroll-contain">
                    <CommandEmpty>No components found.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value="None Remove this component"
                        onSelect={() => {
                          setSelectedValue(REMOVE_VALUE);
                          setLabelTouched(false);
                          setPopoverOpen(false);
                        }}
                      >
                        <MinusCircle className="mr-2 h-4 w-4 text-muted-foreground" />
                        <span>None / Remove this component</span>
                        {selectedValue === REMOVE_VALUE && <Check className="ml-auto h-4 w-4" />}
                      </CommandItem>
                    </CommandGroup>
                    <CommandSeparator />
                    <CommandGroup>
                      {options.map((option) => (
                        <CommandItem
                          key={option.component_id}
                          value={`${option.internal_code} ${option.description ?? ''}`}
                          onSelect={() => {
                            setSelectedValue(String(option.component_id));
                            setLabelTouched(false);
                            setPopoverOpen(false);
                          }}
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium">{optionLabel(option)}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {option.description || option.cheapest_supplier_name || 'No description'}
                            </div>
                          </div>
                          <div className="ml-auto pl-3 text-xs tabular-nums text-muted-foreground">
                            {formatCurrency(toNumber(option.cheapest_price, 0))}
                          </div>
                          {selectedValue === String(option.component_id) && (
                            <Check className="ml-2 h-4 w-4" />
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="grid gap-2 sm:grid-cols-[96px_1fr] sm:items-center">
            <Label>Cost delta</Label>
            <div
              className={cn(
                'text-sm font-semibold tabular-nums',
                costDelta > 0 ? 'text-emerald-700' : costDelta < 0 ? 'text-red-700' : 'text-muted-foreground'
              )}
            >
              {costDelta >= 0 ? '+' : '-'}{formatCurrency(Math.abs(costDelta))}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {formatQuantity(effectiveQuantity)} x {formatCurrency(effectiveUnitPrice)}
              </span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[96px_140px_1fr] sm:items-end">
            <Label htmlFor="swap-surcharge" className="sm:pb-2">Surcharge</Label>
            <div>
              <div className="flex items-center rounded-md border bg-background px-2">
                <span className="text-sm text-muted-foreground">R</span>
                <Input
                  id="swap-surcharge"
                  type="number"
                  step="0.01"
                  value={surchargeInput}
                  onChange={(event) => setSurchargeInput(event.target.value)}
                  className="border-0 text-right shadow-none focus-visible:ring-0"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="swap-label" className="mb-2 block text-xs text-muted-foreground">
                Label
              </Label>
              <Input
                id="swap-label"
                value={labelInput}
                onChange={(event) => {
                  setLabelTouched(true);
                  setLabelInput(event.target.value);
                }}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
            Cancel
          </Button>
          <Button type="button" onClick={handleApply} disabled={applyDisabled}>
            {applying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Apply swap
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
