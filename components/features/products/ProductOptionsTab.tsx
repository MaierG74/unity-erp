'use client';

import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';

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

async function fetchProductOptions(productId: number): Promise<ProductOptionGroup[]> {
  const res = await fetch(`/api/products/${productId}/options`, { cache: 'no-store' });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || 'Failed to load product options');
  }
  const json = await res.json();
  return Array.isArray(json.groups) ? json.groups : [];
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

export function ProductOptionsTab({ productId }: ProductOptionsTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['productOptions', productId],
    queryFn: () => fetchProductOptions(productId),
  });

  const groups = useMemo(() => data ?? [], [data]);

  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ProductOptionGroup | null>(null);
  const [groupForm, setGroupForm] = useState<GroupFormState>({ code: '', label: '', is_required: true });

  const [valueDialogOpen, setValueDialogOpen] = useState(false);
  const [editingValue, setEditingValue] = useState<ProductOptionValue | null>(null);
  const [targetGroupForValue, setTargetGroupForValue] = useState<ProductOptionGroup | null>(null);
  const [valueForm, setValueForm] = useState<ValueFormState>({ code: '', label: '', is_default: false });

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

    try {
      const res = await fetch(`/api/products/${productId}/options${editingGroup ? `/groups/${editingGroup.option_group_id}` : ''}`, {
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
    } catch (error: any) {
      console.error(error);
      toast({ variant: 'destructive', title: 'Error saving option group', description: error.message });
    }
  }

  async function handleDeleteGroup(group: ProductOptionGroup) {
    const confirmed = window.confirm(`Delete option group "${group.label}"? This removes all associated values.`);
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/products/${productId}/options/groups/${group.option_group_id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || 'Failed to delete option group');
      }
      toast({ title: 'Option group deleted' });
      await queryClient.invalidateQueries({ queryKey: ['productOptions', productId] });
    } catch (error: any) {
      console.error(error);
      toast({ variant: 'destructive', title: 'Error deleting option group', description: error.message });
    }
  }

  async function handleSaveValue(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const group = targetGroupForValue;
    if (!group) return;

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

    const baseUrl = `/api/products/${productId}/options/groups/${group.option_group_id}/values`;

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
    } catch (error: any) {
      console.error(error);
      toast({ variant: 'destructive', title: 'Error saving option value', description: error.message });
    }
  }

  async function handleDeleteValue(group: ProductOptionGroup, value: ProductOptionValue) {
    const confirmed = window.confirm(`Delete option value "${value.label}"?`);
    if (!confirmed) return;

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
    } catch (error: any) {
      console.error(error);
      toast({ variant: 'destructive', title: 'Error deleting option value', description: error.message });
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading product options…
      </div>
    );
  }

  if (error) {
    return <div className="text-destructive">Failed to load options: {(error as Error).message}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Configuration Options</h3>
        <Button size="sm" onClick={openCreateGroup}>
          <Plus className="mr-2 h-4 w-4" /> Add Option Group
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Option groups allow you to capture configurable attributes (e.g., carcass colour, handle finish, edge band). Values selected here will be
        available during quoting and ordering.
      </p>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No option groups defined yet. Add your first group to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map(group => (
            <Card key={group.option_group_id}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="text-base font-semibold">{group.label}</CardTitle>
                  <p className="text-sm text-muted-foreground">Code: {group.code}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <Badge variant={group.is_required ? 'default' : 'secondary'}>
                      {group.is_required ? 'Required' : 'Optional'}
                    </Badge>
                    <Badge variant="outline">Order: {group.display_order}</Badge>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="icon" variant="outline" onClick={() => openEditGroup(group)}>
                    <Pencil className="h-4 w-4" />
                    <span className="sr-only">Edit group</span>
                  </Button>
                  <Button size="icon" variant="destructive" onClick={() => handleDeleteGroup(group)}>
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Delete group</span>
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <h4 className="text-sm font-medium text-muted-foreground">Values</h4>
                  <Button size="xs" variant="outline" onClick={() => openCreateValue(group)}>
                    <Plus className="mr-1 h-3 w-3" /> Add Value
                  </Button>
                </div>
                {group.values.length === 0 ? (
                  <div className="rounded-md border border-dashed border-muted p-4 text-sm text-muted-foreground text-center">
                    No values yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {group.values.map(value => (
                      <div
                        key={value.option_value_id}
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
                          <Button size="icon" variant="outline" onClick={() => openEditValue(group, value)}>
                            <Pencil className="h-4 w-4" />
                            <span className="sr-only">Edit value</span>
                          </Button>
                          <Button size="icon" variant="ghost" className="text-destructive" onClick={() => handleDeleteValue(group, value)}>
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

      <Dialog open={groupDialogOpen} onOpenChange={(open) => (open ? setGroupDialogOpen(true) : resetGroupDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingGroup ? 'Edit option group' : 'Add option group'}</DialogTitle>
            <DialogDescription>
              Define a configurable attribute for this product. Codes should be short and unique per product.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveGroup} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="group-code">Code</Label>
              <Input
                id="group-code"
                value={groupForm.code}
                onChange={(e) => setGroupForm(form => ({ ...form, code: e.target.value }))}
                placeholder="e.g., carcass_colour"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="group-label">Label</Label>
              <Input
                id="group-label"
                value={groupForm.label}
                onChange={(e) => setGroupForm(form => ({ ...form, label: e.target.value }))}
                placeholder="e.g., Carcass Colour"
                required
              />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="group-required"
                checked={groupForm.is_required}
                onCheckedChange={(checked) => setGroupForm(form => ({ ...form, is_required: Boolean(checked) }))}
              />
              <Label htmlFor="group-required" className="text-sm">Selection required when quoting/ordering</Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="group-order">Display order (optional)</Label>
              <Input
                id="group-order"
                type="number"
                value={groupForm.display_order ?? ''}
                onChange={(e) => {
                  const value = e.target.value;
                  setGroupForm(form => ({ ...form, display_order: value === '' ? undefined : Number(value) }));
                }}
                placeholder="e.g., 0"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={resetGroupDialog}>Cancel</Button>
              <Button type="submit">{editingGroup ? 'Save changes' : 'Create group'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={valueDialogOpen} onOpenChange={(open) => (open ? setValueDialogOpen(true) : resetValueDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingValue ? 'Edit option value' : 'Add option value'}</DialogTitle>
            <DialogDescription>
              Define a selectable option for the "{targetGroupForValue?.label || ''}" group.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveValue} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="value-code">Code</Label>
              <Input
                id="value-code"
                value={valueForm.code}
                onChange={(e) => setValueForm(form => ({ ...form, code: e.target.value }))}
                placeholder="e.g., oak"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="value-label">Label</Label>
              <Input
                id="value-label"
                value={valueForm.label}
                onChange={(e) => setValueForm(form => ({ ...form, label: e.target.value }))}
                placeholder="e.g., Oak Melamine"
                required
              />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="value-default"
                checked={valueForm.is_default}
                onCheckedChange={(checked) => setValueForm(form => ({ ...form, is_default: Boolean(checked) }))}
              />
              <Label htmlFor="value-default" className="text-sm">Default selection</Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="value-order">Display order (optional)</Label>
              <Input
                id="value-order"
                type="number"
                value={valueForm.display_order ?? ''}
                onChange={(e) => {
                  const value = e.target.value;
                  setValueForm(form => ({ ...form, display_order: value === '' ? undefined : Number(value) }));
                }}
                placeholder="e.g., 0"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={resetValueDialog}>Cancel</Button>
              <Button type="submit">{editingValue ? 'Save changes' : 'Create value'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Separator />
      <p className="text-xs text-muted-foreground">
        Tip: once options are defined, use BOM overrides to swap components per selection. The quote/order flows already support rendering these options.
      </p>
    </div>
  );
}

export default ProductOptionsTab;
