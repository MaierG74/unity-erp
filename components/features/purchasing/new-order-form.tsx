'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { NewSupplierOrderFormValues } from '@/types/purchasing';
import { SupplierComponent } from '@/types/suppliers';

// Zod schema for form validation
const formSchema = z.object({
  supplier_component_id: z.number({
    required_error: 'Supplier component is required',
    invalid_type_error: 'Please select a supplier component',
  }),
  order_quantity: z.number({
    required_error: 'Order quantity is required',
    invalid_type_error: 'Order quantity must be a number',
  }).positive('Order quantity must be positive'),
  order_date: z.string().optional(),
});

// Define a type for the joined supplier component data
type SupplierComponentWithDetails = SupplierComponent & {
  component: {
    internal_code: string;
    description: string;
  };
  supplier: {
    name: string;
  };
};

// Fetch the Open status ID
async function fetchOpenStatusId(): Promise<number> {
  console.log('Fetching Open status ID...');
  
  // First try to find the existing status
  const { data, error } = await supabase
    .from('supplier_order_statuses')
    .select('status_id')
    .eq('status_name', 'Open')
    .single();

  if (error) {
    console.error('Error fetching Open status:', error);
    
    // If not found, create it
    if (error.code === 'PGRST116') { // No rows returned
      console.log('Open status not found, creating it...');
      
      // Create the Open status
      const { data: insertData, error: insertError } = await supabase
        .from('supplier_order_statuses')
        .insert({ status_name: 'Open' })
        .select('status_id')
        .single();
      
      if (insertError) {
        console.error('Error creating Open status:', insertError);
        throw new Error('Failed to create Open status');
      }
      
      console.log('Created Open status with ID:', insertData.status_id);
      return insertData.status_id;
    }
    
    throw new Error('Failed to fetch Open status');
  }

  console.log('Found existing Open status with ID:', data.status_id);
  return data.status_id;
}

// Fetch supplier components
async function fetchSupplierComponents(): Promise<SupplierComponentWithDetails[]> {
  try {
    console.log('Fetching supplier components...');
    
    // Use the correct table name from the schema (without underscore)
    const { data, error } = await supabase
      .from('suppliercomponents')
      .select(`
        *,
        component:components(internal_code, description),
        supplier:suppliers(name)
      `)
      .order('supplier_id');

    if (error) {
      console.error('Error fetching supplier components:', error);
      throw new Error('Failed to fetch supplier components');
    }

    console.log('Supplier components data:', data);
    return data || [];
  } catch (e) {
    console.error('Exception fetching supplier components:', e);
    return [];
  }
}

// Create a new supplier order
async function createSupplierOrder(orderData: NewSupplierOrderFormValues & { statusId: number }): Promise<number> {
  const { data, error } = await supabase
    .from('supplier_orders')
    .insert({
      supplier_component_id: orderData.supplier_component_id,
      order_quantity: orderData.order_quantity,
      order_date: orderData.order_date || new Date().toISOString(),
      status_id: orderData.statusId, // Use the fetched status ID
      total_received: 0,
    })
    .select('order_id')
    .single();

  if (error) {
    console.error('Error creating supplier order:', error);
    throw new Error('Failed to create supplier order');
  }

  return data.order_id;
}

