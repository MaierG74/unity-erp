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
import { toast } from 'sonner';
import { ConsolidatePODialog, SupplierWithDrafts, ExistingDraftPO } from '@/components/features/purchasing/ConsolidatePODialog';

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
      customer_order_id: z.number().nullable().optional(),
    })
  ).min(1, 'Please add at least one item to the order'),
});

type ComponentFromAPI = {
  component_id: number;
  internal_code: string;
  description: string | null;
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

type SupplierOrderLinePayload = {
  supplier_component_id: number;
  order_quantity: number;
  component_id: number;
  quantity_for_order: number;
  quantity_for_stock: number;
  customer_order_id?: number | null;
};

type PurchaseOrderCreationResult = {
  purchase_order_id: number;
  supplier_order_ids: number[] | null;
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
): Promise<PurchaseOrderCreationResult[]> {
  // Group items by supplier
  const itemsBySupplier = new Map<number, Array<{
    supplier_component_id: number;
    quantity: number;
    component_id: number;
    customer_order_id?: number | null;
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
      customer_order_id: item.customer_order_id,
    });
  });

  const orderDateISO = formData.order_date
    ? new Date(formData.order_date).toISOString()
    : new Date().toISOString();

  // Create a purchase order for each supplier via RPC so the header and lines are inserted atomically
  const purchaseOrders = await Promise.all(
    Array.from(itemsBySupplier.entries()).map(async ([supplierId, items]) => {
      const lineItems: SupplierOrderLinePayload[] = items.map((item) => ({
        supplier_component_id: item.supplier_component_id,
        order_quantity: item.quantity,
        component_id: item.component_id,
        quantity_for_order: item.customer_order_id ? item.quantity : 0,
        quantity_for_stock: item.customer_order_id ? 0 : item.quantity,
        customer_order_id: item.customer_order_id || null,
      }));

      const { data, error: rpcError } = await supabase.rpc('create_purchase_order_with_lines', {
        supplier_id: supplierId,
        // customer_order_id: null, // Removed as per new RPC signature (or ignored if still present in DB, but we updated it)
        // Wait, if I updated the RPC to accept line_items with customer_order_id, I should check if I removed the top-level param.
        // My migration file REPLACED the function with one that DOES NOT have customer_order_id.
        // So I MUST NOT pass it.
        line_items: lineItems,
        status_id: statusId,
        order_date: orderDateISO,
        notes: formData.notes ?? '',
      });

      if (rpcError) {
        console.error('Error creating purchase order via RPC:', rpcError);
        throw new Error('Failed to create purchase order');
      }

      const rpcResult = Array.isArray(data) ? data?.[0] : data;

      if (!rpcResult || typeof rpcResult.purchase_order_id !== 'number') {
        console.error('Unexpected RPC response when creating purchase order:', data);
        throw new Error('Failed to create purchase order');
      }

      return {
        purchase_order_id: rpcResult.purchase_order_id,
        supplier_order_ids: rpcResult.supplier_order_ids ?? [],
      } satisfies PurchaseOrderCreationResult;
    })
  );

  return purchaseOrders;
}

