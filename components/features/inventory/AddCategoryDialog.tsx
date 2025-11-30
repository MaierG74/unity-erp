'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
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
import { Loader2 } from 'lucide-react';

type AddCategoryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AddCategoryDialog({ open, onOpenChange }: AddCategoryDialogProps) {
  const [categoryName, setCategoryName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    if (!categoryName.trim()) {
      setError('Category name is required');
      return;
    }

    setIsSubmitting(true);

    try {
      const { data, error: insertError } = await supabase
        .from('component_categories')
        .insert({ categoryname: categoryName.trim() })
        .select()
        .single();

      if (insertError) {
        // Check for unique constraint violation
        if (insertError.code === '23505') {
          setError('A category with this name already exists');
        } else {
          throw insertError;
        }
        return;
      }

      // Success
      toast({
        title: 'Category created',
        description: `"${categoryName}" has been added successfully.`,
      });

      // Refresh categories
      queryClient.invalidateQueries({ queryKey: ['categories'] });

      // Reset and close
      setCategoryName('');
      onOpenChange(false);
    } catch (err) {
      console.error('Error creating category:', err);
      toast({
        title: 'Error',
        description: 'Failed to create category. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!isSubmitting) {
      if (!newOpen) {
        setCategoryName('');
        setError(null);
      }
      onOpenChange(newOpen);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add New Category</DialogTitle>
          <DialogDescription>
            Create a new component category. Category names must be unique.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="category-name">Category Name *</Label>
              <Input
                id="category-name"
                placeholder="e.g., Hinges, Screws, Melamine"
                value={categoryName}
                onChange={(e) => {
                  setCategoryName(e.target.value);
                  setError(null);
                }}
                disabled={isSubmitting}
                autoFocus
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Category
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

