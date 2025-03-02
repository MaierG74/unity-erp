'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
  SupplierOrderWithDetails, 
  SupplierOrderReceipt,
  ReceiveItemsFormValues 
} from '@/types/purchasing';

// Zod schema for form validation
const receiveItemsSchema = z.object({
  quantity_received: z.number({
    required_error: 'Quantity is required',
    invalid_type_error: 'Quantity must be a number',
  }).positive('Quantity must be positive'),
  receipt_date: z.string().optional(),
});

type OrderDetailProps = {
  orderId: number;
};

// Fetch order details function
async function fetchOrderDetails(orderId: number): Promise<SupplierOrderWithDetails> {
  console.log('Fetching order details for ID:', orderId);
  
  const { data, error } = await supabase
    .from('supplier_orders')
    .select(`
      *,
      status:supplier_order_statuses(status_id, status_name),
      supplierComponent:suppliercomponents(
        *,
        component:components(component_id, internal_code, description),
        supplier:suppliers(supplier_id, name)
      ),
      receipts:supplier_order_receipts(
        receipt_id,
        order_id,
        transaction_id,
        quantity_received,
        receipt_date
      )
    `)
    .eq('order_id', orderId)
    .single();

  if (error) {
    console.error('Error fetching order details:', error);
    throw new Error('Failed to fetch order details');
  }

  console.log('Order details:', data);
  return data as SupplierOrderWithDetails;
}

// Process receipt function - creates inventory transaction and receipt record
async function processReceipt(
  orderId: number, 
  componentId: number, 
  data: ReceiveItemsFormValues
): Promise<void> {
  // First, get or create the PURCHASE transaction type
  let purchaseTypeId: number;
  
  // Try to fetch the PURCHASE transaction type
  const { data: typeData, error: typeError } = await supabase
    .from('transaction_types')
    .select('transaction_type_id')
    .eq('type_name', 'PURCHASE')
    .single();
  
  if (typeError) {
    // If not found, create it
    if (typeError.code === 'PGRST116') { // No rows returned
      const { data: insertData, error: insertError } = await supabase
        .from('transaction_types')
        .insert({ type_name: 'PURCHASE' })
        .select('transaction_type_id')
        .single();
      
      if (insertError) {
        console.error('Error creating PURCHASE transaction type:', insertError);
        throw new Error('Failed to create PURCHASE transaction type');
      }
      
      purchaseTypeId = insertData.transaction_type_id;
    } else {
      console.error('Error fetching PURCHASE transaction type:', typeError);
      throw new Error('Failed to fetch PURCHASE transaction type');
    }
  } else {
    purchaseTypeId = typeData.transaction_type_id;
  }

  // Start a transaction - NOTE: We removed the order_id field here as it's for customer orders, not supplier orders
  const { data: transactionData, error: transactionError } = await supabase
    .from('inventory_transactions')
    .insert({
      component_id: componentId,
      quantity: data.quantity_received,
      transaction_type_id: purchaseTypeId,
      transaction_date: data.receipt_date || new Date().toISOString(),
      // Removed order_id: orderId because it expects a customer order ID, not a supplier order ID
    })
    .select('transaction_id')
    .single();

  if (transactionError) {
    console.error('Error creating inventory transaction:', transactionError);
    throw new Error('Failed to create inventory transaction');
  }

  // Create receipt record
  const { error: receiptError } = await supabase
    .from('supplier_order_receipts')
    .insert({
      order_id: orderId,
      transaction_id: transactionData.transaction_id,
      quantity_received: data.quantity_received,
      receipt_date: data.receipt_date || new Date().toISOString(),
    });

  if (receiptError) {
    console.error('Error creating receipt:', receiptError);
    throw new Error('Failed to create receipt');
  }

  // UPDATE INVENTORY QUANTITIES
  // First check if component exists in inventory
  const { data: existingInventory, error: inventoryError } = await supabase
    .from('inventory')
    .select('inventory_id, quantity_on_hand')
    .eq('component_id', componentId)
    .single();

  if (inventoryError && inventoryError.code !== 'PGRST116') {
    console.error('Error checking inventory:', inventoryError);
    throw new Error('Failed to update inventory');
  }

  // If component exists in inventory, update quantity
  if (existingInventory) {
    const newQuantity = (existingInventory.quantity_on_hand || 0) + data.quantity_received;
    
    const { error: updateError } = await supabase
      .from('inventory')
      .update({ quantity_on_hand: newQuantity })
      .eq('inventory_id', existingInventory.inventory_id);
    
    if (updateError) {
      console.error('Error updating inventory quantity:', updateError);
      throw new Error('Failed to update inventory quantity');
    }
    
    console.log(`Updated inventory for component ${componentId}, new quantity: ${newQuantity}`);
  } 
  // If component doesn't exist in inventory, create new record
  else {
    const { error: insertError } = await supabase
      .from('inventory')
      .insert({
        component_id: componentId,
        quantity_on_hand: data.quantity_received,
        location: null, // Can be updated later by user
        reorder_level: 0, // Default value, can be updated later
      });
    
    if (insertError) {
      console.error('Error creating inventory record:', insertError);
      throw new Error('Failed to create inventory record');
    }
    
    console.log(`Created new inventory record for component ${componentId} with quantity: ${data.quantity_received}`);
  }

  // Try to update using the RPC function
  const { error: updateError } = await supabase.rpc('update_order_received_quantity', { 
    order_id_param: orderId 
  });

  // If RPC function doesn't exist or fails, manually update the total_received
  if (updateError) {
    console.warn('RPC function failed, updating manually:', updateError);
    
    // Get current total from receipts
    const { data: receiptsData, error: receiptsError } = await supabase
      .from('supplier_order_receipts')
      .select('quantity_received')
      .eq('order_id', orderId);
    
    if (receiptsError) {
      console.error('Error fetching receipts:', receiptsError);
      throw new Error('Failed to update total received');
    }
    
    // Calculate new total
    const totalReceived = receiptsData.reduce((sum, receipt) => sum + receipt.quantity_received, 0);
    
    // Update the supplier order
    const { error: manualUpdateError } = await supabase
      .from('supplier_orders')
      .update({ total_received: totalReceived })
      .eq('order_id', orderId);
    
    if (manualUpdateError) {
      console.error('Error updating total received:', manualUpdateError);
      throw new Error('Failed to update total received');
    }
  }
}

