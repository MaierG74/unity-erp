'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { AlertCircle, ArrowLeft, Loader2, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { sendPurchaseOrderEmail } from '@/lib/email';
import { useToast } from "@/components/ui/use-toast";

// Status badge component
function StatusBadge({ status, className }: { status: string; className?: string }) {
  let variant: 'default' | 'outline' | 'secondary' | 'destructive' | 'success' | 'warning' = 'default';
  
  switch (status.toLowerCase()) {  // Make case-insensitive
    case 'draft':
      variant = 'secondary';  // Gray
      break;
    case 'pending approval':
      variant = 'warning';    // Yellow/Orange
      break;
    case 'approved':
      variant = 'warning';    // Yellow/Orange (changed from success)
      break;
    case 'partially received':
      variant = 'warning';    // Yellow/Orange
      break;
    case 'fully received':
      variant = 'success';    // Green
      break;
    case 'cancelled':
      variant = 'destructive'; // Red
      break;
    default:
      variant = 'outline';    // Gray outline
  }
  
  return (
    <Badge 
      variant={variant} 
      className={cn(
        "text-xs font-medium",
        className
      )}
    >
      {status}
    </Badge>
  );
}

// Update the type for supplier component
interface SupplierComponent {
  supplier_component_id: number;
  price: number;
  component: {
    component_id: number;
    internal_code: string;
    description: string;
  };
  supplier: {
    supplier_id: number;
    name: string;
  };
}

interface Receipt {
  receipt_id: number;
  order_id: number;
  transaction_id: number;
  quantity_received: number;
  receipt_date: string;
}

interface SupplierOrder {
  order_id: number;
  order_quantity: number;
  total_received: number;
  supplier_component: {
    supplier_code: string;
    price: number;
    component: {
      internal_code: string;
      description: string;
    };
    supplier: {
      name: string;
    };
  };
  receipts?: Receipt[];
}

// Add new interfaces for receipt handling
interface ReceiptFormData {
  [key: string]: number;  // order_id -> quantity mapping
}

// Fetch purchase order by ID
async function fetchPurchaseOrderById(id: string) {
  const { data: purchaseOrder, error } = await supabase
    .from('purchase_orders')
    .select(`
      *,
      status:supplier_order_statuses!inner(
        status_id,
        status_name
      ),
      supplier_orders(
        order_id,
        order_quantity,
        total_received,
        supplier_component:suppliercomponents(
          supplier_code,
          price,
          component:components(
            internal_code,
            description
          ),
          supplier:suppliers(
            name
          )
        ),
        receipts:supplier_order_receipts(
          receipt_id,
          order_id,
          transaction_id,
          quantity_received,
          receipt_date
        )
      )
    `)
    .eq('purchase_order_id', id)
    .single();

  if (error) throw error;
  return purchaseOrder as PurchaseOrder;
}

// Update approvePurchaseOrder function to call the email API
async function approvePurchaseOrder(id: string, qNumber: string) {
  try {
    // 1. Get the approved status ID
    const { data: statusData, error: statusError } = await supabase
      .from('supplier_order_statuses')
      .select('status_id')
      .eq('status_name', 'Approved')
      .single();

    if (statusError || !statusData) {
      console.error('Error fetching approved status:', statusError);
      throw new Error('Could not find Approved status in the system');
    }

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      console.error('Error getting current user:', userError);
      throw new Error('Could not get current user');
    }
    
    // 2. Update the purchase order
    const { error: updateError } = await supabase
      .from('purchase_orders')
      .update({
        q_number: qNumber,
        status_id: statusData.status_id,
        approved_at: new Date().toISOString(),
        approved_by: user.id
      })
      .eq('purchase_order_id', id);
    
    if (updateError) {
      console.error('Error approving purchase order:', updateError);
      throw new Error(`Failed to update purchase order status: ${updateError.message}`);
    }

    // 3. Update all related supplier orders
    const { error: ordersUpdateError } = await supabase
      .from('supplier_orders')
      .update({
        status_id: statusData.status_id,
      })
      .eq('purchase_order_id', id);

    if (ordersUpdateError) {
      console.error('Error updating supplier orders:', ordersUpdateError);
      throw new Error('Failed to update supplier orders status');
    }
    
    // 4. Call the email API to send emails to suppliers
    try {
      const response = await fetch('/api/send-purchase-order-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ purchaseOrderId: id }),
      });
      
      if (!response.ok) {
        // Don't throw error, just log it - we don't want to fail the approval if email fails
        const errorData = await response.json();
        console.error('Error sending emails:', errorData);
      }
    } catch (emailError) {
      // Log the error but don't fail the approval process
      console.error('Error calling email API:', emailError);
    }

    return id;
  } catch (error) {
    console.error('Error in approvePurchaseOrder:', error);
    throw error;
  }
}

