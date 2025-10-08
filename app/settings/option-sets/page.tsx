'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useOptionSets,
  type OptionSet,
  type OptionSetGroup,
  type OptionSetValue,
} from '@/hooks/useOptionSets';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Loader2, Pencil, Plus, Trash2, ChevronDown, Search, X } from 'lucide-react';
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
import { cn } from '@/lib/utils';

interface SetFormState {
  code: string;
  name: string;
  description: string;
}

interface GroupFormState {
  code: string;
  label: string;
  is_required: boolean;
  display_order?: number;
}

interface ValueFormState {
  code: string;
  label: string;
  is_default: boolean;
  display_order?: number;
  default_component_id?: number | null;
  default_supplier_component_id?: number | null;
  default_quantity_delta?: number | null;
  default_notes?: string;
  default_is_cutlist?: boolean | null;
  default_cutlist_category?: string;
  default_cutlist_dimensions?: string;
}

function createEmptyValueForm(isDefault = false): ValueFormState {
  return {
    code: '',
    label: '',
    is_default: isDefault,
    display_order: undefined,
    default_component_id: null,
    default_supplier_component_id: null,
    default_quantity_delta: null,
    default_notes: '',
    default_is_cutlist: null,
    default_cutlist_category: '',
    default_cutlist_dimensions: '',
  };
}

interface ComponentOption {
  component_id: number;
  internal_code: string | null;
  description: string | null;
}

interface SupplierComponentOption {
  supplier_component_id: number;
  component_id: number;
  supplier_name: string | null;
  supplier_code: string | null;
  price: number | null;
  lead_time: number | null;
  min_order_quantity: number | null;
}

async function searchComponentOptions(search: string): Promise<ComponentOption[]> {
  try {
    const params = new URLSearchParams({ limit: '25' });
    if (search.trim().length > 0) {
      params.set('search', search.trim());
    }
    const res = await fetch(`/api/components?${params.toString()}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const json = await res.json();
    const items = Array.isArray(json?.components) ? json.components : [];
    return items.map((item: any) => ({
      component_id: Number(item.component_id),
      internal_code: item.internal_code ?? null,
      description: item.description ?? null,
    }));
  } catch (error) {
    console.error('[option-sets] searchComponentOptions error', error);
    return [];
  }
}

async function fetchComponentOptionsByIds(ids: number[]): Promise<ComponentOption[]> {
  if (!ids.length) return [];
  try {
    const params = new URLSearchParams({ ids: ids.join(',') });
    const res = await fetch(`/api/components?${params.toString()}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const json = await res.json();
    const items = Array.isArray(json?.components) ? json.components : [];
    return items.map((item: any) => ({
      component_id: Number(item.component_id),
      internal_code: item.internal_code ?? null,
      description: item.description ?? null,
    }));
  } catch (error) {
    console.error('[option-sets] fetchComponentOptionsByIds error', error);
    return [];
  }
}

async function fetchSupplierComponentsForDefault(componentId: number): Promise<SupplierComponentOption[]> {
  if (!componentId) return [];
  try {
    const params = new URLSearchParams({ componentId: String(componentId), limit: '100' });
    const url = `/api/supplier-components?${params.toString()}`;
    console.log('Fetching supplier components from:', url);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      console.error('Failed to fetch supplier components:', res.status, res.statusText);
      return [];
    }
    const json = await res.json();
    console.log('Received supplier components JSON:', json);
    const items = Array.isArray(json?.supplier_components) ? json.supplier_components : [];
    return items.map((item: any) => ({
      supplier_component_id: Number(item.supplier_component_id),
      component_id: Number(item.component_id),
      supplier_name: item.supplier_name ?? null,
      supplier_code: item.supplier_code ?? null,
      price: item.price != null ? Number(item.price) : null,
      lead_time: item.lead_time != null ? Number(item.lead_time) : null,
      min_order_quantity: item.min_order_quantity != null ? Number(item.min_order_quantity) : null,
    }));
  } catch (error) {
    console.error('[option-sets] fetchSupplierComponentsForDefault error', error);
    return [];
  }
}

