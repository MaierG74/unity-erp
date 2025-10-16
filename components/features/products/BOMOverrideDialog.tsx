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
import {
  CUTLIST_DIMENSIONS_TEMPLATE,
  validateCutlistDimensions,
  summariseCutlistDimensions,
  cloneCutlistDimensions,
  areCutlistDimensionsEqual,
} from '@/lib/cutlist/cutlistDimensions';
import type { CutlistDimensions } from '@/lib/cutlist/cutlistDimensions';

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
  cutlist_dimensions: CutlistDimensions | null;
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
  default_cutlist_dimensions?: CutlistDimensions | null;
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

interface CutlistEditorState {
  open: boolean;
  text: string;
  errors: string[];
  warnings: string[];
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
  const [cutlistEditors, setCutlistEditors] = useState<Record<string, CutlistEditorState>>({});

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
    setCutlistEditors({});
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
      const overrideNotes =
        typeof override?.notes === 'string' && override.notes.trim().length > 0 ? override.notes.trim() : null;
      const overrideCategory =
        typeof override?.cutlist_category === 'string' && override.cutlist_category.trim().length > 0
          ? override.cutlist_category.trim()
          : null;
      const overrideCutlistDimensions = cloneCutlistDimensions(override?.cutlist_dimensions);
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
        notes: overrideNotes,
        is_cutlist_item: override?.is_cutlist_item ?? null,
        cutlist_category: overrideCategory ?? null,
        cutlist_dimensions: overrideCutlistDimensions,
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

