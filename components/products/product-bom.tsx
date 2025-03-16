'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Edit, Save, X } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

// Define types
interface Component {
  component_id: number;
  internal_code: string;
  description: string | null;
}

// Our normalized BOM item type for use in the component
interface BOMItem {
  bom_id: number;
  product_id: number;
  component_id: number;
  quantity_required: number;
  component: Component;
}

// Form schema for adding/editing BOM items
const bomItemSchema = z.object({
  component_id: z.string().min(1, 'Component is required'),
  quantity_required: z.coerce.number().min(1, 'Quantity must be at least 1'),
});

type BOMItemFormValues = z.infer<typeof bomItemSchema>;

interface ProductBOMProps {
  productId: number;
}

export function ProductBOM({ productId }: ProductBOMProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Initialize form
  const form = useForm<BOMItemFormValues>({
    resolver: zodResolver(bomItemSchema),
    defaultValues: {
      component_id: '',
      quantity_required: 1,
    },
  });
  
  // Fetch BOM items for this product
  const { data: bomItems = [], isLoading: bomLoading } = useQuery({
    queryKey: ['productBOM', productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('billofmaterials')
        .select(`
          bom_id,
          product_id,
          component_id,
          quantity_required,
          components (
            component_id,
            internal_code,
            description
          )
        `)
        .eq('product_id', productId);
        
      if (error) throw error;
      
      // Transform the response to match our BOMItem interface
      return (data || []).map((item: any) => ({
        bom_id: item.bom_id,
        product_id: item.product_id,
        component_id: item.component_id,
        quantity_required: item.quantity_required,
        component: item.components
      })) as BOMItem[];
    },
  });
  
  // Fetch all components for the dropdown
  const { data: components = [], isLoading: componentsLoading } = useQuery({
    queryKey: ['components'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('components')
        .select('component_id, internal_code, description');
        
      if (error) throw error;
      return data as Component[];
    },
  });
  
  // Add BOM item mutation
  const addBOMItem = useMutation({
    mutationFn: async (values: BOMItemFormValues) => {
      const { data, error } = await supabase
        .from('billofmaterials')
        .insert({
          product_id: productId,
          component_id: parseInt(values.component_id),
          quantity_required: values.quantity_required,
        })
        .select();
        
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productBOM', productId] });
      form.reset();
      toast({
        title: 'Success',
        description: 'Component added to BOM',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: 'Failed to add component to BOM',
        variant: 'destructive',
      });
      console.error('Error adding BOM item:', error);
    },
  });
  
  // Update BOM item mutation
  const updateBOMItem = useMutation({
    mutationFn: async (values: BOMItemFormValues & { bom_id: number }) => {
      const { data, error } = await supabase
        .from('billofmaterials')
        .update({
          component_id: parseInt(values.component_id),
          quantity_required: values.quantity_required,
        })
        .eq('bom_id', values.bom_id)
        .select();
        
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productBOM', productId] });
      setEditingId(null);
      toast({
        title: 'Success',
        description: 'BOM item updated',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: 'Failed to update BOM item',
        variant: 'destructive',
      });
      console.error('Error updating BOM item:', error);
    },
  });
  
  // Delete BOM item mutation
  const deleteBOMItem = useMutation({
    mutationFn: async (bomId: number) => {
      const { error } = await supabase
        .from('billofmaterials')
        .delete()
        .eq('bom_id', bomId);
        
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productBOM', productId] });
      toast({
        title: 'Success',
        description: 'Component removed from BOM',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: 'Failed to remove component from BOM',
        variant: 'destructive',
      });
      console.error('Error deleting BOM item:', error);
    },
  });
  
  // Handle form submission for adding new BOM item
  const onSubmit = (values: BOMItemFormValues) => {
    addBOMItem.mutate(values);
  };
  
  // Start editing a BOM item
  const startEditing = (item: BOMItem) => {
    setEditingId(item.bom_id);
    form.setValue('component_id', item.component_id.toString());
    form.setValue('quantity_required', item.quantity_required);
  };
  
  // Cancel editing
  const cancelEditing = () => {
    setEditingId(null);
    form.reset();
  };
  
  // Save edited BOM item
  const saveEdit = (bomId: number) => {
    const values = form.getValues();
    updateBOMItem.mutate({
      ...values,
      bom_id: bomId,
    });
  };
  
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Bill of Materials</CardTitle>
          <CardDescription>
            Manage the components required to manufacture this product
          </CardDescription>
        </CardHeader>
        <CardContent>
          {bomLoading ? (
            <div className="text-center py-4">Loading BOM data...</div>
          ) : (
            <>
              {/* BOM Items Table */}
              <div className="rounded-md border mb-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Component Code</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead className="w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bomItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-4">
                          No components added to this product yet
                        </TableCell>
                      </TableRow>
                    ) : (
                      bomItems.map((item) => (
                        <TableRow key={item.bom_id}>
                          {editingId === item.bom_id ? (
                            <>
                              <TableCell>
                                <Select
                                  value={form.watch('component_id')}
                                  onValueChange={(value) => form.setValue('component_id', value)}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select component" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {components.map((component) => (
                                      <SelectItem
                                        key={component.component_id}
                                        value={component.component_id.toString()}
                                      >
                                        {component.internal_code} - {component.description}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {form.formState.errors.component_id && (
                                  <p className="text-sm text-destructive mt-1">
                                    {form.formState.errors.component_id.message}
                                  </p>
                                )}
                              </TableCell>
                              <TableCell>
                                {/* Description will be shown based on selected component */}
                                {components.find(
                                  (c) => c.component_id.toString() === form.watch('component_id')
                                )?.description || ''}
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  min="1"
                                  value={form.watch('quantity_required')}
                                  onChange={(e) =>
                                    form.setValue('quantity_required', parseInt(e.target.value))
                                  }
                                  className="w-20"
                                />
                                {form.formState.errors.quantity_required && (
                                  <p className="text-sm text-destructive mt-1">
                                    {form.formState.errors.quantity_required.message}
                                  </p>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => saveEdit(item.bom_id)}
                                  >
                                    <Save className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={cancelEditing}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </>
                          ) : (
                            <>
                              <TableCell>{item.component.internal_code}</TableCell>
                              <TableCell>{item.component.description}</TableCell>
                              <TableCell>{item.quantity_required}</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => startEditing(item)}
                                  >
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => deleteBOMItem.mutate(item.bom_id)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </>
                          )}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Add New BOM Item Form */}
              {editingId === null && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-md">Add Component</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Form {...form}>
                      <form
                        onSubmit={form.handleSubmit(onSubmit)}
                        className="space-y-4"
                      >
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <FormField
                            control={form.control}
                            name="component_id"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Component</FormLabel>
                                <Select
                                  onValueChange={field.onChange}
                                  value={field.value}
                                  disabled={componentsLoading}
                                >
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select component" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {components.map((component) => (
                                      <SelectItem
                                        key={component.component_id}
                                        value={component.component_id.toString()}
                                      >
                                        {component.internal_code} - {component.description}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="quantity_required"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Quantity</FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    min="1"
                                    {...field}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        <div className="flex justify-end">
                          <Button
                            type="submit"
                            disabled={addBOMItem.isPending}
                          >
                            {addBOMItem.isPending ? (
                              'Adding...'
                            ) : (
                              <>
                                <Plus className="h-4 w-4 mr-2" />
                                Add Component
                              </>
                            )}
                          </Button>
                        </div>
                      </form>
                    </Form>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
} 