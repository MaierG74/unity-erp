'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { PurchaseOrdersList } from '@/components/purchasing/purchase-orders-list';
import { PlusCircle, ArrowLeft } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableCell, TableHead, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import { ExternalLink } from 'lucide-react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

interface SupplierOrder {
  order_id: number;
  order_quantity: number;
  total_received: number;
  supplier_component?: {
    supplier?: {
      name: string;
    };
  };
}

interface PurchaseOrder {
  purchase_order_id: number;
  q_number?: string;
  created_at: string;
  status: {
    status_id: number;
    status_name: string;
  };
  supplier_orders: SupplierOrder[];
  suppliers: string[];
}

// Fetch purchase orders
async function fetchPurchaseOrders() {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select(`
      purchase_order_id,
      q_number,
      created_at,
      status_id,
      supplier_order_statuses!purchase_orders_status_id_fkey(
        status_id,
        status_name
      ),
      supplier_orders(
        order_id,
        order_quantity,
        total_received,
        supplier_component:suppliercomponents(
          supplier:suppliers(
            name
          )
        )
      )
    `)
    .order('created_at', { ascending: false });

  if (error) throw error;
  
  // Transform the data to match our types
  return (data as any[]).map(order => ({
    ...order,
    status: order.supplier_order_statuses, // Use the correctly joined status
    supplier_orders: order.supplier_orders || [],
    // Get unique supplier names
    suppliers: Array.from(new Set(
      (order.supplier_orders || [])
        .map((so: SupplierOrder) => so.supplier_component?.supplier?.name)
        .filter(Boolean)
    ))
  })) as PurchaseOrder[];
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
      variant = 'warning';    // Yellow/Orange
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

export default function PurchaseOrdersPage() {
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const { data: purchaseOrders } = useQuery({
    queryKey: ['purchaseOrders'],
    queryFn: fetchPurchaseOrders,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/purchasing">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Purchase Orders (Q Numbers)</h1>
      </div>
      
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground">
          Create purchase orders with multiple components that will be assigned Q numbers by the accounts department
        </p>
        <Link href="/purchasing/purchase-orders/new">
          <Button className="flex items-center gap-2">
            <PlusCircle className="h-4 w-4" />
            <span>New Purchase Order</span>
          </Button>
        </Link>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="flex-1">
              <Label>Filter by Status:</Label>
              <Select
                value={statusFilter}
                onValueChange={setStatusFilter}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="pending">Pending Approval</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="partial">Partially Received</SelectItem>
                  <SelectItem value="complete">Fully Received</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Q Number</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Suppliers</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {purchaseOrders?.map((order) => (
                <TableRow key={order.purchase_order_id}>
                  <TableCell>{order.q_number || 'Not assigned'}</TableCell>
                  <TableCell>{order.supplier_orders?.length || 0} items</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {order.suppliers?.map((supplier, index) => (
                        <Badge key={index} variant="outline" className="text-xs">
                          {supplier}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>{format(new Date(order.created_at), 'MMM d, yyyy')}</TableCell>
                  <TableCell>
                    <StatusBadge status={getOrderStatus(order)} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      asChild
                    >
                      <Link href={`/purchasing/purchase-orders/${order.purchase_order_id}`}>
                        View Details
                        <ExternalLink className="w-4 h-4 ml-2" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
} 