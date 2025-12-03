'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Save, Upload, X } from 'lucide-react';

const formSchema = z.object({
  internal_code: z.string().min(1, 'Component code is required'),
  description: z.string().min(1, 'Description is required'),
  unit_id: z.string().min(1, 'Unit is required'),
  category_id: z.string().min(1, 'Category is required'),
  image_url: z.string().nullable().optional(),
  reorder_level: z.coerce.number().min(0, 'Must be 0 or greater').optional(),
  location: z.string().nullable().optional(),
});

type ComponentData = {
  component_id: number;
  internal_code: string;
  description: string | null;
  image_url: string | null;
  category: {
    cat_id: number;
    categoryname: string;
  } | null;
  unit: {
    unit_id: number;
    unit_code: string;
    unit_name: string;
  } | null;
  inventory: {
    inventory_id: number;
    quantity_on_hand: number;
    reorder_level: number | null;
    location: string | null;
  } | null;
};

type EditComponentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  component: ComponentData;
};

export function EditComponentDialog({ open, onOpenChange, component }: EditComponentDialogProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(component.image_url);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      internal_code: component.internal_code,
      description: component.description || '',
      unit_id: component.unit?.unit_id.toString() || '',
      category_id: component.category?.cat_id.toString() || '',
      image_url: component.image_url,
      reorder_level: component.inventory?.reorder_level ?? 0,
      location: component.inventory?.location || '',
    },
  });

  // Reset form when dialog opens or component changes
  useEffect(() => {
    if (open) {
      form.reset({
        internal_code: component.internal_code,
        description: component.description || '',
        unit_id: component.unit?.unit_id.toString() || '',
        category_id: component.category?.cat_id.toString() || '',
        image_url: component.image_url,
        reorder_level: component.inventory?.reorder_level ?? 0,
        location: component.inventory?.location || '',
      });
      setImagePreview(component.image_url);
    }
  }, [open, component, form]);

  // Fetch units
  const { data: units = [] } = useQuery({
    queryKey: ['units'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('unitsofmeasure')
        .select('unit_id, unit_code, unit_name')
        .order('unit_name');
      if (error) throw error;
      return data;
    },
  });

  // Fetch categories
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('component_categories')
        .select('cat_id, categoryname')
        .order('categoryname');
      if (error) throw error;
      return data;
    },
  });

  // Update component mutation
  const updateMutation = useMutation({
    mutationFn: async (values: z.infer<typeof formSchema>) => {
      // Update component details
      const { error } = await supabase
        .from('components')
        .update({
          internal_code: values.internal_code,
          description: values.description,
          unit_id: parseInt(values.unit_id),
          category_id: parseInt(values.category_id),
          image_url: values.image_url,
        })
        .eq('component_id', component.component_id);

      if (error) throw error;

      // Update or create inventory record with reorder level and location
      const { error: invError } = await supabase
        .from('inventory')
        .upsert(
          {
            component_id: component.component_id,
            reorder_level: values.reorder_level ?? 0,
            location: values.location || null,
            quantity_on_hand: component.inventory?.quantity_on_hand ?? 0,
          },
          { onConflict: 'component_id' }
        );

      if (invError) throw invError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['component', component.component_id] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      toast({
        title: 'Component updated',
        description: 'The component has been successfully updated.',
      });
      onOpenChange(false);
    },
    onError: (error) => {
      console.error('Error updating component:', error);
      toast({
        title: 'Update failed',
        description: 'Failed to update component. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload an image file (JPG, PNG, GIF, etc.)',
        variant: 'destructive',
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: 'File too large',
        description: 'Please upload an image smaller than 5MB.',
        variant: 'destructive',
      });
      return;
    }

    setIsUploading(true);

    try {
      const oldImageUrl = component.image_url;
      if (oldImageUrl) {
        try {
          const url = new URL(oldImageUrl);
          const pathParts = url.pathname.split('/');
          if (pathParts.length >= 3) {
            const filePath = pathParts.slice(2).join('/');
            await supabase.storage.from('QButton').remove([filePath]);
          }
        } catch (error) {
          console.warn('Error deleting old image:', error);
        }
      }

      const fileExt = file.name.split('.').pop();
      const fileName = `${component.internal_code}-${Date.now()}.${fileExt}`;
      const filePath = `component-images/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('QButton')
        .upload(filePath, file, {
          upsert: true,
          contentType: file.type,
        });

      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from('QButton').getPublicUrl(filePath);

      setImagePreview(publicUrl);
      form.setValue('image_url', publicUrl);

      toast({
        title: 'Image uploaded',
        description: 'Image has been uploaded. Click Save to apply changes.',
      });
    } catch (error) {
      console.error('Error uploading image:', error);
      toast({
        title: 'Upload failed',
        description: 'Failed to upload image. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveImage = () => {
    setImagePreview(null);
    form.setValue('image_url', null);
  };

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    updateMutation.mutate(values);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Component</DialogTitle>
          <DialogDescription>
            Update the component details below.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="internal_code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Component Code *</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., B650" {...field} />
                    </FormControl>
                    <FormDescription>Unique identifier</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="unit_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unit of Measure *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select unit" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {units.map((unit) => (
                          <SelectItem key={unit.unit_id} value={unit.unit_id.toString()}>
                            {unit.unit_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description *</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Describe the component..."
                      className="min-h-[80px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="category_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {categories.map((category) => (
                        <SelectItem key={category.cat_id} value={category.cat_id.toString()}>
                          {category.categoryname}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Inventory Settings */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="reorder_level"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Minimum Stock Level</FormLabel>
                    <FormControl>
                      <Input 
                        type="number" 
                        min="0" 
                        placeholder="0" 
                        {...field} 
                        value={field.value ?? 0}
                      />
                    </FormControl>
                    <FormDescription>Alert when stock falls below this</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="location"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Storage Location</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="e.g., Shelf A-3, Bin 12" 
                        {...field} 
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormDescription>Where this item is stored</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Image Upload */}
            <div className="space-y-3">
              <FormLabel>Component Image</FormLabel>
              {imagePreview && (
                <div className="relative inline-block">
                  <img
                    src={imagePreview}
                    alt="Component preview"
                    className="w-32 h-32 object-cover rounded-lg border"
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="absolute -top-2 -right-2 h-6 w-6"
                    onClick={handleRemoveImage}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )}

              <div>
                <Input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  disabled={isUploading}
                  className="cursor-pointer"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Max 5MB. JPG, PNG, GIF, WebP
                </p>
              </div>

              {isUploading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading...
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={updateMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Save className="mr-2 h-4 w-4" />
                Save Changes
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
