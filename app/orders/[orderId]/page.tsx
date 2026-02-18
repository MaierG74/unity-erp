'use client';

import { useState, useMemo, useEffect, useCallback, use } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { type Order, type Product, type OrderDetail, type Customer, type OrderAttachment, type OrderStatus, type FinishedGoodReservation } from '@/types/orders';
import { ComponentRequirement, ProductRequirement, SupplierInfo, SupplierOption } from '@/types/components';
import { fetchCustomers } from '@/lib/db/customers';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { ArrowLeft, File, Download, Paperclip, Package, Layers, Wrench, Cog, Search, PaintBucket, PlusCircle, Check, Plus, Loader2, AlertCircle, ShoppingCart, ChevronDown, CheckCircle, Trash, FilePlus, Terminal, ChevronRight, Info, ShoppingBag, Users, RotateCcw, ChevronUp, Warehouse, Printer, Edit, Save, X, ChevronsUpDown, ClipboardList } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { Table, TableHeader, TableBody, TableCell, TableHead, TableRow, TableFooter } from '@/components/ui/table';
import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { clsx } from 'clsx';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { IssueStockTab } from '@/components/features/orders/IssueStockTab';
import { OrderDocumentsTab } from '@/components/features/orders/OrderDocumentsTab';
import { ProcurementTab } from '@/components/features/orders/ProcurementTab';
import { JobCardsTab } from '@/components/features/orders/JobCardsTab';
import { ConsolidatePODialog, SupplierWithDrafts, ExistingDraftPO } from '@/components/features/purchasing/ConsolidatePODialog';

type OrderDetailPageProps = {
  params: Promise<{
    orderId: string;
  }>;
};

// Format currency function
function formatCurrency(amount: number | null): string {
  if (amount === null || amount === undefined) return 'N/A';
  return `R ${amount.toFixed(2)}`;
}

function formatQuantity(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '0';
  }
  const numeric = Number(value);
  if (Math.abs(numeric - Math.round(numeric)) < 0.001) {
    return Math.round(numeric).toString();
  }
  return numeric.toFixed(2);
}

// Fetch a single order with all related data
async function fetchOrderDetails(orderId: number): Promise<Order | null> {
  try {
    // First, fetch the order with basic information
    const { data, error } = await supabase
      .from('orders')
      .select(`
        *,
        status:order_statuses(status_id, status_name),
        customer:customers(*),
        quote:quotes(id, quote_number)
      `)
      .eq('order_id', orderId)
      .single();

    if (error) {
      console.error('Error fetching order details:', error);
      throw new Error('Failed to fetch order details');
    }

    if (!data) return null; // include quote relationship

    // Transform quote relationship from array to object
    const quoteObj = data.quote?.[0] || null;


    // Next, fetch the order details (line items)
    const { data: orderDetails, error: detailsError } = await supabase
      .from('order_details')
      .select(`
        *,
        product:products(*)
      `)
      .eq('order_id', orderId);

    if (detailsError) {
      console.error('Error fetching order line items:', detailsError);
    }

    // Transform the data to ensure proper structure
    return {
      ...data,
      quote: quoteObj,
      // Ensure status is properly structured
      status: data.status && data.status.length > 0 
        ? { 
            status_id: data.status[0]?.status_id || 0,
            status_name: data.status[0]?.status_name || 'Unknown'
          }
        : { status_id: 0, status_name: 'Unknown' },
      // Ensure total_amount is a number
      total_amount: data.total_amount !== null ? Number(data.total_amount) : null,
      // Add the order details
      details: orderDetails || []
    };
  } catch (error) {
    console.error('Error in fetchOrderDetails:', error);
    return null;
  }
}

// Fetch order attachments
async function fetchOrderAttachments(orderId: number): Promise<OrderAttachment[]> {
  try {
    const { data, error } = await supabase
      .from('order_attachments')
      .select('*')
      .eq('order_id', orderId)
      .order('uploaded_at', { ascending: false });

    if (error) {
      console.error('Error fetching order attachments:', error);
      throw new Error('Failed to fetch order attachments');
    }

    return data || [];
  } catch (error) {
    console.error('Error in fetchOrderAttachments:', error);
    return [];
  }
}

async function fetchFinishedGoodReservations(orderId: number): Promise<FinishedGoodReservation[]> {
  const response = await fetch(`/api/orders/${orderId}/fg-reservations`, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error('Failed to load finished-good reservations');
  }

  const payload = await response.json();
  return (payload?.reservations ?? []) as FinishedGoodReservation[];
}

async function reserveFinishedGoods(orderId: number): Promise<FinishedGoodReservation[]> {
  const response = await fetch(`/api/orders/${orderId}/reserve-fg`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('Failed to reserve finished goods');
  }

  const payload = await response.json();
  return (payload?.reservations ?? []) as FinishedGoodReservation[];
}

async function releaseFinishedGoods(orderId: number): Promise<number | null> {
  const response = await fetch(`/api/orders/${orderId}/release-fg`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('Failed to release finished goods');
  }

  const payload = await response.json();
  return (payload?.released ?? null) as number | null;
}

async function consumeFinishedGoods(orderId: number): Promise<Array<{ product_id: number; consumed_quantity: number }>> {
  const response = await fetch(`/api/orders/${orderId}/consume-fg`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('Failed to consume finished goods');
  }

  const payload = await response.json();
  return (payload?.consumed ?? []) as Array<{ product_id: number; consumed_quantity: number }>;
}

// Function to fetch component requirements for an order
async function fetchOrderComponentRequirements(orderId: number): Promise<ProductRequirement[]> {
  try {
    const { data: orderDetails, error: orderError } = await supabase
      .from('order_details')
      .select(`
        order_detail_id,
        order_id,
        product_id,
        quantity,
        unit_price,
        product:products(
          product_id,
          name,
          description
        )
      `)
      .eq('order_id', orderId);

    if (orderError) {
      console.error('[components] Failed to fetch order details', orderError);
      throw new Error('Failed to fetch order details');
    }

    if (!orderDetails || orderDetails.length === 0) {
      return [];
    }

    const productIds = Array.from(
      new Set(
        orderDetails
          .map((detail) => detail.product_id)
          .filter((id): id is number => typeof id === 'number' && Number.isFinite(id))
      )
    );

    const [statusResult, historyResult, bomResult] = await Promise.all([
      supabase.rpc('get_detailed_component_status', { p_order_id: orderId }),
      supabase.rpc('get_order_component_history', { p_order_id: orderId }),
      productIds.length > 0
        ? supabase
            .from('billofmaterials')
            .select(`
              product_id,
              component_id,
              quantity_required,
              component:components(
                component_id,
                internal_code,
                description
              )
            `)
            .in('product_id', productIds)
        : Promise.resolve({ data: [], error: null })
    ]);

    if (bomResult.error) {
      console.error('[components] Failed to fetch bill of materials', bomResult.error);
      throw new Error('Failed to load bill of materials');
    }

    if (statusResult.error) {
      console.error('[components] Failed to fetch component status', statusResult.error);
    }

    if (historyResult.error) {
      console.error('[components] Failed to fetch component history', historyResult.error);
    }

    const componentStatusMap = new Map<number, any>();
    (statusResult.data ?? []).forEach((item: any) => {
      if (item?.component_id) {
        componentStatusMap.set(item.component_id, item);
      }
    });

    const historyMap = new Map<number, any[]>();
    (historyResult.data ?? []).forEach((entry: any) => {
      if (!entry?.component_id) return;
      if (!historyMap.has(entry.component_id)) {
        historyMap.set(entry.component_id, []);
      }
      historyMap.get(entry.component_id)!.push(entry);
    });

    const bomByProduct = new Map<number, any[]>();
    (bomResult.data ?? []).forEach((row: any) => {
      if (!row?.product_id || !row?.component) return;
      if (!bomByProduct.has(row.product_id)) {
        bomByProduct.set(row.product_id, []);
      }
      bomByProduct.get(row.product_id)!.push(row);
    });

    return orderDetails.map((detail) => {
      const bomRows = bomByProduct.get(detail.product_id) ?? [];

      const components = bomRows
        .map((bomRow) => {
          const componentId = bomRow.component_id;
          const component = bomRow.component;

          if (!componentId || !component) {
            return null;
          }

          const status = componentStatusMap.get(componentId);
          const requiredQuantity = Number(detail.quantity ?? 0) * Number(bomRow.quantity_required ?? 0);
          const quantityInStock = Number(status?.in_stock ?? 0);
          const quantityOnOrder = Number(status?.on_order ?? 0);
          const apparentShortfall = Number(
            status?.apparent_shortfall ?? Math.max(requiredQuantity - quantityInStock, 0)
          );
          const realShortfall = Number(
            status?.real_shortfall ?? Math.max(requiredQuantity - quantityInStock - quantityOnOrder, 0)
          );
          const totalRequiredAllOrders = Number(status?.total_required ?? requiredQuantity);
          const orderCount = Number(status?.order_count ?? 1);
          const globalApparentShortfall = Number(
            status?.global_apparent_shortfall ?? Math.max(totalRequiredAllOrders - quantityInStock, 0)
          );
          const globalRealShortfall = Number(
            status?.global_real_shortfall ?? Math.max(totalRequiredAllOrders - quantityInStock - quantityOnOrder, 0)
          );

          return {
            component_id: componentId,
            internal_code: component.internal_code,
            description: component.description,
            quantity_required: requiredQuantity,
            quantity_in_stock: quantityInStock,
            quantity_on_order: quantityOnOrder,
            apparent_shortfall: apparentShortfall,
            real_shortfall: realShortfall,
            order_breakdown: Array.isArray(status?.order_breakdown) ? status.order_breakdown : [],
            on_order_breakdown: Array.isArray(status?.on_order_breakdown) ? status.on_order_breakdown : [],
            history: historyMap.get(componentId) ?? [],
            total_required_all_orders: totalRequiredAllOrders,
            order_count: orderCount,
            global_apparent_shortfall: globalApparentShortfall,
            global_real_shortfall: globalRealShortfall,
            supplier_options: [],
            selected_supplier: null,
            draft_po_quantity: Number(status?.draft_po_quantity ?? 0),
            draft_po_breakdown: Array.isArray(status?.draft_po_breakdown) ? status.draft_po_breakdown : [],
          } as ComponentRequirement;
        })
        .filter((comp): comp is ComponentRequirement => Boolean(comp));

      return {
        order_detail_id: detail.order_detail_id,
        product_id: detail.product_id,
        product_name: detail.product?.name || 'Unknown Product',
        order_quantity: detail.quantity,
        components,
      } as ProductRequirement;
    });
  } catch (error) {
    console.error('[components] Error building order component requirements', error);
    throw error;
  }
}