// Submit purchase order for approval
async function submitForApproval(id: string) {
  // 1. Get the pending approval status ID
  const { data: statusData, error: statusError } = await supabase
    .from('supplier_order_statuses')
    .select('status_id')
    .eq('status_name', 'Pending Approval')
    .single();
  
  if (statusError) {
    console.error('Error fetching pending approval status:', statusError);
    throw new Error('Failed to fetch pending approval status');
  }
  
  // 2. Update the purchase order
  const { error: updateError } = await supabase
    .from('purchase_orders')
    .update({
      status_id: statusData.status_id,
    })
    .eq('purchase_order_id', id);
  
  if (updateError) {
    console.error('Error submitting purchase order:', updateError);
    throw new Error('Failed to submit purchase order');
  }
  
  // 3. Update all related supplier orders
  const { error: ordersUpdateError } = await supabase
    .from('supplier_orders')
    .update({
      status_id: statusData.status_id,
    })
    .eq('purchase_order_id', id);
  
  if (ordersUpdateError) {
    console.error('Error updating supplier orders:', ordersUpdateError);
    throw new Error('Failed to update supplier orders');
  }
  
  return id;
}

// Validate Q number format
function validateQNumber(qNumber: string): boolean {
  // Format: Q23-001 (Q + 2-digit year + hyphen + 3-digit sequential number)
  const regex = /^Q\d{2}-\d{3}$/;
  return regex.test(qNumber);
}

