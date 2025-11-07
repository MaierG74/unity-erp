'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Resolver } from 'react-hook-form';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, Plus, Trash2, AlertCircle } from 'lucide-react';
import { PurchaseOrderFormData } from '@/types/purchasing';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ReactSelect from 'react-select';

// Form validation schema
const formSchema = z.object({
  order_date: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(
    z.object({
      component_id: z.number({
        required_error: 'Please select a component',
      }),
      supplier_component_id: z.number({
        required_error: 'Please select a supplier',
      }),
      quantity: z.number({
        required_error: 'Please enter a quantity',
        invalid_type_error: 'Please enter a number',
      }).min(1, 'Quantity must be at least 1'),
    })
  ).min(1, 'Please add at least one item to the order'),
});

type ComponentFromAPI = {
  component_id: number;
  internal_code: string;
  description: string | null;
};

type SupplierComponentWithSupplier = {
  supplier_component_id: number;
  component_id: number;
  supplier_id: number;
  price: number;
  suppliers: {
    name: string;
  }[];
};

type SupplierComponentRawResponse = {
  supplier_component_id: number;
  component_id: number;
  supplier_id: number;
  price: number;
  supplier: {
    name: string;
  } | null;
};

type SupplierComponentFromAPI = {
  supplier_component_id: number;
  component_id: number;
  supplier_id: number;
  price: number;
  supplier: {
    name: string;
  };
};

type ComponentOption = {
  value: number;
  label: string;
};

// Fetch components
async function fetchComponents() {
  const { data, error } = await supabase
    .from('components')
    .select('component_id, internal_code, description')
    .order('internal_code');
  
  if (error) {
    console.error('Error fetching components:', error);
    throw new Error('Failed to fetch components');
  }
  
  return data as ComponentFromAPI[];
}

// Fetch supplier components for a specific component
async function fetchSupplierComponentsForComponent(componentId: number): Promise<SupplierComponentFromAPI[]> {
  // Validate component ID
  if (!componentId || isNaN(componentId) || componentId <= 0) {
    console.warn('Invalid component ID:', componentId);
    return [];
  }
  
  try {
    const { data, error } = await supabase
      .from('suppliercomponents')
      .select(`
        supplier_component_id,
        component_id,
        supplier_id,
        price,
        supplier:suppliers (name)
      `)
      .eq('component_id', componentId);
    
    if (error) {
      console.error('Error fetching supplier components:', error);
      return [];
    }
    
    if (!data || !Array.isArray(data)) {
      console.warn(`No supplier components found for component ${componentId}`);
      return [];
    }
    
    // Transform the data to match expected format, handling potential null values
    return data.map(item => {
      const rawItem = item as unknown as {
        supplier_component_id: number;
        component_id: number;
        supplier_id: number;
        price: number;
        supplier: { name: string } | null;
      };
      
      return {
        supplier_component_id: rawItem.supplier_component_id,
        component_id: rawItem.component_id,
        supplier_id: rawItem.supplier_id,
        price: rawItem.price,
        supplier: {
          name: rawItem.supplier?.name || 'Unknown Supplier'
        }
      };
    });
  } catch (error) {
    console.error('Exception when fetching supplier components:', error);
    return [];
  }
}

// Fetch Draft status ID
async function fetchDraftStatusId() {
  const { data, error } = await supabase
    .from('supplier_order_statuses')
    .select('status_id')
    .eq('status_name', 'Draft')
    .single();

  if (error) {
    console.error('Error fetching Draft status:', error);
    throw new Error('Failed to fetch Draft status');
  }

  return data.status_id;
}

