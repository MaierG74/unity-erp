'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useFactorySections } from '@/hooks/use-factory-sections';
import { ArrowUp, ArrowDown, Trash2, Plus } from 'lucide-react';
import type { FactorySection } from './types';

interface SectionsSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DEFAULT_COLORS = [
  '#0ea5e9', '#f97316', '#22c55e', '#e11d48', '#a855f7',
  '#eab308', '#06b6d4', '#ec4899', '#84cc16', '#f43f5e',
];

export function SectionsSettingsDialog({ open, onOpenChange }: SectionsSettingsDialogProps) {
  const { sections, categories, isLoading, create, update, remove, isMutating } =
    useFactorySections();
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const handleUpdate = async (section: FactorySection, field: string, value: unknown) => {
    try {
      await update({ id: section.section_id, updates: { [field]: value } });
    } catch (e) {
      toast.error(`Failed to update section: ${(e as Error).message}`);
    }
  };

  const handleAdd = async () => {
    const maxOrder = sections.reduce((max, s) => Math.max(max, s.display_order), 0);
    const usedColors = new Set(sections.map((s) => s.color));
    const nextColor = DEFAULT_COLORS.find((c) => !usedColors.has(c)) ?? DEFAULT_COLORS[0];
    try {
      await create({
        name: 'New Section',
        display_order: maxOrder + 1,
        category_id: null,
        color: nextColor,
        grid_span: 1,
        is_active: true,
      });
      toast.success('Section added');
    } catch (e) {
      toast.error(`Failed to add section: ${(e as Error).message}`);
    }
  };

  const handleDelete = async () => {
    if (deletingId === null) return;
    try {
      await remove(deletingId);
      toast.success('Section deleted');
    } catch (e) {
      toast.error(`Failed to delete section: ${(e as Error).message}`);
    } finally {
      setDeletingId(null);
    }
  };

  const handleMoveUp = async (section: FactorySection, index: number) => {
    if (index === 0) return;
    const prev = sections[index - 1];
    try {
      await update({ id: section.section_id, updates: { display_order: prev.display_order } });
      await update({ id: prev.section_id, updates: { display_order: section.display_order } });
    } catch (e) {
      toast.error(`Failed to reorder: ${(e as Error).message}`);
    }
  };

  const handleMoveDown = async (section: FactorySection, index: number) => {
    if (index === sections.length - 1) return;
    const next = sections[index + 1];
    try {
      await update({ id: section.section_id, updates: { display_order: next.display_order } });
      await update({ id: next.section_id, updates: { display_order: section.display_order } });
    } catch (e) {
      toast.error(`Failed to reorder: ${(e as Error).message}`);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Factory Sections</DialogTitle>
          </DialogHeader>

          {isLoading ? (
            <p className="text-sm text-muted-foreground py-4">Loading...</p>
          ) : (
            <div className="space-y-3">
              {/* Header row */}
              <div className="grid grid-cols-[1fr_150px_48px_60px_50px_60px_36px] gap-2 items-center text-xs font-medium text-muted-foreground px-1">
                <span>Name</span>
                <span>Main category</span>
                <span>Color</span>
                <span>Span</span>
                <span>Active</span>
                <span>Order</span>
                <span />
              </div>

              {/* Section rows */}
              {sections.map((section, i) => (
                <div
                  key={section.section_id}
                  className="grid grid-cols-[1fr_150px_48px_60px_50px_60px_36px] gap-2 items-center rounded-lg border border-border/50 bg-card/30 px-2 py-1.5"
                >
                  {/* Name */}
                  <Input
                    defaultValue={section.name}
                    className="h-8 text-sm"
                    onBlur={(e) => {
                      if (e.target.value !== section.name) {
                        handleUpdate(section, 'name', e.target.value);
                      }
                    }}
                  />

                  {/* Main category */}
                  <Select
                    value={section.category_id?.toString() ?? 'none'}
                    onValueChange={(v) =>
                      handleUpdate(section, 'category_id', v === 'none' ? null : Number(v))
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c.category_id} value={c.category_id.toString()}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Color */}
                  <div className="flex justify-center">
                    <label className="relative cursor-pointer">
                      <span
                        className="block h-6 w-6 rounded border border-border"
                        style={{ backgroundColor: section.color }}
                      />
                      <input
                        type="color"
                        value={section.color}
                        onChange={(e) => handleUpdate(section, 'color', e.target.value)}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      />
                    </label>
                  </div>

                  {/* Grid span toggle */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs px-2"
                    onClick={() =>
                      handleUpdate(section, 'grid_span', section.grid_span === 1 ? 2 : 1)
                    }
                  >
                    {section.grid_span === 2 ? 'Wide' : '1 col'}
                  </Button>

                  {/* Active switch */}
                  <div className="flex justify-center">
                    <Switch
                      checked={section.is_active}
                      onCheckedChange={(v) => handleUpdate(section, 'is_active', v)}
                    />
                  </div>

                  {/* Reorder arrows */}
                  <div className="flex gap-0.5 justify-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      disabled={i === 0 || isMutating}
                      onClick={() => handleMoveUp(section, i)}
                    >
                      <ArrowUp className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      disabled={i === sections.length - 1 || isMutating}
                      onClick={() => handleMoveDown(section, i)}
                    >
                      <ArrowDown className="h-3 w-3" />
                    </Button>
                  </div>

                  {/* Delete */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    onClick={() => setDeletingId(section.section_id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}

              {/* Add button */}
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleAdd}
                disabled={isMutating}
              >
                <Plus className="h-3.5 w-3.5 mr-2" />
                Add Section
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={deletingId !== null} onOpenChange={(v) => !v && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete section?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the section from the factory floor. Jobs in this category will no
              longer appear on the map until reassigned.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