// Status badge component
function StatusBadge({ status }: { status: string }) {
  let variant: 'default' | 'destructive' | 'outline' | 'secondary' | null = null;
  
  switch (status.toLowerCase()) {
    case 'open':
      variant = 'secondary';
      break;
    case 'in progress':
      variant = 'default';
      break;
    case 'completed':
      variant = 'outline';
      break;
    case 'cancelled':
      variant = 'destructive';
      break;
    default:
      variant = 'secondary';
  }
  
  return <Badge variant={variant}>{status}</Badge>;
}

export function OrderDetail({ orderId }: OrderDetailProps) {
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Fetch order details
  const { data: order, isLoading, error } = useQuery({
    queryKey: ['supplierOrder', orderId],
    queryFn: () => fetchOrderDetails(orderId),
  });

  // Form setup
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<ReceiveItemsFormValues>({
    resolver: zodResolver(receiveItemsSchema),
    defaultValues: {
      quantity_received: undefined,
      receipt_date: format(new Date(), 'yyyy-MM-dd'),
    },
  });

  // Process receipt mutation
  const receiptMutation = useMutation({
    mutationFn: (data: ReceiveItemsFormValues) => 
      processReceipt(orderId, order?.supplierComponent.component.component_id as number, data),
    onSuccess: () => {
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['supplierOrder', orderId] });
      // Also invalidate inventory queries to refresh inventory view
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      // Also invalidate the components query to refresh the component details
      queryClient.invalidateQueries({ queryKey: ['inventory', 'components'] });
      
      // Reset form
      reset({
        quantity_received: undefined,
        receipt_date: format(new Date(), 'yyyy-MM-dd'),
      });
      setSubmissionError(null);
    },
    onError: (error) => {
      setSubmissionError('Failed to process receipt. Please try again.');
      console.error('Mutation error:', error);
    },
  });

  // Handle form submission
  const onSubmit = (data: ReceiveItemsFormValues) => {
    setSubmissionError(null);
    receiptMutation.mutate(data);
  };

  // Calculate remaining quantity
  const remainingQuantity = order ? order.order_quantity - order.total_received : 0;
  const isOrderComplete = order && order.total_received >= order.order_quantity;

  // Format date function
  const formatDate = (dateString: string) => {
    return format(new Date(dateString), 'MMM d, yyyy');
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-12">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading order details...</span>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="p-6 bg-destructive/10 text-destructive rounded-md">
        Error loading order details. Please try again or contact support.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        {/* Order Details Card */}
        <Card>
          <CardHeader>
            <CardTitle>Order Details</CardTitle>
            <CardDescription>
              Information about this purchase order
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Supplier</h3>
                <p className="text-lg">{order.supplierComponent.supplier.name}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Status</h3>
                <div className="mt-1">
                  <StatusBadge status={order.status.status_name} />
                </div>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Component</h3>
                <p className="text-lg">{order.supplierComponent.component.internal_code}</p>
                <p className="text-sm text-muted-foreground">{order.supplierComponent.component.description}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Supplier Code</h3>
                <p className="text-lg">{order.supplierComponent.supplier_code}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Order Date</h3>
                <p className="text-lg">{formatDate(order.order_date)}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Order Quantity</h3>
                <p className="text-lg">{order.order_quantity}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Received</h3>
                <p className="text-lg">{order.total_received}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Remaining</h3>
                <p className="text-lg">{remainingQuantity}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Receipts Table */}
        <Card>
          <CardHeader>
            <CardTitle>Receipt History</CardTitle>
            <CardDescription>
              Record of all receipts for this order
            </CardDescription>
          </CardHeader>
          <CardContent>
            {order.receipts && order.receipts.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Receipt ID</TableHead>
                    <TableHead>Transaction ID</TableHead>
                    <TableHead>Quantity</TableHead>
                    <TableHead>Receipt Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.receipts.map((receipt) => (
                    <TableRow key={receipt.receipt_id}>
                      <TableCell className="font-medium">#{receipt.receipt_id}</TableCell>
                      <TableCell>#{receipt.transaction_id}</TableCell>
                      <TableCell>{receipt.quantity_received}</TableCell>
                      <TableCell>{formatDate(receipt.receipt_date)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-4 text-muted-foreground">
                No receipts have been recorded yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Receive Items Form */}
      <div>
        <Card>
          <CardHeader>
            <CardTitle>Receive Items</CardTitle>
            <CardDescription>
              Record a delivery for this purchase order
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isOrderComplete ? (
              <div className="p-4 bg-primary/10 rounded-md text-center">
                Order has been completely fulfilled.
              </div>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                {submissionError && (
                  <div className="p-4 bg-destructive/10 text-destructive rounded-md">
                    {submissionError}
                  </div>
                )}

                <div>
                  <label htmlFor="quantity_received" className="block text-sm font-medium mb-1">
                    Quantity Received
                  </label>
                  <input
                    type="number"
                    id="quantity_received"
                    className={`h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ${
                      errors.quantity_received ? 'border-destructive' : ''
                    }`}
                    min="1"
                    max={remainingQuantity}
                    disabled={receiptMutation.isPending}
                    {...register('quantity_received', {
                      setValueAs: (value) => (value === '' ? undefined : parseInt(value, 10)),
                    })}
                  />
                  {errors.quantity_received && (
                    <p className="mt-1 text-sm text-destructive">
                      {errors.quantity_received.message}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Maximum: {remainingQuantity} (remaining)
                  </p>
                </div>

                <div>
                  <label htmlFor="receipt_date" className="block text-sm font-medium mb-1">
                    Receipt Date
                  </label>
                  <input
                    type="date"
                    id="receipt_date"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    disabled={receiptMutation.isPending}
                    {...register('receipt_date')}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Defaults to today if not specified
                  </p>
                </div>

                <Button
                  type="submit"
                  className="w-full mt-4"
                  disabled={receiptMutation.isPending || remainingQuantity <= 0}
                >
                  {receiptMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    'Record Receipt'
                  )}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
} 