// Create purchase order
async function createPurchaseOrder(
  formData: PurchaseOrderFormData,
  statusId: number,
  supplierComponentsCache: Map<number, SupplierComponentFromAPI[]> = new Map()
) {
  // Group items by supplier
  const itemsBySupplier = new Map<number, Array<{
    supplier_component_id: number;
    quantity: number;
    component_id: number;
  }>>();

  formData.items.forEach((item) => {
    const supplierOptions = supplierComponentsCache.get(item.component_id) || [];
    const supplierComponent = supplierOptions.find(
      (candidate) => candidate.supplier_component_id === item.supplier_component_id
    );

    if (!supplierComponent) {
      throw new Error(
        `Missing supplier data for component ${item.component_id}. Refresh suppliers and try again.`
      );
    }

    if (!supplierComponent.supplier_id) {
      throw new Error(
        `Supplier selection is missing its supplier reference for component ${item.component_id}.`
      );
    }

    if (!itemsBySupplier.has(supplierComponent.supplier_id)) {
      itemsBySupplier.set(supplierComponent.supplier_id, []);
    }

    itemsBySupplier.get(supplierComponent.supplier_id)?.push({
      supplier_component_id: item.supplier_component_id,
      quantity: item.quantity,
      component_id: item.component_id,
    });
  });

  // Create a purchase order for each supplier
  const purchaseOrderIds = await Promise.all(
    Array.from(itemsBySupplier.entries()).map(async ([supplierId, items]) => {
      // 1. Create the purchase order
      const { data: purchaseOrder, error: purchaseOrderError } = await supabase
        .from('purchase_orders')
        .insert({
          order_date: formData.order_date || new Date().toISOString(),
          status_id: statusId,
          notes: formData.notes,
          supplier_id: supplierId, // Add supplier_id to purchase_orders
        })
        .select('purchase_order_id')
        .single();

      if (purchaseOrderError) {
        console.error('Error creating purchase order:', purchaseOrderError);
        throw new Error('Failed to create purchase order');
      }

      // 2. Create supplier orders for this supplier's items
      await Promise.all(
        items.map(async (item) => {
          const { error } = await supabase
            .from('supplier_orders')
            .insert({
              supplier_component_id: item.supplier_component_id,
              order_quantity: item.quantity,
              order_date: formData.order_date || new Date().toISOString(),
              status_id: statusId,
              total_received: 0,
              purchase_order_id: purchaseOrder.purchase_order_id,
            });
          
          if (error) {
            console.error('Error creating supplier order:', error);
            throw new Error(`Failed to create order for component ${item.component_id}`);
          }
        })
      );

      return purchaseOrder.purchase_order_id;
    })
  );

  return purchaseOrderIds;
}