        const normalizedDefaultNotes =
          typeof value.default_notes === 'string' && value.default_notes.trim().length > 0
            ? value.default_notes.trim()
            : null;
        const normalizedDefaultCategory =
          typeof value.default_cutlist_category === 'string' && value.default_cutlist_category.trim().length > 0
            ? value.default_cutlist_category.trim()
            : null;
        const defaultCutlistDimensions = cloneCutlistDimensions(value.default_cutlist_dimensions);
        const overrideCutlistDimensions = cloneCutlistDimensions(override?.cutlist_dimensions);
        const resolvedCutlistDimensions =
          overrideCutlistDimensions ?? (defaultCutlistDimensions ? cloneCutlistDimensions(defaultCutlistDimensions) : null);
        const resolvedQuantityDelta =
          override?.quantity_delta != null
            ? Number(override.quantity_delta)
            : value.default_quantity_delta != null
            ? Number(value.default_quantity_delta)
            : null;
        const overrideNotesNormalized =
          typeof override?.notes === 'string' && override.notes.trim().length > 0 ? override.notes.trim() : null;
        const resolvedNotes = overrideNotesNormalized ?? normalizedDefaultNotes;
        const overrideCategoryNormalized =
          typeof override?.cutlist_category === 'string' && override.cutlist_category.trim().length > 0
            ? override.cutlist_category.trim()
            : null;
        const resolvedCutlistCategory = overrideCategoryNormalized ?? normalizedDefaultCategory ?? null;
        const resolvedIsCutlist =
          override?.is_cutlist_item != null
            ? override.is_cutlist_item
            : value.default_is_cutlist != null
            ? Boolean(value.default_is_cutlist)
            : null;

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
          quantity_delta: resolvedQuantityDelta,
          notes: resolvedNotes,
          is_cutlist_item: resolvedIsCutlist,
          cutlist_category: resolvedCutlistCategory,
          cutlist_dimensions: resolvedCutlistDimensions,
          default_component_id: value.default_component_id ?? null,
          default_supplier_component_id: value.default_supplier_component_id ?? null,
          default_quantity_delta: value.default_quantity_delta != null ? Number(value.default_quantity_delta) : null,
          default_notes: normalizedDefaultNotes,
          default_is_cutlist: value.default_is_cutlist ?? null,
          default_cutlist_category: normalizedDefaultCategory,
          default_cutlist_dimensions: defaultCutlistDimensions,
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
    setCutlistEditors({});
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
        value.cutlist_category ||
        value.cutlist_dimensions != null
      );
    }
    return (
      current.replace_component_id !== (value.replace_component_id ?? null) ||
      current.replace_supplier_component_id !== (value.replace_supplier_component_id ?? null) ||
      Number(current.quantity_delta ?? null) !== (value.quantity_delta ?? null) ||
      (current.notes ?? null) !== (value.notes ?? null) ||
      (current.is_cutlist_item ?? null) !== (value.is_cutlist_item ?? null) ||
      (current.cutlist_category ?? null) !== (value.cutlist_category ?? null) ||
      !areCutlistDimensionsEqual(
        (current.cutlist_dimensions as CutlistDimensions | null | undefined) ?? null,
        value.cutlist_dimensions ?? null
      )
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

  const getCutlistEditorState = (valueId: string): CutlistEditorState => {
    const existing = cutlistEditors[valueId];
    return existing ?? { open: false, text: '', errors: [], warnings: [] };
  };

  const openCutlistEditor = (value: OptionValueDraft) => {
    const current = getCutlistEditorState(value.id);
    const nextText =
      value.cutlist_dimensions && Object.keys(value.cutlist_dimensions).length > 0
        ? JSON.stringify(value.cutlist_dimensions, null, 2)
        : '';
    setCutlistEditors((prev) => ({
      ...prev,
      [value.id]: { ...current, open: true, text: nextText, errors: [], warnings: [] },
    }));
  };

  const closeCutlistEditor = (valueId: string) => {
    const current = getCutlistEditorState(valueId);
    if (!current.open && current.errors.length === 0 && current.warnings.length === 0 && current.text === '') {
      setCutlistEditors((prev) => {
        if (!prev[valueId]) return prev;
        const next = { ...prev };
        delete next[valueId];
        return next;
      });
      return;
    }
    setCutlistEditors((prev) => ({
      ...prev,
      [valueId]: { ...current, open: false },
    }));
  };

  const setCutlistEditorText = (valueId: string, text: string) => {
    const current = getCutlistEditorState(valueId);
    setCutlistEditors((prev) => ({
      ...prev,
      [valueId]: { ...current, text, errors: [], warnings: [] },
    }));
  };

  const setCutlistEditorErrors = (valueId: string, errors: string[], warnings: string[] = []) => {
    const current = getCutlistEditorState(valueId);
    setCutlistEditors((prev) => ({
      ...prev,
      [valueId]: { ...current, errors, warnings },
    }));
  };

  const insertCutlistTemplate = (valueId: string) => {
    const current = getCutlistEditorState(valueId);
    setCutlistEditors((prev) => ({
      ...prev,
      [valueId]: { ...current, open: true, text: CUTLIST_DIMENSIONS_TEMPLATE, errors: [], warnings: [] },
    }));
  };

  const formatCutlistJson = (value: OptionValueDraft) => {
    const editor = getCutlistEditorState(value.id);
    const trimmed = editor.text.trim();
    if (!trimmed) {
      setCutlistEditorErrors(value.id, ['Nothing to format.']);
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      setCutlistEditors((prev) => ({
        ...prev,
        [value.id]: {
          ...editor,
          text: JSON.stringify(parsed, null, 2),
          errors: [],
          warnings: [],
        },
      }));
    } catch (error: any) {
      setCutlistEditorErrors(value.id, ['Cutlist JSON must be valid before formatting.']);
    }
  };

  const applyCutlistEditor = (value: OptionValueDraft) => {
    const editor = getCutlistEditorState(value.id);
    const trimmed = editor.text.trim();
    const requireDimensions =
      value.is_cutlist_item === true || (value.is_cutlist_item === null && value.default_is_cutlist === true);

    if (!trimmed) {
      if (requireDimensions) {
        setCutlistEditorErrors(value.id, ['Cutlist dimensions are required when this override is marked as cutlist.']);
        return;
      }
      setDraftValue(value.id, (prev) => ({
        ...prev,
        cutlist_dimensions: null,
      }));
      setCutlistEditors((prev) => ({
        ...prev,
        [value.id]: { open: false, text: '', errors: [], warnings: [] },
      }));
      toast({
        title: 'Cutlist cleared',
        description: `${value.display_label} no longer has custom cutlist dimensions.`,
      });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error: any) {
      setCutlistEditorErrors(value.id, ['Cutlist JSON is invalid. Fix the syntax before saving.']);
      return;
    }

    const validation = validateCutlistDimensions(parsed, { requireDimensions });
    if (!validation.valid || !validation.value) {
      const errors = validation.errors.length > 0 ? validation.errors : ['Cutlist JSON is invalid.'];
      setCutlistEditorErrors(value.id, errors, validation.warnings);
      return;
    }

    const cloned = cloneCutlistDimensions(validation.value);
    setDraftValue(value.id, (prev) => ({
      ...prev,
      cutlist_dimensions: cloned,
    }));
    setCutlistEditors((prev) => ({
      ...prev,
      [value.id]: {
        open: false,
        text: JSON.stringify(validation.value, null, 2),
        errors: [],
        warnings: validation.warnings,
      },
    }));
    toast({
      title: 'Cutlist details updated',
      description: `${value.display_label} now uses the updated cutlist payload.`,
    });
  };

  const clearCutlistDimensions = (value: OptionValueDraft) => {
    setDraftValue(value.id, (prev) => ({
      ...prev,
      cutlist_dimensions: null,
    }));
    setCutlistEditors((prev) => ({
      ...prev,
      [value.id]: { open: false, text: '', errors: [], warnings: [] },
    }));
    const requireDimensions =
      value.is_cutlist_item === true || (value.is_cutlist_item === null && value.default_is_cutlist === true);
    toast({
      title: 'Cutlist cleared',
      description: requireDimensions
        ? `${value.display_label} is still marked as cutlist—add dimensions before exporting.`
        : `${value.display_label} no longer has custom cutlist dimensions.`,
    });
  };

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupId]: !(prev[groupId] ?? true),
    }));
  };

  const toggleValue = (valueId: string) => {
    setExpandedValues((prev) => {
      const currentlyOpen = prev[valueId] ?? false;
      if (currentlyOpen) {
        closeCutlistEditor(valueId);
      }
      return {
        ...prev,
        [valueId]: !currentlyOpen,
      };
    });
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
    const currentCutlistSummary = summariseCutlistDimensions(value.cutlist_dimensions ?? null);
    if (currentCutlistSummary.headline) {
      parts.push(currentCutlistSummary.headline);
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
                        const defaultOverrideSnapshot = {
                          replace_component_id: value.default_component_id ?? null,
                          replace_supplier_component_id: value.default_supplier_component_id ?? null,
                          quantity_delta: value.default_quantity_delta ?? null,
                          notes: value.default_notes ?? null,
                          is_cutlist_item: value.default_is_cutlist ?? null,
                          cutlist_category: value.default_cutlist_category ?? null,
                          cutlist_dimensions: value.default_cutlist_dimensions ?? null,
                        };
                        const defaultCutlistDimensions = defaultOverrideSnapshot.cutlist_dimensions;
                        const defaultCutlistSummary = summariseCutlistDimensions(defaultCutlistDimensions);
                        const defaultComponent =
                          value.default_component_id != null
                            ? components.find((c) => c.component_id === value.default_component_id) ?? null
                            : null;
                        const defaultComponentLabel =
                          value.default_component_id != null
                            ? defaultComponent
                              ? `${defaultComponent.internal_code || `Component #${value.default_component_id}`}${
                                  defaultComponent.description ? ` – ${defaultComponent.description}` : ''
                                }`
                              : `Component #${value.default_component_id}`
                            : 'Base BOM component';
                        const defaultSupplierLabel =
                          value.default_supplier_component_id != null
                            ? `Supplier component #${value.default_supplier_component_id}`
                            : null;
                        const defaultCutlistCategoryLabel = defaultOverrideSnapshot.cutlist_category ?? null;
                        const defaultNotesNormalized = defaultOverrideSnapshot.notes ?? null;
                        const defaultWarnings: string[] = [];
                        if (defaultOverrideSnapshot.is_cutlist_item === true) {
                          if (
                            !defaultCutlistDimensions ||
                            defaultCutlistDimensions.length_mm == null ||
                            defaultCutlistDimensions.width_mm == null
                          ) {
                            defaultWarnings.push(
                              'Option-set default marks this value as a cutlist item but length and width are missing.'
                            );
                          }
                        }
                        const hasDefaultMetadata =
                          value.default_component_id != null ||
                          value.default_supplier_component_id != null ||
                          defaultOverrideSnapshot.quantity_delta != null ||
                          !!defaultNotesNormalized ||
                          !!defaultCutlistCategoryLabel ||
                          defaultOverrideSnapshot.is_cutlist_item != null ||
                          (defaultCutlistDimensions && Object.keys(defaultCutlistDimensions).length > 0);
                        const normalizedDraftNotes =
                          typeof value.notes === 'string' && value.notes.trim().length > 0
                            ? value.notes.trim()
                            : null;
                        const normalizedDraftCategory =
                          typeof value.cutlist_category === 'string' && value.cutlist_category.trim().length > 0
                            ? value.cutlist_category.trim()
                            : null;
                        const isAtDefaults =
                          (value.replace_component_id ?? null) === defaultOverrideSnapshot.replace_component_id &&
                          (value.replace_supplier_component_id ?? null) ===
                            defaultOverrideSnapshot.replace_supplier_component_id &&
                          (value.quantity_delta ?? null) === defaultOverrideSnapshot.quantity_delta &&
                          normalizedDraftNotes === defaultNotesNormalized &&
                          (value.is_cutlist_item ?? null) === defaultOverrideSnapshot.is_cutlist_item &&
                          normalizedDraftCategory === defaultCutlistCategoryLabel &&
                          areCutlistDimensionsEqual(value.cutlist_dimensions ?? null, defaultCutlistDimensions ?? null);
                        const restoreDisabled = isAtDefaults;
                        const cutlistModeLabel =
                          defaultOverrideSnapshot.is_cutlist_item === true
                            ? 'Force cutlist'
                            : defaultOverrideSnapshot.is_cutlist_item === false
                            ? 'Force component'
                            : 'Inherit from BOM';
                        const editorState = getCutlistEditorState(value.id);
                        const overrideRequireDimensions =
                          value.is_cutlist_item === true || (value.is_cutlist_item === null && value.default_is_cutlist === true);
                        let overrideValidation: ReturnType<typeof validateCutlistDimensions> | null = null;
                        if (value.cutlist_dimensions) {
                          overrideValidation = validateCutlistDimensions(value.cutlist_dimensions, {
                            requireDimensions: overrideRequireDimensions,
                          });
                        }
                        const overrideSummary = summariseCutlistDimensions(value.cutlist_dimensions ?? null);
                        const overrideWarnings = overrideValidation?.warnings ?? [];
                        const overrideErrors =
                          overrideValidation && !overrideValidation.valid ? overrideValidation.errors : [];
                        const handleRestoreDefaults = () => {
                          const restoredCutlist = cloneCutlistDimensions(defaultCutlistDimensions);
                          setDraftValue(value.id, (prev) => ({
                            ...prev,
                            replace_component_id: defaultOverrideSnapshot.replace_component_id,
                            replace_supplier_component_id: defaultOverrideSnapshot.replace_supplier_component_id,
                            quantity_delta: defaultOverrideSnapshot.quantity_delta,
                            notes: defaultNotesNormalized,
                            is_cutlist_item: defaultOverrideSnapshot.is_cutlist_item,
                            cutlist_category: defaultCutlistCategoryLabel,
                            cutlist_dimensions: restoredCutlist,
                          }));
                          toast({
                            title: 'Defaults restored',
                            description: `${value.display_label} now matches the option-set defaults.`,
                          });
                          setCutlistEditors((prev) => ({
                            ...prev,
                            [value.id]: {
                              open: prev[value.id]?.open ?? false,
                              text:
                                restoredCutlist && Object.keys(restoredCutlist).length > 0
                                  ? JSON.stringify(restoredCutlist, null, 2)
                                  : '',
                              errors: [],
                              warnings: [],
                            },
                          }));
                        };
                        const cutlistDefaultStatus = isAtDefaults ? 'In sync' : 'Override differs';

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
                            {value.source === 'set' && (
                              <div className="space-y-3 rounded-md border border-dashed border-muted-foreground/40 bg-muted/15 p-4 text-xs">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                      Option-set defaults
                                    </span>
                                    <Badge variant={isAtDefaults ? 'secondary' : 'outline'}>{cutlistDefaultStatus}</Badge>
                                  </div>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-xs"
                                    onClick={handleRestoreDefaults}
                                    disabled={restoreDisabled}
                                  >
                                    Restore defaults
                                  </Button>
                                </div>
                                <p
                                  className={cn(
                                    'text-xs',
                                    isAtDefaults ? 'text-muted-foreground' : 'text-amber-600'
                                  )}
                                >
                                  {isAtDefaults
                                    ? 'Draft matches the option-set defaults.'
                                    : 'Draft overrides one or more option-set defaults.'}
                                </p>
                                {hasDefaultMetadata ? (
                                  <div className="grid gap-2 text-xs sm:grid-cols-2">
                                    <div>
                                      <div className="text-muted-foreground">Component</div>
                                      <div className="text-foreground">{defaultComponentLabel}</div>
                                    </div>
                                    {defaultSupplierLabel ? (
                                      <div>
                                        <div className="text-muted-foreground">Supplier component</div>
                                        <div className="text-foreground">{defaultSupplierLabel}</div>
                                      </div>
                                    ) : null}
                                    {defaultOverrideSnapshot.quantity_delta != null ? (
                                      <div>
                                        <div className="text-muted-foreground">Quantity delta</div>
                                        <div className="text-foreground">
                                          {defaultOverrideSnapshot.quantity_delta > 0
                                            ? `+${defaultOverrideSnapshot.quantity_delta}`
                                            : defaultOverrideSnapshot.quantity_delta}
                                        </div>
                                      </div>
                                    ) : null}
                                    <div>
                                      <div className="text-muted-foreground">Cutlist flag</div>
                                      <div className="text-foreground">{cutlistModeLabel}</div>
                                    </div>
                                    {defaultCutlistCategoryLabel ? (
                                      <div>
                                        <div className="text-muted-foreground">Cutlist category</div>
                                        <div className="text-foreground">{defaultCutlistCategoryLabel}</div>
                                      </div>
                                    ) : null}
                                    {defaultNotesNormalized ? (
                                      <div className="sm:col-span-2">
                                        <div className="text-muted-foreground">Default notes</div>
                                        <div className="text-foreground">{defaultNotesNormalized}</div>
                                      </div>
                                    ) : null}
                                  </div>
                                ) : (
                                  <p className="text-xs text-muted-foreground">
                                    No option-set defaults configured for this value yet.
                                  </p>
                                )}
                                <div className="space-y-1">
                                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Cutlist defaults
                                  </div>
                                  {defaultCutlistSummary.headline ? (
                                    <div className="font-medium text-foreground">{defaultCutlistSummary.headline}</div>
                                  ) : null}
                                  {defaultCutlistSummary.details.length > 0 ? (
                                    <ul className="space-y-1 text-xs text-muted-foreground">
                                      {defaultCutlistSummary.details.map((line, index) => (
                                        <li key={`${line}-${index}`}>• {line}</li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p className="text-xs text-muted-foreground">No cutlist dimensions provided.</p>
                                  )}
                                </div>
                                {defaultWarnings.map((warning, index) => (
                                  <div
                                    key={`${warning}-${index}`}
                                    className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
                                  >
                                    {warning}
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="space-y-3 rounded-md border border-muted-foreground/30 bg-muted/10 p-4 text-xs">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="space-y-1">
                                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Current cutlist override
                                  </span>
                                  <div className="text-sm font-medium text-foreground">
                                    {overrideSummary.headline ?? 'No cutlist dimensions set'}
                                  </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => openCutlistEditor(value)}
                                  >
                                    Edit JSON
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => clearCutlistDimensions(value)}
                                    disabled={!value.cutlist_dimensions}
                                  >
                                    Clear
                                  </Button>
                                </div>
                              </div>
                              {overrideRequireDimensions && !value.cutlist_dimensions ? (
                                <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                                  This override is marked as a cutlist item but has no dimensions stored. Add length/width before exporting.
                                </div>
                              ) : null}
                              {overrideSummary.details.length > 0 ? (
                                <ul className="space-y-1 text-xs text-muted-foreground">
                                  {overrideSummary.details.map((line, index) => (
                                    <li key={`${line}-${index}`}>• {line}</li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-xs text-muted-foreground">
                                  Configure cutlist length/width, grain, or banding to ensure this override feeds the cutlist tool.
                                </p>
                              )}
                              {overrideErrors.length > 0 ? (
                                <ul className="space-y-1 text-xs text-destructive">
                                  {overrideErrors.map((message, index) => (
                                    <li key={`${message}-${index}`}>• {message}</li>
                                  ))}
                                </ul>
                              ) : null}
                              {overrideErrors.length === 0 && overrideWarnings.length > 0 ? (
                                <ul className="space-y-1 text-xs text-amber-600">
                                  {overrideWarnings.map((message, index) => (
                                    <li key={`${message}-${index}`}>• {message}</li>
                                  ))}
                                </ul>
                              ) : null}
                              {editorState.open && (
                                <div className="space-y-2 rounded-md border border-border bg-background/80 p-3">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="text-xs font-medium text-muted-foreground">Cutlist payload (JSON)</div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 px-2 text-xs"
                                        onClick={() => insertCutlistTemplate(value.id)}
                                      >
                                        Insert template
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 px-2 text-xs"
                                        onClick={() => formatCutlistJson(value)}
                                        disabled={!editorState.text.trim()}
                                      >
                                        Format JSON
                                      </Button>
                                    </div>
                                  </div>
                                  <Textarea
                                    value={editorState.text}
                                    onChange={(event) => setCutlistEditorText(value.id, event.target.value)}
                                    className={cn(
                                      'min-h-[200px] font-mono text-xs',
                                      editorState.errors.length > 0 ? 'border-destructive focus-visible:ring-destructive' : ''
                                    )}
                                    placeholder='{"length_mm": 0, "width_mm": 0}'
                                  />
                                  {editorState.errors.length > 0 ? (
                                    <ul className="space-y-1 text-xs text-destructive">
                                      {editorState.errors.map((message, index) => (
                                        <li key={`${message}-${index}`}>• {message}</li>
                                      ))}
                                    </ul>
                                  ) : null}
                                  {editorState.errors.length === 0 && editorState.warnings.length > 0 ? (
                                    <ul className="space-y-1 text-xs text-amber-600">
                                      {editorState.warnings.map((message, index) => (
                                        <li key={`${message}-${index}`}>• {message}</li>
                                      ))}
                                    </ul>
                                  ) : null}
                                  <div className="flex flex-wrap items-center justify-end gap-2">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 px-3 text-xs"
                                      onClick={() => closeCutlistEditor(value.id)}
                                    >
                                      Cancel
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      className="h-8 px-3 text-xs"
                                      onClick={() => applyCutlistEditor(value)}
                                    >
                                      Apply
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
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
                                  onCheckedChange={(checked) => {
                                    const nextChecked = Boolean(checked);
                                    setDraftValue(value.id, (prev) => ({
                                      ...prev,
                                      is_cutlist_item: nextChecked,
                                    }));
                                    if (
                                      nextChecked &&
                                      (!value.cutlist_dimensions ||
                                        Object.keys(value.cutlist_dimensions ?? {}).length === 0)
                                    ) {
                                      openCutlistEditor(value);
                                    }
                                  }}
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
