'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Resolver } from 'react-hook-form';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Loader2,
  Plus,
  Trash2,
  AlertCircle,
  StickyNote,
  Search,
  Package,
  X,
} from 'lucide-react';
import { PurchaseOrderFormData } from '@/types/purchasing';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import ReactSelect from 'react-select';
import { toast } from 'sonner';
import {
  ConsolidatePODialog,
  SupplierWithDrafts,
} from '@/components/features/purchasing/ConsolidatePODialog';
import {
  ComponentSearchModal,
  ComponentSelection,
  ModalSupplierComponent,
} from '@/components/features/purchasing/ComponentSearchModal';

// Form validation schema
const formSchema = z.object({
  order_date: z.string().optional(),
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        component_id: z.number({
          required_error: 'Please select a component',
        }),
        supplier_component_id: z.number({
          required_error: 'Please select a supplier',
        }),
        quantity: z
          .number({
            required_error: 'Please enter a quantity',
            invalid_type_error: 'Please enter a number',
          })
          .min(0.01, 'Quantity must be greater than 0'),
        customer_order_id: z.number().nullable().optional(),
        notes: z.string().optional(),
      })
    )
    .min(1, 'Please add at least one item to the order'),
});

type SupplierComponentFromAPI = {
  supplier_component_id: number;
  component_id: number;
  supplier_id: number;
  price: number;
  supplier: {
    name: string;
  };
};

type SupplierOrderLinePayload = {
  supplier_component_id: number;
  order_quantity: number;
  component_id: number;
  quantity_for_order: number;
  quantity_for_stock: number;
  customer_order_id?: number | null;
  line_notes?: string | null;
};

type PurchaseOrderCreationResult = {
  purchase_order_id: number;
  supplier_order_ids: number[] | null;
};

// Selected component info (stored alongside form data for display)
type SelectedComponentInfo = {
  internal_code: string;
  description: string | null;
  category_name: string | null;
  stock_on_hand: number | null;
  suppliers: ModalSupplierComponent[];
};

// Fetch supplier components for a specific component
async function fetchSupplierComponentsForComponent(
  componentId: number
): Promise<SupplierComponentFromAPI[]> {
  if (!componentId || isNaN(componentId) || componentId <= 0) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('suppliercomponents')
      .select(
        `
        supplier_component_id,
        component_id,
        supplier_id,
        price,
        supplier:suppliers (name)
      `
      )
      .eq('component_id', componentId);

    if (error) {
      console.error('Error fetching supplier components:', error);
      return [];
    }

    if (!data || !Array.isArray(data)) {
      return [];
    }

    return data.map((item) => {
      const rawItem = item as unknown as {
        supplier_component_id: number;
        component_id: number;
        supplier_id: number;
        price: number;
        supplier: { name: string } | null;
      };

      return {
        supplier_component_id: rawItem.supplier_component_id,
        component_id: rawItem.component_id,
        supplier_id: rawItem.supplier_id,
        price: rawItem.price,
        supplier: {
          name: rawItem.supplier?.name || 'Unknown Supplier',
        },
      };
    });
  } catch (error) {
    console.error('Exception when fetching supplier components:', error);
    return [];
  }
}

// Fetch Draft status ID
async function fetchDraftStatusId() {
  const { data, error } = await supabase
    .from('supplier_order_statuses')
    .select('status_id')
    .eq('status_name', 'Draft')
    .single();

  if (error) {
    console.error('Error fetching Draft status:', error);
    throw new Error('Failed to fetch Draft status');
  }

  return data.status_id;
}

