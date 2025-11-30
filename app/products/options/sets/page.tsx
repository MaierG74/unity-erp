'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createOptionSet,
  deleteOptionSet,
  fetchOptionSets,
  OptionSetSummary,
  updateOptionSet,
} from '@/lib/db/option-sets';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';

interface OptionSetFormState {
  code: string;
  name: string;
  description: string;
}

export default function OptionSetLibraryPage() {
  const { toast } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['optionSets'],
    queryFn: fetchOptionSets,
  });

  const optionSets = data ?? [];

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createForm, setCreateForm] = useState<OptionSetFormState>({ code: '', name: '', description: '' });

  const [editDialog, setEditDialog] = useState<{ set: OptionSetSummary; form: OptionSetFormState } | null>(null);

  async function handleCreateOptionSet(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createForm.code.trim() || !createForm.name.trim()) {
      toast({ variant: 'destructive', title: 'Missing required fields' });
      return;
    }

    try {
      await createOptionSet({
        code: createForm.code.trim(),
        name: createForm.name.trim(),
        description: createForm.description.trim() || null,
      });
      toast({ title: 'Option set created' });
      await queryClient.invalidateQueries({ queryKey: ['optionSets'] });
      setCreateForm({ code: '', name: '', description: '' });
      setCreateDialogOpen(false);
    } catch (err: any) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Failed to create option set', description: err.message });
    }
  }

  async function handleUpdateOptionSet(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editDialog) return;
    if (!editDialog.form.code.trim() || !editDialog.form.name.trim()) {
      toast({ variant: 'destructive', title: 'Missing required fields' });
      return;
    }

    try {
      await updateOptionSet(editDialog.set.option_set_id, {
        code: editDialog.form.code.trim(),
        name: editDialog.form.name.trim(),
        description: editDialog.form.description.trim() || null,
      });
      toast({ title: 'Option set updated' });
      await queryClient.invalidateQueries({ queryKey: ['optionSets'] });
      setEditDialog(null);
    } catch (err: any) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Failed to update option set', description: err.message });
    }
  }

  async function handleDeleteOptionSet(set: OptionSetSummary) {
    if (set.usage_count > 0) {
      toast({ variant: 'destructive', title: 'Cannot delete option set in use' });
      return;
    }
    const confirmed = window.confirm(`Delete option set "${set.name}"? This cannot be undone.`);
    if (!confirmed) return;

    try {
      await deleteOptionSet(set.option_set_id);
      toast({ title: 'Option set deleted' });
      await queryClient.invalidateQueries({ queryKey: ['optionSets'] });
    } catch (err: any) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Failed to delete option set', description: err.message });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Option Set Library</h1>
          <p className="text-sm text-muted-foreground">Manage reusable option sets that can be attached to multiple products.</p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> New Option Set
        </Button>
      </div>

      <Separator />

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading option sets…
        </div>
      ) : error ? (
        <div className="text-destructive">Failed to load option sets: {(error as Error).message}</div>
      ) : optionSets.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No option sets yet. Create a set to reuse configuration groups across products.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {optionSets.map((set) => (
            <Card key={set.option_set_id} className="flex flex-col">
              <CardHeader className="flex flex-col gap-2">
                <CardTitle className="text-lg font-semibold">{set.name}</CardTitle>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{set.code}</Badge>
                  <span>{set.groups.length} group{set.groups.length === 1 ? '' : 's'}</span>
                  <span>{set.usage_count} product{set.usage_count === 1 ? '' : 's'}</span>
                </div>
                {set.description && <p className="text-sm text-muted-foreground">{set.description}</p>}
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between space-y-4">
                <div className="space-y-3">
                  {set.groups.slice(0, 3).map((group) => (
                    <div key={group.option_set_group_id} className="rounded border border-muted/70 p-3">
                      <div className="flex items-center justify-between text-sm font-medium">
                        <span>{group.label}</span>
                        <Badge variant={group.is_required ? 'default' : 'secondary'}>{group.is_required ? 'Required' : 'Optional'}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{group.values.length} value{group.values.length === 1 ? '' : 's'}</p>
                    </div>
                  ))}
                  {set.groups.length > 3 && (
                    <p className="text-xs text-muted-foreground">+ {set.groups.length - 3} more group{set.groups.length - 3 === 1 ? '' : 's'} not shown.</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setEditDialog({
                        set,
                        form: {
                          code: set.code,
                          name: set.name,
                          description: set.description ?? '',
                        },
                      })
                    }
                  >
                    <Pencil className="mr-2 h-4 w-4" /> Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => handleDeleteOptionSet(set)}
                    disabled={set.usage_count > 0}
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create option set dialog */}
      <Dialog open={createDialogOpen} onOpenChange={(open) => (open ? setCreateDialogOpen(true) : setCreateDialogOpen(false))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create option set</DialogTitle>
            <DialogDescription>Define a reusable option set that can be attached to products.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateOptionSet} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="create-code">Code</Label>
              <Input id="create-code" value={createForm.code} onChange={(event) => setCreateForm((prev) => ({ ...prev, code: event.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-name">Name</Label>
              <Input id="create-name" value={createForm.name} onChange={(event) => setCreateForm((prev) => ({ ...prev, name: event.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-description">Description (optional)</Label>
              <Input id="create-description" value={createForm.description} onChange={(event) => setCreateForm((prev) => ({ ...prev, description: event.target.value }))} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit option set dialog */}
      <Dialog open={Boolean(editDialog)} onOpenChange={(open) => (!open ? setEditDialog(null) : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit option set</DialogTitle>
            <DialogDescription>Update code, name, or description for this option set.</DialogDescription>
          </DialogHeader>
          {editDialog && (
            <form onSubmit={handleUpdateOptionSet} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-code">Code</Label>
                <Input
                  id="edit-code"
                  value={editDialog.form.code}
                  onChange={(event) => setEditDialog((prev) => prev && { ...prev, form: { ...prev.form, code: event.target.value } })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-name">Name</Label>
                <Input
                  id="edit-name"
                  value={editDialog.form.name}
                  onChange={(event) => setEditDialog((prev) => prev && { ...prev, form: { ...prev.form, name: event.target.value } })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-description">Description</Label>
                <Input
                  id="edit-description"
                  value={editDialog.form.description}
                  onChange={(event) => setEditDialog((prev) => prev && { ...prev, form: { ...prev.form, description: event.target.value } })}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditDialog(null)}>
                  Cancel
                </Button>
                <Button type="submit">Save changes</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
