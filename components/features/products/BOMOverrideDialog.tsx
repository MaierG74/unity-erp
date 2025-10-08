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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Search, X, ChevronDown } from 'lucide-react';
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

type OverrideSource = 'product' | 'set';

interface OptionValueDraft extends OverrideRecord {
  id: string;
  source: OverrideSource;
  option_value_id?: number;
  option_set_value_id?: number;
  code: string;
  label: string;
  display_label: string;
  alias_label?: string | null;
  hidden?: boolean;
  is_default: boolean;
  display_order: number;
  default_component_id?: number | null;
  default_supplier_component_id?: number | null;
  default_quantity_delta?: number | null;
  default_notes?: string | null;
  default_is_cutlist?: boolean | null;
  default_cutlist_category?: string | null;
  default_cutlist_dimensions?: Record<string, unknown> | null;
}

interface OptionGroupDraft {
  id: string;
  source: OverrideSource;
  option_group_id?: number;
  option_set_group_id?: number;
  link_id?: number;
  code: string;
  label: string;
  display_label: string;
  is_required: boolean;
  hidden?: boolean;
  display_order: number;
  values: OptionValueDraft[];
}

interface OverridesResponse {
  product_groups: any[];
  option_sets: any[];
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
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [expandedValues, setExpandedValues] = useState<Record<string, boolean>>({});
  const [openPickerFor, setOpenPickerFor] = useState<string | null>(null);
  const [pendingSaveId, setPendingSaveId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const enabled = open && typeof bomId === 'number';

  const { data, isLoading, error } = useQuery({
    queryKey: ['bomOverrides', productId, bomId],
    queryFn: () => fetchOverrides(productId, bomId as number),
    enabled,
  });

  const { productOverrides, optionSetOverrides } = useMemo(() => {
    const productMap = new Map<number, any>();
    const setMap = new Map<number, any>();
    if (data?.overrides) {
      for (const item of data.overrides) {
        if (item.option_value_id != null) {
          productMap.set(Number(item.option_value_id), item);
        }
        if (item.option_set_value_id != null) {
          setMap.set(Number(item.option_set_value_id), item);
        }
      }
    }
    return { productOverrides: productMap, optionSetOverrides: setMap };
  }, [data]);

  const hasOverrideData = (value: OptionValueDraft) =>
    Boolean(
      value.replace_component_id != null ||
        value.replace_supplier_component_id != null ||
        value.quantity_delta != null ||
        value.notes ||
        value.is_cutlist_item != null ||
        value.cutlist_category ||
        value.cutlist_dimensions
    );

useEffect(() => {
  if (!data) {
    setDraftGroups([]);
    setExpandedGroups({});
    setExpandedValues({});
    return;
  }

  const productGroups: OptionGroupDraft[] = (data.product_groups ?? []).map((group: any) => ({
    id: `product:${group.option_group_id}`,
    source: 'product',
    option_group_id: Number(group.option_group_id),
    code: group.code,
    label: group.label,
    display_label: group.label,
    is_required: Boolean(group.is_required),
    hidden: false,
    display_order: Number(group.display_order ?? 0),
    values: (group.product_option_values ?? []).map((value: any) => {
      const override = productOverrides.get(Number(value.option_value_id));
      return {
        id: `product:${value.option_value_id}`,
        source: 'product',
        option_value_id: Number(value.option_value_id),
        code: value.code,
        label: value.label,
        display_label: value.label,
        alias_label: null,
        hidden: false,
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

  const optionSetGroups: OptionGroupDraft[] = [];
  for (const link of data.option_sets ?? []) {
    const linkId = Number(link.link_id);
    const groupOverlays = link.group_overlays ?? [];
    const valueOverlays = link.value_overlays ?? [];
    const groups = link.option_set?.groups ?? [];

    for (const group of groups) {
      const overlay = groupOverlays.find((item: any) => Number(item.option_set_group_id) === Number(group.option_set_group_id));
      const displayLabel = overlay?.alias_label?.length ? overlay.alias_label : group.label;
      const groupHidden = overlay?.hide ?? false;
      const isRequired = overlay?.is_required != null ? Boolean(overlay.is_required) : Boolean(group.is_required);
      const baseOrder = Number(group.display_order ?? 0);
      const linkOrder = Number(link.display_order ?? 0);
      const combinedOrder = linkOrder * 1000 + baseOrder;

      const values: OptionValueDraft[] = (group.values ?? []).map((value: any) => {
        const valueOverlay = valueOverlays.find((item: any) => Number(item.option_set_value_id) === Number(value.option_set_value_id));
        const displayValueLabel = valueOverlay?.alias_label?.length ? valueOverlay.alias_label : value.label;
        const valueHidden = valueOverlay?.hide ?? false;
        const override = optionSetOverrides.get(Number(value.option_set_value_id));
        return {
          id: `set:${value.option_set_value_id}`,
          source: 'set',
          option_set_value_id: Number(value.option_set_value_id),
          code: value.code,
          label: value.label,
          display_label: displayValueLabel,
          alias_label: valueOverlay?.alias_label ?? null,
          hidden: valueHidden,
          is_default: Boolean(value.is_default),
          display_order: Number(value.display_order ?? 0),
          replace_component_id: override?.replace_component_id ?? value.default_component_id ?? null,
          replace_supplier_component_id: override?.replace_supplier_component_id ?? value.default_supplier_component_id ?? null,
          quantity_delta:
            override?.quantity_delta != null
              ? Number(override.quantity_delta)
              : value.default_quantity_delta != null
              ? Number(value.default_quantity_delta)
              : null,
          notes: override?.notes ?? value.default_notes ?? null,
          is_cutlist_item:
            override?.is_cutlist_item != null
              ? override.is_cutlist_item
              : value.default_is_cutlist != null
              ? Boolean(value.default_is_cutlist)
              : null,
          cutlist_category: override?.cutlist_category ?? value.default_cutlist_category ?? null,
          cutlist_dimensions: override?.cutlist_dimensions ?? value.default_cutlist_dimensions ?? null,
          default_component_id: value.default_component_id ?? null,
          default_supplier_component_id: value.default_supplier_component_id ?? null,
          default_quantity_delta: value.default_quantity_delta ?? null,
          default_notes: value.default_notes ?? null,
          default_is_cutlist: value.default_is_cutlist ?? null,
          default_cutlist_category: value.default_cutlist_category ?? null,
          default_cutlist_dimensions: value.default_cutlist_dimensions ?? null,
        } as OptionValueDraft;
      });

      optionSetGroups.push({
        id: `set:${linkId}:${group.option_set_group_id}`,
        source: 'set',
        link_id: linkId,
        option_set_group_id: Number(group.option_set_group_id),
        code: group.code,
        label: group.label,
        display_label: displayLabel,
        is_required: isRequired,
        hidden: groupHidden,
        display_order: combinedOrder,
        values,
      });
    }
  }

  const combined = [...productGroups, ...optionSetGroups].sort((a, b) => {
    if (a.source !== b.source) return a.source === 'product' ? -1 : 1;
    if (a.display_order !== b.display_order) return a.display_order - b.display_order;
    return a.id.localeCompare(b.id);
  });

  setDraftGroups(combined);

  setExpandedGroups((prev) => {
    const next: Record<string, boolean> = { ...prev };
    for (const group of combined) {
      if (!(group.id in next)) {
        const configured = group.values.some((value) => hasOverrideData(value));
        next[group.id] = configured;
      }
    }
    return next;
  });

  setExpandedValues((prev) => {
    const next: Record<string, boolean> = { ...prev };
    for (const group of combined) {
      for (const value of group.values) {
        if (!(value.id in next)) {
          next[value.id] = hasOverrideData(value);
        }
      }
    }
    return next;
  });
}, [data, productOverrides, optionSetOverrides]);

  useEffect(() => {
    if (!open) {
      setComponentQuery('');
      setOpenPickerFor(null);
    }
  }, [open]);

  const saveMutation = useMutation({
    mutationFn: async ({ value, componentLabel }: { value: OptionValueDraft; componentLabel: string }) => {
      const payload: Record<string, any> = {
        replace_component_id: value.replace_component_id ?? null,
        replace_supplier_component_id: value.replace_supplier_component_id ?? null,
        quantity_delta: value.quantity_delta ?? null,
        notes: value.notes ?? null,
        is_cutlist_item: value.is_cutlist_item ?? null,
        cutlist_category: value.cutlist_category ?? null,
        cutlist_dimensions: value.cutlist_dimensions ?? null,
        attributes: value.attributes ?? null,
      };
      if (value.option_value_id != null) {
        payload.option_value_id = value.option_value_id;
      }
      if (value.option_set_value_id != null) {
        payload.option_set_value_id = value.option_set_value_id;
      }

      const res = await fetch(`/api/products/${productId}/options/bom/${bomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || 'Failed to save override');
      }
      return res.json();
    },
    onMutate: ({ value }) => {
      setPendingSaveId(value.id);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['bomOverrides', productId, bomId] });
      queryClient.invalidateQueries({ queryKey: ['effectiveBOM', productId] });
      toast({
        title: 'Override saved',
        description: `${variables.value.display_label} now uses ${variables.componentLabel}`,
      });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Error saving override', description: error?.message });
    },
    onSettled: () => {
      setPendingSaveId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (value: OptionValueDraft) => {
      const body: Record<string, any> = {};
      if (value.option_value_id != null) body.option_value_id = value.option_value_id;
      if (value.option_set_value_id != null) body.option_set_value_id = value.option_set_value_id;
      const res = await fetch(`/api/products/${productId}/options/bom/${bomId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || 'Failed to delete override');
      }
      return res.json();
    },
    onMutate: (value) => {
      setPendingDeleteId(value.id);
    },
    onSuccess: (_data, value) => {
      queryClient.invalidateQueries({ queryKey: ['bomOverrides', productId, bomId] });
      queryClient.invalidateQueries({ queryKey: ['effectiveBOM', productId] });
      toast({
        title: 'Override cleared',
        description: `${value.display_label} reverted to base BOM row`,
      });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Error clearing override', description: error?.message });
    },
    onSettled: () => {
      setPendingDeleteId(null);
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

  const setDraftValue = (valueId: string, updater: (prev: OptionValueDraft) => OptionValueDraft) => {
    setDraftGroups((prev) =>
      prev.map((group) => ({
        ...group,
        values: group.values.map((value) => (value.id === valueId ? updater(value) : value)),
      }))
    );
  };

  const handleSave = (value: OptionValueDraft) => {
    if (!hasChanged(value)) {
      toast({ title: 'No changes to save', description: `${value.display_label} is already up to date.` });
      return;
    }
    if (value.option_value_id == null && value.option_set_value_id == null) {
      toast({ variant: 'destructive', title: 'Unable to save override', description: 'Missing option identifier.' });
      return;
    }
    const componentLabel = value.replace_component_id
      ? components.find((c) => c.component_id === value.replace_component_id)?.internal_code || 'selected component'
      : 'base BOM row';
    saveMutation.mutate({ value, componentLabel });
  };

  const handleClear = (value: OptionValueDraft) => {
    if (value.option_value_id == null && value.option_set_value_id == null) {
      toast({ variant: 'destructive', title: 'Unable to clear override', description: 'Missing option identifier.' });
      return;
    }
    deleteMutation.mutate(value);
  };

  const getExistingOverride = (value: OptionValueDraft) => {
    if (value.source === 'product' && value.option_value_id != null) {
      return productOverrides.get(value.option_value_id) ?? null;
    }
    if (value.source === 'set' && value.option_set_value_id != null) {
      return optionSetOverrides.get(value.option_set_value_id) ?? null;
    }
    return null;
  };

  const hasChanged = (value: OptionValueDraft) => {
    const current = getExistingOverride(value);
    if (!current) {
      return (
        value.replace_component_id != null ||
        value.replace_supplier_component_id != null ||
        value.quantity_delta != null ||
        value.notes ||
        value.is_cutlist_item != null ||
        value.cutlist_category
      );
    }
    return (
      current.replace_component_id !== (value.replace_component_id ?? null) ||
      current.replace_supplier_component_id !== (value.replace_supplier_component_id ?? null) ||
      Number(current.quantity_delta ?? null) !== (value.quantity_delta ?? null) ||
      (current.notes ?? null) !== (value.notes ?? null) ||
      (current.is_cutlist_item ?? null) !== (value.is_cutlist_item ?? null) ||
      (current.cutlist_category ?? null) !== (value.cutlist_category ?? null)
    );
  };

  const renderComponentPicker = (value: OptionValueDraft) => {
    const selected = value.replace_component_id ? components.find((c) => c.component_id === value.replace_component_id) : null;
    const popoverOpen = openPickerFor === value.id;
    return (
      <Popover
        open={popoverOpen}
        onOpenChange={(next) => {
          if (next) {
            setComponentQuery('');
            setOpenPickerFor(value.id);
          } else if (openPickerFor === value.id) {
            setOpenPickerFor(null);
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="justify-between w-full h-9 bg-background"
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
        <PopoverContent className="z-[80] w-[420px] border border-border bg-popover text-popover-foreground shadow-xl" align="start" sideOffset={4}>
          <div className="p-2">
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                placeholder="Search code or description…"
                value={componentQuery}
                onChange={(e) => setComponentQuery(e.target.value)}
                className="h-9 w-full pl-9"
              />
            </div>
            <div className="max-h-64 overflow-y-auto">
              {filteredComponents.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">No components found.</div>
              ) : (
                <ul className="space-y-1">
                  {filteredComponents.map((component) => (
                    <li key={component.component_id}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setDraftValue(value.id, (prev) => ({
                            ...prev,
                            replace_component_id: component.component_id,
                          }));
                          setOpenPickerFor(null);
                        }}
                        className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted focus:bg-muted"
                      >
                        <div className="font-medium text-foreground">{component.internal_code || 'Component'}</div>
                        {component.description && (
                          <div className="text-xs text-muted-foreground">{component.description}</div>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    );
  };

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupId]: !(prev[groupId] ?? true),
    }));
  };

  const toggleValue = (valueId: string) => {
    setExpandedValues((prev) => ({
      ...prev,
      [valueId]: !(prev[valueId] ?? false),
    }));
  };

  const valueSummary = (value: OptionValueDraft) => {
    const parts: string[] = [];
    if (value.replace_component_id) {
      const component = components.find((c) => c.component_id === value.replace_component_id);
      if (component) {
        parts.push(component.internal_code || 'Replacement component');
      }
    }
    if (value.quantity_delta != null && value.quantity_delta !== 0) {
      parts.push(`Qty Δ ${value.quantity_delta}`);
    }
    if (value.is_cutlist_item) {
      parts.push('Cutlist');
    }
    return parts.length > 0 ? parts.join(' • ') : 'Uses base BOM row';
  };

  const groupSummary = (group: OptionGroupDraft) => {
    const total = group.values.length;
    const configured = group.values.filter(hasOverrideData).length;
    if (configured === 0) return `${total} value${total === 1 ? '' : 's'}`;
    if (configured === total) return `All ${total} configured`;
    return `${configured} of ${total} configured`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        {openPickerFor !== null && (
          <div className="pointer-events-none fixed inset-0 z-40 bg-background/70 backdrop-blur-sm" />
        )}
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
            {draftGroups.map((group) => {
              const groupOpen = expandedGroups[group.id] ?? true;
              return (
                <div key={group.id} className="rounded-lg border bg-background">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg bg-card px-4 py-4 shadow-sm"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-foreground">{group.display_label}</h4>
                        <Badge variant={group.is_required ? 'default' : 'outline'}>
                          {group.is_required ? 'Required' : 'Optional'}
                        </Badge>
                        {group.source === 'set' && <Badge variant="secondary">Option set</Badge>}
                        {group.hidden && <Badge variant="destructive">Hidden</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{groupSummary(group)}</p>
                    </div>
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                        groupOpen ? 'rotate-180' : 'rotate-0'
                      )}
                    />
                  </button>

                  {groupOpen && (
                    <div className="space-y-3 border-t border-border bg-muted/20 px-3 py-3">
                      {group.values.map((value) => {
                        const valueOpen = expandedValues[value.id] ?? false;
                        return (
                          <div key={value.id} className="rounded-md border bg-muted/10">
                            <button
                              type="button"
                              onClick={() => toggleValue(value.id)}
                              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                            >
                              <div>
                                <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground">{value.display_label}</span>
                              {value.is_default && <Badge>Default</Badge>}
                              {value.hidden && <Badge variant="destructive">Hidden</Badge>}
                            </div>
                            <div className="text-xs text-muted-foreground">{valueSummary(value)}</div>
                          </div>
                          <ChevronDown
                            className={cn(
                              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                              valueOpen ? 'rotate-180' : 'rotate-0'
                            )}
                          />
                        </button>

                        {valueOpen && (
                          <div className="space-y-4 border-t border-border bg-card/80 px-4 py-4">
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleClear(value)}
                                disabled={pendingDeleteId === value.id}
                              >
                                {pendingDeleteId === value.id ? (
                                  <span className="flex items-center gap-1">
                                    <Loader2 className="h-3 w-3 animate-spin" /> Clearing…
                                  </span>
                                ) : (
                                  'Clear override'
                                )}
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => handleSave(value)}
                                disabled={pendingSaveId === value.id || !hasChanged(value)}
                              >
                                {pendingSaveId === value.id ? (
                                  <span className="flex items-center gap-1">
                                    <Loader2 className="h-3 w-3 animate-spin" /> Saving…
                                  </span>
                                ) : hasChanged(value) ? (
                                  'Save'
                                ) : (
                                  'Saved'
                                )}
                              </Button>
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
                                      setDraftValue(value.id, (prev) => ({
                                        ...prev,
                                        replace_component_id: null,
                                      }))
                                    }
                                  >
                                    <X className="mr-1 h-3 w-3" /> Remove selection
                                  </Button>
                                )}
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor={`qty-${value.id}`}>Quantity delta</Label>
                                <Input
                                  id={`qty-${value.id}`}
                                  type="number"
                                  value={value.quantity_delta ?? ''}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setDraftValue(value.id, (prev) => ({
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
                                <Label htmlFor={`cat-${value.id}`}>Cutlist category (optional)</Label>
                                <Input
                                  id={`cat-${value.id}`}
                                  value={value.cutlist_category ?? ''}
                                  onChange={(e) =>
                                    setDraftValue(value.id, (prev) => ({
                                      ...prev,
                                      cutlist_category: e.target.value || null,
                                    }))
                                  }
                                />
                              </div>
                              <div className="flex items-center space-x-2">
                                <Checkbox
                                  id={`cutlist-${value.id}`}
                                  checked={Boolean(value.is_cutlist_item)}
                                  onCheckedChange={(checked) =>
                                    setDraftValue(value.id, (prev) => ({
                                      ...prev,
                                      is_cutlist_item: Boolean(checked),
                                    }))
                                  }
                                />
                                <Label htmlFor={`cutlist-${value.id}`} className="text-sm">
                                  Treat override as cutlist item
                                </Label>
                              </div>
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor={`notes-${value.id}`}>Notes (optional)</Label>
                              <Textarea
                                id={`notes-${value.id}`}
                                value={value.notes ?? ''}
                                onChange={(e) =>
                                  setDraftValue(value.id, (prev) => ({
                                    ...prev,
                                    notes: e.target.value || null,
                                  }))
                                }
                                rows={2}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
            </div>
                  )}
                </div>
              );
            })}
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
