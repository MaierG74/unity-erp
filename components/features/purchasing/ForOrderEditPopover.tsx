'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { useToast } from '@/components/ui/use-toast';
import { Check, Pencil, Package, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';

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

interface ForOrderEditPopoverProps {
  supplierOrderId: number;
  purchaseOrderId: string | number;
  orderQuantity: number;
  customerOrderLinks: CustomerOrderLink[];
  disabled?: boolean;
}

async function logPOActivity(params: {
  purchaseOrderId: string | number;
  actionType: string;
  description: string;
  metadata?: Record<string, unknown>;
}) {
  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from('purchase_order_activity').insert({
    purchase_order_id: Number(params.purchaseOrderId),
    action_type: params.actionType,
    description: params.description,
    metadata: params.metadata || {},
    performed_by: user?.id || null,
  });
}

export function ForOrderEditPopover({
  supplierOrderId,
  purchaseOrderId,
  orderQuantity,
  customerOrderLinks,
  disabled = false,
}: ForOrderEditPopoverProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Current allocation state
  const currentOrderLink = customerOrderLinks.find(l => l.customer_order);
  const currentStockOnly = customerOrderLinks.some(l => !l.customer_order && Number(l.quantity_for_stock) > 0);
  const hasMultipleOrders = customerOrderLinks.filter(l => l.customer_order).length > 1;

  // Fetch available customer orders
  const { data: customerOrders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ['activeCustomerOrders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('order_id, order_number, customer:customers(name)')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []).map((o: any) => ({
        orderId: o.order_id as number,
        orderNumber: (o.order_number || String(o.order_id)) as string,
        customerName: (o.customer?.name || 'Unknown') as string,
      }));
    },
    enabled: open,
    staleTime: 30_000,
  });

  // Mutation to change the "For Order" allocation
  const updateAllocationMutation = useMutation({
    mutationFn: async (params: { type: 'order'; orderId: number; orderNumber: string } | { type: 'stock' } | { type: 'clear' }) => {
      // Build description for activity log
      const oldDisplay = currentOrderLink?.customer_order
        ? currentOrderLink.customer_order.order_number
        : currentStockOnly ? 'Stock' : '—';

      // Delete existing junction records for this supplier order
      const { error: deleteError } = await supabase
        .from('supplier_order_customer_orders')
        .delete()
        .eq('supplier_order_id', supplierOrderId);

      if (deleteError) throw new Error(`Failed to clear allocation: ${deleteError.message}`);

      if (params.type === 'order') {
        // Insert new allocation to customer order
        const { error: insertError } = await supabase
          .from('supplier_order_customer_orders')
          .insert({
            supplier_order_id: supplierOrderId,
            order_id: params.orderId,
            quantity_for_order: orderQuantity,
            quantity_for_stock: 0,
          });
        if (insertError) throw new Error(`Failed to set allocation: ${insertError.message}`);

        await logPOActivity({
          purchaseOrderId,
          actionType: 'for_order_changed',
          description: `Changed "For Order" from ${oldDisplay} to ${params.orderNumber}`,
          metadata: {
            supplier_order_id: supplierOrderId,
            old_value: oldDisplay,
            new_value: params.orderNumber,
            new_order_id: params.orderId,
          },
        });
      } else if (params.type === 'stock') {
        // Insert stock-only allocation
        const { error: insertError } = await supabase
          .from('supplier_order_customer_orders')
          .insert({
            supplier_order_id: supplierOrderId,
            order_id: null,
            quantity_for_order: 0,
            quantity_for_stock: orderQuantity,
          });
        if (insertError) throw new Error(`Failed to set stock allocation: ${insertError.message}`);

        await logPOActivity({
          purchaseOrderId,
          actionType: 'for_order_changed',
          description: `Changed "For Order" from ${oldDisplay} to Stock`,
          metadata: {
            supplier_order_id: supplierOrderId,
            old_value: oldDisplay,
            new_value: 'Stock',
          },
        });
      } else {
        // Clear — just log it, records already deleted
        await logPOActivity({
          purchaseOrderId,
          actionType: 'for_order_changed',
          description: `Cleared "For Order" (was ${oldDisplay})`,
          metadata: {
            supplier_order_id: supplierOrderId,
            old_value: oldDisplay,
            new_value: null,
          },
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrder', String(purchaseOrderId)] });
      queryClient.invalidateQueries({ queryKey: ['purchaseOrderActivity', String(purchaseOrderId)] });
      setOpen(false);
      toast({ title: 'Allocation updated', description: 'The "For Order" assignment has been updated.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
    },
  });

  // If this line has multiple orders, show a read-only display with a note
  // (multi-order editing is not supported in this flow)
  if (hasMultipleOrders) {
    return <MultiOrderDisplay customerOrderLinks={customerOrderLinks} />;
  }

  // Render the current display value + pencil trigger
  const currentDisplay = currentOrderLink?.customer_order ? (
    <Link
      href={`/orders/${currentOrderLink.customer_order.order_id}`}
      target="_blank"
      className="text-blue-600 hover:underline text-sm"
      onClick={(e) => e.stopPropagation()}
    >
      {currentOrderLink.customer_order.order_number}
    </Link>
  ) : currentStockOnly ? (
    <Badge variant="outline" className="text-xs">Stock</Badge>
  ) : (
    <span className="text-muted-foreground text-sm">—</span>
  );

  return (
    <div className="flex items-center gap-1">
      {currentDisplay}
      {!disabled && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
              onClick={(e) => e.stopPropagation()}
            >
              <Pencil className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="start" side="bottom">
            <Command>
              <CommandInput placeholder="Search orders..." />
              <CommandList>
                <CommandEmpty>
                  {ordersLoading ? 'Loading orders...' : 'No orders found.'}
                </CommandEmpty>
                <CommandGroup heading="Actions">
                  <CommandItem
                    onSelect={() => updateAllocationMutation.mutate({ type: 'stock' })}
                    disabled={updateAllocationMutation.isPending}
                  >
                    <Package className="mr-2 h-4 w-4" />
                    Set as Stock
                    {currentStockOnly && !currentOrderLink && (
                      <Check className="ml-auto h-4 w-4" />
                    )}
                  </CommandItem>
                  {(currentOrderLink || currentStockOnly) && (
                    <CommandItem
                      onSelect={() => updateAllocationMutation.mutate({ type: 'clear' })}
                      disabled={updateAllocationMutation.isPending}
                    >
                      <X className="mr-2 h-4 w-4" />
                      Clear allocation
                    </CommandItem>
                  )}
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading="Customer Orders">
                  {customerOrders.map((order) => (
                    <CommandItem
                      key={order.orderId}
                      value={`${order.orderNumber} ${order.customerName}`}
                      onSelect={() =>
                        updateAllocationMutation.mutate({
                          type: 'order',
                          orderId: order.orderId,
                          orderNumber: order.orderNumber,
                        })
                      }
                      disabled={updateAllocationMutation.isPending}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          currentOrderLink?.customer_order?.order_id === order.orderId
                            ? 'opacity-100'
                            : 'opacity-0'
                        )}
                      />
                      <div className="flex flex-col">
                        <span className="text-sm">{order.orderNumber}</span>
                        <span className="text-xs text-muted-foreground">{order.customerName}</span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

// Read-only display for multi-order allocations (unchanged from original)
function MultiOrderDisplay({ customerOrderLinks }: { customerOrderLinks: CustomerOrderLink[] }) {
  const orderLinks = customerOrderLinks.filter(link => link.customer_order);
  const totalStock = customerOrderLinks.reduce((sum, link) => sum + Number(link.quantity_for_stock || 0), 0);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-auto py-1 px-2 text-sm">
          <span className="text-blue-600">{orderLinks.length} orders</span>
          {totalStock > 0 && (
            <Badge variant="outline" className="ml-1 text-xs">+{totalStock}</Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground mb-2">Allocated to:</p>
          {orderLinks.map((link) => (
            <div key={link.id} className="flex items-center justify-between gap-4 text-sm">
              <Link
                href={`/orders/${link.customer_order!.order_id}`}
                target="_blank"
                className="text-blue-600 hover:underline"
              >
                {link.customer_order!.order_number || link.customer_order!.order_id}
              </Link>
              <span className="text-muted-foreground">{link.quantity_for_order} units</span>
            </div>
          ))}
          {totalStock > 0 && (
            <div className="flex items-center justify-between gap-4 text-sm border-t pt-1 mt-1">
              <span className="text-muted-foreground">Stock</span>
              <span className="text-muted-foreground">{totalStock} units</span>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
