'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { Plus, Loader2 } from 'lucide-react';
import { CategoryDialog } from './category-dialog';

interface ProductCreateFormProps {
  trigger?: React.ReactNode;
  onProductCreated?: () => void;
}

export function ProductCreateForm({ trigger, onProductCreated }: ProductCreateFormProps) {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    internal_code: '',
    name: '',
    description: ''
  });
  const [selectedCategories, setSelectedCategories] = useState<number[]>([]);
  const { toast } = useToast();

  // Fetch available categories
  const { data: categories = [] } = useQuery({
    queryKey: ['product-categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_categories')
        .select('*')
        .order('categoryname');

      if (error) throw error;
      return data;
    },
  });

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
      const response = await fetch('/api/products', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...formData,
          categories: selectedCategories,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create product');
      }

      toast({
        title: 'Success',
        description: 'Product created successfully',
      });

      // Reset form
      setFormData({
        internal_code: '',
        name: '',
        description: ''
      });
      setSelectedCategories([]);

      // Close dialog
      setOpen(false);

      // Notify parent component
      if (onProductCreated) {
        onProductCreated();
      }

    } catch (error) {
      console.error('Error creating product:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create product',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Add Product
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create New Product</DialogTitle>
          <DialogDescription>
            Add a new product to your inventory. Fill in the required fields below.
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
                placeholder="e.g., WIDGET-001"
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
                placeholder="Product name"
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
                placeholder="Product description (optional)"
                rows={3}
              />
            </div>
            <div className="grid grid-cols-4 items-start gap-4">
              <Label className="text-right pt-2">
                Categories
              </Label>
              <div className="col-span-3">
                <div className="flex flex-wrap gap-2 mb-2">
                  {selectedCategories.map((catId) => {
                    const category = categories.find(c => c.product_cat_id === catId);
                    return category ? (
                      <div
                        key={catId}
                        className="flex items-center gap-1 px-2 py-1 bg-muted rounded-md text-sm"
                      >
                        {category.categoryname}
                        <button
                          type="button"
                          onClick={() => setSelectedCategories(prev => prev.filter(id => id !== catId))}
                          className="hover:text-destructive"
                        >
                          ×
                        </button>
                      </div>
                    ) : null;
                  })}
                </div>
                <CategoryDialog
                  productId=""
                  existingCategories={selectedCategories.map(id => ({
                    product_cat_id: id,
                    categoryname: categories.find(c => c.product_cat_id === id)?.categoryname || ''
                  }))}
                  onCategoriesChange={(newCategories) => {
                    setSelectedCategories(newCategories.map(c => c.product_cat_id));
                  }}
                  trigger={
                    <Button type="button" variant="outline" size="sm">
                      <Plus className="h-3 w-3 mr-1" />
                      Add Category
                    </Button>
                  }
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Product'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
