'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Search, X } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

interface ComponentSummary {
  component_id: number;
  internal_code: string;
  description: string | null;
}

interface OverrideRecord {
  replace_component_id: number | null;
  replace_supplier_component_id: number | null;
  quantity_delta: number | null;
  notes: string | null;
  is_cutlist_item: boolean | null;
  cutlist_category: string | null;
  cutlist_dimensions: Record<string, unknown> | null;
  attributes: Record<string, unknown> | null;
}

interface OptionValueDraft extends OverrideRecord {
  option_value_id: number;
  code: string;
  label: string;
  is_default: boolean;
  display_order: number;
}

interface OptionGroupDraft {
  option_group_id: number;
  code: string;
  label: string;
  is_required: boolean;
  display_order: number;
  values: OptionValueDraft[];
}

interface OverridesResponse {
  groups: any[];
  overrides: any[];
}

interface BOMOverrideDialogProps {
  productId: number;
  bomId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseComponent?: ComponentSummary | null;
  components: ComponentSummary[];
}

async function fetchOverrides(productId: number, bomId: number): Promise<OverridesResponse> {
  const res = await fetch(`/api/products/${productId}/options/bom/${bomId}`, { cache: 'no-store' });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || 'Failed to load overrides');
  }
  return res.json();
}

export function BOMOverrideDialog({
  productId,
  bomId,
  open,
  onOpenChange,
  baseComponent,
  components,
}: BOMOverrideDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [componentQuery, setComponentQuery] = useState('');
  const [draftGroups, setDraftGroups] = useState<OptionGroupDraft[]>([]);

  const enabled = open && typeof bomId === 'number';

  const { data, isLoading, error } = useQuery({
    queryKey: ['bomOverrides', productId, bomId],
    queryFn: () => fetchOverrides(productId, bomId as number),
    enabled,
  });

  const overridesByValue = useMemo(() => {
    const map = new Map<number, any>();
    if (data?.overrides) {
      for (const item of data.overrides) {
        map.set(Number(item.option_value_id), item);
      }
    }
    return map;
  }, [data]);

  useEffect(() => {
    if (data?.groups) {
      const transformed: OptionGroupDraft[] = (data.groups as any[]).map((group) => ({
        option_group_id: Number(group.option_group_id),
        code: group.code,
        label: group.label,
        is_required: Boolean(group.is_required),
        display_order: Number(group.display_order ?? 0),
        values: (group.product_option_values ?? []).map((value: any) => {
          const override = overridesByValue.get(Number(value.option_value_id));
          return {
            option_value_id: Number(value.option_value_id),
            code: value.code,
            label: value.label,
            is_default: Boolean(value.is_default),
            display_order: Number(value.display_order ?? 0),
            replace_component_id: override?.replace_component_id ?? null,
            replace_supplier_component_id: override?.replace_supplier_component_id ?? null,
            quantity_delta: override?.quantity_delta != null ? Number(override.quantity_delta) : null,
            notes: override?.notes ?? null,
            is_cutlist_item: override?.is_cutlist_item ?? null,
            cutlist_category: override?.cutlist_category ?? null,
            cutlist_dimensions: override?.cutlist_dimensions ?? null,
            attributes: override?.attributes ?? null,
          } as OptionValueDraft;
        }),
      }));
      setDraftGroups(transformed);
    } else {
      setDraftGroups([]);
    }
  }, [data, overridesByValue]);

  useEffect(() => {
    if (!open) {
      setComponentQuery('');
    }
  }, [open]);

  const saveMutation = useMutation({
    mutationFn: async (payload: { option_value_id: number; data: OverrideRecord }) => {
      const res = await fetch(`/api/products/${productId}/options/bom/${bomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ option_value_id: payload.option_value_id, ...payload.data }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || 'Failed to save override');
      }
      return res.json();
    },
   onSuccess: () => {
     queryClient.invalidateQueries({ queryKey: ['bomOverrides', productId, bomId] });
      queryClient.invalidateQueries({ queryKey: ['effectiveBOM', productId] });
      toast({ title: 'Override saved' });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Error saving override', description: error?.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (optionValueId: number) => {
      const res = await fetch(`/api/products/${productId}/options/bom/${bomId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ option_value_id: optionValueId }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || 'Failed to delete override');
      }
      return res.json();
    },
   onSuccess: () => {
     queryClient.invalidateQueries({ queryKey: ['bomOverrides', productId, bomId] });
      queryClient.invalidateQueries({ queryKey: ['effectiveBOM', productId] });
      toast({ title: 'Override cleared' });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Error clearing override', description: error?.message });
    },
  });

  const filteredComponents = useMemo(() => {
    if (!componentQuery) return components;
    const query = componentQuery.toLowerCase();
    return components.filter((component) => {
      const code = component.internal_code?.toLowerCase() ?? '';
      const desc = component.description?.toLowerCase() ?? '';
      return code.includes(query) || desc.includes(query);
    });
  }, [componentQuery, components]);

  const setDraftValue = (optionValueId: number, updater: (prev: OptionValueDraft) => OptionValueDraft) => {
    setDraftGroups((prev) =>
      prev.map((group) => ({
        ...group,
        values: group.values.map((value) =>
          value.option_value_id === optionValueId ? updater(value) : value
        ),
      }))
    );
  };

  const handleSave = (value: OptionValueDraft) => {
    saveMutation.mutate({
      option_value_id: value.option_value_id,
      data: {
        replace_component_id: value.replace_component_id ?? null,
        replace_supplier_component_id: value.replace_supplier_component_id ?? null,
        quantity_delta: value.quantity_delta ?? null,
        notes: value.notes ?? null,
        is_cutlist_item: value.is_cutlist_item ?? null,
        cutlist_category: value.cutlist_category ?? null,
        cutlist_dimensions: value.cutlist_dimensions ?? null,
        attributes: value.attributes ?? null,
      },
    });
  };

  const handleClear = (value: OptionValueDraft) => {
    deleteMutation.mutate(value.option_value_id);
  };

  const renderComponentPicker = (value: OptionValueDraft) => {
    const selected = value.replace_component_id ? components.find((c) => c.component_id === value.replace_component_id) : null;
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="justify-between w-full h-9 bg-background"
            onClick={() => setComponentQuery('')}
          >
            {selected ? (
              <span>
                {selected.internal_code || 'Component'}
                {selected.description ? <span className="ml-2 text-xs text-muted-foreground">{selected.description}</span> : null}
              </span>
            ) : (
              <span className="text-muted-foreground">Select component</span>
            )}
            <Search className="ml-2 h-4 w-4 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[420px] p-0 border border-border bg-popover text-popover-foreground shadow-xl">
          <Command className="bg-popover">
            <CommandInput
              placeholder="Search code or description…"
              value={componentQuery}
              onValueChange={setComponentQuery}
              className="h-9"
            />
            <CommandList className="max-h-72 overflow-y-auto">
              <CommandEmpty>No components found.</CommandEmpty>
              <CommandGroup>
                {filteredComponents.map((component) => (
                  <CommandItem
                    key={component.component_id}
                    value={component.internal_code || String(component.component_id)}
                    onSelect={() => {
                      setDraftValue(value.option_value_id, (prev) => ({
                        ...prev,
                        replace_component_id: component.component_id,
                      }));
                    }}
                    className={cn(
                      'flex flex-col items-start gap-1 px-3 py-2 text-sm rounded-md',
                      'aria-selected:bg-primary/10 aria-selected:text-primary'
                    )}
                  >
                    <span className="font-medium text-foreground">{component.internal_code || 'Component'}</span>
                    {component.description && (
                      <span className="text-xs text-muted-foreground">{component.description}</span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Configure Option Overrides</DialogTitle>
          <DialogDescription>
            {baseComponent ? (
              <span>
                Map option selections to the BOM row for <strong>{baseComponent.internal_code}</strong>
                {baseComponent.description ? ` – ${baseComponent.description}` : ''}.
              </span>
            ) : (
              'Map option selections to this BOM row.'
            )}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading overrides…
          </div>
        ) : error ? (
          <div className="text-sm text-destructive">{(error as Error).message}</div>
        ) : draftGroups.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6">
            No option groups configured for this product yet. Add option groups in the Options tab first.
          </div>
        ) : (
          <div className="space-y-6 max-h-[65vh] overflow-y-auto pr-1">
            {draftGroups.map((group) => (
              <div key={group.option_group_id} className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium">{group.label}</h4>
                    <p className="text-xs text-muted-foreground">Code: {group.code}</p>
                  </div>
                  <Badge variant={group.is_required ? 'default' : 'outline'}>
                    {group.is_required ? 'Required' : 'Optional'}
                  </Badge>
                </div>

                <div className="space-y-4">
                  {group.values.map((value) => (
                    <div key={value.option_value_id} className="rounded-md border bg-muted/20 p-4 space-y-3">
                      <div className="flex flex-wrap items-center gap-3 justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{value.label}</span>
                            {value.is_default && <Badge>Default</Badge>}
                          </div>
                          <div className="text-xs text-muted-foreground">Code: {value.code}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleClear(value)}
                            disabled={deleteMutation.isLoading}
                          >
                            Clear override
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleSave(value)}
                            disabled={saveMutation.isLoading}
                          >
                            Save
                          </Button>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Replacement component</Label>
                          {renderComponentPicker(value)}
                          {value.replace_component_id && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="mt-1 h-8 px-2 text-xs text-muted-foreground"
                              onClick={() =>
                                setDraftValue(value.option_value_id, (prev) => ({
                                  ...prev,
                                  replace_component_id: null,
                                }))
                              }
                            >
                              <X className="h-3 w-3 mr-1" /> Remove selection
                            </Button>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`qty-${value.option_value_id}`}>Quantity delta</Label>
                          <Input
                            id={`qty-${value.option_value_id}`}
                            type="number"
                            value={value.quantity_delta ?? ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setDraftValue(value.option_value_id, (prev) => ({
                                ...prev,
                                quantity_delta: val === '' ? null : Number(val),
                              }));
                            }}
                            placeholder="e.g., -1 to remove default component"
                          />
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor={`cat-${value.option_value_id}`}>Cutlist category (optional)</Label>
                          <Input
                            id={`cat-${value.option_value_id}`}
                            value={value.cutlist_category ?? ''}
                            onChange={(e) =>
                              setDraftValue(value.option_value_id, (prev) => ({
                                ...prev,
                                cutlist_category: e.target.value || null,
                              }))
                            }
                          />
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id={`cutlist-${value.option_value_id}`}
                            checked={Boolean(value.is_cutlist_item)}
                            onCheckedChange={(checked) =>
                              setDraftValue(value.option_value_id, (prev) => ({
                                ...prev,
                                is_cutlist_item: Boolean(checked),
                              }))
                            }
                          />
                          <Label htmlFor={`cutlist-${value.option_value_id}`} className="text-sm">
                            Treat override as cutlist item
                          </Label>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor={`notes-${value.option_value_id}`}>Notes (optional)</Label>
                        <Textarea
                          id={`notes-${value.option_value_id}`}
                          value={value.notes ?? ''}
                          onChange={(e) =>
                            setDraftValue(value.option_value_id, (prev) => ({
                              ...prev,
                              notes: e.target.value || null,
                            }))
                          }
                          rows={2}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default BOMOverrideDialog;