// Function to fetch component suppliers for ordering
async function fetchComponentSuppliers(orderId: number) {
  try {
    const { data: statusData, error: statusError } = await supabase.rpc('get_detailed_component_status', {
      p_order_id: orderId,
    });

    if (statusError) {
      console.error('[suppliers] Failed to load component status', statusError);
      return [];
    }

    const componentsWithShortfall = (statusData ?? []).filter(
      (item: any) => 
        Number(item?.real_shortfall ?? 0) > 0 || 
        Number(item?.global_real_shortfall ?? 0) > 0
    );

    if (componentsWithShortfall.length === 0) {
      return [];
    }

    const componentMetaMap = new Map<number, any>();
    const componentIds: number[] = [];

    componentsWithShortfall.forEach((item: any) => {
      if (!item?.component_id) return;
      componentMetaMap.set(item.component_id, item);
      componentIds.push(item.component_id);
    });

    const { data: supplierComponents, error: supplierError } = await supabase
      .from('suppliercomponents')
      .select(`
        supplier_component_id,
        component_id,
        price,
        supplier:suppliers(
          supplier_id,
          name,
          contact_info
        )
      `)
      .in('component_id', componentIds);

    if (supplierError) {
      console.error('[suppliers] Failed to load supplier components', supplierError);
      return [];
    }

    if (!supplierComponents || supplierComponents.length === 0) {
      return [];
    }

    const supplierIds = Array.from(
      new Set(
        supplierComponents
          .map((sc: any) => sc?.supplier?.supplier_id)
          .filter((id): id is number => typeof id === 'number' && Number.isFinite(id))
      )
    );

    let emailMap = new Map<number, string[]>();
    if (supplierIds.length > 0) {
      const { data: supplierEmails, error: emailError } = await supabase
        .from('supplier_emails')
        .select('supplier_id, email, is_primary')
        .in('supplier_id', supplierIds);

      if (emailError) {
        console.error('[suppliers] Failed to load supplier emails', emailError);
      } else if (supplierEmails) {
        emailMap = supplierEmails.reduce((map, row) => {
          if (!row?.supplier_id || !row?.email) return map;
          if (!map.has(row.supplier_id)) {
            map.set(row.supplier_id, []);
          }
          const list = map.get(row.supplier_id)!;
          if (row.is_primary) {
            list.unshift(row.email);
          } else {
            list.push(row.email);
          }
          return map;
        }, new Map<number, string[]>());
      }
    }

    const groups = new Map<number, SupplierGroup>();

    supplierComponents.forEach((sc: any) => {
      const supplier = sc?.supplier;
      const componentId = sc?.component_id;
      const componentMeta = componentMetaMap.get(componentId);

      if (!supplier || !componentMeta) {
        return;
      }

      const existingGroup = groups.get(supplier.supplier_id);
      const supplierInfo: SupplierInfo = existingGroup?.supplier ?? {
        supplier_id: supplier.supplier_id,
        name: supplier.name,
        contact_person: supplier.contact_info ?? '',
        emails: emailMap.get(supplier.supplier_id) ?? [],
        phone: supplier.contact_info ?? '', // Using contact_info for phone as well since phone column doesn't exist
      };

      const option: SupplierOption = {
        supplier: supplierInfo,
        price: Number(sc.price ?? 0),
        supplier_component_id: sc.supplier_component_id,
      };

      const componentEntry = {
        component: {
          component_id: componentMeta.component_id,
          internal_code: componentMeta.internal_code,
          description: componentMeta.description,
        },
        shortfall: Number(componentMeta.real_shortfall ?? 0),
        quantity_required: Number(componentMeta.order_required ?? 0),
        quantity_on_order: Number(componentMeta.on_order ?? 0),
        total_required_all_orders: Number(
          componentMeta.total_required ?? componentMeta.order_required ?? 0
        ),
        order_count: Number(componentMeta.order_count ?? 1),
        global_apparent_shortfall: Number(componentMeta.global_apparent_shortfall ?? 0),
        global_real_shortfall: Number(componentMeta.global_real_shortfall ?? 0),
        selectedSupplier: option,
        supplierOptions: [option],
      };

      if (!existingGroup) {
        groups.set(supplierInfo.supplier_id, {
          supplier: supplierInfo,
          components: [componentEntry],
        });
        return;
      }

      const existingComponent = existingGroup.components.find(
        (entry) => entry.component.component_id === componentEntry.component.component_id
      );

      if (existingComponent) {
        existingComponent.supplierOptions.push(option);
        if (option.price < existingComponent.selectedSupplier.price) {
          existingComponent.selectedSupplier = option;
        }
      } else {
        existingGroup.components.push(componentEntry);
      }
    });

    return Array.from(groups.values()).sort(
      (a, b) => b.components.length - a.components.length
    );
  } catch (error) {
    console.error('[suppliers] Error assembling supplier options', error);
    return [];
  }
}

// Define the SupplierComponent type
type SupplierComponent = {
  component: {
    component_id: number;
    internal_code: string;
    description: string;
  };
  shortfall: number;
  quantity_required: number;
  quantity_on_order: number;
  total_required_all_orders?: number;
  order_count?: number;
  global_apparent_shortfall?: number;
  global_real_shortfall?: number;
  selectedSupplier: SupplierOption;
  supplierOptions: SupplierOption[];
};

// Define the SupplierGroup type
type SupplierGroup = {
  supplier: SupplierInfo;
  components: SupplierComponent[];
};

type SupplierOrderLinePayload = {
  supplier_component_id: number;
  order_quantity: number;
  component_id: number;
  quantity_for_order: number;
  quantity_for_stock: number;
  customer_order_id: number;
};

type SupplierOrderCreationSuccess = {
  supplierId: number;
  supplierName: string;
  purchaseOrderId: number;
  supplierOrderIds: number[];
};

type SupplierOrderCreationFailure = {
  supplierId: number;
  supplierName: string;
  reason: string;
};

type SupplierOrderCreationSummary = {
  successes: SupplierOrderCreationSuccess[];
};

class SupplierOrderCreationError extends Error {
  public readonly failures: SupplierOrderCreationFailure[];
  public readonly successes: SupplierOrderCreationSuccess[];

  constructor(failures: SupplierOrderCreationFailure[], successes: SupplierOrderCreationSuccess[]) {
    super('Failed to create purchase orders for one or more suppliers');
    this.name = 'SupplierOrderCreationError';
    this.failures = failures;
    this.successes = successes;
  }
}

// Implement the real purchase order creation function
async function createComponentPurchaseOrders(
  selectedComponents: Record<number, boolean>,
  supplierGroups: SupplierGroup[],
  notes: Record<number, string>,
  orderQuantities: Record<number, number>,
  allocation: Record<number, { forThisOrder: number; forStock: number }>,
  orderId: string
) {
  try {
    // Get the draft status ID
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

    const suppliersToProcess = supplierGroups
      .filter(group =>
        group.components.some(c => selectedComponents[c.selectedSupplier.supplier_component_id])
      )
      .map(group => {
        const selectedComponentsForSupplier = group.components
          .filter(c => selectedComponents[c.selectedSupplier.supplier_component_id]);

        if (selectedComponentsForSupplier.length === 0) {
          return null;
        }

        const lineItems: SupplierOrderLinePayload[] = selectedComponentsForSupplier.map(component => {
          const supplierComponentId = component.selectedSupplier.supplier_component_id;
          const orderQuantity = orderQuantities[supplierComponentId] ?? component.shortfall;
          const componentAllocation = allocation[supplierComponentId] || {
            forThisOrder: Math.min(orderQuantity, component.shortfall),
            forStock: Math.max(0, orderQuantity - component.shortfall)
          };

          return {
            supplier_component_id: supplierComponentId,
            order_quantity: orderQuantity,
            component_id: component.component.component_id,
            quantity_for_order: componentAllocation.forThisOrder,
            quantity_for_stock: componentAllocation.forStock,
            customer_order_id: parseInt(orderId, 10)
          };
        });

        return {
          supplierId: group.supplier.supplier_id,
          supplierName: group.supplier.name,
          note: notes[group.supplier.supplier_id] || '',
          lineItems
        };
      })
      .filter((payload): payload is {
        supplierId: number;
        supplierName: string;
        note: string;
        lineItems: SupplierOrderLinePayload[];
      } => payload !== null);

    for (const payload of suppliersToProcess) {
      try {
        const { data, error: rpcError } = await supabase.rpc('create_purchase_order_with_lines', {
          supplier_id: payload.supplierId,
          line_items: payload.lineItems,
          status_id: draftStatusId,
          order_date: today,
          notes: payload.note
        });

        if (rpcError) {
          throw rpcError;
        }

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
      } catch (rpcError) {
        console.error(
          `[purchase-orders] Failed to create purchase order for supplier ${payload.supplierName}`,
          rpcError
        );

        supplierFailures.push({
          supplierId: payload.supplierId,
          supplierName: payload.supplierName,
          reason: rpcError instanceof Error ? rpcError.message : 'Unknown error'
        });
      }
    }

    if (supplierFailures.length > 0) {
      throw new SupplierOrderCreationError(supplierFailures, purchaseOrderSummaries);
    }

    return {
      successes: purchaseOrderSummaries
    } satisfies SupplierOrderCreationSummary;
  } catch (error) {
    console.error('Error creating purchase orders:', error);
    throw error;
  }
}