// Add receipt function
async function receiveStock(purchaseOrderId: string, receipts: ReceiptFormData) {
  try {
    // Start a Supabase transaction
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw new Error('Could not get current user');

    for (const [orderId, quantityReceived] of Object.entries(receipts)) {
      if (quantityReceived <= 0) continue;

      // 1. Fetch supplier order details for validation and component lookup
      const { data: orderRow, error: orderFetchError } = await supabase
        .from('supplier_orders')
        .select('supplier_component_id, order_quantity, total_received')
        .eq('order_id', orderId)
        .single();

      if (orderFetchError || !orderRow?.supplier_component_id) {
        throw new Error(`Failed to get supplier order info: ${orderFetchError?.message || 'Order not found'}`);
      }

      // 1a. Validate quantity does not exceed remaining
      const remaining = Math.max((orderRow.order_quantity || 0) - (orderRow.total_received || 0), 0);
      if (quantityReceived > remaining) {
        throw new Error(`Quantity exceeds remaining to receive (remaining: ${remaining}) for order ${orderId}`);
      }

      // 2. Resolve component from supplier component
      const { data: componentData, error: componentError } = await supabase
        .from('suppliercomponents')
        .select('component_id')
        .eq('supplier_component_id', orderRow.supplier_component_id)
        .single();
      if (componentError || !componentData?.component_id) {
        throw new Error(`Failed to get component info: ${componentError?.message || 'Component not found'}`);
      }
      const componentId = componentData.component_id as number;

      // 3. Ensure PURCHASE transaction type exists and get its ID
      let purchaseTypeId: number | null = null;
      const { data: typeData, error: typeError } = await supabase
        .from('transaction_types')
        .select('transaction_type_id')
        .eq('type_name', 'PURCHASE')
        .single();
      if (typeError) {
        const { data: insertData, error: insertError } = await supabase
          .from('transaction_types')
          .insert({ type_name: 'PURCHASE' })
          .select('transaction_type_id')
          .single();
        if (insertError) {
          throw new Error(`Failed to ensure PURCHASE transaction type: ${insertError.message}`);
        }
        purchaseTypeId = insertData.transaction_type_id as number;
      } else {
        purchaseTypeId = typeData.transaction_type_id as number;
      }

      // 4. Create inventory transaction (omit order_id; it refers to sales orders)
      const { data: transactionData, error: transactionError } = await supabase
        .from('inventory_transactions')
        .insert({
          component_id: componentId,
          quantity: quantityReceived,
          transaction_type_id: purchaseTypeId,
          transaction_date: new Date().toISOString()
        })
        .select('transaction_id')
        .single();
      if (transactionError) {
        throw new Error(`Failed to create inventory transaction: ${transactionError.message}`);
      }

      // 5. Create receipt record
      const { error: receiptError } = await supabase
        .from('supplier_order_receipts')
        .insert({
          order_id: parseInt(orderId),
          transaction_id: transactionData.transaction_id,
          quantity_received: quantityReceived,
          receipt_date: new Date().toISOString()
        });
      if (receiptError) throw new Error(`Failed to create receipt record: ${receiptError.message}`);

      // 6. Update inventory on-hand table
      const { data: existingInventory, error: inventorySelectError } = await supabase
        .from('inventory')
        .select('inventory_id, quantity_on_hand')
        .eq('component_id', componentId)
        .single();
      if (inventorySelectError && (inventorySelectError as any).code !== 'PGRST116') {
        throw new Error(`Failed to check inventory: ${inventorySelectError.message}`);
      }
      if (existingInventory) {
        const newQty = (existingInventory.quantity_on_hand || 0) + quantityReceived;
        const { error: invUpdateError } = await supabase
          .from('inventory')
          .update({ quantity_on_hand: newQty })
          .eq('inventory_id', existingInventory.inventory_id);
        if (invUpdateError) throw new Error(`Failed to update inventory quantity: ${invUpdateError.message}`);
      } else {
        const { error: invInsertError } = await supabase
          .from('inventory')
          .insert({ component_id: componentId, quantity_on_hand: quantityReceived, location: null, reorder_level: 0 });
        if (invInsertError) throw new Error(`Failed to create inventory record: ${invInsertError.message}`);
      }

      // 7. Recompute total_received and status via existing RPC; fallback to manual if unavailable
      const { error: recomputeError } = await supabase.rpc('update_order_received_quantity', { order_id_param: parseInt(orderId) });
      if (recomputeError) {
        // Fallback: manual recompute (mirrors components/features/purchasing/order-detail.tsx)
        const { data: receiptsData, error: receiptsError } = await supabase
          .from('supplier_order_receipts')
          .select('quantity_received')
          .eq('order_id', parseInt(orderId));
        if (receiptsError) throw new Error(`Failed to fetch receipts: ${receiptsError.message}`);
        const totalReceived = (receiptsData || []).reduce((sum: number, r: any) => sum + (r.quantity_received || 0), 0);

        const { data: soData, error: soError } = await supabase
          .from('supplier_orders')
          .select('order_quantity, status_id')
          .eq('order_id', parseInt(orderId))
          .single();
        if (soError) throw new Error(`Failed to fetch order for status update: ${soError.message}`);

        const { data: statusRows, error: statusErr } = await supabase
          .from('supplier_order_statuses')
          .select('status_id, status_name');
        if (statusErr) throw new Error(`Failed to fetch status IDs: ${statusErr.message}`);
        const statusMap = (statusRows || []).reduce((m: Record<string, number>, s: any) => {
          m[s.status_name] = s.status_id; return m;
        }, {} as Record<string, number>);

        let newStatusId = soData.status_id;
        if (totalReceived >= (soData.order_quantity || 0)) newStatusId = statusMap['Completed'] ?? newStatusId;
        else if (totalReceived > 0) newStatusId = statusMap['Partially Delivered'] ?? newStatusId;

        const { error: manualUpdateError } = await supabase
          .from('supplier_orders')
          .update({ total_received: totalReceived, status_id: newStatusId })
          .eq('order_id', parseInt(orderId));
        if (manualUpdateError) throw new Error(`Failed to update order totals: ${manualUpdateError.message}`);
      }
    }

    return true;
  } catch (error) {
    console.error('Error in receiveStock:', error);
    throw error;
  }
}

