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
import { Label } from '@/components/ui/label';
import { Loader2, AlertTriangle } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';

type Category = {
  cat_id: number;
  categoryname: string;
  component_count?: number;
};

type DeleteCategoryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: Category;
  allCategories: Category[];
};

export function DeleteCategoryDialog({
  open,
  onOpenChange,
  category,
  allCategories,
}: DeleteCategoryDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reassignToCategoryId, setReassignToCategoryId] = useState<string>('');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const componentCount = category.component_count || 0;
  const hasComponents = componentCount > 0;

  // Get other categories for reassignment
  const otherCategories = allCategories.filter((c) => c.cat_id !== category.cat_id);

  const handleDelete = async () => {
    setIsSubmitting(true);

    try {
      // If category has components, reassign them first
      if (hasComponents) {
        if (!reassignToCategoryId) {
          toast({
            title: 'Error',
            description: 'Please select a category to reassign components to.',
            variant: 'destructive',
          });
          setIsSubmitting(false);
          return;
        }

        // Reassign components to new category
        const { error: reassignError } = await supabase
          .from('components')
          .update({ category_id: parseInt(reassignToCategoryId) })
          .eq('category_id', category.cat_id);

        if (reassignError) {
          throw reassignError;
        }
      }

      // Delete the category
      const { error: deleteError } = await supabase
        .from('component_categories')
        .delete()
        .eq('cat_id', category.cat_id);

      if (deleteError) {
        throw deleteError;
      }

      // Success
      toast({
        title: 'Category deleted',
        description: hasComponents
          ? `"${category.categoryname}" has been deleted and ${componentCount} component(s) were reassigned.`
          : `"${category.categoryname}" has been deleted.`,
      });

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'components'] });

      // Close dialog
      onOpenChange(false);
    } catch (err) {
      console.error('Error deleting category:', err);
      toast({
        title: 'Error',
        description: 'Failed to delete category. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!isSubmitting) {
      if (!newOpen) {
        setReassignToCategoryId('');
      }
      onOpenChange(newOpen);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Category</DialogTitle>
          <DialogDescription>
            {hasComponents
              ? `This category has ${componentCount} component(s). You must reassign them to another category before deleting.`
              : 'Are you sure you want to delete this category?'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Category to delete:</strong> {category.categoryname}
              <br />
              <strong>Components:</strong> {componentCount}
            </AlertDescription>
          </Alert>

          {hasComponents && (
            <div className="space-y-2">
              <Label htmlFor="reassign-category">
                Reassign components to *
              </Label>
              <Select
                value={reassignToCategoryId}
                onValueChange={setReassignToCategoryId}
                disabled={isSubmitting}
              >
                <SelectTrigger id="reassign-category">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {otherCategories.length === 0 ? (
                    <div className="p-2 text-center text-sm text-muted-foreground">
                      No other categories available
                    </div>
                  ) : (
                    otherCategories.map((cat) => (
                      <SelectItem key={cat.cat_id} value={cat.cat_id.toString()}>
                        {cat.categoryname} ({cat.component_count || 0} components)
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          )}
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
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={isSubmitting || (hasComponents && !reassignToCategoryId)}
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete Category
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