// Create purchase order
async function createPurchaseOrder(
  formData: PurchaseOrderFormData,
  statusId: number,
  supplierComponentsCache: Map<number, SupplierComponentFromAPI[]> = new Map()
): Promise<PurchaseOrderCreationResult[]> {
  const itemsBySupplier = new Map<
    number,
    Array<{
      supplier_component_id: number;
      quantity: number;
      component_id: number;
      customer_order_id?: number | null;
      notes?: string;
    }>
  >();

  formData.items.forEach((item) => {
    const supplierOptions =
      supplierComponentsCache.get(item.component_id) || [];
    const supplierComponent = supplierOptions.find(
      (candidate) =>
        candidate.supplier_component_id === item.supplier_component_id
    );

    if (!supplierComponent) {
      throw new Error(
        `Missing supplier data for component ${item.component_id}. Refresh suppliers and try again.`
      );
    }

    if (!supplierComponent.supplier_id) {
      throw new Error(
        `Supplier selection is missing its supplier reference for component ${item.component_id}.`
      );
    }

    if (!itemsBySupplier.has(supplierComponent.supplier_id)) {
      itemsBySupplier.set(supplierComponent.supplier_id, []);
    }

    itemsBySupplier.get(supplierComponent.supplier_id)?.push({
      supplier_component_id: item.supplier_component_id,
      quantity: item.quantity,
      component_id: item.component_id,
      customer_order_id: item.customer_order_id,
      notes: item.notes,
    });
  });

  const orderDateISO = formData.order_date
    ? new Date(formData.order_date).toISOString()
    : new Date().toISOString();

  const purchaseOrders = await Promise.all(
    Array.from(itemsBySupplier.entries()).map(async ([supplierId, items]) => {
      const lineItems: SupplierOrderLinePayload[] = items.map((item) => ({
        supplier_component_id: item.supplier_component_id,
        order_quantity: item.quantity,
        component_id: item.component_id,
        quantity_for_order: item.customer_order_id ? item.quantity : 0,
        quantity_for_stock: item.customer_order_id ? 0 : item.quantity,
        customer_order_id: item.customer_order_id || null,
        line_notes: item.notes || null,
      }));

      const { data, error: rpcError } = await supabase.rpc(
        'create_purchase_order_with_lines',
        {
          supplier_id: supplierId,
          line_items: lineItems,
          status_id: statusId,
          order_date: orderDateISO,
          notes: formData.notes ?? '',
        }
      );

      if (rpcError) {
        console.error('Error creating purchase order via RPC:', rpcError);
        throw new Error('Failed to create purchase order');
      }

      const rpcResult = Array.isArray(data) ? data?.[0] : data;

      if (!rpcResult || typeof rpcResult.purchase_order_id !== 'number') {
        console.error(
          'Unexpected RPC response when creating purchase order:',
          data
        );
        throw new Error('Failed to create purchase order');
      }

      return {
        purchase_order_id: rpcResult.purchase_order_id,
        supplier_order_ids: rpcResult.supplier_order_ids ?? [],
      } satisfies PurchaseOrderCreationResult;
    })
  );

  return purchaseOrders;
}

const PO_DRAFT_STORAGE_KEY = 'unity-erp:po-draft';