function getOrderStatus(order: PurchaseOrder) {
  if (!order.supplier_orders?.length) return order.status?.status_name || 'Unknown';

  const allReceived = order.supplier_orders.every(
    so => so.order_quantity > 0 && so.total_received === so.order_quantity
  );
  
  const someReceived = order.supplier_orders.some(
    so => (so.total_received || 0) > 0 && so.total_received !== so.order_quantity
  );

  if (order.status?.status_name === 'Approved') {
    if (allReceived) return 'Fully Received';
    if (someReceived) return 'Partially Received';
  }

  return order.status?.status_name || 'Unknown';
}

export default function PurchaseOrderPage({ params }: { params: { id: string } }) {
  const [qNumber, setQNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [receiptQuantities, setReceiptQuantities] = useState<ReceiptFormData>({});
  const queryClient = useQueryClient();
  
  // Fetch purchase order data
  const { 
    data: purchaseOrder, 
    isLoading, 
    isError,
    error: queryError 
  } = useQuery({
    queryKey: ['purchaseOrder', params.id],
    queryFn: () => fetchPurchaseOrderById(params.id),
  });
  
  // Set initial Q number if available
  useEffect(() => {
    if (purchaseOrder?.q_number) {
      setQNumber(purchaseOrder.q_number);
    } else {
      // Generate a suggested Q number (e.g., Q + current year + sequential number)
      const year = new Date().getFullYear().toString().slice(2);
      setQNumber(`Q${year}-${params.id.padStart(3, '0')}`);
    }
  }, [purchaseOrder, params.id]);
  
  // Approve purchase order mutation
  const approveMutation = useMutation({
    mutationFn: (data: { qNumber: string }) =>
      approvePurchaseOrder(params.id, data.qNumber),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrder', params.id] });
      // Use alert instead of toast
      alert('Purchase Order approved! Email notifications have been sent to suppliers.');
    },
    onError: (error: Error) => {
      setError(error.message);
    },
  });
  
  // Submit for approval mutation
  const submitMutation = useMutation({
    mutationFn: () => submitForApproval(params.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrder', params.id] });
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
    },
    onError: (error: Error) => {
      setError(`Failed to submit purchase order: ${error.message}`);
    },
  });
  
  // Add receipt mutation
  const receiptMutation = useMutation({
    mutationFn: () => receiveStock(params.id, receiptQuantities),
    onSuccess: () => {
      // Invalidate all relevant queries to trigger updates
      queryClient.invalidateQueries({ queryKey: ['purchaseOrder', params.id] });
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'components'] });
      // Reset the receipt quantities
      setReceiptQuantities({});
      // Clear any errors
      setError(null);
    },
    onError: (error: Error) => {
      setError(`Failed to receive stock: ${error.message}`);
    },
  });
  
  // Handle submit for approval
  const handleSubmit = () => {
    setError(null);
    submitMutation.mutate();
  };
  
  // Handle approval with Q number validation
  const handleApprove = () => {
    if (!qNumber.trim()) {
      setError('Please enter a Q number');
      return;
    }

    if (!validateQNumber(qNumber)) {
      setError('Q number must be in the format Q23-001 (Q + year + hyphen + 3-digit number)');
      return;
    }
    
    setError(null);
    approveMutation.mutate({ qNumber });
  };
  
  // Handle receipt quantity change
  const handleReceiptQuantityChange = (orderId: string, quantity: string) => {
    setReceiptQuantities(prev => ({
      ...prev,
      [orderId]: parseInt(quantity) || 0
    }));
  };
  
  // Handle submit receipts
  const handleSubmitReceipts = () => {
    setError(null);
    receiptMutation.mutate();
  };
  
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="mt-2 text-muted-foreground">Loading purchase order...</p>
      </div>
    );
  }
  
  if (isError) {
    return (
      <div className="space-y-4">
        <div className="flex items-center">
          <Link href="/purchasing/purchase-orders" className="mr-4">
            <Button variant="outline" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">Purchase Order Not Found</h1>
        </div>
        
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {queryError instanceof Error ? queryError.message : 'Failed to load purchase order'}
          </AlertDescription>
        </Alert>
        
        <Link href="/purchasing/purchase-orders">
          <Button>Return to Purchase Orders</Button>
        </Link>
      </div>
    );
  }
  
  if (!purchaseOrder) {
    return notFound();
  }
  
  const isPendingApproval = purchaseOrder.status?.status_name === 'Pending Approval';
  const isDraft = purchaseOrder.status?.status_name === 'Draft';
  const isApproved = purchaseOrder.status?.status_name === 'Approved';
  
  // Calculate totals
  const totalItems = purchaseOrder.supplier_orders?.reduce((sum, order) => sum + order.order_quantity, 0) || 0;
  const totalAmount = purchaseOrder.supplier_orders?.reduce((sum, order) => {
    return sum + (order.supplier_component?.price || 0) * order.order_quantity;
  }, 0) || 0;
  
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center">
          <Link href="/purchasing/purchase-orders" className="mr-4">
            <Button variant="outline" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center">
              Purchase Order {purchaseOrder.q_number || `#${purchaseOrder.purchase_order_id}`}
              <StatusBadge status={getOrderStatus(purchaseOrder)} className="ml-3" />
            </h1>
            <p className="text-muted-foreground">
              Created on {format(new Date(purchaseOrder.created_at), 'PPP')}
            </p>
          </div>
        </div>
        
        {isDraft && (
          <Button 
            onClick={handleSubmit} 
            disabled={submitMutation.isPending}
            className="w-full sm:w-auto"
          >
            {submitMutation.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            Submit for Approval
          </Button>
        )}
        
        {isPendingApproval && (
          <Button 
            onClick={handleApprove} 
            disabled={approveMutation.isPending}
            className="w-full sm:w-auto"
          >
            {approveMutation.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            Approve Order
          </Button>
        )}
        
        {isApproved && (
          <div className="flex items-center text-green-600">
            <CheckCircle2 className="h-5 w-5 mr-2" />
            <span>
              Approved on {purchaseOrder.approved_at 
                ? format(new Date(purchaseOrder.approved_at), 'PPP') 
                : 'Unknown'}
            </span>
          </div>
        )}
      </div>
      
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Order Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isPendingApproval && (
              <div>
                <label htmlFor="qNumber" className="block text-sm font-medium mb-1">
                  Q Number *
                </label>
                <div className="flex flex-col gap-2">
                  <input
                    id="qNumber"
                    value={qNumber}
                    onChange={(e) => setQNumber(e.target.value)}
                    className="w-full max-w-[200px] px-3 py-2 border rounded-md"
                    placeholder="Q23-001"
                    disabled={approveMutation.isPending}
                    pattern="Q\d{2}-\d{3}"
                  />
                  <p className="text-xs text-muted-foreground">
                    Format: Q + year + hyphen + 3-digit number (e.g., Q23-001)
                  </p>
                </div>
              </div>
            )}
            
            <div>
              <p className="text-sm font-medium mb-1">Order Date</p>
              <p>{purchaseOrder.order_date 
                ? format(new Date(purchaseOrder.order_date), 'PPP') 
                : 'Not specified'}</p>
            </div>
            
            <div>
              <p className="text-sm font-medium mb-1">Status</p>
              <StatusBadge status={getOrderStatus(purchaseOrder)} />
            </div>
            
            <div>
              <p className="text-sm font-medium mb-1">Notes</p>
              <p className="whitespace-pre-wrap">{purchaseOrder.notes || 'No notes'}</p>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Order Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium mb-1">Total Items</p>
                <p className="text-xl font-bold">{totalItems}</p>
              </div>
              
              <div>
                <p className="text-sm font-medium mb-1">Total Amount</p>
                <p className="text-xl font-bold">R{totalAmount.toFixed(2)}</p>
              </div>
            </div>
            
            <div>
              <p className="text-sm font-medium mb-1">Suppliers</p>
              <div className="flex flex-wrap gap-2">
                {Array.from(new Set(purchaseOrder.supplier_orders?.map(
                  order => order.supplier_component?.supplier?.name
                ) || [])).map((supplier, i) => (
                  <Badge key={i} variant="outline">{supplier}</Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle>Order Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Component</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Ordered</TableHead>
                <TableHead className="text-right">Received</TableHead>
                {isApproved && <TableHead className="text-right">Receive Now</TableHead>}
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {purchaseOrder.supplier_orders?.map((order) => {
                const component = order.supplier_component?.component;
                const supplier = order.supplier_component?.supplier;
                const price = order.supplier_component?.price || 0;
                const total = price * order.order_quantity;
                const remainingToReceive = order.order_quantity - (order.total_received || 0);
                
                return (
                  <TableRow key={order.order_id}>
                    <TableCell className="font-medium">
                      {component?.internal_code || 'Unknown'}
                    </TableCell>
                    <TableCell>{component?.description || 'No description'}</TableCell>
                    <TableCell>{supplier?.name || 'Unknown'}</TableCell>
                    <TableCell className="text-right">R{price.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{order.order_quantity}</TableCell>
                    <TableCell className="text-right">{order.total_received || 0}</TableCell>
                    {isApproved && (
                      <TableCell className="text-right">
                        <input
                          type="number"
                          min="0"
                          max={remainingToReceive}
                          value={receiptQuantities[order.order_id] || ''}
                          onChange={(e) => handleReceiptQuantityChange(order.order_id.toString(), e.target.value)}
                          className="w-20 px-2 py-1 text-right border rounded"
                          placeholder="0"
                        />
                      </TableCell>
                    )}
                    <TableCell className="text-right font-medium">R{total.toFixed(2)}</TableCell>
                  </TableRow>
                );
              })}
              
              {(!purchaseOrder.supplier_orders || purchaseOrder.supplier_orders.length === 0) && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-4 text-muted-foreground">
                    No items in this purchase order
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {isApproved && (
            <div className="mt-4 flex justify-end">
              <Button
                onClick={handleSubmitReceipts}
                disabled={receiptMutation.isPending || Object.keys(receiptQuantities).length === 0}
              >
                {receiptMutation.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Receive Stock
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {purchaseOrder && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Receipt History</CardTitle>
            <CardDescription>
              Record of all received items for this purchase order
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {purchaseOrder.supplier_orders.map((order) => {
                if (!order.receipts || order.receipts.length === 0) return null;
                
                return (
                  <div key={order.order_id} className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold">
                          {order.supplier_component.component.internal_code}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {order.supplier_component.component.description}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">
                          Total Received: {order.total_received} of {order.order_quantity}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          From {order.supplier_component.supplier.name}
                        </p>
                      </div>
                    </div>
                    
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Receipt ID</TableHead>
                          <TableHead>Quantity</TableHead>
                          <TableHead>Date Received</TableHead>
                          <TableHead>Transaction ID</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {order.receipts.map((receipt) => (
                          <TableRow key={receipt.receipt_id}>
                            <TableCell>#{receipt.receipt_id}</TableCell>
                            <TableCell>{receipt.quantity_received}</TableCell>
                            <TableCell>
                              {format(new Date(receipt.receipt_date), 'MMM d, yyyy h:mm a')}
                            </TableCell>
                            <TableCell>#{receipt.transaction_id}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                );
              })}
              
              {purchaseOrder.supplier_orders.every(order => !order.receipts?.length) && (
                <div className="text-center py-4 text-muted-foreground">
                  No items have been received yet.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
} 