// OrderComponentsDialog component
const OrderComponentsDialog = ({
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
      const toastId = toast.loading('Creating purchase orders…');
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

    const toastId = toast.loading('Creating purchase orders…');
    
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
                          const hasGlobalContext = component.total_required_all_orders > component.shortfall;
                          const isForStock = component.shortfall === 0 && component.global_real_shortfall > 0;
                          
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
                                    {component.global_real_shortfall > 0 && (
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
                                    <span className="text-sm text-muted-foreground">—</span>
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
                                            <span className="font-medium">Global Context:</span> Total needed across all orders: {component.total_required_all_orders} • Global shortfall: {component.global_real_shortfall}
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
                  Either no components have shortfalls, or components with shortfalls don't have configured suppliers.
                </p>
                {apparentShortfallExists && (
                  <div className="mt-4 p-4 bg-amber-500/10 border border-amber-500/30 rounded-md">
                    <p className="text-amber-700 dark:text-amber-400">
                      <AlertCircle className="h-4 w-4 inline-block mr-2" />
                      Some components show shortfall but they're already on order. Check the "On Order" column in the Component Requirements table.
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
                    Creating…
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

// Add Products Dialog component
function AddProductsDialog({ 
  orderId, 
  onSuccess 
}: { 
  orderId: number | string; // Updated type to accept both number and string
  onSuccess?: () => void; 
}) {
  const [selectedProducts, setSelectedProducts] = useState<Record<number, { quantity: number; price: number }>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Fetch available products
  const { data: products = [], isLoading } = useQuery({
    queryKey: ['availableProducts'],
    queryFn: fetchAvailableProducts,
  });
  
  // Filter products based on search query
  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return products;
    
    const query = searchQuery.toLowerCase();
    return products.filter((product: any) => 
      (product.name || '').toLowerCase().includes(query) || 
      (product.sku || '').toLowerCase().includes(query) ||
      (product.description || '').toLowerCase().includes(query)
    );
  }, [products, searchQuery]);
  
  // Toggle product selection
  const toggleProductSelection = (productId: number) => {
    setSelectedProducts((prevState) => {
      const newState = { ...prevState };
      
      if (newState[productId]) {
        // Product is already selected, unselect it
        delete newState[productId];
      } else {
        // Product is not selected, select it
        const productAny: any = products.find((p: any) => p.product_id === productId);
        newState[productId] = {
          quantity: 1,
          price: (productAny?.unit_price ?? productAny?.price ?? 0) as number
        };
      }
      
      return newState;
    });
  };
  
  // Handle quantity change for a product
  const handleQuantityChange = (productId: number, quantity: number) => {
    if (quantity < 1) return;
    
    setSelectedProducts((prevState) => {
      const newState = { ...prevState };
      
      if (newState[productId]) {
        newState[productId] = {
          ...newState[productId],
          quantity
        };
      }
      
      return newState;
    });
  };
  
  // Handle price change for a product
  const handlePriceChange = (productId: number, price: number) => {
    setSelectedProducts((prevState) => {
      const newState = { ...prevState };
      
      if (newState[productId]) {
        newState[productId] = {
          ...newState[productId],
          price
        };
      }
      
      return newState;
    });
  };
  
  const selectedCount = useMemo(() => {
    return Object.keys(selectedProducts).length;
  }, [selectedProducts]);
  
  const handleSubmit = async () => {
    if (selectedCount === 0) return;
    
    setIsSubmitting(true);
    
    try {
      console.log('[DEBUG] Starting product add submission', { selectedProducts });
      
      // Transform selected products for the API - ensure unit_price is a valid number
      const lineItems = Object.entries(selectedProducts).map(([productId, data]) => ({
        product_id: parseInt(productId),
        quantity: data.quantity,
        unit_price: parseFloat(data.price.toString()) || 0
      }));
      
      console.log('[DEBUG] Prepared line items for submission:', lineItems);
      
      // Convert orderId to number if it's a string
      const orderIdNum = typeof orderId === 'string' ? parseInt(orderId, 10) : orderId;
      
      if (isNaN(orderIdNum)) {
        throw new Error(`Invalid order ID: ${orderId}`);
      }
      
      console.log('[DEBUG] Converted orderId:', { original: orderId, converted: orderIdNum });
      
      // Show adding toast
      const addingToast = toast.loading('Adding products to order...');
      
      try {
        // Add products to order with simple approach
        const result = await addProductsToOrder(orderIdNum, lineItems);
        
        console.log('[DEBUG] Add products result:', result);
        
        // Dismiss the loading toast
        toast.dismiss(addingToast);
        
        if (result && result.success) {
          const productCount = result.insertedDetails?.length || selectedCount;
          toast.success(`Added ${productCount} product(s) to the order`);
          
          if (onSuccess) {
            // Call the success callback to refresh the order data
            onSuccess();
          }
          
          // Reset form
          setSelectedProducts({});
          setSearchQuery('');
        } else {
          toast.error('Failed to add products to order');
        }
      } catch (error) {
        // Dismiss the loading toast on error
        toast.dismiss(addingToast);
        throw error; // Re-throw to be caught by the outer catch
      }
    } catch (error) {
      console.error('[ERROR] Error adding products to order:', error);
      
      // Show a more informative error message
      let errorMessage = 'Failed to add products to order';
      
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" className="flex items-center gap-1">
          <Plus className="h-4 w-4" />
          Add Products
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[800px]">
        <DialogHeader>
          <DialogTitle>Add Products to Order</DialogTitle>
          <DialogDescription>
            Select products to add to this order.
          </DialogDescription>
        </DialogHeader>
        
        {/* Search input */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search products by name, SKU, or description..."
            className="pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        
        {isLoading ? (
          <div className="flex justify-center items-center py-8">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            <span>Loading products...</span>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No products found.
          </div>
        ) : (
          <div className="max-h-[400px] overflow-y-auto">
            <table className="w-full">
              <thead className="bg-muted">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium"></th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Product</th>
                  <th className="px-4 py-3 text-right text-sm font-medium">Price</th>
                  <th className="px-4 py-3 text-right text-sm font-medium">Quantity</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredProducts.map((product: any) => {
                  const isSelected = !!selectedProducts[product.product_id];
                  return (
                    <tr 
                      key={product.product_id} 
                      className={isSelected ? 'bg-primary/5' : 'hover:bg-muted/50'}
                    >
                      <td className="px-4 py-3 text-center">
                        <Checkbox 
                          checked={isSelected}
                          onCheckedChange={() => toggleProductSelection(product.product_id)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-medium">{product.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {product.sku || 'No SKU'} 
                            {product.description && ` • ${product.description.substring(0, 50)}${product.description.length > 50 ? '...' : ''}`}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isSelected ? (
                          <div className="flex items-center justify-end">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={selectedProducts[product.product_id]?.price || 0}
                              onChange={(e) => handlePriceChange(product.product_id, parseFloat(e.target.value) || 0)}
                              className="w-24 h-8 text-right border rounded px-2"
                            />
                          </div>
                        ) : (
                          <span>{formatCurrency(product.unit_price || 0)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right w-32">
                        {isSelected && (
                          <div className="flex items-center justify-end">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => handleQuantityChange(product.product_id, Math.max(1, (selectedProducts[product.product_id]?.quantity || 1) - 1))}
                              disabled={selectedProducts[product.product_id]?.quantity <= 1}
                            >
                              <span className="sr-only">Decrease quantity</span>
                              <span className="text-xs">-</span>
                            </Button>
                            <input
                              type="number"
                              min="1"
                              value={selectedProducts[product.product_id]?.quantity || 1}
                              onChange={(e) => handleQuantityChange(product.product_id, parseInt(e.target.value) || 1)}
                              className="w-12 h-8 mx-1 text-center border rounded"
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => handleQuantityChange(product.product_id, (selectedProducts[product.product_id]?.quantity || 1) + 1)}
                            >
                              <span className="sr-only">Increase quantity</span>
                              <span className="text-xs">+</span>
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        
        <DialogFooter className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {selectedCount} product{selectedCount !== 1 ? 's' : ''} selected
          </div>
          <Button 
            onClick={handleSubmit} 
            disabled={selectedCount === 0 || isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Adding Products...
              </>
            ) : (
              'Add to Order'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Function to delete an attachment
async function deleteAttachment(attachmentId: number): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('order_attachments')
      .delete()
      .eq('attachment_id', attachmentId);

    if (error) {
      console.error('Error deleting attachment:', error);
      throw new Error('Failed to delete attachment');
    }

    return true;
  } catch (error) {
    console.error('Error in deleteAttachment:', error);
    return false;
  }
}

// Debug function to inspect the billofmaterials table
async function inspectBillOfMaterials(productId: number) {
  console.log(`[DEBUG] Inspecting BOM for product ${productId}`);
  
  try {
    // Check what tables exist in the public schema
    const { data: tables, error: tablesError } = await supabase
      .from('pg_catalog.pg_tables')
      .select('tablename')
      .eq('schemaname', 'public');
    
    console.log(`[DEBUG] Available tables:`, tables?.map(t => t.tablename).join(', ') || 'None found');
    
    if (tablesError) {
      console.error(`[ERROR] Error listing tables:`, tablesError);
    }
    
    // Try various possible BOM table names
    const possibleBomTables = ['billofmaterials', 'bill_of_materials', 'product_components', 'bom'];
    
    for (const tableName of possibleBomTables) {
      console.log(`[DEBUG] Checking if table exists: ${tableName}`);
      
      try {
        const { data, error } = await supabase
          .from(tableName)
          .select('count(*)')
          .limit(1);
        
        if (!error) {
          console.log(`[DEBUG] Table ${tableName} exists!`);
          
          // If table exists, check for product's BOM
          const { data: productBom, error: productBomError } = await supabase
            .from(tableName)
            .select('*')
            .eq('product_id', productId);
          
          if (!productBomError && productBom && productBom.length > 0) {
            console.log(`[DEBUG] Found ${productBom.length} BOM items for product ${productId} in table ${tableName}`);
            console.log(`[DEBUG] First BOM item:`, JSON.stringify(productBom[0]));
          } else {
            console.log(`[DEBUG] No BOM found for product ${productId} in table ${tableName}`);
          }
        } else {
          console.log(`[DEBUG] Table ${tableName} doesn't exist or not accessible`);
        }
      } catch (err) {
        console.error(`[ERROR] Error checking table ${tableName}:`, err);
      }
    }
    
    // Also try a direct query to see component relationships
    try {
      const { data: productComponents, error: pcError } = await supabase
        .rpc('get_product_components', { product_id: productId });
      
      if (pcError) {
        console.log(`[DEBUG] RPC get_product_components not available:`, pcError.message);
      } else {
        console.log(`[DEBUG] Product components via RPC:`, productComponents);
      }
    } catch (err) {
      console.log(`[DEBUG] RPC not available:`, err);
    }
    
    return {
      tables,
      message: 'Check console logs for full inspection results'
    };
  } catch (error) {
    console.error(`[ERROR] Error in inspectBillOfMaterials:`, error);
    return null;
  }
}

// Add the fetchOrderStatuses function
async function fetchOrderStatuses() {
  try {
    const { data, error } = await supabase
      .from('order_statuses')
      .select('*')
      .order('status_name');

    if (error) {
      console.error('Error fetching order statuses:', error);
      throw new Error('Failed to fetch order statuses');
    }

    return data || [];
  } catch (error) {
    console.error('Error in fetchOrderStatuses:', error);
    return [];
  }
}

// Add updateOrderStatus function
async function updateOrderStatus(orderId: number, statusId: number): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('orders')
      .update({ status_id: statusId })
      .eq('order_id', orderId);

    if (error) {
      console.error('Error updating order status:', error);
      throw new Error('Failed to update order status');
    }

    return true;
  } catch (error) {
    console.error('Error in updateOrderStatus:', error);
    return false;
  }
}

// Add fetchAvailableProducts function
async function fetchAvailableProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*');

  if (error) {
    console.error('Error fetching products:', error);
    return [];
  }

  return data;
}

// Add addProductsToOrder function
async function addProductsToOrder(orderId: number, products: { product_id: number; quantity: number; unit_price: number }[]) {
  try {
    console.log('[DEBUG] Starting to add products to order:', { orderId, products });
    
    if (!orderId || !products.length) {
      console.error('[ERROR] Invalid input parameters:', { orderId, productsLength: products.length });
      throw new Error('Invalid parameters for adding products');
    }
    
    // Prepare order details with only the exact fields in the database schema
    const orderDetails = products.map(product => ({
      order_id: orderId,
      product_id: product.product_id,
      quantity: product.quantity,
      unit_price: product.unit_price
    }));
    
    console.log('[DEBUG] Prepared order details:', orderDetails);
    
    // Use a simple single insert operation
    const { data: insertedDetails, error: insertError } = await supabase
      .from('order_details')
      .insert(orderDetails)
      .select();
    
    if (insertError) {
      console.error('[ERROR] Error adding products to order:', insertError);
      throw new Error(`Failed to add products to order: ${insertError.message}`);
    }
    
    console.log('[DEBUG] Successfully added products:', insertedDetails);
    
    // Calculate the total increase
    const totalIncrease = products.reduce((sum, product) => 
      sum + (product.unit_price * product.quantity), 0);
    
    // Update the order total
    if (totalIncrease > 0) {
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .select('total_amount')
        .eq('order_id', orderId)
        .single();
      
      if (orderError) {
        console.error('[ERROR] Error fetching order total:', orderError);
        // Continue anyway since the products were added successfully
      } else {
        const currentTotal = orderData?.total_amount || 0;
        const newTotal = parseFloat(currentTotal.toString()) + totalIncrease;
        
        console.log('[DEBUG] Updating order total:', { currentTotal, totalIncrease, newTotal });
        
        const { error: updateError } = await supabase
          .from('orders')
          .update({ total_amount: newTotal })
          .eq('order_id', orderId);
        
        if (updateError) {
          console.error('[ERROR] Error updating order total:', updateError);
          // Continue anyway since the products were added successfully
        }
      }
    }
    
    return {
      success: true,
      insertedDetails: insertedDetails || [],
      totalIncrease
    };
  } catch (error) {
    console.error('[ERROR] Error in addProductsToOrder:', error);
    throw error;
  }
}

// Status Badge component
function StatusBadge({ status }: { status: string }) {
  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'new':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'in progress':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'completed':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'cancelled':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(status)}`}>
      {status}
    </span>
  );
}

// Add determineSections function
function determineProductSections(product: any): string[] {
  const sections: string[] = [];
  
  if (product?.name?.toLowerCase().includes('chair') || 
      product?.description?.toLowerCase().includes('upholstery')) {
    sections.push('chair');
  }
  if (product?.description?.toLowerCase().includes('wood')) {
    sections.push('wood');
  }
  if (product?.description?.toLowerCase().includes('steel')) {
    sections.push('steel');
  }
  if (product?.description?.toLowerCase().includes('mechanical')) {
    sections.push('mechanical');
  }
  if (product?.description?.toLowerCase().includes('powder') || 
      product?.description?.toLowerCase().includes('coating')) {
    sections.push('powdercoating');
  }
  
  return sections;
}

// Add interface for sections
interface OrderSection {
  name: string;
  icon: React.ReactNode;
  color: string;
}

// Update sections to include powdercoating
const sections: { [key: string]: OrderSection } = {
  chair: {
    name: 'Chair',
    icon: <Package className="h-4 w-4" />,
    color: 'bg-gray-100 text-gray-800',
  },
  wood: {
    name: 'Wood',
    icon: <Layers className="h-4 w-4" />,
    color: 'bg-gray-100 text-gray-800',
  },
  steel: {
    name: 'Steel',
    icon: <Wrench className="h-4 w-4" />,
    color: 'bg-gray-100 text-gray-800',
  },
  mechanical: {
    name: 'Mechanical',
    icon: <Cog className="h-4 w-4" />,
    color: 'bg-gray-100 text-gray-800',
  },
  powdercoating: {
    name: 'Powdercoating',
    icon: <PaintBucket className="h-4 w-4" />,
    color: 'bg-gray-100 text-gray-800',
  },
};

// Using shared types from '@/types/components' for SupplierInfo and SupplierGroup

interface SupplierOrder {
  supplier_id: number;
  order_date: string;
  status: string;
  notes?: string;
  components: Array<{
    supplier_component_id: number;
    order_quantity: number;
    unit_price: number;
  }>;
}

// Update the component requirements table to use the new tooltips
export default function OrderDetailPage({ params }: OrderDetailPageProps) {
  // Unwrap the params Promise (Next.js 16 requirement)
  const { orderId: orderIdParam } = use(params);
  const orderId = parseInt(orderIdParam, 10);
  // Tab state — support deep-linking via ?tab= query param
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab') || 'details';
  const [activeTab, setActiveTab] = useState<string>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const router = useRouter();
  const [orderComponentsOpen, setOrderComponentsOpen] = useState<boolean>(false);
  const [statusOptions, setStatusOptions] = useState<any[]>([]);
  // Add state for expanded rows
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [applyFgCoverage, setApplyFgCoverage] = useState<boolean>(true);
  const [showGlobalContext, setShowGlobalContext] = useState<boolean>(true);
  const [fgReservationsOpen, setFgReservationsOpen] = useState<boolean>(false);

  // Inline edit state (always editable, auto-save on change)
  const [editCustomerId, setEditCustomerId] = useState<string>('');
  const [editOrderNumber, setEditOrderNumber] = useState<string>('');
  const [editDeliveryDate, setEditDeliveryDate] = useState<string>('');
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [isInitialized, setIsInitialized] = useState(false);

  // Product editing state
  const [editingDetailId, setEditingDetailId] = useState<number | null>(null);
  const [editQuantity, setEditQuantity] = useState<string>('');
  const [editUnitPrice, setEditUnitPrice] = useState<string>('');

  // Delete confirmation dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<{ id: number; name: string } | null>(null);

  // Add toggle function for product row expansion
  const toggleRowExpansion = (productId: string) => {
    setExpandedRows(prev => ({
      ...prev,
      [productId]: !prev[productId]
    }));
  };

  // Fetch order details
  const { 
    data: order, 
    isLoading: orderLoading, 
    error: orderError 
  } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => fetchOrderDetails(orderId),
  });

  // Fetch order attachments
  const {
    data: attachments,
    isLoading: attachmentsLoading,
    error: attachmentsError
  } = useQuery({
    queryKey: ['orderAttachments', orderId],
    queryFn: () => fetchOrderAttachments(orderId),
  });

  const {
    data: fgReservations = [],
    isLoading: fgReservationsLoading,
    refetch: refetchFgReservations,
  } = useQuery({
    queryKey: ['fgReservations', orderId],
    queryFn: () => fetchFinishedGoodReservations(orderId),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  // Fetch customers (always fetch for inline editing)
  const { data: customers, isLoading: customersLoading } = useQuery<Customer[], Error>({
    queryKey: ['customers'],
    queryFn: () => fetchCustomers(),
  });

  const customersSorted = useMemo(
    () => (customers || []).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [customers]
  );

  const filteredCustomers = useMemo(
    () => customersSorted.filter(c =>
      c.name.toLowerCase().startsWith(customerSearchTerm.toLowerCase())
    ),
    [customersSorted, customerSearchTerm]
  );

  // Mutation for updating order
  const updateOrderMutation = useMutation({
    mutationFn: async (data: { customer_id?: number; order_number?: string | null; delivery_date?: string | null }) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        throw new Error('Session expired. Please sign in again.');
      }
      const response = await fetch(`/api/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update order');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      queryClient.invalidateQueries({ queryKey: ['orderActivity', orderId] });
      toast.success('Order updated successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update order: ${error.message}`);
    },
  });

  // Activity log
  const [activityExpanded, setActivityExpanded] = useState(false);
  const { data: activityLog } = useQuery({
    queryKey: ['orderActivity', orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_activity')
        .select('id, action_type, description, metadata, performed_by, created_at')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const userIds = [...new Set((data || []).map(a => a.performed_by).filter(Boolean))] as string[];
      let profileMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, display_name, first_name, last_name')
          .in('id', userIds);
        if (profiles) {
          profileMap = Object.fromEntries(
            profiles.map((p: any) => [p.id, p.display_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unknown'])
          );
        }
      }

      return (data || []).map(a => ({
        ...a,
        performer_name: a.performed_by ? (profileMap[a.performed_by] || 'Unknown') : 'System',
      }));
    },
    enabled: !!orderId,
  });

  // Initialize edit form values when order loads
  useEffect(() => {
    if (order && !isInitialized) {
      setEditCustomerId(order.customer_id?.toString() || '');
      setEditOrderNumber(order.order_number || '');
      setEditDeliveryDate(order.delivery_date || '');
      setIsInitialized(true);
    }
  }, [order, isInitialized]);

  // Auto-save function for individual field changes
  const saveField = useCallback((field: 'customer_id' | 'order_number' | 'delivery_date', value: any) => {
    if (!order) return;
    
    const updates: { customer_id?: number; order_number?: string | null; delivery_date?: string | null } = {};
    
    if (field === 'customer_id' && value !== order.customer_id?.toString()) {
      updates.customer_id = Number(value);
    } else if (field === 'order_number' && value !== order.order_number) {
      updates.order_number = value || null;
    } else if (field === 'delivery_date' && value !== order.delivery_date) {
      updates.delivery_date = value || null;
    }

    if (Object.keys(updates).length > 0) {
      updateOrderMutation.mutate(updates);
    }
  }, [order, updateOrderMutation]);

  // Handle customer change with immediate save
  const handleCustomerChange = (customerId: string) => {
    setEditCustomerId(customerId);
    setCustomerOpen(false);
    setCustomerSearchTerm('');
    saveField('customer_id', customerId);
  };

  // Handle order number blur (save on blur)
  const handleOrderNumberBlur = () => {
    if (editOrderNumber !== (order?.order_number || '')) {
      saveField('order_number', editOrderNumber);
    }
  };

  // Handle delivery date change with immediate save
  const handleDeliveryDateChange = (date: string) => {
    setEditDeliveryDate(date);
    saveField('delivery_date', date);
  };

  // Mutation for updating order detail
  const updateDetailMutation = useMutation({
    mutationFn: async ({ detailId, quantity, unit_price }: { detailId: number; quantity?: number; unit_price?: number }) => {
      const response = await fetch(`/api/order-details/${detailId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity, unit_price }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update product');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      queryClient.invalidateQueries({ queryKey: ['orderComponentRequirements', orderId] });
      queryClient.invalidateQueries({ queryKey: ['fgReservations', orderId] });
      toast.success('Product updated successfully');
      setEditingDetailId(null);
    },
    onError: (error: Error) => {
      toast.error(`Failed to update product: ${error.message}`);
    },
  });

  // Mutation for deleting order detail
  const deleteDetailMutation = useMutation({
    mutationFn: async (detailId: number) => {
      const response = await fetch(`/api/order-details/${detailId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete product');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      queryClient.invalidateQueries({ queryKey: ['orderComponentRequirements', orderId] });
      queryClient.invalidateQueries({ queryKey: ['fgReservations', orderId] });
      toast.success('Product removed from order');
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete product: ${error.message}`);
    },
  });

  // Handlers for product editing
  const handleStartEditDetail = (detail: OrderDetail) => {
    setEditingDetailId(detail.order_detail_id);
    setEditQuantity(detail.quantity?.toString() || '0');
    setEditUnitPrice(detail.unit_price?.toString() || '0');
  };

  const handleSaveDetail = (detailId: number) => {
    const quantity = parseFloat(editQuantity);
    const unit_price = parseFloat(editUnitPrice);

    if (isNaN(quantity) || quantity < 0) {
      toast.error('Please enter a valid quantity');
      return;
    }
    if (isNaN(unit_price) || unit_price < 0) {
      toast.error('Please enter a valid unit price');
      return;
    }

    updateDetailMutation.mutate({ detailId, quantity, unit_price });
  };

  const handleCancelDetailEdit = () => {
    setEditingDetailId(null);
    setEditQuantity('');
    setEditUnitPrice('');
  };

  const handleDeleteDetail = (detailId: number, productName: string) => {
    setProductToDelete({ id: detailId, name: productName });
    setDeleteDialogOpen(true);
  };

  const confirmDeleteProduct = () => {
    if (productToDelete) {
      deleteDetailMutation.mutate(productToDelete.id);
      setDeleteDialogOpen(false);
      setProductToDelete(null);
    }
  };

  const cancelDeleteProduct = () => {
    setDeleteDialogOpen(false);
    setProductToDelete(null);
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedCoverage = window.localStorage.getItem('orders.applyFgCoverage');
    const storedGlobal = window.localStorage.getItem('orders.showGlobalContext');
    if (storedCoverage !== null) {
      setApplyFgCoverage(storedCoverage === 'true');
    }
    if (storedGlobal !== null) {
      setShowGlobalContext(storedGlobal === 'true');
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('orders.applyFgCoverage', applyFgCoverage ? 'true' : 'false');
  }, [applyFgCoverage]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('orders.showGlobalContext', showGlobalContext ? 'true' : 'false');
  }, [showGlobalContext]);

  const fgReservationMap = useMemo(() => {
    const map = new Map<number, number>();
    (fgReservations ?? []).forEach((reservation: FinishedGoodReservation) => {
      if (typeof reservation?.product_id === 'number') {
        map.set(
          reservation.product_id,
          Number(
            reservation.reserved_quantity ??
            0
          )
        );
      }
    });
    return map;
  }, [fgReservations]);

  const coverageByProduct = useMemo(() => {
    const map = new Map<number, { ordered: number; reserved: number; remain: number; factor: number }>();
    if (order?.details) {
      order.details.forEach((detail: OrderDetail) => {
        if (!detail?.product_id) return;
        const ordered = Number(detail?.quantity ?? 0);
        const reserved = fgReservationMap.get(detail.product_id) ?? 0;
        const remain = Math.max(0, ordered - reserved);
        const factor = ordered > 0 ? remain / ordered : 1;
        map.set(detail.product_id, { ordered, reserved, remain, factor });
      });
    }
    return map;
  }, [order?.details, fgReservationMap]);

  const finishedGoodsRows = useMemo(() => {
    if (!order?.details || order.details.length === 0) {
      return [] as Array<{
        product_id: number;
        name: string;
        internal_code?: string | null;
        ordered: number;
        reserved: number;
        remain: number;
      }>;
    }

    return order.details.map((detail: OrderDetail & { product?: Product }) => {
      const coverage = coverageByProduct.get(detail.product_id) ?? {
        ordered: Number(detail.quantity ?? 0),
        reserved: 0,
        remain: Number(detail.quantity ?? 0),
        factor: 1,
      };
      const reservation = fgReservations.find(res => res.product_id === detail.product_id);
      return {
        product_id: detail.product_id,
        name: detail.product?.name || reservation?.product_name || `Product ${detail.product_id}`,
        internal_code: detail.product?.internal_code || reservation?.product_internal_code || null,
        ordered: coverage.ordered,
        reserved: coverage.reserved,
        remain: coverage.remain,
      };
    });
  }, [coverageByProduct, fgReservations, order?.details]);

  const hasFgReservations = useMemo(() => (fgReservations?.length ?? 0) > 0, [fgReservations]);

  const computeComponentMetrics = useCallback((component: any, productId: number) => {
    const baseRequired = Number(
      component?.quantity_required ??
      component?.total_required ??
      component?.order_required ??
      0
    );
    const inStock = Number(component?.quantity_in_stock ?? component?.in_stock ?? 0);
    const onOrder = Number(component?.quantity_on_order ?? component?.on_order ?? 0);
    const coverage = coverageByProduct.get(productId);
    const factor = applyFgCoverage ? (coverage?.factor ?? 1) : 1;
    const required = baseRequired * factor;
    const apparent = Math.max(0, required - inStock);
    const real = Math.max(0, required - inStock - onOrder);

    return {
      required,
      inStock,
      onOrder,
      apparent,
      real,
      factor,
    };
  }, [applyFgCoverage, coverageByProduct]);

  // Fetch order statuses
  useEffect(() => {
    const getOrderStatuses = async () => {
      try {
        const statuses = await fetchOrderStatuses();
        setStatusOptions(statuses);
      } catch (error) {
        console.error('Error fetching order statuses:', error);
      }
    };
    
    getOrderStatuses();
  }, []);

  // Update order status mutation
  const updateStatusMutation = useMutation({
    mutationFn: ({ statusId }: { statusId: number }) => updateOrderStatus(orderId, statusId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      toast.success("Order status has been updated successfully");
    },
    onError: () => {
      toast.error("Failed to update order status. Please try again.");
    },
  });

  const reserveFgMutation = useMutation({
    mutationFn: () => reserveFinishedGoods(orderId),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['fgReservations', orderId] });
    },
    onSuccess: async (reservations) => {
      queryClient.setQueryData(['fgReservations', orderId], reservations);
      toast.success('Finished goods reserved');
      await Promise.all([
        refetchFgReservations(),
        refetchComponentRequirements(),
      ]);
    },
    onError: (error: any) => {
      console.error('[reserve-fg] mutation error', error);
      toast.error('Failed to reserve finished goods');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['fgReservations', orderId] });
      queryClient.invalidateQueries({ queryKey: ['orderComponentRequirements', orderId] });
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    },
  });

  const releaseFgMutation = useMutation({
    mutationFn: () => releaseFinishedGoods(orderId),
    onSuccess: async () => {
      // Optimistic UI: clear reservations immediately
      queryClient.setQueryData(['fgReservations', orderId], [] as FinishedGoodReservation[]);
      toast.success('Finished goods released');
      // Proactively refetch to sync any server-side side effects
      await Promise.all([
        refetchFgReservations(),
        refetchComponentRequirements(),
        queryClient.invalidateQueries({ queryKey: ['order', orderId] }),
      ]);
      // Also refresh supplier group data if dialog is open
      queryClient.invalidateQueries({ queryKey: ['component-suppliers', String(orderId)] });
    },
    onError: (error: any) => {
      console.error('[release-fg] mutation error', error);
      toast.error('Failed to release finished goods');
    },
  });

  const consumeFgMutation = useMutation({
    mutationFn: () => consumeFinishedGoods(orderId),
    onSuccess: async () => {
      queryClient.setQueryData(['fgReservations', orderId], [] as FinishedGoodReservation[]);
      toast.success('Finished goods consumed');
      await Promise.all([
        refetchFgReservations(),
        refetchComponentRequirements(),
      ]);
    },
    onError: (error: any) => {
      console.error('[consume-fg] mutation error', error);
      toast.error('Failed to consume finished goods');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['fgReservations', orderId] });
      queryClient.invalidateQueries({ queryKey: ['orderComponentRequirements', orderId] });
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    },
  });

  // Inside the OrderDetailPage component, add this query for component requirements
  const { 
    data: componentRequirements = [], 
    refetch: refetchComponentRequirements
  } = useQuery<ProductRequirement[]>({
    queryKey: ['orderComponentRequirements', orderId],
    queryFn: () => fetchOrderComponentRequirements(orderId),
  });

  // Calculate totals and critical shortfalls from component requirements
  const totals = useMemo(() => {
    let totalComponents = 0;
    let totalShortfall = 0;
    let componentsInStock = 0;
    let componentsOnOrder = 0;
    let componentsInDraftPO = 0;
    let componentsPendingDeliveries = 0;
    
    // Collect shortfall details
    const shortfallComponents: Array<{
      code: string;
      description: string;
      required: number;
      inStock: number;
      onOrder: number;
      draftPO: number;
      shortfall: number;
    }> = [];

    componentRequirements.forEach((productReq: ProductRequirement) => {
      (productReq.components ?? []).forEach((component: any) => {
        totalComponents++;
        const metrics = computeComponentMetrics(component, productReq.product_id);
        const inStock = Number(component?.quantity_in_stock ?? component?.in_stock ?? 0);
        const onOrder = Number(component?.quantity_on_order ?? component?.on_order ?? 0);
        const draftPO = Number(component?.draft_po_quantity ?? 0);
        
        const readyNow = metrics.apparent <= 0.0001;
        const waitingOnDeliveries = metrics.apparent > 0.0001 && metrics.real <= 0.0001;

        if (metrics.real > 0.0001) {
          totalShortfall++;
          shortfallComponents.push({
            code: component?.internal_code || 'Unknown',
            description: component?.description || '',
            required: metrics.required,
            inStock,
            onOrder,
            draftPO,
            shortfall: metrics.real
          });
        } else if (readyNow) {
          componentsInStock++;
        } else if (waitingOnDeliveries) {
          componentsPendingDeliveries++;
        }
        
        if (onOrder > 0) componentsOnOrder++;
        if (draftPO > 0) componentsInDraftPO++;
      });
    });
    
    // Sort by shortfall and take top 5
    const criticalShortfalls = shortfallComponents
      .sort((a, b) => b.shortfall - a.shortfall)
      .slice(0, 5);
    
    const stockCoverage = totalComponents > 0 
      ? Math.round((componentsInStock / totalComponents) * 100) 
      : 100;

    return {
      totalComponents,
      totalShortfall,
      componentsInStock,
      componentsOnOrder,
      componentsInDraftPO,
      componentsPendingDeliveries,
      criticalShortfalls,
      allShortfalls: shortfallComponents,
      stockCoverage
    };
  }, [componentRequirements, computeComponentMetrics]);

  // Enhanced filter function to include section filtering
  const filterOrderDetails = (details: any[]) => {
    if (!details) return [];
    
    let filteredDetails = [...details];
    
    // Apply section filter if active
    if (activeSection) {
      filteredDetails = filteredDetails.filter(detail => 
        determineProductSections(detail.product).includes(activeSection)
      );
    }
    
    // Apply search query filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filteredDetails = filteredDetails.filter(detail => 
        detail.product?.name?.toLowerCase().includes(query) ||
        detail.product?.description?.toLowerCase().includes(query) ||
        detail.order_detail_id.toString().includes(query)
      );
    }
    
    return filteredDetails;
  };

  // Function to handle section filter clicks
  const handleSectionFilter = (section: string | null) => {
    setActiveSection(section);
  };

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    const url = new URL(window.location.href);
    if (value === 'details') {
      url.searchParams.delete('tab');
    } else {
      url.searchParams.set('tab', value);
    }
    window.history.replaceState({}, '', url.toString());
  };

  const handleDeleteAttachment = async (attachmentId: number) => {
    try {
      await deleteAttachment(attachmentId);
      
      toast.success('Attachment deleted successfully');
      
      // Refresh attachment list
      queryClient.invalidateQueries({ queryKey: ['orderAttachments', orderId] });
    } catch (error) {
      console.error('Error deleting attachment:', error);
      toast.error('Failed to delete attachment');
    }
  };

  if (orderLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {order?.order_number || `Order #${orderId}`}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Created on {order?.created_at && format(new Date(order.created_at), 'MMMM d, yyyy')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={order?.status?.status_name || 'Open'} />
          {order?.delivery_date && (
            <Badge variant="outline" className="gap-1">
              <span className="text-muted-foreground">Delivery:</span>
              {format(new Date(order.delivery_date), 'MMM d, yyyy')}
            </Badge>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="components">Components</TabsTrigger>
          <TabsTrigger value="issue-stock">Issue Stock</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="procurement">Procurement</TabsTrigger>
            <TabsTrigger value="job-cards">Job Cards</TabsTrigger>
        </TabsList>
        
        <TabsContent value="details" className="space-y-6">
          {/* Content for details tab */}
          <div className="flex justify-end">
            <AddProductsDialog 
              orderId={orderId} 
              onSuccess={() => {
                queryClient.invalidateQueries({ queryKey: ['order', orderId] });
                queryClient.invalidateQueries({ queryKey: ['orderComponentRequirements', orderId] });
                queryClient.invalidateQueries({ queryKey: ['component-suppliers', orderId] });
                toast.success("Products added successfully");
              }} 
            />
      </div>

          {/* Order Summary Card - Inline Editing */}
          <Card>
          <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Order Summary</CardTitle>
              {updateOrderMutation.isPending && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </div>
              )}
          </CardHeader>
          <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Customer Details - Inline Editable */}
                <div className="space-y-3">
                  <h3 className="font-medium text-sm text-muted-foreground">Customer Details</h3>
                  <div className="space-y-2">
                    <Popover open={customerOpen} onOpenChange={setCustomerOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          role="combobox"
                          aria-expanded={customerOpen}
                          className="w-full justify-between h-9 font-normal"
                          disabled={customersLoading}
                        >
                          {customersLoading
                            ? 'Loading...'
                            : (customers?.find((c) => c.id.toString() === editCustomerId)?.name || order?.customer?.name || 'Select a customer')}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                        <div className="flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground">
                          <div className="flex items-center border-b px-3">
                            <Search className="h-4 w-4 text-muted-foreground mr-2" />
                            <input
                              className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                              placeholder="Search customers..."
                              value={customerSearchTerm}
                              onChange={(e) => setCustomerSearchTerm(e.target.value)}
                            />
                          </div>
                          <div className="max-h-[300px] overflow-y-auto overflow-x-hidden">
                            {filteredCustomers.length === 0 ? (
                              <div className="py-6 text-center text-sm">No customer found.</div>
                            ) : (
                              <div className="overflow-hidden p-1 text-foreground">
                                {filteredCustomers.map((c) => (
                                <div
                                  key={c.id}
                                  className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                                  onClick={() => handleCustomerChange(String(c.id))}
                                >
                                  <Check
                                    className={cn(
                                      'mr-2 h-4 w-4',
                                      editCustomerId === c.id.toString() ? 'opacity-100' : 'opacity-0'
                                    )}
                                  />
                                  {c.name}
                                </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                    {/* Customer contact info */}
                    {(() => {
                      const selectedCustomer = customers?.find(c => c.id.toString() === editCustomerId) || order?.customer;
                      if (!selectedCustomer) return null;
                      return (
                        <div className="text-sm space-y-1 pl-1">
                          {selectedCustomer.contact_person && (
                            <p className="text-muted-foreground">
                              <span className="font-medium">Contact:</span> {selectedCustomer.contact_person}
                            </p>
                          )}
                          {selectedCustomer.email && (
                            <p>
                              <a href={`mailto:${selectedCustomer.email}`} className="text-blue-600 hover:underline">
                                {selectedCustomer.email}
                              </a>
                            </p>
                          )}
                          {selectedCustomer.phone && (
                            <p>
                              <a href={`tel:${selectedCustomer.phone}`} className="text-blue-600 hover:underline">
                                {selectedCustomer.phone}
                              </a>
                            </p>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Order Information - Inline Editable */}
                <div className="space-y-3">
                  <h3 className="font-medium text-sm text-muted-foreground">Order Information</h3>
                  <div className="space-y-3">
                    {/* Order Date (read-only) */}
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground min-w-[80px]">Created:</span>
                      <span>{order?.created_at && format(new Date(order.created_at), 'MMM d, yyyy')}</span>
                    </div>
                    
                    {/* Delivery Date - Editable */}
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground min-w-[80px]">Delivery:</span>
                      <Input
                        type="date"
                        value={editDeliveryDate}
                        onChange={(e) => handleDeliveryDateChange(e.target.value)}
                        className="h-8 w-[160px]"
                      />
                    </div>
                    
                    {/* Order Number - Editable */}
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground min-w-[80px]">Order #:</span>
                      <Input
                        value={editOrderNumber}
                        onChange={(e) => setEditOrderNumber(e.target.value)}
                        onBlur={handleOrderNumberBlur}
                        placeholder="Enter order number"
                        className="h-8 w-[160px]"
                      />
                    </div>
                    
                    {/* Status */}
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground min-w-[80px]">Status:</span>
                      <StatusBadge status={order?.status?.status_name || 'Unknown'} />
                    </div>
                  </div>
                </div>
              </div>

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

          {/* Finished-Good Reservations */}
          <Collapsible open={fgReservationsOpen} onOpenChange={setFgReservationsOpen}>
            <Card>
              <CollapsibleTrigger asChild>
                <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between cursor-pointer hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-2">
                    {fgReservationsOpen ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                    <div>
                      <CardTitle className="text-lg">Stock Reservations</CardTitle>
                      <CardDescription>
                        Reserve pre-built products from stock to reduce the components needed for this order.
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                    <Button
                      onClick={() => reserveFgMutation.mutate()}
                      disabled={reserveFgMutation.isPending || orderLoading}
                      title="Reserve available finished goods from stock for this order"
                    >
                      {reserveFgMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Package className="mr-2 h-4 w-4" />
                      )}
                      Reserve Stock
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => releaseFgMutation.mutate()}
                      disabled={!hasFgReservations || releaseFgMutation.isPending}
                      title="Release reservations back to available stock"
                    >
                      {releaseFgMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <RotateCcw className="mr-2 h-4 w-4" />
                      )}
                      Release
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => consumeFgMutation.mutate()}
                      disabled={!hasFgReservations || consumeFgMutation.isPending}
                      title="Mark reserved items as shipped and deduct from inventory"
                    >
                      {consumeFgMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle className="mr-2 h-4 w-4" />
                      )}
                      Ship
                    </Button>
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent>
              {applyFgCoverage && (
                <Badge variant="outline" className="mb-3 bg-blue-500/15 text-blue-700 dark:text-blue-400">
                  Stock reservations applied
                </Badge>
              )}
              {fgReservationsLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading finished-good reservations…
                </div>
              ) : finishedGoodsRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No products on this order have stock available to reserve.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Ordered</TableHead>
                      <TableHead className="text-right">Reserved</TableHead>
                      <TableHead className="text-right">Need to Build</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {finishedGoodsRows.map((row) => {
                      const reservedPercent = row.ordered > 0
                        ? Math.round(((row.ordered - row.remain) / row.ordered) * 100)
                        : 0;
                      return (
                        <TableRow key={`fg-row-${row.product_id}`}>
                          <TableCell>
                            <div className="font-medium">{row.name}</div>
                            {row.internal_code && (
                              <div className="text-xs text-muted-foreground">{row.internal_code}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-right">{formatQuantity(row.ordered)}</TableCell>
                          <TableCell className="text-right">
                            <span className={cn(
                              row.reserved > 0 ? 'text-blue-700 font-medium' : 'text-muted-foreground'
                            )}>
                              {formatQuantity(row.reserved)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            {formatQuantity(row.remain)}
                            {row.reserved > 0 && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                {reservedPercent}% reserved
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
              {!hasFgReservations && finishedGoodsRows.length > 0 && (
                <div className="mt-3 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  Reserving stock will automatically reduce the components needed for this order.
                </div>
              )}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* Products List */}
          <Card>
          <CardHeader>
              <CardTitle className="text-lg">Products ({order?.details?.length || 0})</CardTitle>
          </CardHeader>
          <CardContent>
            {order?.details && order.details.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Reserved</TableHead>
                      <TableHead className="text-right">To Build</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right w-[100px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {order.details.map((detail: any) => {
                      const isEditing = editingDetailId === detail.order_detail_id;
                      const coverage = coverageByProduct.get(detail.product_id) ?? {
                        ordered: Number(detail.quantity ?? 0),
                        reserved: 0,
                        remain: Number(detail.quantity ?? 0),
                        factor: 1,
                      };

                      return (
                        <TableRow key={detail.order_detail_id}>
                          <TableCell>
                            <div>
                              <p className="font-medium">{detail.product?.name}</p>
                              <p className="text-sm text-muted-foreground truncate max-w-md">
                                {detail.product?.description || 'No description available'}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            {isEditing ? (
                              <Input
                                type="number"
                                value={editQuantity}
                                onChange={(e) => setEditQuantity(e.target.value)}
                                className="w-24 text-right"
                                min="0"
                                step="0.01"
                              />
                            ) : (
                              formatQuantity(coverage.ordered)
                            )}
                          </TableCell>
                          <TableCell className="text-right">{formatQuantity(coverage.reserved)}</TableCell>
                          <TableCell className="text-right">{formatQuantity(coverage.remain)}</TableCell>
                          <TableCell className="text-right">
                            {isEditing ? (
                              <Input
                                type="number"
                                value={editUnitPrice}
                                onChange={(e) => setEditUnitPrice(e.target.value)}
                                className="w-28 text-right"
                                min="0"
                                step="0.01"
                              />
                            ) : (
                              formatCurrency(detail.unit_price || 0)
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {isEditing ? (
                              formatCurrency(parseFloat(editQuantity || '0') * parseFloat(editUnitPrice || '0'))
                            ) : (
                              formatCurrency((detail.quantity || 0) * (detail.unit_price || 0))
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {isEditing ? (
                              <div className="flex gap-1 justify-end">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleSaveDetail(detail.order_detail_id)}
                                  disabled={updateDetailMutation.isPending}
                                >
                                  {updateDetailMutation.isPending ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Check className="h-4 w-4" />
                                  )}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={handleCancelDetailEdit}
                                  disabled={updateDetailMutation.isPending}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            ) : (
                              <div className="flex gap-1 justify-end">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleStartEditDetail(detail)}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleDeleteDetail(detail.order_detail_id, detail.product?.name || 'this product')}
                                  disabled={deleteDetailMutation.isPending}
                                >
                                  {deleteDetailMutation.isPending ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Trash className="h-4 w-4" />
                                  )}
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={6}>Total</TableCell>
                      <TableCell className="text-right">{formatCurrency(order.total_amount || 0)}</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              ) : (
                <div className="py-8 text-center">
                  <p className="text-muted-foreground">No products in this order</p>
                                </div>
              )}
            </CardContent>
          </Card>

          {/* Components Summary - Enhanced with critical shortfalls */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">Components Summary</CardTitle>
                  <CardDescription>Parts needed to fulfill this order</CardDescription>
                </div>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="gap-1"
                  onClick={() => setActiveTab('components')}
                >
                  View All
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Stock Coverage Progress */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Stock Availability</span>
                  <span className={cn(
                    "font-semibold",
                    totals.stockCoverage === 100 ? "text-green-600" : totals.stockCoverage >= 50 ? "text-amber-600" : "text-red-600"
                  )}>
                    {totals.stockCoverage}% ready
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div 
                    className={cn(
                      "h-full transition-all duration-500",
                      totals.stockCoverage === 100 ? "bg-green-500" : totals.stockCoverage >= 50 ? "bg-amber-500" : "bg-red-500"
                    )}
                    style={{ width: `${totals.stockCoverage}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{totals.componentsInStock} of {totals.totalComponents} components in stock</span>
                  {totals.totalShortfall > 0 && (
                    <span className="text-red-600 font-medium">{totals.totalShortfall} need ordering</span>
                  )}
                </div>
                {totals.componentsPendingDeliveries > 0 && (
                  <div className="flex items-center gap-1 pt-1 text-xs text-amber-600">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>
                      Waiting on deliveries for {totals.componentsPendingDeliveries === 1
                        ? '1 component'
                        : `${totals.componentsPendingDeliveries} components`}
                    </span>
                  </div>
                )}
              </div>
              
              {/* Purchasing Status - Only show if there are shortfalls */}
              {totals.totalShortfall > 0 && (
                <div className="flex flex-wrap gap-3 text-sm">
                  {totals.componentsOnOrder > 0 && (
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-blue-500" />
                      <span>{totals.componentsOnOrder} on order</span>
                    </div>
                  )}
                  {totals.componentsInDraftPO > 0 && (
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-amber-500" />
                      <span>{totals.componentsInDraftPO} in draft PO</span>
                    </div>
                  )}
                  {totals.componentsOnOrder === 0 && totals.componentsInDraftPO === 0 && (
                    <div className="flex items-center gap-1.5 text-red-600">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>No purchase orders created</span>
                    </div>
                  )}
                </div>
              )}
              
              {/* Critical Shortfalls Table */}
              {totals.criticalShortfalls.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="bg-destructive/10 px-3 py-2 border-b flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-destructive" />
                    <span className="text-sm font-medium text-destructive">Components Needing Attention</span>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr className="text-muted-foreground">
                        <th className="text-left py-2 px-3 font-medium">Component</th>
                        <th className="text-right py-2 px-3 font-medium">Need</th>
                        <th className="text-right py-2 px-3 font-medium">Have</th>
                        <th className="text-right py-2 px-3 font-medium text-red-600">Short</th>
                      </tr>
                    </thead>
                    <tbody>
                      {totals.criticalShortfalls.map((comp, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="py-2 px-3">
                            <div className="font-medium">{comp.code}</div>
                            {comp.description && (
                              <div className="text-xs text-muted-foreground truncate max-w-[180px]">
                                {comp.description}
                              </div>
                            )}
                          </td>
                          <td className="text-right py-2 px-3">{formatQuantity(comp.required)}</td>
                          <td className="text-right py-2 px-3">
                            {formatQuantity(comp.inStock)}
                            {comp.onOrder > 0 && (
                              <span className="text-blue-600 text-xs ml-1">(+{formatQuantity(comp.onOrder)} coming)</span>
                            )}
                          </td>
                          <td className="text-right py-2 px-3 text-red-600 font-medium">
                            {formatQuantity(comp.shortfall)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {totals.allShortfalls.length > 5 && (
                    <div className="px-3 py-2 bg-muted/30 text-xs text-center text-muted-foreground border-t">
                      + {totals.allShortfalls.length - 5} more components need ordering
                    </div>
                  )}
                </div>
              )}
              
              {/* All good message */}
              {totals.totalShortfall === 0 && totals.totalComponents > 0 && totals.componentsPendingDeliveries === 0 && (
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400 bg-green-500/10 rounded-lg p-3">
                  <CheckCircle className="w-5 h-5" />
                  <span className="font-medium">All components available in stock</span>
                </div>
              )}
              {totals.totalShortfall === 0 && totals.totalComponents > 0 && totals.componentsPendingDeliveries > 0 && (
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 bg-amber-500/10 rounded-lg p-3">
                  <AlertCircle className="w-5 h-5" />
                  <span className="font-medium">
                    All components will be available once pending deliveries arrive for {totals.componentsPendingDeliveries === 1
                      ? '1 component'
                      : `${totals.componentsPendingDeliveries} components`}.
                  </span>
                </div>
              )}
              
              {/* No components message */}
              {totals.totalComponents === 0 && (
                <div className="text-center py-4 text-muted-foreground">
                  <p>No bill of materials defined for products in this order</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Financial Summary */}
          <Card>
          <CardHeader>
              <CardTitle className="text-lg">Financial Summary</CardTitle>
          </CardHeader>
          <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium">{formatCurrency(order?.total_amount || 0)}</span>
              </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Tax (15%)</span>
                  <span className="font-medium">{formatCurrency((order?.total_amount || 0) * 0.15)}</span>
                </div>
                <div className="flex justify-between py-1 border-t">
                  <span className="font-medium">Total (incl. tax)</span>
                  <span className="font-bold">{formatCurrency((order?.total_amount || 0) * 1.15)}</span>
                </div>
              </div>
          </CardContent>
        </Card>
        </TabsContent>
        
        <TabsContent value="components" className="space-y-6">
          {/* Debug information card removed */}
          
          {!componentRequirements || componentRequirements.length === 0 ? (
            <Alert className="bg-muted">
              <Terminal className="h-4 w-4" />
              <AlertTitle>No components to display</AlertTitle>
              <AlertDescription>
                No products with bill of materials in this order.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {/* Calculate component totals and global requirements */}
              {(() => {
                // Initialize totals object
                const totals = {
                  totalComponents: 0,
                  totalShortfall: 0,
                  totalGlobalShortfall: 0,
                  multiOrderComponents: 0,
                  componentsInStock: 0,
                  componentsOnOrder: 0,
                  componentsInDraftPO: 0
                };
                
                // Calculate totals from all components
                componentRequirements?.forEach(prodReq => {
                  if (!prodReq?.components) return;

                  prodReq.components?.forEach(comp => {
                    totals.totalComponents++;

                    const metrics = computeComponentMetrics(comp, prodReq.product_id);
                    const onOrder = Number(comp?.quantity_on_order ?? comp?.on_order ?? 0);
                    const draftPO = Number(comp?.draft_po_quantity ?? 0);
                    
                    if (metrics.real > 0.0001) {
                      totals.totalShortfall++;
                    } else {
                      totals.componentsInStock++;
                    }
                    
                    if (onOrder > 0) totals.componentsOnOrder++;
                    if (draftPO > 0) totals.componentsInDraftPO++;

                    if ((comp?.global_real_shortfall ?? 0) > 0) {
                      totals.totalGlobalShortfall++;
                    }

                    if ((comp?.order_count ?? 0) > 1) {
                      totals.multiOrderComponents++;
                    }
                  });
                });
                
                // Calculate stock coverage percentage
                const stockCoverage = totals.totalComponents > 0 
                  ? Math.round((totals.componentsInStock / totals.totalComponents) * 100) 
                  : 100;
                
                return (
                  <>
                    <div className="flex justify-between items-center mb-3">
                      <h2 className="text-xl font-semibold tracking-tight">
                        Component Requirements
                      </h2>
                      <Button onClick={() => setOrderComponentsOpen(true)} size="sm">
                        <ShoppingCart className="mr-2 h-4 w-4" />
                        Order Components
                      </Button>
                    </div>
                    
                    {/* Component Status Summary Card */}
                    <Card className="shadow-sm border border-muted/40 mb-4">
                      <CardContent className="pt-4">
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                          {/* Stock Coverage */}
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <h3 className="font-medium text-sm">Stock Availability</h3>
                              <span className={cn(
                                "text-sm font-semibold",
                                stockCoverage === 100 ? "text-green-600" : stockCoverage >= 50 ? "text-amber-600" : "text-red-600"
                              )}>
                                {stockCoverage}% ready
                              </span>
                            </div>
                            <div className="h-2 bg-muted rounded-full overflow-hidden">
                              <div 
                                className={cn(
                                  "h-full transition-all duration-500",
                                  stockCoverage === 100 ? "bg-green-500" : stockCoverage >= 50 ? "bg-amber-500" : "bg-red-500"
                                )}
                                style={{ width: `${stockCoverage}%` }}
                              />
                            </div>
                            <div className="flex justify-between text-xs text-muted-foreground">
                              <span>{totals.componentsInStock} of {totals.totalComponents} in stock</span>
                              {totals.totalShortfall > 0 && (
                                <span className="text-red-600 font-medium">{totals.totalShortfall} short</span>
                              )}
                            </div>
                          </div>
                          
                          {/* Purchasing Status */}
                          <div className="space-y-2">
                            <h3 className="font-medium text-sm">Purchasing Status</h3>
                            <div className="space-y-1.5 text-sm">
                              {totals.componentsOnOrder > 0 && (
                                <div className="flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                                  <span>{totals.componentsOnOrder} components on order</span>
                                </div>
                              )}
                              {totals.componentsInDraftPO > 0 && (
                                <div className="flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                                  <span>{totals.componentsInDraftPO} in draft POs</span>
                                </div>
                              )}
                              {totals.totalShortfall > 0 && totals.componentsOnOrder === 0 && totals.componentsInDraftPO === 0 && (
                                <div className="flex items-center gap-2 text-red-600">
                                  <AlertCircle className="w-4 h-4" />
                                  <span>No orders placed yet</span>
                                </div>
                              )}
                              {totals.totalShortfall === 0 && (
                                <div className="flex items-center gap-2 text-green-600">
                                  <CheckCircle className="w-4 h-4" />
                                  <span>All components available</span>
                                </div>
                              )}
                            </div>
                          </div>
                          
                          {/* Settings */}
                          <div className="space-y-2">
                            <h3 className="font-medium text-sm">Display Options</h3>
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <Label htmlFor="toggle-fg-coverage-inline" className="text-sm cursor-pointer">
                                  Apply FG coverage
                                </Label>
                                <Switch
                                  id="toggle-fg-coverage-inline"
                                  checked={applyFgCoverage}
                                  onCheckedChange={setApplyFgCoverage}
                                />
                              </div>
                              <div className="flex items-center justify-between">
                                <Label htmlFor="toggle-global-context-inline" className="text-sm cursor-pointer">
                                  Show global context
                                </Label>
                                <Switch
                                  id="toggle-global-context-inline"
                                  checked={showGlobalContext}
                                  onCheckedChange={setShowGlobalContext}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                        
                      </CardContent>
                    </Card>
                    
                    {/* Product Details Card */}
                    <Card className="shadow-sm border border-muted/40 overflow-hidden">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">Product Components</CardTitle>
                        <CardDescription>
                          {componentRequirements.length} products with {totals.totalComponents || 0} component types
                          {showGlobalContext && totals.multiOrderComponents > 0 && (
                            <span className="ml-1">
                              • <span className="text-blue-600">{totals.multiOrderComponents}</span> shared across orders
                            </span>
                          )}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        {/* Display component requirements here */}
                        <div className="space-y-4">
                          {componentRequirements?.map((productReq: any, index: number) => {
                            const hasShortfall = productReq?.components?.some((component: any) => {
                              const metrics = computeComponentMetrics(component, productReq.product_id);
                              return metrics.real > 0.0001;
                            });
                            const productId = productReq.product_id || `product-${index}`;
                            // Default to expanded (true) unless explicitly collapsed
                            const isExpanded = expandedRows[productId] !== false;
                            const coverageSummary = coverageByProduct.get(productReq.product_id);

                            return (
                              <div key={productReq.order_detail_id || index} className="border rounded-lg overflow-hidden shadow-sm hover:shadow transition-all duration-200">
                                <div
                                  className={cn(
                                    "p-4 flex justify-between items-center cursor-pointer",
                                    hasShortfall ? 'bg-destructive/10' : 'bg-card'
                                  )}
                                  onClick={() => toggleRowExpansion(productId)}
                                >
                                  <div>
                                    <h4 className="font-medium flex items-center">
                                      {productReq.product_name || 'Unknown Product'} 
                                      {hasShortfall && (
                                        <Badge variant="destructive" className="ml-2">Shortfall</Badge>
                                      )}
                                    </h4>
                                    <p className="text-sm text-muted-foreground">
                                      Order quantity: {productReq.order_quantity || 0} × {productReq.components?.length || 0} component types
                                    </p>
                                    {coverageSummary && (
                                      <p className="text-xs text-muted-foreground mt-1">
                                        Reserved FG: {formatQuantity(coverageSummary.reserved)} of {formatQuantity(coverageSummary.ordered)} — Remaining: {formatQuantity(coverageSummary.remain)}
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex items-center">
                                    <Button variant="ghost" size="sm" className="ml-2">
                                      {isExpanded ? (
                                        <ChevronDown className="h-4 w-4" />
                                      ) : (
                                        <ChevronRight className="h-4 w-4" />
                                      )}
                                    </Button>
                                  </div>
                                </div>
                                
                                {/* Expanded view with component details */}
                                {isExpanded && productReq.components && productReq.components.length > 0 && (
                                  <div className="bg-muted/30 p-4 border-t animate-in fade-in duration-300">
                                    <div className="overflow-x-auto">
                                      <Table>
                                        <TableHeader className="bg-muted/50">
                                          <TableRow>
                                            <TableHead>Component</TableHead>
                                            <TableHead className="text-right">Required</TableHead>
                                            {showGlobalContext && (
                                              <TableHead className="text-right whitespace-nowrap">
                                                Total Across Orders
                                                <span className="sr-only">(Total required across all orders)</span>
                                              </TableHead>
                                            )}
                                            <TableHead className="text-right">In Stock</TableHead>
                                            <TableHead className="text-right">On Order</TableHead>
                                            <TableHead className="text-right">Draft PO</TableHead>
                                            <TableHead className="text-right">Apparent Shortfall</TableHead>
                                            <TableHead className="text-right">Real Shortfall</TableHead>
                                            {showGlobalContext && (
                                              <TableHead className="text-right whitespace-nowrap">
                                                Global Shortfall
                                                <span className="sr-only">(Total shortfall across all orders)</span>
                                              </TableHead>
                                            )}
                                          </TableRow>
                                        </TableHeader>
                                                                                                                        <TableBody>
                                          {productReq.components?.map((component: any, compIndex: number) => {
                                            const metrics = computeComponentMetrics(component, productReq.product_id);
                                            const globalRequired = Number(component.total_required_all_orders ?? 0);
                                            const globalShortfall = Number(component.global_real_shortfall ?? 0);
                                            const globalApparent = Number(component.global_apparent_shortfall ?? 0);

                                            return (
                                              <TableRow
                                                key={component.component_id || `comp-${compIndex}`}
                                                className={cn(
                                                  compIndex % 2 === 0 ? "bg-card" : "bg-muted/20",
                                                  "hover:bg-muted/30 transition-all duration-200 ease-in-out"
                                                )}
                                              >
                                                <TableCell>
                                                  <div className="font-medium">{component.internal_code || 'Unknown'}</div>
                                                  <div className="text-sm text-muted-foreground">{component.description || 'No description'}</div>
                                                </TableCell>
                                                <TableCell className="text-right font-medium">{formatQuantity(metrics.required)}</TableCell>
                                                {showGlobalContext && (
                                                  <TableCell className="text-right">
                                                    <Popover>
                                                      <PopoverTrigger>
                                                        <div className="cursor-help inline-flex items-center">
                                                          <span className={cn(
                                                            globalRequired > metrics.required ? "text-blue-600" : "",
                                                            "font-medium"
                                                          )}>
                                                            {formatQuantity(globalRequired)}
                                                          </span>
                                                          {(component.order_count ?? 0) > 1 && (
                                                            <Info className="h-4 w-4 ml-1 text-blue-500 hover:text-blue-600" />
                                                          )}
                                                        </div>
                                                      </PopoverTrigger>
                                                      <PopoverContent className="p-0">
                                                        <div className="p-3 max-w-sm bg-card rounded-md shadow-sm">
                                                          <p className="text-sm font-medium mb-2">Required across {component.order_count || 1} orders:</p>
                                                          <div className="space-y-1 text-sm">
                                                            {(component.order_breakdown || [])?.map((order: any) => (
                                                              <div key={order.order_id} className="flex justify-between">
                                                                <span>Order #{order.order_id}:</span>
                                                                <span>{order.quantity} units</span>
                                                              </div>
                                                            ))}
                                                          </div>
                                                        </div>
                                                      </PopoverContent>
                                                    </Popover>
                                                  </TableCell>
                                                )}
                                                <TableCell className="text-right font-medium">{formatQuantity(metrics.inStock)}</TableCell>
                                                <TableCell className="text-right font-medium">{formatQuantity(metrics.onOrder)}</TableCell>
                                                <TableCell className="text-right">
                                                  {(component.draft_po_quantity ?? 0) > 0 ? (
                                                    <Popover>
                                                      <PopoverTrigger>
                                                        <div className="cursor-help inline-flex items-center">
                                                          <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30">
                                                            {formatQuantity(component.draft_po_quantity)}
                                                          </span>
                                                        </div>
                                                      </PopoverTrigger>
                                                      <PopoverContent className="p-0">
                                                        <div className="p-3 max-w-sm bg-card rounded-md shadow-sm">
                                                          <p className="text-sm font-medium mb-2">Draft Purchase Orders:</p>
                                                          <div className="space-y-1 text-sm">
                                                            {(component.draft_po_breakdown || [])?.map((draft: any, idx: number) => (
                                                              <div key={draft.supplier_order_id || idx} className="flex justify-between">
                                                                <span>{draft.supplier_name}:</span>
                                                                <span>{draft.quantity} units</span>
                                                              </div>
                                                            ))}
                                                          </div>
                                                          <p className="text-xs text-muted-foreground mt-2">Awaiting confirmation/send to supplier</p>
                                                        </div>
                                                      </PopoverContent>
                                                    </Popover>
                                                  ) : (
                                                    <span className="text-muted-foreground">—</span>
                                                  )}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                  {metrics.apparent > 0 && metrics.real === 0 ? (
                                                    <Popover>
                                                      <PopoverTrigger>
                                                        <div className="cursor-help inline-flex items-center">
                                                          <span className="text-green-600 font-medium">{formatQuantity(metrics.apparent)}</span>
                                                          <Info className="h-4 w-4 ml-1 text-blue-500 hover:text-blue-600" />
                                                        </div>
                                                      </PopoverTrigger>
                                                      <PopoverContent className="p-0">
                                                        <div className="p-3 max-w-sm bg-card rounded-md shadow-sm">
                                                          <p className="text-sm">This apparent shortfall is covered by existing supplier orders.</p>
                                                        </div>
                                                      </PopoverContent>
                                                    </Popover>
                                                  ) : (
                                                    <span className={cn(
                                                      metrics.apparent > 0 ? "text-orange-600" : "text-green-600",
                                                      "font-medium"
                                                    )}>
                                                      {formatQuantity(metrics.apparent)}
                                                    </span>
                                                  )}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                  <span className={cn(
                                                    metrics.real > 0 ? "text-red-600" : "text-green-600",
                                                    "font-medium"
                                                  )}>
                                                    {formatQuantity(metrics.real)}
                                                  </span>
                                                </TableCell>
                                                {showGlobalContext && (
                                                  <TableCell className="text-right">
                                                    <span className={cn(
                                                      globalShortfall > 0
                                                        ? "text-red-600"
                                                        : globalApparent > 0
                                                          ? "text-amber-600"
                                                          : "text-green-600",
                                                      "font-medium"
                                                    )}>
                                                      {formatQuantity(globalShortfall)}
                                                    </span>
                                                    {globalApparent > 0 && globalShortfall === 0 && (
                                                      <span className="text-xs text-muted-foreground ml-1">(Covered)</span>
                                                    )}
                                                  </TableCell>
                                                )}
                                              </TableRow>
                                            );
                                          })}
                                        </TableBody>
                                      </Table>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>
                    <OrderComponentsDialog 
                      orderId={orderId.toString()} 
                      open={orderComponentsOpen} 
                      onOpenChange={setOrderComponentsOpen} 
                      onCreated={() => refetchComponentRequirements()}
                    />
                  </>
                );
              })()}
            </>
          )}
        </TabsContent>
        
        <TabsContent value="issue-stock" className="space-y-4">
          <IssueStockTab orderId={orderId} order={order} componentRequirements={componentRequirements} />
        </TabsContent>
        
        <TabsContent value="documents" className="space-y-4">
          <OrderDocumentsTab orderId={orderId} />
        </TabsContent>

        <TabsContent value="procurement" className="space-y-4">
          <ProcurementTab orderId={orderId} />
        </TabsContent>

        <TabsContent value="job-cards" className="space-y-4">
          <JobCardsTab orderId={orderId} />
        </TabsContent>
      </Tabs>

      {/* Delete Product Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Product from Order</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove "{productToDelete?.name}" from this order?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={cancelDeleteProduct}
              disabled={deleteDetailMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDeleteProduct}
              disabled={deleteDetailMutation.isPending}
            >
              {deleteDetailMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Removing...
                </>
              ) : (
                'Remove Product'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
} 