async function fetchSupplierComponentsByIds(ids: number[]): Promise<SupplierComponentOption[]> {
  if (!ids.length) return [];
  try {
    const params = new URLSearchParams({ ids: ids.join(',') });
    const res = await fetch(`/api/supplier-components?${params.toString()}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const json = await res.json();
    const items = Array.isArray(json?.supplier_components) ? json.supplier_components : [];
    return items.map((item: any) => ({
      supplier_component_id: Number(item.supplier_component_id),
      component_id: Number(item.component_id),
      supplier_name: item.supplier_name ?? null,
      supplier_code: item.supplier_code ?? null,
      price: item.price != null ? Number(item.price) : null,
      lead_time: item.lead_time != null ? Number(item.lead_time) : null,
      min_order_quantity: item.min_order_quantity != null ? Number(item.min_order_quantity) : null,
    }));
  } catch (error) {
    console.error('[option-sets] fetchSupplierComponentsByIds error', error);
    return [];
  }
}

export default function OptionSetLibraryPage() {
  const { data, isLoading, error } = useOptionSets();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const optionSets = useMemo(() => data ?? [], [data]);

  const [searchTerm, setSearchTerm] = useState('');
  const [showLinkedOnly, setShowLinkedOnly] = useState(false);
  const [expandedSets, setExpandedSets] = useState<Set<number>>(() => new Set());
  const [expandedGroups, setExpandedGroups] = useState<Record<number, Set<number>>>(() => ({}));
  const previousSearchTerm = useRef('');

  const filteredSets = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return optionSets
      .filter((set) => {
        if (showLinkedOnly && set.usage_count === 0) return false;
        if (!term) return true;
        const inSet = set.name.toLowerCase().includes(term) || set.code.toLowerCase().includes(term);
        const inGroup = set.groups.some((group) =>
          group.label.toLowerCase().includes(term) ||
          group.code.toLowerCase().includes(term) ||
          group.values.some((value) => value.label.toLowerCase().includes(term) || value.code.toLowerCase().includes(term))
        );
        return inSet || inGroup;
      })
      .map((set) => {
        if (!term) return set;
        return {
          ...set,
          groups: set.groups.filter((group) => {
            if (
              group.label.toLowerCase().includes(term) ||
              group.code.toLowerCase().includes(term)
            ) {
              return true;
            }
            return group.values.some((value) =>
              value.label.toLowerCase().includes(term) || value.code.toLowerCase().includes(term)
            );
          }),
        };
      })
      .filter((set) => set.groups.length > 0 || term === '' || set.name.toLowerCase().includes(term) || set.code.toLowerCase().includes(term));
  }, [optionSets, searchTerm, showLinkedOnly]);

  const toggleSetExpanded = (setId: number) => {
    setExpandedSets((prev) => {
      const next = new Set(prev);
      if (next.has(setId)) {
        next.delete(setId);
      } else {
        next.add(setId);
      }
      return next;
    });
  };

  const isGroupExpanded = (setId: number, groupId: number) => {
    return expandedGroups[setId]?.has(groupId) ?? false;
  };

  const toggleGroupExpanded = (setId: number, groupId: number) => {
    setExpandedGroups((prev) => {
      const existing = prev[setId] ?? new Set<number>();
      const nextSet = new Set(existing);
      if (nextSet.has(groupId)) {
        nextSet.delete(groupId);
      } else {
        nextSet.add(groupId);
      }
      return { ...prev, [setId]: nextSet };
    });
  };

  useEffect(() => {
    const term = searchTerm.trim();
    if (term) {
      const nextSets = new Set<number>();
      const nextGroups: Record<number, Set<number>> = {};
      filteredSets.forEach((set) => {
        nextSets.add(set.option_set_id);
        nextGroups[set.option_set_id] = new Set(set.groups.map((group) => group.option_set_group_id));
      });
      setExpandedSets(nextSets);
      setExpandedGroups(nextGroups);
    } else if (previousSearchTerm.current) {
      setExpandedSets(new Set());
      setExpandedGroups({});
    }
    previousSearchTerm.current = term;
  }, [searchTerm, filteredSets]);

  const [setDialogOpen, setSetDialogOpen] = useState(false);
  const [editingSet, setEditingSet] = useState<OptionSet | null>(null);
  const [setForm, setSetForm] = useState<SetFormState>({ code: '', name: '', description: '' });
  const [savingSet, setSavingSet] = useState(false);

  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupTarget, setGroupTarget] = useState<{ setId: number; group: OptionSetGroup | null } | null>(null);
  const [groupForm, setGroupForm] = useState<GroupFormState>({ code: '', label: '', is_required: true });

  const [valueDialogOpen, setValueDialogOpen] = useState(false);
  const [valueTarget, setValueTarget] = useState<{ setId: number; group: OptionSetGroup; value: OptionSetValue | null } | null>(null);
  const [valueForm, setValueForm] = useState<ValueFormState>(() => createEmptyValueForm());
  const [componentSelection, setComponentSelection] = useState<ComponentOption | null>(null);
  const [supplierSelection, setSupplierSelection] = useState<SupplierComponentOption | null>(null);
  const [componentPickerOpen, setComponentPickerOpen] = useState(false);
  const [supplierPickerOpen, setSupplierPickerOpen] = useState(false);
  const [componentSearchTerm, setComponentSearchTerm] = useState('');
  const [supplierSearchTerm, setSupplierSearchTerm] = useState('');

  const {
    data: componentSearchResults = [],
    isLoading: isLoadingComponentSearch,
    isFetching: isFetchingComponentSearch,
  } = useQuery({
    queryKey: ['component-options', componentSearchTerm],
    queryFn: () => searchComponentOptions(componentSearchTerm),
    enabled: valueDialogOpen && componentPickerOpen,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  const {
    data: supplierOptions = [],
    isLoading: isLoadingSupplierOptions,
    isFetching: isFetchingSupplierOptions,
  } = useQuery({
    queryKey: ['supplier-default-options', valueForm.default_component_id ?? 0],
    queryFn: () =>
      valueForm.default_component_id
        ? fetchSupplierComponentsForDefault(valueForm.default_component_id)
        : Promise.resolve([]),
    enabled: valueDialogOpen && Boolean(valueForm.default_component_id),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  const filteredSupplierOptions = useMemo(() => {
    if (!Array.isArray(supplierOptions)) return [] as SupplierComponentOption[];
    const term = supplierSearchTerm.trim().toLowerCase();
    if (!term) return supplierOptions;
    return supplierOptions.filter((option) => {
      const name = option.supplier_name?.toLowerCase() ?? '';
      const code = option.supplier_code?.toLowerCase() ?? '';
      return name.includes(term) || code.includes(term);
    });
  }, [supplierOptions, supplierSearchTerm]);

  useEffect(() => {
    if (!valueDialogOpen) return;
    const componentId = valueForm.default_component_id;
    if (!componentId) {
      if (componentSelection) {
        setComponentSelection(null);
      }
      return;
    }
    if (componentSelection && componentSelection.component_id === componentId) {
      return;
    }
    let cancelled = false;
    fetchComponentOptionsByIds([componentId]).then((items) => {
      if (!cancelled && items.length > 0) {
        setComponentSelection(items[0]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [valueDialogOpen, valueForm.default_component_id, componentSelection]);

  useEffect(() => {
    if (!valueDialogOpen) return;
    const supplierId = valueForm.default_supplier_component_id;
    if (!supplierId) {
      if (supplierSelection) {
        setSupplierSelection(null);
      }
      return;
    }
    if (supplierSelection && supplierSelection.supplier_component_id === supplierId) {
      return;
    }
    let cancelled = false;
    fetchSupplierComponentsByIds([supplierId]).then((items) => {
      if (!cancelled && items.length > 0) {
        setSupplierSelection(items[0]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [valueDialogOpen, valueForm.default_supplier_component_id, supplierSelection]);

  const resetSetDialog = () => {
    setSetDialogOpen(false);
    setEditingSet(null);
    setSetForm({ code: '', name: '', description: '' });
  };

  const resetGroupDialog = () => {
    setGroupDialogOpen(false);
    setGroupTarget(null);
    setGroupForm({ code: '', label: '', is_required: true });
  };

  const resetValueDialog = () => {
    setValueDialogOpen(false);
    setValueTarget(null);
    setValueForm(createEmptyValueForm());
    setComponentSelection(null);
    setSupplierSelection(null);
    setComponentPickerOpen(false);
    setSupplierPickerOpen(false);
    setComponentSearchTerm('');
    setSupplierSearchTerm('');
  };

  const openCreateSet = () => {
    setEditingSet(null);
    setSetForm({ code: '', name: '', description: '' });
    setSetDialogOpen(true);
  };

  const openEditSet = (set: OptionSet) => {
    setEditingSet(set);
    setSetForm({ code: set.code, name: set.name, description: set.description ?? '' });
    setSetDialogOpen(true);
  };

  const handleSaveSet = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload: Partial<SetFormState> = {
      code: setForm.code.trim(),
      name: setForm.name.trim(),
      description: setForm.description.trim(),
    };

    if (!payload.code || !payload.name) {
      toast({ variant: 'destructive', title: 'Missing fields', description: 'Code and name are required.' });
      return;
    }

    setSavingSet(true);
    try {
      if (editingSet) {
        const res = await fetch(`/api/option-sets/${editingSet.option_set_id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const message = await res.text();
          throw new Error(message || 'Failed to update option set');
        }
        toast({ title: 'Option set updated' });
      } else {
        const res = await fetch('/api/option-sets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const message = await res.text();
          throw new Error(message || 'Failed to create option set');
        }
        toast({ title: 'Option set created' });
      }
      resetSetDialog();
      await queryClient.invalidateQueries({ queryKey: ['optionSets'] });
    } catch (err: any) {
      console.error('[option-sets] save error', err);
      toast({ variant: 'destructive', title: 'Save failed', description: err?.message });
    } finally {
      setSavingSet(false);
    }
  };

  const [pendingDelete, setPendingDelete] = useState<
    | { type: 'set'; set: OptionSet }
    | { type: 'group'; setId: number; group: OptionSetGroup }
    | { type: 'value'; setId: number; group: OptionSetGroup; value: OptionSetValue }
    | null
  >(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const requestDeleteSet = (set: OptionSet) => {
    if (set.usage_count > 0) {
      toast({ variant: 'destructive', title: 'Cannot delete', description: 'Detach this set from products before deleting it.' });
      return;
    }
    setPendingDelete({ type: 'set', set });
  };

  const handleDeleteSet = async (set: OptionSet) => {
    try {
      const res = await fetch(`/api/option-sets/${set.option_set_id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || 'Failed to delete option set');
      }
      toast({ title: 'Option set deleted' });
      await queryClient.invalidateQueries({ queryKey: ['optionSets'] });
    } catch (err: any) {
      console.error('[option-sets] delete error', err);
      toast({ variant: 'destructive', title: 'Delete failed', description: err?.message });
    }
  };

  const openCreateGroup = (setId: number) => {
    setGroupTarget({ setId, group: null });
    setGroupForm({ code: '', label: '', is_required: true });
    setGroupDialogOpen(true);
  };

  const openEditGroup = (setId: number, group: OptionSetGroup) => {
    setGroupTarget({ setId, group });
    setGroupForm({
      code: group.code,
      label: group.label,
      is_required: group.is_required,
      display_order: group.display_order,
    });
    setGroupDialogOpen(true);
  };

  const handleSaveGroup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!groupTarget) return;

    const payload = {
      code: groupForm.code.trim(),
      label: groupForm.label.trim(),
      is_required: groupForm.is_required,
      display_order: groupForm.display_order,
    };

    if (!payload.code || !payload.label) {
      toast({ variant: 'destructive', title: 'Missing fields', description: 'Code and label are required.' });
      return;
    }

    const baseUrl = `/api/option-sets/${groupTarget.setId}/groups`;

    try {
      const res = await fetch(groupTarget.group ? `${baseUrl}/${groupTarget.group.option_set_group_id}` : baseUrl, {
        method: groupTarget.group ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || 'Failed to save option group');
      }
      toast({ title: groupTarget.group ? 'Option group updated' : 'Option group created' });
      resetGroupDialog();
      await queryClient.invalidateQueries({ queryKey: ['optionSets'] });
    } catch (err: any) {
      console.error('[option-set-groups] save error', err);
      toast({ variant: 'destructive', title: 'Save failed', description: err?.message });
    }
  };

  const requestDeleteGroup = (setId: number, group: OptionSetGroup) => {
    setPendingDelete({ type: 'group', setId, group });
  };

  const handleDeleteGroup = async (setId: number, group: OptionSetGroup) => {
    try {
      const res = await fetch(`/api/option-sets/${setId}/groups/${group.option_set_group_id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || 'Failed to delete option group');
      }
      toast({ title: 'Option group deleted' });
      await queryClient.invalidateQueries({ queryKey: ['optionSets'] });
    } catch (err: any) {
      console.error('[option-set-groups] delete error', err);
      toast({ variant: 'destructive', title: 'Delete failed', description: err?.message });
    }
  };

  const openCreateValue = (setId: number, group: OptionSetGroup) => {
    setValueTarget({ setId, group, value: null });
    setValueForm(createEmptyValueForm(group.values.length === 0));
    setComponentSelection(null);
    setSupplierSelection(null);
    setComponentSearchTerm('');
    setSupplierSearchTerm('');
    setComponentPickerOpen(false);
    setSupplierPickerOpen(false);
    setValueDialogOpen(true);
  };

  const openEditValue = (setId: number, group: OptionSetGroup, value: OptionSetValue) => {
    setValueTarget({ setId, group, value });
    setValueForm({
      code: value.code,
      label: value.label,
      is_default: value.is_default,
      display_order: value.display_order,
      default_component_id: value.default_component_id ?? null,
      default_supplier_component_id: value.default_supplier_component_id ?? null,
      default_quantity_delta: value.default_quantity_delta ?? null,
      default_notes: value.default_notes ?? '',
      default_is_cutlist: value.default_is_cutlist ?? null,
      default_cutlist_category: value.default_cutlist_category ?? '',
      default_cutlist_dimensions: value.default_cutlist_dimensions
        ? JSON.stringify(value.default_cutlist_dimensions, null, 2)
        : '',
    });
    setComponentSelection(null);
    setSupplierSelection(null);
    setComponentSearchTerm('');
    setSupplierSearchTerm('');
    setComponentPickerOpen(false);
    setSupplierPickerOpen(false);
    setValueDialogOpen(true);
  };

  const handleSaveValue = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valueTarget) return;

    let parsedDimensions: Record<string, unknown> | null = null;
    if (valueForm.default_cutlist_dimensions && valueForm.default_cutlist_dimensions.trim() !== '') {
      try {
        parsedDimensions = JSON.parse(valueForm.default_cutlist_dimensions);
      } catch (err) {
        toast({ variant: 'destructive', title: 'Invalid cutlist dimensions', description: 'Provide valid JSON or leave blank.' });
        return;
      }
    }

    const payload = {
      code: valueForm.code.trim(),
      label: valueForm.label.trim(),
      is_default: valueForm.is_default,
      display_order: valueForm.display_order,
      default_component_id: valueForm.default_component_id ?? null,
      default_supplier_component_id: valueForm.default_supplier_component_id ?? null,
      default_quantity_delta: valueForm.default_quantity_delta ?? null,
      default_notes: valueForm.default_notes?.trim() || null,
      default_is_cutlist: valueForm.default_is_cutlist,
      default_cutlist_category: valueForm.default_cutlist_category?.trim() || null,
      default_cutlist_dimensions: parsedDimensions,
    };

    if (!payload.code || !payload.label) {
      toast({ variant: 'destructive', title: 'Missing fields', description: 'Code and label are required.' });
      return;
    }

    const baseUrl = `/api/option-sets/${valueTarget.setId}/groups/${valueTarget.group.option_set_group_id}/values`;

    try {
      const res = await fetch(valueTarget.value ? `${baseUrl}/${valueTarget.value.option_set_value_id}` : baseUrl, {
        method: valueTarget.value ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || 'Failed to save option value');
      }
      toast({ title: valueTarget.value ? 'Option value updated' : 'Option value created' });
      resetValueDialog();
      await queryClient.invalidateQueries({ queryKey: ['optionSets'] });
    } catch (err: any) {
      console.error('[option-set-values] save error', err);
      toast({ variant: 'destructive', title: 'Save failed', description: err?.message });
    }
  };

  const requestDeleteValue = (setId: number, group: OptionSetGroup, value: OptionSetValue) => {
    setPendingDelete({ type: 'value', setId, group, value });
  };

  const handleDeleteValue = async (setId: number, group: OptionSetGroup, value: OptionSetValue) => {
    try {
      const res = await fetch(
        `/api/option-sets/${setId}/groups/${group.option_set_group_id}/values/${value.option_set_value_id}`,
        {
          method: 'DELETE',
        }
      );
      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || 'Failed to delete option value');
      }
      toast({ title: 'Option value deleted' });
      await queryClient.invalidateQueries({ queryKey: ['optionSets'] });
    } catch (err: any) {
      console.error('[option-set-values] delete error', err);
      toast({ variant: 'destructive', title: 'Delete failed', description: err?.message });
    }
  };

  const executePendingDelete = async () => {
    if (!pendingDelete) return;
    setDeleteSubmitting(true);
    try {
      if (pendingDelete.type === 'set') {
        await handleDeleteSet(pendingDelete.set);
      } else if (pendingDelete.type === 'group') {
        await handleDeleteGroup(pendingDelete.setId, pendingDelete.group);
      } else {
        await handleDeleteValue(pendingDelete.setId, pendingDelete.group, pendingDelete.value);
      }
      setPendingDelete(null);
    } catch (err) {
      console.error('[option-set-delete] error', err);
    } finally {
      setDeleteSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading option sets…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Failed to load option sets: {(error as Error).message}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex flex-col gap-4 rounded-lg border bg-card p-6 shadow-sm">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold">Option Set Library</h1>
            <p className="text-sm text-muted-foreground">
              Manage reusable configuration sets (handles, finishes, locks, etc.) that can be attached to products.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 items-center gap-3">
              <div className="relative w-full sm:max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search sets, groups, or values…"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <Switch
                  id="linked-only"
                  checked={showLinkedOnly}
                  onCheckedChange={(checked) => setShowLinkedOnly(Boolean(checked))}
                />
                <Label htmlFor="linked-only" className="cursor-pointer text-xs">
                  Show linked only
                </Label>
              </div>
            </div>
            <Button size="sm" onClick={openCreateSet}>
              <Plus className="mr-2 h-4 w-4" /> Create Option Set
            </Button>
          </div>
        </div>

        {filteredSets.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground text-sm">
              No option sets match your filters.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {filteredSets.map((set) => {
              const isExpanded = expandedSets.has(set.option_set_id);
              const setGroups = isExpanded ? set.groups : [];
              return (
                <Card key={set.option_set_id} className="overflow-hidden">
                  <CardHeader className="flex flex-col gap-3 border-b border-border/60 bg-muted/20 pb-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex flex-1 flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => toggleSetExpanded(set.option_set_id)}
                        className="flex items-center justify-between rounded-md border border-border/60 bg-background px-3 py-2 text-left transition hover:border-foreground/40"
                      >
                        <div>
                          <p className="text-sm font-semibold text-foreground">{set.name}</p>
                          <p className="text-xs text-muted-foreground">Code: {set.code}</p>
                        </div>
                        <ChevronDown className={cn('h-4 w-4 transition-transform', isExpanded ? 'rotate-180' : 'rotate-0')} />
                      </button>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="secondary">{set.groups.length} group{set.groups.length === 1 ? '' : 's'}</Badge>
                        <Badge variant="outline">Usage: {set.usage_count}</Badge>
                        {set.description && <span className="truncate">{set.description}</span>}
                      </div>
                    </div>
                    <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:items-center">
                      <Button variant="outline" size="sm" onClick={() => openEditSet(set)}>
                        <Pencil className="mr-2 h-4 w-4" /> Edit
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDeleteSet(set)}
                        disabled={set.usage_count > 0}
                      >
                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                      </Button>
                    </div>
                  </CardHeader>
                  {isExpanded && (
                    <CardContent className="space-y-4 pt-4">
                      <div className="flex items-center justify-between">
                        <h2 className="text-sm font-medium text-muted-foreground">Groups & Values</h2>
                        <Button size="sm" variant="outline" onClick={() => openCreateGroup(set.option_set_id)}>
                          <Plus className="mr-1 h-3 w-3" /> Add Group
                        </Button>
                      </div>
                      {setGroups.length === 0 ? (
                        <div className="rounded-md border border-dashed border-muted p-4 text-center text-sm text-muted-foreground">
                          No groups yet.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {setGroups.map((group) => {
                            const groupExpanded = isGroupExpanded(set.option_set_id, group.option_set_group_id);
                            return (
                              <div key={group.option_set_group_id} className="rounded-md border border-border/60 bg-background">
                                <div className="flex w-full items-center justify-between gap-3 px-4 py-3">
                                  <button
                                    type="button"
                                    onClick={() => toggleGroupExpanded(set.option_set_id, group.option_set_group_id)}
                                    className="flex flex-1 items-center justify-between gap-3 text-left transition hover:opacity-80"
                                  >
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm text-foreground">{group.label}</span>
                                        <Badge variant={group.is_required ? 'default' : 'secondary'}>
                                          {group.is_required ? 'Required' : 'Optional'}
                                        </Badge>
                                        <Badge variant="outline">Order: {group.display_order}</Badge>
                                      </div>
                                      <p className="text-xs text-muted-foreground">Code: {group.code}</p>
                                    </div>
                                    <ChevronDown className={cn('h-4 w-4 transition-transform', groupExpanded ? 'rotate-180' : 'rotate-0')} />
                                  </button>
                                  <div className="flex items-center gap-2">
                                    <Button
                                      size="icon"
                                      variant="outline"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openEditGroup(set.option_set_id, group);
                                      }}
                                    >
                                      <Pencil className="h-4 w-4" />
                                      <span className="sr-only">Edit group</span>
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="destructive"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        requestDeleteGroup(set.option_set_id, group);
                                      }}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                      <span className="sr-only">Delete group</span>
                                    </Button>
                                  </div>
                                </div>
                                {groupExpanded && (
                                  <div className="space-y-3 border-t border-border/60 px-4 py-3">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs uppercase tracking-wide text-muted-foreground">Values</span>
                                      <Button size="sm" variant="outline" onClick={() => openCreateValue(set.option_set_id, group)}>
                                        <Plus className="mr-1 h-3 w-3" /> Add Value
                                      </Button>
                                    </div>
                                    {group.values.length === 0 ? (
                                      <div className="rounded border border-dashed border-muted p-3 text-center text-xs text-muted-foreground">
                                        No values yet.
                                      </div>
                                    ) : (
                                      <div className="space-y-2">
                                        {group.values.map((value) => (
                                          <div
                                            key={value.option_set_value_id}
                                            className="flex flex-wrap items-center justify-between gap-2 rounded border border-muted bg-muted/20 p-3"
                                          >
                                            <div>
                                              <div className="flex items-center gap-2">
                                                <span className="font-medium text-sm text-foreground">{value.label}</span>
                                                {value.is_default && <Badge>Default</Badge>}
                                              </div>
                                              <p className="text-xs text-muted-foreground">
                                                Code: {value.code} · Order: {value.display_order}
                                              </p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                              <Button size="icon" variant="outline" onClick={() => openEditValue(set.option_set_id, group, value)}>
                                                <Pencil className="h-4 w-4" />
                                                <span className="sr-only">Edit value</span>
                                              </Button>
                                              <Button
                                                size="icon"
                                                variant="destructive"
                                                onClick={() => requestDeleteValue(set.option_set_id, group, value)}
                                              >
                                                <Trash2 className="h-4 w-4" />
                                                <span className="sr-only">Delete value</span>
                                              </Button>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Create/Edit Option Set */}
      <Dialog open={setDialogOpen} onOpenChange={(open) => (open ? setSetDialogOpen(true) : resetSetDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSet ? 'Edit option set' : 'Create option set'}</DialogTitle>
            <DialogDescription>Define the reusable configuration set details.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleSaveSet}>
            <div className="space-y-2">
              <Label htmlFor="set-code">Code</Label>
              <Input
                id="set-code"
                value={setForm.code}
                onChange={(event) => setSetForm((prev) => ({ ...prev, code: event.target.value }))}
                placeholder="e.g., handles"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="set-name">Name</Label>
              <Input
                id="set-name"
                value={setForm.name}
                onChange={(event) => setSetForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="e.g., Handle Library"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="set-description">Description (optional)</Label>
              <Input
                id="set-description"
                value={setForm.description}
                onChange={(event) => setSetForm((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="Helpful notes for other admins"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={resetSetDialog}>
                Cancel
              </Button>
              <Button type="submit" disabled={savingSet}>
                {savingSet ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {editingSet ? 'Save changes' : 'Create option set'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Create/Edit Group */}
      <Dialog open={groupDialogOpen} onOpenChange={(open) => (open ? setGroupDialogOpen(true) : resetGroupDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{groupTarget?.group ? 'Edit option group' : 'Add option group'}</DialogTitle>
            <DialogDescription>Define an attribute within this option set.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleSaveGroup}>
            <div className="space-y-2">
              <Label htmlFor="group-code">Code</Label>
              <Input
                id="group-code"
                value={groupForm.code}
                onChange={(event) => setGroupForm((prev) => ({ ...prev, code: event.target.value }))}
                placeholder="Short unique code"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="group-label">Label</Label>
              <Input
                id="group-label"
                value={groupForm.label}
                onChange={(event) => setGroupForm((prev) => ({ ...prev, label: event.target.value }))}
                placeholder="Display name"
                required
              />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="group-required"
                checked={groupForm.is_required}
                onCheckedChange={(checked) => setGroupForm((prev) => ({ ...prev, is_required: Boolean(checked) }))}
              />
              <Label htmlFor="group-required">Selection required</Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="group-order">Display order</Label>
              <Input
                id="group-order"
                type="number"
                value={groupForm.display_order ?? ''}
                onChange={(event) => {
                  const value = event.target.value;
                  setGroupForm((prev) => ({ ...prev, display_order: value === '' ? undefined : Number(value) }));
                }}
                placeholder="Leave blank to append"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={resetGroupDialog}>
                Cancel
              </Button>
              <Button type="submit">{groupTarget?.group ? 'Save changes' : 'Create group'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Create/Edit Value */}
      <Dialog open={valueDialogOpen} onOpenChange={(open) => (open ? setValueDialogOpen(true) : resetValueDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{valueTarget?.value ? 'Edit option value' : 'Add option value'}</DialogTitle>
            <DialogDescription>Define a selection for the "{valueTarget?.group.label ?? ''}" group.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleSaveValue}>
            <div className="space-y-2">
              <Label htmlFor="value-code">Code</Label>
              <Input
                id="value-code"
                value={valueForm.code}
                onChange={(event) => setValueForm((prev) => ({ ...prev, code: event.target.value }))}
                placeholder="Short unique code"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="value-label">Label</Label>
              <Input
                id="value-label"
                value={valueForm.label}
                onChange={(event) => setValueForm((prev) => ({ ...prev, label: event.target.value }))}
                placeholder="Display name"
                required
              />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="value-default"
                checked={valueForm.is_default}
                onCheckedChange={(checked) => setValueForm((prev) => ({ ...prev, is_default: Boolean(checked) }))}
              />
              <Label htmlFor="value-default">Default selection</Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="value-order">Display order</Label>
              <Input
                id="value-order"
                type="number"
                value={valueForm.display_order ?? ''}
                onChange={(event) => {
                  const value = event.target.value;
                  setValueForm((prev) => ({ ...prev, display_order: value === '' ? undefined : Number(value) }));
                }}
                placeholder="Leave blank to append"
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Default component</Label>
                <Popover
                  open={componentPickerOpen}
                  onOpenChange={(open) => {
                    setComponentPickerOpen(open);
                    if (open) {
                      setComponentSearchTerm('');
                    }
                  }}
                >
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline" className="flex w-full items-center justify-between">
                      <span className="flex min-w-0 flex-col items-start text-left">
                        {componentSelection ? (
                          <>
                            <span className="truncate font-medium">
                              {componentSelection.internal_code ?? `Component #${componentSelection.component_id}`}
                            </span>
                            {componentSelection.description && (
                              <span className="truncate text-xs text-muted-foreground">{componentSelection.description}</span>
                            )}
                          </>
                        ) : valueForm.default_component_id ? (
                          <span className="truncate font-medium">Component #{valueForm.default_component_id}</span>
                        ) : (
                          <span className="text-muted-foreground">Select component</span>
                        )}
                      </span>
                      <Search className="ml-2 h-4 w-4 opacity-60" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[420px] space-y-3 p-3" align="start" sideOffset={4}>
                    <Input
                      autoFocus
                      placeholder="Search by code or description…"
                      value={componentSearchTerm}
                      onChange={(event) => setComponentSearchTerm(event.target.value)}
                    />
                    <div className="max-h-64 overflow-y-auto rounded border border-border">
                      {isLoadingComponentSearch || isFetchingComponentSearch ? (
                        <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" /> Loading components…
                        </div>
                      ) : componentSearchResults.length === 0 ? (
                        <div className="py-6 text-center text-sm text-muted-foreground">No components found.</div>
                      ) : (
                        <ul className="divide-y divide-border">
                          {componentSearchResults.map((component) => (
                            <li key={component.component_id}>
                              <button
                                type="button"
                                className="flex w-full flex-col gap-1 px-3 py-2 text-left hover:bg-muted/60"
                                onClick={() => {
                                  setComponentSelection(component);
                                  setValueForm((prev) => ({
                                    ...prev,
                                    default_component_id: component.component_id,
                                    default_supplier_component_id: null,
                                  }));
                                  setSupplierSelection(null);
                                  setSupplierSearchTerm('');
                                  setSupplierPickerOpen(false);
                                  setComponentPickerOpen(false);
                                }}
                              >
                                <span className="font-medium">
                                  {component.internal_code ?? `Component #${component.component_id}`}
                                </span>
                                {component.description && (
                                  <span className="text-xs text-muted-foreground">{component.description}</span>
                                )}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
                {valueForm.default_component_id && (
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Selected ID: {valueForm.default_component_id}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        setComponentSelection(null);
                        setSupplierSelection(null);
                        setValueForm((prev) => ({
                          ...prev,
                          default_component_id: null,
                          default_supplier_component_id: null,
                        }));
                        setSupplierSearchTerm('');
                      }}
                    >
                      <X className="mr-1 h-3 w-3" /> Clear
                    </Button>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>Default supplier component</Label>
                <Popover
                  open={supplierPickerOpen}
                  onOpenChange={(open) => {
                    if (!valueForm.default_component_id) {
                      setSupplierPickerOpen(false);
                      return;
                    }
                    setSupplierPickerOpen(open);
                    if (open) {
                      setSupplierSearchTerm('');
                    }
                  }}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="flex w-full items-center justify-between"
                      disabled={!valueForm.default_component_id}
                    >
                      <span className="flex min-w-0 flex-col items-start text-left">
                        {valueForm.default_component_id ? (
                          supplierSelection ? (
                            <>
                              <span className="truncate font-medium">
                                {supplierSelection.supplier_name ?? `Supplier component #${supplierSelection.supplier_component_id}`}
                              </span>
                              <span className="truncate text-xs text-muted-foreground">
                                {supplierSelection.supplier_code ? `Code: ${supplierSelection.supplier_code}` : 'No supplier code'}
                              </span>
                            </>
                          ) : valueForm.default_supplier_component_id ? (
                            <span className="truncate font-medium">
                              Supplier component #{valueForm.default_supplier_component_id}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">Select supplier component</span>
                          )
                        ) : (
                          <span className="text-muted-foreground">Select component first</span>
                        )}
                      </span>
                      <Search className="ml-2 h-4 w-4 opacity-60" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[420px] space-y-3 p-3" align="start" sideOffset={4}>
                    <Input
                      autoFocus
                      placeholder="Search suppliers or codes…"
                      value={supplierSearchTerm}
                      onChange={(event) => setSupplierSearchTerm(event.target.value)}
                    />
                    <div className="max-h-64 overflow-y-auto rounded border border-border">
                      {isLoadingSupplierOptions || isFetchingSupplierOptions ? (
                        <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" /> Loading supplier components…
                        </div>
                      ) : filteredSupplierOptions.length === 0 ? (
                        <div className="py-6 text-center text-sm text-muted-foreground">
                          No supplier components found.
                        </div>
                      ) : (
                        <ul className="divide-y divide-border">
                          {filteredSupplierOptions.map((option) => (
                            <li key={option.supplier_component_id}>
                              <button
                                type="button"
                                className="flex w-full flex-col gap-1 px-3 py-2 text-left hover:bg-muted/60"
                                onClick={() => {
                                  setSupplierSelection(option);
                                  setValueForm((prev) => ({
                                    ...prev,
                                    default_supplier_component_id: option.supplier_component_id,
                                  }));
                                  setSupplierPickerOpen(false);
                                }}
                              >
                                <span className="font-medium">
                                  {option.supplier_name ?? `Supplier component #${option.supplier_component_id}`}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {option.supplier_code ? `Code: ${option.supplier_code}` : 'No supplier code'}
                                  {option.price != null ? ` • Price: ${option.price.toLocaleString()}` : ''}
                                  {option.lead_time != null ? ` • Lead: ${option.lead_time} days` : ''}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
                {valueForm.default_supplier_component_id && (
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Selected ID: {valueForm.default_supplier_component_id}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        setSupplierSelection(null);
                        setValueForm((prev) => ({
                          ...prev,
                          default_supplier_component_id: null,
                        }));
                      }}
                    >
                      <X className="mr-1 h-3 w-3" /> Clear
                    </Button>
                  </div>
                )}
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="value-default-quantity">Default quantity delta</Label>
                <Input
                  id="value-default-quantity"
                  type="number"
                  step="0.01"
                  value={valueForm.default_quantity_delta ?? ''}
                  onChange={(event) => {
                    const value = event.target.value;
                    setValueForm((prev) => ({
                      ...prev,
                      default_quantity_delta: value === '' ? null : Number(value),
                    }));
                  }}
                  placeholder="e.g., 0.5"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="value-default-is-cutlist">Default is cutlist item</Label>
                <Select
                  value={valueForm.default_is_cutlist === null || valueForm.default_is_cutlist === undefined ? 'auto' : valueForm.default_is_cutlist ? 'true' : 'false'}
                  onValueChange={(val) => {
                    setValueForm((prev) => ({
                      ...prev,
                      default_is_cutlist: val === 'auto' ? null : val === 'true',
                    }));
                  }}
                >
                  <SelectTrigger id="value-default-is-cutlist">
                    <SelectValue placeholder="Inherit" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Inherit from override</SelectItem>
                    <SelectItem value="true">Force cutlist</SelectItem>
                    <SelectItem value="false">Force component</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="value-default-notes">Default notes</Label>
              <Textarea
                id="value-default-notes"
                value={valueForm.default_notes ?? ''}
                onChange={(event) => setValueForm((prev) => ({ ...prev, default_notes: event.target.value }))}
                placeholder="Notes applied when this value is selected"
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="value-default-cutlist-category">Default cutlist category</Label>
                <Input
                  id="value-default-cutlist-category"
                  value={valueForm.default_cutlist_category ?? ''}
                  onChange={(event) => setValueForm((prev) => ({ ...prev, default_cutlist_category: event.target.value }))}
                  placeholder="e.g., Panels"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="value-default-dimensions">Default cutlist dimensions (JSON)</Label>
                <Textarea
                  id="value-default-dimensions"
                  value={valueForm.default_cutlist_dimensions ?? ''}
                  onChange={(event) => setValueForm((prev) => ({ ...prev, default_cutlist_dimensions: event.target.value }))}
                  placeholder='{ "length": 0, "width": 0, "thickness": 0 }'
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={resetValueDialog}>
                Cancel
              </Button>
              <Button type="submit">{valueTarget?.value ? 'Save changes' : 'Create value'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => (!open ? setPendingDelete(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm deletion</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.type === 'set'
                ? `Delete option set "${pendingDelete.set.name}"? This removes all groups and values.`
                : pendingDelete?.type === 'group'
                  ? `Delete option group "${pendingDelete.group.label}"? This removes all contained values.`
                  : pendingDelete?.type === 'value'
                    ? `Delete option value "${pendingDelete.value.label}"?`
                    : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSubmitting} onClick={() => setPendingDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={executePendingDelete}
              disabled={deleteSubmitting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
