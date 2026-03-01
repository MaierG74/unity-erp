'use client';

import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
  fetchOrderComponentRequirements,
  fetchComponentSuppliers,
  createComponentPurchaseOrders,
  SupplierOrderCreationError,
} from '@/lib/queries/order-components';
import type {
  SupplierGroup,
  SupplierComponent,
  SupplierOrderLinePayload,
  SupplierOrderCreationSuccess,
  SupplierOrderCreationFailure,
  SupplierOrderCreationSummary,
} from '@/lib/queries/order-components';
import { formatCurrency } from '@/lib/format-utils';
import { ConsolidatePODialog, SupplierWithDrafts, ExistingDraftPO } from '@/components/features/purchasing/ConsolidatePODialog';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableCell, TableHead, TableRow, TableFooter } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, ChevronDown, AlertCircle, Info, Users } from 'lucide-react';
import { toast } from 'sonner';

export const OrderComponentsDialog = ({
  orderId,
  open,
  onOpenChange,
  onCreated
}: {
  orderId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}) => {
  const [step, setStep] = useState<'select' | 'review'>('select');
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [selectedComponents, setSelectedComponents] = useState<Record<number, boolean>>({});
  const [orderQuantities, setOrderQuantities] = useState<Record<number, number>>({});
  const [allocation, setAllocation] = useState<Record<number, { forThisOrder: number; forStock: number }>>({});
  const [apparentShortfallExists, setApparentShortfallExists] = useState(false);
  const [creationFailures, setCreationFailures] = useState<SupplierOrderCreationFailure[] | null>(null);
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});
  const [consolidateDialogOpen, setConsolidateDialogOpen] = useState(false);
  const [suppliersWithDrafts, setSuppliersWithDrafts] = useState<SupplierWithDrafts[]>([]);
  const [pendingConsolidationPayload, setPendingConsolidationPayload] = useState<any>(null);
  const queryClient = useQueryClient();

  // Group components by supplier
  const { data, isLoading, isError, error, refetch } = useQuery<SupplierGroup[]>({
    queryKey: ['component-suppliers', orderId],
    queryFn: () => fetchComponentSuppliers(Number(orderId)),
    // Refetch when dialog opens to ensure fresh data
    refetchOnMount: true,
    staleTime: 0, // Always consider data stale so it refetches when dialog opens
    enabled: open, // Only fetch when dialog is open
  });

  // Force refetch when dialog opens
  useEffect(() => {
    if (open) {
      refetch();
    }
  }, [open, refetch]);

  useEffect(() => {
    if (data) {
      // Check if there are components with apparent shortfall but no real shortfall
      const checkApparentShortfall = async () => {
        try {
          const requirements = await fetchOrderComponentRequirements(Number(orderId));
          const hasApparentShortfall = requirements.some(req =>
            req.components.some(comp => comp.apparent_shortfall > 0 && comp.real_shortfall === 0)
          );
          setApparentShortfallExists(hasApparentShortfall);
        } catch (err) {
          console.error("Error checking for apparent shortfall:", err);
        }
      };

      checkApparentShortfall();

      // Initialize order quantities with shortfall values when data is loaded
      const quantities: Record<number, number> = {};
      const newAllocation: Record<number, { forThisOrder: number; forStock: number }> = {};

      data.forEach(group => {
        group.components.forEach(component => {
          // Use supplier_component_id as key to distinguish same component across different suppliers
          const key = component.selectedSupplier.supplier_component_id;
          const perOrderShortfall = component.shortfall;
          const globalShortfall = component.global_real_shortfall || 0;

          // Default quantity: use global shortfall if no per-order shortfall
          const defaultQuantity = perOrderShortfall > 0 ? perOrderShortfall : globalShortfall;
          quantities[key] = defaultQuantity;

          // Smart allocation: per-order shortfall goes to "forThisOrder", global-only goes to "forStock"
          if (perOrderShortfall > 0) {
            newAllocation[key] = {
              forThisOrder: perOrderShortfall,
              forStock: 0
            };
          } else {
            // Global-only shortfall: allocate to stock
            newAllocation[key] = {
              forThisOrder: 0,
              forStock: globalShortfall
            };
          }
        });
      });

      setOrderQuantities(quantities);
      setAllocation(newAllocation);
    }
  }, [data, orderId]);

  const handleReset = () => {
    setStep('select');
    setNotes({});
    setSelectedComponents({});
    setCreationFailures(null);

    if (data) {
      const quantities: Record<number, number> = {};
      const newAllocation: Record<number, { forThisOrder: number; forStock: number }> = {};

      data.forEach(group => {
        group.components.forEach(component => {
          // Use supplier_component_id as key to distinguish same component across different suppliers
          const key = component.selectedSupplier.supplier_component_id;
          const perOrderShortfall = component.shortfall;
          const globalShortfall = component.global_real_shortfall || 0;

          // Default quantity: use global shortfall if no per-order shortfall
          const defaultQuantity = perOrderShortfall > 0 ? perOrderShortfall : globalShortfall;
          quantities[key] = defaultQuantity;

          // Smart allocation: per-order shortfall goes to "forThisOrder", global-only goes to "forStock"
          if (perOrderShortfall > 0) {
            newAllocation[key] = {
              forThisOrder: perOrderShortfall,
              forStock: 0
            };
          } else {
            // Global-only shortfall: allocate to stock
            newAllocation[key] = {
              forThisOrder: 0,
              forStock: globalShortfall
            };
          }
        });
      });

      setOrderQuantities(quantities);
      setAllocation(newAllocation);
    }
  };

  const handleSelectComponent = (supplierComponentId: number, selected: boolean) => {
    setSelectedComponents(prev => ({
      ...prev,
      [supplierComponentId]: selected,
    }));
  };

  const toggleRowExpansion = (componentId: number) => {
    setExpandedRows(prev => ({
      ...prev,
      [componentId]: !prev[componentId],
    }));
  };

  const handleQuantityChange = (supplierComponentId: number, quantity: number) => {
    const newQuantity = Math.max(0, quantity);
    setOrderQuantities(prev => ({
      ...prev,
      [supplierComponentId]: newQuantity
    }));

    // Update allocation when quantity changes
    updateAllocation(supplierComponentId, newQuantity);
  };

  const updateAllocation = (supplierComponentId: number, totalQuantity: number) => {
    // Find the component to get the shortfall
    let shortfall = 0;

    data?.forEach(group => {
      group.components.forEach(component => {
        if (component.selectedSupplier.supplier_component_id === supplierComponentId) {
          shortfall = component.shortfall;
        }
      });
    });

    // Default allocation: prioritize this order's needs first
    const forThisOrder = Math.min(totalQuantity, shortfall);
    const forStock = Math.max(0, totalQuantity - shortfall);

    setAllocation(prev => ({
      ...prev,
      [supplierComponentId]: { forThisOrder, forStock }
    }));
  };

  const handleAllocationChange = (
    supplierComponentId: number,
    field: 'forThisOrder' | 'forStock',
    value: number
  ) => {
    const newValue = Math.max(0, value);

    // Find the component to get the shortfall
    let shortfall = 0;
    data?.forEach(group => {
      group.components.forEach(component => {
        if (component.selectedSupplier.supplier_component_id === supplierComponentId) {
          shortfall = component.shortfall;
        }
      });
    });

    const currentAllocation = allocation[supplierComponentId] || { forThisOrder: 0, forStock: 0 };
    let newAllocation = { ...currentAllocation };

    if (field === 'forThisOrder') {
      newAllocation = {
        forThisOrder: newValue,
        // If we're decreasing forThisOrder, keep total the same
        forStock: currentAllocation.forThisOrder + currentAllocation.forStock - newValue
      };
    } else {
      newAllocation = {
        // If we're decreasing forStock, keep total the same
        forThisOrder: currentAllocation.forThisOrder + currentAllocation.forStock - newValue,
        forStock: newValue
      };
    }

    // Ensure values are not negative
    newAllocation.forThisOrder = Math.max(0, newAllocation.forThisOrder);
    newAllocation.forStock = Math.max(0, newAllocation.forStock);

    // Update total quantity to match allocation
    const totalQuantity = newAllocation.forThisOrder + newAllocation.forStock;

    setOrderQuantities(prev => ({
      ...prev,
      [supplierComponentId]: totalQuantity
    }));

    setAllocation(prev => ({
      ...prev,
      [supplierComponentId]: newAllocation
    }));
  };

  const handleNoteChange = (supplierId: number, note: string) => {
    setNotes(prev => ({
      ...prev,
      [supplierId]: note,
    }));
  };

  const createPurchaseOrdersMutation = useMutation<
    SupplierOrderCreationSummary,
    Error,
    void,
    { toastId: string }
  >({
    mutationFn: async () => {
      setCreationFailures(null);
      return createComponentPurchaseOrders(
        selectedComponents,
        data || [],
        notes,
        orderQuantities,
        allocation,
        orderId
      );
    },
    onMutate: () => {
      const toastId = String(toast.loading('Creating purchase orders\u2026'));
      return { toastId };
    },
    onSuccess: async (result, _, context) => {
      const createdCount = result.successes.length;
      const toastMessage =
        createdCount === 1
          ? 'Purchase order created successfully!'
          : `${createdCount} purchase orders created successfully!`;

      if (context?.toastId) {
        toast.success(toastMessage, { id: context.toastId });
      } else {
        toast.success(toastMessage);
      }

      handleReset();
      onOpenChange(false);
      if (onCreated) onCreated();

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['component-suppliers', orderId] }),
        queryClient.invalidateQueries({ queryKey: ['orderComponentRequirements', orderId] }),
        queryClient.invalidateQueries({ queryKey: ['order', orderId] }),
        // Invalidate all purchase order queries to ensure the new order appears everywhere
        queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] }),
        queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }),
        queryClient.invalidateQueries({ queryKey: ['all-purchase-orders'] }),
      ]);
    },
    onError: (error, _, context) => {
      console.error('Error creating purchase orders:', error);

       if (error instanceof SupplierOrderCreationError) {
         setCreationFailures(error.failures);

         const supplierList = error.failures.map(failure => failure.supplierName).join(', ');
         const partialMessage = error.successes.length
           ? ` Created ${error.successes.length} supplier${error.successes.length > 1 ? 's' : ''} before failing.`
           : '';

         if (context?.toastId) {
           toast.error(
             `Purchase orders failed for: ${supplierList}.${partialMessage}`,
             { id: context.toastId }
           );
         } else {
           toast.error(`Purchase orders failed for: ${supplierList}.${partialMessage}`);
         }

         return;
       }

      if (context?.toastId) {
        toast.error('Failed to create purchase orders. Please try again.', { id: context.toastId });
      } else {
        toast.error('Failed to create purchase orders. Please try again.');
      }
    },
  });

  // Check for existing Draft POs for the selected suppliers
  const checkForExistingDrafts = async () => {
    const selectedGroups = (data || [])
      .filter(group => group.components.some(c => selectedComponents[c.selectedSupplier.supplier_component_id]));

    console.log('[PO Consolidation] Selected groups:', selectedGroups);
    console.log('[PO Consolidation] Selected components:', selectedComponents);

    const supplierIds = selectedGroups.map(group => group.supplier.supplier_id);
    console.log('[PO Consolidation] Supplier IDs to check:', supplierIds);

    const draftsPerSupplier: SupplierWithDrafts[] = [];

    for (const supplierId of supplierIds) {
      console.log('[PO Consolidation] Checking supplier:', supplierId);
      const { data: drafts, error } = await supabase.rpc('get_draft_purchase_orders_for_supplier', {
        p_supplier_id: supplierId
      });

      console.log('[PO Consolidation] RPC result for supplier', supplierId, ':', { drafts, error });

      if (!error && drafts && drafts.length > 0) {
        const supplierName = (data || []).find(g => g.supplier.supplier_id === supplierId)?.supplier.name || 'Unknown';
        draftsPerSupplier.push({
          supplierId,
          supplierName,
          existingDrafts: drafts.map((d: any) => ({
            purchase_order_id: d.purchase_order_id,
            q_number: d.q_number,
            created_at: d.created_at,
            notes: d.notes,
            line_count: Number(d.line_count),
            total_amount: Number(d.total_amount)
          }))
        });
      }
    }

    console.log('[PO Consolidation] Drafts per supplier:', draftsPerSupplier);
    return draftsPerSupplier;
  };

  const handleCreatePurchaseOrders = async () => {
    if (createPurchaseOrdersMutation.isPending) return;

    // Check for existing drafts
    const drafts = await checkForExistingDrafts();

    if (drafts.length > 0) {
      // Store the payload for later use
      const payload = {
        selectedComponents,
        supplierGroups: data || [],
        notes,
        orderQuantities,
        allocation,
        orderId
      };
      setPendingConsolidationPayload(payload);
      setSuppliersWithDrafts(drafts);
      setConsolidateDialogOpen(true);
    } else {
      // No existing drafts, create new POs directly
      createPurchaseOrdersMutation.mutate();
    }
  };

  // Handle consolidation decision
  const handleConsolidationConfirm = async (decisions: Record<number, number | 'new'>) => {
    setConsolidateDialogOpen(false);

    if (!pendingConsolidationPayload) return;

    const toastId = String(toast.loading('Creating purchase orders\u2026'));

    try {
      // Get Draft status ID
      const { data: statusData, error: statusError } = await supabase
        .from('supplier_order_statuses')
        .select('status_id')
        .eq('status_name', 'Draft')
        .single();

      if (statusError || !statusData) {
        throw new Error('Could not find Draft status in the system');
      }

      const draftStatusId = statusData.status_id;
      const today = new Date().toISOString();
      const purchaseOrderSummaries: SupplierOrderCreationSuccess[] = [];
      const supplierFailures: SupplierOrderCreationFailure[] = [];

      const suppliersToProcess = (pendingConsolidationPayload.supplierGroups as SupplierGroup[])
        .filter(group =>
          group.components.some(c => pendingConsolidationPayload.selectedComponents[c.selectedSupplier.supplier_component_id])
        )
        .map(group => {
          const selectedComponentsForSupplier = group.components
            .filter(c => pendingConsolidationPayload.selectedComponents[c.selectedSupplier.supplier_component_id]);

          if (selectedComponentsForSupplier.length === 0) return null;

          const lineItems: SupplierOrderLinePayload[] = selectedComponentsForSupplier.map(component => {
            const supplierComponentId = component.selectedSupplier.supplier_component_id;
            const orderQuantity = pendingConsolidationPayload.orderQuantities[supplierComponentId] ?? component.shortfall;
            const componentAllocation = pendingConsolidationPayload.allocation[supplierComponentId] || {
              forThisOrder: Math.min(orderQuantity, component.shortfall),
              forStock: Math.max(0, orderQuantity - component.shortfall)
            };

            return {
              supplier_component_id: supplierComponentId,
              order_quantity: orderQuantity,
              component_id: component.component.component_id,
              quantity_for_order: componentAllocation.forThisOrder,
              quantity_for_stock: componentAllocation.forStock,
              customer_order_id: parseInt(pendingConsolidationPayload.orderId, 10)
            };
          });

          return {
            supplierId: group.supplier.supplier_id,
            supplierName: group.supplier.name,
            note: pendingConsolidationPayload.notes[group.supplier.supplier_id] || '',
            lineItems,
            decision: decisions[group.supplier.supplier_id] || 'new'
          };
        })
        .filter((payload): payload is NonNullable<typeof payload> => payload !== null);

      for (const payload of suppliersToProcess) {
        try {
          if (payload.decision !== 'new' && typeof payload.decision === 'number') {
            // Add to existing PO
            const { data, error: rpcError } = await supabase.rpc('add_lines_to_purchase_order', {
              target_purchase_order_id: payload.decision,
              line_items: payload.lineItems
            });

            if (rpcError) throw rpcError;

            purchaseOrderSummaries.push({
              supplierId: payload.supplierId,
              supplierName: payload.supplierName,
              purchaseOrderId: payload.decision,
              supplierOrderIds: data?.[0]?.supplier_order_ids ?? []
            });
          } else {
            // Create new PO
            const { data, error: rpcError } = await supabase.rpc('create_purchase_order_with_lines', {
              supplier_id: payload.supplierId,
              line_items: payload.lineItems,
              status_id: draftStatusId,
              order_date: today,
              notes: payload.note
            });

            if (rpcError) throw rpcError;

            const rpcResult = Array.isArray(data) ? data?.[0] : data;

            if (!rpcResult || typeof rpcResult.purchase_order_id !== 'number') {
              throw new Error('Unexpected response when creating purchase order');
            }

            purchaseOrderSummaries.push({
              supplierId: payload.supplierId,
              supplierName: payload.supplierName,
              purchaseOrderId: rpcResult.purchase_order_id,
              supplierOrderIds: rpcResult.supplier_order_ids ?? []
            });
          }
        } catch (rpcError) {
          console.error(`Failed to process order for supplier ${payload.supplierName}`, rpcError);
          supplierFailures.push({
            supplierId: payload.supplierId,
            supplierName: payload.supplierName,
            reason: rpcError instanceof Error ? rpcError.message : 'Unknown error'
          });
        }
      }

      if (supplierFailures.length > 0 && purchaseOrderSummaries.length === 0) {
        throw new SupplierOrderCreationError(supplierFailures, purchaseOrderSummaries);
      }

      // Success
      const createdCount = purchaseOrderSummaries.length;
      const addedCount = purchaseOrderSummaries.filter(s =>
        suppliersWithDrafts.some(d => d.existingDrafts.some(e => e.purchase_order_id === s.purchaseOrderId))
      ).length;

      let toastMessage = '';
      if (addedCount > 0 && addedCount === createdCount) {
        toastMessage = addedCount === 1
          ? 'Items added to existing purchase order!'
          : `Items added to ${addedCount} existing purchase orders!`;
      } else if (addedCount > 0) {
        toastMessage = `${createdCount - addedCount} new PO(s) created, ${addedCount} existing PO(s) updated!`;
      } else {
        toastMessage = createdCount === 1
          ? 'Purchase order created successfully!'
          : `${createdCount} purchase orders created successfully!`;
      }

      toast.success(toastMessage, { id: toastId });

      handleReset();
      onOpenChange(false);
      if (onCreated) onCreated();

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['component-suppliers', orderId] }),
        queryClient.invalidateQueries({ queryKey: ['orderComponentRequirements', orderId] }),
        queryClient.invalidateQueries({ queryKey: ['order', orderId] }),
        queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] }),
        queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }),
        queryClient.invalidateQueries({ queryKey: ['all-purchase-orders'] }),
      ]);

    } catch (error) {
      console.error('Error in consolidation:', error);
      if (error instanceof SupplierOrderCreationError) {
        setCreationFailures(error.failures);
        const supplierList = error.failures.map(f => f.supplierName).join(', ');
        toast.error(`Purchase orders failed for: ${supplierList}`, { id: toastId });
      } else {
        toast.error('Failed to create purchase orders. Please try again.', { id: toastId });
      }
    }

    setPendingConsolidationPayload(null);
  };

  if (isLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[900px]">
          <DialogHeader>
            <DialogTitle>Order Components</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center p-8">
            <Loader2 className="mr-2 h-8 w-8 animate-spin" />
            <span>Loading component information...</span>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (isError) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[900px]">
          <DialogHeader>
            <DialogTitle>Order Components</DialogTitle>
          </DialogHeader>
          <div className="p-4 text-red-500">
            <p>Error loading component information: {error?.toString()}</p>
            <Button onClick={() => refetch()} className="mt-4">
              Retry
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[1200px] max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>Order Components</DialogTitle>
          <DialogDescription>
            {step === 'select'
              ? 'Select components to order from suppliers'
              : 'Review and confirm your order'}
          </DialogDescription>
        </DialogHeader>

        {creationFailures && creationFailures.length > 0 && (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>Some purchase orders failed</AlertTitle>
            <AlertDescription>
              <div className="space-y-1">
                <p>Please review and retry the following suppliers:</p>
                {creationFailures.map((failure) => (
                  <div key={failure.supplierId} className="text-sm">
                    <span className="font-medium">{failure.supplierName}:</span>{' '}
                    <span>{failure.reason}</span>
                  </div>
                ))}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {step === 'select' && (
          <div className="space-y-6 max-h-[600px] overflow-y-auto">
            {data && data.length > 0 ? (
              data.map((group) => (
                <Card key={group.supplier.supplier_id} className="overflow-hidden">
                  <CardHeader className="bg-muted">
                    <div className="flex justify-between items-center">
                      <CardTitle>{group.supplier.name}</CardTitle>
                      <div className="text-sm text-muted-foreground">
                        {group.components.length} component(s)
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[50px]"></TableHead>
                          <TableHead className="w-[35%]">Component</TableHead>
                          <TableHead className="w-[12%]">Shortfall</TableHead>
                          <TableHead className="w-[12%]">Order Quantity</TableHead>
                          <TableHead className="w-[20%]">Allocation</TableHead>
                          <TableHead className="w-[10%] text-right">Price</TableHead>
                          <TableHead className="w-[50px]"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.components.map((component) => {
                          const supplierComponentId = component.selectedSupplier.supplier_component_id;
                          const isExpanded = expandedRows[component.component.component_id];
                          const hasGlobalContext = (component.total_required_all_orders ?? 0) > component.shortfall;
                          const isForStock = component.shortfall === 0 && (component.global_real_shortfall ?? 0) > 0;

                          return (
                            <React.Fragment key={supplierComponentId}>
                              <TableRow className="hover:bg-muted/50">
                                <TableCell className="py-4">
                                  <Checkbox
                                    checked={selectedComponents[supplierComponentId] === true}
                                    onCheckedChange={(checked) =>
                                      handleSelectComponent(
                                        supplierComponentId,
                                        checked === true
                                      )
                                    }
                                  />
                                </TableCell>
                                <TableCell className="py-4">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-base">
                                      {component.component.internal_code}
                                    </span>
                                    {isForStock && (
                                      <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30">
                                        For Stock
                                      </span>
                                    )}
                                    {hasGlobalContext && (
                                      <span className="inline-flex items-center text-xs font-medium text-blue-500" title="Required in multiple orders">
                                        <Users className="h-3 w-3" />
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-sm text-muted-foreground mt-1">
                                    {component.component.description}
                                  </div>
                                </TableCell>
                                <TableCell className="py-4">
                                  <div className="flex flex-col gap-0.5">
                                    <div className="flex items-center gap-1">
                                      <span className={component.shortfall > 0 ? "text-red-600 font-medium text-base" : "text-base"}>
                                        {component.shortfall}
                                      </span>
                                      <span className="text-xs text-muted-foreground">(this order)</span>
                                    </div>
                                    {(component.global_real_shortfall ?? 0) > 0 && (
                                      <div className="flex items-center gap-1 text-amber-600">
                                        <span className="text-xs font-medium">Global:</span>
                                        <span className="text-sm font-medium">{component.global_real_shortfall}</span>
                                      </div>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="py-4">
                                  <Input
                                    type="number"
                                    min="0"
                                    value={orderQuantities[supplierComponentId] || 0}
                                    onChange={(e) =>
                                      handleQuantityChange(
                                        supplierComponentId,
                                        parseInt(e.target.value || '0')
                                      )
                                    }
                                    className="w-24 h-10"
                                    disabled={!selectedComponents[supplierComponentId]}
                                  />
                                </TableCell>
                                <TableCell className="py-4">
                                  {selectedComponents[supplierComponentId] ? (
                                    <div className="flex items-center gap-3">
                                      <div className="flex items-center gap-1.5">
                                        <Label htmlFor={`forOrder-${supplierComponentId}`} className="text-xs font-medium whitespace-nowrap">
                                          Order:
                                        </Label>
                                        <Input
                                          id={`forOrder-${supplierComponentId}`}
                                          type="number"
                                          min="0"
                                          value={allocation[supplierComponentId]?.forThisOrder || 0}
                                          onChange={(e) =>
                                            handleAllocationChange(
                                              supplierComponentId,
                                              'forThisOrder',
                                              parseInt(e.target.value || '0')
                                            )
                                          }
                                          className="w-20 h-9"
                                        />
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        <Label htmlFor={`forStock-${supplierComponentId}`} className="text-xs font-medium whitespace-nowrap">
                                          Stock:
                                        </Label>
                                        <Input
                                          id={`forStock-${supplierComponentId}`}
                                          type="number"
                                          min="0"
                                          value={allocation[supplierComponentId]?.forStock || 0}
                                          onChange={(e) =>
                                            handleAllocationChange(
                                              supplierComponentId,
                                              'forStock',
                                              parseInt(e.target.value || '0')
                                            )
                                          }
                                          className="w-20 h-9"
                                        />
                                      </div>
                                    </div>
                                  ) : (
                                    <span className="text-sm text-muted-foreground">&mdash;</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right py-4">
                                  <span className="text-base font-medium">
                                    {formatCurrency(component.selectedSupplier.price)}
                                  </span>
                                </TableCell>
                                <TableCell className="py-4">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0"
                                    onClick={() => toggleRowExpansion(component.component.component_id)}
                                    disabled={!hasGlobalContext && !isForStock}
                                  >
                                    <ChevronDown
                                      className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                    />
                                    <span className="sr-only">
                                      {isExpanded ? 'Collapse' : 'Expand'} details
                                    </span>
                                  </Button>
                                </TableCell>
                              </TableRow>

                              {isExpanded && (hasGlobalContext || isForStock) && (
                                <TableRow>
                                  <TableCell colSpan={7} className="bg-muted/30 py-4 px-6">
                                    <div className="space-y-2 text-sm">
                                      {hasGlobalContext && (
                                        <div className="flex items-start gap-2 text-blue-600">
                                          <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
                                          <div>
                                            <span className="font-medium">Global Context:</span> Total needed across all orders: {component.total_required_all_orders} &bull; Global shortfall: {component.global_real_shortfall}
                                          </div>
                                        </div>
                                      )}
                                      {isForStock && (
                                        <div className="flex items-start gap-2 text-amber-600">
                                          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                                          <div>
                                            This order is covered by finished goods, but other orders need this component.
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </TableCell>
                                </TableRow>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                  <CardFooter className="bg-muted/50 p-4">
                    <div className="w-full">
                      <Label htmlFor={`notes-${group.supplier.supplier_id}`}>Notes for Supplier</Label>
                      <Textarea
                        id={`notes-${group.supplier.supplier_id}`}
                        placeholder="Add any special instructions for this supplier..."
                        value={notes[group.supplier.supplier_id] || ''}
                        onChange={(e) => handleNoteChange(group.supplier.supplier_id, e.target.value)}
                        className="mt-2"
                      />
                    </div>
                  </CardFooter>
                </Card>
              ))
            ) : (
              <div className="text-center p-8">
                <p>No component suppliers found or all components are in stock.</p>
                <p className="text-sm text-muted-foreground mt-2">
                  Either no components have shortfalls, or components with shortfalls don&apos;t have configured suppliers.
                </p>
                {apparentShortfallExists && (
                  <div className="mt-4 p-4 bg-amber-500/10 border border-amber-500/30 rounded-md">
                    <p className="text-amber-700 dark:text-amber-400">
                      <AlertCircle className="h-4 w-4 inline-block mr-2" />
                      Some components show shortfall but they&apos;re already on order. Check the &quot;On Order&quot; column in the Component Requirements table.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-6 max-h-[600px] overflow-y-auto">
            <div className="text-sm text-muted-foreground mb-4">
              Review your selections before creating purchase orders
            </div>

            {data && data.length > 0 ? (
              data
                .filter((group) =>
                  group.components.some(
                    (c) => selectedComponents[c.selectedSupplier.supplier_component_id]
                  )
                )
                .map((group) => (
                  <Card key={group.supplier.supplier_id}>
                    <CardHeader>
                      <CardTitle>{group.supplier.name}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Component</TableHead>
                            <TableHead>Order Qty</TableHead>
                            <TableHead>Allocation</TableHead>
                            <TableHead className="text-right">Price</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {group.components
                            .filter(
                              (c) => selectedComponents[c.selectedSupplier.supplier_component_id]
                            )
                            .map((component) => {
                              const supplierComponentId = component.selectedSupplier.supplier_component_id;
                              const orderQty = orderQuantities[supplierComponentId] || component.shortfall;
                              const currentAllocation = allocation[supplierComponentId] || {
                                forThisOrder: component.shortfall,
                                forStock: 0
                              };

                              return (
                                <TableRow key={supplierComponentId}>
                                  <TableCell>
                                    <div className="font-medium">
                                      {component.component.internal_code}
                                    </div>
                                    <div className="text-sm text-muted-foreground">
                                      {component.component.description}
                                    </div>
                                  </TableCell>
                                  <TableCell>{orderQty}</TableCell>
                                  <TableCell>
                                    <div className="text-xs">
                                      <div>For Order: {currentAllocation.forThisOrder}</div>
                                      <div>For Stock: {currentAllocation.forStock}</div>
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {formatCurrency(component.selectedSupplier.price)}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {formatCurrency(
                                      component.selectedSupplier.price * orderQty
                                    )}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                        </TableBody>
                        <TableFooter>
                          <TableRow>
                            <TableCell colSpan={4}>Total</TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(
                                group.components
                                  .filter(
                                    (c) => selectedComponents[c.selectedSupplier.supplier_component_id]
                                  )
                                  .reduce(
                                    (sum, component) =>
                                      sum +
                                      component.selectedSupplier.price *
                                        (orderQuantities[component.selectedSupplier.supplier_component_id] ||
                                          component.shortfall),
                                    0
                                  )
                              )}
                            </TableCell>
                          </TableRow>
                        </TableFooter>
                      </Table>

                      {notes[group.supplier.supplier_id] && (
                        <div className="mt-4 p-3 bg-muted rounded-md">
                          <h4 className="font-medium mb-1">Notes:</h4>
                          <p className="text-sm whitespace-pre-line">
                            {notes[group.supplier.supplier_id]}
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))
            ) : (
              <div className="text-center p-8">
                <p>No components selected for ordering.</p>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex justify-between">
          {step === 'select' ? (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => setStep('review')}
                disabled={
                  !data ||
                  !Object.values(selectedComponents).some((selected) => selected)
                }
              >
                Review Order
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setStep('select')}>
                Back
              </Button>
              <Button
                onClick={handleCreatePurchaseOrders}
                disabled={createPurchaseOrdersMutation.isPending}
              >
                {createPurchaseOrdersMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating&hellip;
                  </>
                ) : (
                  'Create Purchase Orders'
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>

      {/* Consolidation Dialog */}
      <ConsolidatePODialog
        open={consolidateDialogOpen}
        onOpenChange={setConsolidateDialogOpen}
        suppliersWithDrafts={suppliersWithDrafts}
        onConfirm={handleConsolidationConfirm}
        isLoading={false}
      />
    </Dialog>
  );
};
