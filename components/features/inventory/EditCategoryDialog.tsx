'use client';

import { useState, useEffect } from 'react';
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

type Category = {
  cat_id: number;
  categoryname: string;
};

type EditCategoryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: Category;
};

export function EditCategoryDialog({
  open,
  onOpenChange,
  category,
}: EditCategoryDialogProps) {
  const [categoryName, setCategoryName] = useState(category.categoryname);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Update state when category prop changes
  useEffect(() => {
    setCategoryName(category.categoryname);
    setError(null);
  }, [category.categoryname]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    if (!categoryName.trim()) {
      setError('Category name is required');
      return;
    }

    if (categoryName.trim() === category.categoryname) {
      setError('Please enter a different name');
      return;
    }

    setIsSubmitting(true);

    try {
      const { data, error: updateError } = await supabase
        .from('component_categories')
        .update({ categoryname: categoryName.trim() })
        .eq('cat_id', category.cat_id)
        .select()
        .single();

      if (updateError) {
        // Check for unique constraint violation
        if (updateError.code === '23505') {
          setError('A category with this name already exists');
        } else {
          throw updateError;
        }
        return;
      }

      // Success
      toast({
        title: 'Category updated',
        description: `Category renamed to "${categoryName}".`,
      });

      // Refresh categories and components (to update category names in components list)
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'components'] });

      // Close dialog
      onOpenChange(false);
    } catch (err) {
      console.error('Error updating category:', err);
      toast({
        title: 'Error',
        description: 'Failed to update category. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!isSubmitting) {
      if (!newOpen) {
        setCategoryName(category.categoryname);
        setError(null);
      }
      onOpenChange(newOpen);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Category</DialogTitle>
          <DialogDescription>
            Update the category name. This will affect all components using this category.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="category-name-edit">Category Name *</Label>
              <Input
                id="category-name-edit"
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
              Update Category
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