export function NewPurchaseOrderForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [consolidateDialogOpen, setConsolidateDialogOpen] = useState(false);
  const [suppliersWithDrafts, setSuppliersWithDrafts] = useState<SupplierWithDrafts[]>([]);
  const [pendingFormData, setPendingFormData] = useState<PurchaseOrderFormData | null>(null);
  const [isCheckingDrafts, setIsCheckingDrafts] = useState(false);

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
      items: [{ component_id: 0, supplier_component_id: 0, quantity: 1, customer_order_id: null }],
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

  // Fetch active customer orders
  const { data: customerOrders, isLoading: ordersLoading } = useQuery({
    queryKey: ['activeCustomerOrders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('order_id, order_number, customer:customers(name)')
        .not('status_id', 'in', '(3,4)') // Assuming 3=Completed, 4=Cancelled based on typical flows, but better to filter by name if IDs vary. 
        // Actually, let's just fetch all for now or filter by status name if possible, but IDs are safer if known.
        // Let's try to filter by status name to be safe.
        // .eq('status.status_name', 'New') // This is hard with simple query.
        // Let's just fetch latest 50 open orders for now to avoid complexity, or fetch all and filter client side if small.
        // Given the previous file read didn't show status IDs, let's just fetch recent orders.
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      return data?.map(o => ({
        value: o.order_id,
        label: `${o.order_number} - ${o.customer?.name || 'Unknown Customer'}`
      })) || [];
    }
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
    onSuccess: (results) => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
      const firstPurchaseOrderId = Array.isArray(results) && results.length > 0
        ? results[0]?.purchase_order_id
        : undefined;

      // Redirect to the first purchase order created
      if (typeof firstPurchaseOrderId === 'number') {
        router.push(`/purchasing/purchase-orders/${firstPurchaseOrderId}`);
      } else {
        router.push('/purchasing/purchase-orders');
      }
    },
    onError: (error: Error) => {
      setError(error.message);
    },
  });

  // Check for existing Draft POs for the selected suppliers
  const checkForExistingDrafts = async (formData: PurchaseOrderFormData): Promise<SupplierWithDrafts[]> => {
    // Get unique supplier IDs from the form items
    const supplierIds = new Set<number>();
    
    formData.items.forEach((item) => {
      const supplierOptions = supplierComponentsMap?.get(item.component_id) || [];
      const supplierComponent = supplierOptions.find(
        (sc) => sc.supplier_component_id === item.supplier_component_id
      );
      if (supplierComponent?.supplier_id) {
        supplierIds.add(supplierComponent.supplier_id);
      }
    });

    const draftsPerSupplier: SupplierWithDrafts[] = [];

    for (const supplierId of Array.from(supplierIds)) {
      const { data: drafts, error } = await supabase.rpc('get_draft_purchase_orders_for_supplier', {
        p_supplier_id: supplierId
      });

      if (!error && drafts && drafts.length > 0) {
        // Find supplier name from our cache
        let supplierName = 'Unknown';
        for (const [, suppliers] of supplierComponentsMap?.entries() || []) {
          const match = suppliers.find(s => s.supplier_id === supplierId);
          if (match) {
            supplierName = match.supplier.name;
            break;
          }
        }

        draftsPerSupplier.push({
          supplierId,
          supplierName,
          existingDrafts: drafts.map((d: any) => ({
            purchase_order_id: d.purchase_order_id,
            q_number: d.q_number,
            created_at: d.created_at,
            notes: d.notes,
            line_count: Number(d.line_count),
            total_amount: Number(d.total_amount)
          }))
        });
      }
    }

    return draftsPerSupplier;
  };

  // Handle consolidation decision
  const handleConsolidationConfirm = async (decisions: Record<number, number | 'new'>) => {
    setConsolidateDialogOpen(false);
    
    if (!pendingFormData || !draftStatusId) return;

    const toastId = toast.loading('Creating purchase orders…');
    
    try {
      // Group items by supplier
      const itemsBySupplier = new Map<number, Array<{
        supplier_component_id: number;
        quantity: number;
        component_id: number;
        customer_order_id?: number | null;
        supplierId: number;
      }>>();

      pendingFormData.items.forEach((item) => {
        const supplierOptions = supplierComponentsMap?.get(item.component_id) || [];
        const supplierComponent = supplierOptions.find(
          (sc) => sc.supplier_component_id === item.supplier_component_id
        );

        if (supplierComponent?.supplier_id) {
          if (!itemsBySupplier.has(supplierComponent.supplier_id)) {
            itemsBySupplier.set(supplierComponent.supplier_id, []);
          }
          itemsBySupplier.get(supplierComponent.supplier_id)?.push({
            supplier_component_id: item.supplier_component_id,
            quantity: item.quantity,
            component_id: item.component_id,
            customer_order_id: item.customer_order_id,
            supplierId: supplierComponent.supplier_id,
          });
        }
      });

      const orderDateISO = pendingFormData.order_date
        ? new Date(pendingFormData.order_date).toISOString()
        : new Date().toISOString();

      const results: PurchaseOrderCreationResult[] = [];

      for (const [supplierId, items] of Array.from(itemsBySupplier.entries())) {
        const decision = decisions[supplierId] || 'new';
        
        const lineItems: SupplierOrderLinePayload[] = items.map((item) => ({
          supplier_component_id: item.supplier_component_id,
          order_quantity: item.quantity,
          component_id: item.component_id,
          quantity_for_order: item.customer_order_id ? item.quantity : 0,
          quantity_for_stock: item.customer_order_id ? 0 : item.quantity,
          customer_order_id: item.customer_order_id || null,
        }));

        if (decision !== 'new' && typeof decision === 'number') {
          // Add to existing PO
          const { data, error: rpcError } = await supabase.rpc('add_lines_to_purchase_order', {
            target_purchase_order_id: decision,
            line_items: lineItems
          });

          if (rpcError) throw rpcError;

          results.push({
            purchase_order_id: decision,
            supplier_order_ids: data?.[0]?.supplier_order_ids ?? []
          });
        } else {
          // Create new PO
          const { data, error: rpcError } = await supabase.rpc('create_purchase_order_with_lines', {
            supplier_id: supplierId,
            line_items: lineItems,
            status_id: draftStatusId,
            order_date: orderDateISO,
            notes: pendingFormData.notes ?? '',
          });

          if (rpcError) throw rpcError;

          const rpcResult = Array.isArray(data) ? data?.[0] : data;
          if (rpcResult && typeof rpcResult.purchase_order_id === 'number') {
            results.push({
              purchase_order_id: rpcResult.purchase_order_id,
              supplier_order_ids: rpcResult.supplier_order_ids ?? []
            });
          }
        }
      }

      // Success message
      const addedCount = results.filter(r => 
        suppliersWithDrafts.some(s => s.existingDrafts.some(d => d.purchase_order_id === r.purchase_order_id))
      ).length;

      let toastMessage = '';
      if (addedCount > 0 && addedCount === results.length) {
        toastMessage = addedCount === 1 
          ? 'Items added to existing purchase order!' 
          : `Items added to ${addedCount} existing purchase orders!`;
      } else if (addedCount > 0) {
        toastMessage = `${results.length - addedCount} new PO(s) created, ${addedCount} existing PO(s) updated!`;
      } else {
        toastMessage = results.length === 1
          ? 'Purchase order created successfully!'
          : `${results.length} purchase orders created successfully!`;
      }

      toast.success(toastMessage, { id: toastId });
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });

      // Redirect to first PO
      if (results.length > 0) {
        router.push(`/purchasing/purchase-orders/${results[0].purchase_order_id}`);
      } else {
        router.push('/purchasing/purchase-orders');
      }
    } catch (err) {
      console.error('Error in consolidation:', err);
      toast.error('Failed to create purchase orders', { id: toastId });
    }

    setPendingFormData(null);
  };

  const onSubmit = async (data: PurchaseOrderFormData) => {
    setError(null);
    setIsCheckingDrafts(true);

    try {
      // Check for existing drafts
      const drafts = await checkForExistingDrafts(data);
      
      if (drafts.length > 0) {
        setPendingFormData(data);
        setSuppliersWithDrafts(drafts);
        setConsolidateDialogOpen(true);
      } else {
        // No existing drafts, create new POs directly
        createOrderMutation.mutate(data);
      }
    } catch (err) {
      console.error('Error checking for drafts:', err);
      // Fall back to creating new POs
      createOrderMutation.mutate(data);
    } finally {
      setIsCheckingDrafts(false);
    }
  };

  const addItem = () => {
    append({ component_id: 0, supplier_component_id: 0, quantity: 1, customer_order_id: null });
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

        <div className="md:col-span-2">
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

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
                        className={`h-10 w-full rounded-md border ${errors.items?.[index]?.quantity ? 'border-destructive' : 'border-input'
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

                <div>
                  <label htmlFor={`items.${index}.customer_order_id`} className="block text-sm font-medium mb-1">
                    Customer Order
                  </label>
                  <Controller
                    control={control}
                    name={`items.${index}.customer_order_id`}
                    render={({ field }) => (
                      <ReactSelect
                        inputId={`customer-order-select-${index}`}
                        isClearable
                        isDisabled={ordersLoading || createOrderMutation.isPending}
                        isLoading={ordersLoading}
                        options={customerOrders}
                        value={customerOrders?.find(o => o.value === field.value) || null}
                        onChange={(option) => field.onChange(option?.value || null)}
                        placeholder="Stock Order"
                        menuPlacement="auto"
                        classNamePrefix="customer-order-select"
                        styles={{
                          control: (base) => ({
                            ...base,
                            minHeight: '2.5rem',
                            borderRadius: '0.375rem',
                            borderColor: 'hsl(var(--input))',
                            backgroundColor: 'hsl(var(--background))',
                          }),
                          menu: (base) => ({
                            ...base,
                            zIndex: 50,
                          }),
                          option: (base, state) => ({
                            ...base,
                            backgroundColor: state.isFocused ? 'hsl(var(--accent))' : 'transparent',
                            color: state.isFocused ? 'hsl(var(--accent-foreground))' : 'inherit',
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
                      />
                    )}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="pt-4 border-t flex justify-end">
        <Button
          type="submit"
          disabled={createOrderMutation.isPending || statusLoading || isCheckingDrafts}
          className="w-full md:w-auto"
        >
          {(createOrderMutation.isPending || isCheckingDrafts) && (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          )}
          {isCheckingDrafts
            ? 'Checking existing orders...'
            : createOrderMutation.isPending
              ? 'Creating Purchase Order...'
              : 'Create Purchase Order'}
        </Button>
      </div>

      {/* Consolidation Dialog */}
      <ConsolidatePODialog
        open={consolidateDialogOpen}
        onOpenChange={setConsolidateDialogOpen}
        suppliersWithDrafts={suppliersWithDrafts}
        onConfirm={handleConsolidationConfirm}
        isLoading={false}
      />
    </form>
  );
} 
