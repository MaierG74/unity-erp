'use client';

import { Fragment, use, useState, useEffect, useMemo, useLayoutEffect, useRef } from 'react';
import { useToast } from '@/components/ui/use-toast';
import Link from 'next/link';
import { useRouter, useSearchParams, notFound } from 'next/navigation';
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
import { EmailActivityCard } from '@/components/features/emails/EmailActivityCard';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, ArrowLeft, Loader2, CheckCircle2, Mail, Pencil, Save, X, Trash2, ChevronDown, ChevronRight, Paperclip, Ban, XCircle, ClipboardList } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import styles from './page.module.css';
import { fetchPOAttachments, POAttachment } from '@/lib/db/purchase-order-attachments';
import POAttachmentManager from '@/components/features/purchasing/POAttachmentManager';
import { ForOrderEditPopover } from '@/components/features/purchasing/ForOrderEditPopover';
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

interface CustomerOrderLink {
  id: number;
  order_id: number;
  quantity_for_order: number;
  quantity_for_stock: number;
  customer_order: {
    order_id: number;
    order_number: string;
  } | null;
}

interface SupplierOrder {
  order_id: number;
  order_quantity: number;
  total_received: number;
  status_id?: number;
  notes?: string | null;
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
  customer_order_links?: CustomerOrderLink[];
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
        status_id,
        notes,
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
        ),
        customer_order_links:supplier_order_customer_orders(
          id,
          order_id,
          quantity_for_order,
          quantity_for_stock,
          customer_order:orders(
            order_id,
            order_number
          )
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

// Type for email results from the API
type EmailResult = { supplier: string; success: boolean; error?: string; messageId?: string };

// Approve purchase order (emails sent via dialog after approval)
async function approvePurchaseOrder(id: string, qNumber: string): Promise<{ id: string }> {
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

    // Return success - emails will be sent via dialog
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
  const router = useRouter();

  const [qNumber, setQNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [receiptQuantities, setReceiptQuantities] = useState<ReceiptFormData>({});
  const [returnQuantities, setReturnQuantities] = useState<ReturnFormData>({});
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailDialogLoading, setEmailDialogLoading] = useState(false);
  const [emailRows, setEmailRows] = useState<EmailRecipientRow[]>([]);
  const [sendingFollowUp, setSendingFollowUp] = useState(false);
  const [emailHistoryExpanded, setEmailHistoryExpanded] = useState(false);
  const searchParams = useSearchParams();
  const [receiveModalOpen, setReceiveModalOpen] = useState(false);
  const [bulkReceiveModalOpen, setBulkReceiveModalOpen] = useState(false);
  const [selectedOrderForReceive, setSelectedOrderForReceive] = useState<SupplierOrderWithParent | null>(null);
  const [autoReceiveHandled, setAutoReceiveHandled] = useState(false);
  
  // Edit mode state
  const [isEditMode, setIsEditMode] = useState(false);
  const [editedNotes, setEditedNotes] = useState('');
  const [editedQuantities, setEditedQuantities] = useState<Record<number, number>>({});
  // Inline notes editing (independent of full edit mode)
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [inlineNotes, setInlineNotes] = useState('');
  const [deleteConfirmOrderId, setDeleteConfirmOrderId] = useState<number | null>(null);

  // Reject / Cancel state
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelLineItemIds, setCancelLineItemIds] = useState<number[]>([]);
  const [selectedLineItemIds, setSelectedLineItemIds] = useState<number[]>([]);
  const [cancelLineReason, setCancelLineReason] = useState('');
  
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

  // Auto-open receive modal when ?receive=order_id is in URL (from dashboard)
  useEffect(() => {
    if (autoReceiveHandled || !purchaseOrder || isLoading) return;
    const receiveOrderId = searchParams.get('receive');
    if (!receiveOrderId) return;

    const orderId = parseInt(receiveOrderId, 10);
    if (isNaN(orderId)) return;

    const supplierOrder = purchaseOrder.supplier_orders?.find(
      (so: SupplierOrder) => so.order_id === orderId
    );

    if (supplierOrder) {
      setSelectedOrderForReceive({
        ...supplierOrder,
        purchase_order: {
          purchase_order_id: purchaseOrder.purchase_order_id,
          q_number: purchaseOrder.q_number || '',
        },
      });
      setReceiveModalOpen(true);
    }
    setAutoReceiveHandled(true);
  }, [purchaseOrder, isLoading, searchParams, autoReceiveHandled]);

  // Fetch email history for this purchase order
  const { data: emailHistory } = useQuery({
    queryKey: ['purchaseOrderEmails', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_order_emails')
        .select(`
          email_id,
          supplier_id,
          supplier_order_id,
          recipient_email,
          cc_emails,
          email_type,
          status,
          message_id,
          error_message,
          sent_at,
          delivery_status,
          delivered_at,
          bounced_at,
          bounce_reason,
          supplier:suppliers(name)
        `)
        .eq('purchase_order_id', id)
        .order('sent_at', { ascending: false });
      if (error) throw error;
      return data as Array<{
        email_id: number;
        supplier_id: number;
        supplier_order_id: number | null;
        recipient_email: string;
        cc_emails: string[];
        email_type: 'po_send' | 'po_cancel' | 'po_line_cancel' | 'po_follow_up' | null;
        status: 'sent' | 'failed';
        message_id: string | null;
        error_message: string | null;
        sent_at: string;
        delivery_status: string | null;
        delivered_at: string | null;
        bounced_at: string | null;
        bounce_reason: string | null;
        supplier: { name: string } | null;
      }>;
    },
    enabled: !!id,
  });

  // Fetch follow-up responses for this purchase order
  const { data: followUpResponses } = useQuery({
    queryKey: ['purchaseOrderFollowUps', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('component_follow_up_emails')
        .select(`
          id,
          supplier_name,
          sent_at,
          status,
          response:supplier_follow_up_responses(
            status,
            expected_delivery_date,
            notes,
            responded_at,
            line_item_responses
          )
        `)
        .eq('purchase_order_id', id)
        .order('sent_at', { ascending: false });
      if (error) throw error;
      // Normalize response (Supabase returns array for 1-to-many)
      return (data || []).map((item: any) => ({
        ...item,
        response: Array.isArray(item.response) ? item.response[0] : item.response
      })) as Array<{
        id: number;
        supplier_name: string;
        sent_at: string;
        status: string;
        response?: {
          status: string | null;
          expected_delivery_date: string | null;
          notes: string | null;
          responded_at: string | null;
          line_item_responses: any[] | null;
        };
      }>;
    },
    enabled: !!id,
  });

  // Fetch PO activity log
  const [activityExpanded, setActivityExpanded] = useState(false);
  const { data: activityLog } = useQuery({
    queryKey: ['purchaseOrderActivity', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_order_activity')
        .select('id, action_type, description, metadata, performed_by, created_at')
        .eq('purchase_order_id', id)
        .order('created_at', { ascending: false });
      if (error) throw error;

      // Look up profile display names for unique performed_by user IDs
      const userIds = [...new Set((data || []).map(a => a.performed_by).filter(Boolean))] as string[];
      let profileMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, display_name, first_name, last_name')
          .in('id', userIds);
        if (profiles) {
          profileMap = Object.fromEntries(
            profiles.map(p => [p.id, p.display_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unknown'])
          );
        }
      }

      return (data || []).map(a => ({
        ...a,
        performer_name: a.performed_by ? (profileMap[a.performed_by] || 'Unknown') : 'System',
      }));
    },
    enabled: !!id,
  });

  // Fetch default CC email from company settings
  const { data: companySettings } = useQuery({
    queryKey: ['companySettings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quote_company_settings')
        .select('po_default_cc_email')
        .eq('setting_id', 1)
        .single();
      if (error) throw error;
      return data as { po_default_cc_email: string | null };
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Fetch PO attachments
  const { data: poAttachments = [], refetch: refetchAttachments } = useQuery({
    queryKey: ['poAttachments', id],
    queryFn: () => fetchPOAttachments(Number(id)),
    enabled: !!id,
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

  useEffect(() => {
    if (!purchaseOrder?.supplier_orders) return;
    const validLineIds = new Set(
      purchaseOrder.supplier_orders
        .filter((order) => order.status_id !== 4 && (order.order_quantity - (order.total_received || 0)) > 0)
        .map((order) => order.order_id)
    );
    setSelectedLineItemIds((prev) => prev.filter((orderId) => validLineIds.has(orderId)));
  }, [purchaseOrder]);

  const toggleLineSelection = (orderId: number, checked: boolean) => {
    setSelectedLineItemIds((prev) => {
      if (checked) {
        if (prev.includes(orderId)) return prev;
        return [...prev, orderId];
      }
      return prev.filter((id) => id !== orderId);
    });
  };

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

  const handleSendEmails = async (payload: { overrides: EmailOverride[]; cc: string[]; skippedSuppliers?: number[]; selectedAttachmentIds?: string[] }) => {
    // If all suppliers are skipped, just close the dialog
    if (payload.overrides.length === 0 && payload.cc.length === 0) {
      toast({
        title: 'No emails to send',
        description: 'All suppliers were skipped.',
        duration: 3000,
      });
      setEmailDialogOpen(false);
      return;
    }

    setEmailDialogLoading(true);

    try {
      // Generate PO PDF (lazy import to avoid build issues)
      let pdfBase64: string | undefined;
      let pdfFilename: string | undefined;

      if (purchaseOrder) {
        const [{ pdf }, { default: PurchaseOrderPDFDocument }] = await Promise.all([
          import('@react-pdf/renderer'),
          import('@/components/features/purchasing/PurchaseOrderPDFDocument'),
        ]);

        // Build company info for PDF
        const { data: settings } = await supabase
          .from('quote_company_settings')
          .select('*')
          .eq('setting_id', 1)
          .single();

        let companyLogoUrl: string | null = null;
        if (settings?.company_logo_path) {
          const { data: logoData } = supabase.storage.from('QButton').getPublicUrl(settings.company_logo_path);
          companyLogoUrl = logoData?.publicUrl || null;
        }

        const companyAddressParts = [
          settings?.address_line1,
          settings?.address_line2,
          [settings?.city, settings?.postal_code].filter(Boolean).join(' ').trim(),
          settings?.country,
        ].filter((part) => part && part.length > 0);

        const companyInfo = {
          name: settings?.company_name || 'Unity',
          email: settings?.email || '',
          phone: settings?.phone || '',
          address: companyAddressParts.join(', ') || '',
          logoUrl: companyLogoUrl,
        };

        // Get the supplier name from the first order
        const firstOrder = purchaseOrder.supplier_orders?.[0];
        const supplierName = firstOrder?.supplier_component?.supplier?.name || 'Supplier';
        const supplierEmail = payload.overrides[0]?.email || '';

        // Build items for PDF
        const pdfItems = (purchaseOrder.supplier_orders || []).map((order: SupplierOrder) => ({
          supplierCode: order.supplier_component?.supplier_code || '',
          internalCode: order.supplier_component?.component?.internal_code || '',
          description: order.supplier_component?.component?.description || '',
          quantity: order.order_quantity,
          unitPrice: order.supplier_component?.price || 0,
          notes: order.notes || null,
        }));

        // Fetch document templates for important notice
        const { data: templates } = await supabase
          .from('document_templates')
          .select('template_type, content')
          .in('template_type', ['po_email_notice']);

        const importantNotice = templates?.find((t: any) => t.template_type === 'po_email_notice')?.content || undefined;

        const pdfBlob = await pdf(
          <PurchaseOrderPDFDocument
            purchaseOrder={{
              qNumber: purchaseOrder.q_number || '',
              createdAt: purchaseOrder.order_date || purchaseOrder.created_at || new Date().toISOString(),
              notes: purchaseOrder.notes || undefined,
              supplierName,
              supplierEmail,
              items: pdfItems,
            }}
            companyInfo={companyInfo}
            importantNotice={importantNotice}
          />
        ).toBlob();

        const pdfBuffer = await pdfBlob.arrayBuffer();
        pdfBase64 = Buffer.from(pdfBuffer).toString('base64');

        const date = new Date(purchaseOrder.order_date || purchaseOrder.created_at || new Date());
        const y = date.getFullYear();
        const m = `${date.getMonth() + 1}`.padStart(2, '0');
        const d = `${date.getDate()}`.padStart(2, '0');
        pdfFilename = `PO-${purchaseOrder.q_number || id}-${y}${m}${d}.pdf`;
      }

      // Fetch selected additional attachments as base64
      const additionalAttachments: { content: string; filename: string; contentType?: string }[] = [];
      if (payload.selectedAttachmentIds && payload.selectedAttachmentIds.length > 0) {
        for (const attId of payload.selectedAttachmentIds) {
          const att = poAttachments.find((a) => a.id === attId);
          if (!att) continue;
          try {
            const response = await fetch(att.file_url);
            const blob = await response.blob();
            const buffer = await blob.arrayBuffer();
            const base64 = Buffer.from(buffer).toString('base64');
            additionalAttachments.push({
              content: base64,
              filename: att.original_name || 'attachment',
              contentType: att.mime_type || undefined,
            });
          } catch (err) {
            console.error(`Failed to fetch attachment ${att.original_name}:`, err);
          }
        }
      }

      // Send emails with PDF and attachments
      sendEmailMutation.mutate(
        {
          overrides: payload.overrides,
          cc: payload.cc,
          pdfBase64,
          pdfFilename,
          additionalAttachments: additionalAttachments.length > 0 ? additionalAttachments : undefined,
        },
        {
          onSuccess: () => {
            setEmailDialogOpen(false);
          },
          onSettled: () => {
            setEmailDialogLoading(false);
          },
        }
      );
    } catch (error: any) {
      console.error('Error preparing email:', error);
      toast({
        title: 'Error preparing email',
        description: error.message || 'Failed to generate PDF or prepare attachments.',
        variant: 'destructive',
        duration: 6000,
      });
      setEmailDialogLoading(false);
    }
  };

  // Send follow-up email for outstanding items
  const sendFollowUpEmail = async () => {
    setSendingFollowUp(true);
    try {
      const response = await fetch('/api/send-po-follow-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purchaseOrderId: id }),
      });

      const result = await response.json();

      if (result.success) {
        toast({
          title: '✅ Follow-up Sent',
          description: result.message,
          duration: 5000,
        });
        // Refresh email history
        queryClient.invalidateQueries({ queryKey: ['purchaseOrderEmails', id] });
      } else {
        toast({
          title: 'Failed to send follow-up',
          description: result.error || 'Unknown error',
          variant: 'destructive',
          duration: 6000,
        });
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to send follow-up email',
        variant: 'destructive',
        duration: 6000,
      });
    } finally {
      setSendingFollowUp(false);
    }
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrder', id] });
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['all-purchase-orders'] });

      toast({
        title: '✅ Purchase Order Approved',
        description: 'Now configure email recipients and send to suppliers.',
        duration: 5000,
      });

      // Open email dialog to let user configure recipients and CC
      if (baseEmailRows.length > 0) {
        const clonedRows = baseEmailRows.map((row) => ({
          supplierId: row.supplierId,
          supplierName: row.supplierName,
          options: [...row.options],
          selectedEmail: row.selectedEmail,
        }));
        setEmailRows(clonedRows);
        setEmailDialogOpen(true);
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

  // Reject purchase order mutation (Pending Approval → Cancelled)
  const rejectMutation = useMutation({
    mutationFn: async (reason?: string) => {
      const { data: statusData, error: statusError } = await supabase
        .from('supplier_order_statuses')
        .select('status_id')
        .eq('status_name', 'Cancelled')
        .single();
      if (statusError || !statusData) throw new Error('Could not find Cancelled status');

      const updateData: Record<string, any> = { status_id: statusData.status_id };
      if (reason?.trim()) {
        const existingNotes = purchaseOrder?.notes || '';
        updateData.notes = existingNotes
          ? `${existingNotes}\n\n[REJECTED] ${reason.trim()}`
          : `[REJECTED] ${reason.trim()}`;
      }

      const { error: updateError } = await supabase
        .from('purchase_orders')
        .update(updateData)
        .eq('purchase_order_id', id);
      if (updateError) throw new Error(`Failed to reject order: ${updateError.message}`);

      const { error: ordersError } = await supabase
        .from('supplier_orders')
        .update({ status_id: statusData.status_id })
        .eq('purchase_order_id', id);
      if (ordersError) throw new Error('Failed to update supplier orders');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrder', id] });
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['all-purchase-orders'] });
      setShowRejectDialog(false);
      setRejectReason('');
      toast({
        title: 'Order Rejected',
        description: 'The purchase order has been cancelled.',
      });
    },
    onError: (error: Error) => {
      setError(error.message);
    },
  });

  // Cancel approved order mutation (Approved → Cancelled + send emails)
  const cancelOrderMutation = useMutation({
    mutationFn: async (reason?: string) => {
      const { data: statusData, error: statusError } = await supabase
        .from('supplier_order_statuses')
        .select('status_id')
        .eq('status_name', 'Cancelled')
        .single();
      if (statusError || !statusData) throw new Error('Could not find Cancelled status');

      const updateData: Record<string, any> = { status_id: statusData.status_id };
      if (reason?.trim()) {
        const existingNotes = purchaseOrder?.notes || '';
        updateData.notes = existingNotes
          ? `${existingNotes}\n\n[CANCELLED] ${reason.trim()}`
          : `[CANCELLED] ${reason.trim()}`;
      }

      const { error: updateError } = await supabase
        .from('purchase_orders')
        .update(updateData)
        .eq('purchase_order_id', id);
      if (updateError) throw new Error(`Failed to cancel order: ${updateError.message}`);

      const { error: ordersError } = await supabase
        .from('supplier_orders')
        .update({ status_id: statusData.status_id })
        .eq('purchase_order_id', id);
      if (ordersError) throw new Error('Failed to update supplier orders');

      // Send cancellation emails to suppliers
      const response = await fetch('/api/send-po-cancellation-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchaseOrderId: id,
          cancellationReason: reason?.trim() || undefined,
        }),
      });
      const emailResult = await response.json();
      return emailResult;
    },
    onSuccess: (emailResult) => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrder', id] });
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['all-purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchaseOrderEmails', id] });
      setShowCancelDialog(false);
      setCancelReason('');

      const successes = emailResult?.results?.filter((r: any) => r.success).length || 0;
      const failures = emailResult?.results?.filter((r: any) => !r.success).length || 0;

      if (failures > 0) {
        toast({
          title: 'Order Cancelled (Email Issues)',
          description: `Order cancelled. Cancellation emails: ${successes} sent, ${failures} failed.`,
          variant: 'destructive',
          duration: 8000,
        });
      } else {
        toast({
          title: 'Order Cancelled',
          description: successes > 0
            ? `Order cancelled and ${successes} cancellation email${successes === 1 ? '' : 's'} sent to supplier${successes === 1 ? '' : 's'}.`
            : 'Order cancelled.',
          duration: 5000,
        });
      }
    },
    onError: (error: Error) => {
      setError(error.message);
    },
  });

  // Cancel individual line item mutation
  const cancelLineItemMutation = useMutation({
    mutationFn: async ({ orderIds, reason }: { orderIds: number[]; reason?: string }) => {
      const uniqueOrderIds = Array.from(new Set(orderIds.map((value) => Number(value)).filter((value) => Number.isFinite(value))));
      if (uniqueOrderIds.length === 0) {
        throw new Error('No line items selected for cancellation');
      }

      const { data: statusData, error: statusError } = await supabase
        .from('supplier_order_statuses')
        .select('status_id')
        .eq('status_name', 'Cancelled')
      .single();
      if (statusError || !statusData) throw new Error('Could not find Cancelled status');

      for (const orderId of uniqueOrderIds) {
        const updateData: Record<string, any> = { status_id: statusData.status_id };
        if (reason?.trim()) {
          const existingNotes = purchaseOrder?.supplier_orders?.find(o => o.order_id === orderId)?.notes || '';
          updateData.notes = existingNotes
            ? `${existingNotes}\n[CANCELLED] ${reason.trim()}`
            : `[CANCELLED] ${reason.trim()}`;
        }

        const { error: updateError } = await supabase
          .from('supplier_orders')
          .update(updateData)
          .eq('order_id', orderId);
        if (updateError) throw new Error(`Failed to cancel line item ${orderId}: ${updateError.message}`);
      }

      // Send line-level cancellation email for the affected line.
      // Do not fail the cancellation if email sending fails.
      let emailResult: any = null;
      let emailError: string | null = null;
      try {
        const emailResponse = await fetch('/api/send-po-cancellation-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            purchaseOrderId: id,
            cancellationReason: reason?.trim() || undefined,
            supplierOrderIds: uniqueOrderIds,
            emailType: 'po_line_cancel',
          }),
        });
        emailResult = await emailResponse.json().catch(() => ({}));
        if (!emailResponse.ok) {
          emailError = emailResult?.error || 'Failed to send line cancellation email';
        }
      } catch (err: any) {
        emailError = err?.message || 'Failed to send line cancellation email';
      }

      // Check if all line items are now cancelled - if so, cancel the whole PO
      const { data: remainingActive } = await supabase
        .from('supplier_orders')
        .select('order_id, status_id')
        .eq('purchase_order_id', id)
        .neq('status_id', statusData.status_id);

      if (!remainingActive || remainingActive.length === 0) {
        await supabase
          .from('purchase_orders')
          .update({ status_id: statusData.status_id })
          .eq('purchase_order_id', id);
      }

      // Log activity for cancelled lines
      const { data: { user } } = await supabase.auth.getUser();
      const cancelledDescriptions = uniqueOrderIds.map(oid => {
        const so = purchaseOrder?.supplier_orders?.find(o => o.order_id === oid);
        const code = so?.supplier_component?.component?.internal_code || `#${oid}`;
        return code;
      });
      await supabase.from('purchase_order_activity').insert({
        purchase_order_id: Number(id),
        action_type: 'line_cancelled',
        description: `Cancelled line${uniqueOrderIds.length > 1 ? 's' : ''}: ${cancelledDescriptions.join(', ')}${reason?.trim() ? ` — "${reason.trim()}"` : ''}`,
        metadata: { supplier_order_ids: uniqueOrderIds, reason: reason?.trim() || null },
        performed_by: user?.id || null,
      });

      return { emailResult, emailError, cancelledOrderIds: uniqueOrderIds };
    },
    onSuccess: (result: { emailResult?: any; emailError?: string | null; cancelledOrderIds?: number[] }) => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrder', id] });
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['all-purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchaseOrderEmails', id] });
      queryClient.invalidateQueries({ queryKey: ['purchaseOrderActivity', id] });
      setCancelLineItemIds([]);
      setCancelLineReason('');
      if (Array.isArray(result?.cancelledOrderIds) && result.cancelledOrderIds.length > 0) {
        setSelectedLineItemIds((prev) => prev.filter((id) => !result.cancelledOrderIds!.includes(id)));
      }

      const emailResult = result?.emailResult;
      const emailError = result?.emailError || null;
      const successes = emailResult?.results?.filter((r: any) => r.success).length || 0;
      const failures = (emailResult?.results?.filter((r: any) => !r.success).length || 0) + (emailError ? 1 : 0);
      const cancelledCount = result?.cancelledOrderIds?.length || 0;

      toast({
        title: cancelledCount > 1 ? 'Line Items Cancelled' : 'Line Item Cancelled',
        description:
          failures > 0
            ? `${cancelledCount > 1 ? `${cancelledCount} lines cancelled.` : 'Line cancelled.'} Notification emails: ${successes} sent, ${failures} failed.${emailError ? ` ${emailError}` : ''}`
            : successes > 0
              ? `${cancelledCount > 1 ? `${cancelledCount} lines cancelled` : 'The line item has been cancelled'} and supplier notified.`
              : cancelledCount > 1 ? `${cancelledCount} line items have been cancelled.` : 'The line item has been cancelled.',
        variant: failures > 0 ? 'destructive' : 'default',
      });
    },
    onError: (error: Error) => {
      setError(error.message);
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

  const sendEmailMutation = useMutation<EmailResult[] | undefined, Error, { overrides?: { supplierId: number; email: string }[]; cc?: string[]; pdfBase64?: string; pdfFilename?: string; additionalAttachments?: { content: string; filename: string; contentType?: string }[] } | undefined>({
    mutationFn: async (payload) => {
      const response = await fetch('/api/send-purchase-order-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchaseOrderId: id,
          overrides: payload?.overrides,
          cc: payload?.cc,
          pdfBase64: payload?.pdfBase64,
          pdfFilename: payload?.pdfFilename,
          additionalAttachments: payload?.additionalAttachments,
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
      // Refresh email history after sending
      queryClient.invalidateQueries({ queryKey: ['purchaseOrderEmails', id] });
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

  // Edit purchase order mutation
  const editPurchaseOrderMutation = useMutation({
    mutationFn: async (data: { notes?: string; lineUpdates?: { orderId: number; quantity: number }[] }) => {
      // Update notes if changed
      if (data.notes !== undefined) {
        const { error: notesError } = await supabase
          .from('purchase_orders')
          .update({ notes: data.notes })
          .eq('purchase_order_id', id);
        if (notesError) throw new Error(`Failed to update notes: ${notesError.message}`);
      }

      // Update line quantities if changed
      if (data.lineUpdates && data.lineUpdates.length > 0) {
        for (const update of data.lineUpdates) {
          const { error: lineError } = await supabase
            .from('supplier_orders')
            .update({ order_quantity: update.quantity })
            .eq('order_id', update.orderId);
          if (lineError) throw new Error(`Failed to update line item: ${lineError.message}`);
        }
      }

      // Log activity
      const { data: { user } } = await supabase.auth.getUser();
      const descriptions: string[] = [];
      if (data.notes !== undefined) descriptions.push('Updated notes');
      if (data.lineUpdates && data.lineUpdates.length > 0) {
        const qtyChanges = data.lineUpdates.map(u => {
          const so = purchaseOrder?.supplier_orders?.find(o => o.order_id === u.orderId);
          const code = so?.supplier_component?.component?.internal_code || `#${u.orderId}`;
          return `${code}: ${so?.order_quantity} → ${u.quantity}`;
        });
        descriptions.push(`Changed quantities: ${qtyChanges.join(', ')}`);
      }
      if (descriptions.length > 0) {
        await supabase.from('purchase_order_activity').insert({
          purchase_order_id: Number(id),
          action_type: data.lineUpdates?.length ? 'quantity_changed' : 'notes_updated',
          description: descriptions.join('. '),
          metadata: { notes_changed: data.notes !== undefined, line_updates: data.lineUpdates || [] },
          performed_by: user?.id || null,
        });
      }

      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrder', id] });
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
      queryClient.invalidateQueries({ queryKey: ['purchaseOrderActivity', id] });
      setIsEditMode(false);
      setEditedQuantities({});
      toast({
        title: 'Purchase order updated',
        description: 'Changes have been saved successfully.',
      });
    },
    onError: (error: Error) => {
      setError(`Failed to update purchase order: ${error.message}`);
      toast({
        title: 'Failed to update',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Delete line item mutation
  const deleteLineItemMutation = useMutation({
    mutationFn: async (orderId: number) => {
      // First delete any related records in supplier_order_customer_orders
      const { error: junctionError } = await supabase
        .from('supplier_order_customer_orders')
        .delete()
        .eq('supplier_order_id', orderId);
      
      if (junctionError) {
        console.warn('Error deleting junction records:', junctionError);
        // Continue anyway as the junction table might not have records
      }

      // Then delete the supplier order
      const { error } = await supabase
        .from('supplier_orders')
        .delete()
        .eq('order_id', orderId);
      
      if (error) throw new Error(`Failed to delete line item: ${error.message}`);
      return orderId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrder', id] });
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
      setDeleteConfirmOrderId(null);
      toast({
        title: 'Line item deleted',
        description: 'The line item has been removed from the purchase order.',
      });
    },
    onError: (error: Error) => {
      setError(`Failed to delete line item: ${error.message}`);
      toast({
        title: 'Failed to delete',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Enter edit mode
  const handleEnterEditMode = () => {
    setEditedNotes(purchaseOrder?.notes || '');
    const quantities: Record<number, number> = {};
    purchaseOrder?.supplier_orders?.forEach(order => {
      quantities[order.order_id] = order.order_quantity;
    });
    setEditedQuantities(quantities);
    setIsEditMode(true);
  };

  // Cancel edit mode
  const handleCancelEdit = () => {
    setIsEditMode(false);
    setEditedNotes('');
    setEditedQuantities({});
    setError(null);
  };

  // Save edits
  const handleSaveEdits = () => {
    const lineUpdates: { orderId: number; quantity: number }[] = [];
    
    // Check for quantity changes
    purchaseOrder?.supplier_orders?.forEach(order => {
      const newQty = editedQuantities[order.order_id];
      if (newQty !== undefined && newQty !== order.order_quantity) {
        if (newQty <= 0) {
          setError('Quantity must be greater than 0. Use delete to remove items.');
          return;
        }
        lineUpdates.push({ orderId: order.order_id, quantity: newQty });
      }
    });

    const notesChanged = editedNotes !== (purchaseOrder?.notes || '');
    
    if (!notesChanged && lineUpdates.length === 0) {
      setIsEditMode(false);
      return;
    }

    editPurchaseOrderMutation.mutate({
      notes: notesChanged ? editedNotes : undefined,
      lineUpdates: lineUpdates.length > 0 ? lineUpdates : undefined,
    });
  };

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
          <Button variant="outline" size="icon" className="mr-4" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold">Purchase Order Not Found</h1>
        </div>

        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {queryError instanceof Error ? queryError.message : 'Failed to load purchase order'}
          </AlertDescription>
        </Alert>

        <Button onClick={() => router.back()}>Return to Purchase Orders</Button>
      </div>
    );
  }

  if (!purchaseOrder) {
    return notFound();
  }

  const isPendingApproval = purchaseOrder.status?.status_name === 'Pending Approval';
  const isDraft = purchaseOrder.status?.status_name === 'Draft';
  const isApproved = purchaseOrder.status?.status_name === 'Approved';
  const isCancelled = purchaseOrder.status?.status_name === 'Cancelled';

  // Email status helpers
  const hasSentPO = emailHistory?.some(e => e.email_type === 'po_send' && e.status === 'sent');
  const hasEmailIssues = emailHistory?.some(e => e.delivery_status === 'bounced' || e.delivery_status === 'complained' || e.status === 'failed');
  const hasOutstandingItems = purchaseOrder.supplier_orders?.some(o => (o.order_quantity - (o.total_received || 0)) > 0);

  // Calculate totals (exclude cancelled line items)
  const activeOrders = purchaseOrder.supplier_orders?.filter(o => o.status_id !== 4) || [];
  const totalItems = activeOrders.reduce((sum, order) => sum + order.order_quantity, 0);
  const totalAmount = activeOrders.reduce((sum, order) => {
    return sum + (order.supplier_component?.price || 0) * order.order_quantity;
  }, 0);
  const totalReceived = activeOrders.reduce((sum, order) => {
    return sum + (order.total_received || 0);
  }, 0);

  return (
    <div className="space-y-6">
      {/* Sticky header - sticks right below navbar with no gap */}
      <div className={cn(
        "sticky top-16 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b shadow-sm py-3 px-4 md:px-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4",
        styles.stickyHeader
      )} ref={headerRef}>
        <div className="flex items-center">
          <Button variant="outline" size="icon" className="mr-4" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="text-xs sm:text-sm text-muted-foreground">Purchasing / Purchase Orders</div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
                {purchaseOrder.q_number || `PO #${purchaseOrder.purchase_order_id}`}
              </h1>
              <StatusBadge status={getOrderStatus(purchaseOrder)} />
              {isApproved && hasEmailIssues && (
                <Badge variant="destructive" className="text-[10px] h-5 gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Email Issue
                </Badge>
              )}
              {isApproved && hasSentPO && !hasEmailIssues && (
                <Badge variant="secondary" className="text-[10px] h-5 gap-1 bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300">
                  <Mail className="h-3 w-3" />
                  Emailed
                </Badge>
              )}
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
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium">Notes</p>
                  {(isDraft || isPendingApproval) && !isEditMode && !isEditingNotes && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-muted-foreground"
                      onClick={() => {
                        setInlineNotes(purchaseOrder.notes || '');
                        setIsEditingNotes(true);
                      }}
                    >
                      <Pencil className="h-3 w-3 mr-1" />
                      Edit
                    </Button>
                  )}
                </div>
                {isEditMode ? (
                  <Textarea
                    value={editedNotes}
                    onChange={(e) => setEditedNotes(e.target.value)}
                    placeholder="Add notes..."
                    className="min-h-[80px]"
                  />
                ) : isEditingNotes ? (
                  <div className="space-y-2">
                    <Textarea
                      value={inlineNotes}
                      onChange={(e) => setInlineNotes(e.target.value)}
                      placeholder="Add notes..."
                      className="min-h-[80px]"
                      autoFocus
                    />
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsEditingNotes(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        disabled={editPurchaseOrderMutation.isPending}
                        onClick={() => {
                          editPurchaseOrderMutation.mutate({ notes: inlineNotes }, {
                            onSuccess: () => {
                              setIsEditingNotes(false);
                            },
                          });
                        }}
                      >
                        {editPurchaseOrderMutation.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <Save className="h-3 w-3 mr-1" />
                        )}
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{purchaseOrder.notes || 'No notes'}</p>
                )}
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

              {/* Email History & Follow-up - Collapsible */}
              {isApproved && ((emailHistory && emailHistory.length > 0) || purchaseOrder.supplier_orders?.some(o => 
                (o.order_quantity - (o.total_received || 0)) > 0
              )) && (
                <div className="pt-2 border-t">
                  <button
                    onClick={() => setEmailHistoryExpanded(!emailHistoryExpanded)}
                    className="w-full flex items-center justify-between text-sm font-medium hover:bg-muted/50 rounded-md py-1 px-1 -mx-1"
                  >
                    <span className="flex items-center gap-2">
                      <Mail className="h-4 w-4" />
                      Email Activity
                      {emailHistory && emailHistory.length > 0 && (
                        <Badge variant="secondary" className="text-[10px] h-5">
                          {emailHistory.length}
                        </Badge>
                      )}
                      {emailHistory && emailHistory.some(e => e.delivery_status === 'bounced' || e.delivery_status === 'complained') && (
                        <Badge variant="destructive" className="text-[10px] h-5">
                          Issues
                        </Badge>
                      )}
                      {followUpResponses && followUpResponses.some(f => f.response?.responded_at) && (
                        <Badge variant="default" className="text-[10px] h-5 bg-green-600">
                          {followUpResponses.filter(f => f.response?.responded_at).length} response{followUpResponses.filter(f => f.response?.responded_at).length !== 1 ? 's' : ''}
                        </Badge>
                      )}
                    </span>
                    {emailHistoryExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                  
                  {emailHistoryExpanded && (
                    <div className="mt-2 space-y-3">
                      {/* Alert for bounced/failed emails */}
                      {emailHistory && emailHistory.some(e => e.delivery_status === 'bounced' || e.delivery_status === 'complained') && (
                        <Alert variant="destructive" className="py-2">
                          <AlertCircle className="h-4 w-4" />
                          <AlertDescription className="text-xs">
                            Some emails bounced or were marked as spam. Please verify email addresses and try resending.
                          </AlertDescription>
                        </Alert>
                      )}

                      {/* Supplier Responses */}
                      {followUpResponses && followUpResponses.some(f => f.response?.responded_at) && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Supplier Responses</p>
                          {followUpResponses.filter(f => f.response?.responded_at).map((followUp) => {
                            const resp = followUp.response;
                            const statusColors: Record<string, string> = {
                              on_track: 'bg-green-100 border-green-300 text-green-800',
                              delayed: 'bg-amber-100 border-amber-300 text-amber-800',
                              issue: 'bg-red-100 border-red-300 text-red-800',
                            };
                            const statusLabels: Record<string, string> = {
                              on_track: 'On Track',
                              delayed: 'Delayed',
                              issue: 'Issue',
                            };
                            return (
                              <div
                                key={followUp.id}
                                className={cn(
                                  "text-xs p-2 rounded-md border",
                                  statusColors[resp?.status || ''] || 'bg-blue-50 border-blue-200'
                                )}
                              >
                                <div className="flex items-center justify-between">
                                  <span className="font-medium">{followUp.supplier_name}</span>
                                  <Badge variant="outline" className={cn("text-[10px]", statusColors[resp?.status || ''])}>
                                    {statusLabels[resp?.status || ''] || resp?.status || 'Responded'}
                                  </Badge>
                                </div>
                                {resp?.expected_delivery_date && (
                                  <div className="text-muted-foreground mt-1">
                                    Expected: {format(new Date(resp.expected_delivery_date), 'PP')}
                                  </div>
                                )}
                                {resp?.notes && (
                                  <div className="mt-1 italic">"{resp.notes}"</div>
                                )}
                                {/* Per-item responses */}
                                {resp?.line_item_responses && Array.isArray(resp.line_item_responses) && resp.line_item_responses.some((item: any) => item.item_status || item.item_notes || item.item_expected_date) && (
                                  <div className="mt-2 space-y-1.5">
                                    {(resp.line_item_responses as any[]).map((item: any, idx: number) => {
                                      const itemStatusColors: Record<string, string> = {
                                        on_track: 'text-green-700',
                                        shipped: 'text-blue-700',
                                        delayed: 'text-amber-700',
                                        issue: 'text-red-700',
                                      };
                                      const itemStatusLabels: Record<string, string> = {
                                        on_track: 'On Track',
                                        shipped: 'Shipped',
                                        delayed: 'Delayed',
                                        issue: 'Issue',
                                      };
                                      return (
                                        <div key={idx} className="flex items-start gap-2 pl-2 border-l-2 border-border/50">
                                          <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                              <span className="font-mono text-[10px]">{item.supplier_code || item.description}</span>
                                              {item.item_status && (
                                                <span className={`text-[10px] font-medium ${itemStatusColors[item.item_status] || ''}`}>
                                                  {itemStatusLabels[item.item_status] || item.item_status}
                                                </span>
                                              )}
                                              {item.item_expected_date && (
                                                <span className="text-[10px] text-muted-foreground">
                                                  ETA: {format(new Date(item.item_expected_date), 'PP')}
                                                </span>
                                              )}
                                            </div>
                                            {item.item_notes && (
                                              <p className="text-[10px] text-muted-foreground italic mt-0.5">"{item.item_notes}"</p>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                                <div className="text-muted-foreground mt-1">
                                  Responded: {resp?.responded_at ? format(new Date(resp.responded_at), 'PP · p') : 'Unknown'}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Email History List with Delivery Status */}
                      {emailHistory && emailHistory.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Emails Sent</p>
                          <div className="space-y-2 max-h-32 overflow-y-auto">
                            {emailHistory.map((email) => {
                              const isBounced = email.delivery_status === 'bounced';
                              const isDelivered = email.delivery_status === 'delivered';
                              const isComplained = email.delivery_status === 'complained';
                              const hasIssue = isBounced || isComplained;
                              const emailTypeLabel = (() => {
                                if (email.email_type === 'po_cancel') return 'PO Cancel';
                                if (email.email_type === 'po_line_cancel') return 'Line Cancel';
                                if (email.email_type === 'po_follow_up') return 'Follow-up';
                                return 'PO Send';
                              })();

                              return (
                                <div
                                  key={email.email_id}
                                  className={cn(
                                    "text-xs p-2 rounded-md border",
                                    hasIssue ? "bg-red-50 border-red-300 dark:bg-red-950/30 dark:border-red-800" :
                                    isDelivered ? "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800" :
                                    email.status === 'sent' ? "bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800" :
                                    "bg-red-50 border-red-200"
                                  )}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium truncate">
                                      {email.supplier?.name || 'Unknown'}
                                    </span>
                                    <div className="flex items-center gap-1">
                                      <Badge variant="outline" className="text-[10px]">
                                        {emailTypeLabel}
                                      </Badge>
                                      {isBounced && (
                                        <Badge variant="destructive" className="text-[10px]">
                                          Bounced
                                        </Badge>
                                      )}
                                      {isComplained && (
                                        <Badge variant="destructive" className="text-[10px]">
                                          Spam
                                        </Badge>
                                      )}
                                      {isDelivered && (
                                        <Badge className="text-[10px] bg-green-600">
                                          Delivered
                                        </Badge>
                                      )}
                                      {!hasIssue && !isDelivered && email.status === 'sent' && (
                                        <Badge variant="secondary" className="text-[10px]">
                                          Sent
                                        </Badge>
                                      )}
                                      {email.status === 'failed' && (
                                        <Badge variant="destructive" className="text-[10px]">
                                          Failed
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                  <div className="text-muted-foreground mt-1">
                                    To: {email.recipient_email}
                                  </div>
                                  {email.bounce_reason && (
                                    <div className="text-red-600 dark:text-red-400 mt-1 text-[10px]">
                                      Reason: {email.bounce_reason}
                                    </div>
                                  )}
                                  <div className="text-muted-foreground">
                                    {format(new Date(email.sent_at), 'PP · p')}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                    </div>
                  )}
                </div>
              )}

              {/* Activity Log - Collapsible */}
              {activityLog && activityLog.length > 0 && (
                <div className="pt-2 border-t">
                  <button
                    onClick={() => setActivityExpanded(!activityExpanded)}
                    className="w-full flex items-center justify-between text-sm font-medium hover:bg-muted/50 rounded-md py-1 px-1 -mx-1"
                  >
                    <span className="flex items-center gap-2">
                      <ClipboardList className="h-4 w-4" />
                      Activity Log
                      <Badge variant="secondary" className="text-[10px] h-5">
                        {activityLog.length}
                      </Badge>
                    </span>
                    {activityExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>

                  {activityExpanded && (
                    <div className="mt-2 space-y-2 max-h-48 overflow-y-auto">
                      {activityLog.map((entry) => (
                        <div
                          key={entry.id}
                          className="text-xs p-2 rounded-md border bg-muted/30"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{entry.performer_name}</span>
                            <span className="text-muted-foreground">
                              {format(new Date(entry.created_at), 'PP · p')}
                            </span>
                          </div>
                          <p className="text-muted-foreground mt-1">{entry.description}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Summary card moved above; removing duplicate compact bar */}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xl font-bold">Order Items</CardTitle>
            <div className="flex items-center gap-2">
              {(isDraft || isPendingApproval) && !isEditMode && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleEnterEditMode}
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                </Button>
              )}
              {isEditMode && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancelEdit}
                    disabled={editPurchaseOrderMutation.isPending}
                  >
                    <X className="h-4 w-4 mr-2" />
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveEdits}
                    disabled={editPurchaseOrderMutation.isPending}
                  >
                    {editPurchaseOrderMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-2" />
                    )}
                    Save Changes
                  </Button>
                </>
              )}
            </div>
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
                  variant="destructive"
                  size="sm"
                  onClick={() => setCancelLineItemIds(selectedLineItemIds)}
                  disabled={selectedLineItemIds.length === 0 || cancelLineItemMutation.isPending}
                >
                  Cancel Selected
                  {selectedLineItemIds.length > 0 ? ` (${selectedLineItemIds.length})` : ''}
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
                  <TableHead>For Order</TableHead>
                  <TableHead className="text-right">Unit Price</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  {!isEditMode && <TableHead className="text-right">Received</TableHead>}
                  {!isEditMode && <TableHead className="text-right">Owing</TableHead>}
                  {isApproved && <TableHead className="text-right">Receive Now</TableHead>}
                  <TableHead className="text-right">Total</TableHead>
                  {isEditMode && <TableHead className="text-right">Actions</TableHead>}
                  {isApproved && !isEditMode && <TableHead className="text-right w-[80px]"></TableHead>}
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
                      const isLineCancelled = order.status_id === 4;
                      const remainingToReceive = Math.max(0, order.order_quantity - (order.total_received || 0));

                      const editedQty = editedQuantities[order.order_id] ?? order.order_quantity;
                      const editedLineTotal = price * editedQty;

                      // Build customer order display
                      const customerOrderLinks = order.customer_order_links || [];
                      const hasOrderLinks = customerOrderLinks.some(link => link.customer_order);
                      const hasStockAllocation = customerOrderLinks.some(link => Number(link.quantity_for_stock) > 0);

                      return (
                        <Fragment key={order.order_id}>
                        <TableRow className={cn("odd:bg-muted/30", isLineCancelled && "opacity-50")}>
                          <TableCell className={cn("font-medium", isLineCancelled && "line-through")}>
                            {component?.internal_code || 'Unknown'}
                            {isLineCancelled && <Badge variant="destructive" className="ml-2 text-[10px]">Cancelled</Badge>}
                          </TableCell>
                          <TableCell className={cn(isLineCancelled && "line-through")}>{component?.description || 'No description'}</TableCell>
                          <TableCell className={cn(isLineCancelled && "line-through")}>{supplier?.name || 'Unknown'}</TableCell>
                          <TableCell>
                            <ForOrderEditPopover
                              supplierOrderId={order.order_id}
                              purchaseOrderId={id}
                              orderQuantity={order.order_quantity}
                              customerOrderLinks={customerOrderLinks}
                              disabled={isLineCancelled || (order.total_received >= order.order_quantity) || isCancelled}
                            />
                          </TableCell>
                          <TableCell className="text-right">R{price.toFixed(2)}</TableCell>
                          <TableCell className="text-right">
                            {isEditMode ? (
                              <Input
                                type="number"
                                min="0.01"
                                step="any"
                                value={editedQty}
                                onChange={(e) => setEditedQuantities(prev => ({
                                  ...prev,
                                  [order.order_id]: parseFloat(e.target.value) || 0
                                }))}
                                className="w-20 text-right ml-auto"
                              />
                            ) : (
                              order.order_quantity
                            )}
                          </TableCell>
                          {!isEditMode && <TableCell className="text-right">{order.total_received || 0}</TableCell>}
                          {!isEditMode && (
                            <TableCell className="text-right">
                              <span className={remainingToReceive > 0 ? 'font-medium text-orange-600' : 'text-muted-foreground'}>
                                {remainingToReceive}
                              </span>
                            </TableCell>
                          )}
                          {isApproved && (
                            <TableCell className="text-right">
                              {!isLineCancelled && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleOpenReceiveModal(order)}
                                  disabled={remainingToReceive <= 0}
                                >
                                  Receive
                                </Button>
                              )}
                            </TableCell>
                          )}
                          <TableCell className={cn("text-right font-medium", isLineCancelled && "line-through")}>
                            R{(isEditMode ? editedLineTotal : lineTotal).toFixed(2)}
                          </TableCell>
                          {isEditMode && (
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeleteConfirmOrderId(order.order_id)}
                                disabled={deleteLineItemMutation.isPending || (purchaseOrder.supplier_orders?.length || 0) <= 1}
                                title={(purchaseOrder.supplier_orders?.length || 0) <= 1 ? "Cannot delete the last item" : "Delete line item"}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </TableCell>
                          )}
                          {isApproved && !isEditMode && (
                            <TableCell className="text-right">
                              {!isLineCancelled && remainingToReceive > 0 && (
                                <div className="flex items-center justify-end gap-2">
                                  <Checkbox
                                    checked={selectedLineItemIds.includes(order.order_id)}
                                    onCheckedChange={(checked) => toggleLineSelection(order.order_id, checked === true)}
                                    disabled={cancelLineItemMutation.isPending}
                                    aria-label={`Select line ${order.order_id} for cancellation`}
                                  />
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setCancelLineItemIds([order.order_id])}
                                    disabled={cancelLineItemMutation.isPending}
                                    title="Cancel this line item"
                                  >
                                    <XCircle className="h-4 w-4 text-destructive" />
                                  </Button>
                                </div>
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                        {order.notes && (
                          <TableRow className="border-b">
                            <TableCell colSpan={isEditMode ? (isApproved ? 8 : 7) : (isApproved ? 11 : 9)} className="py-2 pl-8">
                              <p className="text-xs italic text-muted-foreground">Note: {order.notes}</p>
                            </TableCell>
                          </TableRow>
                        )}
                        </Fragment>
                      );
                    })}
                    <TableRow className="bg-muted/30">
                      <TableCell colSpan={5} className="text-right text-sm font-medium text-muted-foreground">Totals</TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        {isEditMode 
                          ? Object.values(editedQuantities).reduce((sum, qty) => sum + qty, 0)
                          : totalItems
                        }
                      </TableCell>
                      {!isEditMode && <TableCell className="text-right text-sm font-medium">{totalReceived}</TableCell>}
                      {!isEditMode && (
                        <TableCell className="text-right text-sm font-medium">
                          <span className="font-medium text-orange-600">
                            {Math.max(0, totalItems - totalReceived)}
                          </span>
                        </TableCell>
                      )}
                      {isApproved && <TableCell />}
                      <TableCell className="text-right font-semibold">
                        R{isEditMode
                          ? purchaseOrder.supplier_orders?.filter(o => o.status_id !== 4).reduce((sum, order) => {
                              const qty = editedQuantities[order.order_id] ?? order.order_quantity;
                              const price = order.supplier_component?.price || 0;
                              return sum + (price * qty);
                            }, 0).toFixed(2)
                          : totalAmount.toFixed(2)
                        }
                      </TableCell>
                      {isEditMode && <TableCell />}
                      {isApproved && !isEditMode && <TableCell />}
                    </TableRow>
                  </>
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={isApproved ? 11 : 9}
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
          <div className="mt-6">
            <POAttachmentManager
              purchaseOrderId={purchaseOrder.purchase_order_id}
              attachments={poAttachments}
              onAttachmentsChange={(atts) => refetchAttachments()}
              disabled={isCancelled}
            />
          </div>
        )}

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
                            <TableHead className="w-10"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {order.receipts.map((receipt) => {
                            const receiptAttachment = poAttachments.find(
                              (att) => att.receipt_id === receipt.receipt_id
                            );
                            return (
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
                                <TableCell>
                                  {receiptAttachment && (
                                    <a
                                      href={receiptAttachment.file_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title={receiptAttachment.original_name || 'Delivery note'}
                                      className="text-muted-foreground hover:text-primary transition-colors"
                                    >
                                      <Paperclip className="h-4 w-4" />
                                    </a>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
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
          {isDraft && !isEditMode && (
            <Button onClick={handleSubmit} disabled={submitMutation.isPending}>
              {submitMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Submit for Approval
            </Button>
          )}
          {isPendingApproval && (
            <div className="flex items-center gap-2">
              <Button
                variant="destructive"
                onClick={() => setShowRejectDialog(true)}
                disabled={rejectMutation.isPending}
              >
                {rejectMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <Ban className="h-4 w-4 mr-2" />
                Reject Order
              </Button>
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
                variant="destructive"
                onClick={() => setShowCancelDialog(true)}
                disabled={cancelOrderMutation.isPending}
              >
                {cancelOrderMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <Ban className="h-4 w-4 mr-2" />
                Cancel Order
              </Button>
              <Button
                variant="outline"
                onClick={handleOpenEmailDialog}
                disabled={sendEmailMutation.isPending || emailDialogLoading}
              >
                {sendEmailMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Mail className="h-4 w-4 mr-2" />
                )}
                {hasSentPO ? 'Resend PO to Supplier' : 'Email PO to Supplier'}
              </Button>
              {hasOutstandingItems && (
                <Button
                  variant="outline"
                  onClick={sendFollowUpEmail}
                  disabled={sendingFollowUp}
                >
                  {sendingFollowUp ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Mail className="h-4 w-4 mr-2" />
                  )}
                  Send Follow-up
                </Button>
              )}
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
          cc={companySettings?.po_default_cc_email || ''}
          loading={emailDialogLoading || sendEmailMutation.isPending}
          attachments={poAttachments}
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

      {/* Delete line item confirmation dialog */}
      <Dialog open={deleteConfirmOrderId !== null} onOpenChange={(open) => !open && setDeleteConfirmOrderId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Line Item</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this line item? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOrderId(null)}
              disabled={deleteLineItemMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmOrderId && deleteLineItemMutation.mutate(deleteConfirmOrderId)}
              disabled={deleteLineItemMutation.isPending}
            >
              {deleteLineItemMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject order dialog */}
      <Dialog open={showRejectDialog} onOpenChange={(open) => { if (!open) { setShowRejectDialog(false); setRejectReason(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Purchase Order</DialogTitle>
            <DialogDescription>
              This will cancel PO #{purchaseOrder?.purchase_order_id}. The order and all line items will be set to Cancelled.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">Reason (optional)</label>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Enter reason for rejection..."
              className="min-h-[80px]"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setShowRejectDialog(false); setRejectReason(''); }}
              disabled={rejectMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => rejectMutation.mutate(rejectReason || undefined)}
              disabled={rejectMutation.isPending}
            >
              {rejectMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Reject Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel approved order dialog */}
      <Dialog open={showCancelDialog} onOpenChange={(open) => { if (!open) { setShowCancelDialog(false); setCancelReason(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Purchase Order</DialogTitle>
            <DialogDescription>
              This will cancel {purchaseOrder?.q_number || `PO #${purchaseOrder?.purchase_order_id}`} and send cancellation emails to all suppliers.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">Reason (optional)</label>
            <Textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Enter reason for cancellation..."
              className="min-h-[80px]"
            />
          </div>
          <DialogFooter className="pt-4">
            <Button
              variant="outline"
              onClick={() => { setShowCancelDialog(false); setCancelReason(''); }}
              disabled={cancelOrderMutation.isPending}
            >
              Keep Order
            </Button>
            <Button
              variant="destructive"
              onClick={() => cancelOrderMutation.mutate(cancelReason || undefined)}
              disabled={cancelOrderMutation.isPending}
            >
              {cancelOrderMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Cancel Order & Email Suppliers
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel individual line item dialog */}
      <Dialog open={cancelLineItemIds.length > 0} onOpenChange={(open) => { if (!open) { setCancelLineItemIds([]); setCancelLineReason(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{cancelLineItemIds.length > 1 ? 'Cancel Line Items' : 'Cancel Line Item'}</DialogTitle>
            <DialogDescription>
              This will cancel {cancelLineItemIds.length > 1 ? `${cancelLineItemIds.length} selected line items` : 'the selected line item'}.
              For each affected supplier, one cancellation email will be sent with all cancelled lines from this action.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">Reason (optional)</label>
            <Textarea
              value={cancelLineReason}
              onChange={(e) => setCancelLineReason(e.target.value)}
              placeholder="Enter reason for cancellation..."
              className="min-h-[80px]"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setCancelLineItemIds([]); setCancelLineReason(''); }}
              disabled={cancelLineItemMutation.isPending}
            >
              Keep {cancelLineItemIds.length > 1 ? 'Items' : 'Item'}
            </Button>
            <Button
              variant="destructive"
              onClick={() => cancelLineItemIds.length > 0 && cancelLineItemMutation.mutate({ orderIds: cancelLineItemIds, reason: cancelLineReason || undefined })}
              disabled={cancelLineItemMutation.isPending}
            >
              {cancelLineItemMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Cancel {cancelLineItemIds.length > 1 ? 'Line Items' : 'Line Item'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
