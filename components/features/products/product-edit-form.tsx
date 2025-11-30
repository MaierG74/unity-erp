'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/supabase';
import { Loader2, Pencil } from 'lucide-react';

interface Product {
  product_id: number;
  internal_code: string;
  name: string;
  description: string | null;
}

interface ProductEditFormProps {
  product: Product;
  trigger?: React.ReactNode;
  onProductUpdated?: () => void;
}

export function ProductEditForm({ product, trigger, onProductUpdated }: ProductEditFormProps) {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    internal_code: product.internal_code,
    name: product.name,
    description: product.description || '',
  });
  const [existingCategoryIds, setExistingCategoryIds] = useState<number[]>([]);
  const { toast } = useToast();

  // When dialog opens, fetch existing category IDs so we preserve them on PUT
  useEffect(() => {
    if (!open) return;
    let active = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('product_category_assignments')
          .select('product_cat_id')
          .eq('product_id', product.product_id);
        if (error) throw error;
        if (active) setExistingCategoryIds((data || []).map((r) => r.product_cat_id));
      } catch (err) {
        console.error('Error fetching product categories for edit:', err);
      }
    })();
    return () => {
      active = false;
    };
  }, [open, product.product_id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.internal_code || !formData.name) {
      toast({
        title: 'Error',
        description: 'Product code and name are required',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`/api/products/${product.product_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          internal_code: formData.internal_code,
          name: formData.name,
          description: formData.description || null,
          // Preserve category assignments during simple edits
          categories: existingCategoryIds,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result?.error || 'Failed to update product');
      }

      toast({ title: 'Success', description: 'Product updated successfully' });
      setOpen(false);
      onProductUpdated?.();
    } catch (error) {
      console.error('Error updating product:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update product',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Pencil className="h-4 w-4 mr-1" /> Edit
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Product</DialogTitle>
          <DialogDescription>
            Update basic product details. Category assignments are preserved.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="internal_code" className="text-right">
                Product Code *
              </Label>
              <Input
                id="internal_code"
                value={formData.internal_code}
                onChange={(e) => handleInputChange('internal_code', e.target.value)}
                className="col-span-3"
                required
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right">
                Name *
              </Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                className="col-span-3"
                required
              />
            </div>
            <div className="grid grid-cols-4 items-start gap-4">
              <Label htmlFor="description" className="text-right pt-2">
                Description
              </Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                className="col-span-3"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

