'use client';

import { useState, useMemo, useEffect, useCallback, useRef, use } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { type Product, type OrderDetail, type Customer, type FinishedGoodReservation } from '@/types/orders';
import { type ProductRequirement } from '@/types/components';
import { fetchCustomers } from '@/lib/db/customers';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { toast } from 'sonner';
import { Package, Loader2, AlertCircle, ShoppingCart, ChevronDown, CheckCircle, ChevronRight, RotateCcw, Layers, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { Table, TableHeader, TableBody, TableCell, TableHead, TableRow, TableFooter } from '@/components/ui/table';
import { useRouter, useSearchParams } from 'next/navigation';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { IssueStockTab } from '@/components/features/orders/IssueStockTab';
import { OrderDocumentsTab } from '@/components/features/orders/OrderDocumentsTab';
import { ProcurementTab } from '@/components/features/orders/ProcurementTab';
import { JobCardsTab } from '@/components/features/orders/JobCardsTab';

// Extracted modules
import { formatCurrency, formatQuantity } from '@/lib/format-utils';
import {
  fetchOrderDetails,
  fetchOrderAttachments,
  fetchFinishedGoodReservations,
  reserveFinishedGoods,
  releaseFinishedGoods,
  consumeFinishedGoods,
  fetchOrderStatuses,
  updateOrderStatus,
  deleteAttachment,
} from '@/lib/queries/order-queries';
import { fetchOrderComponentRequirements, reserveOrderComponents, releaseOrderComponents } from '@/lib/queries/order-components';
import { OrderComponentsDialog } from '@/components/features/orders/OrderComponentsDialog';
import { AddProductsDialog } from '@/components/features/orders/AddProductsDialog';

// New single-scroll layout components
import { OrderHeaderStripe } from '@/components/features/orders/OrderHeaderStripe';
import { SmartButtonsRow } from '@/components/features/orders/SmartButtonsRow';
import { ProductsTableRow } from '@/components/features/orders/ProductsTableRow';
import { OrderSlideOutPanel } from '@/components/features/orders/OrderSlideOutPanel';
import { OrderSidebar } from '@/components/features/orders/OrderSidebar';

type OrderDetailPageProps = {
  params: Promise<{
    orderId: string;
  }>;
};

// ── Main Page Component ─────────────────────────────────────────────────────
// All data-fetching functions, types, and sub-dialogs have been extracted to:
//   - lib/queries/order-queries.ts
//   - lib/queries/order-components.ts
//   - components/features/orders/OrderComponentsDialog.tsx
//   - components/features/orders/AddProductsDialog.tsx
//   - components/features/orders/StatusBadge.tsx
//   - lib/format-utils.ts
// ─────────────────────────────────────────────────────────────────────────────


// Update the component requirements table to use the new tooltips
export default function OrderDetailPage({ params }: OrderDetailPageProps) {
  // Unwrap the params Promise (Next.js 16 requirement)
  const { orderId: orderIdParam } = use(params);
  const orderId = parseInt(orderIdParam, 10);
  const [searchQuery, setSearchQuery] = useState('');
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams?.get('tab') || 'products';
  const handleTabChange = useCallback((tabId: string) => {
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('tab', tabId);
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);
  const [orderComponentsOpen, setOrderComponentsOpen] = useState<boolean>(false);
  const [statusOptions, setStatusOptions] = useState<any[]>([]);
  // Add state for expanded rows
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [applyFgCoverage, setApplyFgCoverage] = useState<boolean>(true);
  const [showGlobalContext, setShowGlobalContext] = useState<boolean>(true);
  const [fgReservationsOpen, setFgReservationsOpen] = useState<boolean>(false);

  // Section refs
  const productsRef = useRef<HTMLDivElement>(null);
  const componentsRef = useRef<HTMLDivElement>(null);

  // Slide-out panel state
  const [slideOutProduct, setSlideOutProduct] = useState<any>(null);

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
    const reservedByOthers = Number(component?.reserved_by_others ?? 0);
    const reservedThisOrder = Number(component?.reserved_this_order ?? 0);
    const coverage = coverageByProduct.get(productId);
    const factor = applyFgCoverage ? (coverage?.factor ?? 1) : 1;
    const required = baseRequired * factor;
    const available = Math.max(0, inStock - reservedByOthers);
    const apparent = Math.max(0, required - available);
    const real = Math.max(0, required - available - onOrder);

    return {
      required,
      inStock,
      onOrder,
      available,
      reservedByOthers,
      reservedThisOrder,
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

  const reserveComponentsMutation = useMutation({
    mutationFn: () => reserveOrderComponents(orderId),
    onSuccess: async () => {
      toast.success('Components reserved');
      await Promise.all([refetchComponentRequirements(), refetchComponentReservations()]);
    },
    onError: (error: any) => {
      console.error('[reserve-components] mutation error', error);
      toast.error('Failed to reserve components');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['orderComponentRequirements', orderId] });
      queryClient.invalidateQueries({ queryKey: ['componentReservations', orderId] });
    },
  });

  const releaseComponentsMutation = useMutation({
    mutationFn: () => releaseOrderComponents(orderId),
    onSuccess: async () => {
      toast.success('Component reservations released');
      await Promise.all([refetchComponentRequirements(), refetchComponentReservations()]);
    },
    onError: (error: any) => {
      console.error('[release-components] mutation error', error);
      toast.error('Failed to release component reservations');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['orderComponentRequirements', orderId] });
      queryClient.invalidateQueries({ queryKey: ['componentReservations', orderId] });
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

  // Query actual reservation rows — not BOM-derived — so stale reservations
  // (e.g. after BOM changes) are still visible and releasable.
  const { data: componentReservationRows = [], refetch: refetchComponentReservations } = useQuery({
    queryKey: ['componentReservations', orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('component_reservations')
        .select('id, component_id, qty_reserved')
        .eq('order_id', orderId);
      if (error) throw error;
      return data ?? [];
    },
  });

  const hasComponentReservations = componentReservationRows.length > 0;
  const componentReservationCount = componentReservationRows.length;

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

  // Flat deduplicated component list for the Components tab
  const flatComponents = useMemo(() => {
    const map = new Map<number, {
      component_id: number;
      internal_code: string;
      description: string;
      totalRequired: number;
      inStock: number;
      onOrder: number;
      reservedThisOrder: number;
      reservedByOthers: number;
      available: number;
      apparent: number;
      real: number;
    }>();

    componentRequirements.forEach((productReq: ProductRequirement) => {
      (productReq.components ?? []).forEach((component: any) => {
        const metrics = computeComponentMetrics(component, productReq.product_id);
        const id = component.component_id;
        if (!id) return;

        const existing = map.get(id);
        if (existing) {
          existing.totalRequired += metrics.required;
          existing.apparent = Math.max(0, existing.totalRequired - existing.available);
          existing.real = Math.max(0, existing.totalRequired - existing.available - existing.onOrder);
        } else {
          map.set(id, {
            component_id: id,
            internal_code: component.internal_code || 'Unknown',
            description: component.description || '',
            totalRequired: metrics.required,
            inStock: metrics.inStock,
            onOrder: metrics.onOrder,
            reservedThisOrder: metrics.reservedThisOrder,
            reservedByOthers: metrics.reservedByOthers,
            available: metrics.available,
            apparent: metrics.apparent,
            real: metrics.real,
          });
        }
      });
    });

    return Array.from(map.values()).sort((a, b) => {
      if (b.real !== a.real) return b.real - a.real;
      return a.internal_code.localeCompare(b.internal_code);
    });
  }, [componentRequirements, computeComponentMetrics]);

  // Filter order details by search query
  const filterOrderDetails = (details: any[]) => {
    if (!details) return [];
    if (!searchQuery) return details;
    const query = searchQuery.toLowerCase();
    return details.filter(detail =>
      detail.product?.name?.toLowerCase().includes(query) ||
      detail.product?.description?.toLowerCase().includes(query) ||
      detail.order_detail_id.toString().includes(query)
    );
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
    <div className="space-y-5 bg-muted/30 -mx-4 md:-mx-6 px-4 md:px-6 min-h-screen">
      {/* Sticky header: stripe + tab bar */}
      <div className="sticky top-0 z-10 -mx-4 md:-mx-6 px-4 md:px-6 pb-0 pt-2 space-y-3 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b shadow-sm">
        <OrderHeaderStripe
          orderId={orderId}
          order={order}
          customers={customersSorted}
          customersLoading={customersLoading}
          editCustomerId={editCustomerId}
          editOrderNumber={editOrderNumber}
          editDeliveryDate={editDeliveryDate}
          statusOptions={statusOptions}
          updateOrderMutation={updateOrderMutation}
          updateStatusMutation={updateStatusMutation}
          onCustomerChange={handleCustomerChange}
          onOrderNumberChange={setEditOrderNumber}
          onOrderNumberBlur={handleOrderNumberBlur}
          onDeliveryDateChange={handleDeliveryDateChange}
        />

        <SmartButtonsRow
          productCount={order?.details?.length || 0}
          componentShortfallCount={totals.totalShortfall}
          jobCardCount={0}
          poCount={0}
          documentCount={attachments?.length || 0}
          issuedCount={0}
          onTabChange={handleTabChange}
          activeTab={activeTab}
        />
      </div>
        
      {/* ── Tab Content ── */}
      {activeTab === 'products' && (
        <div ref={productsRef} className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5">
          {/* Left column */}
          <div className="space-y-5">
          {/* Products Table */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">Products ({order?.details?.length || 0})</h2>
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

            <Card className="shadow-sm">
              <CardContent className="p-0">
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
                        const productBom = componentRequirements
                          .find((pr: any) => pr.product_id === detail.product_id)
                          ?.components ?? [];
                        const productId = detail.product_id?.toString() || detail.order_detail_id?.toString();
                        const isExpanded = expandedRows[productId] === true;

                        return (
                          <ProductsTableRow
                            key={detail.order_detail_id}
                            detail={detail}
                            coverage={coverage}
                            isEditing={isEditing}
                            editQuantity={editQuantity}
                            editUnitPrice={editUnitPrice}
                            isExpanded={isExpanded}
                            bomComponents={productBom}
                            computeComponentMetrics={computeComponentMetrics}
                            showGlobalContext={showGlobalContext}
                            onToggleExpand={() => toggleRowExpansion(productId)}
                            onStartEdit={() => handleStartEditDetail(detail)}
                            onSaveEdit={() => handleSaveDetail(detail.order_detail_id)}
                            onCancelEdit={handleCancelDetailEdit}
                            onDelete={() => handleDeleteDetail(detail.order_detail_id, detail.product?.name || 'this product')}
                            onQuantityChange={setEditQuantity}
                            onUnitPriceChange={setEditUnitPrice}
                            updatePending={updateDetailMutation.isPending}
                            deletePending={deleteDetailMutation.isPending}
                            onProductClick={() => setSlideOutProduct(detail)}
                          />
                        );
                      })}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={5}>Total</TableCell>
                        <TableCell className="text-right">{formatCurrency(order.total_amount || 0)}</TableCell>
                        <TableCell />
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
          </div>

          {/* Stock Reservations */}
          <Collapsible open={fgReservationsOpen} onOpenChange={setFgReservationsOpen}>
            <Card className="shadow-sm border-l-3 border-l-primary/40">
              <CollapsibleTrigger asChild>
                <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between cursor-pointer hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-2">
                    {fgReservationsOpen ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <div>
                      <CardTitle className="text-lg">Stock Reservations</CardTitle>
                      <CardDescription>
                        Reserve pre-built products from stock to reduce the components needed.
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

          {/* Component Reservations */}
          <Card className="shadow-sm border-l-3 border-l-orange-500/40">
            <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between py-3">
              <div>
                <CardTitle className="text-lg">Component Reservations</CardTitle>
                <CardDescription>
                  {hasComponentReservations
                    ? `${componentReservationCount} component(s) reserved for this order`
                    : 'Earmark raw materials/components so other orders can\u2019t claim them'}
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => reserveComponentsMutation.mutate()}
                  disabled={reserveComponentsMutation.isPending || orderLoading}
                  size="sm"
                  title="Reserve available components from inventory for this order"
                >
                  {reserveComponentsMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Layers className="mr-2 h-4 w-4" />
                  )}
                  Reserve Components
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => releaseComponentsMutation.mutate()}
                  disabled={!hasComponentReservations || releaseComponentsMutation.isPending}
                  title="Release component reservations back to available stock"
                >
                  {releaseComponentsMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="mr-2 h-4 w-4" />
                  )}
                  Release
                </Button>
              </div>
            </CardHeader>
          </Card>

          {/* Financial Summary */}
          <Card className="shadow-sm">
            <CardContent className="py-4">
              <div className="flex items-center justify-between gap-6 text-sm">
                <div className="flex items-center gap-4">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium">{formatCurrency(order?.total_amount || 0)}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-muted-foreground">Tax (15%)</span>
                  <span className="font-medium">{formatCurrency((order?.total_amount || 0) * 0.15)}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-medium">Total</span>
                  <span className="font-bold text-base">{formatCurrency((order?.total_amount || 0) * 1.15)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
          </div>
          {/* Right sidebar */}
          <OrderSidebar orderId={orderId} onTabChange={handleTabChange} />
        </div>
      )}

      {activeTab === 'components' && (
        <div ref={componentsRef} className="space-y-5">
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      Components Summary
                      {totals.totalComponents > 0 && (
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-xs font-medium',
                            totals.totalShortfall > 0
                              ? 'border-red-600 text-red-600 bg-red-500/10'
                              : totals.componentsPendingDeliveries > 0
                                ? 'border-amber-600 text-amber-600 bg-amber-500/10'
                                : 'border-green-600 text-green-600 bg-green-500/10'
                          )}
                        >
                          {totals.totalShortfall > 0
                            ? 'Shortfall'
                            : totals.componentsPendingDeliveries > 0
                              ? 'Partial'
                              : 'Ready'}
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription>Parts needed to fulfill this order</CardDescription>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => setOrderComponentsOpen(true)}
                >
                  Order Components
                  <ShoppingCart className="h-4 w-4" />
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
                  <span>{totals.componentsInStock} in stock</span>
                  {totals.componentsPendingDeliveries > 0 && (
                    <span className="text-amber-600">{totals.componentsPendingDeliveries} on order</span>
                  )}
                  {totals.totalShortfall > 0 && (
                    <span className="text-red-600 font-medium">{totals.totalShortfall} short</span>
                  )}
                </div>
              </div>

              {/* Full Component Table */}
              {flatComponents.length > 0 ? (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr className="text-muted-foreground">
                        <th className="text-left py-2 px-3 font-medium">Component</th>
                        <th className="text-right py-2 px-3 font-medium">Required</th>
                        <th className="text-right py-2 px-3 font-medium">In Stock</th>
                        <th className="text-right py-2 px-3 font-medium">Reserved</th>
                        <th className="text-right py-2 px-3 font-medium">Available</th>
                        <th className="text-right py-2 px-3 font-medium">On Order</th>
                        <th className="text-right py-2 px-3 font-medium">Shortfall</th>
                      </tr>
                    </thead>
                    <tbody>
                      {flatComponents.map((comp) => (
                        <tr
                          key={comp.component_id}
                          className={cn(
                            'border-t transition-colors',
                            comp.real > 0
                              ? 'bg-red-500/5 hover:bg-red-500/10'
                              : comp.apparent > 0
                                ? 'bg-amber-500/5 hover:bg-amber-500/10'
                                : 'hover:bg-muted/50'
                          )}
                        >
                          <td className="py-2 px-3">
                            <Link
                              href={`/inventory/components/${comp.component_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-baseline gap-2 hover:underline group"
                            >
                              <span className="font-medium">{comp.internal_code}</span>
                              <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                                {comp.description}
                              </span>
                              <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                            </Link>
                          </td>
                          <td className="text-right py-2 px-3 font-medium tabular-nums">
                            {formatQuantity(comp.totalRequired)}
                          </td>
                          <td className="text-right py-2 px-3 tabular-nums">
                            {formatQuantity(comp.inStock)}
                          </td>
                          <td className={cn(
                            'text-right py-2 px-3 tabular-nums',
                            comp.reservedThisOrder > 0 ? 'text-blue-500 font-medium' : 'text-muted-foreground'
                          )}>
                            {formatQuantity(comp.reservedThisOrder)}
                          </td>
                          <td className={cn(
                            'text-right py-2 px-3 tabular-nums',
                            comp.available < comp.totalRequired ? 'text-orange-500 font-medium' : ''
                          )}>
                            {formatQuantity(comp.available)}
                          </td>
                          <td className="text-right py-2 px-3 tabular-nums">
                            {formatQuantity(comp.onOrder)}
                          </td>
                          <td className={cn(
                            'text-right py-2 px-3 font-medium tabular-nums',
                            comp.real > 0 ? 'text-red-600' : 'text-green-600'
                          )}>
                            {formatQuantity(comp.real)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : totals.totalComponents === 0 ? (
                <div className="text-center py-4 text-muted-foreground">
                  <p>No bill of materials defined for products in this order</p>
                </div>
              ) : null}

              {/* All good / partial messages */}
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
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'job-cards' && (
        <JobCardsTab orderId={orderId} />
      )}

      {activeTab === 'procurement' && (
        <ProcurementTab orderId={orderId} />
      )}

      {activeTab === 'documents' && (
        <OrderDocumentsTab orderId={orderId} />
      )}

      {activeTab === 'issue-stock' && (
        <IssueStockTab orderId={orderId} order={order} componentRequirements={componentRequirements} />
      )}

      {/* ── Slide-out Panel ── */}
      <OrderSlideOutPanel
        open={!!slideOutProduct}
        onOpenChange={(open) => !open && setSlideOutProduct(null)}
        selectedProduct={slideOutProduct}
        bomComponents={
          slideOutProduct
            ? componentRequirements.find((pr: any) => pr.product_id === slideOutProduct.product_id)?.components ?? []
            : []
        }
        coverage={slideOutProduct ? coverageByProduct.get(slideOutProduct.product_id) ?? null : null}
        computeComponentMetrics={computeComponentMetrics}
        showGlobalContext={showGlobalContext}
      />

      {/* ── Order Components Dialog ── */}
      <OrderComponentsDialog
        orderId={orderId.toString()}
        open={orderComponentsOpen}
        onOpenChange={setOrderComponentsOpen}
        onCreated={() => refetchComponentRequirements()}
      />

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