export function NewPurchaseOrderForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [consolidateDialogOpen, setConsolidateDialogOpen] = useState(false);
  const [suppliersWithDrafts, setSuppliersWithDrafts] = useState<
    SupplierWithDrafts[]
  >([]);
  const [pendingFormData, setPendingFormData] =
    useState<PurchaseOrderFormData | null>(null);
  const [isCheckingDrafts, setIsCheckingDrafts] = useState(false);
  const [expandedNotes, setExpandedNotes] = useState<Set<number>>(new Set());

  // Component search modal state
  const [componentModalOpen, setComponentModalOpen] = useState(false);
  const [componentModalTargetIndex, setComponentModalTargetIndex] = useState<
    number | null
  >(null);

  // Rich component info for display (keyed by item index position doesn't work with reordering — key by component_id)
  const [selectedComponentInfoMap, setSelectedComponentInfoMap] = useState<
    Map<number, SelectedComponentInfo>
  >(new Map());

  // Form setup
  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<PurchaseOrderFormData>({
    resolver: zodResolver(formSchema) as Resolver<PurchaseOrderFormData>,
    defaultValues: {
      order_date: new Date().toISOString().split('T')[0],
      notes: '',
      items: [
        {
          component_id: 0,
          supplier_component_id: 0,
          quantity: undefined as unknown as number,
          customer_order_id: null,
          notes: '',
        },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'items',
  });

  // Restore saved draft from sessionStorage on mount
  const draftRestored = useRef(false);
  useEffect(() => {
    if (draftRestored.current) return;
    draftRestored.current = true;
    try {
      const saved = sessionStorage.getItem(PO_DRAFT_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as PurchaseOrderFormData;
        const hasContent =
          parsed.items?.some((item) => item.component_id > 0) ||
          (parsed.notes && parsed.notes.trim().length > 0);
        if (hasContent) {
          reset(parsed);
          toast.info('Draft purchase order restored');

          // Re-hydrate component info for restored items
          const componentIds = parsed.items
            .map((item) => item.component_id)
            .filter((id) => id > 0);
          if (componentIds.length > 0) {
            supabase
              .from('components')
              .select(
                `component_id, internal_code, description,
                 category:component_categories(categoryname),
                 inventory(quantity_on_hand),
                 suppliercomponents(
                   supplier_component_id, supplier_id, price, lead_time, min_order_quantity,
                   supplier:suppliers(name, supplier_id)
                 )`
              )
              .in('component_id', componentIds)
              .then(({ data }) => {
                if (!data?.length) return;
                setSelectedComponentInfoMap((prev) => {
                  const next = new Map(prev);
                  data.forEach((comp: any) => {
                    next.set(comp.component_id, {
                      internal_code: comp.internal_code,
                      description: comp.description,
                      category_name: comp.category?.categoryname ?? null,
                      stock_on_hand: comp.inventory?.[0]?.quantity_on_hand ?? null,
                      suppliers: comp.suppliercomponents ?? [],
                    });
                  });
                  return next;
                });
              });
          }
        }
      }
    } catch {
      sessionStorage.removeItem(PO_DRAFT_STORAGE_KEY);
    }
  }, [reset]);

  // Auto-save form data to sessionStorage (debounced)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    const subscription = watch((values) => {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        try {
          const formData = values as PurchaseOrderFormData;
          const hasContent =
            formData.items?.some((item) => item.component_id > 0) ||
            (formData.notes && formData.notes.trim().length > 0);
          if (hasContent) {
            sessionStorage.setItem(
              PO_DRAFT_STORAGE_KEY,
              JSON.stringify(formData)
            );
          } else {
            sessionStorage.removeItem(PO_DRAFT_STORAGE_KEY);
          }
        } catch {
          // Ignore storage errors
        }
      }, 500);
    });
    return () => {
      subscription.unsubscribe();
      clearTimeout(saveTimerRef.current);
    };
  }, [watch]);

  // Clear saved draft (called on successful submission)
  const clearDraft = useCallback(() => {
    sessionStorage.removeItem(PO_DRAFT_STORAGE_KEY);
  }, []);

  // Get draft status ID
  const { data: draftStatusId, isLoading: statusLoading } = useQuery({
    queryKey: ['draftStatusId'],
    queryFn: fetchDraftStatusId,
  });

  // Fetch active customer orders
  const { data: customerOrders, isLoading: ordersLoading } = useQuery({
    queryKey: ['activeCustomerOrders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('order_id, order_number, customer:customers(name)')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      return (
        data?.map((o: any) => ({
          value: o.order_id,
          label: `${o.order_number} - ${o.customer?.name || 'Unknown Customer'}`,
        })) || []
      );
    },
  });

  // Watch for component changes to load suppliers
  const watchedItems = watch('items');

  // Create a single query for all supplier components
  const { data: supplierComponentsMap, isLoading: suppliersLoading } =
    useQuery<Map<number, SupplierComponentFromAPI[]>>({
      queryKey: [
        'supplierComponents',
        watchedItems.map((item) => item.component_id).join(','),
      ],
      queryFn: async () => {
        const results = new Map<number, SupplierComponentFromAPI[]>();
        const componentIds = Array.from(
          new Set(
            watchedItems
              .filter((item) => item.component_id > 0)
              .map((item) => item.component_id)
          )
        );

        await Promise.all(
          componentIds.map(async (componentId) => {
            const suppliers =
              await fetchSupplierComponentsForComponent(componentId);
            results.set(componentId, suppliers);
          })
        );

        return results;
      },
      enabled: watchedItems.some((item) => item.component_id > 0),
    });

  // Create purchase order mutation
  const createOrderMutation = useMutation({
    mutationFn: async (data: PurchaseOrderFormData) => {
      if (!draftStatusId) throw new Error('Failed to get draft status');
      return createPurchaseOrder(
        data,
        draftStatusId,
        supplierComponentsMap ?? new Map()
      );
    },
    onSuccess: (results) => {
      clearDraft();
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
      queryClient.invalidateQueries({ queryKey: ['purchasing-dashboard'] });

      const createdCount = Array.isArray(results) ? results.length : 0;
      if (createdCount > 1) {
        // Multiple POs created (multi-supplier) — go to dashboard with pending filter
        router.push('/purchasing?filter=pending');
      } else if (createdCount === 1) {
        router.push(
          `/purchasing/purchase-orders/${results[0].purchase_order_id}`
        );
      } else {
        router.push('/purchasing?filter=pending');
      }
    },
    onError: (error: Error) => {
      setError(error.message);
    },
  });

  // Check for existing Draft POs for the selected suppliers
  const checkForExistingDrafts = async (
    formData: PurchaseOrderFormData
  ): Promise<SupplierWithDrafts[]> => {
    const supplierIds = new Set<number>();

    formData.items.forEach((item) => {
      const supplierOptions =
        supplierComponentsMap?.get(item.component_id) || [];
      const supplierComponent = supplierOptions.find(
        (sc) => sc.supplier_component_id === item.supplier_component_id
      );
      if (supplierComponent?.supplier_id) {
        supplierIds.add(supplierComponent.supplier_id);
      }
    });

    const draftsPerSupplier: SupplierWithDrafts[] = [];

    for (const supplierId of Array.from(supplierIds)) {
      const { data: drafts, error } = await supabase.rpc(
        'get_draft_purchase_orders_for_supplier',
        {
          p_supplier_id: supplierId,
        }
      );

      if (!error && drafts && drafts.length > 0) {
        let supplierName = 'Unknown';
        for (const [, suppliers] of supplierComponentsMap?.entries() || []) {
          const match = suppliers.find((s) => s.supplier_id === supplierId);
          if (match) {
            supplierName = match.supplier.name;
            break;
          }
        }

        draftsPerSupplier.push({
          supplierId,
          supplierName,
          existingDrafts: drafts.map((d: any) => ({
            purchase_order_id: d.purchase_order_id,
            q_number: d.q_number,
            created_at: d.created_at,
            notes: d.notes,
            line_count: Number(d.line_count),
            total_amount: Number(d.total_amount),
          })),
        });
      }
    }

    return draftsPerSupplier;
  };

  // Handle consolidation decision
  const handleConsolidationConfirm = async (
    decisions: Record<number, number | 'new'>
  ) => {
    setConsolidateDialogOpen(false);

    if (!pendingFormData || !draftStatusId) return;

    const toastId = toast.loading('Creating purchase orders...');

    try {
      const itemsBySupplier = new Map<
        number,
        Array<{
          supplier_component_id: number;
          quantity: number;
          component_id: number;
          customer_order_id?: number | null;
          notes?: string;
          supplierId: number;
        }>
      >();

      pendingFormData.items.forEach((item) => {
        const supplierOptions =
          supplierComponentsMap?.get(item.component_id) || [];
        const supplierComponent = supplierOptions.find(
          (sc) => sc.supplier_component_id === item.supplier_component_id
        );

        if (!supplierComponent) {
          throw new Error(
            `Missing supplier data for component ${item.component_id}. Refresh suppliers and try again.`
          );
        }

        if (!supplierComponent.supplier_id) {
          throw new Error(
            `Supplier selection is missing its supplier reference for component ${item.component_id}.`
          );
        }

        if (!itemsBySupplier.has(supplierComponent.supplier_id)) {
          itemsBySupplier.set(supplierComponent.supplier_id, []);
        }
        itemsBySupplier.get(supplierComponent.supplier_id)?.push({
          supplier_component_id: item.supplier_component_id,
          quantity: item.quantity,
          component_id: item.component_id,
          customer_order_id: item.customer_order_id,
          notes: item.notes,
          supplierId: supplierComponent.supplier_id,
        });
      });

      const orderDateISO = pendingFormData.order_date
        ? new Date(pendingFormData.order_date).toISOString()
        : new Date().toISOString();

      const results: PurchaseOrderCreationResult[] = [];

      for (const [supplierId, items] of Array.from(
        itemsBySupplier.entries()
      )) {
        const decision = decisions[supplierId] || 'new';

        const lineItems: SupplierOrderLinePayload[] = items.map((item) => ({
          supplier_component_id: item.supplier_component_id,
          order_quantity: item.quantity,
          component_id: item.component_id,
          quantity_for_order: item.customer_order_id ? item.quantity : 0,
          quantity_for_stock: item.customer_order_id ? 0 : item.quantity,
          customer_order_id: item.customer_order_id || null,
          line_notes: item.notes || null,
        }));

        if (decision !== 'new' && typeof decision === 'number') {
          const { data, error: rpcError } = await supabase.rpc(
            'add_lines_to_purchase_order',
            {
              target_purchase_order_id: decision,
              line_items: lineItems,
            }
          );

          if (rpcError) throw rpcError;

          results.push({
            purchase_order_id: decision,
            supplier_order_ids: data?.[0]?.supplier_order_ids ?? [],
          });
        } else {
          const { data, error: rpcError } = await supabase.rpc(
            'create_purchase_order_with_lines',
            {
              supplier_id: supplierId,
              line_items: lineItems,
              status_id: draftStatusId,
              order_date: orderDateISO,
              notes: pendingFormData.notes ?? '',
            }
          );

          if (rpcError) throw rpcError;

          const rpcResult = Array.isArray(data) ? data?.[0] : data;
          if (rpcResult && typeof rpcResult.purchase_order_id === 'number') {
            results.push({
              purchase_order_id: rpcResult.purchase_order_id,
              supplier_order_ids: rpcResult.supplier_order_ids ?? [],
            });
          }
        }
      }

      const addedCount = results.filter((r) =>
        suppliersWithDrafts.some((s) =>
          s.existingDrafts.some(
            (d) => d.purchase_order_id === r.purchase_order_id
          )
        )
      ).length;

      let toastMessage = '';
      if (addedCount > 0 && addedCount === results.length) {
        toastMessage =
          addedCount === 1
            ? 'Items added to existing purchase order!'
            : `Items added to ${addedCount} existing purchase orders!`;
      } else if (addedCount > 0) {
        toastMessage = `${results.length - addedCount} new PO(s) created, ${addedCount} existing PO(s) updated!`;
      } else {
        toastMessage =
          results.length === 1
            ? 'Purchase order created successfully!'
            : `${results.length} purchase orders created successfully!`;
      }

      toast.success(toastMessage, { id: toastId });
      clearDraft();
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
      queryClient.invalidateQueries({ queryKey: ['purchasing-dashboard'] });

      if (results.length > 1) {
        // Multiple POs — go to dashboard with pending filter
        router.push('/purchasing?filter=pending');
      } else if (results.length === 1) {
        router.push(
          `/purchasing/purchase-orders/${results[0].purchase_order_id}`
        );
      } else {
        router.push('/purchasing?filter=pending');
      }
    } catch (err) {
      console.error('Error in consolidation:', err);
      toast.error('Failed to create purchase orders', { id: toastId });
    }

    setPendingFormData(null);
  };

  const onSubmit = async (data: PurchaseOrderFormData) => {
    setError(null);
    setIsCheckingDrafts(true);

    try {
      const drafts = await checkForExistingDrafts(data);

      if (drafts.length > 0) {
        setPendingFormData(data);
        setSuppliersWithDrafts(drafts);
        setConsolidateDialogOpen(true);
      } else {
        createOrderMutation.mutate(data);
      }
    } catch (err) {
      console.error('Error checking for drafts:', err);
      createOrderMutation.mutate(data);
    } finally {
      setIsCheckingDrafts(false);
    }
  };

  const addItem = () => {
    append({
      component_id: 0,
      supplier_component_id: 0,
      quantity: undefined as unknown as number,
      customer_order_id: null,
      notes: '',
    });
  };

  // Open modal for a specific item index
  const openComponentModal = (index: number) => {
    setComponentModalTargetIndex(index);
    setComponentModalOpen(true);
  };

  // Handle component selection from modal
  const handleComponentSelection = (selection: ComponentSelection) => {
    if (componentModalTargetIndex === null) return;

    const idx = componentModalTargetIndex;

    // Set component_id
    setValue(`items.${idx}.component_id`, selection.component_id, {
      shouldValidate: true,
      shouldDirty: true,
    });

    // Store rich info for display
    setSelectedComponentInfoMap((prev) => {
      const next = new Map(prev);
      next.set(selection.component_id, {
        internal_code: selection.internal_code,
        description: selection.description,
        category_name: selection.category_name,
        stock_on_hand: selection.stock_on_hand,
        suppliers: selection.suppliers,
      });
      return next;
    });

    // Reset supplier selection
    setValue(`items.${idx}.supplier_component_id`, 0, {
      shouldValidate: false,
      shouldDirty: true,
    });

    // Auto-select supplier if only one option
    if (selection.suppliers.length === 1) {
      setValue(
        `items.${idx}.supplier_component_id`,
        selection.suppliers[0].supplier_component_id,
        { shouldValidate: true, shouldDirty: true }
      );
    }
  };

  // Clear a component selection on a line item
  const clearComponentSelection = (index: number) => {
    setValue(`items.${index}.component_id`, 0, {
      shouldValidate: true,
      shouldDirty: true,
    });
    setValue(`items.${index}.supplier_component_id`, 0, {
      shouldValidate: false,
      shouldDirty: true,
    });
  };

  // Get existing component IDs for the modal indicator
  const existingComponentIds = useMemo(
    () =>
      watchedItems
        .filter((item) => item.component_id > 0)
        .map((item) => item.component_id),
    [watchedItems]
  );

  // react-select shared dark-mode styles
  const reactSelectStyles = {
    control: (base: any, state: any) => ({
      ...base,
      minHeight: '2.5rem',
      borderRadius: '0.375rem',
      borderColor: state.isFocused
        ? 'hsl(var(--ring))'
        : 'hsl(var(--input))',
      boxShadow: state.isFocused ? '0 0 0 1px hsl(var(--ring))' : 'none',
      '&:hover': {
        borderColor: state.isFocused
          ? 'hsl(var(--ring))'
          : 'hsl(var(--input))',
      },
      backgroundColor: 'hsl(var(--background))',
    }),
    menu: (base: any) => ({
      ...base,
      zIndex: 50,
      marginTop: 4,
      backgroundColor: 'hsl(var(--popover))',
      border: '1px solid hsl(var(--border))',
      borderRadius: '0.375rem',
      boxShadow:
        '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
    }),
    menuList: (base: any) => ({
      ...base,
      backgroundColor: 'hsl(var(--popover))',
      padding: '0.25rem',
    }),
    menuPortal: (base: any) => ({
      ...base,
      zIndex: 60,
    }),
    option: (base: any, state: any) => ({
      ...base,
      backgroundColor: state.isFocused
        ? 'hsl(var(--accent))'
        : 'transparent',
      color: state.isFocused
        ? 'hsl(var(--accent-foreground))'
        : 'hsl(var(--popover-foreground))',
      cursor: 'pointer',
      borderRadius: '0.25rem',
    }),
    singleValue: (base: any) => ({
      ...base,
      color: 'hsl(var(--foreground))',
    }),
    input: (base: any) => ({
      ...base,
      color: 'hsl(var(--foreground))',
    }),
    placeholder: (base: any) => ({
      ...base,
      color: 'hsl(var(--muted-foreground))',
    }),
    noOptionsMessage: (base: any) => ({
      ...base,
      color: 'hsl(var(--muted-foreground))',
    }),
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label
            htmlFor="order_date"
            className="block text-sm font-medium mb-1"
          >
            Order Date
          </label>
          <Input
            id="order_date"
            type="date"
            className={`h-10 ${errors.order_date ? 'border-destructive' : ''}`}
            disabled={createOrderMutation.isPending || statusLoading}
            {...register('order_date')}
          />
          {errors.order_date && (
            <p className="mt-1 text-sm text-destructive">
              {errors.order_date.message}
            </p>
          )}
        </div>

        <div className="md:col-span-2">
          <label htmlFor="notes" className="block text-sm font-medium mb-1">
            Notes
          </label>
          <Textarea
            id="notes"
            className={`min-h-[80px] ${errors.notes ? 'border-destructive' : ''}`}
            disabled={createOrderMutation.isPending || statusLoading}
            {...register('notes')}
          />
          {errors.notes && (
            <p className="mt-1 text-sm text-destructive">
              {errors.notes.message}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium">Order Items</h3>
          <Button
            type="button"
            onClick={addItem}
            variant="outline"
            size="sm"
            disabled={createOrderMutation.isPending}
          >
            <Plus className="h-4 w-4 mr-1" /> Add Item
          </Button>
        </div>

        {errors.items && !Array.isArray(errors.items) && (
          <p className="text-sm text-destructive">{errors.items.message}</p>
        )}

        {fields.map((field, index) => {
          const componentId = watchedItems[index]?.component_id;
          const hasComponent = componentId > 0;
          const componentInfo = hasComponent
            ? selectedComponentInfoMap.get(componentId)
            : null;
          const suppliers =
            supplierComponentsMap?.get(componentId) || [];
          const selectedSupplierComponentId =
            watchedItems[index]?.supplier_component_id;
          const selectedSupplier = suppliers.find(
            (sc) =>
              sc.supplier_component_id === selectedSupplierComponentId
          );

          return (
            <Card key={field.id} className="overflow-hidden">
              <CardContent className="p-4 space-y-4">
                {/* Row 1: Item header + delete */}
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium text-muted-foreground">
                    Item {index + 1}
                  </h4>
                  <Button
                    type="button"
                    onClick={() => {
                      if (fields.length > 1) {
                        remove(index);
                      } else {
                        clearComponentSelection(0);
                        setValue(
                          `items.0.quantity`,
                          undefined as unknown as number
                        );
                        setValue(`items.0.customer_order_id`, null);
                        setValue(`items.0.notes`, '');
                      }
                    }}
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    disabled={createOrderMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                {/* Row 2: Component selector — full width */}
                <div>
                  {!hasComponent ? (
                    // Empty state: show search button
                    <button
                      type="button"
                      onClick={() => openComponentModal(index)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-md border text-sm transition-colors hover:bg-accent/50 ${
                        errors.items?.[index]?.component_id
                          ? 'border-destructive'
                          : 'border-input border-dashed'
                      }`}
                    >
                      <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="text-muted-foreground">
                        Search for a component...
                      </span>
                    </button>
                  ) : (
                    // Selected: show rich component info card
                    <div className="rounded-md border bg-accent/30 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <Package className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-sm font-semibold">
                                {componentInfo?.internal_code ?? `#${componentId}`}
                              </span>
                              {componentInfo?.category_name && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] font-normal"
                                >
                                  {componentInfo.category_name}
                                </Badge>
                              )}
                            </div>
                            {componentInfo?.description && (
                              <p className="text-sm text-muted-foreground truncate">
                                {componentInfo.description}
                              </p>
                            )}
                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                              {componentInfo?.stock_on_hand !== null &&
                                componentInfo?.stock_on_hand !== undefined && (
                                  <span
                                    className={
                                      componentInfo.stock_on_hand === 0
                                        ? 'text-destructive'
                                        : componentInfo.stock_on_hand < 10
                                          ? 'text-amber-500'
                                          : ''
                                    }
                                  >
                                    Stock: {componentInfo.stock_on_hand}
                                  </span>
                                )}
                              <span>
                                {suppliers.length} supplier
                                {suppliers.length !== 1 ? 's' : ''}
                              </span>
                              {selectedSupplier && (
                                <span className="font-medium">
                                  R{selectedSupplier.price.toFixed(2)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => openComponentModal(index)}
                          >
                            Change
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => clearComponentSelection(index)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                  {errors.items?.[index]?.component_id && !hasComponent && (
                    <p className="mt-1 text-sm text-destructive">
                      {errors.items[index]?.component_id?.message}
                    </p>
                  )}
                </div>

                {/* Row 3: Supplier, Quantity, Customer Order — side by side */}
                {hasComponent && (
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_8rem_1fr] gap-4 items-end">
                    {/* Supplier */}
                    <div>
                      <label
                        htmlFor={`items.${index}.supplier_component_id`}
                        className="block text-xs font-medium text-muted-foreground mb-1"
                      >
                        Supplier
                      </label>
                      <Controller
                        control={control}
                        name={`items.${index}.supplier_component_id`}
                        render={({ field }) => {
                          return (
                            <Select
                              value={field.value?.toString() || ''}
                              onValueChange={(value) =>
                                field.onChange(parseInt(value) || 0)
                              }
                              disabled={
                                !componentId ||
                                suppliersLoading ||
                                createOrderMutation.isPending
                              }
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select a supplier" />
                              </SelectTrigger>
                              <SelectContent>
                                {suppliers.map(
                                  (sc: SupplierComponentFromAPI) => (
                                    <SelectItem
                                      key={sc.supplier_component_id}
                                      value={sc.supplier_component_id.toString()}
                                    >
                                      {sc.supplier?.name ||
                                        'Unknown Supplier'}{' '}
                                      - R{sc.price.toFixed(2)}
                                    </SelectItem>
                                  )
                                )}
                              </SelectContent>
                            </Select>
                          );
                        }}
                      />
                      {errors.items?.[index]?.supplier_component_id && (
                        <p className="mt-1 text-sm text-destructive">
                          {errors.items[index]?.supplier_component_id?.message}
                        </p>
                      )}
                    </div>

                    {/* Quantity */}
                    <div>
                      <label
                        htmlFor={`items.${index}.quantity`}
                        className="block text-xs font-medium text-muted-foreground mb-1"
                      >
                        Quantity
                      </label>
                      <Controller
                        control={control}
                        name={`items.${index}.quantity`}
                        render={({ field }) => (
                          <input
                            type="number"
                            id={`items.${index}.quantity`}
                            className={`h-10 w-full rounded-md border ${
                              errors.items?.[index]?.quantity
                                ? 'border-destructive'
                                : 'border-input'
                            } bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                            min="0.01"
                            step="any"
                            placeholder="Qty"
                            value={field.value ?? ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              field.onChange(
                                val === '' ? undefined : parseFloat(val) || 0
                              );
                            }}
                            disabled={createOrderMutation.isPending}
                          />
                        )}
                      />
                      {errors.items?.[index]?.quantity && (
                        <p className="mt-1 text-sm text-destructive">
                          {errors.items[index]?.quantity?.message}
                        </p>
                      )}
                    </div>

                    {/* Customer Order */}
                    <div>
                      <label
                        htmlFor={`items.${index}.customer_order_id`}
                        className="block text-xs font-medium text-muted-foreground mb-1"
                      >
                        Customer Order
                      </label>
                      <Controller
                        control={control}
                        name={`items.${index}.customer_order_id`}
                        render={({ field }) => (
                          <ReactSelect
                            inputId={`customer-order-select-${index}`}
                            isClearable
                            isDisabled={
                              ordersLoading || createOrderMutation.isPending
                            }
                            isLoading={ordersLoading}
                            options={customerOrders}
                            value={
                              customerOrders?.find(
                                (o: any) => o.value === field.value
                              ) || null
                            }
                            onChange={(option: any) =>
                              field.onChange(option?.value || null)
                            }
                            placeholder="Stock Order"
                            menuPlacement="auto"
                            classNamePrefix="customer-order-select"
                            styles={reactSelectStyles}
                            menuPortalTarget={
                              typeof document !== 'undefined'
                                ? document.body
                                : undefined
                            }
                          />
                        )}
                      />
                    </div>
                  </div>
                )}

                {/* Per-line-item note (expand/collapse) */}
                {hasComponent &&
                  (expandedNotes.has(index) || watchedItems[index]?.notes ? (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-medium text-muted-foreground">
                          Item Note
                        </label>
                        {!watchedItems[index]?.notes && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs text-muted-foreground"
                            onClick={() => {
                              setExpandedNotes((prev) => {
                                const next = new Set(prev);
                                next.delete(index);
                                return next;
                              });
                            }}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                      <Textarea
                        {...register(`items.${index}.notes`)}
                        placeholder="e.g. Size must be 1m x 2m"
                        className="min-h-[60px] text-sm"
                        disabled={createOrderMutation.isPending}
                      />
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setExpandedNotes((prev) => new Set(prev).add(index));
                      }}
                    >
                      <StickyNote className="h-3 w-3 mr-1" />
                      Add note
                    </Button>
                  ))}
              </CardContent>
            </Card>
          );
        })}

        {/* Bottom Add Item — always within reach after the last card */}
        {fields.length >= 2 && (
          <Button
            type="button"
            onClick={addItem}
            variant="outline"
            size="sm"
            className="w-full border-dashed"
            disabled={createOrderMutation.isPending}
          >
            <Plus className="h-4 w-4 mr-1" /> Add Item
          </Button>
        )}
      </div>

      <div className="pt-4 border-t flex justify-end">
        <Button
          type="submit"
          disabled={
            createOrderMutation.isPending || statusLoading || isCheckingDrafts
          }
          className="w-full md:w-auto"
        >
          {(createOrderMutation.isPending || isCheckingDrafts) && (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          )}
          {isCheckingDrafts
            ? 'Checking existing orders...'
            : createOrderMutation.isPending
              ? 'Creating Purchase Order...'
              : 'Create Purchase Order'}
        </Button>
      </div>

      {/* Component Search Modal */}
      <ComponentSearchModal
        open={componentModalOpen}
        onOpenChange={setComponentModalOpen}
        onSelect={handleComponentSelection}
        existingComponentIds={existingComponentIds}
      />

      {/* Consolidation Dialog */}
      <ConsolidatePODialog
        open={consolidateDialogOpen}
        onOpenChange={setConsolidateDialogOpen}
        suppliersWithDrafts={suppliersWithDrafts}
        onConfirm={handleConsolidationConfirm}
        isLoading={false}
      />
    </form>
  );
}
