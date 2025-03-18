'use client';

import { useState, useCallback, useEffect } from 'react';
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Edit, Save, X, Search } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/hooks/use-debounce';

// Define types
interface Component {
  component_id: number;
  internal_code: string;
  description: string | null;
}

interface Supplier {
  supplier_id: number;
  name: string;
}

interface SupplierComponent {
  supplier_component_id: number;
  component_id: number;
  supplier_id: number;
  price: number;
  supplier: Supplier;
}

// Our normalized BOM item type for use in the component
interface BOMItem {
  bom_id: number;
  product_id: number;
  component_id: number;
  quantity_required: number;
  supplier_component_id: number | null;
  component: Component;
  supplierComponent?: {
    supplier_component_id: number;
    component_id: number;
    supplier_id: number;
    price: number;
    supplier: {
      supplier_id: number;
      name: string;
    };
  };
}

// Form schema for adding/editing BOM items
const bomItemSchema = z.object({
  component_id: z.string().min(1, 'Component is required'),
  quantity_required: z.coerce.number().min(1, 'Quantity must be at least 1'),
  supplier_component_id: z.string().optional(),
});

type BOMItemFormValues = z.infer<typeof bomItemSchema>;

interface ProductBOMProps {
  productId: number;
}

export function ProductBOM({ productId }: ProductBOMProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [componentSearch, setComponentSearch] = useState('');
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const debouncedComponentSearch = useDebounce(componentSearch, 300);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Initialize form
  const form = useForm<BOMItemFormValues>({
    resolver: zodResolver(bomItemSchema),
    defaultValues: {
      component_id: '',
      quantity_required: 1,
      supplier_component_id: '',
    },
  });

  // Watch the component_id to fetch suppliers when it changes
  const watchedComponentId = form.watch('component_id');
  
  // Add state to track if supplier feature is available
  const [supplierFeatureAvailable, setSupplierFeatureAvailable] = useState(false);

  // Check if supplier_component_id column exists
  useEffect(() => {
    const checkSupplierFeature = async () => {
      try {
        // Try to query a BOM item with supplier_component_id
        const { data, error } = await supabase
          .from('billofmaterials')
          .select('supplier_component_id')
          .limit(1);
          
        if (error) {
          console.error('Error checking supplier feature:', error);
          setSupplierFeatureAvailable(false);
        } else {
          setSupplierFeatureAvailable(true);
          console.log('Supplier feature is available');
        }
      } catch (err) {
        console.error('Error checking supplier feature:', err);
        setSupplierFeatureAvailable(false);
      }
    };
    
    checkSupplierFeature();
  }, []);

  // Fetch BOM items for this product
  const { data: bomItems = [], isLoading: bomLoading } = useQuery({
    queryKey: ['productBOM', productId, supplierFeatureAvailable],
    queryFn: async () => {
      let query = supabase
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
        `);

      // Add supplier_component_id and join with suppliercomponents only if the feature is available
      if (supplierFeatureAvailable) {
        query = supabase
          .from('billofmaterials')
          .select(`
            bom_id,
            product_id,
            component_id,
            quantity_required,
            supplier_component_id,
            components (
              component_id,
              internal_code,
              description
            ),
            supplierComponent:suppliercomponents (
              supplier_component_id,
              component_id,
              supplier_id,
              price,
              supplier:suppliers (
                supplier_id,
                name
              )
            )
          `);
      }
        
      const { data, error } = await query.eq('product_id', productId);
        
      if (error) throw error;
      
      // Transform the response to match our BOMItem interface
      return data.map((item: any) => ({
        bom_id: item.bom_id,
        product_id: item.product_id,
        component_id: item.component_id,
        quantity_required: item.quantity_required,
        supplier_component_id: item.supplier_component_id || null,
        component: item.components,
        supplierComponent: item.supplierComponent || undefined
      }));
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

  // Fetch suppliers for the selected component
  const { data: supplierComponents = [], isLoading: suppliersLoading } = useQuery({
    queryKey: ['supplierComponents', watchedComponentId],
    queryFn: async () => {
      if (!watchedComponentId) return [];
      
      const { data, error } = await supabase
        .from('suppliercomponents')
        .select(`
          supplier_component_id,
          component_id,
          supplier_id,
          price,
          lead_time,
          min_order_quantity,
          supplier:suppliers (
            supplier_id,
            name
          )
        `)
        .eq('component_id', parseInt(watchedComponentId));
        
      if (error) throw error;
      
      return data as unknown as SupplierComponent[];
    },
    enabled: !!watchedComponentId, // Only run query when a component is selected
  });

  // Filter components based on search
  const filteredComponents = useCallback(() => {
    if (!debouncedComponentSearch) return components;
    
    return components.filter(
      component => 
        component.internal_code.toLowerCase().includes(debouncedComponentSearch.toLowerCase()) || 
        (component.description && 
          component.description.toLowerCase().includes(debouncedComponentSearch.toLowerCase()))
    );
  }, [components, debouncedComponentSearch]);
  
  // Add BOM item mutation
  const addBOMItem = useMutation({
    mutationFn: async (values: BOMItemFormValues) => {
      // Build the insert object
      const insertData: any = {
        product_id: productId,
        component_id: parseInt(values.component_id),
        quantity_required: values.quantity_required,
      };
      
      // Only include supplier_component_id if the feature is available and a value is provided
      if (supplierFeatureAvailable && values.supplier_component_id) {
        insertData.supplier_component_id = parseInt(values.supplier_component_id);
      }
      
      const { data, error } = await supabase
        .from('billofmaterials')
        .insert(insertData)
        .select();
        
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productBOM', productId] });
      form.reset({
        component_id: '',
        quantity_required: 1,
        supplier_component_id: '',
      });
      setComponentSearch('');  // Reset search term
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
      // Build the update object
      const updateData: any = {
        component_id: parseInt(values.component_id),
        quantity_required: values.quantity_required,
      };
      
      // Only include supplier_component_id if the feature is available and a value is provided
      if (supplierFeatureAvailable && values.supplier_component_id) {
        updateData.supplier_component_id = parseInt(values.supplier_component_id);
      }
      
      const { data, error } = await supabase
        .from('billofmaterials')
        .update(updateData)
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
    form.setValue('supplier_component_id', item.supplier_component_id?.toString() || '');
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
  
  // Show total cost of all components in the BOM
  const totalBOMCost = bomItems.reduce((total, item) => {
    if (item.supplierComponent) {
      return total + (parseFloat(item.supplierComponent.price.toString()) * item.quantity_required);
    }
    return total;
  }, 0);

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
          {supplierFeatureAvailable && (
            <div className="mb-4 text-right">
              <span className="text-sm font-medium">Total Component Cost: </span>
              <span className="text-lg font-bold">${totalBOMCost.toFixed(2)}</span>
            </div>
          )}
          {bomLoading ? (
            <div className="text-center py-4">Loading BOM data...</div>
          ) : (
            <>
              {/* BOM Items Table */}
              <div className="rounded-md border mb-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Component</TableHead>
                      <TableHead>Description</TableHead>
                      {supplierFeatureAvailable && (
                        <>
                          <TableHead>Supplier</TableHead>
                          <TableHead>Price</TableHead>
                        </>
                      )}
                      <TableHead>Quantity</TableHead>
                      {supplierFeatureAvailable && (
                        <TableHead>Total</TableHead>
                      )}
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bomItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={supplierFeatureAvailable ? 7 : 4} className="text-center py-4">
                          No components added yet
                        </TableCell>
                      </TableRow>
                    ) : (
                      bomItems.map((item) => (
                        <TableRow key={item.bom_id}>
                          {editingId === item.bom_id ? (
                            <>
                              <TableCell colSpan={2}>
                                <FormField
                                  control={form.control}
                                  name="component_id"
                                  render={({ field }) => (
                                    <Select
                                      onValueChange={(value) => {
                                        field.onChange(value);
                                        // Reset supplier when component changes
                                        if (supplierFeatureAvailable) {
                                          form.setValue('supplier_component_id', '');
                                        }
                                      }}
                                      value={field.value}
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
                                  )}
                                />
                              </TableCell>
                              {supplierFeatureAvailable && (
                                <>
                                  <TableCell>
                                    <FormField
                                      control={form.control}
                                      name="supplier_component_id"
                                      render={({ field }) => (
                                        <Select
                                          onValueChange={field.onChange}
                                          value={field.value}
                                          disabled={!form.getValues().component_id}
                                        >
                                          <SelectTrigger>
                                            <SelectValue placeholder="Select supplier" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {suppliersLoading ? (
                                              <div className="p-2 text-center">Loading suppliers...</div>
                                            ) : supplierComponents.length === 0 ? (
                                              <div className="p-2 text-center">No suppliers found</div>
                                            ) : (
                                              supplierComponents.map((sc) => (
                                                <SelectItem 
                                                  key={sc.supplier_component_id} 
                                                  value={sc.supplier_component_id.toString()}
                                                >
                                                  {sc.supplier?.name || 'Unknown'} - ${parseFloat(sc.price.toString()).toFixed(2)}
                                                </SelectItem>
                                              ))
                                            )}
                                          </SelectContent>
                                        </Select>
                                      )}
                                    />
                                  </TableCell>
                                  <TableCell>
                                    {/* Price is shown based on the selected supplier */}
                                    {form.getValues().supplier_component_id && 
                                      '$' + parseFloat(
                                        supplierComponents.find(sc => 
                                          sc.supplier_component_id.toString() === form.getValues().supplier_component_id
                                        )?.price.toString() || '0'
                                      ).toFixed(2)
                                    }
                                  </TableCell>
                                </>
                              )}
                              <TableCell>
                                <FormField
                                  control={form.control}
                                  name="quantity_required"
                                  render={({ field }) => (
                                    <Input
                                      type="number"
                                      min="1"
                                      className="w-20"
                                      {...field}
                                    />
                                  )}
                                />
                              </TableCell>
                              {supplierFeatureAvailable && (
                                <TableCell>
                                  {/* Total cost calculation */}
                                  {(form.getValues().supplier_component_id && form.getValues().quantity_required) ? 
                                    '$' + (
                                      parseFloat(
                                        supplierComponents.find(sc => 
                                          sc.supplier_component_id.toString() === form.getValues().supplier_component_id
                                        )?.price.toString() || '0'
                                      ) * 
                                      form.getValues().quantity_required
                                    ).toFixed(2) : 
                                    ''
                                  }
                                </TableCell>
                              )}
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
                              {supplierFeatureAvailable && (
                                <>
                                  <TableCell>{item.supplierComponent?.supplier?.name || 'Not specified'}</TableCell>
                                  <TableCell>{item.supplierComponent ? `$${parseFloat(item.supplierComponent.price.toString()).toFixed(2)}` : '-'}</TableCell>
                                </>
                              )}
                              <TableCell>{item.quantity_required}</TableCell>
                              {supplierFeatureAvailable && (
                                <TableCell>
                                  {item.supplierComponent 
                                    ? `$${(parseFloat(item.supplierComponent.price.toString()) * item.quantity_required).toFixed(2)}` 
                                    : '-'
                                  }
                                </TableCell>
                              )}
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
                                  onValueChange={(value) => {
                                    console.log('Component selected:', value);
                                    field.onChange(value);
                                    setTimeout(() => {
                                      setComponentSearch('');
                                    }, 300);
                                  }}
                                  value={field.value}
                                >
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select component" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {filteredComponents().map((component) => (
                                      <SelectItem
                                        key={component.component_id}
                                        value={component.component_id.toString()}
                                      >
                                        <span className="font-medium">{component.internal_code}</span>
                                        {component.description && (
                                          <span className="ml-2 text-xs text-muted-foreground">
                                            - {component.description}
                                          </span>
                                        )}
                                      </SelectItem>
                                    ))}
                                    
                                    {filteredComponents().length === 0 && (
                                      <div className="p-2 text-center text-sm text-muted-foreground">
                                        No matching components
                                      </div>
                                    )}
                                    
                                    <div className="p-2 border-t">
                                      <p className="text-xs text-muted-foreground mb-2">
                                        Search by component code or description
                                      </p>
                                      <Input
                                        placeholder="Search components..."
                                        value={componentSearch}
                                        onChange={(e) => setComponentSearch(e.target.value)}
                                        className="mb-1"
                                      />
                                    </div>
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

                          {supplierFeatureAvailable && (
                            <FormField
                              control={form.control}
                              name="supplier_component_id"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Supplier</FormLabel>
                                  <FormControl>
                                    <Select
                                      onValueChange={(value) => {
                                        console.log('Supplier selected:', value);
                                        field.onChange(value);
                                      }}
                                      value={field.value}
                                    >
                                      <FormControl>
                                        <SelectTrigger>
                                          <SelectValue placeholder="Select supplier" />
                                        </SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                        {supplierComponents.map((supplierComponent) => (
                                          <SelectItem
                                            key={supplierComponent.supplier_component_id}
                                            value={supplierComponent.supplier_component_id.toString()}
                                          >
                                            <span className="font-medium">{supplierComponent.supplier?.name}</span>
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          )}
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