export function NewPurchaseOrderForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  // Form setup
  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<PurchaseOrderFormData>({
    resolver: zodResolver(formSchema) as Resolver<PurchaseOrderFormData>,
    defaultValues: {
      order_date: new Date().toISOString().split('T')[0],
      notes: '',
      items: [{ component_id: 0, supplier_component_id: 0, quantity: 1 }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'items',
  });

  // Get all components for dropdown
  const { data: components, isLoading: componentsLoading } = useQuery({
    queryKey: ['components'],
    queryFn: fetchComponents,
  });

  const componentOptions = useMemo<ComponentOption[]>(
    () =>
      (components ?? []).map((component) => ({
        value: component.component_id,
        label: `${component.internal_code}${component.description ? ` - ${component.description}` : ''}`,
      })),
    [components]
  );

  // Get draft status ID
  const { data: draftStatusId, isLoading: statusLoading } = useQuery({
    queryKey: ['draftStatusId'],
    queryFn: fetchDraftStatusId,
  });

  // Watch for component changes to load suppliers
  const watchedItems = watch('items');

  // Create a single query for all supplier components
  const { data: supplierComponentsMap, isLoading: suppliersLoading } = useQuery<Map<number, SupplierComponentFromAPI[]>>({
    queryKey: ['supplierComponents', watchedItems.map((item) => item.component_id).join(',')],
    queryFn: async () => {
      const results = new Map<number, SupplierComponentFromAPI[]>();
      const componentIds = Array.from(
        new Set(watchedItems.filter((item) => item.component_id > 0).map((item) => item.component_id))
      );

      await Promise.all(
        componentIds.map(async (componentId) => {
          const suppliers = await fetchSupplierComponentsForComponent(componentId);
          results.set(componentId, suppliers);
        })
      );

      return results;
    },
    enabled: watchedItems.some((item) => item.component_id > 0),
  });

  // Create purchase order mutation
  const createOrderMutation = useMutation({
    mutationFn: async (data: PurchaseOrderFormData) => {
      if (!draftStatusId) throw new Error('Failed to get draft status');
      return createPurchaseOrder(data, draftStatusId, supplierComponentsMap ?? new Map());
    },
    onSuccess: (purchaseOrderIds) => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
      // Redirect to the first purchase order created
      if (Array.isArray(purchaseOrderIds) && purchaseOrderIds.length > 0) {
        router.push(`/purchasing/purchase-orders/${purchaseOrderIds[0]}`);
      } else {
        router.push('/purchasing/purchase-orders');
      }
    },
    onError: (error: Error) => {
      setError(error.message);
    },
  });

  const onSubmit = (data: PurchaseOrderFormData) => {
    setError(null);
    createOrderMutation.mutate(data);
  };

  const addItem = () => {
    append({ component_id: 0, supplier_component_id: 0, quantity: 1 });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label htmlFor="order_date" className="block text-sm font-medium mb-1">
            Order Date
          </label>
          <Input
            id="order_date"
            type="date"
            className={`h-10 ${errors.order_date ? 'border-destructive' : ''}`}
            disabled={createOrderMutation.isPending || statusLoading}
            {...register('order_date')}
          />
          {errors.order_date && (
            <p className="mt-1 text-sm text-destructive">{errors.order_date.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="notes" className="block text-sm font-medium mb-1">
            Notes
          </label>
          <Textarea
            id="notes"
            className={`min-h-[80px] ${errors.notes ? 'border-destructive' : ''}`}
            disabled={createOrderMutation.isPending || statusLoading}
            {...register('notes')}
          />
          {errors.notes && (
            <p className="mt-1 text-sm text-destructive">{errors.notes.message}</p>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium">Order Items</h3>
          <Button
            type="button"
            onClick={addItem}
            variant="outline"
            size="sm"
            disabled={createOrderMutation.isPending}
          >
            <Plus className="h-4 w-4 mr-1" /> Add Item
          </Button>
        </div>

        {errors.items && !Array.isArray(errors.items) && (
          <p className="text-sm text-destructive">{errors.items.message}</p>
        )}

        {fields.map((field, index) => (
          <Card key={field.id} className="overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-4">
                <h4 className="text-sm font-medium">Item {index + 1}</h4>
                {fields.length > 1 && (
                  <Button
                    type="button"
                    onClick={() => remove(index)}
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={createOrderMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label htmlFor={`items.${index}.component_id`} className="block text-sm font-medium mb-1">
                    Component
                  </label>
                  <Controller
                    control={control}
                    name={`items.${index}.component_id`}
                    render={({ field }) => (
                      <ReactSelect<ComponentOption, false>
                        inputId={`component-select-${index}`}
                        isClearable
                        isDisabled={componentsLoading || createOrderMutation.isPending}
                        isLoading={componentsLoading}
                        options={componentOptions}
                        value={componentOptions.find((option) => option.value === field.value) ?? null}
                        onChange={(option: ComponentOption | null) => {
                          const selectedId = option?.value ?? 0;
                          field.onChange(selectedId);
                          setValue(`items.${index}.supplier_component_id`, 0, {
                            shouldValidate: true,
                            shouldDirty: true,
                          });
                        }}
                        onBlur={field.onBlur}
                        placeholder="Search for a component"
                        menuPlacement="auto"
                        classNamePrefix="component-select"
                        styles={{
                          control: (base, state) => ({
                            ...base,
                            minHeight: '2.5rem',
                            borderRadius: '0.375rem',
                            borderColor: state.isFocused
                              ? 'hsl(var(--ring))'
                              : errors.items?.[index]?.component_id
                                ? 'hsl(var(--destructive))'
                                : 'hsl(var(--input))',
                            boxShadow: state.isFocused
                              ? '0 0 0 1px hsl(var(--ring))'
                              : 'none',
                            '&:hover': {
                              borderColor: state.isFocused
                                ? 'hsl(var(--ring))'
                                : 'hsl(var(--input))',
                            },
                            backgroundColor: 'hsl(var(--background))',
                          }),
                          menu: (base) => ({
                            ...base,
                            zIndex: 50,
                            marginTop: 4,
                          }),
                          menuPortal: (base) => ({
                            ...base,
                            zIndex: 60,
                          }),
                          option: (base, state) => ({
                            ...base,
                            backgroundColor: state.isFocused
                              ? 'hsl(var(--accent))'
                              : 'transparent',
                            color: state.isFocused
                              ? 'hsl(var(--accent-foreground))'
                              : 'inherit',
                            cursor: 'pointer',
                          }),
                          singleValue: (base) => ({
                            ...base,
                            color: 'hsl(var(--foreground))',
                          }),
                          placeholder: (base) => ({
                            ...base,
                            color: 'hsl(var(--muted-foreground))',
                          }),
                        }}
                        menuPortalTarget={typeof document !== 'undefined' ? document.body : undefined}
                        noOptionsMessage={() =>
                          componentsLoading ? 'Loading components...' : 'No component found.'
                        }
                      />
                    )}
                  />
                  {errors.items?.[index]?.component_id && (
                    <p className="mt-1 text-sm text-destructive">
                      {errors.items[index]?.component_id?.message}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor={`items.${index}.supplier_component_id`} className="block text-sm font-medium mb-1">
                    Supplier
                  </label>
                  <Controller
                    control={control}
                    name={`items.${index}.supplier_component_id`}
                    render={({ field }) => {
                      const componentId = watchedItems[index]?.component_id;
                      const suppliers = supplierComponentsMap?.get(componentId) || [];
                      
                      return (
                        <Select
                          value={field.value?.toString() || ''}
                          onValueChange={(value) => field.onChange(parseInt(value) || 0)}
                          disabled={!componentId || suppliersLoading || createOrderMutation.isPending}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select a supplier" />
                          </SelectTrigger>
                          <SelectContent>
                            {suppliers.map((sc: SupplierComponentFromAPI) => (
                              <SelectItem key={sc.supplier_component_id} value={sc.supplier_component_id.toString()}>
                                {sc.supplier?.name || 'Unknown Supplier'} - R{sc.price.toFixed(2)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      );
                    }}
                  />
                  {errors.items?.[index]?.supplier_component_id && (
                    <p className="mt-1 text-sm text-destructive">
                      {errors.items[index]?.supplier_component_id?.message}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor={`items.${index}.quantity`} className="block text-sm font-medium mb-1">
                    Quantity
                  </label>
                  <Controller
                    control={control}
                    name={`items.${index}.quantity`}
                    render={({ field }) => (
                      <input
                        type="number"
                        id={`items.${index}.quantity`}
                        className={`h-10 w-full rounded-md border ${
                          errors.items?.[index]?.quantity ? 'border-destructive' : 'border-input'
                        } bg-background px-3 py-2 text-sm`}
                        min="1"
                        value={field.value || ''}
                        onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                        disabled={createOrderMutation.isPending}
                      />
                    )}
                  />
                  {errors.items?.[index]?.quantity && (
                    <p className="mt-1 text-sm text-destructive">
                      {errors.items[index]?.quantity?.message}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="pt-4 border-t flex justify-end">
        <Button
          type="submit"
          disabled={createOrderMutation.isPending || statusLoading}
          className="w-full md:w-auto"
        >
          {createOrderMutation.isPending && (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          )}
          {createOrderMutation.isPending
            ? 'Creating Purchase Order...'
            : 'Create Purchase Order'}
        </Button>
      </div>
    </form>
  );
} 
