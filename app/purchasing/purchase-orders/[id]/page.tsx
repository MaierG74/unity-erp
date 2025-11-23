'use client';

import { use, useState, useEffect, useMemo, useLayoutEffect, useRef } from 'react';
import { useToast } from '@/components/ui/use-toast';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmailOverrideDialog, EmailRecipientRow, EmailOverride, EmailOption } from './EmailOverrideDialog';
import { ReceiveItemsModal } from './ReceiveItemsModal';
import { BulkReceiveModal } from './BulkReceiveModal';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, ArrowLeft, Loader2, CheckCircle2, Mail } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import styles from './page.module.css';
// import { sendPurchaseOrderEmail } from '@/lib/email'; // not used here; email is sent via API route

// Status badge component
function StatusBadge({ status, className }: { status: string; className?: string }) {
  let variant: 'default' | 'outline' | 'secondary' | 'destructive' | 'success' = 'default';

  switch (status.toLowerCase()) {  // Make case-insensitive
    case 'draft':
      variant = 'secondary';  // Gray
      break;
    case 'pending approval':
      variant = 'secondary';    // Gray
      break;
    case 'approved':
      variant = 'secondary';    // Gray
      break;
    case 'partially received':
      variant = 'secondary';    // Gray
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

interface Return {
  return_id: number;
  supplier_order_id: number;
  transaction_id: number;
  quantity_returned: number;
  return_date: string;
  reason: string;
  return_type: 'rejection' | 'later_return';
  receipt_id: number | null;
  notes: string | null;
}

interface SupplierOrder {
  order_id: number;
  order_quantity: number;
  total_received: number;
  supplier_component: {
    supplier_code: string;
    price: number;
    component: {
      component_id: number;
      internal_code: string;
      description: string;
    };
    supplier: {
      supplier_id: number;
      name: string;
      emails?: { email: string; is_primary: boolean }[];
    };
  };
  receipts?: Receipt[];
  returns?: Return[];
}

type SupplierOrderWithParent = SupplierOrder & {
  purchase_order: {
    purchase_order_id: number;
    q_number: string;
  };
};

// Add new interfaces for receipt handling
interface ReceiptFormData {
  [key: string]: number;  // order_id -> quantity mapping
}

// Interface for return form data
interface ReturnFormData {
  [key: string]: {
    quantity: number;
    reason: string;
    return_type: 'rejection' | 'later_return';
    notes?: string;
  };
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
            component_id,
            internal_code,
            description
          ),
          supplier:suppliers(
            supplier_id,
            name,
            emails:supplier_emails(email, is_primary)
          )
        ),
        receipts:supplier_order_receipts(
          receipt_id,
          order_id,
          transaction_id,
          quantity_received,
          receipt_date
        ),
        returns:supplier_order_returns(
          return_id,
          supplier_order_id,
          transaction_id,
          quantity_returned,
          return_date,
          reason,
          return_type,
          receipt_id,
          notes
        )
      )
    `)
    .eq('purchase_order_id', id)
    .single();

  if (error) throw error;
  return purchaseOrder as any;
}

// Type for purchase order with supplier orders
type PurchaseOrder = {
  purchase_order_id: number;
  q_number: string | null;
  order_date: string;
  status_id: number;
  notes: string | null;
  created_by: string | null;
  approved_by: string | null;
  created_at: string;
  approved_at: string | null;
  status: {
    status_id: number;
    status_name: string;
  };
  supplier_orders?: SupplierOrder[];
};

// Update approvePurchaseOrder function to call the email API
type EmailResult = { supplier: string; success: boolean; error?: string; messageId?: string };

async function approvePurchaseOrder(id: string, qNumber: string): Promise<{ id: string; emailResults?: EmailResult[]; emailError?: string }> {
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

      const handleOpenEmailDialog = () => { }

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        // Don't throw error, just log it - we don't want to fail the approval if email fails
        console.error('Error sending emails:', payload);
        return { id, emailError: payload?.error || 'Email dispatch failed' };
      }
      return { id, emailResults: payload?.results as EmailResult[] | undefined };
    } catch (emailError) {
      // Log the error but don't fail the approval process
      console.error('Error calling email API:', emailError);
      return { id, emailError: (emailError as Error).message };
    }
    // Fallback return if early path didn't return
    return { id };
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

      const receiptTimestamp = new Date().toISOString();

      // Try the transactional RPC first; fall back to manual inserts if it is unavailable
      const { error: rpcError } = await supabase.rpc('process_supplier_order_receipt', {
        p_order_id: parseInt(orderId),
        p_quantity: quantityReceived,
        p_receipt_date: receiptTimestamp,
      });

      if (!rpcError) {
        continue;
      }

      console.warn('process_supplier_order_receipt RPC failed, using manual fallback:', rpcError);

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
          transaction_date: receiptTimestamp
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
          receipt_date: receiptTimestamp
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
        if (totalReceived >= (soData.order_quantity || 0)) newStatusId = statusMap['Fully Received'] ?? newStatusId;
        else if (totalReceived > 0) newStatusId = statusMap['Partially Received'] ?? newStatusId;

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

// Add return function
async function returnStock(purchaseOrderId: string, returns: ReturnFormData) {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw new Error('Could not get current user');

    for (const [orderId, returnData] of Object.entries(returns)) {
      if (returnData.quantity <= 0) continue;
      if (!returnData.reason || returnData.reason.trim() === '') {
        throw new Error(`Reason is required for order ${orderId}`);
      }

      // Try the transactional RPC first
      const { error: rpcError } = await supabase.rpc('process_supplier_order_return', {
        p_supplier_order_id: parseInt(orderId),
        p_quantity: returnData.quantity,
        p_reason: returnData.reason.trim(),
        p_return_type: returnData.return_type || 'later_return',
        p_return_date: new Date().toISOString(),
        p_receipt_id: null, // Could be enhanced to link to specific receipt
        p_notes: returnData.notes || null,
      });

      if (rpcError) {
        throw new Error(`Failed to return stock for order ${orderId}: ${rpcError.message}`);
      }
    }

    return true;
  } catch (error) {
    console.error('Error in returnStock:', error);
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

export default function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  // Unwrap the params Promise (Next.js 15 requirement)
  const { id } = use(params);

  const [qNumber, setQNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [receiptQuantities, setReceiptQuantities] = useState<ReceiptFormData>({});
  const [returnQuantities, setReturnQuantities] = useState<ReturnFormData>({});
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailDialogLoading, setEmailDialogLoading] = useState(false);
  const [emailRows, setEmailRows] = useState<EmailRecipientRow[]>([]);
  const [receiveModalOpen, setReceiveModalOpen] = useState(false);
  const [bulkReceiveModalOpen, setBulkReceiveModalOpen] = useState(false);
  const [selectedOrderForReceive, setSelectedOrderForReceive] = useState<SupplierOrderWithParent | null>(null);
  const handleReceiveModalChange = (open: boolean) => {
    setReceiveModalOpen(open);
    if (!open) {
      setSelectedOrderForReceive(null);
    }
  };
  const headerRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const headerEl = headerRef.current;

    if (!headerEl) {
      return;
    }

    const updateOffset = () => {
      headerEl.style.setProperty('--po-header-offset', `${headerEl.offsetTop}px`);
    };

    updateOffset();
    window.addEventListener('resize', updateOffset);

    return () => {
      window.removeEventListener('resize', updateOffset);
      headerEl.style.removeProperty('--po-header-offset');
    };
  }, []);

  // Fetch purchase order data
  const {
    data: purchaseOrder,
    isLoading,
    isError,
    error: queryError
  } = useQuery({
    queryKey: ['purchaseOrder', id],
    queryFn: () => fetchPurchaseOrderById(id),
    refetchOnMount: true,
    staleTime: 0, // Always consider data stale so it refetches when invalidated
  });

  useEffect(() => {
    const headerEl = headerRef.current;

    if (!headerEl) {
      return;
    }

    headerEl.style.setProperty('--po-header-offset', `${headerEl.offsetTop}px`);
  }, [purchaseOrder]);

  // Set initial Q number if available
  useEffect(() => {
    if (purchaseOrder?.q_number) {
      setQNumber(purchaseOrder.q_number);
    } else {
      // Generate a suggested Q number (e.g., Q + current year + sequential number)
      const year = new Date().getFullYear().toString().slice(2);
      setQNumber(`Q${year}-${id.padStart(3, '0')}`);
    }
  }, [purchaseOrder, id]);

  const baseEmailRows = useMemo<EmailRecipientRow[]>(() => {
    if (!purchaseOrder?.supplier_orders?.length) return [];
    const rows = new Map<number, EmailRecipientRow>();
    for (const order of purchaseOrder.supplier_orders) {
      const rawSupplier = order.supplier_component?.supplier as any;
      const supplierRecord = Array.isArray(rawSupplier) ? rawSupplier[0] : rawSupplier;
      if (!supplierRecord?.supplier_id || !supplierRecord?.name) continue;
      if (rows.has(supplierRecord.supplier_id)) continue;

      const uniqueEmailMap = new Map<string, EmailOption>();
      (Array.isArray(supplierRecord.emails) ? supplierRecord.emails : []).forEach((email: any) => {
        if (email?.email) {
          uniqueEmailMap.set(email.email, { email: email.email, is_primary: !!email.is_primary });
        }
      });

      const options = Array.from(uniqueEmailMap.values()).sort(
        (a, b) => Number(b.is_primary) - Number(a.is_primary)
      );

      rows.set(supplierRecord.supplier_id, {
        supplierId: supplierRecord.supplier_id,
        supplierName: supplierRecord.name,
        options,
        selectedEmail: options[0]?.email ?? '',
      });
    }
    return Array.from(rows.values());
  }, [purchaseOrder]);

  const handleOpenEmailDialog = () => {
    if (!baseEmailRows.length) {
      toast({
        title: 'No suppliers found',
        description: 'Add supplier components with email contacts before sending.',
      });
      return;
    }
    const clonedRows = baseEmailRows.map((row) => ({
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      options: [...row.options],
      selectedEmail: row.selectedEmail,
    }));
    setEmailRows(clonedRows);
    setEmailDialogOpen(true);
  };

  const handleSendEmails = (payload: { overrides: EmailOverride[]; cc: string[] }) => {
    setEmailDialogLoading(true);
    sendEmailMutation.mutate(payload, {
      onSuccess: () => {
        setEmailDialogOpen(false);
      },
      onSettled: () => {
        setEmailDialogLoading(false);
      },
    });
  };

  const handleOpenReceiveModal = (order: SupplierOrder) => {
    if (!purchaseOrder) return;
    setSelectedOrderForReceive({
      ...order,
      purchase_order: {
        purchase_order_id: purchaseOrder.purchase_order_id,
        q_number: purchaseOrder.q_number || '',
      },
    });
    setReceiveModalOpen(true);
  };

  // Approve purchase order mutation
  const approveMutation = useMutation({
    mutationFn: (data: { qNumber: string }) =>
      approvePurchaseOrder(id, data.qNumber),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrder', id] });
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['all-purchase-orders'] });
      const successes = result?.emailResults?.filter(r => r.success).length ?? 0;
      const failures = result?.emailResults?.filter(r => !r.success).length ?? 0;
      if (failures > 0) {
        const failedSuppliers = result?.emailResults
          ?.filter((r) => !r.success && r.supplier)
          .map((r) => r.supplier)
          .join(', ');
        toast({
          title: '✅ Purchase Order Approved',
          description: `⚠️ Emails: ${successes} sent successfully, ${failures} failed (${failedSuppliers}). Please resend or contact suppliers manually.`,
          variant: 'default',
          duration: 8000,
        });
      } else if (successes > 0) {
        toast({
          title: '✅ Purchase Order Approved & Emails Sent',
          description: `Successfully emailed to ${successes} supplier${successes === 1 ? '' : 's'}.`,
          duration: 5000,
        });
      } else if (result?.emailError) {
        toast({
          title: '✅ Purchase Order Approved',
          description: `⚠️ Email error: ${result.emailError}. Please send emails manually using "Send Supplier Emails" button.`,
          variant: 'default',
          duration: 8000,
        });
      } else {
        toast({
          title: '✅ Purchase Order Approved',
          description: 'Order approved. No email status available.',
          duration: 5000,
        });
      }
    },
    onError: (error: Error) => {
      setError(error.message);
    },
  });

  // Submit for approval mutation
  const submitMutation = useMutation({
    mutationFn: () => submitForApproval(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrder', id] });
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
    },
    onError: (error: Error) => {
      setError(`Failed to submit purchase order: ${error.message}`);
    },
  });

  // Add receipt mutation
  const receiptMutation = useMutation({
    mutationFn: () => receiveStock(id, receiptQuantities),
    onSuccess: async () => {
      // Invalidate all relevant queries first
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['purchaseOrder', id] }),
        queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] }),
        queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }),
        queryClient.invalidateQueries({ queryKey: ['all-purchase-orders'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory', 'components'] }),
      ]);
      // Force immediate refetch of the current purchase order - this is critical for the page to update
      await queryClient.refetchQueries({
        queryKey: ['purchaseOrder', id],
        type: 'active' // Only refetch active queries
      });
      // Also refetch list queries if they're active
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['purchaseOrders'], type: 'active' }),
        queryClient.refetchQueries({ queryKey: ['purchase-orders'], type: 'active' }),
      ]);
      // Reset the receipt quantities
      setReceiptQuantities({});
      // Clear any errors
      setError(null);
    },
    onError: (error: Error) => {
      setError(`Failed to receive stock: ${error.message}`);
    },
  });

  // Inline per-row receipt mutation
  const receiveOneMutation = useMutation({
    mutationFn: (payload: { orderId: string; qty: number }) =>
      receiveStock(id, { [payload.orderId]: payload.qty }),
    onSuccess: async () => {
      // Invalidate all relevant queries first
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['purchaseOrder', id] }),
        queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] }),
        queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }),
        queryClient.invalidateQueries({ queryKey: ['all-purchase-orders'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory', 'components'] }),
      ]);
      // Force immediate refetch of the current purchase order - this is critical for the page to update
      await queryClient.refetchQueries({
        queryKey: ['purchaseOrder', id],
        type: 'active' // Only refetch active queries
      });
      // Also refetch list queries if they're active
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['purchaseOrders'], type: 'active' }),
        queryClient.refetchQueries({ queryKey: ['purchase-orders'], type: 'active' }),
      ]);
      // Clear the receipt quantity for this specific order
      setReceiptQuantities(prev => {
        const updated = { ...prev };
        const orderIdToClear = Object.keys(prev).find(key => prev[key] > 0);
        if (orderIdToClear) {
          delete updated[orderIdToClear];
        }
        return updated;
      });
      setError(null);
    },
    onError: (error: Error) => {
      setError(`Failed to receive stock: ${error.message}`);
    },
  });

  // Return mutation
  const returnMutation = useMutation({
    mutationFn: () => returnStock(id, returnQuantities),
    onSuccess: async () => {
      // Invalidate all relevant queries first
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['purchaseOrder', id] }),
        queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] }),
        queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }),
        queryClient.invalidateQueries({ queryKey: ['all-purchase-orders'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory', 'components'] }),
      ]);
      // Force immediate refetch of the current purchase order
      await queryClient.refetchQueries({
        queryKey: ['purchaseOrder', id],
        type: 'active'
      });
      // Also refetch list queries if they're active
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['purchaseOrders'], type: 'active' }),
        queryClient.refetchQueries({ queryKey: ['purchase-orders'], type: 'active' }),
      ]);
      // Reset the return quantities
      setReturnQuantities({});
      // Clear any errors
      setError(null);
      toast({
        title: 'Stock returned successfully',
        description: 'Return has been processed and inventory updated.',
      });
    },
    onError: (error: Error) => {
      setError(`Failed to return stock: ${error.message}`);
      toast({
        title: 'Failed to return stock',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const sendEmailMutation = useMutation<EmailResult[] | undefined, Error, { overrides?: { supplierId: number; email: string }[]; cc?: string[] } | undefined>({
    mutationFn: async (payload) => {
      const response = await fetch('/api/send-purchase-order-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchaseOrderId: id,
          overrides: payload?.overrides,
          cc: payload?.cc,
        })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(json?.error || 'Failed to send purchase order emails');
      }
      return json?.results as EmailResult[] | undefined;
    },
    onSuccess: (results) => {
      const successes = results?.filter((r) => r.success).length ?? 0;
      const failures = results?.filter((r) => !r.success).length ?? 0;
      if (failures > 0) {
        const failedSuppliers = results
          ?.filter((r) => !r.success && r.supplier)
          .map((r) => r.supplier)
          .join(', ');
        const failedErrors = results
          ?.filter((r) => !r.success && r.error)
          .map((r) => r.error)
          .join('; ');
        toast({
          title: '⚠️ Emails Partially Sent',
          description: `Successfully sent: ${successes} | Failed: ${failures} (${failedSuppliers})${failedErrors ? `\nError: ${failedErrors}` : ''}`,
          variant: 'destructive',
          duration: 8000,
        });
      } else if (successes > 0) {
        toast({
          title: '✅ Emails Sent Successfully',
          description: `Purchase order emailed to ${successes} supplier${successes === 1 ? '' : 's'}.`,
          duration: 5000,
        });
      } else {
        toast({
          title: 'ℹ️ No Emails Sent',
          description: 'Request completed but no emails were dispatched. Check supplier email configuration.',
          variant: 'destructive',
          duration: 6000,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: '❌ Failed to Send Emails',
        description: `Error: ${error.message}`,
        variant: 'destructive',
        duration: 8000,
      });
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

  // Handle return quantity change
  const handleReturnQuantityChange = (orderId: string, quantity: string) => {
    setReturnQuantities(prev => ({
      ...prev,
      [orderId]: {
        ...prev[orderId],
        quantity: parseInt(quantity) || 0,
        reason: prev[orderId]?.reason || '',
        return_type: prev[orderId]?.return_type || 'later_return',
        notes: prev[orderId]?.notes || '',
      }
    }));
  };

  // Handle return reason change
  const handleReturnReasonChange = (orderId: string, reason: string) => {
    setReturnQuantities(prev => ({
      ...prev,
      [orderId]: {
        ...prev[orderId],
        quantity: prev[orderId]?.quantity || 0,
        reason,
        return_type: prev[orderId]?.return_type || 'later_return',
        notes: prev[orderId]?.notes || '',
      }
    }));
  };

  // Handle return type change
  const handleReturnTypeChange = (orderId: string, returnType: 'rejection' | 'later_return') => {
    setReturnQuantities(prev => ({
      ...prev,
      [orderId]: {
        ...prev[orderId],
        quantity: prev[orderId]?.quantity || 0,
        reason: prev[orderId]?.reason || '',
        return_type: returnType,
        notes: prev[orderId]?.notes || '',
      }
    }));
  };

  // Handle submit returns
  const handleSubmitReturns = () => {
    // Validate that all returns have reasons
    const invalidReturns = Object.entries(returnQuantities).filter(
      ([_, data]) => data.quantity > 0 && (!data.reason || data.reason.trim() === '')
    );

    if (invalidReturns.length > 0) {
      setError('Please provide a reason for all returns');
      return;
    }

    // Validate quantities don't exceed received
    for (const [orderId, returnData] of Object.entries(returnQuantities)) {
      if (returnData.quantity <= 0) continue;
      const order = purchaseOrder?.supplier_orders?.find(o => o.order_id.toString() === orderId);
      if (order && returnData.quantity > (order.total_received || 0)) {
        setError(`Return quantity exceeds received quantity for ${order.supplier_component?.component?.internal_code || 'component'}`);
        return;
      }
    }

    setError(null);
    returnMutation.mutate();
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
  const totalReceived = purchaseOrder.supplier_orders?.reduce((sum, order) => {
    return sum + (order.total_received || 0);
  }, 0) || 0;

  return (
    <div className="space-y-6">
      {/* Sticky header - sticks right below navbar with no gap */}
      <div className={cn(
        "sticky top-16 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b shadow-sm py-3 px-4 md:px-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4",
        styles.stickyHeader
      )} ref={headerRef}>
        <div className="flex items-center">
          <Link href="/purchasing/purchase-orders" className="mr-4">
            <Button variant="outline" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="text-xs sm:text-sm text-muted-foreground">Purchasing / Purchase Orders</div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
                {purchaseOrder.q_number || `PO #${purchaseOrder.purchase_order_id}`}
              </h1>
              <StatusBadge status={getOrderStatus(purchaseOrder)} />
              <span className="text-muted-foreground">•</span>
              <span className="text-sm font-medium text-muted-foreground">
                {Array.from(new Set(
                  purchaseOrder.supplier_orders?.map(o => o.supplier_component?.supplier?.name).filter(Boolean) || []
                )).join(', ') || 'Supplier'}
              </span>
            </div>
            <p className="text-muted-foreground text-sm">Created {format(new Date(purchaseOrder.created_at), 'PPP')}</p>
          </div>
        </div>
        {/* Actions are shown in the bottom action bar */}
        <div className="hidden sm:block" />
      </div>

      {/* Content area with padding */}
      <div className={cn("space-y-6", styles.contentWrapper)}>
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Order Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">

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
              <CardTitle>Supplier Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm font-medium mb-1">Suppliers</p>
                <div className="flex flex-wrap gap-2">
                  {Array.from(new Set(purchaseOrder.supplier_orders?.map(
                    order => order.supplier_component?.supplier?.name
                  ) || [])).map((supplier, i) => (
                    <Badge key={i} variant="outline">{String(supplier)}</Badge>
                  ))}
                </div>
              </div>
              {isApproved && (
                <div className="text-sm text-muted-foreground">
                  Approved on {purchaseOrder.approved_at ? format(new Date(purchaseOrder.approved_at), 'PPP') : 'Unknown'}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Summary card moved above; removing duplicate compact bar */}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xl font-bold">Order Items</CardTitle>
            {isApproved && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setBulkReceiveModalOpen(true)}
                  disabled={!purchaseOrder.supplier_orders?.some(o => (o.order_quantity - (o.total_received || 0)) > 0)}
                >
                  Bulk Receive
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleOpenEmailDialog}
                >
                  <Mail className="h-4 w-4 mr-2" />
                  Send Supplier Emails
                </Button>
              </div>
            )}
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
                  <TableHead className="text-right">Owing</TableHead>
                  {isApproved && <TableHead className="text-right">Receive Now</TableHead>}
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchaseOrder.supplier_orders && purchaseOrder.supplier_orders.length > 0 ? (
                  <>
                    {purchaseOrder.supplier_orders.map((order) => {
                      const component = order.supplier_component?.component;
                      const supplier = order.supplier_component?.supplier;
                      const price = order.supplier_component?.price || 0;
                      const lineTotal = price * order.order_quantity;
                      const remainingToReceive = Math.max(0, order.order_quantity - (order.total_received || 0));

                      return (
                        <TableRow key={order.order_id} className="odd:bg-muted/30">
                          <TableCell className="font-medium">{component?.internal_code || 'Unknown'}</TableCell>
                          <TableCell>{component?.description || 'No description'}</TableCell>
                          <TableCell>{supplier?.name || 'Unknown'}</TableCell>
                          <TableCell className="text-right">R{price.toFixed(2)}</TableCell>
                          <TableCell className="text-right">{order.order_quantity}</TableCell>
                          <TableCell className="text-right">{order.total_received || 0}</TableCell>
                          <TableCell className="text-right">
                            <span className={remainingToReceive > 0 ? 'font-medium text-orange-600' : 'text-muted-foreground'}>
                              {remainingToReceive}
                            </span>
                          </TableCell>
                          {isApproved && (
                            <TableCell className="text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleOpenReceiveModal(order)}
                                disabled={remainingToReceive <= 0}
                              >
                                Receive
                              </Button>
                            </TableCell>
                          )}
                          <TableCell className="text-right font-medium">R{lineTotal.toFixed(2)}</TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="bg-muted/30">
                      <TableCell colSpan={4} className="text-right text-sm font-medium text-muted-foreground">Totals</TableCell>
                      <TableCell className="text-right text-sm font-medium">{totalItems}</TableCell>
                      <TableCell className="text-right text-sm font-medium">{totalReceived}</TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        <span className="font-medium text-orange-600">
                          {Math.max(0, totalItems - totalReceived)}
                        </span>
                      </TableCell>
                      {isApproved && <TableCell />}
                      <TableCell className="text-right font-semibold">R{totalAmount.toFixed(2)}</TableCell>
                    </TableRow>
                  </>
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={isApproved ? 9 : 8}
                      className="text-center py-6 text-muted-foreground"
                    >
                      No items in this purchase order
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

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
                            {order.supplier_component?.component?.internal_code || 'Unknown'}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            {order.supplier_component?.component?.description || 'No description'}
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
                                {new Date(receipt.receipt_date).toLocaleString('en-ZA', {
                                  timeZone: 'Africa/Johannesburg',
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                  hour: 'numeric',
                                  minute: '2-digit',
                                  hour12: true
                                })}
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
                  <Card className="bg-muted/40">
                    <CardContent className="py-10 text-center">
                      <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-3">📦</div>
                      <div className="font-medium">No receipts yet</div>
                      <div className="text-sm text-muted-foreground">Use the Receive controls in the items table to record deliveries.</div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Return Goods Section */}
        {purchaseOrder && isApproved && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Return Goods</CardTitle>
              <CardDescription>
                Return goods to suppliers. Select components and quantities to return.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {purchaseOrder.supplier_orders && purchaseOrder.supplier_orders.length > 0 ? (
                  <>
                    {purchaseOrder.supplier_orders
                      .filter(order => (order.total_received || 0) > 0)
                      .map((order) => {
                        const component = order.supplier_component?.component;
                        const maxReturnable = order.total_received || 0;
                        const returnData = returnQuantities[order.order_id.toString()] || {
                          quantity: 0,
                          reason: '',
                          return_type: 'later_return' as const,
                          notes: '',
                        };

                        return (
                          <div key={order.order_id} className="border rounded-lg p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <div>
                                <h3 className="font-medium">{component?.internal_code || 'Unknown'}</h3>
                                <p className="text-sm text-muted-foreground">{component?.description || 'No description'}</p>
                                <p className="text-sm text-muted-foreground">
                                  Received: {order.total_received} / Ordered: {order.order_quantity}
                                </p>
                              </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <label className="text-sm font-medium mb-1 block">Quantity to Return</label>
                                <input
                                  type="number"
                                  min="0"
                                  max={maxReturnable}
                                  value={returnData.quantity || ''}
                                  onChange={(e) => handleReturnQuantityChange(order.order_id.toString(), e.target.value)}
                                  className="w-full px-3 py-2 border rounded-md"
                                  placeholder="0"
                                />
                                <p className="text-xs text-muted-foreground mt-1">
                                  Max: {maxReturnable}
                                </p>
                              </div>
                              <div>
                                <label className="text-sm font-medium mb-1 block">Return Type</label>
                                <select
                                  value={returnData.return_type}
                                  onChange={(e) => handleReturnTypeChange(order.order_id.toString(), e.target.value as 'rejection' | 'later_return')}
                                  className="w-full px-3 py-2 border rounded-md"
                                >
                                  <option value="later_return">Later Return</option>
                                  <option value="rejection">Rejection on Delivery</option>
                                </select>
                              </div>
                              <div className="md:col-span-2">
                                <label className="text-sm font-medium mb-1 block">Reason <span className="text-red-500">*</span></label>
                                <select
                                  value={returnData.reason}
                                  onChange={(e) => handleReturnReasonChange(order.order_id.toString(), e.target.value)}
                                  className="w-full px-3 py-2 border rounded-md"
                                  required
                                >
                                  <option value="">Select a reason</option>
                                  <option value="Damage">Damage</option>
                                  <option value="Wrong Item">Wrong Item</option>
                                  <option value="Quality Issue">Quality Issue</option>
                                  <option value="Over-supplied">Over-supplied</option>
                                  <option value="Customer Cancellation">Customer Cancellation</option>
                                  <option value="Defective">Defective</option>
                                  <option value="Other">Other</option>
                                </select>
                              </div>
                              {returnData.reason === 'Other' && (
                                <div className="md:col-span-2">
                                  <label className="text-sm font-medium mb-1 block">Additional Notes</label>
                                  <textarea
                                    value={returnData.notes || ''}
                                    onChange={(e) => {
                                      setReturnQuantities(prev => ({
                                        ...prev,
                                        [order.order_id.toString()]: {
                                          ...prev[order.order_id.toString()],
                                          notes: e.target.value,
                                        }
                                      }));
                                    }}
                                    className="w-full px-3 py-2 border rounded-md"
                                    rows={2}
                                    placeholder="Provide additional details..."
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    {purchaseOrder.supplier_orders.filter(order => (order.total_received || 0) > 0).length === 0 && (
                      <div className="text-center py-8 text-muted-foreground">
                        No items have been received yet. Receive stock before returning.
                      </div>
                    )}
                    {purchaseOrder.supplier_orders.filter(order => (order.total_received || 0) > 0).length > 0 && (
                      <div className="flex justify-end pt-4">
                        <Button
                          onClick={handleSubmitReturns}
                          disabled={returnMutation.isPending || Object.keys(returnQuantities).length === 0 ||
                            !Object.values(returnQuantities).some(r => r.quantity > 0)}
                          variant="destructive"
                        >
                          {returnMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          Return Goods
                        </Button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    No items in this purchase order
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Return History Section */}
        {purchaseOrder && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Return History</CardTitle>
              <CardDescription>
                Record of all returned items for this purchase order
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {purchaseOrder.supplier_orders.map((order) => {
                  if (!order.returns || order.returns.length === 0) return null;

                  return (
                    <div key={order.order_id} className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-lg font-semibold">
                            {order.supplier_component?.component?.internal_code || 'Unknown'}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            {order.supplier_component?.component?.description || 'No description'}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium">
                            Total Returned: {order.returns.reduce((sum, r) => sum + r.quantity_returned, 0)}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            From {order.supplier_component.supplier.name}
                          </p>
                        </div>
                      </div>

                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Return ID</TableHead>
                            <TableHead>Quantity</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Reason</TableHead>
                            <TableHead>Date Returned</TableHead>
                            <TableHead>Transaction ID</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {order.returns.map((returnItem) => (
                            <TableRow key={returnItem.return_id}>
                              <TableCell>#{returnItem.return_id}</TableCell>
                              <TableCell>{returnItem.quantity_returned}</TableCell>
                              <TableCell>
                                <Badge variant={returnItem.return_type === 'rejection' ? 'destructive' : 'outline'}>
                                  {returnItem.return_type === 'rejection' ? 'Rejection' : 'Later Return'}
                                </Badge>
                              </TableCell>
                              <TableCell>{returnItem.reason}</TableCell>
                              <TableCell>
                                {new Date(returnItem.return_date).toLocaleString('en-ZA', {
                                  timeZone: 'Africa/Johannesburg',
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                  hour: 'numeric',
                                  minute: '2-digit',
                                  hour12: true
                                })}
                              </TableCell>
                              <TableCell>#{returnItem.transaction_id}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  );
                })}

                {purchaseOrder.supplier_orders.every(order => !order.returns?.length) && (
                  <Card className="bg-muted/40">
                    <CardContent className="py-10 text-center">
                      <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-3">↩️</div>
                      <div className="font-medium">No returns yet</div>
                      <div className="text-sm text-muted-foreground">Use the Return Goods section above to record returns.</div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </CardContent>
          </Card>
        )}
        {/* Bottom action bar */}
        <div className="sticky bottom-0 z-30 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t shadow-sm px-4 py-3 flex items-center justify-end gap-3">
          {isDraft && (
            <Button onClick={handleSubmit} disabled={submitMutation.isPending}>
              {submitMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Submit for Approval
            </Button>
          )}
          {isPendingApproval && (
            <div className="flex items-center gap-2">
              <input
                id="qNumber"
                value={qNumber}
                onChange={(e) => setQNumber(e.target.value)}
                className="w-[140px] px-3 py-2 border rounded-md"
                placeholder="Q23-001"
                disabled={approveMutation.isPending}
                pattern="Q\\d{2}-\\d{3}"
              />
              <Button onClick={handleApprove} disabled={approveMutation.isPending}>
                {approveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Approve Order
              </Button>
            </div>
          )}
          {isApproved && (
            <>
              <Button
                variant="outline"
                onClick={handleOpenEmailDialog}
                disabled={sendEmailMutation.isPending || emailDialogLoading}
              >
                {sendEmailMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Send Supplier Emails
              </Button>
              <Button
                onClick={handleSubmitReceipts}
                disabled={receiptMutation.isPending || Object.keys(receiptQuantities).length === 0}
              >
                {receiptMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Receive Stock
              </Button>
            </>
          )}
        </div>
      </div>

      {emailDialogOpen && (
        <EmailOverrideDialog
          open={emailDialogOpen}
          onClose={() => setEmailDialogOpen(false)}
          rows={emailRows}
          cc={process.env.NEXT_PUBLIC_PO_EMAIL_CC || ''}
          loading={emailDialogLoading || sendEmailMutation.isPending}
          onConfirm={handleSendEmails}
        />
      )}

      {selectedOrderForReceive && (
        <ReceiveItemsModal
          open={receiveModalOpen}
          onOpenChange={handleReceiveModalChange}
          supplierOrder={selectedOrderForReceive}
          onSuccess={() => {
            // Invalidate queries to refresh the page data
            queryClient.invalidateQueries({ queryKey: ['purchaseOrder', id] });
            toast({
              title: 'Success',
              description: 'Receipt recorded successfully',
            });
          }}
        />
      )}
      {purchaseOrder && (
        <BulkReceiveModal
          open={bulkReceiveModalOpen}
          onOpenChange={setBulkReceiveModalOpen}
          supplierOrders={purchaseOrder.supplier_orders || []}
          purchaseOrderNumber={purchaseOrder.q_number || ''}
          purchaseOrderId={purchaseOrder.purchase_order_id}
          supplierName={purchaseOrder.supplier_orders?.[0]?.supplier_component?.supplier?.name || 'Supplier'}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['purchaseOrder', id] });
            queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
          }}
        />
      )}
    </div>
  );
}
