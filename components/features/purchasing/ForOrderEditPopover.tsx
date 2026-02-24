'use client';

import { useState, useCallback } from 'react';
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
import { Check, Pencil, Package, X, Plus, Split } from 'lucide-react';
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

type AllocationRow = {
  customer_order_id: number | null;
  quantity: number;
};

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
  const [editMode, setEditMode] = useState<'single' | 'split'>('single');
  const [allocations, setAllocations] = useState<AllocationRow[]>([]);
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

  // Initialize split mode from current links
  const enterSplitMode = useCallback(() => {
    const rows: AllocationRow[] = customerOrderLinks
      .filter(l => l.customer_order)
      .map(l => ({
        customer_order_id: l.customer_order!.order_id,
        quantity: Number(l.quantity_for_order),
      }));
    if (rows.length === 0) {
      rows.push({ customer_order_id: null, quantity: orderQuantity });
    }
    setAllocations(rows);
    setEditMode('split');
  }, [customerOrderLinks, orderQuantity]);

  // Single-order mutation (existing behavior)
  const updateAllocationMutation = useMutation({
    mutationFn: async (params: { type: 'order'; orderId: number; orderNumber: string } | { type: 'stock' } | { type: 'clear' }) => {
      const oldDisplay = currentOrderLink?.customer_order
        ? currentOrderLink.customer_order.order_number
        : currentStockOnly ? 'Stock' : '—';

      const { error: deleteError } = await supabase
        .from('supplier_order_customer_orders')
        .delete()
        .eq('supplier_order_id', supplierOrderId);

      if (deleteError) throw new Error(`Failed to clear allocation: ${deleteError.message}`);

      if (params.type === 'order') {
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
          metadata: { supplier_order_id: supplierOrderId, old_value: oldDisplay, new_value: params.orderNumber, new_order_id: params.orderId },
        });
      } else if (params.type === 'stock') {
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
          metadata: { supplier_order_id: supplierOrderId, old_value: oldDisplay, new_value: 'Stock' },
        });
      } else {
        await logPOActivity({
          purchaseOrderId,
          actionType: 'for_order_changed',
          description: `Cleared "For Order" (was ${oldDisplay})`,
          metadata: { supplier_order_id: supplierOrderId, old_value: oldDisplay, new_value: null },
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

  // Multi-order save mutation
  const saveSplitMutation = useMutation({
    mutationFn: async (rows: AllocationRow[]) => {
      const oldDisplay = hasMultipleOrders
        ? `${customerOrderLinks.filter(l => l.customer_order).length} orders`
        : currentOrderLink?.customer_order
          ? currentOrderLink.customer_order.order_number
          : currentStockOnly ? 'Stock' : '—';

      // Delete all existing junction records
      const { error: deleteError } = await supabase
        .from('supplier_order_customer_orders')
        .delete()
        .eq('supplier_order_id', supplierOrderId);
      if (deleteError) throw new Error(`Failed to clear allocations: ${deleteError.message}`);

      const allocSum = rows.reduce((sum, r) => sum + (r.quantity || 0), 0);
      const stockRemaining = Math.max(0, orderQuantity - allocSum);

      // Insert order allocations
      const orderRows = rows.filter(r => r.customer_order_id && r.quantity > 0);
      if (orderRows.length > 0) {
        const { error: insertError } = await supabase
          .from('supplier_order_customer_orders')
          .insert(
            orderRows.map(r => ({
              supplier_order_id: supplierOrderId,
              order_id: r.customer_order_id,
              quantity_for_order: r.quantity,
              quantity_for_stock: 0,
            }))
          );
        if (insertError) throw new Error(`Failed to save allocations: ${insertError.message}`);
      }

      // Insert stock remainder
      if (stockRemaining > 0 || orderRows.length === 0) {
        const { error: stockError } = await supabase
          .from('supplier_order_customer_orders')
          .insert({
            supplier_order_id: supplierOrderId,
            order_id: null,
            quantity_for_order: 0,
            quantity_for_stock: orderRows.length === 0 ? orderQuantity : stockRemaining,
          });
        if (stockError) throw new Error(`Failed to save stock allocation: ${stockError.message}`);
      }

      // Build new display for activity log
      const newParts = orderRows.map(r => {
        const order = customerOrders.find(o => o.orderId === r.customer_order_id);
        return `${order?.orderNumber || r.customer_order_id} (${r.quantity})`;
      });
      if (stockRemaining > 0) newParts.push(`Stock (${stockRemaining})`);

      await logPOActivity({
        purchaseOrderId,
        actionType: 'for_order_changed',
        description: `Changed allocation from ${oldDisplay} to ${newParts.join(', ')}`,
        metadata: {
          supplier_order_id: supplierOrderId,
          old_value: oldDisplay,
          new_allocations: rows,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrder', String(purchaseOrderId)] });
      queryClient.invalidateQueries({ queryKey: ['purchaseOrderActivity', String(purchaseOrderId)] });
      setOpen(false);
      setEditMode('single');
      toast({ title: 'Allocation updated', description: 'Split allocations saved.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
    },
  });

  // Render current display
  if (hasMultipleOrders) {
    return (
      <MultiOrderEditableDisplay
        customerOrderLinks={customerOrderLinks}
        orderQuantity={orderQuantity}
        disabled={disabled}
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (v) enterSplitMode();
          else setEditMode('single');
        }}
        editMode={editMode}
        allocations={allocations}
        setAllocations={setAllocations}
        customerOrders={customerOrders}
        ordersLoading={ordersLoading}
        saving={saveSplitMutation.isPending}
        onSave={() => saveSplitMutation.mutate(allocations)}
        onCancel={() => { setOpen(false); setEditMode('single'); }}
      />
    );
  }

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
        <Popover open={open} onOpenChange={(v) => {
          setOpen(v);
          if (!v) setEditMode('single');
        }}>
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
          <PopoverContent className={editMode === 'split' ? 'w-80 p-3' : 'w-72 p-0'} align="start" side="bottom">
            {editMode === 'split' ? (
              <SplitEditor
                allocations={allocations}
                setAllocations={setAllocations}
                totalQuantity={orderQuantity}
                customerOrders={customerOrders}
                ordersLoading={ordersLoading}
                saving={saveSplitMutation.isPending}
                onSave={() => saveSplitMutation.mutate(allocations)}
                onCancel={() => { setOpen(false); setEditMode('single'); }}
              />
            ) : (
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
                    <CommandItem
                      onSelect={() => {
                        const rows: AllocationRow[] = currentOrderLink?.customer_order
                          ? [{ customer_order_id: currentOrderLink.customer_order.order_id, quantity: orderQuantity }]
                          : [];
                        setAllocations(rows);
                        setEditMode('split');
                      }}
                      disabled={updateAllocationMutation.isPending}
                    >
                      <Split className="mr-2 h-4 w-4" />
                      Split across orders
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
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

// Split editor used in popover content
function SplitEditor({
  allocations,
  setAllocations,
  totalQuantity,
  customerOrders,
  ordersLoading,
  saving,
  onSave,
  onCancel,
}: {
  allocations: AllocationRow[];
  setAllocations: (rows: AllocationRow[]) => void;
  totalQuantity: number;
  customerOrders: { orderId: number; orderNumber: string; customerName: string }[];
  ordersLoading: boolean;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const allocSum = allocations.reduce((sum, r) => sum + (r.quantity || 0), 0);
  const remaining = Math.max(0, totalQuantity - allocSum);
  const overAllocated = allocSum > totalQuantity;
  const usedOrderIds = new Set(allocations.map(a => a.customer_order_id).filter(Boolean));
  const hasInvalidRows = allocations.some(a => !a.customer_order_id || a.quantity <= 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">Split Allocation</p>
        <span className="text-xs text-muted-foreground">Total: {totalQuantity}</span>
      </div>
      <div className="space-y-2">
        {allocations.map((alloc, idx) => {
          const orderInfo = customerOrders.find(o => o.orderId === alloc.customer_order_id);
          return (
            <div key={idx} className="flex items-center gap-2">
              <select
                className="flex-1 h-8 rounded-md border border-input bg-background px-2 text-xs"
                value={alloc.customer_order_id || ''}
                onChange={(e) => {
                  const next = [...allocations];
                  next[idx] = { ...next[idx], customer_order_id: e.target.value ? Number(e.target.value) : null };
                  setAllocations(next);
                }}
                disabled={saving}
              >
                <option value="">Select order...</option>
                {customerOrders
                  .filter(o => o.orderId === alloc.customer_order_id || !usedOrderIds.has(o.orderId))
                  .map(o => (
                    <option key={o.orderId} value={o.orderId}>
                      {o.orderNumber} - {o.customerName}
                    </option>
                  ))}
              </select>
              <input
                type="number"
                className={`w-16 h-8 rounded-md border ${overAllocated ? 'border-destructive' : 'border-input'} bg-background px-2 text-xs text-right`}
                min="0.01"
                step="any"
                value={alloc.quantity || ''}
                onChange={(e) => {
                  const next = [...allocations];
                  next[idx] = { ...next[idx], quantity: parseFloat(e.target.value) || 0 };
                  setAllocations(next);
                }}
                disabled={saving}
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 flex-shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => setAllocations(allocations.filter((_, i) => i !== idx))}
                disabled={saving}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between">
        <span className={`text-xs ${overAllocated ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
          {overAllocated
            ? `Over by ${(allocSum - totalQuantity).toFixed(1)}`
            : remaining > 0
              ? `Stock: ${remaining % 1 === 0 ? remaining : remaining.toFixed(1)} remaining`
              : 'Fully allocated'}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => setAllocations([...allocations, { customer_order_id: null, quantity: 0 }])}
          disabled={saving}
        >
          <Plus className="h-3 w-3 mr-1" />
          Add
        </Button>
      </div>
      <div className="flex justify-end gap-2 pt-1 border-t">
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={onSave}
          disabled={saving || overAllocated || hasInvalidRows}
        >
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

// Editable multi-order display (replaces the old read-only MultiOrderDisplay)
function MultiOrderEditableDisplay({
  customerOrderLinks,
  orderQuantity,
  disabled,
  open,
  onOpenChange,
  editMode,
  allocations,
  setAllocations,
  customerOrders,
  ordersLoading,
  saving,
  onSave,
  onCancel,
}: {
  customerOrderLinks: CustomerOrderLink[];
  orderQuantity: number;
  disabled: boolean;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editMode: 'single' | 'split';
  allocations: AllocationRow[];
  setAllocations: (rows: AllocationRow[]) => void;
  customerOrders: { orderId: number; orderNumber: string; customerName: string }[];
  ordersLoading: boolean;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const orderLinks = customerOrderLinks.filter(link => link.customer_order);
  const totalStock = customerOrderLinks.reduce((sum, link) => sum + Number(link.quantity_for_stock || 0), 0);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-auto py-1 px-2 text-sm" disabled={disabled}>
          <span className="text-blue-600">{orderLinks.length} orders</span>
          {totalStock > 0 && (
            <Badge variant="outline" className="ml-1 text-xs">+{totalStock}</Badge>
          )}
          {!disabled && <Pencil className="ml-1 h-3 w-3 text-muted-foreground" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" align="start">
        <SplitEditor
          allocations={allocations}
          setAllocations={setAllocations}
          totalQuantity={orderQuantity}
          customerOrders={customerOrders}
          ordersLoading={ordersLoading}
          saving={saving}
          onSave={onSave}
          onCancel={onCancel}
        />
      </PopoverContent>
    </Popover>
  );
}
