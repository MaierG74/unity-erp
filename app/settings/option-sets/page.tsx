'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useOptionSets,
  type OptionSet,
  type OptionSetGroup,
  type OptionSetValue,
} from '@/hooks/useOptionSets';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Pencil, Plus, Trash2, ChevronDown, Search } from 'lucide-react';
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
}

export default function OptionSetLibraryPage() {
  const { data, isLoading, error } = useOptionSets();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const optionSets = useMemo(() => data ?? [], [data]);

  const [setDialogOpen, setSetDialogOpen] = useState(false);
  const [editingSet, setEditingSet] = useState<OptionSet | null>(null);
  const [setForm, setSetForm] = useState<SetFormState>({ code: '', name: '', description: '' });
  const [savingSet, setSavingSet] = useState(false);

  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupTarget, setGroupTarget] = useState<{ setId: number; group: OptionSetGroup | null } | null>(null);
  const [groupForm, setGroupForm] = useState<GroupFormState>({ code: '', label: '', is_required: true });

  const [valueDialogOpen, setValueDialogOpen] = useState(false);
  const [valueTarget, setValueTarget] = useState<{ setId: number; group: OptionSetGroup; value: OptionSetValue | null } | null>(null);
  const [valueForm, setValueForm] = useState<ValueFormState>({ code: '', label: '', is_default: false });

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
    setValueForm({ code: '', label: '', is_default: false });
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
    setValueForm({ code: '', label: '', is_default: group.values.length === 0 });
    setValueDialogOpen(true);
  };

  const openEditValue = (setId: number, group: OptionSetGroup, value: OptionSetValue) => {
    setValueTarget({ setId, group, value });
    setValueForm({
      code: value.code,
      label: value.label,
      is_default: value.is_default,
      display_order: value.display_order,
    });
    setValueDialogOpen(true);
  };

  const handleSaveValue = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valueTarget) return;

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
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-6 shadow-sm">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold">Option Set Library</h1>
            <p className="text-sm text-muted-foreground">
              Manage reusable configuration sets (handles, finishes, locks, etc.) that can be attached to products.
            </p>
          </div>
          <div>
            <Button size="sm" onClick={openCreateSet}>
              <Plus className="mr-2 h-4 w-4" /> Create Option Set
            </Button>
          </div>
        </div>

        {optionSets.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground text-sm">
              No option sets in the library yet. Create your first set to start sharing configuration across products.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {optionSets.map((set) => (
              <Card key={set.option_set_id}>
                <CardHeader className="flex flex-col gap-3 border-b border-border/60 pb-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-lg font-semibold">{set.name}</CardTitle>
                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <span>Code: <span className="font-medium text-foreground">{set.code}</span></span>
                      <Badge variant="secondary">{set.groups.length} group{set.groups.length === 1 ? '' : 's'}</Badge>
                      <Badge variant="outline">Usage: {set.usage_count}</Badge>
                    </div>
                    {set.description && <p className="text-sm text-muted-foreground">{set.description}</p>}
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
                <CardContent className="space-y-4 pt-4">
                  <div className="flex justify-between items-center">
                    <h2 className="text-sm font-medium text-muted-foreground">Groups & Values</h2>
                    <Button size="xs" variant="outline" onClick={() => openCreateGroup(set.option_set_id)}>
                      <Plus className="mr-1 h-3 w-3" /> Add Group
                    </Button>
                  </div>
                  {set.groups.length === 0 ? (
                    <div className="rounded-md border border-dashed border-muted p-4 text-center text-sm text-muted-foreground">
                      No groups yet.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {set.groups.map((group) => (
                        <div key={group.option_set_group_id} className="rounded-md border border-border/70 bg-muted/20 p-4">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <div className="flex items-center gap-2">
                                <h3 className="font-medium text-foreground">{group.label}</h3>
                                <Badge variant={group.is_required ? 'default' : 'secondary'}>
                                  {group.is_required ? 'Required' : 'Optional'}
                                </Badge>
                                <Badge variant="outline">Order: {group.display_order}</Badge>
                              </div>
                              <p className="text-xs text-muted-foreground">Code: {group.code}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button size="icon" variant="outline" onClick={() => openEditGroup(set.option_set_id, group)}>
                                <Pencil className="h-4 w-4" />
                                <span className="sr-only">Edit group</span>
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-destructive"
                                onClick={() => requestDeleteGroup(set.option_set_id, group)}
                              >
                                <Trash2 className="h-4 w-4" />
                                <span className="sr-only">Delete group</span>
                              </Button>
                            </div>
                          </div>

                          <div className="mt-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs uppercase tracking-wide text-muted-foreground">Values</span>
                              <Button size="xs" variant="outline" onClick={() => openCreateValue(set.option_set_id, group)}>
                                <Plus className="mr-1 h-3 w-3" /> Add Value
                              </Button>
                            </div>
                            {group.values.length === 0 ? (
                              <div className="rounded border border-dashed border-muted p-3 text-center text-xs text-muted-foreground">
                                No values defined.
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {group.values.map((value) => (
                                  <div
                                    key={value.option_set_value_id}
                                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-muted bg-muted/30 p-3"
                                  >
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium">{value.label}</span>
                                        {value.is_default && <Badge>Default</Badge>}
                                      </div>
                                      <div className="text-xs text-muted-foreground">Code: {value.code} · Order: {value.display_order}</div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Button size="icon" variant="outline" onClick={() => openEditValue(set.option_set_id, group, value)}>
                                        <Pencil className="h-4 w-4" />
                                        <span className="sr-only">Edit value</span>
                                      </Button>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="text-destructive"
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
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
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