export function NewOrderForm() {
  const router = useRouter();
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  // Form setup with react-hook-form and zod
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<NewSupplierOrderFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      supplier_component_id: undefined,
      order_quantity: undefined,
      order_date: format(new Date(), 'yyyy-MM-dd'),
    },
  });

  // Fetch open status ID
  const { data: openStatusId, isLoading: isLoadingStatus, error: statusError } = useQuery({
    queryKey: ['openStatusId'],
    queryFn: fetchOpenStatusId,
  });

  // Fetch supplier components for select dropdown
  const { data: supplierComponents, isLoading: isLoadingComponents, error: componentsError } = useQuery({
    queryKey: ['supplierComponents'],
    queryFn: fetchSupplierComponents,
  });

  // Create order mutation
  const createOrderMutation = useMutation({
    mutationFn: (data: NewSupplierOrderFormValues) => {
      if (!openStatusId) {
        throw new Error('Status ID not available');
      }
      return createSupplierOrder({ ...data, statusId: openStatusId });
    },
    onSuccess: (orderId) => {
      // Redirect to the order detail page
      router.push(`/purchasing/${orderId}`);
    },
    onError: (error) => {
      setSubmissionError('Failed to create order. Please try again.');
      console.error('Mutation error:', error);
    },
  });

  // Handle form submission
  const onSubmit = (data: NewSupplierOrderFormValues) => {
    setSubmissionError(null);
    createOrderMutation.mutate(data);
  };

  // Show error if status fetching fails
  if (statusError) {
    return (
      <div className="p-4 bg-destructive/10 text-destructive rounded-md">
        Error setting up order statuses. Please contact support.
      </div>
    );
  }

  // Show error if components fetching fails
  if (componentsError) {
    return (
      <div className="p-4 bg-destructive/10 text-destructive rounded-md">
        Error loading supplier components. Please reload the page or contact support.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {submissionError && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-md">
          {submissionError}
        </div>
      )}

      {supplierComponents && Array.isArray(supplierComponents) && supplierComponents.length === 0 && (
        <div className="p-4 bg-yellow-100 text-yellow-800 rounded-md">
          No supplier components found. Please add supplier components before creating an order.
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label htmlFor="supplier_component_id" className="block text-sm font-medium mb-1">
            Supplier Component
          </label>
          <select
            id="supplier_component_id"
            className={`h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ${
              errors.supplier_component_id ? 'border-destructive' : ''
            }`}
            disabled={isLoadingComponents || isLoadingStatus || createOrderMutation.isPending}
            {...register('supplier_component_id', {
              setValueAs: (value) => (value === '' ? undefined : parseInt(value, 10)),
            })}
          >
            <option value="">Select a supplier component</option>
            {supplierComponents && Array.isArray(supplierComponents) ? supplierComponents.map((sc) => (
              <option key={sc.supplier_component_id} value={sc.supplier_component_id}>
                {sc.supplier.name} - {sc.component.internal_code} ({sc.component.description})
              </option>
            )) : (
              <option disabled value="">Loading supplier components...</option>
            )}
          </select>
          {errors.supplier_component_id && (
            <p className="mt-1 text-sm text-destructive">
              {errors.supplier_component_id.message}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="order_quantity" className="block text-sm font-medium mb-1">
            Order Quantity
          </label>
          <input
            type="number"
            id="order_quantity"
            className={`h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ${
              errors.order_quantity ? 'border-destructive' : ''
            }`}
            min="1"
            disabled={createOrderMutation.isPending || isLoadingStatus}
            {...register('order_quantity', {
              setValueAs: (value) => (value === '' ? undefined : parseInt(value, 10)),
            })}
          />
          {errors.order_quantity && (
            <p className="mt-1 text-sm text-destructive">
              {errors.order_quantity.message}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="order_date" className="block text-sm font-medium mb-1">
            Order Date (Optional)
          </label>
          <input
            type="date"
            id="order_date"
            className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            disabled={createOrderMutation.isPending || isLoadingStatus}
            {...register('order_date')}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Defaults to today if not specified
          </p>
        </div>
      </div>

      <div className="flex justify-end mt-6">
        <Button
          type="button"
          variant="outline"
          className="mr-2"
          onClick={() => {
            reset();
            router.push('/purchasing');
          }}
          disabled={createOrderMutation.isPending || isLoadingStatus}
        >
          Cancel
        </Button>
        <Button 
          type="submit" 
          disabled={createOrderMutation.isPending || isLoadingStatus || !openStatusId}
          className="flex items-center gap-2"
        >
          {(createOrderMutation.isPending || isLoadingStatus) && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          {isLoadingStatus ? 'Loading...' : 'Create Order'}
        </Button>
      </div>
    </form>
  );
} 