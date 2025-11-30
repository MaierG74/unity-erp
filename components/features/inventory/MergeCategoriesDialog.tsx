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
import { Loader2, GitMerge } from 'lucide-react';
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

type MergeCategoriesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceCategory: Category;
  allCategories: Category[];
};

export function MergeCategoriesDialog({
  open,
  onOpenChange,
  sourceCategory,
  allCategories,
}: MergeCategoriesDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [targetCategoryId, setTargetCategoryId] = useState<string>('');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const sourceCount = sourceCategory.component_count || 0;

  // Get other categories for target selection
  const otherCategories = allCategories.filter((c) => c.cat_id !== sourceCategory.cat_id);

  const targetCategory = otherCategories.find(
    (c) => c.cat_id.toString() === targetCategoryId
  );
  const targetCount = targetCategory?.component_count || 0;

  const handleMerge = async () => {
    if (!targetCategoryId) {
      toast({
        title: 'Error',
        description: 'Please select a target category.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Step 1: Update all components from source to target
      const { error: updateError } = await supabase
        .from('components')
        .update({ category_id: parseInt(targetCategoryId) })
        .eq('category_id', sourceCategory.cat_id);

      if (updateError) {
        throw updateError;
      }

      // Step 2: Delete source category
      const { error: deleteError } = await supabase
        .from('component_categories')
        .delete()
        .eq('cat_id', sourceCategory.cat_id);

      if (deleteError) {
        throw deleteError;
      }

      // Success
      toast({
        title: 'Categories merged',
        description: `"${sourceCategory.categoryname}" (${sourceCount} components) has been merged into "${targetCategory?.categoryname}" (${targetCount} components).`,
      });

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'components'] });

      // Close dialog
      onOpenChange(false);
    } catch (err) {
      console.error('Error merging categories:', err);
      toast({
        title: 'Error',
        description: 'Failed to merge categories. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!isSubmitting) {
      if (!newOpen) {
        setTargetCategoryId('');
      }
      onOpenChange(newOpen);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge Categories</DialogTitle>
          <DialogDescription>
            Merge "{sourceCategory.categoryname}" into another category. All components will
            be reassigned and the source category will be deleted.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Alert>
            <GitMerge className="h-4 w-4" />
            <AlertDescription>
              <strong>Source category:</strong> {sourceCategory.categoryname}
              <br />
              <strong>Components to merge:</strong> {sourceCount}
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label htmlFor="target-category">Merge into (target category) *</Label>
            <Select
              value={targetCategoryId}
              onValueChange={setTargetCategoryId}
              disabled={isSubmitting}
            >
              <SelectTrigger id="target-category">
                <SelectValue placeholder="Select target category" />
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

          {targetCategory && (
            <Alert>
              <AlertDescription>
                <strong>Result after merge:</strong>
                <br />
                "{targetCategory.categoryname}" will have {sourceCount + targetCount} total
                components
                <br />
                "{sourceCategory.categoryname}" will be deleted
              </AlertDescription>
            </Alert>
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
            onClick={handleMerge}
            disabled={isSubmitting || !targetCategoryId}
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Merge Categories
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

