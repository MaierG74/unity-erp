'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  attachOptionSetToProduct,
  clearGroupOverlay,
  clearValueOverlay,
  detachOptionSetFromProduct,
  fetchOptionSets,
  ProductOptionSetLink,
  updateGroupOverlay,
  updateProductOptionSetLink,
  updateValueOverlay,
} from '@/lib/db/option-sets';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Pencil, Plus, Settings2, Trash2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
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

export interface ProductOptionValue {
  option_value_id: number;
  option_group_id: number;
  code: string;
  label: string;
  is_default: boolean;
  display_order: number;
  attributes: Record<string, unknown> | null;
}

export interface ProductOptionGroup {
  option_group_id: number;
  product_id: number;
  code: string;
  label: string;
  display_order: number;
  is_required: boolean;
  values: ProductOptionValue[];
}

interface ProductOptionsResponse {
  product_groups: ProductOptionGroup[];
  option_set_links: ProductOptionSetLink[];
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
}

interface ProductOptionsTabProps {
  productId: number;
}

type LinkedOptionSet = NonNullable<ProductOptionSetLink['option_set']>;
type LinkedOptionSetGroup = LinkedOptionSet['groups'][number];
type LinkedOptionSetValue = LinkedOptionSetGroup['values'][number];

type PendingConfirmAction =
  | { type: 'delete-group'; group: ProductOptionGroup }
  | { type: 'delete-value'; group: ProductOptionGroup; value: ProductOptionValue }
  | { type: 'detach-set'; link: ProductOptionSetLink };

async function fetchProductOptions(productId: number): Promise<ProductOptionsResponse> {
  const res = await fetch(`/api/products/${productId}/options`, { cache: 'no-store' });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || 'Failed to load product options');
  }
  const json = await res.json();
  return {
    product_groups: Array.isArray(json.product_groups) ? (json.product_groups as ProductOptionGroup[]) : [],
    option_set_links: Array.isArray(json.option_set_links) ? (json.option_set_links as ProductOptionSetLink[]) : [],
  };
}

