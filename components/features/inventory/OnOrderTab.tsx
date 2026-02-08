'use client';

import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { RefreshCw, Package, ExternalLink, Loader2 } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import Link from 'next/link';

type ComponentOnOrder = {
  component_id: number;
  internal_code: string;
  description: string | null;
  category: {
    categoryname: string;
  } | null;
  inventory: Array<{
    quantity_on_hand: number;
    reorder_level: number | null;
  }> | null;
  on_order_quantity: number;
  purchase_orders: Array<{
    po_id: number;
    order_number: string;
    pending_quantity: number;
  }>;
};

export function OnOrderTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch components with on-order quantities
  const { data: componentsOnOrder = [], isLoading, error } = useQuery({
    queryKey: ['inventory', 'on-order'],
    queryFn: async () => {
      try {
        // Get all components
        const { data: components, error: componentsError } = await supabase
          .from('components')
          .select(`
            component_id,
            internal_code,
            description,
            category:component_categories (
              categoryname
            ),
            inventory:inventory (
              quantity_on_hand,
              reorder_level
            )
          `)
          .order('internal_code');

        if (componentsError) throw componentsError;

        // Get open purchase orders with pending quantities
        const { data: supplierOrders, error: ordersError } = await supabase
          .from('supplier_orders')
          .select(`
            order_id,
            supplier_component_id,
            order_quantity,
            total_received,
            purchase_order_id,
            q_number,
            purchase_order:purchase_orders!inner (
              purchase_order_id,
              q_number
            ),
            suppliercomponents!inner (
              component_id
            ),
            status:supplier_order_statuses!inner (
              status_name
            )
          `)
          .in('status.status_name', [
            'Open',
            'In Progress',
            'Approved',
            'Partially Received',
            'Pending Approval',
          ]);

        if (ordersError) throw ordersError;

        // Calculate on-order quantities per component with PO details
        const onOrderByComponent = new Map<
          number,
          {
            total: number;
            orders: Array<{
              po_id: number;
              order_number: string;
              pending_quantity: number;
            }>;
          }
        >();

        if (supplierOrders) {
          supplierOrders.forEach((so: any) => {
            const componentId = so.suppliercomponents?.component_id;
            if (componentId) {
              const pending = (so.order_quantity || 0) - (so.total_received || 0);
              if (pending > 0) {
                const existing = onOrderByComponent.get(componentId);
                const poDetails = {
                  po_id: so.purchase_order_id,
                  order_number: so.q_number || 'N/A',
                  pending_quantity: pending,
                };

                if (existing) {
                  existing.total += pending;
                  existing.orders.push(poDetails);
                } else {
                  onOrderByComponent.set(componentId, {
                    total: pending,
                    orders: [poDetails],
                  });
                }
              }
            }
          });
        }

        // Filter components that have on-order quantities
        const componentsWithOrders = (components || [])
          .map((component: any) => {
            const onOrderData = onOrderByComponent.get(component.component_id);
            if (!onOrderData) return null;

            return {
              ...component,
              on_order_quantity: onOrderData.total,
              purchase_orders: onOrderData.orders,
            };
          })
          .filter((c): c is ComponentOnOrder => c !== null);

        return componentsWithOrders;
      } catch (e) {
        console.error('Error fetching on-order data:', e);
        throw e;
      }
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  const refreshData = () => {
    queryClient.invalidateQueries({ queryKey: ['inventory', 'on-order'] });
    toast({
      title: 'Data refreshed',
      description: 'On-order data has been refreshed from the database.',
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="text-destructive">Error loading data: {(error as Error).message}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Actions */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Components with pending quantities on purchase orders
        </p>
        <Button onClick={refreshData} className="h-9" variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm font-medium text-muted-foreground">Components on Order</p>
          </div>
          <p className="text-2xl font-bold mt-2">{componentsOnOrder.length}</p>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-blue-600" />
            <p className="text-sm font-medium text-muted-foreground">Total Pending Units</p>
          </div>
          <p className="text-2xl font-bold mt-2 text-blue-600">
            {componentsOnOrder.reduce((sum, c) => sum + c.on_order_quantity, 0)}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-amber-600" />
            <p className="text-sm font-medium text-muted-foreground">Purchase Orders</p>
          </div>
          <p className="text-2xl font-bold mt-2 text-amber-600">
            {componentsOnOrder.reduce(
              (sum, c) => sum + c.purchase_orders.length,
              0
            )}
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Component Code</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Current Stock</TableHead>
              <TableHead className="text-right">On Order</TableHead>
              <TableHead>Purchase Orders</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {componentsOnOrder.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-0">
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Package className="h-12 w-12 text-muted-foreground mb-3" />
                    <p className="text-lg font-medium">No components on order</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      All purchase order items have been fully received.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              componentsOnOrder.map((component) => {
                const inv = Array.isArray(component.inventory) ? component.inventory[0] : component.inventory;
                const currentStock = inv?.quantity_on_hand || 0;
                const reorderLevel = inv?.reorder_level || 0;
                const isLowStock = currentStock <= reorderLevel && currentStock > 0;
                const isOutOfStock = currentStock <= 0;

                return (
                  <TableRow key={component.component_id}>
                    <TableCell className="font-medium">
                      {component.internal_code}
                    </TableCell>
                    <TableCell>{component.description || '-'}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {component.category?.categoryname || 'Uncategorized'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={cn(
                          isOutOfStock && 'text-destructive font-semibold',
                          isLowStock && 'text-amber-500 font-semibold'
                        )}
                      >
                        {currentStock}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-blue-600 font-semibold">
                        {component.on_order_quantity}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        {component.purchase_orders.map((po, idx) => (
                          <Link
                            key={idx}
                            href={`/purchasing/purchase-orders/${po.po_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
                          >
                            PO {po.order_number} ({po.pending_quantity} units)
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

