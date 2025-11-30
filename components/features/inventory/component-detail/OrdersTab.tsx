'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ShoppingCart, Package, AlertCircle, Loader2, Mail, CheckCircle2 } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Link from 'next/link';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

type ComponentData = {
  component_id: number;
  on_order_quantity?: number;
  required_for_orders?: number;
};

type OrdersTabProps = {
  component: ComponentData;
};

export function OrdersTab({ component }: OrdersTabProps) {
  const queryClient = useQueryClient();
  const [sendingFollowUp, setSendingFollowUp] = useState<number | null>(null);
  const [responseDialogOpen, setResponseDialogOpen] = useState(false);
  const [selectedResponse, setSelectedResponse] = useState<any>(null);

  // Send follow-up email for a specific purchase order
  const sendFollowUpEmail = async (purchaseOrderId: number, qNumber: string) => {
    setSendingFollowUp(purchaseOrderId);
    try {
      const response = await fetch('/api/send-po-follow-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purchaseOrderId }),
      });

      const result = await response.json();

      if (result.success) {
        toast.success('Follow-up Sent', {
          description: result.message,
        });
        // Refresh follow-up data
        queryClient.invalidateQueries({ queryKey: ['purchaseOrderFollowUps', purchaseOrderId] });
        queryClient.invalidateQueries({ queryKey: ['component', component.component_id, 'follow-ups'] });
      } else {
        toast.error('Failed to send follow-up', {
          description: result.error || 'Unknown error',
        });
      }
    } catch (error: any) {
      toast.error('Error', {
        description: error.message || 'Failed to send follow-up email',
      });
    } finally {
      setSendingFollowUp(null);
    }
  };

  // Fetch purchase orders
  const { data: purchaseOrders = [], isLoading: isLoadingPO } = useQuery({
    queryKey: ['component', component.component_id, 'purchase-orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('supplier_orders')
        .select(`
          order_id,
          order_quantity,
          total_received,
          purchase_order_id,
          purchase_order:purchase_orders!inner (
            purchase_order_id,
            q_number
          ),
          status:supplier_order_statuses!inner (
            status_name
          ),
          suppliercomponents!inner (
            component_id,
            supplier_code
          )
        `)
        .eq('suppliercomponents.component_id', component.component_id)
        .in('status.status_name', ['Open', 'In Progress', 'Approved', 'Partially Received', 'Pending Approval']);

      if (error) throw error;
      return data;
    },
  });

  // Calculate distinct purchase orders count
  const distinctPOs = new Set(
    purchaseOrders
      .map((po: any) => po.purchase_order_id)
      .filter(Boolean)
  ).size;

  // Fetch products where this component is used (BOM)
  const { data: products = [], isLoading: isLoadingProducts } = useQuery({
    queryKey: ['component', component.component_id, 'products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('billofmaterials')
        .select(`
          quantity_required,
          product:products (
            product_id,
            internal_code,
            name
          )
        `)
        .eq('component_id', component.component_id);

      if (error) throw error;
      return data;
    },
  });

  // Fetch active orders requiring this component
  const { data: activeOrders = [], isLoading: isLoadingOrders } = useQuery({
    queryKey: ['component', component.component_id, 'active-orders'],
    queryFn: async () => {
      // Get products that use this component
      const productIds = products.map((p: any) => p.product?.product_id).filter(Boolean);

      if (productIds.length === 0) return [];

      const { data, error } = await supabase
        .from('order_details')
        .select(`
          quantity,
          order:orders!inner (
            order_id,
            order_number,
            order_date,
            status:order_statuses (
              status_name
            )
          ),
          product:products!inner (
            product_id,
            internal_code,
            name,
            billofmaterials (
              component_id,
              quantity_required
            )
          )
        `)
        .in('product_id', productIds)
        .not('order.status.status_name', 'in', '(Completed,Cancelled)');

      if (error) throw error;

      // Filter to only orders with this specific component
      return data.filter((od: any) => {
        const bom = od.product?.billofmaterials || [];
        return bom.some((b: any) => b.component_id === component.component_id);
      });
    },
    enabled: products.length > 0,
  });

  // Get unique PO IDs for follow-up query
  const poIds = [...new Set(purchaseOrders.map((po: any) => po.purchase_order_id).filter(Boolean))];

  // Fetch follow-up responses for these purchase orders
  const { data: followUpResponses = [] } = useQuery({
    queryKey: ['component', component.component_id, 'follow-ups', poIds],
    queryFn: async () => {
      if (poIds.length === 0) return [];
      
      const { data, error } = await supabase
        .from('component_follow_up_emails')
        .select(`
          id,
          purchase_order_id,
          supplier_name,
          sent_at,
          status,
          response:supplier_follow_up_responses(
            status,
            expected_delivery_date,
            notes,
            responded_at
          )
        `)
        .in('purchase_order_id', poIds)
        .order('sent_at', { ascending: false });

      if (error) throw error;
      
      // Normalize response (Supabase returns array for 1-to-many)
      return (data || []).map((item: any) => ({
        ...item,
        response: Array.isArray(item.response) ? item.response[0] : item.response
      }));
    },
    enabled: poIds.length > 0,
  });

  // Create a map of PO ID to latest follow-up response
  const followUpByPO = new Map<number, any>();
  for (const followUp of followUpResponses) {
    if (followUp.purchase_order_id && !followUpByPO.has(followUp.purchase_order_id)) {
      followUpByPO.set(followUp.purchase_order_id, followUp);
    }
  }

  const isLoading = isLoadingPO || isLoadingProducts || isLoadingOrders;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">On Order</CardTitle>
            <ShoppingCart className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {component.on_order_quantity || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {distinctPOs} purchase order{distinctPOs !== 1 ? 's' : ''}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Required</CardTitle>
            <AlertCircle className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">
              {component.required_for_orders || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              For {activeOrders.length} active orders
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Used In</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{products.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Product(s)</p>
          </CardContent>
        </Card>
      </div>

      {/* Purchase Orders */}
      {purchaseOrders.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Purchase Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <TooltipProvider>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>PO Number</TableHead>
                    <TableHead>Supplier Code</TableHead>
                    <TableHead className="text-right">Ordered</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                    <TableHead className="text-right">Pending</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchaseOrders.map((po: any) => {
                    const pending = (po.order_quantity || 0) - (po.total_received || 0);
                    const followUp = followUpByPO.get(po.purchase_order_id);
                    const hasResponse = followUp?.response?.responded_at;
                    const isSending = sendingFollowUp === po.purchase_order_id;
                    const qNumber = po.purchase_order?.q_number || `PO #${po.purchase_order_id}`;
                    
                    return (
                      <TableRow key={po.order_id}>
                        <TableCell>
                          <Link
                            href={`/purchasing/purchase-orders/${po.purchase_order_id}`}
                            className="text-blue-600 hover:underline font-medium"
                          >
                            {qNumber}
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {po.suppliercomponents?.supplier_code || '-'}
                        </TableCell>
                        <TableCell className="text-right">{po.order_quantity || 0}</TableCell>
                        <TableCell className="text-right">{po.total_received || 0}</TableCell>
                        <TableCell className="text-right font-semibold text-blue-600">
                          {pending}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{po.status?.status_name || 'Unknown'}</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-2">
                            {/* Follow-up button */}
                            {pending > 0 && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 px-2 text-blue-600 border-blue-300 hover:bg-blue-50"
                                    onClick={() => sendFollowUpEmail(po.purchase_order_id, qNumber)}
                                    disabled={isSending}
                                  >
                                    {isSending ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Mail className="h-4 w-4" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Send follow-up email to supplier</p>
                                </TooltipContent>
                              </Tooltip>
                            )}
                            {/* Response indicator - clickable to view full response */}
                            {hasResponse && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    className="flex items-center p-1 rounded hover:bg-green-50 transition-colors"
                                    onClick={() => {
                                      setSelectedResponse({ ...followUp, qNumber });
                                      setResponseDialogOpen(true);
                                    }}
                                  >
                                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="text-xs">Click to view full response</p>
                                </TooltipContent>
                              </Tooltip>
                            )}
                            {/* Sent indicator (no response yet) */}
                            {followUp && !hasResponse && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex items-center">
                                    <Mail className="h-4 w-4 text-amber-500" />
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <div className="text-xs">
                                    <p className="font-medium">Follow-up sent</p>
                                    <p className="text-muted-foreground">
                                      {format(new Date(followUp.sent_at), 'PP')} - Awaiting response
                                    </p>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TooltipProvider>
          </CardContent>
        </Card>
      )}

      {/* Products Using This Component */}
      {products.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Bill of Materials</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product Code</TableHead>
                  <TableHead>Product Name</TableHead>
                  <TableHead className="text-right">Qty Required per Unit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((bom: any, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-mono">
                      {bom.product?.internal_code || '-'}
                    </TableCell>
                    <TableCell>{bom.product?.name || '-'}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {bom.quantity_required}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Active Orders Requiring This Component */}
      {activeOrders.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Active Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order Number</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Order Qty</TableHead>
                  <TableHead className="text-right">Components Needed</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeOrders.map((orderDetail: any, index: number) => {
                  const bom = orderDetail.product?.billofmaterials?.find(
                    (b: any) => b.component_id === component.component_id
                  );
                  const needed = (orderDetail.quantity || 0) * (bom?.quantity_required || 0);

                  return (
                    <TableRow key={`${orderDetail.order?.order_id}-${orderDetail.product?.product_id}-${index}`}>
                      <TableCell>
                        <Link
                          href={`/orders/${orderDetail.order?.order_id}`}
                          className="text-blue-600 hover:underline font-medium"
                        >
                          {orderDetail.order?.order_number || 'N/A'}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {orderDetail.product?.internal_code} - {orderDetail.product?.name}
                      </TableCell>
                      <TableCell className="text-right">{orderDetail.quantity}</TableCell>
                      <TableCell className="text-right font-semibold text-purple-600">
                        {needed}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {orderDetail.order?.status?.status_name || 'Unknown'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {purchaseOrders.length === 0 &&
        products.length === 0 &&
        activeOrders.length === 0 && (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center text-muted-foreground py-8">
                <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No orders or products associated with this component.</p>
              </div>
            </CardContent>
          </Card>
        )}

      {/* Supplier Response Dialog */}
      <Dialog open={responseDialogOpen} onOpenChange={setResponseDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              Supplier Response
            </DialogTitle>
          </DialogHeader>
          {selectedResponse && (
            <div className="space-y-4">
              {/* PO Reference */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Purchase Order</span>
                <Link 
                  href={`/purchasing/purchase-orders/${selectedResponse.purchase_order_id}`}
                  className="font-medium text-blue-600 hover:underline"
                >
                  {selectedResponse.qNumber}
                </Link>
              </div>

              {/* Supplier */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Supplier</span>
                <span className="font-medium">{selectedResponse.supplier_name}</span>
              </div>

              {/* Status */}
              {selectedResponse.response?.status && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Status</span>
                  <Badge 
                    variant="outline"
                    className={cn(
                      selectedResponse.response.status === 'on_track' && 'bg-green-50 border-green-300 text-green-700',
                      selectedResponse.response.status === 'delayed' && 'bg-amber-50 border-amber-300 text-amber-700',
                      selectedResponse.response.status === 'issue' && 'bg-red-50 border-red-300 text-red-700'
                    )}
                  >
                    {selectedResponse.response.status === 'on_track' && 'On Track'}
                    {selectedResponse.response.status === 'delayed' && 'Delayed'}
                    {selectedResponse.response.status === 'issue' && 'Issue'}
                    {!['on_track', 'delayed', 'issue'].includes(selectedResponse.response.status) && selectedResponse.response.status}
                  </Badge>
                </div>
              )}

              {/* Expected Delivery Date - always show, indicate if not provided */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Expected Delivery</span>
                {selectedResponse.response?.expected_delivery_date ? (
                  <span className="font-medium">
                    {format(new Date(selectedResponse.response.expected_delivery_date), 'PPP')}
                  </span>
                ) : (
                  <span className="text-muted-foreground italic">Not provided</span>
                )}
              </div>

              {/* Response Date */}
              {selectedResponse.response?.responded_at && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Responded</span>
                  <span className="text-muted-foreground">
                    {format(new Date(selectedResponse.response.responded_at), 'PPP · p')}
                  </span>
                </div>
              )}

              {/* Notes */}
              {selectedResponse.response?.notes && (
                <div className="pt-2 border-t">
                  <p className="text-sm text-muted-foreground mb-1">Notes from Supplier</p>
                  <div className="bg-muted/50 rounded-md p-3">
                    <p className="text-sm whitespace-pre-wrap">{selectedResponse.response.notes}</p>
                  </div>
                </div>
              )}

              {/* Follow-up sent date */}
              {selectedResponse.sent_at && (
                <div className="pt-2 border-t text-xs text-muted-foreground">
                  Follow-up sent: {format(new Date(selectedResponse.sent_at), 'PPP · p')}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