export function ProductOptionsTab({ productId }: ProductOptionsTabProps) {
  const { toast } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['productOptions', productId],
    queryFn: () => fetchProductOptions(productId),
  });

  const { data: optionSetLibrary, isLoading: optionSetsLoading } = useQuery({
    queryKey: ['optionSets'],
    queryFn: fetchOptionSets,
  });

  const productGroups = data?.product_groups ?? [];
  const optionSetLinks = data?.option_set_links ?? [];

  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ProductOptionGroup | null>(null);
  const [groupForm, setGroupForm] = useState<GroupFormState>({ code: '', label: '', is_required: true });

  const [valueDialogOpen, setValueDialogOpen] = useState(false);
  const [editingValue, setEditingValue] = useState<ProductOptionValue | null>(null);
  const [targetGroupForValue, setTargetGroupForValue] = useState<ProductOptionGroup | null>(null);
  const [valueForm, setValueForm] = useState<ValueFormState>({ code: '', label: '', is_default: false });

  const [attachDialogOpen, setAttachDialogOpen] = useState(false);
  const [selectedOptionSetId, setSelectedOptionSetId] = useState<number | null>(null);
  const [optionSetAlias, setOptionSetAlias] = useState('');

  const [groupOverlayDialog, setGroupOverlayDialog] = useState<{
    link: ProductOptionSetLink;
    group: LinkedOptionSetGroup;
    alias: string;
    hide: boolean;
    isRequired: boolean;
    displayOrder: number | '';
  } | null>(null);

  const [valueOverlayDialog, setValueOverlayDialog] = useState<{
    link: ProductOptionSetLink;
    value: LinkedOptionSetValue;
    alias: string;
    hide: boolean;
    isDefault: boolean;
    displayOrder: number | '';
  } | null>(null);

  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmAction | null>(null);
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);

  useEffect(() => {
    if (!attachDialogOpen) {
      setSelectedOptionSetId(null);
      setOptionSetAlias('');
    }
  }, [attachDialogOpen]);

  const availableOptionSets = useMemo(() => {
    if (!optionSetLibrary) return [];
    const attachedIds = new Set(optionSetLinks.map((link) => link.option_set_id));
    return optionSetLibrary.filter((set) => !attachedIds.has(set.option_set_id));
  }, [optionSetLibrary, optionSetLinks]);

  const resetGroupDialog = () => {
    setGroupDialogOpen(false);
    setEditingGroup(null);
    setGroupForm({ code: '', label: '', is_required: true });
  };

  const resetValueDialog = () => {
    setValueDialogOpen(false);
    setEditingValue(null);
    setTargetGroupForValue(null);
    setValueForm({ code: '', label: '', is_default: false });
  };

  const openCreateGroup = () => {
    setEditingGroup(null);
    setGroupForm({ code: '', label: '', is_required: true });
    setGroupDialogOpen(true);
  };

  const openEditGroup = (group: ProductOptionGroup) => {
    setEditingGroup(group);
    setGroupForm({
      code: group.code,
      label: group.label,
      is_required: group.is_required,
      display_order: group.display_order,
    });
    setGroupDialogOpen(true);
  };

  const openCreateValue = (group: ProductOptionGroup) => {
    setTargetGroupForValue(group);
    setEditingValue(null);
    setValueForm({ code: '', label: '', is_default: group.values.length === 0 });
    setValueDialogOpen(true);
  };

  const openEditValue = (group: ProductOptionGroup, value: ProductOptionValue) => {
    setTargetGroupForValue(group);
    setEditingValue(value);
    setValueForm({
      code: value.code,
      label: value.label,
      is_default: value.is_default,
      display_order: value.display_order,
    });
    setValueDialogOpen(true);
  };

  function getGroupOverlay(link: ProductOptionSetLink, groupId: number) {
    return link.group_overlays.find((overlay) => overlay.option_set_group_id === groupId);
  }

  function getValueOverlay(link: ProductOptionSetLink, valueId: number) {
    return link.value_overlays.find((overlay) => overlay.option_set_value_id === valueId);
  }

  async function handleSaveGroup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
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

    const baseUrl = `/api/products/${productId}/options`;

    try {
      const res = await fetch(editingGroup ? `${baseUrl}/groups/${editingGroup.option_group_id}` : baseUrl, {
        method: editingGroup ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || 'Failed to save option group');
      }

      toast({ title: editingGroup ? 'Option group updated' : 'Option group created' });
      await queryClient.invalidateQueries({ queryKey: ['productOptions', productId] });
      resetGroupDialog();
    } catch (err: any) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Error saving option group', description: err.message });
    }
  }

  function requestDeleteGroup(group: ProductOptionGroup) {
    setPendingConfirm({ type: 'delete-group', group });
  }

  async function handleDeleteGroup(group: ProductOptionGroup) {
    try {
      const res = await fetch(`/api/products/${productId}/options/groups/${group.option_group_id}`, { method: 'DELETE' });
      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || 'Failed to delete option group');
      }
      toast({ title: 'Option group deleted' });
      await queryClient.invalidateQueries({ queryKey: ['productOptions', productId] });
    } catch (err: any) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Error deleting option group', description: err.message });
    }
  }

  async function handleSaveValue(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!targetGroupForValue) return;

    const payload = {
      code: valueForm.code.trim(),
      label: valueForm.label.trim(),
      is_default: valueForm.is_default,
      display_order: valueForm.display_order,
    };

    if (!payload.code || !payload.label) {
      toast({ variant: 'destructive', title: 'Missing fields', description: 'Code and label are required.' });
      return;
    }

    const baseUrl = `/api/products/${productId}/options/groups/${targetGroupForValue.option_group_id}/values`;

    try {
      const res = await fetch(editingValue ? `${baseUrl}/${editingValue.option_value_id}` : baseUrl, {
        method: editingValue ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || 'Failed to save option value');
      }

      toast({ title: editingValue ? 'Option value updated' : 'Option value created' });
      await queryClient.invalidateQueries({ queryKey: ['productOptions', productId] });
      resetValueDialog();
    } catch (err: any) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Error saving option value', description: err.message });
    }
  }

  function requestDeleteValue(group: ProductOptionGroup, value: ProductOptionValue) {
    setPendingConfirm({ type: 'delete-value', group, value });
  }

  async function handleDeleteValue(group: ProductOptionGroup, value: ProductOptionValue) {
    try {
      const res = await fetch(`/api/products/${productId}/options/groups/${group.option_group_id}/values/${value.option_value_id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || 'Failed to delete option value');
      }
      toast({ title: 'Option value deleted' });
      await queryClient.invalidateQueries({ queryKey: ['productOptions', productId] });
    } catch (err: any) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Error deleting option value', description: err.message });
    }
  }

  async function handleAttachOptionSet(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOptionSetId) {
      toast({ variant: 'destructive', title: 'Select an option set' });
      return;
    }

    try {
      await attachOptionSetToProduct(productId, selectedOptionSetId, optionSetAlias.trim() || null);
      toast({ title: 'Option set attached' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['productOptions', productId] }),
        queryClient.invalidateQueries({ queryKey: ['optionSets'] }),
      ]);
      setAttachDialogOpen(false);
    } catch (err: any) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Failed to attach option set', description: err.message });
    }
  }

  async function handleDetachOptionSet(link: ProductOptionSetLink) {
    try {
      await detachOptionSetFromProduct(productId, link.link_id);
      toast({ title: 'Option set detached' });
      await queryClient.invalidateQueries({ queryKey: ['productOptions', productId] });
    } catch (err: any) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Failed to detach option set', description: err.message });
    }
  }

  function requestDetachOptionSet(link: ProductOptionSetLink) {
    setPendingConfirm({ type: 'detach-set', link });
  }

  async function executePendingConfirm() {
    if (!pendingConfirm) return;
    setConfirmSubmitting(true);
    try {
      if (pendingConfirm.type === 'delete-group') {
        await handleDeleteGroup(pendingConfirm.group);
      } else if (pendingConfirm.type === 'delete-value') {
        await handleDeleteValue(pendingConfirm.group, pendingConfirm.value);
      } else if (pendingConfirm.type === 'detach-set') {
        await handleDetachOptionSet(pendingConfirm.link);
      }
      setPendingConfirm(null);
    } finally {
      setConfirmSubmitting(false);
    }
  }

  const [linkAliasDialog, setLinkAliasDialog] = useState<{ link: ProductOptionSetLink; alias: string } | null>(null);

  function openLinkAliasDialog(link: ProductOptionSetLink) {
    setLinkAliasDialog({ link, alias: link.alias_label ?? '' });
  }

  async function handleSaveLinkAlias(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!linkAliasDialog) return;
    try {
      await updateProductOptionSetLink(productId, linkAliasDialog.link.link_id, {
        alias_label: linkAliasDialog.alias.trim() || null,
      });
      toast({ title: 'Option set updated' });
      await queryClient.invalidateQueries({ queryKey: ['productOptions', productId] });
      setLinkAliasDialog(null);
    } catch (err: any) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Failed to update option set', description: err.message });
    }
  }

  function openGroupOverlay(link: ProductOptionSetLink, groupId: number) {
    if (!link.option_set) return;
    const group = link.option_set.groups.find((g) => g.option_set_group_id === groupId);
    if (!group) return;
    const overlay = getGroupOverlay(link, groupId);
    setGroupOverlayDialog({
      link,
      group,
      alias: overlay?.alias_label ?? '',
      hide: overlay?.hide ?? false,
      isRequired: overlay?.is_required ?? group.is_required,
      displayOrder: overlay?.display_order ?? '',
    });
  }

  function openValueOverlay(link: ProductOptionSetLink, valueId: number) {
    if (!link.option_set) return;
    const group = link.option_set.groups.find((g) => g.values.some((v) => v.option_set_value_id === valueId));
    if (!group) return;
    const value = group.values.find((v) => v.option_set_value_id === valueId);
    if (!value) return;
    const overlay = getValueOverlay(link, valueId);
    setValueOverlayDialog({
      link,
      value,
      alias: overlay?.alias_label ?? '',
      hide: overlay?.hide ?? false,
      isDefault: overlay?.is_default ?? value.is_default,
      displayOrder: overlay?.display_order ?? '',
    });
  }

  async function handleSubmitGroupOverlay(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!groupOverlayDialog) return;

    try {
      await updateGroupOverlay(productId, groupOverlayDialog.link.link_id, groupOverlayDialog.group.option_set_group_id, {
        alias_label: groupOverlayDialog.alias.trim() || null,
        hide: groupOverlayDialog.hide,
        is_required: groupOverlayDialog.isRequired,
        display_order: groupOverlayDialog.displayOrder === '' ? undefined : Number(groupOverlayDialog.displayOrder),
      });
      toast({ title: 'Group customisation saved' });
      await queryClient.invalidateQueries({ queryKey: ['productOptions', productId] });
      setGroupOverlayDialog(null);
    } catch (err: any) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Failed to save group customisation', description: err.message });
    }
  }

  async function handleResetGroupOverlay() {
    if (!groupOverlayDialog) return;
    try {
      await clearGroupOverlay(productId, groupOverlayDialog.link.link_id, groupOverlayDialog.group.option_set_group_id);
      toast({ title: 'Group customisation cleared' });
      await queryClient.invalidateQueries({ queryKey: ['productOptions', productId] });
      setGroupOverlayDialog(null);
    } catch (err: any) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Failed to clear customisation', description: err.message });
    }
  }

  async function handleSubmitValueOverlay(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valueOverlayDialog) return;

    try {
      await updateValueOverlay(productId, valueOverlayDialog.link.link_id, valueOverlayDialog.value.option_set_value_id, {
        alias_label: valueOverlayDialog.alias.trim() || null,
        hide: valueOverlayDialog.hide,
        is_default: valueOverlayDialog.isDefault,
        display_order: valueOverlayDialog.displayOrder === '' ? undefined : Number(valueOverlayDialog.displayOrder),
      });
      toast({ title: 'Value customisation saved' });
      await queryClient.invalidateQueries({ queryKey: ['productOptions', productId] });
      setValueOverlayDialog(null);
    } catch (err: any) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Failed to save value customisation', description: err.message });
    }
  }

  async function handleResetValueOverlay() {
    if (!valueOverlayDialog) return;
    try {
      await clearValueOverlay(productId, valueOverlayDialog.link.link_id, valueOverlayDialog.value.option_set_value_id);
      toast({ title: 'Value customisation cleared' });
      await queryClient.invalidateQueries({ queryKey: ['productOptions', productId] });
      setValueOverlayDialog(null);
    } catch (err: any) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Failed to clear customisation', description: err.message });
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading product options…
      </div>
    );
  }

  if (error) {
    return <div className="text-destructive">Failed to load product options: {(error as Error).message}</div>;
  }

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Attached Option Sets</h3>
            <p className="text-sm text-muted-foreground">Attach reusable option sets and customise their presentation per product.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push('/products/options/sets')}>
              Manage Library
            </Button>
            <Button size="sm" onClick={() => setAttachDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Attach Option Set
            </Button>
          </div>
        </div>

        {optionSetLinks.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No option sets attached yet. Attach a set to reuse configurations like handles or finishes.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {optionSetLinks.map((link) => {
              const set = link.option_set;
              return (
                <Card key={link.link_id}>
                  <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <CardTitle className="text-base font-semibold">
                        {link.alias_label || set?.name || `Option Set ${link.option_set_id}`}
                      </CardTitle>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {set?.code && <Badge variant="outline">{set.code}</Badge>}
                        <span>Order: {link.display_order}</span>
                        {link.alias_label && set?.name && <span>Base: {set.name}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="icon" onClick={() => openLinkAliasDialog(link)}>
                        <Pencil className="h-4 w-4" />
                        <span className="sr-only">Edit alias</span>
                      </Button>
                      <Button variant="ghost" size="icon" className="text-destructive" onClick={() => requestDetachOptionSet(link)}>
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">Detach option set</span>
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {set ? (
                      set.groups.map((group) => {
                        const overlay = getGroupOverlay(link, group.option_set_group_id);
                        const effectiveLabel = overlay?.alias_label || group.label;
                        const hidden = overlay?.hide ?? false;
                        const effectiveRequired = overlay?.is_required ?? group.is_required;
                        return (
                          <div key={group.option_set_group_id} className={cn('rounded-md border border-muted/60 p-3', hidden && 'opacity-60')}> 
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="flex items-center gap-2">
                                  <h4 className="font-medium text-sm text-foreground">{effectiveLabel}</h4>
                                  {hidden && <Badge variant="secondary">Hidden</Badge>}
                                  {!hidden && effectiveRequired && <Badge variant="outline">Required</Badge>}
                                </div>
                                <p className="text-xs text-muted-foreground">Code: {group.code}</p>
                              </div>
                              <Button size="sm" variant="outline" onClick={() => openGroupOverlay(link, group.option_set_group_id)}>
                                <Settings2 className="mr-2 h-3 w-3" /> Customise
                              </Button>
                            </div>
                            <div className="mt-3 space-y-2 pl-2">
                              {group.values.map((value) => {
                                const valueOverlay = getValueOverlay(link, value.option_set_value_id);
                                const valueAlias = valueOverlay?.alias_label || value.label;
                                const valueHidden = valueOverlay?.hide ?? false;
                                const valueDefault = valueOverlay?.is_default ?? value.is_default;
                                return (
                                  <div key={value.option_set_value_id} className={cn('flex flex-wrap items-center justify-between gap-2 rounded border border-dashed border-muted/70 px-3 py-2 text-sm', valueHidden && 'opacity-60')}> 
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium">{valueAlias}</span>
                                        {valueDefault && <Badge variant="outline">Default</Badge>}
                                        {valueHidden && <Badge variant="secondary">Hidden</Badge>}
                                      </div>
                                      <div className="text-xs text-muted-foreground">Code: {value.code}</div>
                                    </div>
                                    <Button size="sm" variant="ghost" onClick={() => openValueOverlay(link, value.option_set_value_id)}>
                                      Customise
                                    </Button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-sm text-muted-foreground">Option set metadata unavailable.</div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <Separator />

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Product-specific Groups</h3>
          <Button size="sm" onClick={openCreateGroup}>
            <Plus className="mr-2 h-4 w-4" /> Add Product-only Group
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">Use these groups when a configuration only applies to this product. For reusable options, prefer attaching a set.</p>

        {productGroups.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">No product-specific option groups defined.</CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {productGroups.map((group) => (
              <Card key={group.option_group_id}>
                <CardHeader className="flex flex-row items-start justify-between space-y-0">
                  <div>
                    <CardTitle className="text-base font-semibold">{group.label}</CardTitle>
                    <p className="text-sm text-muted-foreground">Code: {group.code}</p>
                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={group.is_required ? 'default' : 'secondary'}>{group.is_required ? 'Required' : 'Optional'}</Badge>
                      <Badge variant="outline">Order: {group.display_order}</Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="icon" variant="outline" onClick={() => openEditGroup(group)}>
                      <Pencil className="h-4 w-4" />
                      <span className="sr-only">Edit group</span>
                    </Button>
                    <Button size="icon" variant="destructive" onClick={() => requestDeleteGroup(group)}>
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Delete group</span>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-muted-foreground">Values</h4>
                    <Button size="sm" variant="outline" onClick={() => openCreateValue(group)}>
                      <Plus className="mr-1 h-3 w-3" /> Add Value
                    </Button>
                  </div>
                  {group.values.length === 0 ? (
                    <div className="rounded border border-dashed border-muted p-4 text-center text-sm text-muted-foreground">No values yet.</div>
                  ) : (
                    <div className="space-y-2">
                      {group.values.map((value) => (
                        <div key={value.option_value_id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-muted bg-muted/30 p-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{value.label}</span>
                              {value.is_default && <Badge>Default</Badge>}
                            </div>
                            <div className="text-xs text-muted-foreground">Code: {value.code} · Order: {value.display_order}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button size="icon" variant="outline" onClick={() => openEditValue(group, value)}>
                              <Pencil className="h-4 w-4" />
                              <span className="sr-only">Edit value</span>
                            </Button>
                            <Button size="icon" variant="ghost" className="text-destructive" onClick={() => requestDeleteValue(group, value)}>
                              <Trash2 className="h-4 w-4" />
                              <span className="sr-only">Delete value</span>
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Attach option set dialog */}
      <Dialog open={attachDialogOpen} onOpenChange={(open) => setAttachDialogOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Attach option set</DialogTitle>
            <DialogDescription>Select a reusable option set to add to this product.</DialogDescription>
          </DialogHeader>
          {optionSetsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading option sets…
            </div>
          ) : availableOptionSets.length === 0 ? (
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>All option sets are already attached. Create a new set in the library.</p>
              <Button variant="outline" size="sm" onClick={() => router.push('/products/options/sets')}>
                Go to Option Set Library
              </Button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={handleAttachOptionSet}>
              <div className="space-y-2">
                <Label htmlFor="attach-select">Option set</Label>
                <Select value={selectedOptionSetId ? String(selectedOptionSetId) : ''} onValueChange={(value) => setSelectedOptionSetId(Number(value))}>
                  <SelectTrigger id="attach-select">
                    <SelectValue placeholder="Choose option set" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableOptionSets.map((set) => (
                      <SelectItem key={set.option_set_id} value={String(set.option_set_id)}>
                        {set.name} ({set.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="attach-alias">Alias (optional)</Label>
                <Input id="attach-alias" value={optionSetAlias} onChange={(event) => setOptionSetAlias(event.target.value)} placeholder="Custom label shown in this product" />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAttachDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">Attach</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Alias dialog */}
      <Dialog open={Boolean(linkAliasDialog)} onOpenChange={(open) => (!open ? setLinkAliasDialog(null) : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit option set alias</DialogTitle>
            <DialogDescription>Override the default option set label for this product.</DialogDescription>
          </DialogHeader>
          {linkAliasDialog && (
            <form className="space-y-4" onSubmit={handleSaveLinkAlias}>
              <div className="space-y-2">
                <Label htmlFor="alias-input">Alias</Label>
                <Input
                  id="alias-input"
                  value={linkAliasDialog.alias}
                  onChange={(event) => setLinkAliasDialog({ link: linkAliasDialog.link, alias: event.target.value })}
                  placeholder={linkAliasDialog.link.option_set?.name ?? 'Option set alias'}
                />
                <p className="text-xs text-muted-foreground">Leave blank to fall back to the option set name.</p>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setLinkAliasDialog(null)}>
                  Cancel
                </Button>
                <Button type="submit">Save</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Group overlay dialog */}
      <Dialog open={Boolean(groupOverlayDialog)} onOpenChange={(open) => (!open ? setGroupOverlayDialog(null) : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Customise group</DialogTitle>
            <DialogDescription>Adjust the label, visibility, or order for this group in the current product.</DialogDescription>
          </DialogHeader>
          {groupOverlayDialog && (
            <form className="space-y-4" onSubmit={handleSubmitGroupOverlay}>
              <div className="space-y-2">
                <Label htmlFor="group-custom-label">Display label</Label>
                <Input
                  id="group-custom-label"
                  value={groupOverlayDialog.alias}
                  onChange={(event) => setGroupOverlayDialog({ ...groupOverlayDialog, alias: event.target.value })}
                  placeholder={groupOverlayDialog.group.label}
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="group-custom-hide"
                  checked={groupOverlayDialog.hide}
                  onCheckedChange={(checked) => setGroupOverlayDialog({ ...groupOverlayDialog, hide: Boolean(checked) })}
                />
                <Label htmlFor="group-custom-hide">Hide this group</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="group-custom-required"
                  checked={groupOverlayDialog.isRequired}
                  onCheckedChange={(checked) => setGroupOverlayDialog({ ...groupOverlayDialog, isRequired: Boolean(checked) })}
                  disabled={groupOverlayDialog.hide}
                />
                <Label htmlFor="group-custom-required">Mark as required</Label>
              </div>
              <div className="space-y-2">
                <Label htmlFor="group-custom-order">Display order</Label>
                <Input
                  id="group-custom-order"
                  type="number"
                  value={groupOverlayDialog.displayOrder === '' ? '' : String(groupOverlayDialog.displayOrder)}
                  onChange={(event) =>
                    setGroupOverlayDialog({
                      ...groupOverlayDialog,
                      displayOrder: event.target.value === '' ? '' : Number(event.target.value),
                    })
                  }
                  placeholder="Keep original order"
                />
              </div>
              <DialogFooter className="flex flex-wrap items-center justify-between gap-2">
                <Button type="button" variant="ghost" onClick={handleResetGroupOverlay}>
                  Reset to defaults
                </Button>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" onClick={() => setGroupOverlayDialog(null)}>
                    Cancel
                  </Button>
                  <Button type="submit">Save</Button>
                </div>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Value overlay dialog */}
      <Dialog open={Boolean(valueOverlayDialog)} onOpenChange={(open) => (!open ? setValueOverlayDialog(null) : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Customise value</DialogTitle>
            <DialogDescription>Override label, visibility, or default state for this value.</DialogDescription>
          </DialogHeader>
          {valueOverlayDialog && (
            <form className="space-y-4" onSubmit={handleSubmitValueOverlay}>
              <div className="space-y-2">
                <Label htmlFor="value-custom-label">Display label</Label>
                <Input
                  id="value-custom-label"
                  value={valueOverlayDialog.alias}
                  onChange={(event) => setValueOverlayDialog({ ...valueOverlayDialog, alias: event.target.value })}
                  placeholder={valueOverlayDialog.value.label}
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="value-custom-hide"
                  checked={valueOverlayDialog.hide}
                  onCheckedChange={(checked) => setValueOverlayDialog({ ...valueOverlayDialog, hide: Boolean(checked) })}
                />
                <Label htmlFor="value-custom-hide">Hide this value</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="value-custom-default"
                  checked={valueOverlayDialog.isDefault}
                  onCheckedChange={(checked) => setValueOverlayDialog({ ...valueOverlayDialog, isDefault: Boolean(checked) })}
                  disabled={valueOverlayDialog.hide}
                />
                <Label htmlFor="value-custom-default">Mark as default</Label>
              </div>
              <div className="space-y-2">
                <Label htmlFor="value-custom-order">Display order</Label>
                <Input
                  id="value-custom-order"
                  type="number"
                  value={valueOverlayDialog.displayOrder === '' ? '' : String(valueOverlayDialog.displayOrder)}
                  onChange={(event) =>
                    setValueOverlayDialog({
                      ...valueOverlayDialog,
                      displayOrder: event.target.value === '' ? '' : Number(event.target.value),
                    })
                  }
                  placeholder="Keep original order"
                />
              </div>
              <DialogFooter className="flex flex-wrap items-center justify-between gap-2">
                <Button type="button" variant="ghost" onClick={handleResetValueOverlay}>
                  Reset to defaults
                </Button>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" onClick={() => setValueOverlayDialog(null)}>
                    Cancel
                  </Button>
                  <Button type="submit">Save</Button>
                </div>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Product group dialog */}
      <Dialog open={groupDialogOpen} onOpenChange={(open) => (open ? setGroupDialogOpen(true) : resetGroupDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingGroup ? 'Edit option group' : 'Add option group'}</DialogTitle>
            <DialogDescription>Define a product-specific option group. Codes should be unique per product.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveGroup} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="group-code">Code</Label>
              <Input id="group-code" value={groupForm.code} onChange={(event) => setGroupForm((prev) => ({ ...prev, code: event.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="group-label">Label</Label>
              <Input id="group-label" value={groupForm.label} onChange={(event) => setGroupForm((prev) => ({ ...prev, label: event.target.value }))} required />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="group-required" checked={groupForm.is_required} onCheckedChange={(checked) => setGroupForm((prev) => ({ ...prev, is_required: Boolean(checked) }))} />
              <Label htmlFor="group-required">Required</Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="group-order">Display order</Label>
              <Input
                id="group-order"
                type="number"
                value={groupForm.display_order ?? ''}
                onChange={(event) =>
                  setGroupForm((prev) => ({
                    ...prev,
                    display_order: event.target.value === '' ? undefined : Number(event.target.value),
                  }))
                }
                placeholder="Auto"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={resetGroupDialog}>
                Cancel
              </Button>
              <Button type="submit">{editingGroup ? 'Save changes' : 'Create group'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Product value dialog */}
      <Dialog open={valueDialogOpen} onOpenChange={(open) => (open ? setValueDialogOpen(true) : resetValueDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingValue ? 'Edit option value' : 'Add option value'}</DialogTitle>
            <DialogDescription>Define the label and behaviour for this product-specific value.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveValue} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="value-code">Code</Label>
              <Input id="value-code" value={valueForm.code} onChange={(event) => setValueForm((prev) => ({ ...prev, code: event.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="value-label">Label</Label>
              <Input id="value-label" value={valueForm.label} onChange={(event) => setValueForm((prev) => ({ ...prev, label: event.target.value }))} required />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="value-default" checked={valueForm.is_default} onCheckedChange={(checked) => setValueForm((prev) => ({ ...prev, is_default: Boolean(checked) }))} />
              <Label htmlFor="value-default">Default selection</Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="value-order">Display order</Label>
              <Input
                id="value-order"
                type="number"
                value={valueForm.display_order ?? ''}
                onChange={(event) =>
                  setValueForm((prev) => ({
                    ...prev,
                    display_order: event.target.value === '' ? undefined : Number(event.target.value),
                  }))
                }
                placeholder="Auto"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={resetValueDialog}>
                Cancel
              </Button>
              <Button type="submit">{editingValue ? 'Save value' : 'Create value'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pendingConfirm !== null} onOpenChange={(open) => (!open ? setPendingConfirm(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm action</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingConfirm?.type === 'delete-group'
                ? `Delete option group "${pendingConfirm.group.label}"? This will remove all values.`
                : pendingConfirm?.type === 'delete-value'
                  ? `Delete option value "${pendingConfirm.value.label}"?`
                  : pendingConfirm?.type === 'detach-set'
                    ? `Detach option set "${pendingConfirm.link.option_set?.name ?? pendingConfirm.link.option_set_id}" from this product? Overrides will be lost.`
                    : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmSubmitting} onClick={() => setPendingConfirm(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={executePendingConfirm}
              disabled={confirmSubmitting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {confirmSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
