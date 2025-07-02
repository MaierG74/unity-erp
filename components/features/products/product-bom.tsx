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
import React from 'react';

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
  // Allow any positive decimal
  quantity_required: z.coerce
    .number()
    .positive('Quantity must be greater than 0'),
  supplier_component_id: z.string().optional(),
});

type BOMItemFormValues = z.infer<typeof bomItemSchema>;

interface ProductBOMProps {
  productId: number;
}

export function ProductBOM({ productId }: ProductBOMProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [componentSearch, setComponentSearch] = useState('');
  const [supplierSearch, setSupplierSearch] = useState('');
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);
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
      console.log('Fetching BOM items for product ID:', productId);
      
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
        
      if (error) {
        console.error('Error fetching BOM items:', error);
        throw error;
      }
      
      console.log('Fetched BOM items:', data);
      
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

  // Completely remove all filtering logic and use a simple approach
  const getFilteredComponents = () => {
    if (!components || components.length === 0) return [];
    if (!componentSearch) return components;
    
    console.log("Filtering components with search term:", componentSearch);
    
    const normalizedSearch = componentSearch.toLowerCase().trim();
    const filtered = components.filter(component => {
      if (!component) return false;
      
      const codeText = (component.internal_code || '').toLowerCase();
      const descText = (component.description || '').toLowerCase();
      
      return codeText.includes(normalizedSearch) || descText.includes(normalizedSearch);
    });
    
    console.log(`Found ${filtered.length} components matching '${componentSearch}'`);
    return filtered;
  };
  
  const getFilteredSupplierComponents = () => {
    if (!supplierComponents || supplierComponents.length === 0) return [];
    if (!supplierSearch) return supplierComponents;
    
    console.log("Filtering suppliers with search term:", supplierSearch);
    
    const normalizedSearch = supplierSearch.toLowerCase().trim();
    const filtered = supplierComponents.filter(sc => {
      if (!sc) return false;
      
      const supplierName = (sc?.supplier?.name || '').toLowerCase();
      
      return supplierName.includes(normalizedSearch);
    });
    
    console.log(`Found ${filtered.length} suppliers matching '${supplierSearch}'`);
    return filtered;
  };
  
  // Get filtered lists directly when rendering
  const filteredComponents = getFilteredComponents();
  const filteredSuppliers = getFilteredSupplierComponents();

  // Add BOM item mutation
  const addBOMItem = useMutation({
    mutationFn: async (values: BOMItemFormValues) => {
      try {
        // Build the insert object
        const insertData: any = {
          product_id: productId,
          component_id: parseInt(values.component_id),
          // Store quantity as a decimal
          quantity_required: Number(values.quantity_required),
        };
        
        // Only include supplier_component_id if the feature is available and a value is provided
        if (supplierFeatureAvailable && values.supplier_component_id) {
          insertData.supplier_component_id = parseInt(values.supplier_component_id);
        }
        
        console.log('Adding BOM item with data:', insertData);
        
        const { data, error } = await supabase
          .from('billofmaterials')
          .insert(insertData)
          .select();
          
        if (error) {
          console.error('Supabase error:', error);
          throw new Error(`Database error: ${error.message}`);
        }
        
        console.log('Successfully added BOM item:', data);
        return data;
      } catch (error: any) {
        console.error('Error in mutation:', error);
        throw error;
      }
    },
    onSuccess: (data) => {
      console.log('BOM item added successfully, invalidating queries', data);
      queryClient.invalidateQueries({ queryKey: ['productBOM', productId] });
      form.reset({
        component_id: '',
        quantity_required: 1,
        supplier_component_id: '',
      });
      handleComponentSearchChange('');  // Reset search term
      handleSupplierSearchChange('');  // Reset supplier search term
      toast({
        title: 'Success',
        description: 'Component added to BOM',
      });
    },
    onError: (error) => {
      console.error('Error adding BOM item:', error);
      
      // Create a more user-friendly error message
      let errorMessage = 'Failed to add component to BOM';
      
      if (error.message && error.message.includes('invalid input syntax')) {
        errorMessage = 'The quantity must be a whole number. Please adjust your input.';
      } else if (error.message) {
        errorMessage = `${errorMessage}: ${error.message}`;
      }
      
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    },
  });
  
  // Update BOM item mutation
  const updateBOMItem = useMutation({
    mutationFn: async (values: BOMItemFormValues & { bom_id: number }) => {
      try {
        // Build the update object
        const updateData: any = {
          component_id: parseInt(values.component_id),
          // Store quantity as a decimal
          quantity_required: Number(values.quantity_required),
        };
        
        // Only include supplier_component_id if the feature is available and a value is provided
        if (supplierFeatureAvailable && values.supplier_component_id) {
          updateData.supplier_component_id = parseInt(values.supplier_component_id);
        }
        
        console.log('Updating BOM item with data:', updateData);
        
        const { data, error } = await supabase
          .from('billofmaterials')
          .update(updateData)
          .eq('bom_id', values.bom_id)
          .select();
          
        if (error) {
          console.error('Supabase error:', error);
          throw new Error(`Database error: ${error.message}`);
        }
        
        console.log('Successfully updated BOM item:', data);
        return data;
      } catch (error: any) {
        console.error('Error in update mutation:', error);
        throw error;
      }
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
    console.log('Form submitted with values:', values);
    console.log('Current product ID:', productId);
    
    // Validate component_id is a valid number
    if (!values.component_id || isNaN(parseInt(values.component_id))) {
      console.error('Invalid component_id:', values.component_id);
      toast({
        title: 'Validation Error',
        description: 'Please select a valid component',
        variant: 'destructive',
      });
      return;
    }
    
    // Extra validation for supplier if the feature is available
    if (supplierFeatureAvailable && values.supplier_component_id) {
      if (isNaN(parseInt(values.supplier_component_id))) {
        console.error('Invalid supplier_component_id:', values.supplier_component_id);
        toast({
          title: 'Validation Error',
          description: 'Please select a valid supplier',
          variant: 'destructive',
        });
        return;
      }
    }
    
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
    setSelectedComponentId(null);
    handleComponentSearchChange('');
    handleSupplierSearchChange('');
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

  // Add wrapper functions to track state changes
  const handleComponentSearchChange = (value: string) => {
    console.log("Component search changed to:", value);
    setComponentSearch(value);
  };

  const handleSupplierSearchChange = (value: string) => {
    console.log("Supplier search changed to:", value);
    setSupplierSearch(value);
    // Show the dropdown when searching
    if (value.length > 0) {
      setShowSupplierDropdown(true);
    }
  };

  // Add refs to the supplier dropdown containers
  const supplierDropdownRef = React.useRef<HTMLDivElement>(null);
  const formSupplierDropdownRef = React.useRef<HTMLDivElement>(null);

  // Add a click outside handler
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const clickedOutsideTableDropdown = supplierDropdownRef.current && 
                                          !supplierDropdownRef.current.contains(event.target as Node);
      const clickedOutsideFormDropdown = formSupplierDropdownRef.current && 
                                          !formSupplierDropdownRef.current.contains(event.target as Node);
      
      // If clicked outside both dropdowns, hide them
      if (clickedOutsideTableDropdown && clickedOutsideFormDropdown) {
        setShowSupplierDropdown(false);
      }
    }

    // Bind the event listener
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      // Unbind the event listener on clean up
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [supplierDropdownRef, formSupplierDropdownRef]);

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
              <span className="text-lg font-bold">R{totalBOMCost.toFixed(2)}</span>
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
                                    <Popover>
                                      <PopoverTrigger asChild>
                                        <FormControl>
                                          <Button
                                            variant="outline"
                                            role="combobox"
                                            className={cn(
                                              "w-full justify-between",
                                              !field.value && "text-muted-foreground"
                                            )}
                                          >
                                            {field.value
                                              ? components.find(
                                                  (component) => component?.component_id?.toString() === field.value
                                                )?.internal_code || "Select component"
                                              : "Select component"}
                                            <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                          </Button>
                                        </FormControl>
                                      </PopoverTrigger>
                                      <PopoverContent className="w-[400px] p-0">
                                        <Command>
                                          <CommandInput
                                            placeholder="Search components..."
                                            className="h-9"
                                            onValueChange={handleComponentSearchChange}
                                            value={componentSearch}
                                          />
                                          <CommandList>
                                            <CommandEmpty>No components found</CommandEmpty>
                                            <CommandGroup>
                                              {filteredComponents.map((component) => (
                                                <div
                                                  key={component.component_id}
                                                  className="px-2 py-1.5 text-sm rounded-sm cursor-pointer hover:bg-accent hover:text-accent-foreground aria-selected:bg-accent aria-selected:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                                                  onClick={() => {
                                                    form.setValue("component_id", component.component_id.toString());
                                                    handleComponentSearchChange("");
                                                    handleSupplierSearchChange("");
                                                    // Reset supplier when component changes
                                                    if (supplierFeatureAvailable) {
                                                      form.setValue('supplier_component_id', '');
                                                    }
                                                    // Close the popover
                                                    const popoverElement = document.querySelector('[data-state="open"][role="dialog"]');
                                                    if (popoverElement) {
                                                      (popoverElement as HTMLElement).click();
                                                    }
                                                  }}
                                                >
                                                  <div className="flex flex-col w-full cursor-pointer">
                                                    <div className="flex items-center">
                                                      <span className="font-medium">{component.internal_code || 'No code'}</span>
                                                    </div>
                                                    {component.description && (
                                                      <span className="text-xs text-muted-foreground">
                                                        {component.description}
                                                      </span>
                                                    )}
                                                  </div>
                                                </div>
                                              ))}
                                            </CommandGroup>
                                          </CommandList>
                                        </Command>
                                      </PopoverContent>
                                    </Popover>
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
                                        <FormItem>
                                          <FormLabel>Supplier</FormLabel>
                                          
                                          {/* Use the same approach as the inline supplier selection */}
                                          <div className="relative" ref={formSupplierDropdownRef}>
                                            <Input 
                                              placeholder="Search suppliers..." 
                                              value={supplierSearch} 
                                              onChange={(e) => handleSupplierSearchChange(e.target.value)}
                                              className="mb-1 focus-visible:ring-1"
                                              disabled={!form.getValues().component_id || suppliersLoading}
                                              onFocus={() => setShowSupplierDropdown(true)}
                                            />
                                            {form.getValues().component_id && showSupplierDropdown && (
                                              <div className="absolute z-10 w-full bg-background border rounded-md mt-1 max-h-[300px] overflow-y-auto" data-supplier-dropdown>
                                                {supplierSearch && getFilteredSupplierComponents().length === 0 ? (
                                                  <div className="px-2 py-4 text-sm text-center text-muted-foreground">No suppliers found</div>
                                                ) : (
                                                  <div>
                                                    <div className="p-2 text-xs text-muted-foreground font-semibold border-b">
                                                      Suppliers (sorted by lowest price first)
                                                    </div>
                                                    {getFilteredSupplierComponents()
                                                      .sort((a, b) => {
                                                        const priceA = parseFloat(a?.price?.toString() || '0');
                                                        const priceB = parseFloat(b?.price?.toString() || '0');
                                                        return priceA - priceB;
                                                      })
                                                      .map((sc) => (
                                                        <div
                                                          key={sc.supplier_component_id}
                                                          className="px-2 py-1.5 text-sm rounded-sm cursor-pointer hover:bg-accent hover:text-accent-foreground"
                                                          onClick={() => {
                                                            form.setValue("supplier_component_id", sc.supplier_component_id.toString());
                                                            handleSupplierSearchChange("");
                                                            setShowSupplierDropdown(false);
                                                          }}
                                                        >
                                                          <div className="flex justify-between w-full cursor-pointer">
                                                            <span>{sc?.supplier?.name || "Unknown"}</span>
                                                            <span className="font-medium">R{parseFloat(sc?.price?.toString() || '0').toFixed(2)}</span>
                                                          </div>
                                                        </div>
                                                      ))
                                                    }
                                                  </div>
                                                )}
                                              </div>
                                            )}
                                            <div className="mt-2">
                                              {field.value && (
                                                <div className="text-sm p-2.5 border rounded-md bg-accent/10">
                                                  <div className="flex justify-between items-center">
                                                    <span>
                                                      <span className="text-muted-foreground mr-1">Selected:</span> 
                                                      <span className="font-medium">
                                                        {supplierComponents.find(sc => sc.supplier_component_id.toString() === field.value)?.supplier?.name || 'Unknown'}
                                                      </span>
                                                    </span>
                                                    <span className="font-medium text-primary">
                                                      R{parseFloat(
                                                        supplierComponents.find(sc => sc.supplier_component_id.toString() === field.value)?.price?.toString() || '0'
                                                      ).toFixed(2)}
                                                    </span>
                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                          <FormMessage />
                                        </FormItem>
                                      )}
                                    />
                                  </TableCell>
                                  <TableCell>
                                    {/* Price is shown based on the selected supplier */}
                                    {form.getValues().supplier_component_id && 
                                      'R' + parseFloat(
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
                                    <FormControl>
                                      <Input
                                        type="number"
                                        min="0.1"
                                        step="0.1"
                                        className="w-20"
                                        placeholder="e.g., 1.7"
                                        title="Enter quantity (decimals allowed)"
                                        {...field}
                                      />
                                    </FormControl>
                                  )}
                                />
                                <FormMessage />
                                <p className="text-xs text-muted-foreground mt-1">
                                  Decimal values allowed (e.g., 1.5, 2.75)
                                </p>
                              </TableCell>
                              {supplierFeatureAvailable && (
                                <TableCell>
                                  {/* Total cost calculation */}
                                  {(form.getValues().supplier_component_id && form.getValues().quantity_required) ? 
                                    'R' + (
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
                                  <TableCell>{item.supplierComponent ? `R${parseFloat(item.supplierComponent.price.toString()).toFixed(2)}` : '-'}</TableCell>
                                </>
                              )}
                              <TableCell>{Number(item.quantity_required).toFixed(2)}</TableCell>
                              {supplierFeatureAvailable && (
                                <TableCell>
                                  {item.supplierComponent 
                                    ? `R${(parseFloat(item.supplierComponent.price.toString()) * item.quantity_required).toFixed(2)}` 
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
                <Card className="bg-card/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-md font-medium">Add Component</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Form {...form}>
                      <form
                        onSubmit={form.handleSubmit(onSubmit)}
                        className="space-y-6"
                      >
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                          <FormField
                            control={form.control}
                            name="component_id"
                            render={({ field }) => (
                              <FormItem className="flex flex-col md:col-span-8">
                                <FormLabel>Component</FormLabel>
                                
                                {/* Simplified approach to component selection */}
                                <div className="relative">
                                  <Input 
                                    placeholder="Search components..." 
                                    value={componentSearch} 
                                    onChange={(e) => handleComponentSearchChange(e.target.value)}
                                    className="mb-1 focus-visible:ring-1"
                                  />
                                  {componentSearch && (
                                    <div className="absolute z-10 w-full bg-background border rounded-md mt-1 max-h-[300px] overflow-y-auto">
                                      {getFilteredComponents().length === 0 ? (
                                        <div className="px-2 py-4 text-sm text-center text-muted-foreground">No components found</div>
                                      ) : (
                                        getFilteredComponents().map((component) => (
                                          <div
                                            key={component.component_id}
                                            className="px-2 py-1.5 text-sm rounded-sm cursor-pointer hover:bg-accent hover:text-accent-foreground"
                                            onClick={() => {
                                              form.setValue("component_id", component.component_id.toString());
                                              handleComponentSearchChange("");
                                              handleSupplierSearchChange("");
                                              // Reset supplier when component changes
                                              if (supplierFeatureAvailable) {
                                                form.setValue('supplier_component_id', '');
                                              }
                                            }}
                                          >
                                            <div className="flex flex-col w-full cursor-pointer">
                                              <div className="flex items-center">
                                                <span className="font-medium">{component.internal_code || 'No code'}</span>
                                              </div>
                                              {component.description && (
                                                <span className="text-xs text-muted-foreground">
                                                  {component.description}
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  )}
                                  <div className="mt-2">
                                    {field.value && (
                                      <div className="text-sm p-2.5 border rounded-md bg-accent/10 flex items-center">
                                        <span className="text-muted-foreground mr-1">Selected:</span> 
                                        <span className="font-medium ml-1">
                                          {components.find(c => c.component_id.toString() === field.value)?.internal_code || 'Unknown'}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="quantity_required"
                            render={({ field }) => (
                              <FormItem className="md:col-span-4">
                                <FormLabel>Quantity</FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    min="0.1"
                                    step="0.1"
                                    className="w-20"
                                    placeholder="e.g., 1.7"
                                    title="Enter quantity (decimals allowed)"
                                    {...field}
                                  />
                                </FormControl>
                                <FormMessage />
                                <p className="text-xs text-muted-foreground mt-1">
                                  Decimal values allowed (e.g., 1.5, 2.75)
                                </p>
                              </FormItem>
                            )}
                          />

                          {supplierFeatureAvailable && (
                            <FormField
                              control={form.control}
                              name="supplier_component_id"
                              render={({ field }) => (
                                <FormItem className="md:col-span-12">
                                  <FormLabel>Supplier</FormLabel>
                                  
                                  {/* Use the same approach as the inline supplier selection */}
                                  <div className="relative" ref={formSupplierDropdownRef}>
                                    <Input 
                                      placeholder="Search suppliers..." 
                                      value={supplierSearch} 
                                      onChange={(e) => handleSupplierSearchChange(e.target.value)}
                                      className="mb-1 focus-visible:ring-1"
                                      disabled={!form.getValues().component_id || suppliersLoading}
                                      onFocus={() => setShowSupplierDropdown(true)}
                                    />
                                    {form.getValues().component_id && showSupplierDropdown && (
                                      <div className="absolute z-10 w-full bg-background border rounded-md mt-1 max-h-[300px] overflow-y-auto" data-supplier-dropdown>
                                        {supplierSearch && getFilteredSupplierComponents().length === 0 ? (
                                          <div className="px-2 py-4 text-sm text-center text-muted-foreground">No suppliers found</div>
                                        ) : (
                                          <div>
                                            <div className="p-2 text-xs text-muted-foreground font-semibold border-b">
                                              Suppliers (sorted by lowest price first)
                                            </div>
                                            {getFilteredSupplierComponents()
                                              .sort((a, b) => {
                                                const priceA = parseFloat(a?.price?.toString() || '0');
                                                const priceB = parseFloat(b?.price?.toString() || '0');
                                                return priceA - priceB;
                                              })
                                              .map((sc) => (
                                                <div
                                                  key={sc.supplier_component_id}
                                                  className="px-2 py-1.5 text-sm rounded-sm cursor-pointer hover:bg-accent hover:text-accent-foreground"
                                                  onClick={() => {
                                                    form.setValue("supplier_component_id", sc.supplier_component_id.toString());
                                                    handleSupplierSearchChange("");
                                                    setShowSupplierDropdown(false);
                                                  }}
                                                >
                                                  <div className="flex justify-between w-full cursor-pointer">
                                                    <span>{sc?.supplier?.name || "Unknown"}</span>
                                                    <span className="font-medium">R{parseFloat(sc?.price?.toString() || '0').toFixed(2)}</span>
                                                  </div>
                                                </div>
                                              ))
                                            }
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    <div className="mt-2">
                                      {field.value && (
                                        <div className="text-sm p-2.5 border rounded-md bg-accent/10">
                                          <div className="flex justify-between items-center">
                                            <span>
                                              <span className="text-muted-foreground mr-1">Selected:</span> 
                                              <span className="font-medium">
                                                {supplierComponents.find(sc => sc.supplier_component_id.toString() === field.value)?.supplier?.name || 'Unknown'}
                                              </span>
                                            </span>
                                            <span className="font-medium text-primary">
                                              R{parseFloat(
                                                supplierComponents.find(sc => sc.supplier_component_id.toString() === field.value)?.price?.toString() || '0'
                                              ).toFixed(2)}
                                            </span>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          )}
                        </div>

                        {/* Summary section showing cost information */}
                        {form.watch('component_id') && supplierFeatureAvailable && (
                          <div className="mt-4 p-4 border rounded-md bg-muted/20">
                            <h4 className="text-sm font-semibold mb-3 text-primary">Selection Summary</h4>
                            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                              <div className="text-muted-foreground font-medium">Component:</div>
                              <div>
                                {components.find(c => c?.component_id?.toString() === form.watch('component_id'))?.internal_code || 'Not selected'} 
                              </div>
                              
                              <div className="text-muted-foreground font-medium">Supplier:</div>
                              <div>
                                {form.watch('supplier_component_id') 
                                  ? supplierComponents.find(sc => 
                                      sc?.supplier_component_id?.toString() === form.watch('supplier_component_id')
                                    )?.supplier?.name || 'Not selected'
                                  : 'Not selected'
                                }
                              </div>
                              
                              <div className="text-muted-foreground font-medium">Unit Price:</div>
                              <div className="font-medium">
                                {form.watch('supplier_component_id')
                                  ? 'R' + parseFloat(
                                      supplierComponents.find(sc => 
                                        sc?.supplier_component_id?.toString() === form.watch('supplier_component_id')
                                      )?.price?.toString() || '0'
                                    ).toFixed(2)
                                  : '-'
                                }
                              </div>
                              
                              <div className="text-muted-foreground font-medium">Quantity:</div>
                              <div>{form.watch('quantity_required') || 1}</div>
                              
                              <div className="text-muted-foreground font-medium">Total Cost:</div>
                              <div className="font-semibold">
                                {(form.watch('supplier_component_id') && form.watch('quantity_required')) 
                                  ? 'R' + (
                                    parseFloat(
                                      supplierComponents.find(sc => 
                                        sc?.supplier_component_id?.toString() === form.watch('supplier_component_id')
                                      )?.price?.toString() || '0'
                                    ) * 
                                    (form.watch('quantity_required') || 0)
                                  ).toFixed(2)
                                  : '-'
                                }
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="flex justify-end pt-2">
                          <Button
                            type="submit"
                            className="px-6"
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